import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from './store.js';
import { createKnowledge } from './knowledge.js';
import { createTasks } from './tasks.js';
import { createSkillRegistry } from './skills.js';
import { createWorkflows } from './workflows.js';
import { createExperts } from './experts.js';
import { createConnectors } from './connectors.js';
import { createDiagnostics } from './diagnostics.js';
import { createExecutors } from './executors.js';
import { generateDocument, contentToText, capabilityMatrix, parseCsv } from './files.js';
import { assertGranted, assertOwner, createAccessPolicy, currentActor, ownerFilter, withActor } from './access.js';
import { CODES, describeError, fail } from './errors.js';
import { clone, newId, nowIso, sha256, slug, tokenize } from './util.js';

const STRUCTURED_FIELDS = new Set([
  'rows', 'rightRows', 'csv', 'candidates', 'quotes', 'vendors', 'samples', 'assets',
  'metrics', 'claims', 'sources', 'tasks', 'actions', 'problems', 'criteria',
  'fields', 'sections', 'tables', 'content', 'steps', 'signals', 'points', 'items',
  'opportunities', 'phases', 'rules', 'leftRows', 'rightColumns',
]);

/**
 * A running task that has not reported for this long almost certainly belongs
 * to a process that died. The threshold is deliberately long so a genuinely
 * long-running task (large document generation, model calls) is never killed
 * mid-flight. The check only runs against persisted tasks, never against a task
 * we are actively executing in this process.
 */
const STALE_RUNNING_MS = 30 * 60 * 1000;

/**
 * Serialise a value with object keys in sorted order, so two requests that
 * carry the same data with different key order produce the same fingerprint.
 */
function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/** A process is considered alive unless the OS reports it does not exist. */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

/** Only genuinely free-text fields may be filled from the goal/upload body. */
const TEXT_FIELDS = new Set([
  'material', 'text', 'resumeText', 'meetingNotes', 'feedback', 'context',
  'leftText', 'rightText', 'query', 'goal', 'title', 'question', 'objective',
  'requirement', 'note', 'materialText',
]);

function fieldFromText(field, goal, materialText) {
  const text = `${goal}\n${materialText}`;
  const patterns = {
    customer: [/客户(?:名称)?\s*[:：是]\s*([\u4e00-\u9fa5A-Za-z0-9_-]{2,24})/, /客户\s+([A-Z][A-Za-z0-9_-]{0,20})/],
    role: [/岗位(?:名称)?\s*[:：是]\s*([\u4e00-\u9fa5A-Za-z0-9_-]{2,24})/, /招聘\s*([\u4e00-\u9fa5]{2,12}(?:经理|主管|专员|工程师))/],
    position: [/岗位(?:名称)?\s*[:：是]\s*([\u4e00-\u9fa5A-Za-z0-9_-]{2,24})/],
    project: [/项目(?:名称)?\s*[:：是]\s*([\u4e00-\u9fa5A-Za-z0-9_-]{2,30})/, /复盘\s*([\u4e00-\u9fa5A-Za-z0-9_-]{2,30}?)\s*项目/],
    question: [/研究\s*[:：]?\s*([^\n。；]{2,60})/],
    requirement: [/采购\s*[:：]?\s*([^\n。；]{2,60})/, /需求\s*[:：]?\s*([^\n。；]{2,60})/],
    title: [/报告\s*[:：]?\s*([^\n。；]{2,40})/, /材料\s*[:：]?\s*([^\n。；]{2,40})/],
    objective: [/拜访目标\s*[:：]?\s*([^\n。；]{2,60})/, /目标\s*[:：]?\s*([^\n。；]{2,60})/],
  };
  for (const pattern of patterns[field] ?? []) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  if (['material', 'text', 'resumeText', 'meetingNotes', 'feedback', 'context', 'leftText'].includes(field)) {
    const body = materialText.trim() || goal.trim();
    return body.length > 0 ? body : undefined;
  }
  if (field === 'goal') return goal.trim() || undefined;
  if (field === 'query') return goal.trim().slice(0, 40) || undefined;
  if (field === 'metrics') {
    const found = [...text.matchAll(/([\u4e00-\u9fa5A-Za-z]{2,12})\s*(?:目标|target)\s*(\d+(?:\.\d+)?)\s*(?:实际|actual)\s*(\d+(?:\.\d+)?)/gi)]
      .map((match) => ({ name: match[1], target: Number(match[2]), actual: Number(match[3]) }));
    if (found.length > 0) return found;
  }
  if (field === 'rows' || field === 'csv') {
    const csv = /\|?\s*[\u4e00-\u9fa5A-Za-z_]+\s*[,|]\s*\d+/m.test(materialText) ? materialText : '';
    if (csv) {
      const rows = parseCsv(csv.replace(/\|/g, ','));
      if (rows.length > 1) return field === 'csv' ? csv : rows;
    }
  }
  return undefined;
}

function businessQuestion(field) {
  const hints = {
    rows: '请提供要分析的数据表（CSV 或行列数据）',
    rightRows: '请提供用于对比的第二份数据表',
    csv: '请上传 CSV 数据',
    candidates: '请提供候选人清单及评分',
    quotes: '请提供各供应商的报价（单价、数量、实施费、年维护）',
    vendors: '请提供候选供应商及资料来源',
    samples: '请提供数据样本或现状说明',
    assets: '请提供资产清单',
    metrics: '请提供经营指标的目标值与实际值',
    claims: '请提供待核验的结论及其来源与证据',
    sources: '请提供来源清单（名称、链接、摘要）',
    tasks: '请提供任务清单',
    actions: '请提供行动清单',
    problems: '请提供问题清单',
    criteria: '请提供评估维度与权重',
    material: '请上传或粘贴业务资料',
    text: '请提供正文内容',
    resumeText: '请上传或粘贴简历文本',
    customer: '请说明客户名称',
    role: '请说明岗位名称',
    project: '请说明项目名称',
    goal: '请说明要达成的目标',
    query: '请说明检索主题',
  };
  return hints[field] ?? `请提供「${field}」所需资料`;
}

