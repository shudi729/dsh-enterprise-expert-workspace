import { withActor } from '../core/access.js';
import { describeError } from '../core/errors.js';

/**
 * First-party DSH tool definitions. `defineTool` comes from the real
 * `@deepseek-ai/dsh-tools` package; `tools.register()` rejects any definition
 * without a valid `output.schema` + `output.render`, so there is no
 * best-effort fallback: if the package is unavailable the tools are reported
 * as unavailable rather than pretending they were registered.
 */
const DISPATCH_PARAMETERS = {
  goal: { type: 'string', description: '用户的自然语言业务目标；不填 skillName 时工作台会自动选择并执行能力' },
  expertId: { type: 'string', description: '可选：指定或纠正专家 id' },
  skillName: { type: 'string', description: '可选：直接指定技能名' },
  workflowId: { type: 'string', description: '可选：直接指定业务流程 id' },
  input: { type: 'object', additionalProperties: true, description: '业务输入，结构化数据或资料文本' },
  answers: { type: 'object', additionalProperties: true, description: '用户补充的缺口信息，在原任务中继续' },
  taskId: { type: 'string', description: '可选：继续已有任务' },
  format: { type: 'string', description: '成果格式 md/txt/csv/json/pdf/docx/xlsx/pptx' },
  outputForm: { type: 'string', description: '输出形式' },
};

const OUTPUT_PROPERTIES = {
  ok: { type: 'boolean' },
  available: { type: 'boolean' },
  stage: { type: 'string' },
  summary: { type: 'string' },
  conclusion: { type: 'string' },
  taskId: { type: 'string' },
  taskStatus: { type: 'string' },
  expertId: { type: 'string' },
  capability: { type: 'string' },
  questions: { type: 'string' },
  missing: { type: 'array', items: { type: 'json' } },
  structured: { type: 'json' },
  facts: { type: 'array', items: { type: 'string' } },
  unknowns: { type: 'array', items: { type: 'string' } },
  citations: { type: 'array', items: { type: 'json' } },
  artifacts: { type: 'array', items: { type: 'json' } },
  failureReasons: { type: 'array', items: { type: 'string' } },
  quality: { type: 'json' },
  modelAnalysis: { type: 'json' },
  analysisLength: { type: 'number' },
  resultRef: { type: 'json' },
  readNext: { type: 'string' },
  error: { type: 'string' },
  workspaceId: { type: 'string' },
  hits: { type: 'array', items: { type: 'json' } },
  status: { type: 'string' },
  totalLength: { type: 'number' },
  offset: { type: 'number' },
  hasMore: { type: 'boolean' },
  chunk: { type: 'string' },
};

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true, properties: OUTPUT_PROPERTIES };

/** Drop null/undefined so the strict ToolRuntime output validator sees only declared types. */
function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null && child !== undefined));
}

