import { CODES, fail } from './errors.js';
import { assertOwner, ownerFilter } from './access.js';
import { clone, emptyEvidence, newId, nowIso } from './util.js';

/**
 * Durable workflow engine. A workflow is code + a JSON node graph, never an
 * arbitrary YAML file assumed to be executable. Every completed node is
 * persisted immediately, so a process restart resumes from stored state.
 *
 * States: running / waiting_input / waiting_external / waiting_confirmation /
 * interrupted / failed / cancelled / completed.
 */
export function createWorkflows({ store, tasks, skills, definitions = [], now = nowIso, baseContext = {} }) {
  const flows = new Map(definitions.map((flow) => [flow.id, flow]));

  async function ownedRun(runId, action = 'write') {
    const run = await store.find('workflow_runs', runId);
    if (!run) fail(CODES.NOT_FOUND, `工作流运行 ${runId} 不存在`, { runId });
    return assertOwner(run, action);
  }

  function flowOf(id) {
    const flow = flows.get(id);
    if (!flow) fail(CODES.NOT_FOUND, `工作流 ${id} 未定义`, { flowId: id, available: [...flows.keys()] });
    return flow;
  }

  function nodeInput(node, run) {
    const base = { ...run.input, ...(node.input ?? {}) };
    for (const dependency of node.requires ?? []) {
      const stored = run.nodeResults[dependency];
      if (stored?.result) base[`${dependency}Result`] = stored.result;
      if (stored?.result?.structured) Object.assign(base, stored.result.structured);
    }
    return base;
  }

  async function save(run) {
    return store.upsert('workflow_runs', { ...run, updatedAt: now() }, run.revision);
  }

  async function tick(runId) {
    let run = await ownedRun(runId, 'write');
    if (['completed', 'cancelled'].includes(run.status)) return run;
    const flow = flowOf(run.flowId);
    run = await save({ ...run, status: 'running', error: null });

    for (const node of flow.nodes) {
      if (run.nodeResults[node.id]?.status === 'completed') continue;
      const unmet = (node.requires ?? []).filter((id) => run.nodeResults[id]?.status !== 'completed');
      if (unmet.length > 0) {
        return save({ ...run, status: 'failed', pendingNode: node.id, error: { code: 'dependency_unmet', message: `节点 ${node.id} 依赖未完成：${unmet.join(', ')}` } });
      }

      if (node.externalEffect || node.type === 'confirmation') {
        const confirmation = run.confirmations?.[node.id];
        if (!confirmation?.confirmed) {
          return save({ ...run, status: 'waiting_confirmation', pendingNode: node.id, confirmationPrompt: node.confirmationPrompt ?? '该步骤有外部副作用，请确认后执行' });
        }
        if ((run.consumedConfirmations ?? []).includes(confirmation.idempotencyKey)) {
          return save({ ...run, status: 'failed', pendingNode: node.id, error: { code: 'duplicate_side_effect', message: '该确认已被消费，拒绝重复执行外部副作用' } });
        }
      }

      if (node.type === 'external_wait' && !run.input?.[node.inputField ?? 'externalFeedback']) {
        return save({ ...run, status: 'waiting_external', pendingNode: node.id, missing: [{ name: node.inputField ?? 'externalFeedback', hint: node.hint ?? '等待外部反馈' }] });
      }

      let outcome = null;
      if (node.skill) {
        try {
          outcome = await skills.run(node.skill, nodeInput(node, run), {
            ...baseContext,
            workflowRunId: run.id,
            taskId: run.taskId,
            workspaceId: run.workspaceId,
            deliver: baseContext.deliver ? (options) => baseContext.deliver({ ...options, taskId: run.taskId, workspaceId: run.workspaceId }) : undefined,
          });
        } catch (error) {
          return save({ ...run, status: 'failed', pendingNode: node.id, error: { code: error?.code ?? 'internal_error', message: error?.message ?? String(error) } });
        }
        if (outcome.status === 'needs_input') {
          return save({ ...run, status: 'waiting_input', pendingNode: node.id, missing: outcome.missing, nodeResults: { ...run.nodeResults, [node.id]: { status: 'needs_input', at: now() } } });
        }
        if (outcome.status === 'failed' || !outcome.ok) {
          return save({
            ...run, status: 'failed', pendingNode: node.id,
            error: outcome.error ?? { code: 'skill_failed', message: outcome.message ?? '技能执行失败' },
            nodeResults: { ...run.nodeResults, [node.id]: { status: 'failed', at: now(), message: outcome.message } },
          });
        }
      }

      const consumed = node.externalEffect || node.type === 'confirmation'
        ? [...(run.consumedConfirmations ?? []), run.confirmations[node.id].idempotencyKey]
        : (run.consumedConfirmations ?? []);
      run = await save({
        ...run,
        status: 'running',
        pendingNode: null,
        missing: [],
        consumedConfirmations: consumed,
        nodeResults: {
          ...run.nodeResults,
          [node.id]: {
            status: 'completed',
            at: now(),
            skill: node.skill ?? null,
            produces: node.produces ?? [],
            result: outcome?.result ?? { structured: nodeInput(node, run) },
            citations: outcome?.citations ?? [],
            artifacts: outcome?.artifacts ?? [],
          },
        },
      });
    }

    // A completed chain must deliver a real, verified aggregate artifact.
    let finalArtifacts = [];
    if (run.input?.format && typeof baseContext?.deliver === 'function') {
      const nodeRows = Object.entries(run.nodeResults).map(([id, value]) => [id, value.status, JSON.stringify(value.result ?? {}).slice(0, 240)]);
      const citations = Object.values(run.nodeResults).flatMap((value) => value.citations ?? []);
      const content = {
        title: `流程成果：${flow.name}`,
        subtitle: `运行 ${run.id} · 已完成节点 ${nodeRows.length}`,
        sections: [{ heading: '节点执行结果', paragraphs: [nodeRows.map(([id, status]) => `${id}: ${status}`).join('；')] }],
        tables: [{ name: '节点明细', columns: ['节点', '状态', '结果摘要'], rows: nodeRows }],
        citations,
      };
      try {
        finalArtifacts = [await baseContext.deliver({ format: run.input.format, filename: `流程成果-${flow.id}`, content, taskId: run.taskId, workspaceId: run.workspaceId })];
      } catch (error) {
        return save({ ...run, status: 'failed', pendingNode: null, error: { code: error?.code ?? 'artifact_failed', message: `流程成果生成失败：${error.message}` } });
      }
    }
    const completed = await save({ ...run, status: 'completed', finishedAt: now(), pendingNode: null, finalArtifacts });
    if (completed.taskId) {
      const structured = Object.fromEntries(Object.entries(completed.nodeResults).map(([id, value]) => [id, value.result]));
      try {
        await tasks.addResult(completed.taskId, { kind: 'workflow', flowId: flow.id, runId: completed.id, structured });
        await tasks.update(completed.taskId, { status: flow.finalTaskStatus ?? 'completed' });
      } catch { /* task may have been archived; workflow result is still durable */ }
    }
    return completed;
  }

  async function start({ flowId, taskId, workspaceId = 'default', input = {}, expertId, confirmations = {} }) {
    assertOwner({ workspaceId }, 'write');
    if (taskId) await tasks.load(taskId, 'write');
    const flow = flowOf(flowId);
    const missing = (flow.input ?? []).filter((field) => field.required && (input[field.name] === undefined || input[field.name] === ''))
      .map((field) => ({ name: field.name, hint: field.hint ?? '' }));
    const run = await store.upsert('workflow_runs', {
      id: newId('run'),
      flowId,
      taskId: taskId ?? null,
      workspaceId,
      expertId: expertId ?? flow.expertId ?? null,
      status: 'running',
      input: clone(input),
      nodeResults: {},
      confirmations: clone(confirmations),
      consumedConfirmations: [],
      evidence: emptyEvidence(),
      initialMissing: missing,
      startedAt: now(),
      updatedAt: now(),
      archived: false,
    });
    // Missing flow inputs are reported, but executable nodes still run first.
    return tick(run.id);
  }

  async function resume(runId, { input = {}, confirmations = {}, confirmed = false } = {}) {
    const run = await ownedRun(runId, 'write');
    if (['completed', 'cancelled'].includes(run.status)) fail(CODES.INVALID_INPUT, `运行已 ${run.status}，不能继续`);
    const nextConfirmations = { ...(run.confirmations ?? {}) };
    for (const [nodeId, value] of Object.entries(confirmations)) {
      nextConfirmations[nodeId] = { confirmed: true, idempotencyKey: typeof value === 'string' ? value : newId('confirm'), at: now() };
    }
    if (confirmed && run.pendingNode && !nextConfirmations[run.pendingNode]) {
      nextConfirmations[run.pendingNode] = { confirmed: true, idempotencyKey: newId('confirm'), at: now() };
    }
    const saved = await save({ ...run, input: { ...run.input, ...clone(input) }, confirmations: nextConfirmations });
    return tick(saved.id);
  }

  async function cancel(runId, reason = '用户取消') {
    const run = await ownedRun(runId, 'write');
    return save({ ...run, status: 'cancelled', finishedAt: now(), cancelReason: reason });
  }

  async function retry(runId, nodeId) {
    const run = await ownedRun(runId, 'write');
    const flow = flowOf(run.flowId);
    const node = flow.nodes.find((item) => item.id === nodeId);
    if (!node) fail(CODES.NOT_FOUND, `节点 ${nodeId} 不存在`, { nodeId });
    if ((node.externalEffect || node.type === 'confirmation') && !(run.confirmations ?? {})[`${nodeId}:retry`]) {
      fail(CODES.EXTERNAL_SIDE_EFFECT_UNCONFIRMED, '外部副作用节点重试需要新的显式确认，避免重复发送', { nodeId });
    }
    const nodeResults = { ...run.nodeResults };
    delete nodeResults[nodeId];
    const saved = await save({ ...run, nodeResults, status: 'running', error: null });
    return tick(saved.id);
  }

  /** Called on Host boot: long-term progress stays in the store, the engine is not the source of truth. */
  async function recover() {
    const runs = ownerFilter(await store.all('workflow_runs')).filter((run) => run.status === 'running');
    const recovered = [];
    for (const run of runs) {
      recovered.push(await save({ ...run, status: 'interrupted', interruption: { at: now(), reason: '进程重启，已完成节点保留，需显式 resume 继续' } }));
    }
    return { recovered: recovered.length, runs: recovered.map((run) => ({ id: run.id, flowId: run.flowId, completedNodes: Object.keys(run.nodeResults).length })) };
  }

  async function get(runId) {
    const run = await ownedRun(runId, 'write');
    const flow = flowOf(run.flowId);
    return { ...run, flow: { id: flow.id, name: flow.name, acceptance: flow.acceptance ?? [], nodes: flow.nodes.map((node) => ({ id: node.id, skill: node.skill ?? null, externalEffect: Boolean(node.externalEffect) })) } };
  }

  function listFlows() {
    return definitions.map((flow) => ({ id: flow.id, name: flow.name, expertId: flow.expertId, input: flow.input ?? [], nodes: flow.nodes.length, acceptance: flow.acceptance ?? [] }));
  }

  return { start, resume, cancel, retry, recover, get, listFlows, tick };
}
