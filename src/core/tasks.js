import { CODES, fail } from './errors.js';
import { assertOwner, ownerFilter } from './access.js';
import { appendEvidence, clone, emptyEvidence, isRecord, newId, nowIso } from './util.js';

/** Business-object schemas. Each domain keeps its own fields; no forced sales action card. */
export const BUSINESS_SCHEMAS = Object.freeze({
  opportunity: { label: '商机', fields: ['customer', 'stage', 'stakeholders', 'needs', 'valueHypothesis', 'evidence', 'nextAction', 'risk'] },
  candidate_evaluation: { label: '招聘评估', fields: ['position', 'candidate', 'criteria', 'scores', 'evidence', 'interviewNotes', 'decisionOwner', 'openQuestions'] },
  research_project: { label: '研究项目', fields: ['question', 'scope', 'sources', 'verifiedFacts', 'analysis', 'opportunities', 'confidence'] },
  procurement_comparison: { label: '采购比较', fields: ['requirement', 'vendors', 'quotes', 'technicalScores', 'commercialScores', 'tco', 'risks', 'unknowns'] },
  onboarding_plan: { label: '入职培养计划', fields: ['role', 'owner', 'phases', 'trainingMaterials', 'checkpoints', 'knowledgeLinks'] },
  management_improvement: { label: '经营改进', fields: ['metrics', 'diagnosis', 'actions', 'owners', 'reviewDate', 'sourceTaskIds'] },
  data_governance: { label: '数据治理', fields: ['assets', 'catalog', 'standards', 'qualityRules', 'classification', 'roadmap', 'verifiedScope'] },
  work_plan: { label: '岗位工作计划', fields: ['objective', 'tasks', 'priorities', 'meetingActions', 'reviewCycle'] },
  knowledge_case: { label: '经验案例', fields: ['project', 'context', 'decisions', 'outcome', 'lessons', 'sop', 'reviewStatus'] },
  data_analysis: { label: '分析项目', fields: ['dataset', 'fields', 'cleaningLog', 'qualityIssues', 'metrics', 'charts', 'conclusion'] },
});

export const TASK_STATUSES = Object.freeze([
  'draft', 'running', 'waiting_input', 'waiting_external', 'waiting_confirmation', 'failed', 'completed', 'cancelled', 'archived',
]);