export async function createWorkspace({
  dataDir, assetsDir, catalog, contextProvider = () => null, settings = {},
  access: accessOptions = {}, model = null, now = nowIso,
} = {}) {
  if (!dataDir) fail(CODES.INVALID_INPUT, 'createWorkspace 需要 dataDir');
  if (!catalog?.experts || !catalog?.skills || !catalog?.workflows) {
    fail(CODES.INVALID_INPUT, 'createWorkspace 需要完整 catalog');
  }
  await mkdir(path.join(dataDir, 'artifacts'), { recursive: true });
  const store = await createStore({ dataDir, now });
  const filesModule = await import('./files.js');
  const knowledge = createKnowledge({ store, files: filesModule, dataDir, now });
  const tasks = createTasks({ store, now });
  const executors = createExecutors();
  const skills = createSkillRegistry({ store, dataDir, builtinDir: path.join(assetsDir, 'skills'), executors, now });
  const accessPolicy = createAccessPolicy(accessOptions);

  /**
   * Idempotency: every submission arrives with a client-generated
   * idempotencyKey that identifies one attempt. Concurrent requests sharing a
   * key await the same task instead of creating duplicates. The map holds the
   * pending creation promise so two requests that arrive before the task is
   * persisted collapse into one.
   */
  const inFlightSubmissions = new Map();

  async function deliver({ format, filename, content, taskId = null, workspaceId, grants = [] }) {
    const actor = currentActor();
    const scope = assertOwner({ workspaceId: workspaceId ?? actor.workspaceId }, 'write').workspaceId ?? actor.workspaceId;
    const auth = diagnostics.authorize('files.write', { granted: [...actor.grants, ...grants] });
    if (!auth.granted) fail(CODES.PERMISSION_DENIED, `成果写入被拒绝：${auth.reason}`);
    const safeName = `${slug(filename ?? content.title ?? 'artifact')}.${format}`;
    const directory = path.join(dataDir, 'artifacts', slug(scope));
    await mkdir(directory, { recursive: true });
    const targetPath = path.join(directory, `${now().replace(/[:.]/g, '-')}-${newId('v').slice(-5)}-${safeName}`);
    const generated = await generateDocument({ format, targetPath, content, generatedAt: now() });
    const artifact = {
      id: generated.sha256.slice(0, 16), path: generated.path, format, verified: generated.verified,
      bytes: generated.bytes, sha256: generated.sha256, taskId, workspaceId: scope,
      filename: safeName, contentHash: sha256(contentToText(content)), version: 1,
      createdAt: now(), source: { kind: 'task', taskId },
    };
    await store.upsert('artifacts', artifact);
    if (taskId) await tasks.addResult(taskId, { kind: 'artifact', artifactId: artifact.id, path: artifact.path, format, verified: artifact.verified });
    await diagnostics.log({ action: 'files.write', status: 'ok', taskId, sources: [artifact.filename] });
    return artifact;
  }

  const workflows = createWorkflows({
    store, tasks, skills, definitions: catalog.workflows, now,
    baseContext: { services: { knowledge, tasks, skills, store, files: filesModule }, deliver: (options) => deliver(options) },
  });
  const experts = createExperts({ definitions: catalog.experts, skills, knowledge, workflows, tasks });
  const connectors = createConnectors({ store, getContext: contextProvider, now });
  const diagnostics = createDiagnostics({ dataDir, settings, now });

  function makeContext({ taskId, workspaceId }) {
    const actor = currentActor();
    return {
      services: { knowledge, tasks, skills, workflows, experts, connectors, diagnostics, files: filesModule, store },
      workspaceId: actor.workspaceId,
      taskId,
      grants: actor.grants,
      model: model?.available ? model : null,
      deliver: (options) => deliver({ ...options, taskId: options.taskId ?? taskId, workspaceId: options.workspaceId ?? workspaceId ?? actor.workspaceId }),
    };
  }

  function skillCatalog() {
    return new Map(catalog.skills.map((item) => [item.name, item]));
  }

  /** Deterministic goal understanding; a model, when available, refines the choice. */
  async function selectCapability({ goal, expertId, skillName, workflowId, model }) {
    if (workflowId) return { kind: 'flow', id: workflowId, reasoning: '用户指定业务流程' };
    if (skillName) return { kind: 'skill', id: skillName, reasoning: '用户指定技能' };
    const expert = catalog.experts.find((item) => item.id === expertId);
    if (!expert) fail(CODES.NOT_FOUND, `专家 ${expertId} 不存在`, { expertId });
    const byName = skillCatalog();
    const goalTokens = new Set(tokenize(goal));
    const scored = expert.skills.map((name) => {
      const skill = byName.get(name);
      const text = `${name} ${skill?.description ?? ''} ${skill?.whenToUse ?? ''}`;
      let score = 0;
      for (const token of new Set(tokenize(text))) if (goalTokens.has(token)) score += 1;
      return { name, score };
    }).sort((a, b) => b.score - a.score);
    let chosen = scored[0]?.name ?? expert.skills[0];
    let reasoning = `按目标「${goal}」与专家「${expert.name}」的能力匹配，选择技能 ${chosen}`;
    if (model?.available && typeof model.complete === 'function') {
      try {
        const answer = await model.complete({
          system: '你是能力路由器。只输出一个 JSON 对象：{"skill":"<技能名>","reason":"<一句话>","flow":null}。不要输出其它文字。',
          prompt: `专家：${expert.name}\n可用技能：${expert.skills.join(', ')}\n可用流程：${catalog.workflows.filter((f) => f.expertId === expertId).map((f) => f.id).join(', ')}\n用户目标：${goal}`,
          maxTokens: 200,
        });
        const parsed = JSON.parse(answer.replace(/^```(?:json)?|```$/g, '').trim());
        if (expert.skills.includes(parsed.skill)) { chosen = parsed.skill; reasoning = `模型路由：${parsed.reason ?? '按目标匹配'}`; }
        if (parsed.flow && catalog.workflows.some((f) => f.id === parsed.flow)) return { kind: 'flow', id: parsed.flow, reasoning: `模型选择流程：${parsed.reason ?? ''}` };
      } catch { /* deterministic choice remains authoritative */ }
    }
    return { kind: 'skill', id: chosen, reasoning };
  }

  /** Uploaded files are stored and parsed by the Host; the browser only sends uploadId. */
  async function resolveUpload(upload) {
    const inline = String(upload.text ?? '');
    if (inline.trim()) return { name: upload.name, text: inline };
    const uploadId = String(upload.uploadId ?? '');
    if (!uploadId) return { name: upload.name, text: '' };
    const record = await store.find('uploads', uploadId);
    if (!record?.path) return { name: upload.name ?? record?.name, text: '' };
    const parsed = await filesModule.readDocument(record.path).catch(() => ({ text: '' }));
    return { name: upload.name ?? record.name, text: String(parsed.text ?? ''), path: record.path };
  }

  /** Merge task inputs, request inputs, uploaded material, and deterministic extraction. */
  async function collectInputs({ skill, goal, input, task, uploads }) {
    const actor = currentActor();
    const merged = { ...(task?.inputs ?? {}), ...clone(input ?? {}) };
    const resolved = [];
    for (const upload of uploads ?? []) {
      const item = await resolveUpload(upload);
      if (!item.name || !item.text.trim()) continue;
      resolved.push(item);
      await knowledge.importText({
        workspaceId: actor.workspaceId, title: item.name, text: item.text,
        domain: 'uploaded', trust: 'unverified', source: { kind: 'upload', name: item.name },
      });
    }
    const materialText = resolved.map((item) => item.text).filter(Boolean).join('\n\n');
    for (const field of skill.inputs ?? []) {
      if (merged[field.name] !== undefined && merged[field.name] !== null && merged[field.name] !== '') continue;
      // File-reading capabilities take the parsed upload's stored path directly.
      if (field.name === 'path' && resolved[0]?.path) { merged.path = resolved[0].path; continue; }
      const extracted = fieldFromText(field.name, String(goal ?? ''), materialText);
      if (extracted !== undefined) merged[field.name] = extracted;
      else if (TEXT_FIELDS.has(field.name)) {
        const fallback = `${String(goal ?? '').trim()}${materialText ? `\n\n${materialText}` : ''}`.trim();
        if (fallback) merged[field.name] = fallback;
      }
    }
    const missing = (skill.inputs ?? []).filter((field) => field.required &&
      (merged[field.name] === undefined || merged[field.name] === null || merged[field.name] === ''))
      .map((field) => ({ name: field.name, hint: businessQuestion(field.name), type: field.type }));
    return { merged, missing, materialText };
  }

  async function maybeAnalyze({ expertId, goal, input, outcome }) {
    if (!model?.available || typeof model.complete !== 'function') {
      return { available: false, reason: 'DSH 模型服务未接入或缺少凭据，本次成果为程序化结构化处理，未冒充模型分析', text: null };
    }
    const facts = (outcome.result?.evidence?.facts ?? []).map((item) => item.statement).slice(0, 20);
    const unknowns = (outcome.result?.evidence?.unknowns ?? []).map((item) => item.statement).slice(0, 20);
    const citations = (outcome.citations ?? []).map((item) => `${item.title} / ${item.section}：${item.quote}`).slice(0, 10);
    const prompt = [
      `专家领域：${expertId}`, `业务目标：${goal}`,
      `已确认事实：\n${facts.join('\n') || '（无）'}`,
      `可回溯依据：\n${citations.join('\n') || '（无）'}`,
      `待核实项：\n${unknowns.join('\n') || '（无）'}`,
      `程序化结果：${JSON.stringify(outcome.result?.structured ?? {}).slice(0, 1200)}`,
      `输入资料：${JSON.stringify(input).slice(0, 1200)}`,
      '',
      '请做真正的专业分析，输出中文 Markdown，严格按以下五个二级标题分节，并明确区分信息性质：',
      '## 结论与判断（专业建议）',
      '## 依据与推理（引用上述可回溯依据与已确认事实，注明哪些是计算结果）',
      '## 适用条件与风险',
      '## 建议动作（由用户决定是否采纳）',
      '## 仍需确认（待核实信息，不得猜测）',
      '不得把未提供的事实写成事实，不得复述输入或输出空泛套话；每个判断都要说明依据。',
    ].join('\n\n');
    try {
      const text = await model.complete({ system: '你是严谨的企业业务专家。区分事实、推断与建议；对缺失信息明确说明。', prompt, maxTokens: 6000 });
      if (!String(text).trim()) return { available: false, reason: '模型未返回分析正文', text: null };
      return { available: true, text: String(text).trim(), modelCalls: 1 };
    } catch (error) {
      return { available: false, reason: `模型调用失败：${error.message}`, text: null };
    }
  }

  /** Entities that were compared, and whether each is in the comparable set. */
  function collectEntities(structured) {
    const list = [];
    for (const item of structured.calculated ?? []) {
      if (item.vendor != null) list.push({ name: String(item.vendor), comparable: true });
    }
    for (const item of structured.ranked ?? []) {
      if (item.name != null) list.push({ name: String(item.name), comparable: item.weightedScore !== null && item.weightedScore !== undefined });
    }
    return list.filter((item) => item.name);
  }

  /** A comparison is fully decisive only when the structured result says so. */
  function isFullyComparable(structured) {
    if (structured.comparable === true && !structured.needsConfirmation) return true;
    if (structured.comparableAcrossCandidates === true && !structured.needsMappingConfirmation) return true;
    return false;
  }

  /** The programmatic winner, or null when the comparison is not decisive. */
  function computedWinner(structured) {
    const cheapest = [...(structured.calculated ?? [])].filter((item) => item.tco != null).sort((a, b) => Number(a.tco) - Number(b.tco))[0];
    if (cheapest) return String(cheapest.vendor ?? '');
    const top = [...(structured.ranked ?? [])].sort((a, b) => (Number(b.weightedScore ?? -Infinity)) - (Number(a.weightedScore ?? -Infinity)))[0];
    if (top && top.weightedScore != null) return String(top.name ?? '');
    return null;
  }

  /**
   * Check the model analysis against the programmatic comparison.
   *
   * Returns null, or an issue of type:
   *  - 'conflict': the comparison is decisive and the model names a different
   *    overall winner (a genuine contradiction).
   *  - 'review': the comparison is NOT decisive (basis differs, fields
   *    unmapped, coverage differs) yet the model still hands down an
   *    unconditional overall ranking / lowest-cost pick / recruitment
   *    recommendation. Such a result must not be marked completed.
   *
   * Scoped comparisons ("在专业能力维度上…", "若口径一致") and negations
   * ("未给出", "无法比较", "数据不足") are allowed and never flagged. The check
   * combines the structured comparison scope with the conclusion type and the
   * evidence in the sentence, not just a keyword.
   */
  function checkModelConclusion(analysisText, structured) {
    if (!analysisText || !structured) return null;
    const entities = collectEntities(structured);
    if (!entities.length) return null;
    const fullyComparable = isFullyComparable(structured);
    const winner = computedWinner(structured);
    const sentences = String(analysisText).split(/[。！？\n]/).map((item) => item.trim()).filter(Boolean);
    const recommendVerbs = /(建议选择|推荐选择|推荐|应当选择|应该选择|最优|最划算|综合最优|成本最低|总价最低|最低价|最低成本|首选|胜出|排名第一|总排名第一|最终胜出|建议录用|建议采用|领先|优于)/;
    // A scope qualifier makes a comparison conditional / partial → allowed.
    const scopePattern = /(在[^，。；：、]{0,14}(维度|方面|上|范围|条件|前提|口径)[^，。；：、]{0,10}(上|时|下|内)?|若|如果|假设|仅(当|在)?|局部|口径一致|就[^，。；：、]{0,14}而言|条件下|前提下|不能简单|无法简单|不应简单|暂(不|未)|尚不|仅按)/;
    // A negation means the sentence does not actually recommend.
    const negatePattern = /(不|未|无法|没有|不能|不应|不建议|不足以|尚不足以|暂(不|未)|并未|难以|不宜|勿)/;
    for (const sentence of sentences) {
      const names = entities.filter((item) => sentence.includes(item.name)).map((item) => item.name);
      if (!names.length) continue;
      if (!recommendVerbs.test(sentence)) continue;
      if (negatePattern.test(sentence)) continue;
      const scoped = scopePattern.test(sentence);
      for (const name of names) {
        if (fullyComparable) {
          if (name !== winner) {
            return {
              type: 'conflict',
              message: `程序计算与模型分析结论不一致：计算口径下是「${winner}」，分析文本把「${name}」作为最终选择。请核对口径后再采用结论。`,
              computed: winner, reported: name,
            };
          }
        } else if (!scoped) {
          return {
            type: 'review',
            message: `当前口径不一致 / 字段未对应 / 覆盖范围不同，本不应给出无条件的总体优选或排名；但分析文本把「${name}」作为整体结论。请先确认口径与字段对应，再采用结论。`,
            computed: null, reported: name,
          };
        }
      }
    }
    return null;
  }

  /** One final deliverable: conclusion + tables + analysis + basis + next steps. */
  function buildFinalContent({ goal, task, outcome, analysis, conflict }) {
    const result = outcome.result ?? {};
    const evidence = outcome.evidence ?? {};
    const sections = [];
    sections.push({
      heading: '结论',
      paragraphs: [String(result.message ?? outcome.message ?? '本次未生成结论。')],
    });
    if (analysis?.available && analysis.text) {
      sections.push({ heading: '专业分析', paragraphs: String(analysis.text).split(/\n\n+/) });
    }
    if ((evidence.facts ?? []).length > 0) {
      sections.push({ heading: '依据与已确认事实', bullets: evidence.facts.map((item) => String(item.statement)) });
    }
    if ((evidence.unknowns ?? []).length > 0) {
      sections.push({ heading: '待确认', bullets: evidence.unknowns.map((item) => String(item.statement)) });
    }
    if ((evidence.recommendations ?? []).length > 0) {
      sections.push({ heading: '建议动作（由你决定）', bullets: evidence.recommendations.map((item) => String(item.statement)) });
    }
    if (conflict) sections.push({ heading: '需要核查', paragraphs: [conflict.message] });
    sections.push({
      heading: '下一步',
      bullets: ['确认结论与依据是否满足决策需要', '需要补充资料时，回到任务继续补充', '确认后可把结论保存到知识库供后续复用'],
    });
    return {
      title: String(goal ?? task?.goal ?? '工作成果').slice(0, 80),
      subtitle: `最终成果 · ${task?.id ?? ''}`,
      sections,
      tables: result.content?.tables ?? [],
      citations: outcome.citations ?? [],
    };
  }

  function summarize(outcome, analysis) {
    if (!outcome) return '尚未执行任何能力';
    const facts = (outcome.result?.evidence?.facts ?? []).length;
    const unknowns = (outcome.result?.evidence?.unknowns ?? []).length;
    const artifacts = (outcome.artifacts ?? []).length;
    const citations = (outcome.citations ?? []).length;
    const parts = [outcome.message ?? ''];
    const bits = [];
    if (facts > 0) bits.push(`${facts} 项依据`);
    if (unknowns > 0) bits.push(`${unknowns} 项待确认`);
    if (artifacts > 0) bits.push(`${artifacts} 份成果文件`);
    if (citations > 0) bits.push(`${citations} 处来源`);
    if (bits.length > 0) parts.push(`共 ${bits.join('、')}。`);
    if (analysis?.available) parts.push(`另有专家分析正文 ${analysis.text.length} 字，可在结果中展开阅读。`);
    else parts.push('本次未生成模型分析正文：' + (analysis?.reason ?? '未接入模型'));
    return parts.filter(Boolean).join(' ');
  }

  /**
   * Unified goal entry. A plain natural-language goal selects and EXECUTES a
   * capability; it never returns success after routing/planning only.
   */
  async function dispatch({
    goal, expertId, skillName, workflowId, input = {}, uploads = [], workspaceId, taskId,
    outputForm, format, filename, autoReview = true, answers, idempotencyKey,
  } = {}) {
    const started = Date.now();
    const actor = currentActor();
    let routing;
    let lastSkill = null;
    if (taskId && !goal && !expertId) {
      const existing = await tasks.load(taskId, 'write');
      routing = { status: 'continued', selected: { id: existing.expertId, name: existing.expertId ? experts.get(existing.expertId).name : null }, reasoning: '继续已有任务', missing: [], candidates: [] };
      goal = existing.goal;
      // Continuing a task must reuse the capability that produced its earlier
      // results; re-routing by goal could silently switch to another skill.
      lastSkill = [...(existing.results ?? [])].reverse().find((item) => item.kind === 'skill')?.skill ?? null;
    } else if (expertId && !goal) {
      routing = { status: 'routed', selected: { id: expertId, name: experts.get(expertId).name }, reasoning: '用户直接选择专家', missing: [], candidates: [] };
    } else {
      routing = experts.route({ goal, workspaceId: actor.workspaceId, expertId, outputPreference: outputForm });
    }
    if (routing.status === 'needs_clarification') {
      return { ok: false, stage: 'planned', routing, task: null, outcome: null, review: null,
        questions: routing.message, missing: routing.requiredInputs, summary: '目标不足以判断专家；请补充业务目标或选择专家。' };
    }
    const selectedId = routing.selected?.id ?? null;
    let task;
    if (taskId) {
      task = await tasks.load(taskId, 'write');
      if (selectedId && task.expertId !== selectedId) task = await tasks.switchExpert(task.id, selectedId, { reason: '用户纠正专家选择' });
    } else {
      const key = idempotencyKey ? String(idempotencyKey) : null;
      // Idempotency scope (also documented in docs/ACCEPTANCE.md):
      //  - The in-flight map below protects CONCURRENT arrivals inside this
      //    process only. Its key always includes the trusted workspace, so two
      //    workspaces sharing a client key never interfere.
      //  - After a restart (or for requests that arrive later), the persisted
      //    task is found by workspace + idempotencyKey, so retries keep
      //    returning the same task without re-executing.
      //  - A submission is additionally fingerprinted (goal, capability,
      //    inputs, material, output requirements) with key-order-independent
      //    serialisation. Same key + same fingerprint → same task; same key +
      //    different fingerprint → an explicit conflict instead of silently
      //    reusing the earlier result.
      const fingerprint = sha256(stableStringify({
        goal: goal ?? null, expertId: selectedId ?? null, skillName: skillName ?? null, workflowId: workflowId ?? null,
        input: input ?? null,
        ...(answers !== undefined ? { answers } : {}),
        uploads: (uploads ?? []).map((item) => ({
          name: item.name ?? null, uploadId: item.uploadId ?? null,
          ...(String(item.text ?? '').trim() ? { textHash: sha256(String(item.text)) } : {}),
        })),
        format: format ?? null, outputForm: outputForm ?? null, filename: filename ?? null,
      }));
      const mapKey = `${actor.workspaceId}::${key ?? ''}`;
      if (key) {
        // Both persisted retries and concurrent arrivals must use the same
        // content check. An equal key alone never authorises reusing results.
        const conflictFor = async (candidate) => {
          if (!candidate.fingerprint || candidate.fingerprint === fingerprint) return null;
          const message = '同一个提交标识被用于不同的内容（目标、资料或输出要求不一致）。请更新原任务，或另起一件新工作；本次未复用旧结果。';
          await diagnostics.log({ action: 'dispatch', status: 'conflict', taskId: candidate.id, message });
          return {
            ok: false, stage: 'conflict', routing: { status: 'conflict', selected: { id: candidate.expertId, name: candidate.expertId ? experts.get(candidate.expertId).name : null }, reasoning: message, missing: [], candidates: [] },
            task: await tasks.load(candidate.id, 'read'), capability: null, plan: null, outcome: null, review: null,
            summary: message, failureReasons: [message], conflict: { kind: 'idempotency_fingerprint', taskId: candidate.id },
            resultRef: { taskId: candidate.id, endpoint: '/eew/result' },
          };
        };
        const prior = (await tasks.list({ includeArchived: false }))
          .filter((item) => item.idempotencyKey === key && item.workspaceId === actor.workspaceId)
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
        if (prior) {
          const conflict = await conflictFor(prior);
          if (conflict) return conflict;
          const fresh = await tasks.load(prior.id, 'read');
          return {
            ok: fresh.status === 'completed', stage: fresh.status === 'completed' ? 'completed' : (['running', 'waiting_input', 'waiting_confirmation'].includes(fresh.status) ? fresh.status : 'continued'),
            routing: { status: 'continued', selected: { id: fresh.expertId, name: fresh.expertId ? experts.get(fresh.expertId).name : null }, reasoning: '同一次提交的重复请求，已返回原任务', missing: [], candidates: [] },
            task: fresh, capability: { id: fresh.expertId, kind: 'skill' }, plan: null, outcome: null, review: null,
            summary: '这是同一次提交的重复请求，已返回原任务，没有重复执行。',
            duplicateOf: fresh.id, resultRef: { taskId: fresh.id, endpoint: '/eew/result' },
          };
        }
        let collapsed = null;
        const existing = inFlightSubmissions.get(mapKey);
        if (existing) {
          // The twin awaits the very record the first request stored. If that
          // creation failed, starting fresh is safe (nothing was persisted).
          try { collapsed = await tasks.load(await existing.promise, 'read'); } catch { collapsed = null; }
        }
        if (collapsed) {
          const conflict = await conflictFor(collapsed);
          if (conflict) return conflict;
          return {
            ok: collapsed.status === 'completed', stage: collapsed.status === 'completed' ? 'completed' : 'continued',
            routing: { status: 'continued', selected: { id: collapsed.expertId, name: collapsed.expertId ? experts.get(collapsed.expertId).name : null }, reasoning: '并发的同一请求已合并到原任务', missing: [], candidates: [] },
            task: collapsed, capability: { id: collapsed.expertId, kind: 'skill' }, plan: null, outcome: null, review: null,
            summary: '并发到达的重复请求已合并到同一任务，没有重复执行。',
            duplicateOf: collapsed.id, resultRef: { taskId: collapsed.id, endpoint: '/eew/result' },
          };
        }
        // Mark this attempt as in-flight BEFORE creating, so a concurrent twin
        // collides on the record rather than on a second task. The record is
        // the single source of identity for both saving and cleanup, so an
        // earlier request's cleanup can never delete a later replacement.
        if (inFlightSubmissions.size >= 500) {
          for (const [staleKey, staleRecord] of inFlightSubmissions) {
            if (staleRecord.settled) inFlightSubmissions.delete(staleKey);
            if (inFlightSubmissions.size < 400) break;
          }
        }
        const record = { settled: false, promise: null };
        const creating = tasks.create({
          workspaceId: actor.workspaceId, goal: goal ?? `由专家 ${selectedId} 发起`, expertId: selectedId,
          inputs: input, outputForm: outputForm ?? 'markdown', idempotencyKey: key, fingerprint,
        });
        record.promise = creating.then((item) => item.id);
        inFlightSubmissions.set(mapKey, record);
        try {
          task = await creating;
          record.settled = true;
        } catch (error) {
          // A failed creation must never stay in the map: the next attempt with
          // this key has to be able to start over.
          record.settled = true;
          if (inFlightSubmissions.get(mapKey) === record) inFlightSubmissions.delete(mapKey);
          throw error;
        } finally {
          if (inFlightSubmissions.get(mapKey) === record) inFlightSubmissions.delete(mapKey);
        }
      } else {
        // No key supplied: still guard against orphaned tasks left by a dead
        // process, but only by age — never by collapsing distinct goals.
        task = await tasks.create({ workspaceId: actor.workspaceId, goal: goal ?? `由专家 ${selectedId} 发起`, expertId: selectedId, inputs: input, outputForm: outputForm ?? 'markdown' });
      }
      // Recover orphaned running/draft tasks left by a process that died. A
      // fixed age alone never declares a live task dead: the owner process id
      // is checked first, so a task whose process still runs keeps running.
      if (task.status === 'draft') {
        const orphans = (await tasks.list({ includeArchived: false }))
          .filter((item) => ['running', 'draft'].includes(item.status) && item.id !== task.id && item.workspaceId === actor.workspaceId)
          .filter((item) => Date.now() - Date.parse(String(item.updatedAt ?? '')) > STALE_RUNNING_MS)
          .filter((item) => !(item.runtime?.pid && pidAlive(item.runtime.pid)));
        for (const orphan of orphans) {
          const stopped = await tasks.load(orphan.id, 'write').catch(() => null);
          if (stopped && ['running', 'draft'].includes(stopped.status)) {
            await tasks.update(stopped.id, {
              status: 'failed',
              errors: [...(stopped.errors ?? []), { code: 'process_ended', message: '上一次处理没有正常结束，已保留已有资料，可以重新开始' }],
            }).catch(() => null);
          }
        }
      }
    }

    const capability = await selectCapability({ goal: goal ?? task.goal, expertId: selectedId ?? task.expertId, skillName: skillName ?? lastSkill, workflowId, model });
    const plan = selectedId ? await experts.plan(selectedId, { goal, task }) : null;

    if (capability.kind === 'flow') {
      const flowInput = { ...(task.inputs ?? {}), ...clone(input), ...clone(answers ?? {}) };
      const run = await workflows.start({ flowId: capability.id, taskId: task.id, workspaceId: actor.workspaceId, input: flowInput });
      const stage = run.status === 'completed' ? 'completed' : (run.status === 'failed' ? 'failed' : 'waiting_input');
      task = await tasks.update(task.id, { status: stage === 'completed' ? 'completed' : (stage === 'failed' ? 'failed' : 'running') }, task.revision);
      return {
        ok: stage === 'completed', stage, routing, task, capability, plan,
        workflowRun: { id: run.id, status: run.status, pendingNode: run.pendingNode ?? null, missing: run.missing ?? [] },
        outcome: null, review: null,
        summary: stage === 'completed' ? `流程 ${capability.id} 已执行完成，共 ${Object.keys(run.nodeResults ?? {}).length} 个节点。` : `流程 ${capability.id} 停在 ${run.status}，未完成，不计为成功。`,
        resultRef: { taskId: task.id, endpoint: '/eew/result' },
      };
    }

    const skill = await skills.get(capability.id);
    if (!skill) fail(CODES.NOT_FOUND, `技能 ${capability.id} 不存在`, { skill: capability.id });
    const { merged, missing } = await collectInputs({ skill, goal: goal ?? task.goal, input: { ...input, ...(answers ?? {}) }, task, uploads });
    if (missing.length > 0) {
      const questions = `为了完成「${goal ?? task.goal}」，还需要：${missing.map((item) => item.hint).join('；')}。任务已保存，补充后可继续处理。`;
      task = await tasks.update(task.id, { inputs: merged, status: 'waiting_input' }, task.revision);
      await tasks.recordError(task.id, {
        code: 'waiting_input', message: questions, retryable: true,
        missing: missing.map((item) => ({ name: item.name, hint: item.hint, required: Boolean(item.required) })),
      });
      await diagnostics.log({ action: 'dispatch', status: 'waiting_input', taskId: task.id, message: questions });
      return {
        ok: false, stage: 'waiting_input', routing, task, capability, plan,
        outcome: null, review: null, questions, missing,
        summary: questions, resultRef: { taskId: task.id, endpoint: '/eew/result' },
      };
    }
    // A live owner process id lets orphan recovery tell "still working" from
    // "process died"; refreshed after the capability and the model call.
    const runtime = { pid: process.pid, startedAt: now(), heartbeatAt: now() };
    task = await tasks.update(task.id, { inputs: merged, status: 'running', runtime }, task.revision);
    const beat = () => tasks.update(task.id, { runtime: { ...runtime, heartbeatAt: now() } }).catch(() => null);

    const effectiveInput = { ...merged, workspaceId: actor.workspaceId, format: format ?? input.format, filename };
    const context = makeContext({ taskId: task.id, workspaceId: actor.workspaceId });
    let outcome;
    try {
      outcome = await skills.run(capability.id, effectiveInput, context);
      await beat();
    } catch (error) {
      // A capability crash is reported as an unfinished task, never as HTTP 500:
      // the user keeps the task, the inputs and a retry path.
      const message = `处理没有完成：${error.message}`;
      const failed = await tasks.load(task.id, 'write');
      await tasks.recordError(task.id, { code: 'failed', message, retryable: true });
      task = await tasks.update(task.id, { inputs: merged, status: 'failed' }, failed.revision);
      await diagnostics.log({ action: 'dispatch', status: 'failed', taskId: task.id, code: error.code ?? 'internal_error', message });
      return {
        ok: false, stage: 'failed', routing, task, capability, plan,
        outcome: null, review: null, summary: message, failureReasons: [message],
        resultRef: { taskId: task.id, endpoint: '/eew/result' },
      };
    }

    let analysis = null;
    let conflict = null;
    let modelReview = null;
    if (outcome.ok) {
      analysis = await maybeAnalyze({ expertId: selectedId ?? task.expertId, goal: goal ?? task.goal, input: merged, outcome });
      await beat();
      if (analysis.available) {
        outcome.result = { ...outcome.result, analysis: analysis.text, analysisSource: 'dsh-llm' };
        const issue = checkModelConclusion(analysis.text, outcome.result?.structured ?? {});
        if (issue?.type === 'conflict') conflict = issue;
        else if (issue?.type === 'review') modelReview = issue;
      }
      // One final deliverable for the user; the earlier structured file stays
      // as an additional ("更多文件") source of detail.
      const finalContent = buildFinalContent({ goal: goal ?? task.goal, task, outcome, analysis, conflict: conflict || modelReview });
      const structuredArtifacts = (outcome.artifacts ?? []).map((item) => ({ ...item, role: 'detail' }));
      try {
        const primary = await deliver({
          format: format ?? 'md',
          filename: filename ? `最终成果-${filename}` : undefined,
          content: finalContent,
          taskId: task.id,
          workspaceId: actor.workspaceId,
        });
        outcome.artifacts = [...structuredArtifacts, { ...primary, role: 'primary' }];
      } catch (error) {
        outcome.artifacts = structuredArtifacts;
        if (analysis?.available) analysis = { available: false, reason: `最终成果写入失败：${error.message}`, text: analysis.text };
      }
    }

    const review = autoReview && (selectedId ?? task.expertId) && outcome.ok
      ? await experts.review(selectedId ?? task.expertId, { result: outcome.result ?? outcome, task })
      : null;
    const artifactsVerified = (outcome.artifacts ?? []).every((item) => item.verified === true);
    const requestedFormat = Boolean(format ?? input.format);
    const workVerified = outcome.ok && artifactsVerified && (!requestedFormat || (outcome.artifacts ?? []).length > 0);
    const qualityPassed = !autoReview || (review?.passed === true);
    const completed = workVerified && qualityPassed;
    // Amounts may be fully computed while key comparison bases are still
    // unconfirmed: the task is then "waiting_confirmation", never "completed".
    const basisPending = outcome.ok
      && Array.isArray(outcome.result?.structured?.basisPending)
      && outcome.result.structured.basisPending.length > 0
      && outcome.result.structured.comparable !== true;

    let stage;
    if (!outcome.ok) stage = outcome.status === 'needs_input' ? 'waiting_input' : 'failed';
    else if (basisPending) stage = 'needs_confirmation';
    else if (conflict) stage = 'failed';
    else if (modelReview) stage = 'failed';
    else if (!workVerified) stage = 'failed';
    else if (!qualityPassed) stage = 'failed';
    else stage = 'completed';

    const failureReasons = [];
    if (!outcome.ok) failureReasons.push(outcome.message ?? '技能执行失败');
    if (outcome.ok && conflict) failureReasons.push(conflict.message);
    if (outcome.ok && modelReview) failureReasons.push(modelReview.message);
    if (outcome.ok && !artifactsVerified) failureReasons.push('成果文件未通过回读校验');
    if (outcome.ok && requestedFormat && (outcome.artifacts ?? []).length === 0) failureReasons.push('请求了成果格式但未生成文件');
    if (outcome.ok && !qualityPassed) failureReasons.push('质量检查未通过：' + (review?.verdict ?? '未知'));

    for (const citation of outcome.citations ?? []) await tasks.addCitation(task.id, citation);
    await tasks.addResult(task.id, {
      kind: 'skill', skill: capability.id, stage, result: outcome.result ?? {},
      evidence: outcome.evidence ?? {}, citations: outcome.citations ?? [],
      artifacts: outcome.artifacts ?? [], analysis: analysis?.text ?? null,
      summary: summarize(outcome, analysis), failureReasons,
    });
    if (failureReasons.length > 0) await tasks.recordError(task.id, { code: stage, message: failureReasons.join('；'), retryable: ['waiting_input', 'needs_confirmation'].includes(stage) });
    const refreshed = await tasks.load(task.id, 'write');
    task = await tasks.update(task.id, {
      status: { completed: 'completed', waiting_input: 'waiting_input', needs_confirmation: 'waiting_confirmation', failed: 'failed' }[stage] ?? 'running',
      evidence: outcome.evidence ?? refreshed.evidence,
    }, refreshed.revision);

    await diagnostics.log({
      action: 'dispatch', status: stage === 'completed' ? 'ok' : stage, taskId: task.id,
      durationMs: Date.now() - started, code: stage === 'completed' ? null : stage,
      message: failureReasons[0] ?? outcome.message ?? null,
      sources: (outcome.citations ?? []).map((citation) => String(citation.docId ?? '')),
    });

    return {
      ok: stage === 'completed',
      stage,
      routing,
      task,
      capability,
      skill: { name: capability.id, ...(outcome.skill ?? {}) },
      outcome,
      review,
      analysis: analysis ? { available: analysis.available, reason: analysis.reason ?? null, length: analysis.text?.length ?? 0 } : null,
      plan,
      summary: stage === 'needs_confirmation'
        ? `金额计算完成，比较待确认：${(outcome.result?.structured?.basisPending ?? []).join('；')}。确认口径后可在原任务上给出同口径结论。`
        : summarize(outcome, analysis),
      failureReasons,
      conflicts: [conflict, modelReview].filter(Boolean),
      resultRef: { taskId: task.id, endpoint: '/eew/result', resultIndex: task.results.length - 1 },
      correction: '可再次调用并指定 expertId / goal / outputForm / format / answers 来纠正或继续',
    };
  }

  /** Read the full analysis body without truncating it in the tool response. */
  async function readResult({ taskId, index = -1, offset = 0, limit = 4000 }) {
    const task = await tasks.load(taskId, 'read');
    const results = task.results ?? [];
    const position = index < 0 ? results.length + index : Number(index);
    const result = results[position];
    if (!result) fail(CODES.NOT_FOUND, '结果不存在', { taskId, index });
    const full = JSON.stringify({ summary: result.summary, result: result.result, analysis: result.analysis, evidence: result.evidence, citations: result.citations, artifacts: result.artifacts }, null, 2);
    const safeOffset = Math.max(0, Number(offset) || 0);
    const safeLimit = Math.max(200, Math.min(20000, Number(limit) || 4000));
    return {
      taskId, index: position, totalLength: full.length, offset: safeOffset,
      chunk: full.slice(safeOffset, safeOffset + safeLimit),
      hasMore: safeOffset + safeLimit < full.length,
      nextOffset: safeOffset + safeLimit,
      endpoint: `/eew/result?id=${encodeURIComponent(taskId)}&index=${position}&offset=${safeOffset + safeLimit}`,
    };
  }

  async function getArtifact(id, action = 'read') {
    const artifact = await store.find('artifacts', id);
    if (!artifact) fail(CODES.NOT_FOUND, `成果 ${id} 不存在`, { id });
    assertOwner(artifact, action);
    return artifact;
  }

  async function state() {
    const actor = currentActor();
    const workspaceId = actor.workspaceId;
    return {
      workspaceId, dataDir,
      tasks: (await tasks.list()).length,
      archivedTasks: (await tasks.list({ includeArchived: true })).filter((task) => task.archived).length,
      knowledgeDocs: (await knowledge.list()).length,
      skills: (await skills.list()).length,
      artifacts: ownerFilter(await store.all('artifacts')).filter((item) => item.workspaceId === workspaceId).length,
      workflowRuns: ownerFilter(await store.all('workflow_runs')).length,
      formats: capabilityMatrix(),
      model: {
        available: Boolean(model?.available),
        reason: model?.reason ?? null,
        route: model?.stats?.route ?? null,
        providers: model?.stats?.providers ?? null,
        calls: model?.stats?.calls ?? 0,
        failures: model?.stats?.failures ?? 0,
        lastError: model?.lastError ?? null,
        attachedContexts: model?.attachedContexts ?? 0,
      },
      diagnostics: await diagnostics.summary(),
    };
  }

  async function exportState() {
    const actor = currentActor();
    const payload = await store.exportScoped(actor.workspaceId);
    return { filename: `eew-state-${actor.workspaceId}-${now().slice(0, 10)}.json`, content: JSON.stringify(payload, null, 2), scope: actor.workspaceId };
  }

  /** Separate, explicitly gated administrative operation — not an ordinary workspace export. */
  async function exportAllAdmin() {
    const actor = currentActor();
    if (!actor.isAdmin) fail(CODES.PERMISSION_DENIED, '全局备份是独立管理操作，需要管理权限');
    assertGranted('state.export.admin', actor);
    const payload = await store.exportAll();
    await diagnostics.log({ action: 'state.export.admin', status: 'ok', message: '全局备份（管理操作）' });
    return { filename: `eew-admin-backup-${now().slice(0, 10)}.json`, content: JSON.stringify(payload, null, 2), scope: 'all' };
  }

  async function verifyArtifactFile(artifact) {
    const info = await stat(artifact.path).catch(() => fail(CODES.NOT_FOUND, '成果文件不存在', { id: artifact.id }));
    if (info.size !== artifact.bytes) fail(CODES.VERIFICATION_FAILED, '成果文件大小与记录不一致', { id: artifact.id });
    const buffer = await readFile(artifact.path);
    if (sha256(buffer) !== artifact.sha256) fail(CODES.VERIFICATION_FAILED, '成果文件哈希校验失败', { id: artifact.id });
    return { ok: true, bytes: info.size, sha256: artifact.sha256 };
  }

  const api = {
    dataDir, store, knowledge, tasks, skills, workflows, experts, connectors, diagnostics,
    executors, files: filesModule, deliver, dispatch, state, exportState, exportAllAdmin,
    readResult, getArtifact, verifyArtifactFile, makeContext, accessPolicy,
    describeError: (error) => describeError(error),
  };

  /** Bind every service call (including nested ones) to a trusted actor. */
  function forActor(actor) {
    return new Proxy(api, {
      get(target, property) {
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args) => withActor(actor, () => value.apply(target, args));
      },
    });
  }

  api.forActor = forActor;
  api.withActor = withActor;
  return api;
}
