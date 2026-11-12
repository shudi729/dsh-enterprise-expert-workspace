/**
 * Single source of truth for the capability catalog. `scripts/build-assets.js`
 * turns this into shipped SKILL.md packages; `scripts/verify-matrix.js` checks
 * that the matrix, the catalog and the registered executors agree.
 *
 * `source.kind`: migrated = restored from an existing expert package;
 *                new = authored from this task's business requirements and
 *                reliable local material (never claimed as a restored package).
 */

const skill = (name, description, executor, domain, inputs = [], extra = {}) => ({
  name,
  description,
  executor,
  domain,
  version: '1.0.0',
  inputs: inputs.map(([field, hint, required = true, type = 'string']) => ({ name: field, hint, required, type })),
  outputs: extra.outputs ?? ['结构化结果', '依据与未知项', '可选成果文件'],
  steps: extra.steps ?? ['校验必要输入', '读取知识/工具', '执行计算或整理', '分离事实与未知', '生成并校验成果'],
  acceptance: extra.acceptance ?? ['事实、假设、建议、待核实项分离', '引用可回到原文', '成果文件真实可打开'],
  resources: extra.resources ?? [],
  whenToUse: extra.whenToUse ?? description,
  invocation: { modelInvocable: true, userInvocable: true },
});

const node = (id, skillName, options = {}) => ({ id, skill: skillName, requires: options.requires ?? [], input: options.input ?? {}, produces: options.produces ?? [], ...options.extra });
const flow = (id, name, expertId, input, nodes, acceptance) => ({
  id, name, expertId,
  input: input.map(([field, hint, required = true]) => ({ name: field, hint, required })),
  nodes,
  acceptance,
  finalTaskStatus: 'completed',
});

