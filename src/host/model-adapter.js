/**
 * Reuse the DSH model service — this is NOT a second model stack.
 *
 * Verified against @deepseek-ai/dsh-llm 0.2.1-rc.5:
 *   - the service is `ctx.llm` (Cordis service name `llm`), with `stream()`,
 *     `listProviders()`, `listModels()` and `prepareCall()`;
 *   - `ctx.agentDefaultModel.currentSelection()` returns the user's saved
 *     `{ provider, model, reasoningEffort }` selection;
 *   - credentials live in `$DSH_HOME/.credentials.yaml` (managed by
 *     `@deepseek-ai/dsh-credentials-local`) or `apiKeyEnv: DEEPSEEK_API_KEY`.
 * No credential value is read, logged, copied into source or exported here.
 *
 * Resolution is lazy: DSH services can mount AFTER a Host plugin's apply(),
 * so `ctx.llm` is looked up when a call is actually made, not at boot.
 */
const DEFAULT_PROVIDER = 'deepseek-official';
const DEFAULT_MODEL = 'deepseek-flash';

export function createDshModel(ctx) {
  // Cordis contexts proxy unknown service names; a direct property read can
  // throw before the service is mounted. `attach()` receives the context that
  // DSH injects once the `llm` service is actually available.
  const contexts = [ctx];
  const getLlm = () => {
    for (const candidate of contexts) {
      try {
        const direct = candidate?.llm;
        if (direct && typeof direct.stream === 'function') return direct;
        const viaGet = candidate?.get?.('llm');
        if (viaGet && typeof viaGet.stream === 'function') return viaGet;
      } catch { /* try the next injected context */ }
    }
    return null;
  };
  const state = {
    lastError: null,
    route: null,
    providers: null,
    source: null,
    calls: 0,
    failures: 0,
  };

  function discoverRoute(llm) {
    if (state.route) return state.route;
    let provider = process.env.EEW_MODEL_PROVIDER || null;
    let model = process.env.EEW_MODEL_NAME || null;
    let reasoningEffort = null;
    let source = 'environment';
    try {
      const selection = ctx?.agentDefaultModel?.currentSelection?.()
        ?? ctx?.get?.('agentDefaultModel')?.currentSelection?.();
      if (selection?.provider && selection?.model) {
        provider = provider ?? selection.provider;
        model = model ?? selection.model;
        reasoningEffort = selection.reasoningEffort ?? null;
        source = 'dsh-agent-default-model';
      }
    } catch { /* fall back to a registered provider */ }
    try {
      if (typeof llm?.listProviders === 'function') {
        const providers = llm.listProviders();
        state.providers = providers.map((item) => item?.id ?? item?.name).filter(Boolean);
        if (!provider || (state.providers.length > 0 && !state.providers.includes(provider))) {
          provider = state.providers[0] ?? provider ?? DEFAULT_PROVIDER;
          source = 'llm.listProviders';
        }
      }
    } catch { /* discovery is best effort */ }
    state.route = {
      provider: provider ?? DEFAULT_PROVIDER,
      model: model ?? DEFAULT_MODEL,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };
    state.source = source;
    return state.route;
  }

  return {
    attach(extra) { if (extra && !contexts.includes(extra)) contexts.push(extra); },
    get attachedContexts() { return contexts.length; },
    get available() {
      // Explicit verification switch: browser UI acceptance runs without model
      // calls so DSH's listener restart cannot interrupt the interaction flow.
      // Real model analysis is verified separately with credentials enabled.
      if (process.env.EEW_DISABLE_MODEL === '1') return false;
      return typeof getLlm()?.stream === 'function';
    },
    get reason() {
      if (process.env.EEW_DISABLE_MODEL === '1') return '本次验证显式关闭模型调用（EEW_DISABLE_MODEL=1），程序化整理不冒充专家分析';
      return this.available ? null : 'DSH llm 服务尚未挂载（需 dsh-base 组合与模型提供方适配器）';
    },
    get route() { const llm = getLlm(); return llm ? discoverRoute(llm) : null; },
    get providers() { const llm = getLlm(); if (llm) discoverRoute(llm); return state.providers; },
    get lastError() { return state.lastError; },
    get stats() { return { calls: state.calls, failures: state.failures, source: state.source, route: state.route, providers: state.providers }; },

    async complete({ system, prompt, maxTokens = 1200, signal } = {}) {
      const llm = getLlm();
      if (!llm || typeof llm.stream !== 'function') {
        state.failures += 1;
        state.lastError = 'DSH llm 服务未挂载';
        throw new Error(`DSH 模型调用失败：${state.lastError}`);
      }
      const route = discoverRoute(llm);
      state.calls += 1;
      const options = {
        provider: route.provider,
        model: route.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: String(prompt ?? '') }] }],
        system: String(system ?? ''),
        maxTokens,
        // Do not force the user's high reasoning effort for a short analysis:
        // a reasoning-only model can consume the whole output budget and
        // terminate with `max-tokens` before emitting any text-delta.
        ...(process.env.EEW_MODEL_REASONING ? { reasoningEffort: process.env.EEW_MODEL_REASONING } : {}),
        ...(signal ? { signal } : {}),
      };
      const parts = [];
      let termination = null;
      const chunkTypes = [];
      try {
        const stream = await llm.stream(options);
        if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
          throw new Error('llm.stream 未返回可迭代流');
        }
        for await (const chunk of stream) {
          if (chunk?.type && !chunkTypes.includes(chunk.type)) chunkTypes.push(chunk.type);
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') parts.push(chunk.text);
          else if (chunk?.type === 'finish') termination = chunk.reason ?? 'finish';
          else if (chunk?.type === 'error') termination = chunk;
          else if (chunk?.kind === 'error' || chunk?.kind === 'aborted') termination = chunk;
        }
      } catch (error) {
        state.failures += 1;
        state.lastError = error?.message ?? String(error);
        throw new Error(`DSH 模型调用失败：${state.lastError}`);
      }
      const text = parts.join('').trim();
      if (!text) {
        state.failures += 1;
        const reason = typeof termination === 'string'
          ? termination
          : (termination?.failure?.code ?? termination?.code ?? termination?.error?.code ?? JSON.stringify(termination)?.slice(0, 220) ?? 'unknown');
        state.lastError = `模型未返回分析正文（终止原因=${reason}；分片类型=${chunkTypes.join(',') || 'none'}）；常见原因是缺少凭据 MISSING_CREDENTIAL、路由未注册 NO_ADAPTER 或网络/鉴权失败`;
        throw new Error(`DSH 模型调用失败：${state.lastError}`);
      }
      state.lastError = null;
      return text;
    },
  };
}
