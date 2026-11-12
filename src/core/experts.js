import { CODES, fail } from './errors.js';
import { clone, emptyEvidence } from './util.js';

/** Expert = judgement + capability routing + result organisation + quality check. */
export function createExperts({ definitions = [], skills, knowledge, workflows, tasks }) {
  const byId = new Map(definitions.map((expert) => [expert.id, expert]));

  function list() {
    return definitions.map(({ id, name, domains, skills: skillIds, deliverables, source }) => ({ id, name, domains, skills: skillIds, deliverables, source }));
  }

  function get(id) {
    const expert = byId.get(id);
    if (!expert) fail(CODES.NOT_FOUND, `专家 ${id} 不存在`, { id, available: [...byId.keys()] });
    return expert;
  }

  function score(expert, goal) {
    const text = String(goal ?? '').toLowerCase();
    let value = 0;
    const matched = [];
    for (const keyword of expert.keywords ?? []) {
      if (text.includes(String(keyword).toLowerCase())) { value += 2; matched.push(keyword); }
    }
    for (const scenario of expert.scenarios ?? []) {
      if (text.includes(String(scenario).toLowerCase())) { value += 3; matched.push(scenario); }
    }
    return { value, matched };
  }

  /** Direct goal or explicit expert selection; always explain the task and required material. */
  function route({ goal, workspaceId = 'default', expertId, outputPreference } = {}) {
    if (typeof goal !== 'string' || goal.trim() === '') {
      fail(CODES.MISSING_INPUT, '路由需要目标描述 goal', { field: 'goal' });
    }
    let selected = null;
    let reason = '';
    if (expertId) {
      selected = get(expertId);
      reason = `用户指定专家「${selected.name}」`;
    } else {
      const scored = definitions.map((expert) => ({ expert, ...score(expert, goal) })).sort((a, b) => b.value - a.value);
      const top = scored[0];
      if (!top || top.value < 2) {
        return {
          status: 'needs_clarification',
          selected: null,
          candidates: scored.slice(0, 3).map((item) => ({ id: item.expert.id, name: item.expert.name, score: item.value })),
          message: '现有目标不足以判断专家，请选择专家或补充业务目标；不会猜测后伪造处理结果。',
          requiredInputs: [],
          missing: [],
        };
      }
      selected = top.expert;
      reason = `目标命中「${top.matched.slice(0, 4).join('、')}」，选择「${selected.name}」（得分 ${top.value}）`;
    }
    const requiredInputs = (selected.requiredInputs ?? []).map((field) => ({ ...field }));
    return {
      status: 'routed',
      selected: { id: selected.id, name: selected.name, domains: selected.domains },
      candidates: definitions
        .map((expert) => ({ expert, ...score(expert, goal) }))
        .filter((item) => item.expert.id !== selected.id && item.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .map((item) => ({ id: item.expert.id, name: item.expert.name, score: item.value })),
      reasoning: reason,
      taskInterpretation: `在 ${workspaceId} 工作空间处理：${goal.trim()}`,
      requiredInputs,
      missing: requiredInputs.filter((field) => field.required).map((field) => ({ name: field.name, hint: field.hint })),
      outputForm: outputPreference ?? selected.defaultOutputForm ?? 'markdown',
      correction: '可以直接指定 expertId、修改 goal 或 outputPreference 来纠正本次处理',
    };
  }

  async function plan(expertId, { goal, task } = {}) {
    const expert = get(expertId);
    const available = await skills.list();
    const byName = new Map(available.map((skill) => [skill.name, skill]));
    const chosen = (expert.skills ?? []).map((name) => {
      const skill = byName.get(name);
      return skill ? { name, status: skill.status, callable: skill.callable, executor: skill.executor } : { name, status: 'missing', callable: false };
    });
    const flows = workflows ? workflows.listFlows().filter((flow) => flow.expertId === expertId) : [];
    return {
      expertId,
      goal: goal ?? task?.goal ?? null,
      skills: chosen,
      missingSkills: chosen.filter((item) => !item.callable).map((item) => item.name),
      knowledgeDomains: expert.knowledgeDomains ?? [],
      tools: expert.tools ?? ['knowledge.search', 'files.generate', 'tasks.update'],
      deliverables: expert.deliverables ?? [],
      workflows: flows.map((flow) => flow.id),
      acceptance: expert.acceptance ?? [],
      note: chosen.some((item) => !item.callable) ? '部分技能未就绪，规划中已明确标出，不会以提示词代替执行' : '技能均已注册执行器',
    };
  }

  /** Quality gate: separate verified fact from assumption, require resolvable citations. */
  async function review(expertId, { result, task } = {}) {
    const expert = get(expertId);
    const evidence = result?.evidence ?? emptyEvidence();
    const citations = result?.citations ?? [];
    const artifacts = result?.artifacts ?? [];
    const checks = [
      { id: 'evidence_present', label: '是否有依据', passed: (evidence.facts?.length ?? 0) > 0 || citations.length > 0, detail: `事实 ${evidence.facts?.length ?? 0} 条，引用 ${citations.length} 条` },
      { id: 'unknowns_declared', label: '未知项是否声明', passed: Array.isArray(evidence.unknowns), detail: `未知项 ${evidence.unknowns?.length ?? 0} 条` },
      { id: 'separation', label: '事实/假设/建议是否分离', passed: Array.isArray(evidence.assumptions) && Array.isArray(evidence.recommendations), detail: '五元组结构检查' },
      { id: 'citations_resolvable', label: '引用可回到原文', passed: citations.every((citation) => Boolean(citation.docId || citation.path)), detail: `${citations.length} 条引用` },
      { id: 'artifacts_verified', label: '成果文件已校验', passed: artifacts.every((artifact) => artifact.verified !== false), detail: `${artifacts.length} 个成果` },
      { id: 'acceptance_declared', label: '验收条件已声明', passed: (expert.acceptance ?? []).length > 0, detail: `${(expert.acceptance ?? []).length} 条` },
    ];
    let citationResolution = { checked: 0, resolved: 0, failures: [] };
    if (knowledge && citations.length > 0) {
      for (const citation of citations.filter((item) => item.docId)) {
        citationResolution.checked += 1;
        try { await knowledge.readSection({ docId: citation.docId, section: citation.section, part: citation.part ?? 1, workspaceId: task?.workspaceId ?? 'default' }); citationResolution.resolved += 1; }
        catch (error) { citationResolution.failures.push({ docId: citation.docId, message: error.message }); }
      }
      checks[3].passed = citationResolution.failures.length === 0;
      checks[3].detail = `${citationResolution.resolved}/${citationResolution.checked} 条引用可回到原文`;
    }
    return {
      expertId,
      passed: checks.every((check) => check.passed),
      checks,
      citationResolution,
      verdict: checks.every((check) => check.passed) ? '可交付' : '存在未通过项，需补充依据或修正成果后再交付',
    };
  }

  /** Structured handoff, not a replay of the full conversation. */
  async function handoff({ fromTaskId, toExpertId, goal, workspaceId, citations, conclusions }) {
    if (!tasks) fail(CODES.DEPENDENCY_UNAVAILABLE, '任务服务不可用，无法交接');
    get(toExpertId);
    const next = await tasks.handoff(fromTaskId, { toExpertId, goal, workspaceId, citations, conclusions });
    return { taskId: next.id, expertId: toExpertId, inheritedCitations: next.citations.length, note: '仅传递结构化结果与引用，未传递完整对话' };
  }

  return { list, get, route, plan, review, handoff };
}