export const experts = [
  {
    id: 'knowledge-management', name: '企业经验与知识管理专家', domains: ['knowledge-management'],
    keywords: ['复盘', '经验', '知识', '案例', '制度', '标准作业流程', 'SOP', '沉淀', '入库'],
    scenarios: ['项目资料整理', '经验卡', '知识更新', '案例复盘'],
    skills: ['km-review', 'km-case-card', 'km-sop', 'km-publish', 'knowledge-retrieve', 'knowledge-ingest'],
    deliverables: ['案例卡', '知识条目', '标准作业流程', '复盘报告'],
    knowledgeDomains: ['knowledge-management', 'sales-method'],
    tools: ['knowledge.search', 'knowledge.import', 'knowledge.verify', 'files.generate', 'tasks.update'],
    requiredInputs: [{ name: 'material', hint: '项目资料或待整理文本', required: true }],
    defaultOutputForm: 'markdown',
    acceptance: ['知识引用可回到原文', '待核实内容不自动成为可信规则', '成果含版本与来源'],
    source: { kind: 'public', basis: ['内置公开能力'], note: '公共发布版采用可移植内置能力' },
  },
  {
    id: 'hr', name: 'HR 工作台专家', domains: ['hr'],
    keywords: ['招聘', '岗位', '简历', '面试', '入职', '培训', '绩效', '候选人', 'JD'],
    scenarios: ['岗位分析', '招聘材料', '候选人评估', '入职培养'],
    skills: ['hr-job-analysis', 'hr-jd', 'hr-resume-extract', 'hr-compare-candidates', 'hr-interview-design', 'hr-onboarding'],
    deliverables: ['岗位说明书', '候选人对比表', '面试提纲', '入职培养计划'],
    knowledgeDomains: ['hr', 'knowledge-management'],
    tools: ['files.read', 'files.generate', 'knowledge.search', 'tasks.update'],
    requiredInputs: [{ name: 'role', hint: '岗位名称', required: true }],
    defaultOutputForm: 'docx',
    acceptance: ['评估输出依据与适用条件', '录用/绩效判断标注为用户决定', '简历未识别字段列为未知'],
    source: { kind: 'public', basis: ['内置公开能力'], note: '公共发布版采用可移植内置能力' },
  },
  {
    id: 'personal-workbench', name: '个人与岗位工作台专家', domains: ['personal'],
    keywords: ['目标', '任务计划', '优先级', '周报', '月报', '复盘', '会议', '行动清单', '岗位职责'],
    scenarios: ['目标拆解', '周月计划', '会议行动', '工作复盘'],
    skills: ['personal-goal-breakdown', 'personal-weekly-plan', 'personal-meeting-actions', 'personal-review', 'personal-report', 'task-plan', 'task-actions'],
    deliverables: ['任务计划', '行动清单', '周月复盘', '工作报告'],
    knowledgeDomains: ['personal', 'knowledge-management'],
    tools: ['tasks.update', 'files.generate', 'knowledge.search'],
    requiredInputs: [{ name: 'goal', hint: '岗位或个人目标', required: true }],
    defaultOutputForm: 'markdown',
    acceptance: ['任务含优先级与验收条件', '未给责任/时间的项列为待确认'],
    source: { kind: 'public', basis: ['内置公开能力'], note: '公共发布版采用可移植内置能力' },
  },
  {
    id: 'management', name: '企业经营管理专家', domains: ['management'],
    keywords: ['经营', '指标', '诊断', '流程', '制度', '项目推进', '职责', '管理复盘', '改进计划'],
    scenarios: ['经营数据诊断', '问题分析', '流程制度', '责任协作'],
    skills: ['management-diagnose', 'management-improve-plan', 'management-responsibility', 'management-report'],
    deliverables: ['经营诊断表', '改进计划', '职责矩阵', '经营报告'],
    knowledgeDomains: ['management', 'knowledge-management'],
    tools: ['data.metrics', 'data.compare', 'files.generate', 'tasks.update'],
    requiredInputs: [{ name: 'metrics', hint: '经营指标（含 target/actual）', required: true }],
    defaultOutputForm: 'xlsx',
    acceptance: ['偏差由真实数值计算', '缺数值的指标不推断', '改进计划含责任与复查'],
    source: { kind: 'public', basis: ['内置公开能力'], note: '公共发布版采用可移植内置能力' },
  },
  {
    id: 'key-account-sales', name: '大客户销售专家', domains: ['sales'],
    keywords: ['客户', '商机', '获客', '拜访', 'POC', '投标', '谈判', '回款', '续约', '关键角色', '销售辅导'],
    scenarios: ['客户研究', '商机评估', '方案与拜访', '采购投标', '交付回款'],
    skills: ['sales-account-research', 'sales-opportunity-card', 'sales-visit-plan', 'sales-material', 'sales-coach'],
    deliverables: ['客户分析', '商机卡', '拜访计划', '销售材料'],
    knowledgeDomains: ['sales-method', 'sales-cases'],
    tools: ['knowledge.search', 'files.generate', 'tasks.update'],
    requiredInputs: [{ name: 'customer', hint: '客户名称', required: true }],
    defaultOutputForm: 'docx',
    acceptance: ['事实与假设分离', '商机字段不套用其它领域模板', '引用回到销售原文'],
    source: { kind: 'public', basis: ['原创公开销售工作流'], note: '公共发布版不包含迁移原文或书籍摘录' },
  },
  {
    id: 'market-research', name: '市场与商业研究专家', domains: ['research'],
    keywords: ['行业', '政策', '竞品', '竞争对手', '市场机会', '情报', '简报', '研究报告'],
    scenarios: ['行业研究', '企业研究', '竞品比较', '客户简报'],
    skills: ['research-plan', 'research-collect', 'research-verify', 'research-report', 'research-opportunities'],
    deliverables: ['行业报告', '客户简报', '竞品比较', '机会清单'],
    knowledgeDomains: ['market-intelligence', 'sales-method'],
    tools: ['knowledge.search', 'knowledge.import', 'files.generate'],
    requiredInputs: [{ name: 'question', hint: '研究问题', required: true }],
    defaultOutputForm: 'markdown',
    acceptance: ['每条结论标注来源与证据', '未核实情报不写成事实', '报告可回溯到原文'],
    source: { kind: 'public', basis: ['内置公开能力'], note: '公共发布版采用可移植内置能力' },
  },
  {
    id: 'data-analysis', name: '数据分析专家', domains: ['data-analysis'],
    keywords: ['数据', '导入', '字段', '清洗', '数据质量', '指标', '同比', '图表', '可视化', 'CSV', 'Excel'],
    scenarios: ['文件导入', '质量检查', '指标计算', '比较分析', '结论解释'],
    skills: ['data-profile', 'data-clean', 'data-quality', 'data-metrics', 'data-compare', 'data-chart', 'analysis-conclusion', 'report-build'],
    deliverables: ['处理记录', '质量报告', '指标表', '图表与可复核表格', '分析报告'],
    knowledgeDomains: ['data-analysis'],
    tools: ['files.read', 'files.generate', 'data.metrics'],
    requiredInputs: [{ name: 'rows', hint: '表格数据（rows 或 csv）', required: true }],
    defaultOutputForm: 'xlsx',
    acceptance: ['指标由输入实际计算', '清洗有可复核记录', '结论区分统计事实与业务归因'],
    source: { kind: 'public', basis: ['内置公开能力'], note: '公共发布版采用可移植内置能力' },
  },
  {
    id: 'document-office', name: '文档与办公处理专家', domains: ['document'],
    keywords: ['文档', '提取', '比较', '写作', '模板', '表格', '演示', 'PPT', 'Word', '导出', 'PDF'],
    scenarios: ['资料提取', '文档比较', '模板填充', '材料导出'],
    skills: ['document-extract', 'document-compare', 'document-template-fill', 'document-compose', 'document-deliver'],
    deliverables: ['Markdown/TXT/CSV/JSON/PDF/DOCX/XLSX/PPTX 成果'],
    knowledgeDomains: ['document'],
    tools: ['files.read', 'files.generate', 'files.verify'],
    requiredInputs: [{ name: 'material', hint: '输入资料或 path', required: true }],
    defaultOutputForm: 'docx',
    acceptance: ['逐项标明格式支持操作', '生成文件真实可打开且回读校验', '模板有结构与字段要求'],
    source: { kind: 'public', basis: ['内置公开能力'], note: '格式能力由本包代码实现' },
  },
  {
    id: 'procurement', name: '采购与供应商管理专家', domains: ['procurement'],
    keywords: ['采购', '供应商', '询报价', '比价', '总成本', 'TCO', '投标', '履约', '评估'],
    scenarios: ['采购需求', '供应商研究', '询报价比较', '履约风险'],
    skills: ['procurement-requirement', 'procurement-vendor-scan', 'procurement-quote-compare', 'procurement-tco', 'procurement-risk', 'procurement-report'],
    deliverables: ['需求清单', '供应商台账', '比价表', 'TCO 测算', '评估报告'],
    knowledgeDomains: ['procurement', 'market-intelligence'],
    tools: ['files.read', 'files.generate', 'knowledge.search'],
    requiredInputs: [{ name: 'requirement', hint: '采购需求说明', required: true }],
    defaultOutputForm: 'xlsx',
    acceptance: ['保留证据与未知项', 'TCO 由报价实际计算', '供应商选择标注为用户决定'],
    source: { kind: 'public', basis: ['内置公开能力'], note: '公共发布版采用可移植内置能力' },
  },
  {
    id: 'data-governance', name: '企业数据治理专家', domains: ['data-governance'],
    keywords: ['数据治理', '资产盘点', '目录', '标准', '质量规则', '分类分级', '责任分工', '血缘', '治理规划'],
    scenarios: ['资产盘点', '目录与标准', '质量规则', '治理路线图'],
    skills: ['governance-inventory', 'governance-catalog', 'governance-standards', 'governance-quality-rules', 'governance-classification', 'governance-roadmap'],
    deliverables: ['资产目录', '标准与规则', '分类分级建议', '治理路线图'],
    knowledgeDomains: ['data-governance'],
    tools: ['data.profile', 'data.quality', 'files.generate'],
    requiredInputs: [{ name: 'samples', hint: '数据样本或现状说明', required: true }],
    defaultOutputForm: 'xlsx',
    acceptance: ['区分已验证能力与规划建议', '无接入证据不宣称全量扫描/血缘/权限治理'],
    source: { kind: 'public', basis: ['内置公开能力'], note: '公共发布版采用可移植内置能力' },
  },
];