export function createTasks({ store, now = nowIso }) {
  async function create({ workspaceId = 'default', goal, expertId, inputs = {}, outputForm = 'markdown', businessType, parentTaskId, idempotencyKey, fingerprint, runtime } = {}) {
    if (typeof goal !== 'string' || goal.trim() === '') fail(CODES.MISSING_INPUT, '任务需要明确目标 goal', { field: 'goal' });
    assertOwner({ workspaceId }, 'write');
    const task = {
      id: newId('task'),
      workspaceId,
      goal: goal.trim(),
      expertId: expertId ?? null,
      inputs: clone(inputs),
      status: 'draft',
      steps: [],
      citations: [],
      results: [],
      errors: [],
      evidence: emptyEvidence(),
      outputForm,
      business: businessType ? { type: businessType, fields: {} } : null,
      parentTaskId: parentTaskId ?? null,
      idempotencyKey: idempotencyKey ?? null,
      fingerprint: fingerprint ?? null,
      runtime: runtime ?? null,
      createdAt: now(),
      updatedAt: now(),
      archived: false,
    };
    if (businessType && !BUSINESS_SCHEMAS[businessType]) {
      fail(CODES.INVALID_INPUT, `未知业务对象类型：${businessType}`, { supported: Object.keys(BUSINESS_SCHEMAS) });
    }
    return store.upsert('tasks', task);
  }

  async function load(id, action = 'read') {
    const task = await store.find('tasks', id);
    if (!task) fail(CODES.NOT_FOUND, `任务 ${id} 不存在`, { id, action });
    return assertOwner(task, action);
  }

  async function update(id, patch, expectedRevision) {
    const task = await load(id, 'write');
    const allowed = new Set(['goal', 'expertId', 'inputs', 'status', 'steps', 'citations', 'results', 'errors', 'evidence', 'outputForm', 'business', 'archived', 'outputPreference', 'fingerprint', 'runtime']);
    for (const key of Object.keys(patch ?? {})) {
      if (!allowed.has(key)) fail(CODES.INVALID_INPUT, `不允许直接修改字段 ${key}`);
    }
    if (patch.status && !TASK_STATUSES.includes(patch.status)) fail(CODES.INVALID_INPUT, `非法状态 ${patch.status}`);
    const next = { ...task, ...clone(patch), updatedAt: now() };
    return store.upsert('tasks', next, expectedRevision ?? task.revision);
  }

  async function append(id, key, value, expectedRevision) {
    const task = await load(id);
    if (!Array.isArray(task[key])) fail(CODES.INVALID_INPUT, `字段 ${key} 不是列表`);
    return update(id, { [key]: [...task[key], { ...clone(value), at: now() }] }, expectedRevision ?? task.revision);
  }

  async function addStep(id, { name, executor, expectedOutput }) {
    return append(id, 'steps', { id: newId('step'), name, executor: executor ?? null, status: 'pending', expectedOutput: expectedOutput ?? null });
  }

  async function completeStep(id, stepId, result) {
    const task = await load(id);
    const steps = task.steps.map((step) => step.id === stepId ? { ...step, status: 'completed', result: clone(result), completedAt: now() } : step);
    return update(id, { steps }, task.revision);
  }

  async function addCitation(id, citation) {
    if (!isRecord(citation)) fail(CODES.INVALID_INPUT, '引用必须是结构化对象');
    return append(id, 'citations', citation);
  }

  async function addResult(id, result) {
    return append(id, 'results', result);
  }

  async function recordError(id, error) {
    const entry = { code: error?.code ?? 'internal_error', message: error?.message ?? String(error), retryable: Boolean(error?.retryable) };
    // Waiting tasks remember which fields they still need, so the UI can show
    // the same questions when the task is reopened (no redundant re-run).
    if (Array.isArray(error?.missing) && error.missing.length > 0) entry.missing = clone(error.missing);
    return append(id, 'errors', entry);
  }

  async function addEvidence(id, key, statement) {
    const task = await load(id);
    const evidence = appendEvidence(clone(task.evidence), key, statement);
    return update(id, { evidence }, task.revision);
  }

  /** Switching expert never rebinds the task or its business records. */
  async function switchExpert(id, expertId, { reason } = {}) {
    const task = await load(id);
    return update(id, {
      expertId,
      evidence: appendEvidence(clone(task.evidence), 'userJudgements', `专家从 ${task.expertId ?? '未指定'} 切换为 ${expertId}${reason ? `（${reason}）` : ''}`),
    }, task.revision);
  }

  async function setBusiness(id, type, fields, expectedRevision) {
    const schema = BUSINESS_SCHEMAS[type];
    if (!schema) fail(CODES.INVALID_INPUT, `未知业务对象类型：${type}`, { supported: Object.keys(BUSINESS_SCHEMAS) });
    const task = await load(id);
    const current = task.business?.type === type ? task.business.fields : {};
    const unknownKeys = Object.keys(fields ?? {}).filter((key) => !schema.fields.includes(key));
    if (unknownKeys.length > 0) fail(CODES.INVALID_INPUT, `${type} 不接受字段：${unknownKeys.join(', ')}`, { allowed: schema.fields });
    return update(id, { business: { type, fields: { ...current, ...clone(fields) } } }, expectedRevision ?? task.revision);
  }

  async function list({ workspaceId, expertId, status, includeArchived = false } = {}) {
    const scoped = ownerFilter(await store.all('tasks'));
    return scoped.filter((task) =>
      (!workspaceId || task.workspaceId === workspaceId || task.workspaceId === 'shared') &&
      (!expertId || task.expertId === expertId) &&
      (!status || task.status === status) &&
      (includeArchived || !task.archived),
    ).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function archive(id) {
    return update(id, { archived: true, status: 'archived' });
  }

  async function exportTask(id) {
    const task = await load(id);
    return {
      filename: `${task.id}.task.json`,
      content: JSON.stringify({ exportedAt: now(), task }, null, 2),
    };
  }

  /** Structured handoff between experts: only the result envelope, never a long transcript. */
  async function handoff(fromTaskId, { toExpertId, goal, workspaceId, citations, conclusions }) {
    const source = await load(fromTaskId);
    const created = await create({
      workspaceId: workspaceId ?? source.workspaceId,
      goal,
      expertId: toExpertId,
      parentTaskId: fromTaskId,
      inputs: { handoffFrom: fromTaskId, conclusions: clone(conclusions ?? source.results.slice(-3)) },
      businessType: undefined,
    });
    const withCitations = await update(created.id, {
      citations: (citations ?? source.citations).map((citation) => ({ ...citation, inheritedFrom: fromTaskId, at: now() })),
      evidence: appendEvidence(emptyEvidence(), 'facts', `承接任务 ${fromTaskId} 的结构化结果`),
    }, created.revision);
    return withCitations;
  }

  return { create, load, update, append, addStep, completeStep, addCitation, addResult, recordError, addEvidence, switchExpert, setBusiness, list, archive, exportTask, handoff, BUSINESS_SCHEMAS };
}