function renderText(value) {
  const lines = [];
  if (value.available === false) {
    lines.push(`[企业 AI 专家工作台] 工具不可用：${value.error ?? 'DSH 工具服务未注册'}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  lines.push(`[企业 AI 专家工作台] ${value.stage ?? 'unknown'} · ${value.ok ? '已完成' : '未完成'}`);
  if (value.summary) lines.push(value.summary);
  if (value.conclusion) lines.push(`结论：${value.conclusion}`);
  if (value.expertId || value.capability) lines.push(`专家/能力：${value.expertId ?? '-'} / ${value.capability ?? '-'}`);
  if (value.questions) lines.push(`需补充：${value.questions}`);
  if (Array.isArray(value.facts) && value.facts.length) lines.push(`事实：${value.facts.slice(0, 6).join('；')}`);
  if (Array.isArray(value.unknowns) && value.unknowns.length) lines.push(`未知项：${value.unknowns.slice(0, 6).join('；')}`);
  if (Array.isArray(value.citations) && value.citations.length) lines.push(`引用：${value.citations.slice(0, 5).map((c) => `${c.title ?? c.docId}/${c.section ?? ''}`).join('；')}`);
  if (Array.isArray(value.artifacts) && value.artifacts.length) lines.push(`成果：${value.artifacts.map((a) => `${a.format} ${a.filename ?? a.id}`).join('；')}`);
  if (value.analysisLength) lines.push(`专家分析正文 ${value.analysisLength} 字：${value.readNext ?? '可通过结果续读获取全文'}`);
  if (value.readNext) lines.push(`完整结果续读：${value.readNext}`);
  if (value.chunk) lines.push(value.chunk);
  if (Array.isArray(value.failureReasons) && value.failureReasons.length) lines.push(`未通过项：${value.failureReasons.join('；')}`);
  return [{ type: 'text', text: lines.join('\n') }];
}

export function registerAgentTools(ctx, { getWorkspace, defineTool }) {
  const tools = ctx.get('tools');
  const base = { ok: false, available: false, stage: 'unavailable' };
  if (!tools || typeof tools.register !== 'function') {
    return { ...base, names: [], reason: 'ctx.tools 服务不可用（该 profile 未挂载工具注册服务）', dispose() {} };
  }
  if (typeof defineTool !== 'function') {
    return { ...base, names: [], reason: '@deepseek-ai/dsh-tools 的 defineTool 不可用，未注册工具（不以 HTTP 路径存在冒充模型可调用）', dispose() {} };
  }

  async function actorFor(ws, args, exec) {
    return ws.accessPolicy.resolveActor({
      requestedWorkspaceId: args?.workspaceId,
      requestedGrants: args?.grants,
      sessionWorkspaceId: exec?.agent?.workspaceId ?? null,
      source: 'agent-tool',
    });
  }

  const definitions = [
    defineTool({
      name: 'eew_dispatch',
      description: '企业 AI 专家工作台：只描述业务目标即可自动选择十个专业方向的专家与 Skill 并真实执行，生成可校验成果、保存进度；资料不足时用业务语言询问缺口并在原任务继续。返回结论、结构化结果、事实与未知项、引用、任务状态、成果入口和完整结果续读方式。',
      parameters: DISPATCH_PARAMETERS,
      output: { schema: OUTPUT_SCHEMA, render: (_args, value) => renderText(value) },
      async execute(args, exec) {
        const ws = await getWorkspace();
        const actor = await actorFor(ws, args, exec);
        return withActor(actor, async () => {
          try {
            const result = await ws.dispatch({ ...args, uploads: Array.isArray(args?.uploads) ? args.uploads : [] });
            const evidence = result.outcome?.evidence ?? {};
            const full = result.outcome?.result ?? {};
            const analysisText = typeof full.analysis === 'string' ? full.analysis : null;
            return {
              ok: result.ok,
              available: true,
              stage: result.stage,
              summary: result.summary,
              conclusion: result.outcome?.message ?? result.questions ?? null,
              taskId: result.task?.id ?? null,
              taskStatus: result.task?.status ?? null,
              expertId: result.routing?.selected?.id ?? result.task?.expertId ?? null,
              capability: result.capability?.id ?? null,
              questions: result.questions ?? null,
              missing: result.missing ?? [],
              structured: full.structured ?? full,
              facts: (evidence.facts ?? []).map((item) => item.statement).slice(0, 12),
              unknowns: (evidence.unknowns ?? []).map((item) => item.statement).slice(0, 12),
              citations: result.outcome?.citations ?? [],
              artifacts: (result.outcome?.artifacts ?? []).map((item) => ({ id: item.id, format: item.format, filename: item.filename, verified: item.verified, bytes: item.bytes, url: `/eew/artifact?id=${item.id}` })),
              failureReasons: result.failureReasons ?? [],
              quality: result.review ? { passed: result.review.passed, verdict: result.review.verdict, checks: result.review.checks } : null,
              modelAnalysis: analysisText ? { available: true, length: analysisText.length } : { available: false },
              analysisLength: analysisText?.length ?? 0,
              resultRef: result.resultRef ?? null,
              readNext: result.resultRef ? `GET /eew/result?id=${result.resultRef.taskId}&index=${result.resultRef.resultIndex ?? -1}，或调用 eew_read_result` : null,
              workspaceId: actor.workspaceId,
            };
          } catch (error) {
            const described = describeError(error);
            return { ...base, error: `${described.code}: ${described.message}`, workspaceId: actor.workspaceId };
          }
        });
      },
    }),
    defineTool({
      name: 'eew_knowledge_search',
      description: '检索企业 AI 专家工作台 Host 持久化知识库，返回可回到原文的引用（docId、章节、行号、原文摘录）；没有命中时如实返回空结果。',
      parameters: {
        query: { type: 'string', required: true, description: '检索词' },
        workspaceId: { type: 'string', description: '需与会话绑定的工作空间一致' },
        domain: { type: 'string', description: '知识领域过滤' },
        limit: { type: 'number', description: '返回条数上限' },
      },
      output: { schema: OUTPUT_SCHEMA, render: (_args, value) => renderText(value) },
      async execute(args, exec) {
        const ws = await getWorkspace();
        const actor = await actorFor(ws, args, exec);
        return withActor(actor, async () => {
          try {
            const result = await ws.knowledge.search({ query: String(args?.query ?? ''), domain: args?.domain, limit: args?.limit ?? 8 });
            return {
              ok: true, available: true, stage: result.status, status: result.status,
              summary: result.status === 'no_match' ? '真实检索结果为空，未伪造知识条目' : `检索到 ${result.hits.length} 条可回溯引用`,
              hits: result.hits, workspaceId: actor.workspaceId,
            };
          } catch (error) {
            const described = describeError(error);
            return { ...base, error: `${described.code}: ${described.message}`, workspaceId: actor.workspaceId };
          }
        });
      },
    }),
    defineTool({
      name: 'eew_read_result',
      description: '按任务 ID 继续读取完整业务结果与分析正文（分页），避免工具响应截断导致分析内容丢失。',
      parameters: {
        taskId: { type: 'string', required: true, description: '任务 ID' },
        index: { type: 'number', description: '结果序号，默认最后一条' },
        offset: { type: 'number', description: '读取偏移' },
        limit: { type: 'number', description: '本页字符数' },
      },
      output: { schema: OUTPUT_SCHEMA, render: (_args, value) => renderText(value) },
      async execute(args, exec) {
        const ws = await getWorkspace();
        const actor = await actorFor(ws, args, exec);
        return withActor(actor, async () => {
          try {
            const result = await ws.readResult({ taskId: String(args?.taskId ?? ''), index: args?.index ?? -1, offset: args?.offset ?? 0, limit: args?.limit ?? 4000 });
            return {
              ok: true, available: true, stage: result.hasMore ? 'more' : 'completed',
              summary: `完整结果 ${result.totalLength} 字，当前读取 ${result.chunk.length} 字`,
              chunk: result.chunk, totalLength: result.totalLength, offset: result.offset,
              hasMore: result.hasMore, readNext: result.hasMore ? result.endpoint : null,
              resultRef: { taskId: result.taskId, index: result.index, endpoint: '/eew/result' },
              workspaceId: actor.workspaceId,
            };
          } catch (error) {
            const described = describeError(error);
            return { ...base, error: `${described.code}: ${described.message}`, workspaceId: actor.workspaceId };
          }
        });
      },
    }),
  ];

  // Normalise every canonical value against the strict output schema.
  for (const definition of definitions) {
    const original = definition.execute;
    definition.execute = async (...args) => compact(await original(...args));
  }

  const registered = [];
  const failures = [];
  const disposers = [];
  for (const definition of definitions) {
    try {
      const dispose = tools.register(definition);
      registered.push(definition.name);
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (error) {
      failures.push({ name: definition.name, message: error?.message ?? String(error) });
    }
  }

  // Registration is only a success if the REAL tool catalogue exposes them.
  let catalogue = null;
  let catalogueOk = false;
  if (typeof tools.schemas === 'function') {
    try {
      const schemas = tools.schemas();
      const names = new Set((Array.isArray(schemas) ? schemas : []).map((item) => item?.name));
      catalogue = [...names];
      catalogueOk = registered.length > 0 && registered.every((name) => names.has(name));
    } catch (error) {
      failures.push({ name: 'schemas()', message: error?.message ?? String(error) });
    }
  } else {
    failures.push({ name: 'schemas()', message: '工具目录不可读，无法确认注册成功' });
  }

  const ok = catalogueOk && registered.length === definitions.length;
  return {
    ok,
    available: ok,
    names: registered,
    failures,
    catalogue,
    reason: ok ? undefined : `工具注册未通过真实工具目录校验：${failures.map((item) => item.message).join('；') || '目录不完整'}`,
    dispose() {
      for (const dispose of disposers) { try { dispose(); } catch { /* teardown */ } }
    },
  };
}