export const skills = [
  // Shared capabilities — implemented once, reused by every expert.
  skill('knowledge-retrieve', '可靠文本检索并返回可回溯引用', 'knowledge.retrieve', 'shared', [['query', '检索词']]),
  skill('knowledge-ingest', '导入资料为待核实知识并去重', 'knowledge.ingest', 'shared', [['title', '条目标题'], ['text', '正文']]),
  skill('knowledge-verify', '按用户判断更新知识可信级别', 'knowledge.verify', 'shared', [['docId', '知识条目 ID']]),
  skill('task-plan', '目标拆解与优先级', 'task.plan', 'shared', [['goal', '目标']]),
  skill('task-actions', '会议行动清单', 'task.actions', 'shared', [['meetingNotes', '会议纪要']]),
  skill('task-review', '周月复盘', 'task.review', 'shared', [['goal', '目标'], ['feedback', '执行反馈', false]]),
  skill('report-build', '按章节与引用组装综合报告', 'report.build', 'shared', [['title', '报告标题']]),
  skill('external-confirm', '记录外部操作的显式确认点', 'external.confirm', 'shared', [['action', '待确认的外部操作']]),

  // KM
  skill('km-review', '项目资料复盘：背景、决策、结果、经验', 'km.review', 'knowledge-management', [['project', '项目名称'], ['material', '项目资料']]),
  skill('km-case-card', '生成含适用条件的经验卡', 'km.caseCard', 'knowledge-management', [['project', '项目名称'], ['material', '案例材料']]),
  skill('km-sop', '从已验证材料提炼标准作业流程', 'km.sop', 'knowledge-management', [['material', '流程材料']], { resources: [] }),
  skill('km-publish', '审核并把知识条目设为可信', 'km.publish', 'knowledge-management', [['docId', '知识条目 ID']]),

  // HR
  skill('hr-job-analysis', '岗位分析：职责、能力、评估维度', 'hr.jobAnalysis', 'hr', [['role', '岗位名称'], ['responsibilities', '职责清单']]),
  skill('hr-jd', '生成岗位说明书并核对字段', 'hr.jd', 'hr', [['role', '岗位名称'], ['requirements', '任职要求']]),
  skill('hr-resume-extract', '从简历文本真实提取字段', 'hr.resumeExtract', 'hr', [['resumeText', '简历文本']]),
  skill('hr-compare-candidates', '按维度加权计算候选人对比', 'hr.compareCandidates', 'hr', [['candidates', '候选人数组（含 scores）']]),
  skill('hr-interview-design', '生成面试问题、评分锚点与记录栏', 'hr.interviewDesign', 'hr', [['role', '岗位名称'], ['criteria', '评估维度']]),
  skill('hr-onboarding', '入职与培养阶段计划', 'hr.onboarding', 'hr', [['role', '岗位名称']]),

  // Personal workbench
  skill('personal-goal-breakdown', '岗位目标拆解为可执行任务', 'personal.goalBreakdown', 'personal', [['goal', '目标']]),
  skill('personal-weekly-plan', '生成周计划与执行反馈栏', 'personal.weeklyPlan', 'personal', [['goal', '本周目标']]),
  skill('personal-meeting-actions', '会议行动项与责任截止', 'personal.meetingActions', 'personal', [['meetingNotes', '会议纪要']]),
  skill('personal-review', '周月复盘与偏差记录', 'personal.review', 'personal', [['goal', '目标'], ['feedback', '执行反馈', false]]),
  skill('personal-report', '汇总进展、风险与下一步', 'personal.report', 'personal', [['goal', '目标']]),

  // Management
  skill('management-diagnose', '按 target/actual 计算经营偏差', 'management.diagnose', 'management', [['metrics', '经营指标数组']]),
  skill('management-improve-plan', '问题到改进动作与复查点', 'management.improvePlan', 'management', [['problems', '问题清单']]),
  skill('management-responsibility', '职责协作与验收分解', 'management.responsibility', 'management', [['actions', '行动清单']]),
  skill('management-report', '经营报告', 'management.report', 'management', [['metrics', '经营数据']]),

  // Sales
  skill('sales-account-research', '客户研究与关键角色证据', 'sales.accountResearch', 'sales', [['customer', '客户名称'], ['material', '客户资料']]),
  skill('sales-opportunity-card', '商机卡（阶段/角色/需求/证据/下一步）', 'sales.opportunityCard', 'sales', [['customer', '客户名称']]),
  skill('sales-visit-plan', '拜访目标与需验证信息', 'sales.visitPlan', 'sales', [['customer', '客户名称'], ['objective', '拜访目标']]),
  skill('sales-material', '客户问题—证据—判断—行动材料', 'sales.material', 'sales', [['customer', '客户名称'], ['material', '素材与证据']]),
  skill('sales-coach', '销售团队辅导清单', 'sales.coach', 'sales', [['opportunities', '商机清单']]),

  // Market research
  skill('research-plan', '研究问题、范围与核验标准', 'research.plan', 'research', [['question', '研究问题']]),
  skill('research-collect', '来源台账与可回溯性检查', 'research.collect', 'research', [['sources', '来源条目']]),
  skill('research-verify', '逐条核验结论的来源与证据', 'research.verify', 'research', [['claims', '待核验结论']]),
  skill('research-report', '行业与客户研究报告', 'research.report', 'research', [['question', '研究问题']]),
  skill('research-opportunities', '市场机会清单与证据强度', 'research.opportunities', 'research', [['signals', '市场信号']]),

  // Data analysis
  skill('data-profile', '字段识别、类型与缺失率', 'data.profile', 'data-analysis', [['rows', '表格数据']]),
  skill('data-clean', '清洗并输出可复核处理记录', 'data.clean', 'data-analysis', [['rows', '表格数据']]),
  skill('data-quality', '数据质量检查', 'data.quality', 'data-analysis', [['rows', '表格数据']]),
  skill('data-metrics', '指标计算与分组比较', 'data.metrics', 'data-analysis', [['rows', '表格数据'], ['field', '数值字段', false]]),
  skill('data-compare', '两份表格比较', 'data.compare', 'data-analysis', [['rows', 'A 表数据'], ['rightRows', 'B 表数据']]),
  skill('data-chart', '条形图与可复核数据表', 'data.chart', 'data-analysis', [['rows', '表格数据']]),
  skill('analysis-conclusion', '解释指标并区分统计事实与归因', 'analysis.conclusion', 'data-analysis', [['metrics', '指标结果']]),

  // Document office
  skill('document-extract', '真实读取文件并提取文本/表格', 'document.extract', 'document', [['path', '文件路径']]),
  skill('document-compare', '逐行比较两份文本', 'document.compare', 'document', [['leftText', '文本 A'], ['rightText', '文本 B', false]]),
  skill('document-template-fill', '模板字段填充与质量检查', 'document.templateFill', 'document', [['material', '输入资料']]),
  skill('document-compose', '文档整理与写作', 'document.compose', 'document', [['material', '输入资料']]),
  skill('document-deliver', '生成并回读校验成果文件', 'document.deliver', 'document', [['title', '成果标题']]),

  // Procurement
  skill('procurement-requirement', '采购需求拆分', 'procurement.requirement', 'procurement', [['requirement', '需求说明']]),
  skill('procurement-vendor-scan', '供应商台账与证据状态', 'procurement.vendorScan', 'procurement', [['vendors', '候选供应商']]),
  skill('procurement-quote-compare', '询报价整理与比较表', 'procurement.quoteCompare', 'procurement', [['quotes', '报价数组']]),
  skill('procurement-tco', '按报价字段实际计算总成本', 'procurement.tco', 'procurement', [['quotes', '报价数组']]),
  skill('procurement-risk', '履约风险台账', 'procurement.risk', 'procurement', [['vendors', '供应商与履约信息']]),
  skill('procurement-report', '采购评估报告', 'procurement.report', 'procurement', [['quotes', '报价比较结果']]),

  // Data governance
  skill('governance-inventory', '样本范围的数据资产盘点', 'governance.inventory', 'data-governance', [['samples', '数据样本']]),
  skill('governance-catalog', '数据资产目录', 'governance.catalog', 'data-governance', [['assets', '资产清单']]),
  skill('governance-standards', '数据标准建议', 'governance.standards', 'data-governance', [['assets', '资产清单']]),
  skill('governance-quality-rules', '质量规则定义', 'governance.qualityRules', 'data-governance', [['assets', '资产清单']]),
  skill('governance-classification', '分类分级建议', 'governance.classification', 'data-governance', [['assets', '资产清单']]),
  skill('governance-roadmap', '区分已验证能力与规划的路线图', 'governance.roadmap', 'data-governance', [['assets', '现状']]),
];

