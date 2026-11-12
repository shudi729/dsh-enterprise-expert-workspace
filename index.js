/**
 * Host half of the Enterprise AI Expert Workspace bundle.
 *
 * Registration is service-driven: `ctx.inject(['webServer']...)` and
 * `ctx.inject(['tools']...)` wait for the real DSH services instead of reading
 * `ctx.get(...)` synchronously during apply (the services may mount later).
 * Tools use the formal `@deepseek-ai/dsh-tools` `defineTool` contract and are
 * verified against the real tool catalogue; a failure is reported, never
 * disguised as success.
 */
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import catalog from './capabilities/catalog.js';
import { createWorkspace } from './src/core/workspace.js';
import { registerRoutes } from './src/host/routes.js';
import { registerSkills } from './src/host/skills-bridge.js';
import { registerAgentTools } from './src/host/tools.js';
import { createDshModel } from './src/host/model-adapter.js';

const ASSETS_DIR = fileURLToPath(new URL('./assets/', import.meta.url));

function resolveDataDir(ctx) {
  if (process.env.EEW_DATA_DIR) return path.resolve(process.env.EEW_DATA_DIR);
  const home = ctx?.get?.('homePaths');
  const dshHome = process.env.DSH_HOME
    ?? (typeof home?.dshHome === 'string' ? home.dshHome : null)
    ?? path.join(homedir(), '.dsh');
  return path.join(dshHome, 'enterprise-expert-workspace');
}

/** Resolve the real dsh-tools package from the running installation. */
async function loadToolsModule() {
  if (process.env.EEW_DSH_RUNTIME_ROOT) {
    try {
      const file = path.join(process.env.EEW_DSH_RUNTIME_ROOT, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js');
      return await import(pathToFileURL(file).href);
    } catch { /* fall through */ }
  }
  try { return await import('@deepseek-ai/dsh-tools'); } catch { return null; }
}

export function apply(ctx) {
  const model = createDshModel(ctx);
  let workspacePromise = null;
  const getWorkspace = () => {
    if (!workspacePromise) {
      workspacePromise = createWorkspace({
        dataDir: resolveDataDir(ctx),
        assetsDir: ASSETS_DIR,
        catalog,
        model,
        contextProvider: () => ctx,
      });
    }
    return workspacePromise;
  };
  const status = {
    routes: false, routeError: null, skills: 0, tools: [], toolFailures: [], skillFailures: [],
    toolCatalogueOk: false, model: { available: false, reason: '等待服务挂载后刷新', calls: 0, failures: 0 },
    ready: null,
  };

  let resolveRoutes;
  let resolveTools;
  let toolDispose = null;
  const routesReady = new Promise((resolve) => { resolveRoutes = resolve; });
  const toolsReady = new Promise((resolve) => { resolveTools = resolve; });

  ctx.inject(['webServer'], (webCtx) => {
    let disposeRoute = () => undefined;
    try {
      const dispose = registerRoutes({ ctx: webCtx, getWorkspace, prefix: '/eew' });
      if (typeof dispose === 'function') disposeRoute = dispose;
      status.routes = true;
      status.routeError = null;
    } catch (error) {
      status.routeError = error?.message ?? String(error);
      console.warn('[eew] HTTP route registration failed:', status.routeError);
    }
    resolveRoutes(status.routes);
    // The disposer belongs to THIS injection only. A settings/model service
    // restart must not tear down the HTTP route without re-registering it.
    return () => {
      try { disposeRoute(); } catch { /* teardown race */ }
      status.routes = false;
    };
  });

  ctx.inject(['skills'], (skillCtx) => {
    const result = registerSkills(skillCtx, catalog);
    status.skills = result.registered;
    status.skillFailures = result.failures;
    getWorkspace().then((ws) => ws.diagnostics.log({
      action: 'skills.register', status: result.failures.length > 0 ? 'error' : 'ok',
      message: `registered ${result.registered}, failed ${result.failures.length}`,
    })).catch(() => undefined);
    return result.dispose;
  });

  // The DSH model service is a Cordis service: wait for it explicitly instead
  // of assuming it is visible on the Host apply() context.
  ctx.inject(['llm'], (llmCtx) => {
    model.attach(llmCtx);
    status.model.serviceInjected = true;
    return () => undefined;
  });

  ctx.inject(['agentDefaultModel'], (modelCtx) => {
    model.attach(modelCtx);
    return () => undefined;
  });

  ctx.inject(['tools'], (toolCtx) => {
    let cancelled = false;
    (async () => {
      const toolsModule = await loadToolsModule();
      if (cancelled) return;
      const result = registerAgentTools(toolCtx, { getWorkspace, defineTool: toolsModule?.defineTool ?? null });
      status.tools = result.names;
      status.toolFailures = result.failures;
      status.toolCatalogueOk = result.ok;
      if (result.ok) toolDispose = result.dispose;
      else console.warn('[eew] Agent tool registration unavailable:', result.reason);
      resolveTools(result);
    })().catch((error) => resolveTools({
      ok: false, available: false, names: [], failures: [{ message: error.message }],
      reason: error.message, dispose() {},
    }));
    return () => { cancelled = true; if (toolDispose) toolDispose(); };
  });

  // Startup must never hang on a lean profile that lacks one of the services.
  const withTimeout = (promise, fallback, ms = 6000) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
    promise.then((value) => { clearTimeout(timer); resolve(value); });
  });

  status.ready = (async () => {
    const [routes, tools] = await Promise.all([
      withTimeout(routesReady, false),
      withTimeout(toolsReady, { ok: false, names: [], failures: [], reason: 'tools 服务未在超时内挂载', dispose() {} }),
    ]);
    const ws = await getWorkspace();
    await Promise.all([
      ws.diagnostics.log({ action: 'tools.register', status: tools?.ok ? 'ok' : 'error', message: `${(tools?.names ?? []).join(',') || 'none'}: ${tools?.reason ?? 'verified in tool catalogue'}` }),
      ws.diagnostics.log({ action: 'routes.register', status: routes ? 'ok' : 'error', message: routes ? '/eew' : `webServer unavailable${status.routeError ? ': ' + status.routeError : ''}` }),
      ws.diagnostics.log({ action: 'model.attach', status: model.available ? 'ok' : 'unavailable', message: model.reason ?? JSON.stringify(model.route ?? {}) }),
      ws.workflows.recover().then((recovered) => ws.diagnostics.log({ action: 'workflow.recover', status: 'ok', message: `recovered ${recovered.recovered} runs` })),
    ]);
    status.model = {
      available: model.available,
      reason: model.reason,
      ...model.stats,
      lastError: model.lastError,
      serviceInjected: status.model.serviceInjected ?? false,
      attachedContexts: model.attachedContexts,
    };
    return { routes, tools, model: status.model };
  })();

  return status;
}
