import { emptyEvidence } from './util.js';
import { structured } from './executors-shared.js';

const asText = (value, max = 240) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.slice(0, max);
  if (Array.isArray(value)) return value.map((item) => asText(item, 100)).join('；').slice(0, max);
  return JSON.stringify(value).slice(0, max);
};

const num = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[,%\s￥$]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

function weightedRank(items, criteria) {
  return items.map((item) => {
    const scores = item.scores ?? {};
    let total = 0;
    let weightSum = 0;
    for (const criterion of criteria) {
      const weight = Number(criterion.weight ?? 1);
      const value = num(scores[criterion.name]);
      if (value === null) continue;
      total += value * weight;
      weightSum += weight;
    }
    return {
      name: String(item.name ?? '未命名'),
      weightedScore: weightSum === 0 ? null : Number((total / weightSum).toFixed(3)),
      coveredCriteria: weightSum,
      missingCriteria: criteria.filter((criterion) => num(scores[criterion.name]) === null).map((criterion) => criterion.name),
    };
  }).sort((a, b) => (b.weightedScore ?? -Infinity) - (a.weightedScore ?? -Infinity));
}

export function createDomainExecutors() {
  const e = {};

  // ── HR 工作台 ───────────────────────────────────────────────────────────
  e['hr.jobAnalysis'] = structured('岗位分析', [
    { name: 'role', label: '岗位', hint: '岗位名称' },
    { name: 'responsibilities', label: '职责', hint: '提供职责清单或岗位资料' },
  ], (input) => ({
    summary: '按职责、能力要求、评估维度与适用条件组织岗位分析；未提供的能力标准列为待确认。',
    structured: { role: input.role, responsibilityCount: Array.isArray(input.responsibilities) ? input.responsibilities.length : 1 },
    tables: [{ name: '岗位能力矩阵', columns: ['职责', '能力要求', '评估方式', '确认状态'], rows: (Array.isArray(input.responsibilities) ? input.responsibilities : [input.responsibilities ?? '']).map((item) => [asText(item), asText(input.competencies ?? '待确认'), '待业务确认', '待确认']) }],
    recommendations: ['岗位分析结论需由用人部门确认后用于招聘'],
  }));

  e['hr.jd'] = structured('岗位说明书', [
    { name: 'role', label: '岗位', hint: '岗位名称' },
    { name: 'requirements', label: '任职要求', hint: '提供任职条件' },
  ], (input) => ({
    summary: '按固定字段生成岗位说明书，缺失字段不会用虚构内容填充。',
    structured: { role: input.role },
    tables: [{ name: 'JD 字段核对', columns: ['字段', '内容', '状态'], rows: [
      ['岗位名称', asText(input.role), '已填'], ['职责', asText(input.responsibilities), input.responsibilities ? '已填' : '待补充'],
      ['任职要求', asText(input.requirements), '已填'], ['汇报关系', asText(input.reportingLine), input.reportingLine ? '已填' : '待补充'],
      ['薪酬范围', asText(input.salaryRange), input.salaryRange ? '已填' : '待补充'],
    ] }],
  }));

  e['hr.resumeExtract'] = async (input, context) => {
    const text = String(input.resumeText ?? '');
    if (!text.trim()) return { ok: false, status: 'failed', message: '未提供简历文本', evidence: emptyEvidence() };
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null;
    const phone = text.match(/1[3-9]\d{9}/)?.[0] ?? null;
    const years = text.match(/(\d{1,2})\s*年(?:以上)?(?:工作|经验|从业)/)?.[1] ?? null;
    const education = ['博士', '硕士', '本科', '大专'].find((level) => text.includes(level)) ?? null;
    const skillKeywords = ['销售', '数据分析', 'Python', 'SQL', '项目管理', '采购', 'HR', '投标', '客户管理'];
    const skills = skillKeywords.filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
    const unknowns = [];
    if (!email) unknowns.push({ statement: '未识别到邮箱' });
    if (!phone) unknowns.push({ statement: '未识别到手机号' });
    if (!years) unknowns.push({ statement: '未识别到工作年限' });
    if (!education) unknowns.push({ statement: '未识别到学历' });
    const citations = [];
    const content = {
      title: `简历字段提取：${input.candidateName ?? '未命名候选人'}`,
      sections: [{ heading: '提取结果', paragraphs: ['以下字段由文本规则真实提取，未识别项明确列出，不做推测。'] }],
      tables: [{ name: '字段', columns: ['字段', '值', '识别方式'], rows: [
        ['姓名', String(input.candidateName ?? '未提供'), '输入'], ['邮箱', email ?? '未识别', '正则'], ['电话', phone ?? '未识别', '正则'],
        ['工作年限', years ?? '未识别', '正则'], ['学历', education ?? '未识别', '关键词'], ['技能', skills.join('、') || '未识别', '关键词'],
        ['文本行数', String(lines.length), '统计'],
      ] }],
      citations,
    };
    const artifacts = input.format && context.deliver ? [await context.deliver({ format: input.format, filename: input.filename, content })] : [];
    return { ok: true, structured: { email, phone, years, education, skills, lineCount: lines.length }, evidence: { ...emptyEvidence(), facts: [{ statement: `从 ${lines.length} 行文本提取 ${7 - unknowns.length} 个字段` }], unknowns }, citations, artifacts, unknowns, content, message: '提取仅为结构化结果，录用判断由用户完成' };
  };

  e['hr.compareCandidates'] = structured('候选人评估对比', [
    { name: 'candidates', label: '候选人', hint: '提供候选人数组（含 scores）' },
  ], (input) => {
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    const criteriaInput = Array.isArray(input.criteria) && input.criteria.length > 0
      ? input.criteria
      : [{ name: '专业能力', weight: 1 }, { name: '经验匹配', weight: 1 }, { name: '沟通协作', weight: 1 }];
    const scoreKeys = new Set(candidates.flatMap((item) => Object.keys(item?.scores ?? {})));
    // A dimension is only bound to a score when the user says so, or when the
    // names are exactly equal. Similar names are never silently merged.
    const dimensions = criteriaInput.map((criterion) => {
      const name = String(criterion?.name ?? criterion ?? '').trim();
      const explicit = criterion?.source ?? criterion?.field ?? null;
      const source = explicit ?? (scoreKeys.has(name) ? name : null);
      return {
        name,
        weight: Number(criterion?.weight ?? 1) || 1,
        source,
        mapped: Boolean(source),
        scale: String(criterion?.scale ?? '未声明评分范围'),
        reason: explicit ? '按你指定的字段对应' : (source ? '与评分字段同名对应' : '未找到同名评分字段，未做相似名称推断'),
      };
    });
    const unmapped = dimensions.filter((item) => !item.mapped);
    const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0);
    const rows = candidates.map((candidate) => {
      const values = dimensions.map((dimension) => (dimension.source ? num(candidate?.scores?.[dimension.source]) : null));
      const coveredIndexes = dimensions.map((_, index) => index).filter((index) => values[index] !== null);
      const coveredWeight = coveredIndexes.reduce((sum, index) => sum + dimensions[index].weight, 0);
      const weightedScore = coveredWeight > 0
        ? Number((coveredIndexes.reduce((sum, index) => sum + values[index] * dimensions[index].weight, 0) / coveredWeight).toFixed(3))
        : null;
      return {
        name: String(candidate?.name ?? candidate?.candidate ?? '未命名候选人'),
        values,
        covered: coveredIndexes.map((index) => dimensions[index].name),
        missing: dimensions.filter((_, index) => !coveredIndexes.includes(index)).map((item) => item.name),
        coveredWeight,
        totalWeight,
        coverageRatio: totalWeight > 0 ? Number((coveredWeight / totalWeight).toFixed(3)) : 0,
        weightedScore,
      };
    });
    const comparableScores = rows.filter((item) => item.weightedScore !== null);
    const coverageSignature = new Set(rows.map((item) => item.covered.slice().sort().join('|'))).size > 1;
    const fullyCovered = rows.length > 0 && rows.every((item) => item.missing.length === 0);
    const ranked = [...rows].sort((a, b) => (b.weightedScore ?? -Infinity) - (a.weightedScore ?? -Infinity));
    const sharedDimensions = rows.length > 0
      ? dimensions.filter((dimension) => rows.every((item) => item.covered.includes(dimension.name))).map((dimension) => dimension.name)
      : [];
    const top = comparableScores[0] ?? null;
    const parts = [];
    if (unmapped.length > 0) parts.push(`有 ${unmapped.length} 个评价维度未找到对应字段（${unmapped.map((item) => item.name).join('、')}），未按相似名称推断，请确认字段对应关系`);
    if (coverageSignature) parts.push('各候选人的评分覆盖范围不同，只能比较双方都已评分的维度');
    if (top && fullyCovered) parts.push(`全部维度均有评分时，${top.name} 的加权分最高（${top.weightedScore}）`);
    else if (top && sharedDimensions.length > 0) {
      const sharedTop = [...rows].sort((a, b) => (b.weightedScore ?? -Infinity) - (a.weightedScore ?? -Infinity))[0];
      parts.push(`在共同评分的维度（${sharedDimensions.join('、')}）上，${sharedTop.name} 的加权分最高（${sharedTop.weightedScore}），其余维度无法比较`);
    } else if (top) parts.push(`${top.name} 在已评分维度上加权分最高（${top.weightedScore}）`);
    parts.push('录用决定由你作出，本表只提供评分对照');
    const conclusion = `${parts.join('；')}。`;
    const scoreMatrix = dimensions.map((dimension) => [
      dimension.name,
      String(dimension.weight),
      dimension.source ?? '未对应字段',
      dimension.scale,
      ...rows.map((item) => (item.values[dimensions.indexOf(dimension)] === null ? '未评分' : String(item.values[dimensions.indexOf(dimension)]))),
    ]);
    return {
      summary: '加权分按已评分维度计算；缺失评分不计为零，不以缺项制造优势。',
      conclusion,
      structured: {
        ranked,
        dimensions: dimensions.map((dimension) => ({ ...dimension, coverage: rows.filter((item) => item.covered.includes(dimension.name)).length })),
        comparableScores: comparableScores.length,
        fullyCovered,
        comparableAcrossCandidates: fullyCovered && !coverageSignature,
        needsMappingConfirmation: unmapped.length > 0,
        scoreFields: [...scoreKeys],
      },
      tables: [
        {
          name: '候选人对比',
          columns: ['候选人', '加权分（仅按已评分维度）', '已评分维度', '未评分维度', '评分覆盖'],
          rows: rows.map((item) => [
            item.name,
            item.weightedScore ?? '无法计算',
            item.covered.join('、') || '无',
            item.missing.join('、') || '无',
            `${item.covered.length}/${dimensions.length} 个维度（权重 ${Math.round(item.coverageRatio * 100)}%）`,
          ]),
        },
        {
          name: '评价维度与评分对应',
          columns: ['评价维度', '权重', '对应评分字段', '评分范围', ...rows.map((item) => item.name)],
          rows: scoreMatrix,
        },
      ],
      recommendations: [
        '补齐缺失维度评分后再比较整体表现',
        '本表仅为评分对照，录用决定由用户作出',
      ],
      assumptions: ['权重按输入值计算，未给权重时按等权处理', '维度与字段仅按你指定的对应关系或完全同名的字段匹配'],
    };
  });

  e['hr.interviewDesign'] = structured('面试设计与记录', [
    { name: 'role', label: '岗位', hint: '岗位名称' },
    { name: 'criteria', label: '评估维度', hint: '提供评估维度' },
  ], (input) => ({
    summary: '为每个评估维度生成结构化问题、评分锚点与记录栏。',
    structured: { questionCount: (input.criteria ?? []).length * 2 },
    tables: [{ name: '面试提纲', columns: ['维度', '问题', '评分锚点', '记录'], rows: (Array.isArray(input.criteria) ? input.criteria : []).flatMap((criterion) => [
      [asText(criterion.name ?? criterion), `请举例说明与「${asText(criterion.name ?? criterion)}」相关的实际经历`, '1-5 分，需附具体证据', '待填写'],
      [asText(criterion.name ?? criterion), `在受限条件下如何保证「${asText(criterion.name ?? criterion)}」的结果？`, '1-5 分，需附具体证据', '待填写'],
    ]) }],
  }));

  e['hr.onboarding'] = structured('入职与培养计划', [
    { name: 'role', label: '岗位', hint: '岗位名称' },
  ], (input) => ({
    summary: '按阶段生成入职计划、培训材料关联与复查点；材料链接需由知识管理提供。',
    structured: { phases: (input.phases ?? ['入职准备', '首周', '首月', '试用期满']).length },
    tables: [{ name: '入职计划', columns: ['阶段', '目标', '培训材料', '复查点'], rows: (input.phases ?? ['入职准备', '首周', '首月', '试用期满']).map((phase) => [asText(phase), '按岗位目标确认', '待知识管理关联', '待业务负责人确认']) }],
    recommendations: ['培训资料通过知识引用关联，不在计划中复制正文'],
  }));

  // ── 个人与岗位工作台 ───────────────────────────────────────────────────
  e['personal.goalBreakdown'] = structured('目标拆解', [
    { name: 'goal', label: '目标', hint: '说明岗位目标' },
  ], (input) => ({
    summary: '把目标拆为可执行任务、优先级与验收条件；未给时间与责任人时列为待确认。',
    structured: { horizon: input.horizon ?? '待确认', tasks: (input.tasks ?? []).length },
    tables: [{ name: '目标-任务映射', columns: ['目标', '任务', '验收条件', '优先级'], rows: (input.tasks ?? []).map((task) => [asText(input.goal), asText(task.name ?? task), asText(task.acceptance ?? '待确认'), asText(task.priority ?? '待确认')]) }],
  }));
  e['personal.weeklyPlan'] = structured('周计划', [{ name: 'goal', label: '目标', hint: '本周目标' }], (input) => ({ summary: '生成周计划与执行反馈栏。', structured: {}, tables: [{ name: '周计划', columns: ['事项', '计划', '实际', '偏差'], rows: (input.items ?? []).map((item) => [asText(item.name ?? item), asText(item.plan ?? '待确认'), '待填写', '待计算']) }] }));
  e['personal.meetingActions'] = structured('会议行动清单', [{ name: 'meetingNotes', label: '会议记录', hint: '会议纪要' }], (input) => ({ summary: '行动项、责任人、截止与状态分开记录。', structured: {}, tables: [{ name: '行动项', columns: ['行动', '责任人', '截止', '状态'], rows: (input.actions ?? []).map((action) => [asText(action.name ?? action), asText(action.owner ?? '待确认'), asText(action.due ?? '待确认'), '待执行']) }] }));
  e['personal.review'] = structured('岗位复盘', [{ name: 'goal', label: '目标', hint: '复盘目标' }, { name: 'feedback', label: '反馈', hint: '执行反馈' }], (input) => ({ summary: '按目标、执行、偏差、改进整理，偏差需实际数值。', structured: {}, tables: [{ name: '复盘', columns: ['维度', '内容'], rows: [['目标', asText(input.goal)], ['反馈', asText(input.feedback)], ['改进', asText(input.improvement ?? '待补充')]] }] }));
  e['personal.report'] = structured('工作报告', [{ name: 'goal', label: '目标', hint: '报告目标' }], (input) => ({ summary: '汇总进展、风险与下一步，供继续处理。', structured: {}, tables: [{ name: '工作报告', columns: ['项目', '内容'], rows: [['进展', asText(input.progress ?? '待补充')], ['风险', asText(input.risks ?? '待补充')], ['下一步', asText(input.nextSteps ?? '待补充')]] }] }));

  // ── 企业经营管理 ───────────────────────────────────────────────────────
  e['management.diagnose'] = async (input, context) => {
    const metrics = Array.isArray(input.metrics) ? input.metrics : [];
    const diagnosed = metrics.map((metric) => {
      const target = num(metric.target);
      const actual = num(metric.actual);
      const deviation = target !== null && actual !== null ? Number((actual - target).toFixed(4)) : null;
      const rate = target !== null && actual !== null && target !== 0 ? Number(((actual - target) / Math.abs(target) * 100).toFixed(2)) : null;
      return { name: String(metric.name ?? '未命名指标'), target, actual, deviation, deviationRatePercent: rate, status: deviation === null ? '数据不足' : (rate < -5 ? '需关注' : '达标或在容忍区间') };
    });
    const problems = diagnosed.filter((item) => item.status === '需关注');
    return {
      ok: true,
      structured: { diagnosed, problemCount: problems.length, dataSufficient: diagnosed.every((item) => item.deviation !== null) },
      evidence: { ...emptyEvidence(), facts: diagnosed.map((item) => ({ statement: `${item.name}: 目标 ${item.target ?? '未提供'}，实际 ${item.actual ?? '未提供'}，偏差 ${item.deviation ?? '无法计算'}` })), unknowns: diagnosed.filter((item) => item.deviation === null).map((item) => ({ statement: `${item.name} 缺少 target/actual，无法计算偏差` })), recommendations: problems.map((item) => ({ statement: `优先分析「${item.name}」偏差原因并指定责任人` })) },
      citations: [], artifacts: [],
      unknowns: diagnosed.filter((item) => item.deviation === null).map((item) => ({ field: item.name, hint: '提供 target 与 actual' })),
      content: { title: '经营诊断', sections: [{ heading: '指标偏差', paragraphs: ['偏差由输入数值实际计算，未提供的指标不推断。'] }], tables: [{ name: '经营指标', columns: ['指标', '目标', '实际', '偏差', '偏差率%', '状态'], rows: diagnosed.map((item) => [item.name, item.target ?? '未提供', item.actual ?? '未提供', item.deviation ?? '无法计算', item.deviationRatePercent ?? '无法计算', item.status]) }], citations: [] },
      message: `诊断 ${diagnosed.length} 项指标，${problems.length} 项需关注；偏差来自真实计算`,
    };
  };
  e['management.improvePlan'] = structured('经营改进计划', [{ name: 'problems', label: '问题清单', hint: '提供诊断出的问题' }], (input) => ({ summary: '把问题映射到改进动作、责任与复查点。', structured: {}, tables: [{ name: '改进计划', columns: ['问题', '动作', '责任', '复查'], rows: (Array.isArray(input.problems) ? input.problems : []).map((problem) => [asText(problem.name ?? problem), asText(problem.action ?? '待确认'), asText(problem.owner ?? '待确认'), asText(problem.reviewDate ?? '待确认')]) }] }));
  e['management.responsibility'] = structured('职责协作分解', [{ name: 'actions', label: '行动清单', hint: '提供行动清单' }], (input) => ({ summary: '明确每项行动的责任、协作方与验收。', structured: {}, tables: [{ name: '职责矩阵', columns: ['行动', '责任人', '协作方', '验收'], rows: (Array.isArray(input.actions) ? input.actions : []).map((action) => [asText(action.name ?? action), asText(action.owner ?? '待确认'), asText(action.collaborators ?? '待确认'), asText(action.acceptance ?? '待确认')]) }] }));
  e['management.report'] = structured('经营报告', [{ name: 'metrics', label: '经营数据', hint: '提供经营指标数据' }], (input) => ({ summary: '汇总经营数据、问题与改进计划，保留来源与待确认项。', structured: {}, tables: [{ name: '经营概览', columns: ['维度', '内容'], rows: [['数据', asText(input.metrics)], ['问题', asText(input.problems ?? '待补充')], ['改进', asText(input.improvements ?? '待补充')]] }] }));

  // ── 大客户销售 ─────────────────────────────────────────────────────────
  e['sales.accountResearch'] = structured('客户研究', [{ name: 'customer', label: '客户', hint: '客户名称' }, { name: 'material', label: '客户资料', hint: '提供客户资料或研究材料' }], (input) => ({ summary: '把客户事实、关键角色与待核实项分开；不把假设写成事实。', structured: { customer: input.customer }, tables: [{ name: '关键角色', columns: ['角色', '关注点', '证据', '状态'], rows: (input.stakeholders ?? []).map((person) => [asText(person.role ?? person), asText(person.concern ?? '待确认'), asText(person.evidence ?? '无'), person.evidence ? '有依据' : '待核实']) }], recommendations: ['拜访前核实关键角色与决策链'] }));
  e['sales.opportunityCard'] = structured('商机卡', [{ name: 'customer', label: '客户', hint: '客户名称' }], (input) => ({ summary: '商机卡保留阶段、角色、需求、价值假设、证据与下一步；缺失项明确列出。', structured: { customer: input.customer, stage: input.stage ?? '待确认' }, tables: [{ name: '商机卡', columns: ['字段', '内容', '状态'], rows: [['阶段', asText(input.stage), input.stage ? '已填' : '待确认'], ['关键角色', asText(input.stakeholders), input.stakeholders ? '已填' : '待确认'], ['需求与价值', asText(input.needs), input.needs ? '已填' : '待确认'], ['证据', asText(input.evidence), input.evidence ? '已填' : '待确认'], ['下一步', asText(input.nextAction), input.nextAction ? '已填' : '待确认']] }], recommendations: ['商机判断需由销售负责人结合外部事实确认'] }));
  e['sales.visitPlan'] = structured('拜访计划', [{ name: 'customer', label: '客户', hint: '客户名称' }, { name: 'objective', label: '拜访目标', hint: '本次拜访目标' }], (input) => ({ summary: '生成目标、问题清单、证据需求与反馈记录栏。', structured: {}, tables: [{ name: '拜访计划', columns: ['环节', '内容'], rows: [['目标', asText(input.objective)], ['需验证的信息', asText(input.unknowns ?? '待确认')], ['携带材料', asText(input.materials ?? '待确认')], ['反馈记录', '待填写']] }] }));
  e['sales.material'] = structured('销售材料', [{ name: 'customer', label: '客户', hint: '客户名称' }, { name: 'material', label: '素材', hint: '提供方案素材与证据' }], (input) => ({ summary: '按客户问题—证据—判断—行动组织销售材料，引用可回溯。', structured: {}, tables: [{ name: '材料要点', columns: ['客户问题', '证据', '判断', '行动'], rows: (input.points ?? []).map((point) => [asText(point.question ?? point), asText(point.evidence ?? '待核实'), asText(point.judgement ?? '待用户确认'), asText(point.action ?? '待确认')]) }] }));
  e['sales.coach'] = structured('销售团队辅导', [{ name: 'opportunities', label: '商机清单', hint: '提供商机与跟进情况' }], (input) => ({ summary: '按商机阶段与证据充分度生成辅导重点；不替代业务决策。', structured: {}, tables: [{ name: '辅导清单', columns: ['商机', '阶段', '缺口', '建议'], rows: (Array.isArray(input.opportunities) ? input.opportunities : []).map((item) => [asText(item.name ?? item), asText(item.stage ?? '待确认'), asText(item.gap ?? '待确认'), '由团队负责人确认']) }] }));

  // ── 市场与商业研究 ─────────────────────────────────────────────────────
  e['research.plan'] = structured('研究计划', [{ name: 'question', label: '研究问题', hint: '明确研究问题' }], (input) => ({ summary: '定义范围、检索项、核验标准与交付形式。', structured: {}, tables: [{ name: '研究计划', columns: ['环节', '内容'], rows: [['问题', asText(input.question)], ['范围', asText(input.scope ?? '待确认')], ['核验标准', '每条结论需可回溯来源'], ['交付', asText(input.deliverable ?? '行业报告')]] }] }));
  e['research.collect'] = structured('商业情报整理', [{ name: 'sources', label: '来源清单', hint: '提供来源条目（含 url 与摘要）' }], (input) => {
    const sources = Array.isArray(input.sources) ? input.sources : [];
    const withUrl = sources.filter((item) => item.url || item.path);
    return { summary: `收集 ${sources.length} 条来源，其中 ${withUrl.length} 条带可回溯定位；其余标记为待核实。`, structured: { collected: sources.length, traceable: withUrl.length }, tables: [{ name: '来源台账', columns: ['来源', '定位', '摘要', '状态'], rows: sources.map((item) => [asText(item.name ?? item), asText(item.url ?? item.path ?? '无'), asText(item.summary ?? ''), item.url || item.path ? '可回溯' : '待核实']) }], recommendations: ['外部资料先作为待核实内容，不自动提升为可信规则'] };
  });
  e['research.verify'] = async (input, context) => {
    const claims = Array.isArray(input.claims) ? input.claims : [];
    const verified = [];
    const unverified = [];
    for (const claim of claims) {
      const hasSource = Boolean(claim.source || claim.url || claim.citation);
      const hasEvidence = Boolean(claim.evidence || claim.quote);
      (hasSource && hasEvidence ? verified : unverified).push({
        statement: String(claim.statement ?? claim),
        hasSource, hasEvidence,
        reason: hasSource && hasEvidence ? '有来源与证据' : (!hasSource ? '缺少来源' : '缺少证据摘录'),
      });
    }
    const content = { title: '研究结论核验', sections: [{ heading: '核验结果', paragraphs: [`${verified.length}/${claims.length} 条结论有来源与证据；未通过项不得作为事实引用。`] }], tables: [{ name: '核验台账', columns: ['结论', '来源', '证据', '判定'], rows: claims.map((claim, index) => [String(claim.statement ?? claim), claim.source || claim.url ? '有' : '无', claim.evidence || claim.quote ? '有' : '无', [...verified, ...unverified].find((item) => item.statement === String(claim.statement ?? claim))?.reason ?? '待核实']) }], citations: [] };
    const artifacts = input.format && context.deliver ? [await context.deliver({ format: input.format, filename: input.filename, content })] : [];
    return { ok: true, structured: { verified: verified.length, unverified: unverified.length, claims: claims.length }, evidence: { ...emptyEvidence(), facts: verified.map((item) => ({ statement: item.statement })), unknowns: unverified.map((item) => ({ statement: `${item.statement}：${item.reason}` })) }, citations: [], artifacts, unknowns: unverified.map((item) => ({ field: item.statement, hint: item.reason })), content, message: '逐条核验，不把未经证实的情报写成事实' };
  };
  e['research.report'] = structured('行业与客户研究报告', [{ name: 'question', label: '研究问题', hint: '研究问题' }], (input) => ({ summary: '按问题—来源—核验—分析—结论组织报告，引用可回到原文。', structured: {}, tables: [{ name: '结论表', columns: ['结论', '依据', '适用条件'], rows: (input.conclusions ?? []).map((item) => [asText(item.statement ?? item), asText(item.source ?? '待核实'), asText(item.condition ?? '待确认')]) }] }));
  e['research.opportunities'] = structured('市场机会清单', [{ name: 'signals', label: '市场信号', hint: '提供行业或客户信号' }], (input) => ({ summary: '把信号转为机会条目并标注证据强度，未验证项保留。', structured: {}, tables: [{ name: '机会清单', columns: ['机会', '信号', '证据强度', '下一步'], rows: (Array.isArray(input.signals) ? input.signals : []).map((item) => [asText(item.opportunity ?? item), asText(item.signal ?? ''), asText(item.evidenceStrength ?? '待核实'), '待确认']) }] }));

  // ── 数据分析（结论解释） ───────────────────────────────────────────────
  e['analysis.conclusion'] = structured('分析结论解释', [{ name: 'metrics', label: '指标结果', hint: '提供 data.metrics 的计算结果' }], (input) => ({ summary: '解释指标含义与适用条件，区分统计事实与业务归因。', structured: {}, assumptions: ['业务归因需结合业务背景，统计结果本身不等于因果'], tables: [{ name: '解释', columns: ['指标', '数值', '解释边界'], rows: Object.entries(input.metrics ?? {}).map(([key, value]) => [key, asText(value), '仅描述本次输入数据']) }] }));

  // ── 文档与办公处理（模板填充） ─────────────────────────────────────────
  e['document.templateFill'] = structured('模板填充与质量检查', [{ name: 'material', label: '输入资料', hint: '提供用于填充的资料' }], (input) => {
    const required = input.templateFields ?? ['标题', '背景', '结论', '依据', '待办'];
    const missing = required.filter((field) => !input.fields?.[field]);
    return { summary: `模板含 ${required.length} 个必填字段，${required.length - missing.length} 个已填；缺失字段不会生成空白文件冒充完成。`, structured: { filled: required.length - missing.length, missing }, tables: [{ name: '字段检查', columns: ['字段', '值', '状态'], rows: required.map((field) => [String(field), asText(input.fields?.[field] ?? ''), input.fields?.[field] ? '已填' : '缺失']) }], recommendations: missing.length ? ['补齐缺失字段后再导出'] : ['导出前已完成字段与格式检查'] };
  });

  // ── 采购与供应商管理 ───────────────────────────────────────────────────
  e['procurement.requirement'] = structured('采购需求', [{ name: 'requirement', label: '需求', hint: '提供采购需求说明' }], (input) => ({ summary: '拆分技术、商务、交付与验收要求，保留未知项。', structured: {}, tables: [{ name: '需求清单', columns: ['类别', '要求', '优先级', '状态'], rows: (input.items ?? []).map((item) => [asText(item.category ?? '未分类'), asText(item.description ?? item), asText(item.priority ?? '待确认'), '待确认']) }] }));
  e['procurement.vendorScan'] = structured('供应商研究', [{ name: 'vendors', label: '候选供应商', hint: '提供候选供应商与资料来源' }], (input) => ({ summary: '逐家记录证据与未知项，未接入外部数据源时不宣称已完成背景核查。', structured: { vendorCount: (input.vendors ?? []).length }, tables: [{ name: '供应商台账', columns: ['供应商', '证据', '来源', '状态'], rows: (input.vendors ?? []).map((vendor) => [asText(vendor.name ?? vendor), asText(vendor.evidence ?? '待核实'), asText(vendor.source ?? '未提供'), vendor.source ? '有来源' : '待核实']) }] }));
  e['procurement.quoteCompare'] = structured('询报价整理与比较', [{ name: 'quotes', label: '报价', hint: '提供各供应商报价' }], (input) => ({ summary: '按实际报价字段生成技术/商务比较表，缺字段保留为空并标注。', structured: { quoteCount: (input.quotes ?? []).length }, tables: [{ name: '报价比较', columns: ['供应商', '单价', '数量', '实施费', '年维护', '备注'], rows: (input.quotes ?? []).map((quote) => [asText(quote.vendor), quote.unitPrice ?? '未提供', quote.quantity ?? '未提供', quote.implementation ?? '未提供', quote.annualMaintenance ?? '未提供', asText(quote.note ?? '')]) }] }));
  e['procurement.tco'] = async (input, context) => {
    const quotes = Array.isArray(input.quotes) ? input.quotes : [];
    const years = num(input.years) ?? 3;
    const defaultCurrency = input.currency ?? '未声明币种';
    const defaultTax = input.taxBasis ?? input.tax ?? '未声明税费口径';
    void defaultCurrency; void defaultTax;
    // Basis values supplied at input level are treated as user confirmations
    // (the confirm form records them); they are never fabricated here.
    const userConfirmed = {
      quantity: input.quantity !== undefined && input.quantity !== null && String(input.quantity).trim() !== '',
      scope: input.scope !== undefined && input.scope !== null && String(input.scope).trim() !== '',
      currency: input.currency !== undefined && input.currency !== null && String(input.currency).trim() !== '',
      taxBasis: (input.taxBasis ?? input.tax) !== undefined && (input.taxBasis ?? input.tax) !== null && String(input.taxBasis ?? input.tax).trim() !== '',
      years: input.years !== undefined && input.years !== null && String(input.years).trim() !== '',
    };
    const calculated = quotes.map((quote) => {
      const unit = num(quote.unitPrice);
      const qty = num(quote.quantity);
      const impl = num(quote.implementation) ?? 0;
      const maintenance = num(quote.annualMaintenance) ?? 0;
      const training = num(quote.training) ?? 0;
      const missing = [unit === null && '单价', qty === null && '数量'].filter(Boolean);
      const tco = unit !== null && qty !== null ? Number((unit * qty + impl + maintenance * years + training).toFixed(2)) : null;
      const scopeKnown = userConfirmed.scope || (quote.scope ?? quote.product ?? quote.service) !== undefined && (quote.scope ?? quote.product ?? quote.service) !== null && String(quote.scope ?? quote.product ?? quote.service).trim() !== '';
      const currencyKnown = userConfirmed.currency || (quote.currency !== undefined && quote.currency !== null && String(quote.currency).trim() !== '');
      const taxKnown = userConfirmed.taxBasis || quote.taxIncluded !== undefined;
      return {
        vendor: String(quote.vendor ?? '未命名'), unit, qty, impl, maintenance, training, years, tco, missing,
        scope: scopeKnown ? String(quote.scope ?? quote.product ?? quote.service ?? input.scope) : '未声明范围',
        currency: currencyKnown ? String(quote.currency ?? input.currency) : '未声明币种',
        taxBasis: taxKnown ? (quote.taxIncluded !== undefined ? (quote.taxIncluded ? '含税' : '不含税') : String(input.taxBasis ?? input.tax)) : '未声明税费口径',
        scopeKnown, currencyKnown, taxKnown,
      };
    }).sort((a, b) => (a.tco ?? Infinity) - (b.tco ?? Infinity));
    const priced = calculated.filter((item) => item.tco !== null);
    // Comparison basis: quantity, scope, years, currency and tax treatment must
    // all be CONFIRMED CONSISTENT before any overall preference is allowed.
    // Three states per field: consistent / different / unknown. Two vendors
    // both missing a field is "unknown", never "consistent".
    const classify = (name, values) => {
      const known = values.filter((item) => item.known);
      const labels = values.map((item) => (item.known ? String(item.value) : '未声明'));
      if (known.length === 0) return { name, status: 'unknown', values: labels, note: '双方均未声明，不能视为一致' };
      if (known.length < values.length) return { name, status: 'unknown', values: labels, note: '一方未声明，无法确认一致' };
      const unique = [...new Set(known.map((item) => String(item.value)))];
      if (unique.length > 1) return { name, status: 'different', values: unique, note: '声明不同' };
      return { name, status: 'consistent', values: unique, note: userConfirmed[name === '年限' ? 'years' : name === '币种' ? 'currency' : name === '税费' ? 'taxBasis' : name === '服务范围' ? 'scope' : 'quantity'] ? '已由你确认一致' : '已确认一致' };
    };
    const basisFields = [
      classify('数量', priced.map((item) => ({ known: item.qty !== null, value: item.qty }))),
      classify('服务范围', priced.map((item) => ({ known: item.scopeKnown, value: item.scope }))),
      classify('年限', priced.map(() => ({ known: userConfirmed.years, value: years }))),
      classify('币种', priced.map((item) => ({ known: item.currencyKnown, value: item.currency }))),
      classify('税费', priced.map((item) => ({ known: item.taxKnown, value: item.taxBasis }))),
    ];
    const differences = basisFields.filter((item) => item.status === 'different')
      .map((item) => (item.name === '数量' ? `数量不同（${item.values.join(' 与 ')}）` : `${item.name}不同（${item.values.join('、')}）`));
    const basisPending = basisFields.filter((item) => item.status === 'unknown').map((item) => item.name);
    const currencyDifferent = basisFields.find((item) => item.name === '币种')?.status === 'different';
    if (currencyDifferent) differences.push('币种不同且未提供换算依据，不能混算');
    // Comparable only when every key basis field is confirmed consistent.
    const comparable = basisFields.every((item) => item.status === 'consistent') && priced.length >= 2;
    const needsConfirmation = !comparable && priced.length > 0;
    const basisAssumptions = basisFields
      .filter((item) => item.status === 'consistent' && /你确认/.test(item.note))
      .map((item) => `${item.name}按你确认的「${item.values[0]}」计算，未经对方报价单核实`);
    const cheapest = priced[0] ?? null;
    const second = priced[1] ?? null;
    const gap = cheapest && second ? Number((second.tco - cheapest.tco).toFixed(2)) : null;
    const incomplete = calculated.filter((item) => item.tco === null);
    const basisLines = [
      `计算公式：TCO = 单价 × 数量 + 实施费 + 年维护 × ${years} 年 + 培训费；缺失字段不参与估算。`,
      `比较口径：${basisFields.map((item) => `${item.name} ${item.status === 'unknown' ? '未声明（待确认）' : item.values.join('、')}`).join('；')}。`,
      ...(basisAssumptions.length > 0 ? [`假设与适用条件：${basisAssumptions.join('；')}。`] : []),
    ];
    const content = {
      title: '总成本（TCO）测算',
      sections: [
        { heading: '测算口径与计算依据', paragraphs: basisLines },
        ...(differences.length > 0 ? [{ heading: '口径差异（需确认）', bullets: differences.map((item) => `本次报价${item}，金额汇总不等于同口径比较。`) }] : []),
        ...(basisPending.length > 0 ? [{ heading: '待确认口径', bullets: basisPending.map((item) => `${item}未声明：金额按各自报价计算，确认前不给出总体优选结论。`) }] : []),
      ],
      tables: [{
        name: comparable ? 'TCO 比较（同口径）' : 'TCO 比较（按各自报价计算）',
        columns: ['供应商', '单价', '数量', '实施费', '年维护', 'TCO', '范围', '币种', '税费', '缺失项/待确认'],
        rows: calculated.map((item) => [item.vendor, item.unit ?? '未提供', item.qty ?? '未提供', item.impl, item.maintenance, item.tco ?? '无法计算', item.scope, item.currency, item.taxBasis, [...item.missing, ...basisPending.map((name) => `${name}未确认`)].join('、') || '无']),
      }],
      citations: [],
    };
    const artifacts = input.format && context.deliver ? [await context.deliver({ format: input.format, filename: input.filename, content })] : [];
    const premise = basisFields.filter((item) => item.status === 'consistent').map((item) => `${item.name} ${item.values.join('、')}`);
    let conclusion;
    if (priced.length === 0) {
      conclusion = '报价缺少单价或数量，暂时无法计算总成本；补充后可继续比较。';
    } else if (differences.length > 0) {
      conclusion = `已按各自报价算出金额（${priced.map((item) => `${item.vendor} ${item.tco}`).join('，')}），但报价口径不一致：${differences.join('；')}，因此不给出总体优选结论。确认口径（或补齐换算依据）后，可再生成同口径结论。`;
    } else if (basisPending.length > 0) {
      conclusion = `金额计算完成（${priced.map((item) => `${item.vendor} ${item.tco}`).join('，')}），比较待确认：${basisPending.join('、')}未声明。双方均未声明的口径不能视为一致；在结果页确认这些口径后，可在原任务上给出同口径结论。`;
    } else {
      conclusion = `在已确认一致的口径（${premise.join('；')}）下，${cheapest.vendor} 总成本最低（${cheapest.tco}）${second ? `，与 ${second.vendor} 相差 ${gap}` : ''}。${basisAssumptions.length > 0 ? `注意：${basisAssumptions.join('；')}。` : ''}${incomplete.length > 0 ? `另有 ${incomplete.length} 家因 ${incomplete.map((item) => item.missing.join('、')).join('；')} 缺失未参与比较。` : ''}`;
    }
    return {
      ok: true,
      structured: {
        years, calculated, comparable, basisDifferences: differences, needsConfirmation,
        basisFields, basisPending, basisAssumptions,
        basisConfirmed: basisFields.every((item) => item.status === 'consistent'),
      },
      evidence: {
        ...emptyEvidence(),
        facts: priced.map((item) => ({ statement: `${item.vendor}：按 ${years} 年、${item.currency}、${item.taxBasis} 计算的总成本 ${item.tco}` })),
        unknowns: [
          ...calculated.filter((item) => item.tco === null).map((item) => ({ statement: `${item.vendor} 缺少 ${item.missing.join('、')}，无法计算` })),
          ...(differences.length > 0 ? [{ statement: `报价口径不一致：${differences.join('；')}，未确认前不作总体优选` }] : []),
          ...(basisPending.length > 0 ? [{ statement: `口径未声明（待确认）：${basisPending.join('、')}；双方均未声明不视为一致` }] : []),
        ],
        recommendations: [
          { statement: '总成本仅为测算依据，供应商选择由用户决定' },
          ...(needsConfirmation ? [{ statement: `在结果页确认口径（${[...basisPending, ...(differences.length ? ['差异项'] : [])].join('、')}）后，可在原任务上给出同口径结论` }] : []),
        ],
      },
      citations: [],
      artifacts,
      unknowns: [
        ...calculated.filter((item) => item.tco === null).map((item) => ({ field: item.vendor, hint: item.missing.join('、') })),
        ...(differences.length > 0 ? [{ field: '比较口径', hint: differences.join('；') }] : []),
        ...(basisPending.length > 0 ? [{ field: '比较口径', hint: `${basisPending.join('、')}未声明，待确认` }] : []),
      ],
      content,
      message: conclusion,
    };
  };
  e['procurement.risk'] = structured('履约风险评估', [{ name: 'vendors', label: '供应商', hint: '提供供应商与履约信息' }], (input) => ({ summary: '记录风险、证据与缓解措施；未获得履约数据时明确为待核实。', structured: {}, tables: [{ name: '风险台账', columns: ['供应商', '风险', '证据', '缓解'], rows: (input.vendors ?? []).map((vendor) => [asText(vendor.name ?? vendor), asText(vendor.risk ?? '待核实'), asText(vendor.evidence ?? '未提供'), asText(vendor.mitigation ?? '待确认')]) }] }));
  e['procurement.report'] = structured('采购评估报告', [{ name: 'quotes', label: '报价比较结果', hint: '提供比较与 TCO 结果' }], (input) => ({ summary: '汇总需求、候选、比较、总成本与风险，保留证据和未知项。', structured: {}, tables: [{ name: '评估摘要', columns: ['维度', '结论', '依据'], rows: [['技术', asText(input.technicalConclusion ?? '待确认'), '比较表'], ['商务', asText(input.commercialConclusion ?? '待确认'), '报价表'], ['总成本', asText(input.tcoConclusion ?? '待确认'), 'TCO 测算'], ['风险', asText(input.riskConclusion ?? '待确认'), '风险台账']] }] }));

  // ── 企业数据治理 ───────────────────────────────────────────────────────
  e['governance.inventory'] = async (input, context) => {
    const samples = Array.isArray(input.samples) ? input.samples : [];
    const assets = samples.map((sample) => {
      const fields = Array.isArray(sample.fields) ? sample.fields : Object.keys(sample.rows?.[0] ?? {});
      return { name: String(sample.name ?? '未命名资产'), fieldCount: fields.length, fields, sampleRows: Array.isArray(sample.rows) ? sample.rows.length : 0 };
    });
    const content = { title: '数据资产盘点（样本范围）', sections: [{ heading: '范围声明', paragraphs: [`仅基于本次提供的 ${samples.length} 份样本；未接入数据源，因此没有全量扫描、血缘发现或权限治理结论。`] }], tables: [{ name: '资产清单', columns: ['资产', '字段数', '样本行数', '字段'], rows: assets.map((asset) => [asset.name, asset.fieldCount, asset.sampleRows, asset.fields.join('、')]) }], citations: [] };
    const artifacts = input.format && context.deliver ? [await context.deliver({ format: input.format, filename: input.filename, content })] : [];
    return { ok: true, structured: { assets, verifiedScope: 'provided_samples_only', fullScan: false, lineageDiscovered: false, permissionGovernance: false }, evidence: { ...emptyEvidence(), facts: assets.map((asset) => ({ statement: `${asset.name}：${asset.fieldCount} 个字段、${asset.sampleRows} 行样本` })), unknowns: samples.length === 0 ? [{ statement: '未提供样本，无法盘点' }] : [{ statement: '全量资产清单、血缘与权限现状需接入数据源后另行验证' }] }, citations: [], artifacts, unknowns: [], content, message: '仅报告样本范围的已验证能力；未宣称全量扫描/血缘/权限治理' };
  };
  e['governance.catalog'] = structured('数据资产目录', [{ name: 'assets', label: '资产清单', hint: '提供盘点结果' }], (input) => ({ summary: '生成目录条目、责任人与更新频率建议；未确认项标注为规划。', structured: { verifiedScope: 'provided_assets' }, tables: [{ name: '目录', columns: ['资产', '责任人', '更新频率', '状态'], rows: (Array.isArray(input.assets) ? input.assets : []).map((asset) => [asText(asset.name ?? asset), asText(asset.owner ?? '待指定'), asText(asset.refresh ?? '待确认'), '规划建议']) }] }));
  e['governance.standards'] = structured('数据标准建议', [{ name: 'assets', label: '资产清单', hint: '提供资产与字段' }], (input) => ({ summary: '字段命名、类型与取值规范建议；均为规划，不宣称已落地。', structured: { status: 'proposal' }, tables: [{ name: '标准建议', columns: ['对象', '规则', '状态'], rows: (Array.isArray(input.rules) ? input.rules : []).map((rule) => [asText(rule.object ?? ''), asText(rule.rule ?? rule), '规划建议']) }] }));
  e['governance.qualityRules'] = structured('质量规则', [{ name: 'assets', label: '资产清单', hint: '提供资产与字段' }], (input) => ({ summary: '按字段定义完整性、唯一性、有效性规则；可对接 data.quality 实际执行。', structured: { executableVia: 'data.quality' }, tables: [{ name: '质量规则', columns: ['字段', '规则', '阈值', '验证方式'], rows: (Array.isArray(input.fields) ? input.fields : []).map((field) => [asText(field.name ?? field), '非空/唯一/范围（按实际数据）', '待确认', 'data.quality 样本计算']) }] }));
  e['governance.classification'] = structured('分类分级建议', [{ name: 'assets', label: '资产清单', hint: '提供资产与样本' }], (input) => ({ summary: '给出分类分级建议及依据；权限控制实施状态明确为未验证。', structured: { permissionGovernanceVerified: false }, tables: [{ name: '分类分级建议', columns: ['资产', '建议级别', '依据', '实施状态'], rows: (Array.isArray(input.assets) ? input.assets : []).map((asset) => [asText(asset.name ?? asset), asText(asset.level ?? '待评估'), asText(asset.basis ?? '待确认'), '建议，未实施验证']) }] }));
  e['governance.roadmap'] = structured('数据治理路线图', [{ name: 'assets', label: '现状', hint: '提供盘点与问题' }], (input) => ({ summary: '区分已验证能力（样本盘点、规则计算）与规划建议（血缘、权限、全量扫描）。', structured: { verified: ['样本资产盘点', '字段质量规则计算'], planned: ['全量资产发现', '血缘分析', '权限治理', '责任体系落地'] }, tables: [{ name: '路线图', columns: ['阶段', '工作', '类别', '前置条件'], rows: [['一', '样本盘点与目录', '已验证能力', '本次样本'], ['二', '标准与质量规则', '已验证能力', '字段清单'], ['三', '全量资产发现', '规划建议', '接入数据源'], ['四', '血缘与权限治理', '规划建议', '接入元数据与权限系统']] }] }));

  return e;
}