const A = {
  standard: ['输入齐全时能调用正确能力', '资料不足时区分事实与未知', '引用可回到原文', '状态可保存并继续', '文件真实可打开', '依赖失败有明确反馈'],
};

export const workflows = [
  // One representative chain per domain.
  flow('km-review-to-sop', '项目资料→复盘→经验卡→审核入库→SOP', 'knowledge-management',
    [['project', '项目名称'], ['material', '项目资料'], ['docId', '待审核知识条目']],
    [node('review', 'km-review'), node('card', 'km-case-card', { requires: ['review'] }), node('publish', 'km-publish', { requires: ['card'], extra: { externalEffect: true, confirmationPrompt: '确认把该经验卡设为可信知识？' } }), node('sop', 'km-sop', { requires: ['publish'] })],
    A.standard),
  flow('hr-recruit', '岗位需求→招聘材料→候选人评估→面试', 'hr',
    [['role', '岗位名称'], ['responsibilities', '职责清单'], ['requirements', '任职要求'], ['candidates', '候选人数组']],
    [node('analysis', 'hr-job-analysis'), node('jd', 'hr-jd', { requires: ['analysis'] }), node('compare', 'hr-compare-candidates', { requires: ['jd'] }), node('interview', 'hr-interview-design', { requires: ['compare'] })],
    A.standard),
  flow('personal-goal-review', '目标→任务→执行反馈→复盘', 'personal-workbench',
    [['goal', '目标'], ['feedback', '执行反馈'], ['meetingNotes', '会议纪要']],
    [node('breakdown', 'personal-goal-breakdown'), node('actions', 'personal-meeting-actions', { requires: ['breakdown'] }), node('review', 'personal-review', { requires: ['actions'] })],
    A.standard),
  flow('management-improve', '经营数据→问题→改进计划→责任与复查', 'management',
    [['metrics', '经营指标'], ['problems', '问题清单'], ['actions', '行动清单']],
    [node('diagnose', 'management-diagnose'), node('plan', 'management-improve-plan', { requires: ['diagnose'] }), node('owners', 'management-responsibility', { requires: ['plan'] }), node('report', 'management-report', { requires: ['owners'] })],
    A.standard),
  flow('sales-opportunity', '客户问题→证据→判断→行动→反馈', 'key-account-sales',
    [['customer', '客户名称'], ['material', '客户资料'], ['objective', '拜访目标']],
    [node('research', 'sales-account-research'), node('card', 'sales-opportunity-card', { requires: ['research'] }), node('visit', 'sales-visit-plan', { requires: ['card'] }), node('material', 'sales-material', { requires: ['visit'] })],
    A.standard),
  flow('research-report', '研究问题→检索→核验→分析→报告', 'market-research',
    [['question', '研究问题'], ['sources', '来源清单'], ['claims', '待核验结论']],
    [node('plan', 'research-plan'), node('collect', 'research-collect', { requires: ['plan'] }), node('verify', 'research-verify', { requires: ['collect'] }), node('report', 'research-report', { requires: ['verify'] })],
    A.standard),
  flow('data-analysis', '原始数据→处理记录→分析→图表→结论', 'data-analysis',
    [['rows', '表格数据'], ['field', '数值字段'], ['metrics', '指标结果']],
    [node('profile', 'data-profile'), node('clean', 'data-clean', { requires: ['profile'] }), node('quality', 'data-quality', { requires: ['clean'] }), node('metrics', 'data-metrics', { requires: ['quality'] }), node('conclusion', 'analysis-conclusion', { requires: ['metrics'] })],
    A.standard),
  flow('document-deliver', '输入资料→提取核实→形成材料→质量检查→导出', 'document-office',
    [['material', '输入资料'], ['leftText', '文本 A'], ['title', '成果标题']],
    [node('compose', 'document-compose'), node('check', 'document-template-fill', { requires: ['compose'] }), node('compare', 'document-compare', { requires: ['check'] }), node('deliver', 'document-deliver', { requires: ['compare'] })],
    A.standard),
  flow('procurement-evaluate', '需求→候选供应商→询报价→比较→评估报告', 'procurement',
    [['requirement', '需求说明'], ['vendors', '候选供应商'], ['quotes', '报价数组']],
    [node('requirement', 'procurement-requirement'), node('scan', 'procurement-vendor-scan', { requires: ['requirement'] }), node('compare', 'procurement-quote-compare', { requires: ['scan'] }), node('tco', 'procurement-tco', { requires: ['compare'] }), node('report', 'procurement-report', { requires: ['tco'] })],
    A.standard),
  flow('governance-plan', '样本与现状→问题盘点→标准与规则→路线图', 'data-governance',
    [['samples', '数据样本'], ['assets', '资产清单']],
    [node('inventory', 'governance-inventory'), node('catalog', 'governance-catalog', { requires: ['inventory'] }), node('rules', 'governance-quality-rules', { requires: ['catalog'] }), node('roadmap', 'governance-roadmap', { requires: ['rules'] })],
    A.standard),

  // Cross-domain chains (structured result + citation handoff).
  flow('cross-hr-onboarding', '招聘与入职：HR→专业考察→岗位入职→知识关联', 'hr',
    [['role', '岗位名称'], ['responsibilities', '职责清单'], ['requirements', '任职要求'], ['candidates', '候选人数组'], ['goal', '入职目标']],
    [node('analysis', 'hr-job-analysis'), node('compare', 'hr-compare-candidates', { requires: ['analysis'] }), node('onboarding', 'hr-onboarding', { requires: ['compare'] }), node('plan', 'personal-goal-breakdown', { requires: ['onboarding'] }), node('knowledge', 'knowledge-retrieve', { requires: ['plan'] })],
    [...A.standard, '结构化结果与引用在专家间实际传递']),
  flow('cross-research-sales', '市场研究与销售推进：证据→机会判断→材料→商机记录', 'market-research',
    [['question', '研究问题'], ['sources', '来源清单'], ['claims', '待核验结论'], ['customer', '客户名称'], ['material', '客户资料']],
    [node('collect', 'research-collect'), node('verify', 'research-verify', { requires: ['collect'] }), node('research', 'sales-account-research', { requires: ['verify'] }), node('card', 'sales-opportunity-card', { requires: ['research'] }), node('material', 'sales-material', { requires: ['card'] })],
    [...A.standard, '市场证据作为销售判断的引用来源']),
  flow('cross-management-improve', '经营分析与改进：指标→诊断→责任行动→复盘入库', 'data-analysis',
    [['rows', '表格数据'], ['field', '数值字段'], ['metrics', '经营指标'], ['problems', '问题清单'], ['actions', '行动清单'], ['material', '复盘材料']],
    [node('metrics', 'data-metrics'), node('diagnose', 'management-diagnose', { requires: ['metrics'] }), node('owners', 'management-responsibility', { requires: ['diagnose'] }), node('plan', 'task-plan', { requires: ['owners'] }), node('review', 'km-review', { requires: ['plan'] })],
    [...A.standard, '指标结果传入经营诊断并继续到复盘']),
];

export const sources = {
  baseline: { globalCli: '0.1.1-rc.2', runtime: '0.2.1-rc.5', npmLatestObserved: '0.2.2-rc.1', contract: 'package.json dsh.bundle.patch' },
  experts: experts.map((expert) => ({ id: expert.id, name: expert.name, ...expert.source })),
  verifiedFacts: [
    '公共发布版包含 10 个专家方向、61 个可调用技能和 13 个工作流',
    '公共发布版不包含本机知识原件、迁移原文或书籍摘录',
    'knowledge-base 的 Host 半为空 apply()，数据仅在浏览器 localStorage，无 Host 检索服务',
    'skills-connectors 已实现 /skills/package 文件包写入路由，Client 上传链路未完成',
    '四个销售 Skill 对包根 references 存在引用依赖，独立复制后引用失效',
  ],
  notRecovered: [
    '第五个历史专家包名称不完整，未找到可确认的文件名，未猜测、未恢复',
    'HR 工作台、采购与供应商管理、企业数据治理未找回原专家包，按任务书新建',
  ],
  assetIndex: 'assets/manifest.json（相对路径 + SHA256 + 来源类型，不含本机绝对路径）',
};

export default { experts, skills, workflows, sources };
