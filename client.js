/**
 * Enterprise AI Expert Workspace — browser half.
 *
 * Ordinary users work in three steps: pick what to do → provide material →
 * read and use the result. Experts, skills, executors and raw JSON stay in the
 * advanced section; every ordinary control calls the real Host API.
 */
window.__ModuleLoader__.load({
  id: 'dsh-enterprise-expert-workspace',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback } = React;
    const PANEL_ID = 'enterprise-expert-workspace';

    const RESPONSIVE_FIX = "\r\n.eew-sectiontitle{flex-wrap:nowrap}\r\n.eew-sectiontitle .eew-h2{flex:0 0 auto;white-space:nowrap}\r\n.eew-sectiontitle .eew-link{white-space:nowrap}";

    /* ------------------------------------------------------------------ */
    /* Vocabulary                                                          */
    /* ------------------------------------------------------------------ */

    const FIELD_LABELS = {
      goal: '目标', customer: '客户名称', stage: '商机阶段', stakeholders: '关键角色', needs: '需求与价值',
      evidence: '事实依据', material: '业务资料', project: '项目名称', role: '岗位名称', position: '岗位',
      responsibilities: '岗位职责', requirements: '任职要求', candidates: '候选人清单', criteria: '评估维度',
      resumeText: '简历正文', query: '检索词', question: '研究问题', sources: '来源清单', claims: '待核验结论',
      rows: '数据表', columns: '列名', field: '数值字段', groupBy: '分组字段', leftText: '文本 A', rightText: '文本 B',
      quotes: '报价清单', vendors: '供应商清单', assets: '资产清单', samples: '数据样本', metrics: '经营指标',
      tasks: '任务清单', actions: '行动清单', problems: '问题清单', title: '成果标题', path: '文件',
      format: '输出格式', filename: '文件名', domain: '知识领域', tags: '标签', text: '正文',
      context: '背景', decisions: '关键决策', outcome: '结果', lessons: '经验教训', feedback: '执行反馈',
      improvement: '改进措施', nextAction: '下一步', objective: '拜访目标', note: '说明',
      rightRows: '第二份数据表', leftRows: '第一份数据表', csv: '数据表',
    };

    const FORMAT_OPTIONS = [
      { value: 'docx', label: 'Word 文档（.docx）' },
      { value: 'xlsx', label: 'Excel 表格（.xlsx）' },
      { value: 'pdf', label: 'PDF 文件（.pdf）' },
      { value: 'md', label: 'Markdown（.md）' },
      { value: 'pptx', label: '演示文稿（.pptx）' },
      { value: 'csv', label: 'CSV 表格（.csv）' },
      { value: 'txt', label: '纯文本（.txt）' },
      { value: 'json', label: '结构化数据（.json）' },
    ];

    const STATUS = {
      draft: { label: '草稿', tone: 'neutral', next: '继续填写后开始' },
      running: { label: '处理中', tone: 'info', next: '处理完成后查看成果' },
      waiting_input: { label: '待补资料', tone: 'warn', next: '补充必要资料后继续' },
      waiting_confirmation: { label: '待确认', tone: 'warn', next: '确认后继续' },
      waiting_external: { label: '等待外部反馈', tone: 'warn', next: '收到反馈后继续' },
      interrupted: { label: '已中断', tone: 'warn', next: '继续未完成的步骤' },
      failed: { label: '未完成', tone: 'danger', next: '查看原因后重做' },
      completed: { label: '已完成', tone: 'ok', next: '查看并使用成果' },
      archived: { label: '已归档', tone: 'neutral', next: '查看成果' },
      cancelled: { label: '已取消', tone: 'neutral', next: '无需操作' },
      partial: { label: '部分完成', tone: 'warn', next: '补齐未完成部分' },
      // Server-side stages that only exist on a dispatch response.
      needs_confirmation: { label: '金额计算完成，比较待确认', tone: 'warn', next: '确认口径后在原任务更新结论' },
      conflict: { label: '提交内容冲突', tone: 'warn', next: '更新原任务或另起一件新工作' },
      continued: { label: '已保存', tone: 'neutral', next: '继续这次工作' },
    };

    const CATEGORIES = ['全部', '人事招聘', '采购供应', '经营分析', '销售客户', '市场研究', '文档办公', '项目复盘', '个人效率', '数据分析', '数据治理'];

    /** Home scenarios: what it does, what material it needs, what you get. */
    const SCENARIOS = [
      { id: 'hr-compare', title: '候选人比较', category: '人事招聘', expertId: 'hr', skillName: 'hr-compare-candidates', goal: '比较候选人并给出录用建议', needs: ['2–5 份简历或评分表', '岗位要求与评估维度'], delivers: ['加权对比表', '录用建议与待确认项'], format: 'docx', action: '开始比较', keywords: ['招聘', '简历', '候选人', '面试', '录用'] },
      { id: 'hr-jd', title: '岗位说明书', category: '人事招聘', expertId: 'hr', skillName: 'hr-jd', goal: '为岗位整理职责、要求与评估标准', needs: ['岗位名称与职责', '任职要求（可口头描述）'], delivers: ['岗位说明书', '面试评估维度'], format: 'docx', action: '生成岗位说明书', keywords: ['JD', '岗位', '职责', '招聘'] },
      { id: 'hr-interview', title: '面试提纲', category: '人事招聘', expertId: 'hr', skillName: 'hr-interview-design', goal: '设计面试问题与评分锚点', needs: ['岗位与评估维度'], delivers: ['面试问题清单', '评分记录表'], format: 'docx', action: '设计面试提纲', keywords: ['面试', '问题', '评分'] },
      { id: 'proc-tco', title: '采购比价', category: '采购供应', expertId: 'procurement', skillName: 'procurement-tco', goal: '比较供应商报价与总成本', needs: ['报价单（Excel/CSV 或粘贴）', '单价、数量、实施与维护费用'], delivers: ['总成本对比表', '高成本项与谈判要点'], format: 'xlsx', action: '开始比价', keywords: ['采购', '供应商', '报价', '比价', '成本'] },
      { id: 'proc-risk', title: '采购履约风险', category: '采购供应', expertId: 'procurement', skillName: 'procurement-risk', goal: '识别供应商履约风险与应对措施', needs: ['供应商清单', '交付与付款条件'], delivers: ['风险台账', '应对与复查建议'], format: 'xlsx', action: '评估风险', keywords: ['采购', '风险', '履约', '供应商'] },
      { id: 'mgmt-diagnose', title: '经营偏差分析', category: '经营分析', expertId: 'management', skillName: 'management-diagnose', goal: '找出经营指标偏差与原因', needs: ['指标表（目标值/实际值）'], delivers: ['偏差对比表', '原因假设与验证动作'], format: 'docx', action: '生成分析', keywords: ['经营', '指标', '偏差', '目标', '分析'] },
      { id: 'mgmt-improve', title: '经营改进计划', category: '经营分析', expertId: 'management', skillName: 'management-improve-plan', goal: '把经营问题变成改进计划与复查点', needs: ['问题清单', '目标与责任分工'], delivers: ['改进计划表', '复查节点'], format: 'docx', action: '制定改进计划', keywords: ['经营', '改进', '计划', '责任'] },
      { id: 'sales-opportunity', title: '客户商机梳理', category: '销售客户', expertId: 'key-account-sales', skillName: 'sales-opportunity-card', goal: '梳理客户商机阶段、角色与下一步', needs: ['客户名称与背景', '沟通记录或需求描述'], delivers: ['商机卡', '关键角色与待验证信息'], format: 'docx', action: '梳理商机', keywords: ['销售', '商机', '客户', '大客户'] },
      { id: 'sales-visit', title: '拜访计划', category: '销售客户', expertId: 'key-account-sales', skillName: 'sales-visit-plan', goal: '制定客户拜访目标与验证清单', needs: ['客户与角色信息', '本次拜访目的'], delivers: ['拜访计划', '需验证信息清单'], format: 'md', action: '生成拜访计划', keywords: ['拜访', '销售', '客户', '计划'] },
      { id: 'research-report', title: '市场研究', category: '市场研究', expertId: 'market-research', skillName: 'research-report', goal: '围绕研究问题形成有来源的结论', needs: ['研究问题', '来源清单或资料'], delivers: ['研究报告', '逐条核验的结论'], format: 'docx', action: '生成研究报告', keywords: ['研究', '市场', '报告', '来源'] },
      { id: 'research-opportunities', title: '市场机会清单', category: '市场研究', expertId: 'market-research', skillName: 'research-opportunities', goal: '筛选市场机会并标注证据强度', needs: ['机会线索或行业资料'], delivers: ['机会清单', '证据强度与下一步'], format: 'xlsx', action: '整理机会', keywords: ['机会', '市场', '研究'] },
      { id: 'doc-compose', title: '文档整理成稿', category: '文档办公', expertId: 'document-office', skillName: 'document-compose', goal: '把资料整理成结构清晰的文档', needs: ['原始资料（Word/PDF/文本）'], delivers: ['整理后的文档', '待确认事项'], format: 'docx', action: '整理文档', keywords: ['文档', '整理', '写作', 'Word', 'PDF'] },
      { id: 'doc-compare', title: '文档对比', category: '文档办公', expertId: 'document-office', skillName: 'document-compare', goal: '比较两份文本的差异并输出对照', needs: ['两份待比较文本'], delivers: ['差异对照表', '需确认的改动'], format: 'docx', action: '开始对比', keywords: ['对比', '差异', '文档'] },
      { id: 'km-review', title: '项目复盘', category: '项目复盘', expertId: 'knowledge-management', skillName: 'km-review', goal: '复盘项目并沉淀可复用经验', needs: ['项目资料（背景、过程、结果）'], delivers: ['复盘报告', '经验卡与入库建议'], format: 'docx', action: '开始复盘', keywords: ['复盘', '项目', '经验', '沉淀'] },
      { id: 'km-case', title: '经验卡沉淀', category: '项目复盘', expertId: 'knowledge-management', skillName: 'km-case-card', goal: '把项目经验整理成带适用条件的经验卡', needs: ['项目资料', '适用场景说明'], delivers: ['经验卡', '适用条件与反例'], format: 'md', action: '生成经验卡', keywords: ['经验', '案例', '沉淀'] },
      { id: 'km-sop', title: '标准作业流程', category: '项目复盘', expertId: 'knowledge-management', skillName: 'km-sop', goal: '从已验证材料提炼标准作业流程', needs: ['已验证的操作材料'], delivers: ['SOP 步骤', '检查点与责任'], format: 'docx', action: '提炼流程', keywords: ['SOP', '流程', '标准', '作业'] },
      { id: 'personal-week', title: '周工作计划', category: '个人效率', expertId: 'personal-workbench', skillName: 'personal-weekly-plan', goal: '把岗位目标拆成本周可执行任务', needs: ['本周目标', '已有任务或约束'], delivers: ['周计划', '优先级与验收条件'], format: 'md', action: '生成周计划', keywords: ['周计划', '任务', '目标', '优先级'] },
      { id: 'personal-actions', title: '会议行动清单', category: '个人效率', expertId: 'personal-workbench', skillName: 'personal-meeting-actions', goal: '把会议记录变成责任明确的行动清单', needs: ['会议记录或要点'], delivers: ['行动清单', '责任人与截止时间'], format: 'md', action: '整理行动项', keywords: ['会议', '行动', '纪要', '待办'] },
      { id: 'data-metrics', title: '数据指标分析', category: '数据分析', expertId: 'data-analysis', skillName: 'data-metrics', goal: '按维度计算指标并解释差异', needs: ['数据表（Excel/CSV）'], delivers: ['分组指标结果', '解释与数据质量说明'], format: 'xlsx', action: '生成分析', keywords: ['数据', '指标', '分析', 'Excel'] },
      { id: 'data-compare', title: '两份数据对比', category: '数据分析', expertId: 'data-analysis', skillName: 'data-compare', goal: '比较两份表格的差异', needs: ['两份数据表'], delivers: ['差异对照表', '异常项说明'], format: 'xlsx', action: '开始对比', keywords: ['数据', '对比', '差异', '表格'] },
      { id: 'gov-catalog', title: '数据资产盘点', category: '数据治理', expertId: 'data-governance', skillName: 'governance-catalog', goal: '盘点数据资产并形成目录', needs: ['资产/表清单（字段、行数）'], delivers: ['资产目录', '口径与缺口清单'], format: 'xlsx', action: '开始盘点', keywords: ['数据治理', '资产', '盘点', '目录'] },
    ];

    const NAV = [
      { id: 'home', label: '开始工作', icon: 'work' },
      { id: 'tasks', label: '我的任务', icon: 'task' },
      { id: 'artifacts', label: '成果库', icon: 'artifact' },
      { id: 'knowledge', label: '知识库', icon: 'knowledge' },
      { id: 'settings', label: '能力与设置', icon: 'settings' },
    ];

    const NAV_GROUPS = [
      { label: '工作', items: NAV.filter((item) => ['home', 'tasks', 'artifacts'].includes(item.id)) },
      { label: '资源', items: NAV.filter((item) => item.id === 'knowledge') },
      { label: '管理', items: NAV.filter((item) => item.id === 'settings') },
    ];

    const DRAFT_KEY = 'eew.draft.v3';
    const RECENT_SCENARIOS_KEY = 'eew.recentScenarios.v1';
    const FAVORITE_SCENARIOS_KEY = 'eew.favoriteScenarios.v1';
    const ACCEPT_UPLOAD = '.docx,.xlsx,.csv,.pdf,.txt,.md,.json,.pptx';
    const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
    const MAX_UPLOAD_FILES = 5;

    /* ------------------------------------------------------------------ */
    /* Styles                                                              */
    /* ------------------------------------------------------------------ */

    const STYLES = ".eew{--eew-accent:#2f6bff;--eew-accent-weak:#eef3ff;--eew-accent-line:#c8d8ff;--eew-bg:#f4f6f9;--eew-surface:#fff;--eew-surface-2:#fafbfc;--eew-line:#e6e9ef;--eew-line-2:#d9dee6;--eew-text:#1c2431;--eew-text-2:#4c5769;--eew-text-3:#687284;--eew-ok:#0f7b52;--eew-ok-weak:#e8f6ef;--eew-warn:#9a6a10;--eew-warn-weak:#fdf4e3;--eew-danger:#b8443a;--eew-danger-weak:#fdeeec;display:flex;flex-direction:column;height:100%;box-sizing:border-box;color:var(--eew-text);font-family:inherit;font-size:13.5px;line-height:1.65;overflow:hidden;background:var(--eew-bg)}\r\n.eew *{box-sizing:border-box}\r\n.eew-scroll{overflow:auto;padding:22px 28px 48px;display:flex;flex-direction:column;gap:22px;min-height:0;flex:1}\r\n.eew-nav{display:flex;align-items:center;gap:26px;padding:0 28px;background:var(--eew-surface);border-bottom:1px solid var(--eew-line);flex-wrap:wrap}\r\n.eew-navgroup{display:flex;align-items:center;gap:2px;flex-wrap:wrap}\r\n.eew-navlabel{font-size:11px;letter-spacing:.08em;color:var(--eew-text-3);padding:12px 2px;font-weight:600}\r\n.eew-nav button{appearance:none;border:none;background:none;color:var(--eew-text-2);font:inherit;font-size:13.5px;padding:10px 2px 12px;margin-right:18px;cursor:pointer;border-bottom:2px solid transparent;display:inline-flex;align-items:center;gap:6px}\r\n.eew-nav button:hover{color:var(--eew-text)}\r\n.eew-nav button.on{color:var(--eew-accent);border-bottom-color:var(--eew-accent);font-weight:600}\r\n.eew-pagehead{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}\r\n.eew-pagehead .t{font-size:20px;font-weight:640;letter-spacing:-.01em;margin:0;color:var(--eew-text)}\r\n.eew-pagehead .d{font-size:13px;color:var(--eew-text-2);margin-top:4px;max-width:64ch}\r\n.eew-pagehead .a{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\r\n.eew-h1{font-size:20px;font-weight:640;letter-spacing:-.01em;margin:0;line-height:1.35;color:var(--eew-text)}\r\n.eew-h2{font-size:15px;font-weight:620;margin:0;line-height:1.45;color:var(--eew-text)}\r\n.eew-h3{font-size:13.5px;font-weight:600;margin:0;line-height:1.5;color:var(--eew-text)}\r\n.eew-sub{font-size:13px;color:var(--eew-text-2);line-height:1.7}\r\n.eew-meta{font-size:12.5px;color:var(--eew-text-3);line-height:1.55}\r\n.eew-card{border:1px solid var(--eew-line);border-radius:12px;padding:16px 18px;background:var(--eew-surface);box-shadow:0 1px 2px rgba(16,24,40,.04)}\r\n.eew-card.plain{background:transparent;border-color:transparent;box-shadow:none;padding:0}\r\n.eew-card.flat{background:var(--eew-surface-2);box-shadow:none}\r\n.eew-sectiontitle{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}\r\n.eew-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}\r\n.eew-row.tight{gap:6px}\\r\\n.eew-correction-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--eew-line);border-radius:10px;background:var(--eew-bg)}\\r\\n\r\n.eew-col{display:flex;flex-direction:column;gap:12px}\r\n.eew-between{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}\r\n.eew-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}\r\n.eew-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}\r\n.eew-split{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:16px;align-items:start}\r\n.eew-split.equal{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}\r\n.eew-input,.eew-select,.eew-area{font:inherit;font-size:13.5px;color:var(--eew-text);padding:9px 11px;border:1px solid var(--eew-line-2);border-radius:8px;background:#fff;box-sizing:border-box;min-width:0}\r\n.eew-input:focus,.eew-select:focus,.eew-area:focus{outline:none;border-color:var(--eew-accent);box-shadow:0 0 0 3px rgba(47,107,255,.14)}\r\n.eew-area{width:100%;min-height:84px;resize:vertical;line-height:1.65}\r\n.eew-btn{font:inherit;font-size:13.5px;font-weight:500;padding:9px 16px;border-radius:8px;border:1px solid transparent;background:var(--eew-accent);color:#fff;cursor:pointer;line-height:1.35;box-shadow:0 1px 2px rgba(47,107,255,.22);display:inline-flex;align-items:center;gap:6px}\r\n.eew-btn:hover{background:#2760ef}\r\n.eew-btn.sec{background:#fff;border-color:var(--eew-line-2);color:var(--eew-text);box-shadow:none}\r\n.eew-btn.sec:hover{background:var(--eew-surface-2);border-color:#c8ced8}\r\n.eew-btn.ghost{background:none;border:none;color:var(--eew-accent);padding:2px 0;font-size:13px;box-shadow:none;font-weight:500}\r\n.eew-btn.ghost:hover{text-decoration:underline}\r\n.eew-btn.warn{background:#fff;border-color:#e3bdb8;color:var(--eew-danger);box-shadow:none}\r\n.eew-btn.warn:hover{background:var(--eew-danger-weak)}\r\n.eew-btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}\r\n.eew-btn:focus-visible,.eew-link:focus-visible,.eew-item:focus-visible,.eew-nav button:focus-visible{outline:2px solid rgba(47,107,255,.5);outline-offset:2px}\r\n.eew-link{appearance:none;background:none;border:none;font:inherit;font-size:12.5px;color:var(--eew-accent);cursor:pointer;padding:0;text-align:left}\r\n.eew-label{font-size:12.5px;color:var(--eew-text-2);min-width:96px}\r\n.eew-field{display:flex;flex-direction:column;gap:6px}\r\n.eew-field > span{font-size:12.5px;color:var(--eew-text-2);font-weight:500}\r\n.eew-field .hint{font-size:12px;color:var(--eew-text-3)}\r\n.eew-field .eew-input,.eew-field .eew-select,.eew-field .eew-area{width:100%}\r\n.eew-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11.5px;line-height:1.7;border:1px solid transparent;white-space:nowrap;font-weight:500}\r\n.eew-pill.neutral{background:#f0f2f6;color:var(--eew-text-2)}\r\n.eew-pill.info{background:var(--eew-accent-weak);color:#2256cc}\r\n.eew-pill.ok{background:var(--eew-ok-weak);color:var(--eew-ok)}\r\n.eew-pill.warn{background:var(--eew-warn-weak);color:var(--eew-warn)}\r\n.eew-pill.danger{background:var(--eew-danger-weak);color:var(--eew-danger)}\r\n.eew-scenario{border:1px solid var(--eew-line);border-radius:12px;padding:10px 12px;display:flex;align-items:stretch;gap:8px;background:var(--eew-surface);font:inherit;color:inherit;box-shadow:0 1px 2px rgba(16,24,40,.04)}\r\n.eew-scenario:hover{border-color:var(--eew-accent-line);box-shadow:0 6px 18px rgba(16,24,40,.08)}\r\n.eew-scenario-main{appearance:none;border:none;background:none;font:inherit;color:inherit;display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;cursor:pointer;text-align:left}\r\n.eew-scenario .t{font-size:14px;font-weight:600;color:var(--eew-text)}\r\n.eew-scenario .p{font-size:12.5px;color:var(--eew-text-2);line-height:1.6}\r\n.eew-scenario .go{font-size:12.5px;color:var(--eew-accent);font-weight:500}\r\n.eew-fav{appearance:none;border:none;background:none;font-size:18px;line-height:1;color:var(--eew-text-3);cursor:pointer;padding:2px 4px;border-radius:8px;align-self:flex-start}\r\n.eew-fav:hover{color:var(--eew-warn)}\r\n.eew-fav[aria-pressed=true]{color:var(--eew-warn)}\r\n.eew-tag{font-size:11.5px;color:var(--eew-text-3);background:#f1f3f7;border-radius:5px;padding:1px 7px;white-space:nowrap}\r\n.eew-item{border:1px solid var(--eew-line);border-radius:11px;padding:12px 14px;background:var(--eew-surface);display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;box-shadow:0 1px 2px rgba(16,24,40,.04)}\r\n.eew-item.click{cursor:pointer;text-align:left;font:inherit;color:inherit;width:100%}\r\n.eew-item.click:hover{border-color:var(--eew-accent-line);box-shadow:0 6px 18px rgba(16,24,40,.07)}\r\n.eew-err{padding:11px 13px;border-radius:10px;background:var(--eew-danger-weak);border:1px solid #f2d5d1;font-size:13px;line-height:1.65;color:#8f3229}\r\n.eew-ok{padding:11px 13px;border-radius:10px;background:var(--eew-ok-weak);border:1px solid #cfe9dd;font-size:13px;line-height:1.65;color:#0b5f3f}\r\n.eew-info{padding:11px 13px;border-radius:10px;background:var(--eew-accent-weak);border:1px solid var(--eew-accent-line);font-size:13px;line-height:1.65;color:#1f4bb0}\r\n.eew-warnbox{padding:11px 13px;border-radius:10px;background:var(--eew-warn-weak);border:1px solid #eddcbb;font-size:13px;line-height:1.65;color:#7d5510}\r\n.eew-table{width:100%;border-collapse:collapse;font-size:13px}\r\n.eew-table th,.eew-table td{padding:9px 10px;text-align:left;vertical-align:top;border-bottom:1px solid #eef0f4}\r\n.eew-table thead th{font-weight:600;color:var(--eew-text-2);background:var(--eew-surface-2);font-size:12.5px;border-bottom:1px solid var(--eew-line)}\r\n.eew-table tbody tr:last-child td{border-bottom:none}\r\n.eew-tablewrap{overflow:auto;border:1px solid var(--eew-line);border-radius:10px;background:#fff}\r\n.eew-pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;white-space:pre-wrap;max-height:340px;overflow:auto;background:var(--eew-surface-2);border:1px solid var(--eew-line);border-radius:10px;padding:12px;line-height:1.7;color:var(--eew-text-2)}\r\n.eew-md{font-size:13.5px;line-height:1.75;color:var(--eew-text)}\r\n.eew-md h1{font-size:17px;font-weight:640;margin:18px 0 8px}\r\n.eew-md h2{font-size:15.5px;font-weight:620;margin:18px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--eew-line)}\r\n.eew-md h3{font-size:14px;font-weight:600;margin:14px 0 6px}\r\n.eew-md h1:first-child,.eew-md h2:first-child,.eew-md h3:first-child{margin-top:0}\r\n.eew-md p{margin:0 0 10px}\r\n.eew-md ul,.eew-md ol{margin:0 0 12px;padding-left:22px}\r\n.eew-md li{margin:3px 0}\r\n.eew-md blockquote{margin:0 0 12px;padding:8px 14px;border-left:3px solid var(--eew-accent-line);background:var(--eew-surface-2);border-radius:0 8px 8px 0;color:var(--eew-text-2)}\r\n.eew-md code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;background:#f1f3f7;padding:1px 5px;border-radius:5px}\r\n.eew-md pre{background:var(--eew-surface-2);border:1px solid var(--eew-line);border-radius:10px;padding:12px 14px;overflow:auto;margin:0 0 12px}\r\n.eew-md pre code{background:none;padding:0;font-size:12px;line-height:1.7}\r\n.eew-md table{width:100%;border-collapse:collapse;margin:0 0 14px;font-size:12.5px}\r\n.eew-md th,.eew-md td{border:1px solid var(--eew-line);padding:7px 9px;text-align:left}\r\n.eew-md th{background:var(--eew-surface-2);font-weight:600}\r\n.eew-md hr{border:none;border-top:1px solid var(--eew-line);margin:16px 0}\r\n.eew-md a{color:var(--eew-accent)}\r\n.eew-steps{display:flex;align-items:center;gap:6px;flex-wrap:wrap}\r\n.eew-step{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--eew-text-3)}\r\n.eew-step .n{width:20px;height:20px;border-radius:50%;background:#eef0f4;color:var(--eew-text-3);display:inline-flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:600}\r\n.eew-step.on{color:var(--eew-text);font-weight:600}\r\n.eew-step.on .n{background:var(--eew-accent);color:#fff}\r\n.eew-step.done .n{background:var(--eew-ok-weak);color:var(--eew-ok)}\r\n.eew-step-sep{width:18px;height:1px;background:var(--eew-line-2)}\r\n.eew-mode{display:inline-flex;background:#eef0f4;border-radius:9px;padding:3px;gap:2px}\r\n.eew-mode button{appearance:none;border:none;background:none;font:inherit;font-size:12.5px;color:var(--eew-text-2);padding:6px 12px;border-radius:7px;cursor:pointer}\r\n.eew-mode button.on{background:#fff;color:var(--eew-text);font-weight:600;box-shadow:0 1px 2px rgba(16,24,40,.08)}\r\n.eew-kpi{display:flex;gap:22px;flex-wrap:wrap}\r\n.eew-kpi .v{font-size:20px;font-weight:640;font-variant-numeric:tabular-nums}\r\n.eew-kpi .l{font-size:12px;color:var(--eew-text-3)}\r\n.eew-empty{padding:26px 20px;text-align:center;color:var(--eew-text-3);font-size:13px;display:flex;flex-direction:column;gap:10px;align-items:center}\r\n.eew-empty .t{font-size:14px;color:var(--eew-text-2);font-weight:600}\r\n.eew-scroll-x{overflow-x:auto}\r\n@media (max-width:760px){.eew-scroll{padding:16px}.eew-split,.eew-split.equal{grid-template-columns:1fr}.eew-cards,.eew-grid{grid-template-columns:1fr}.eew-pagehead{flex-direction:column}.eew-nav{padding:0 16px;gap:14px}.eew-btn{width:100%;justify-content:center}}";

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    async function api(method, url, body) {
      const response = await fetch('/eew' + url, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error('服务暂时不可用（HTTP ' + response.status + '），请稍后重试'); }
      if (!response.ok || !payload.ok) {
        const detail = payload.error || {};
        const error = new Error(detail.message || '操作没有完成，请重试');
        error.code = detail.code; error.details = detail.details; error.hint = detail.hint;
        throw error;
      }
      return payload.result;
    }

    function download(filename, content, mime) {
      const blob = new Blob([content], { type: mime || 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    }

    function formatBytes(bytes) {
      const value = Number(bytes) || 0;
      if (value < 1024) return value + ' B';
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
      return (value / 1024 / 1024).toFixed(1) + ' MB';
    }

    function uuid() {
      if (window.crypto?.randomUUID) return window.crypto.randomUUID();
      return 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function formatTime(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      const pad = (n) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function statusOf(value) { return STATUS[value] ?? { label: value ?? '未知', tone: 'neutral', next: '' }; }

    function businessTitle(task) {
      const goal = String(task?.goal ?? '').trim();
      return goal || '未命名任务';
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('本地读取失败：' + file.name));
        reader.readAsDataURL(file);
      });
    }

    function readAsText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('本地读取失败：' + file.name));
        reader.readAsText(file, 'utf-8');
      });
    }

    function loadDraft() {
      try {
        const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
        return { goal: '', formValues: {}, uploads: [], format: 'docx', expertId: '', skillName: '', workflowId: '', scenarioId: '', actionLabel: '开始处理', taskId: '', ...parsed };
      } catch { return { goal: '', formValues: {}, uploads: [], format: 'docx', expertId: '', skillName: '', workflowId: '', scenarioId: '', actionLabel: '开始处理', taskId: '' }; }
    }

    function saveDraft(draft) {
      try {
        const { result, missing, revision, ...rest } = draft;
        localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
      } catch { /* storage full: draft stays in memory */ }
    }

    function Icon() {
      return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }),
        h('path', { d: 'M7 8h10M7 12h7M7 16h4' }),
        h('circle', { cx: 17, cy: 15, r: 2.3 }));
    }

    /* ------------------------------------------------------------------ */
    /* Icons & page chrome                                                */
    /* ------------------------------------------------------------------ */

    const NAV_ICONS = {
      work: 'M4 5h16v6H4zM4 14h7v6H4zM13 14h7v6h-7z',
      task: 'M4 6h9M4 12h9M4 18h6M17 5l2 2 3-3M17 11l2 2 3-3M17 17l2 2 3-3',
      artifact: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h7M10 17h5',
      knowledge: 'M4 5h6v14H4zM14 5h6v14h-6zM10 8h4M10 12h4',
      settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM4 12h2M18 12h2M12 4v2M12 18v2M7 7l1.4 1.4M15.6 15.6L17 17M17 7l-1.4 1.4M8.4 15.6L7 17',
    };

    function NavIcon({ name }) {
      const d = NAV_ICONS[name];
      if (!d) return null;
      return h('svg', { className: 'eew-navicon', width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'aria-hidden': 'true' },
        h('path', { d, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }

    function PageHeader({ title, description, children }) {
      return h('header', { className: 'eew-pagehead' },
        h('div', null,
          h('h1', { className: 't' }, title),
          description ? h('p', { className: 'd' }, description) : null),
        children ? h('div', { className: 'a' }, ...React.Children.toArray(children)) : null);
    }

    /* ------------------------------------------------------------------ */
    /* Safe Markdown rendering                                            */
    /* ------------------------------------------------------------------ */

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function inlineMarkdown(value) {
      let out = escapeHtml(value);
      out = out.replace(/`([^`]+)`/g, (_, code) => '<code>' + code + '</code>');
      out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, label, href) => '<a href="' + href + '" target="_blank" rel="noreferrer noopener">' + label + '</a>');
      return out;
    }

    /** Markdown → safe HTML (input is escaped first, only our own tags are added). */
    function renderMarkdown(markdown) {
      const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
      const html = [];
      let paragraph = [];
      let listType = null;
      let listItems = [];
      let codeFence = false;
      let codeLines = [];
      let quoteLines = [];

      const flushParagraph = () => {
        if (paragraph.length) { html.push('<p>' + inlineMarkdown(paragraph.join(' ')) + '</p>'); paragraph = []; }
      };
      const flushList = () => {
        if (listType) { html.push('<' + listType + '>' + listItems.join('') + '</' + listType + '>'); listType = null; listItems = []; }
      };
      const flushQuote = () => {
        if (quoteLines.length) { html.push('<blockquote>' + inlineMarkdown(quoteLines.join(' ')) + '</blockquote>'); quoteLines = []; }
      };
      const isTableDivider = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (/^\s*```/.test(line)) {
          flushParagraph(); flushList(); flushQuote();
          if (codeFence) { html.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>'); codeLines = []; codeFence = false; }
          else codeFence = true;
          continue;
        }
        if (codeFence) { codeLines.push(line); continue; }
        if (/^\s*\|.*\|\s*$/.test(line) && isTableDivider(lines[i + 1] ?? '')) {
          flushParagraph(); flushList(); flushQuote();
          const header = line.split('|').map((cell) => cell.trim()).filter((cell, idx, all) => !(idx === 0 && cell === '') && !(idx === all.length - 1 && cell === ''));
          const rows = [];
          i += 2;
          while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
            const cells = lines[i].split('|').map((cell) => cell.trim()).filter((cell, idx, all) => !(idx === 0 && cell === '') && !(idx === all.length - 1 && cell === ''));
            rows.push(cells); i += 1;
          }
          i -= 1;
          html.push('<table><thead><tr>' + header.map((cell) => '<th>' + inlineMarkdown(cell) + '</th>').join('') + '</tr></thead><tbody>' +
            rows.map((row) => '<tr>' + header.map((_, index) => '<td>' + inlineMarkdown(row[index] ?? '') + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
          continue;
        }
        const heading = line.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
          flushParagraph(); flushList(); flushQuote();
          const level = Math.min(4, heading[1].length + 1);
          html.push('<h' + level + '>' + inlineMarkdown(heading[2]) + '</h' + level + '>');
          continue;
        }
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
          flushParagraph(); flushList(); flushQuote();
          html.push('<hr>'); continue;
        }
        const quote = line.match(/^>\s?(.*)$/);
        if (quote) { flushParagraph(); flushList(); quoteLines.push(quote[1]); continue; }
        const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
        const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (bullet || ordered) {
          flushParagraph(); flushQuote();
          const wanted = bullet ? 'ul' : 'ol';
          if (listType && listType !== wanted) flushList();
          listType = wanted;
          listItems.push('<li>' + inlineMarkdown((bullet ?? ordered)[1]) + '</li>');
          continue;
        }
        if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); continue; }
        flushList(); flushQuote();
        paragraph.push(line.trim());
      }
      flushParagraph(); flushList(); flushQuote();
      if (codeFence && codeLines.length) html.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
      return html.join('\n');
    }

    /** Split markdown into titled sections so long analysis can be summarised first. */
    function splitMarkdownSections(markdown) {
      const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
      const sections = [];
      let current = { title: '', body: [] };
      for (const line of lines) {
        const heading = line.match(/^#{1,3}\s+(.*)$/);
        if (heading) {
          if (current.body.length || current.title) sections.push({ title: current.title, body: current.body.join('\n') });
          current = { title: heading[1].trim(), body: [] };
        } else current.body.push(line);
      }
      if (current.body.length || current.title) sections.push({ title: current.title, body: current.body.join('\n') });
      return sections.filter((section) => section.body.trim() || section.title);
    }

    function Notice({ error, notice, busy, empty, busyText }) {
      return h(React.Fragment, null,
        busy ? h('div', { className: 'eew-info', role: 'status' }, busyText || '正在处理，请稍候…') : null,
        error ? h('div', { className: 'eew-err', role: 'alert' }, String(error)) : null,
        notice ? h('div', { className: 'eew-ok', role: 'status' }, String(notice)) : null,
        empty && !busy && !error ? h('div', { className: 'eew-empty' }, empty) : null);
    }

    function Field({ label, value, onChange, placeholder, type, options, rows, hint }) {
      const control = options
        ? h('select', { className: 'eew-select', value: value ?? '', onChange: (e) => onChange(e.target.value) },
          ...options.map((option) => h('option', { key: String(option.value ?? option), value: String(option.value ?? option) }, option.label ?? String(option))))
        : (rows
          ? h('textarea', { className: 'eew-area', value: value ?? '', placeholder, rows: rows || 3, onChange: (e) => onChange(e.target.value) })
          : h('input', { className: 'eew-input', type: type || 'text', value: value ?? '', placeholder, onChange: (e) => onChange(e.target.value) }));
      return h('label', { className: 'eew-field' }, h('span', null, label), control, hint ? h('span', { className: 'eew-meta' }, hint) : null);
    }

    function StatusBadge({ status }) {
      const meta = statusOf(status);
      return h('span', { className: 'eew-pill ' + meta.tone }, meta.label);
    }

    function DataTable({ table }) {
      if (!table) return null;
      return h('div', { className: 'eew-col' },
        table.name ? h('div', { className: 'eew-sub', style: { fontWeight: 600 } }, table.name) : null,
        h('div', { style: { overflowX: 'auto' } },
          h('table', { className: 'eew-table' },
            h('thead', null, h('tr', null, ...(table.columns ?? []).map((column, i) => h('th', { key: i }, String(column))))),
            h('tbody', null, ...(table.rows ?? []).map((row, i) => h('tr', { key: i }, ...row.map((cell, j) => h('td', { key: j }, String(cell ?? '')))))))));
    }

    function Collapse({ title, children, open }) {
      // `children` arrives as a single element, a list or nothing at all;
      // spreading it raw would break the whole panel.
      const items = React.Children.toArray(children);
      return h('details', { className: 'eew-collapse', open: Boolean(open) },
        h('summary', null, title),
        h('div', { className: 'eew-col', style: { marginTop: 8 } }, ...items));
    }

    function useLoad(loader, deps) {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(true);
      const reload = useCallback(() => {
        setBusy(true); setError(null);
        Promise.resolve().then(loader).then(setData).catch((e) => setError(e.message)).finally(() => setBusy(false));
      }, deps);
      useEffect(() => { reload(); }, [reload]);
      return { data, error, busy, reload };
    }

    /* ------------------------------------------------------------------ */
    /* Structured input as tables (no JSON for ordinary users)             */
    /* ------------------------------------------------------------------ */

    const TABLE_SCHEMAS = {
      candidates: [['name', '候选人'], ['scores', '维度分数（专业能力:5，经验:4）']],
      quotes: [['vendor', '供应商'], ['unitPrice', '单价'], ['quantity', '数量'], ['implementation', '实施费'], ['annualMaintenance', '年维护'], ['training', '培训费']],
      metrics: [['name', '指标'], ['target', '目标值'], ['actual', '实际值']],
      claims: [['statement', '结论'], ['source', '来源'], ['evidence', '证据']],
      sources: [['name', '来源名称'], ['url', '链接'], ['summary', '摘要']],
      samples: [['name', '资产/表名'], ['fields', '字段（逗号分隔）'], ['rowCount', '样本行数']],
      tasks: [['name', '任务'], ['priority', '优先级'], ['owner', '负责人']],
      actions: [['name', '行动'], ['owner', '负责人'], ['due', '期限']],
      problems: [['name', '问题'], ['action', '措施']],
      criteria: [['name', '评估维度'], ['weight', '权重']],
      vendors: [['name', '供应商'], ['source', '资料来源']],
      assets: [['name', '资产'], ['owner', '责任人']],
      sections: [['heading', '标题'], ['paragraphs', '正文（用 | 分隔多段）']],
    };
    const MATRIX_FIELDS = new Set(['rows', 'leftRows', 'rightRows', 'csv']);
    const NUMERIC_KEYS = new Set(['unitPrice', 'quantity', 'implementation', 'annualMaintenance', 'training', 'target', 'actual', 'weight', 'rowCount', 'years']);
    const LIST_KEYS = new Set(['fields', 'paragraphs', 'responsibilities', 'columns']);

    function parseDelimited(text) {
      const lines = String(text ?? '').trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) return [];
      const split = (line) => {
        if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
        if (line.includes('|')) return line.split('|').map((cell) => cell.trim()).filter((cell, i, arr) => !(cell === '' && (i === 0 || i === arr.length - 1)));
        return line.split(',').map((cell) => cell.trim());
      };
      return lines.map(split);
    }

    function normalizeTableRow(row) {
      const result = { ...row };
      for (const [key, raw] of Object.entries(result)) {
        if (typeof raw !== 'string') continue;
        const value = raw.trim();
        if (value === '') { delete result[key]; continue; }
        if (NUMERIC_KEYS.has(key)) {
          const number = Number(value);
          if (Number.isFinite(number)) result[key] = number;
        } else if (LIST_KEYS.has(key)) {
          result[key] = value.split(/[,，|]/).map((item) => item.trim()).filter(Boolean);
        } else if (key === 'scores') {
          const scores = {};
          for (const pair of value.split(/[,，;；]/)) {
            const match = pair.trim().match(/^(.+?)\s*[:：]?\s*(\d+(?:\.\d+)?)$/);
            if (!match) continue;
            scores[match[1].trim()] = Number(match[2]);
          }
          result[key] = scores;
        }
      }
      return result;
    }

    function TableEditor({ name, label, value, onChange }) {
      const [paste, setPaste] = useState('');
      const [message, setMessage] = useState(null);
      const columns = TABLE_SCHEMAS[name] ?? [['value', '内容']];
      const isMatrix = MATRIX_FIELDS.has(name);
      const rows = Array.isArray(value) ? value : [];

      function applyPaste(text) {
        const parsed = parseDelimited(text);
        if (parsed.length === 0) { setMessage('没有解析到数据，请检查粘贴内容'); return; }
        if (isMatrix) {
          onChange(parsed);
          setMessage(`已导入 ${parsed.length} 行数据表（第一行作为列名）`);
        } else {
          const data = parsed.slice(1).map((cells) => {
            const row = {};
            columns.forEach(([key], index) => { row[key] = cells[index] ?? ''; });
            return normalizeTableRow(row);
          });
          onChange(data);
          setMessage(`已导入 ${data.length} 行（按列顺序：${columns.map((c) => c[1]).join(' / ')}）`);
        }
      }

      const headerCells = isMatrix
        ? (rows[0] || columns.map((c) => c[1])).map((cell, i) => h('th', { key: i }, String(cell || `第${i + 1}列`)))
        : columns.map((c) => h('th', { key: c[0] }, c[1]));

      function matrixRow(cells, rowIndex) {
        return h('tr', { key: rowIndex },
          ...columns.map((_, colIndex) => h('td', { key: colIndex }, h('input', {
            className: 'eew-input', style: { width: '100%' }, value: String(cells?.[colIndex] ?? ''),
            onChange: (e) => onChange(rows.map((row, i) => i === rowIndex + 1 ? row.map((cell, j) => j === colIndex ? e.target.value : cell) : row)),
          }))),
          h('td', null, h('button', { className: 'eew-link', onClick: () => onChange(rows.filter((_, i) => i !== rowIndex + 1)) }, '删除')));
      }

      function cellText(key, value) {
        if (value === undefined || value === null) return '';
        if (Array.isArray(value)) return value.join('、');
        if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k} ${v}`).join('；');
        return String(value);
      }

      function objectRow(row, rowIndex) {
        return h('tr', { key: rowIndex },
          ...columns.map(([key]) => h('td', { key }, h('input', {
            className: 'eew-input', style: { width: '100%' },
            value: cellText(key, row?.[key]),
            onChange: (e) => onChange(rows.map((item, i) => i === rowIndex ? normalizeTableRow({ ...item, [key]: e.target.value }) : item)),
          }))),
          h('td', null, h('button', { className: 'eew-link', onClick: () => onChange(rows.filter((_, i) => i !== rowIndex)) }, '删除')));
      }

      const bodyRows = rows.length === 0
        ? [h('tr', { key: 'empty' }, h('td', { colSpan: columns.length + 1, className: 'eew-sub' }, '还没有数据：可添加一行、上传表格或从 Excel 粘贴。'))]
        : (isMatrix ? rows.slice(1).map(matrixRow) : rows.map(objectRow));

      return h('div', { className: 'eew-card eew-col' },
        h('div', { className: 'eew-between' },
          h('div', { className: 'eew-field' }, h('span', null, (FIELD_LABELS[name] || label || name) + '（可增删行）')),
          h('div', { className: 'eew-row tight' },
            h('button', { className: 'eew-btn sec', onClick: () => onChange(isMatrix ? [...rows, columns.map(() => '')] : [...rows, {}]) }, '添加一行'),
            h('label', { className: 'eew-btn sec' }, '上传表格文件',
              h('input', {
                type: 'file', accept: '.csv,.txt,.md,.tsv', style: { display: 'none' },
                onChange: async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try { const text = await readAsText(file); setPaste(text); applyPaste(text); }
                  catch (error) { setMessage(error.message); }
                },
              })))),
        h('div', { style: { overflowX: 'auto' } },
          h('table', { className: 'eew-table' },
            h('thead', null, h('tr', null, ...headerCells, h('th', null, '操作'))),
            h('tbody', null, ...bodyRows))),
        h('div', { className: 'eew-meta' }, isMatrix ? '第一行是列名；可直接从 Excel 复制粘贴（Tab/逗号/竖线分隔）。' : '可从 Excel 复制粘贴（Tab/逗号/竖线分隔）；第一行若为表头会自动跳过。'),
        h('textarea', { className: 'eew-area', rows: 2, value: paste, placeholder: '在此粘贴表格数据…', onChange: (e) => setPaste(e.target.value) }),
        h('div', { className: 'eew-row tight' },
          h('button', { className: 'eew-btn sec', disabled: !paste.trim(), onClick: () => applyPaste(paste) }, '解析粘贴内容'),
          message ? h('span', { className: 'eew-meta' }, message) : null));
    }

    function FlowInputForm({ fields, values, onChange, title }) {
      const list = (fields ?? []).filter((item) => !['format', 'workspaceId'].includes(item.name));
      if (list.length === 0) return h('div', { className: 'eew-sub' }, '该流程不需要额外输入。');
      return h('div', { className: 'eew-card eew-col' },
        h('div', { className: 'eew-sub', style: { fontWeight: 600 } }, title || '业务输入（表单，无需 JSON）'),
        h('div', { className: 'eew-grid' }, ...list.map((item) => {
          const name = item.name;
          if (TABLE_SCHEMAS[name] || MATRIX_FIELDS.has(name)) {
            return h(TableEditor, { key: name, name, label: item.hint || name, value: values[name], onChange: (next) => onChange({ ...values, [name]: next }) });
          }
          return h(Field, {
            key: name, label: (FIELD_LABELS[name] || name) + (item.required ? ' *' : ''),
            value: values[name] ?? '', rows: ['material', 'text', 'meetingNotes', 'feedback'].includes(name) ? 3 : undefined,
            placeholder: item.hint, onChange: (v) => onChange({ ...values, [name]: v }),
          });
        })));
    }

    /* ------------------------------------------------------------------ */
    /* Upload panel: upload → parse → preview → replace/remove              */
    /* ------------------------------------------------------------------ */

    function UploadPanel({ uploads, setUploads, compact }) {
      const limits = useLoad(() => api('GET', '/files/limits'), []);
      const [message, setMessage] = useState(null);
      const [dragging, setDragging] = useState(false);
      const maxBytes = limits.data?.maxBytes ?? MAX_UPLOAD_BYTES;
      const maxFiles = limits.data?.maxFiles ?? MAX_UPLOAD_FILES;

      function patch(key, patchValue) {
        setUploads((list) => list.map((item) => (item.key === key ? { ...item, ...patchValue } : item)));
      }

      async function addFiles(fileList) {
        const chosen = Array.from(fileList || []);
        if (chosen.length === 0) return;
        setMessage(null);
        const current = uploads.length;
        if (current + chosen.length > maxFiles) {
          setMessage(`一次最多 ${maxFiles} 份资料；请先移除不用的文件`);
          return;
        }
        for (const file of chosen) {
          const key = 'f' + Math.random().toString(36).slice(2, 9);
          const ext = (file.name.split('.').pop() || '').toLowerCase();
          if (file.size > maxBytes) {
            setUploads((list) => [...list, { key, name: file.name, format: ext, bytes: file.size, status: 'failed', message: `文件 ${formatBytes(file.size)}，超过 ${formatBytes(maxBytes)} 上限；可压缩或拆分后再上传` }]);
            continue;
          }
          setUploads((list) => [...list, { key, name: file.name, format: ext, bytes: file.size, status: 'uploading', message: '上传中…' }]);
          try {
            const data = await fileToBase64(file);
            patch(key, { status: 'parsing', message: '已上传，正在解析内容…' });
            const result = await api('POST', '/files/upload', { name: file.name, data });
            patch(key, {
              uploadId: result.uploadId, status: result.parsed ? 'parsed' : 'uploaded',
              parsed: result.parsed, format: result.format, bytes: result.bytes,
              textLength: result.textLength, preview: result.preview,
              sections: result.sections, meta: result.meta, message: result.message,
            });
          } catch (error) {
            const hint = error.hint ? ' ' + error.hint : '';
            patch(key, { status: 'failed', message: error.message + hint });
          }
        }
      }

      function remove(key) { setUploads((list) => list.filter((item) => item.key !== key)); }

      return h('div', { className: 'eew-col' },
        h('div', {
          className: 'eew-drop',
          role: 'button',
          tabIndex: 0,
          onDragOver: (e) => { e.preventDefault(); setDragging(true); },
          onDragLeave: () => setDragging(false),
          onDrop: (e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); },
          onClick: () => document.getElementById('eew-upload-input')?.click(),
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('eew-upload-input')?.click(); },
        },
        h('input', {
          id: 'eew-upload-input', type: 'file', multiple: true, accept: ACCEPT_UPLOAD,
          style: { display: 'none' }, 'aria-label': '选择资料文件',
          onChange: (e) => { addFiles(e.target.files); e.target.value = ''; },
        }),
        h('div', null, dragging ? '松开鼠标开始上传' : '点击选择文件，或把文件拖到这里'),
        h('div', { className: 'eew-meta' },
          `支持 Word / Excel / PDF / PPT / CSV / TXT / MD / JSON；单个不超过 ${formatBytes(maxBytes)}，一次最多 ${maxFiles} 份。`),
        compact ? null : h('div', { className: 'eew-meta' }, '不支持的文件可另存为 CSV/TXT 后上传，或直接把正文粘贴到下方输入框。')),
        message ? h('div', { className: 'eew-warnbox' }, message) : null,
        uploads.length > 0 ? h('div', { className: 'eew-col' }, ...uploads.map((item) => h(FileCard, {
          key: item.key, item, onRemove: () => remove(item.key),
          onPick: (fileList) => { remove(item.key); addFiles(fileList); },
        }))) : null);
    }

    function FileCard({ item, onRemove, onPick }) {
      const [openPreview, setOpenPreview] = useState(false);
      const tone = item.status === 'parsed' ? 'ok' : item.status === 'failed' ? 'danger' : item.status === 'uploaded' ? 'warn' : 'info';
      const label = { uploading: '上传中', parsing: '解析中', parsed: '已解析', uploaded: '已上传（未解析出正文）', failed: '处理失败' }[item.status] ?? item.status;
      return h('div', { className: 'eew-file' },
        h('div', { className: 'eew-between' },
          h('div', { className: 'eew-col', style: { gap: 3 } },
            h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, item.name),
            h('div', { className: 'eew-meta' },
              [item.format?.toUpperCase(), item.bytes ? formatBytes(item.bytes) : null, item.textLength ? `正文 ${item.textLength} 字` : null, item.meta?.sheets?.length ? `工作表：${item.meta.sheets.join('、')}` : null, item.meta?.pages ? `共 ${item.meta.pages} 页` : null].filter(Boolean).join(' · '))),
          h('div', { className: 'eew-row tight' },
            h('span', { className: 'eew-pill ' + tone }, label),
            h('label', { className: 'eew-btn sec' }, '替换',
              h('input', { type: 'file', accept: ACCEPT_UPLOAD, style: { display: 'none' }, onChange: (e) => { if (e.target.files?.length) onPick(e.target.files); } })),
            h('button', { className: 'eew-btn sec', onClick: onRemove }, '移除'))),
        item.message ? h('div', { className: item.status === 'failed' ? 'eew-err' : 'eew-meta' }, item.message) : null,
        item.preview ? h('div', null,
          h('button', { className: 'eew-btn ghost', onClick: () => setOpenPreview(!openPreview) }, openPreview ? '收起解析内容' : '查看解析内容'),
          openPreview ? h('pre', { className: 'eew-pre', style: { marginTop: 6, maxHeight: 200 } }, item.preview + (item.textLength > item.preview.length ? '\n…（已截断，完整内容会在处理时使用）' : '')) : null) : null);
    }

    /* ------------------------------------------------------------------ */
    /* Artifact preview                                                    */
    /* ------------------------------------------------------------------ */

    function ArtifactPreview({ id, onClose }) {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);
      useEffect(() => {
        let alive = true;
        api('GET', '/artifact/preview?id=' + encodeURIComponent(id))
          .then((value) => { if (alive) setData(value); })
          .catch((e) => { if (alive) setError(e.message); });
        return () => { alive = false; };
      }, [id]);
      return h('div', { className: 'eew-overlay', onClick: onClose, role: 'presentation' },
        h('div', { className: 'eew-modal', onClick: (e) => e.stopPropagation(), role: 'dialog', 'aria-modal': 'true', 'aria-label': '成果预览' },
          h('div', { className: 'eew-between' },
            h('div', { className: 'eew-col', style: { gap: 3 } },
              h('div', { className: 'eew-h2' }, data?.filename ?? '成果预览'),
              h('div', { className: 'eew-meta' }, data ? [String(data.format).toUpperCase(), formatBytes(data.bytes), `v${data.version}`, data.createdAt ? formatTime(data.createdAt) : null, data.meta?.sheets?.length ? `工作表：${data.meta.sheets.join('、')}` : null, data.meta?.pages ? `${data.meta.pages} 页` : null].filter(Boolean).join(' · ') : '正在读取…')),
            h('div', { className: 'eew-row tight' },
              h('a', { className: 'eew-btn sec', href: '/eew/artifact?id=' + encodeURIComponent(id), download: data?.filename }, '下载'),
              h('button', { className: 'eew-btn sec', onClick: onClose }, '关闭'))),
          error ? h('div', { className: 'eew-err' }, error) : null,
          data ? h('div', { className: 'eew-col' },
            data.truncated ? h('div', { className: 'eew-warnbox' }, `内容较长（共 ${data.textLength} 字），此处显示前 2 万字，可下载完整文件。`) : null,
            h('pre', { className: 'eew-pre', style: { maxHeight: '58vh' } }, data.text || '（该文件没有可预览的文字内容）')) : null));
    }

    /* ------------------------------------------------------------------ */
    /* Home                                                                */
    /* ------------------------------------------------------------------ */

    function ScenarioCard({ scenario, onStart, favorite, onToggleFavorite }) {
      const stop = (event) => { event.stopPropagation(); };
      return h('div', { className: 'eew-scenario' },
        h('div', { className: 'eew-between', style: { gap: 8 } },
          h('button', { type: 'button', className: 'eew-scenario-main', style: { textAlign: 'left', flex: 1, minWidth: 0 }, onClick: () => onStart(scenario) },
            h('div', { className: 'eew-between', style: { gap: 8 } },
              h('span', { className: 't' }, scenario.title),
              h('span', { className: 'eew-tag' }, scenario.category)),
            h('div', { className: 'p' }, scenario.goal),
            h('span', { className: 'go' }, scenario.action + ' →')),
          h('button', {
            type: 'button', className: 'eew-fav', 'aria-label': favorite ? '取消收藏' : '收藏场景', 'aria-pressed': Boolean(favorite),
            onClick: (event) => { stop(event); onToggleFavorite?.(scenario.id); },
          }, favorite ? '★' : '☆')));
    }

    function HomeView({ draft, onStart, onOpenTask, onOpenArtifact, onQuickStart, onOpenTaskList, onResumeDraft }) {
      const [library, setLibrary] = useState(false);
      const [query, setQuery] = useState('');
      const [category, setCategory] = useState('全部');
      const [quick, setQuick] = useState('');
      const tasks = useLoad(() => api('GET', '/tasks').then((r) => r.tasks), []);
      const artifacts = useLoad(() => api('GET', '/artifacts').then((r) => r.artifacts), []);

      const allTasks = tasks.data ?? [];
      const pending = allTasks.filter((task) => ['waiting_input', 'failed', 'running', 'draft', 'interrupted'].includes(task.status))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 3);
      const pendingCount = allTasks.filter((task) => ['waiting_input', 'failed', 'running', 'draft', 'interrupted'].includes(task.status)).length;
      const recentArtifacts = (artifacts.data ?? []).slice(0, 3);
      const favorites = useMemo(() => {
        try { return JSON.parse(localStorage.getItem(FAVORITE_SCENARIOS_KEY) ?? '[]'); } catch { return []; }
      }, []);
      const recentIds = useMemo(() => {
        try { return JSON.parse(localStorage.getItem(RECENT_SCENARIOS_KEY) ?? '[]'); } catch { return []; }
      }, []);
      const recentScenarios = recentIds.map((id) => SCENARIOS.find((item) => item.id === id)).filter(Boolean);
      const featured = [
        ...favorites.map((id) => SCENARIOS.find((item) => item.id === id)).filter(Boolean),
        ...recentScenarios.filter((item) => !favorites.includes(item.id)),
        ...SCENARIOS.filter((item) => !recentIds.includes(item.id) && !favorites.includes(item.id)),
      ].slice(0, 6);
      const keyword = query.trim().toLowerCase();
      const matched = SCENARIOS.filter((item) => (category === '全部' || item.category === category) &&
        (!keyword || (item.title + item.goal + item.needs.join('') + item.delivers.join('') + item.keywords.join('')).toLowerCase().includes(keyword)));
      const hasDraft = Boolean(draft?.goal?.trim() || (draft?.uploads ?? []).length > 0);

      const toggleFavorite = (id) => {
        try {
          const current = JSON.parse(localStorage.getItem(FAVORITE_SCENARIOS_KEY) ?? '[]');
          const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current].slice(0, 8);
          localStorage.setItem(FAVORITE_SCENARIOS_KEY, JSON.stringify(next));
        } catch { /* storage unavailable */ }
      };

      const taskRow = (task) => h('button', {
        key: task.id, type: 'button', className: 'eew-item click', onClick: () => onOpenTask(task.id),
      },
      h('div', { className: 'eew-col', style: { gap: 3 } },
        h('div', { className: 'eew-h3' }, businessTitle(task)),
        h('div', { className: 'eew-meta' }, `${formatTime(task.updatedAt)} · ${statusOf(task.status).next}`)),
      h('span', { className: 'eew-pill ' + statusOf(task.status).tone }, statusOf(task.status).label));

      const artifactRow = (artifact) => h('div', { className: 'eew-item', key: artifact.id },
        h('div', { className: 'eew-col', style: { gap: 2 } },
          h('div', { className: 'eew-h3' }, artifact.filename),
          h('div', { className: 'eew-meta' }, [String(artifact.format).toUpperCase(), formatBytes(artifact.bytes), formatTime(artifact.createdAt)].filter(Boolean).join(' · '))),
        h('div', { className: 'eew-row tight' },
          h('button', { className: 'eew-btn sec', onClick: () => onOpenArtifact(artifact.id) }, '预览'),
          h('a', { className: 'eew-btn sec', href: '/eew/artifact?id=' + encodeURIComponent(artifact.id), download: artifact.filename }, '下载')));

      return h('div', { className: 'eew-col' },
        h(PageHeader, { title: '今天想完成什么？', description: '先看需要你继续的事，再选一件常见工作，或直接用自己的话描述目标。' }),

        h('section', { className: 'eew-card' },
          h('div', { className: 'eew-sectiontitle' },
            h('h2', { className: 'eew-h2' }, '待我处理'),
            h('button', { className: 'eew-btn ghost', onClick: onOpenTaskList }, pendingCount > 3 ? `查看全部任务（${pendingCount}）` : '查看全部任务')),
          hasDraft
            ? h('div', { className: 'eew-item', style: { marginBottom: pending.length ? 10 : 0 } },
              h('div', { className: 'eew-col', style: { gap: 3 } },
                h('div', { className: 'eew-h3' }, '上次填写还没有开始'),
                h('div', { className: 'eew-meta' }, `${draft.goal ? '目标：' + String(draft.goal).slice(0, 48) : '已填写内容'}${(draft.uploads ?? []).length ? ` · 已上传 ${draft.uploads.length} 份资料` : ''}`)),
              h('button', { type: 'button', className: 'eew-btn sec', onClick: onResumeDraft }, '继续填写'))
            : null,
          pending.length === 0 && !hasDraft
            ? h('div', { className: 'eew-empty' },
              h('div', { className: 't' }, '没有待处理的工作'),
              h('div', null, '下面选一个常用场景，或直接描述你的目标就能开始。'))
            : h('div', { className: 'eew-col eew-pending', style: { gap: 8 } }, ...pending.map(taskRow))),

        h('section', { className: 'eew-card' },
          h('div', { className: 'eew-sectiontitle' },
            h('h2', { className: 'eew-h2' }, '常用场景'),
            h('button', { className: 'eew-btn ghost', onClick: () => setLibrary(!library) }, library ? '收起全部场景' : `查看全部 ${SCENARIOS.length} 个场景`)),
          h('div', { className: 'eew-cards' }, ...featured.map((scenario) => h(ScenarioCard, { key: scenario.id, scenario, onStart, favorite: favorites.includes(scenario.id), onToggleFavorite: toggleFavorite }))),
          library ? h('div', { className: 'eew-col', style: { marginTop: 14, gap: 12 } },
            h('div', { className: 'eew-row' },
              h('input', { className: 'eew-input', style: { flex: 1, minWidth: 200 }, placeholder: '搜索场景，如「比价」「复盘」', value: query, onChange: (e) => setQuery(e.target.value), 'aria-label': '搜索场景' }),
              h('span', { className: 'eew-meta' }, `${matched.length} 个场景`)),
            h('div', { className: 'eew-mode' }, ...CATEGORIES.map((item) => h('button', {
              key: item, className: category === item ? 'on' : '', onClick: () => setCategory(item),
            }, item))),
            matched.length === 0
              ? h('div', { className: 'eew-empty' }, '没有匹配的场景，换个关键词试试。')
              : h('div', { className: 'eew-cards' }, ...matched.map((scenario) => h(ScenarioCard, { key: scenario.id, scenario, onStart, favorite: favorites.includes(scenario.id), onToggleFavorite: toggleFavorite })))) : null),

        h('section', { className: 'eew-card' },
          h('div', { className: 'eew-sectiontitle' },
            h('h2', { className: 'eew-h2' }, '最近成果'),
            h('button', { className: 'eew-btn ghost', onClick: onOpenArtifact(null) }, '打开成果库')),
          recentArtifacts.length === 0
            ? h('div', { className: 'eew-empty' },
              h('div', { className: 't' }, '还没有成果'),
              h('div', null, '完成一项工作后，报告会出现在这里，可直接预览或下载。'))
            : h('div', { className: 'eew-col', style: { gap: 8 } }, ...recentArtifacts.map(artifactRow))),

        h('section', { className: 'eew-card flat' },
          h('div', { className: 'eew-sectiontitle' },
            h('h2', { className: 'eew-h2' }, '直接描述目标'),
            h('span', { className: 'eew-meta' }, '专家、技能与流程由系统自动匹配')),
          h('div', { className: 'eew-row' },
            h('input', {
              className: 'eew-input', style: { flex: 1, minWidth: 240 },
              placeholder: '例如：比较这三位候选人，给出录用建议',
              value: quick, 'aria-label': '描述要做的事',
              onChange: (e) => setQuick(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter' && quick.trim()) onQuickStart(quick.trim()); },
            }),
            h('button', { className: 'eew-btn', disabled: !quick.trim(), onClick: () => onQuickStart(quick.trim()) }, '开始这项工作'))));
    }
    function WorkbenchView({ draft, update, work, setWork, onOpenTask }) {
      const experts = useLoad(() => api('GET', '/experts').then((r) => r.experts), []);
      const skill = useLoad(() => draft.skillName ? api('GET', '/skill?name=' + encodeURIComponent(draft.skillName)) : Promise.resolve(null), [draft.skillName]);
      const formats = FORMAT_OPTIONS;
      const [advanced, setAdvanced] = useState(false);
      const [advancedJson, setAdvancedJson] = useState('{}');
      const [answers, setAnswers] = useState({});
      const [fullText, setFullText] = useState(null);
      const [citation, setCitation] = useState(null);
      const [previewId, setPreviewId] = useState(null);
      const [busy, setBusy] = useState(false);
      const [elapsed, setElapsed] = useState(0);
      const [mode, setMode] = useState('upload');
      const [showOptional, setShowOptional] = useState(false);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const inFlight = React.useRef(false);

      useEffect(() => {
        if (!busy) { setElapsed(0); return undefined; }
        const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
        return () => clearInterval(timer);
      }, [busy]);
      const busyText = busy
        ? `正在处理（已用 ${elapsed} 秒）：理解目标 → 整理资料 → 生成成果，通常需要 10–60 秒，请勿重复点击。`
        : null;

      const result = work.result;
      const missing = work.missing ?? [];
      const scenario = SCENARIOS.find((item) => item.id === draft.scenarioId) || null;
      const businessFields = (skill.data?.inputs ?? []).filter((item) => !['workspaceId', 'format'].includes(item.name));
      const requiredFields = businessFields.filter((item) => item.required && !MATRIX_FIELDS.has(item.name) && !TABLE_SCHEMAS[item.name]);
      const optionalFields = businessFields.filter((item) => !item.required || MATRIX_FIELDS.has(item.name) || TABLE_SCHEMAS[item.name]);
      const parsedUploads = (draft.uploads ?? []).filter((item) => item.status === 'parsed' || item.status === 'uploaded');

      function setForm(name, value) { update({ formValues: { ...draft.formValues, [name]: value } }); }

      async function run() {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true); setError(null); setNotice(null); setFullText(null);
        let extraInput = {};
        if (advanced && advancedJson.trim()) {
          try { extraInput = JSON.parse(advancedJson); } catch (e) { setError('高级参数格式有误：' + e.message + '（普通使用无需填写）'); setBusy(false); inFlight.current = false; return; }
        }
        const payload = {
          goal: draft.goal.trim() || undefined,
          expertId: draft.expertId || undefined,
          skillName: draft.skillName || undefined,
          workflowId: draft.workflowId || undefined,
          input: { ...draft.formValues, ...extraInput },
          uploads: parsedUploads.map((item) => ({ uploadId: item.uploadId, name: item.name })),
          format: draft.format || undefined,
          taskId: draft.taskId || undefined,
          idempotencyKey: draft.taskId ? null : (draft.submissionKey || (draft.submissionKey = uuid())),
        };
        if (!draft.submissionKey) update({ submissionKey: payload.idempotencyKey });
        try {
          const response = await api('POST', '/dispatch', payload);
          if (response.stage === 'conflict') {
            setError(response.summary || '同一次提交被用于不同的内容');
            setNotice(null);
            return;
          }
          setWork({ result: response, missing: response.missing ?? [] });
          if (response.task?.id) update({ taskId: response.task.id });
          if (response.ok) setNotice('已完成，成果已保存，可在「我的任务」或「成果库」继续查看');
          else if (response.stage === 'waiting_input') setNotice('已保存进度；补充下方缺少的资料即可继续');
          else if (response.stage === 'needs_confirmation') setNotice('金额计算完成，比较待确认：' + ((response.outcome?.result?.structured?.basisPending ?? []).join('、') || '请确认比较口径') + '。可在下方「需要确认」中直接确认。');
          else setNotice('本次未标记完成：' + ((response.failureReasons || []).join('；') || response.summary || '请查看原因'));
        } catch (e) { setError(e.message); }
        finally { setBusy(false); inFlight.current = false; }
      }

      async function continueWithAnswers() {
        if (!result?.task?.id && !draft.taskId) { setError('没有可继续的任务，请先开始一次工作'); return; }
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true); setError(null);
        try {
          const response = await api('POST', '/answer', {
            taskId: result?.task?.id ?? draft.taskId,
            answers: { ...answers },
            format: draft.format,
            uploads: parsedUploads.map((item) => ({ uploadId: item.uploadId, name: item.name })),
          });
          if (response.stage === 'conflict') {
            setError(response.summary || '同一次提交被用于不同的内容');
            setNotice(null);
            return;
          }
          setWork({ result: response, missing: response.missing ?? [] });
          setAnswers({});
          setNotice(response.ok ? '已补充并完成' : (response.stage === 'waiting_input' ? '还需少量资料，已保存进度' : (response.stage === 'needs_confirmation' ? '金额计算完成，比较待确认：' + ((response.outcome?.result?.structured?.basisPending ?? []).join('、') || '请确认比较口径') : '未完成：' + ((response.failureReasons || []).join('；') || '请查看原因'))));
        } catch (e) { setError(e.message); }
        finally { setBusy(false); inFlight.current = false; }
      }

      async function readFull(taskId) {
        try {
          const page = await api('GET', `/result?id=${encodeURIComponent(taskId)}&limit=8000`);
          setFullText({ ...page, pages: [page.chunk] });
        } catch (e) { setError(e.message); }
      }

      async function readMoreFull() {
        if (!fullText?.hasMore) return;
        try {
          const page = await api('GET', `/result?id=${encodeURIComponent(fullText.taskId)}&offset=${fullText.nextOffset}&limit=8000`);
          setFullText({ ...page, pages: [...(fullText.pages ?? []), page.chunk] });
        } catch (e) { setError(e.message); }
      }

      async function openCitation(item) {
        try {
          setCitation(await api('GET', `/knowledge/section?docId=${encodeURIComponent(item.docId)}&section=${encodeURIComponent(item.section || '')}&part=${item.part || 1}`));
        } catch (e) { setError(e.message); }
      }

      async function saveToKnowledge() {
        const task = result?.task;
        const text = result?.summary || result?.outcome?.result?.message || '';
        if (!text) { setError('本次没有可入库的结论正文'); return; }
        try {
          await api('POST', '/knowledge/import', {
            title: (task ? businessTitle(task) : draft.goal).slice(0, 60),
            text, domain: 'work-result', tags: ['工作成果'],
          });
          setNotice('结论已保存到知识库（待核实），可在「知识库」审核后转为可信');
        } catch (e) { setError(e.message); }
      }

      async function confirmCorrection(answers) {
        const targetId = result?.task?.id ?? draft.taskId;
        if (!targetId) { setError('没有可继续的任务，请先开始一次工作'); return; }
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true); setError(null);
        try {
          const response = await api('POST', '/answer', {
            taskId: targetId,
            answers,
            format: draft.format,
            uploads: parsedUploads.filter((item) => item.status === 'parsed' || item.status === 'uploaded').map((item) => ({ uploadId: item.uploadId, name: item.name })),
          });
          setWork({ result: response, missing: response.missing ?? [] });
          setAnswers({});
          setNotice('已按你的确认在原任务上重新处理，原始资料与之前的结果都保留在任务记录里');
        } catch (e) { setError(e.message); }
        finally { setBusy(false); inFlight.current = false; }
      }

      async function exportAs(format) {
        const task = result?.task;
        const outcome = result?.outcome ?? {};
        const content = {
          title: (task ? businessTitle(task) : draft.goal || '工作成果').slice(0, 80),
          subtitle: task ? `任务 ${task.id}` : undefined,
          sections: [{
            heading: '结论',
            paragraphs: [String(outcome.result?.message || outcome.message || result?.summary || '')].filter(Boolean),
          }],
          tables: outcome.result?.content?.tables ?? [],
          citations: outcome.citations ?? [],
        };
        try {
          const artifact = await api('POST', '/files/generate', { format, filename: content.title, content, taskId: task?.id ?? null });
          setNotice(`已生成 ${String(format).toUpperCase()} 版本，可在成果卡片中下载`);
          setWork({ result: { ...result, extraArtifact: artifact } });
        } catch (e) { setError(e.message); }
      }

            const stage = result ? 'done' : (missing.length || parsedUploads.length || Object.keys(draft.formValues ?? {}).length ? 'confirm' : 'materials');
      const materialTables = optionalFields.filter((item) => TABLE_SCHEMAS[item.name] || MATRIX_FIELDS.has(item.name));
      const otherFields = optionalFields.filter((item) => !(TABLE_SCHEMAS[item.name] || MATRIX_FIELDS.has(item.name)));

      return h('div', { className: 'eew-col' },
        h(PageHeader, {
          title: scenario ? scenario.title : '描述你要完成的事',
          description: scenario ? scenario.goal : '用一句业务语言说明目标即可；系统会自动选择合适的能力与流程。',
          children: [
            h('button', {
              className: 'eew-btn',
              disabled: busy || (!draft.goal.trim() && !draft.taskId),
              onClick: run,
            }, busy ? '正在处理…' : (draft.taskId ? '继续这次工作' : (scenario?.action ?? '开始工作'))),
          ],
        }),

        h('div', { className: 'eew-steps' },
          h('span', { className: 'eew-step ' + (stage !== 'materials' ? 'done' : 'on') }, h('span', { className: 'n' }, '1'), '提供资料'),
          h('span', { className: 'eew-step-sep' }),
          h('span', { className: 'eew-step ' + (result ? 'done' : (stage === 'confirm' ? 'on' : '')) }, h('span', { className: 'n' }, '2'), '确认必要信息'),
          h('span', { className: 'eew-step-sep' }),
          h('span', { className: 'eew-step ' + (result ? 'on' : '') }, h('span', { className: 'n' }, '3'), '查看成果')),

        h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-sectiontitle' },
            h('h2', { className: 'eew-h2' }, '1 · 提供资料'),
            h('span', { className: 'eew-meta' }, parsedUploads.length ? `已提供 ${parsedUploads.length} 份资料` : '可选：资料越完整，结论越可靠')),
          h('div', { className: 'eew-mode' },
            ...[['upload', '上传文件'], ['paste', '粘贴内容'], ['manual', '手工录入']].map(([id, label]) => h('button', {
              key: id, className: mode === id ? 'on' : '', onClick: () => setMode(id),
            }, label))),
          mode === 'upload' ? h(UploadPanel, {
            uploads: draft.uploads ?? [],
            setUploads: (updater) => update((previous) => ({ uploads: typeof updater === 'function' ? updater(previous.uploads ?? []) : updater })),
          }) : null,
          mode === 'paste' ? h(PasteImport, { onImport: (imported) => {
            update({ formValues: { ...draft.formValues, ...imported } });
            setMode('manual');
          } }) : null,
          mode === 'manual' ? (materialTables.length === 0
            ? h('div', { className: 'eew-empty' }, '这个场景没有需要手工录入的表格，请上传文件或粘贴内容。')
            : h('div', { className: 'eew-col' }, ...materialTables.map((item) => h(TableEditor, {
              key: item.name, name: item.name, label: item.hint, value: draft.formValues[item.name], onChange: (next) => setForm(item.name, next),
            })))) : null),

        h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-sectiontitle' },
            h('h2', { className: 'eew-h2' }, '2 · 确认必要信息'),
            otherFields.length
              ? h('button', { className: 'eew-btn ghost', onClick: () => setShowOptional(!showOptional) }, showOptional ? '收起其他信息' : `其他信息（${otherFields.length} 项）`)
              : null),
          h(Field, {
            label: '要做的事', value: draft.goal, rows: 2,
            placeholder: '例如：复盘客户 A 项目并沉淀经验',
            onChange: (value) => update({ goal: value }),
          }),
          scenario && scenario.needs.length
            ? h('div', { className: 'eew-info' }, '这个场景通常需要：' + scenario.needs.join('；') + '。缺少时系统只会追问必需项。')
            : null,
          requiredFields.length > 0
            ? h('div', { className: 'eew-grid' }, ...requiredFields.map((item) => h(Field, {
              key: item.name, label: (FIELD_LABELS[item.name] || item.name) + ' *',
              value: draft.formValues[item.name] ?? '', placeholder: item.hint,
              rows: ['material', 'text', 'resumeText', 'meetingNotes', 'feedback', 'context'].includes(item.name) ? 3 : undefined,
              onChange: (value) => setForm(item.name, value),
            })))
            : null,
          showOptional
            ? h('div', { className: 'eew-col' }, ...otherFields.map((item) => h(Field, {
              key: item.name, label: FIELD_LABELS[item.name] || item.name,
              value: draft.formValues[item.name] ?? '', placeholder: item.hint,
              rows: ['material', 'text', 'context'].includes(item.name) ? 3 : undefined,
              onChange: (value) => setForm(item.name, value),
            })))
            : null,
          h('div', { className: 'eew-row' },
            h('label', { className: 'eew-field', style: { minWidth: 190 } },
              h('span', null, '成果格式'),
              h('select', { className: 'eew-select', value: draft.format, onChange: (e) => update({ format: e.target.value }) },
                ...formats.map((item) => h('option', { key: item.value, value: item.value }, item.label)))),
            h('span', { className: 'eew-meta' }, scenario ? `按场景推荐 ${String(scenario.format).toUpperCase()}，可随时更改` : '默认按场景推荐，可更改'))),

        h('div', { className: 'eew-row' },
          h('button', { className: 'eew-btn sec', onClick: () => setAdvanced(!advanced) }, advanced ? '收起高级选项' : '高级选项'),
          draft.taskId ? h('button', { className: 'eew-btn ghost', onClick: () => { update({ taskId: '' }); setWork({ result: null, missing: [] }); setNotice('已作为新工作开始，原任务不会被修改'); } }, '另起一件新工作') : null),
        advanced ? h('div', { className: 'eew-card flat eew-col' },
          h('div', { className: 'eew-sub' }, '高级选项仅用于精确控制，普通使用无需填写。'),
          h('div', { className: 'eew-grid' },
            h(Field, { label: '指定专家', value: draft.expertId, onChange: (value) => update({ expertId: value }), options: [{ value: '', label: '自动判断' }, ...(experts.data || []).map((x) => ({ value: x.id, label: x.name }))] }),
            h(Field, { label: '指定能力（技能）', value: draft.skillName, onChange: (value) => update({ skillName: value }), placeholder: '留空自动选择' }),
            h(Field, { label: '关联任务', value: draft.taskId, onChange: (value) => update({ taskId: value }), placeholder: '留空新建任务' })),
          h('textarea', { className: 'eew-area', value: advancedJson, onChange: (e) => setAdvancedJson(e.target.value), placeholder: '可选：补充输入参数（JSON）' })) : null,

        h(Notice, { busy, busyText: busyText, error, notice }),

        missing.length > 0 ? h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-sectiontitle' },
            h('h2', { className: 'eew-h2' }, '还需要一点资料'),
            h('span', { className: 'eew-meta' }, '已填写的内容和资料都保留了')),
          ...missing.map((item) => (TABLE_SCHEMAS[item.name] || MATRIX_FIELDS.has(item.name))
            ? h(TableEditor, { key: item.name, name: item.name, label: item.hint, value: answers[item.name], onChange: (next) => setAnswers((p) => ({ ...p, [item.name]: next })) })
            : h(Field, {
              key: item.name, label: FIELD_LABELS[item.name] || item.name,
              value: answers[item.name] ?? '', placeholder: item.hint,
              rows: ['material', 'text', 'resumeText', 'meetingNotes', 'feedback', 'context'].includes(item.name) ? 2 : undefined,
              onChange: (value) => setAnswers((p) => ({ ...p, [item.name]: value })),
            })),
          h('div', { className: 'eew-row' },
            h('button', { className: 'eew-btn', disabled: busy, onClick: continueWithAnswers }, busy ? '正在补充…' : '补充并继续原任务'))) : null,

        result ? h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-sectiontitle' }, h('h2', { className: 'eew-h2' }, '3 · 查看成果')),
          h(ResultView, {
            result, draft, onOpenTask, onPreview: (id) => setPreviewId(id), onOpenCitation: openCitation,
            onReadFull: () => readFull(result.task?.id ?? draft.taskId), onReadMore: readMoreFull, fullText,
            onSaveKnowledge: saveToKnowledge, onExportAs: exportAs, onConfirmCorrection: confirmCorrection,
          })) : null,

        citation ? h('div', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-h2' }, `原文：${citation.title} / ${citation.section}`),
          h('div', { className: 'eew-meta' }, `可信级别 ${citation.trust} · 行 ${(citation.lines || []).join('-')}`),
          h('pre', { className: 'eew-pre' }, citation.text),
          h('button', { className: 'eew-btn sec', onClick: () => setCitation(null) }, '关闭原文')) : null,

        previewId ? h(ArtifactPreview, { id: previewId, onClose: () => setPreviewId(null) }) : null);
    }

/* ------------------------------------------------------------------ */
/* Result: conclusion → preview → evidence → next actions               */
/* ------------------------------------------------------------------ */

/**
 * Lets the user resolve a comparison gap directly on the result page
 * instead of hunting for technical fields or re-uploading everything.
 * Confirming keeps the original task, inputs and prior results (the new
 * run is appended as another result on the same task).
 */
function ConfirmPanel({ type, structured, onConfirm }) {
  const [busy, setBusy] = React.useState(false);
  function send(answers) {
    setBusy(true);
    Promise.resolve(onConfirm(answers)).finally(() => setBusy(false));
  }
  if (type === 'candidate') {
    const dims = structured.dimensions ?? [];
    const fields = structured.scoreFields ?? [];
    const [mapping, setMapping] = React.useState(() => Object.fromEntries(dims.map((d) => [d.name, { source: d.source ?? '', weight: d.weight, scale: d.scale ?? '未声明评分范围' }])));
    return h('div', { className: 'eew-col', style: { gap: 10 } },
      h('div', { className: 'eew-sub' }, '确认每个评估维度对应的评分字段、权重与评分范围，系统会按你的对应关系重新比较。'),
      ...dims.map((d) => h('div', { key: d.name, className: 'eew-correction-row' },
        h('div', { className: 'eew-col', style: { gap: 3 } },
          h('div', { className: 'eew-h3' }, d.name),
          h('div', { className: 'eew-meta' }, d.source ? `当前对应「${d.source}」` : '当前未对应字段')),
        h('div', { className: 'eew-row tight' },
          h('select', { className: 'eew-select', value: mapping[d.name].source, 'aria-label': d.name + ' 对应字段', onChange: (e) => setMapping((p) => ({ ...p, [d.name]: { ...p[d.name], source: e.target.value } })) },
            h('option', { value: '' }, '未对应字段'),
            ...fields.map((f) => h('option', { key: f, value: f }, f))),
          h('input', { className: 'eew-input', style: { width: 72 }, type: 'number', step: '0.1', value: mapping[d.name].weight, 'aria-label': d.name + ' 权重', onChange: (e) => setMapping((p) => ({ ...p, [d.name]: { ...p[d.name], weight: e.target.value } })) }),
          h('input', { className: 'eew-input', style: { width: 150 }, value: mapping[d.name].scale, placeholder: '评分范围', 'aria-label': d.name + ' 评分范围', onChange: (e) => setMapping((p) => ({ ...p, [d.name]: { ...p[d.name], scale: e.target.value } })) })))),
      h('button', { className: 'eew-btn', disabled: busy, onClick: () => send({ criteria: dims.map((d) => ({ name: d.name, weight: Number(mapping[d.name].weight) || 1, source: mapping[d.name].source || null, scale: mapping[d.name].scale || '未声明评分范围' })) }) }, busy ? '正在重新比较…' : '确认并重新比较'));
  }
  const calc = structured.calculated ?? [];
  const [mode, setMode] = React.useState('qty');
  const [qty, setQty] = React.useState('');
  const [years, setYears] = React.useState(String(structured.years ?? 3));
  const [currency, setCurrency] = React.useState('');
  const [tax, setTax] = React.useState('');
  const [scope, setScope] = React.useState('');
  const pendingNames = structured.basisPending ?? [];
  const taxValue = tax || (structured.basisFields?.find((item) => item.name === '税费')?.values?.[0] ?? '');
  return h('div', { className: 'eew-col', style: { gap: 10 } },
    h('div', { className: 'eew-sub' }, '确认比较口径后，系统会按同一口径重新测算总成本并给出优选。你确认的内容会按「假设」标注，不会当作对方报价单核实过的事实。'),
    pendingNames.length ? h('div', { className: 'eew-meta' }, '待确认口径：' + pendingNames.join('、')) : null,
    h('div', { className: 'eew-mode' }, ...[['qty', '按统一数量比较'], ['price', '按单价比较']].map(([id, label]) => h('button', { key: id, className: mode === id ? 'on' : '', onClick: () => setMode(id) }, label))),
    mode === 'qty' ? h('div', { className: 'eew-row tight' },
      h('label', { className: 'eew-label' }, '统一数量'),
      h('input', { className: 'eew-input', style: { width: 110 }, type: 'number', value: qty, placeholder: '输入相同数量', 'aria-label': '统一数量', onChange: (e) => setQty(e.target.value) })) : null,
    h('div', { className: 'eew-row tight' },
      h('label', { className: 'eew-label' }, '使用年限'),
      h('input', { className: 'eew-input', style: { width: 90 }, type: 'number', value: years, 'aria-label': '使用年限', onChange: (e) => setYears(e.target.value) })),
    h('div', { className: 'eew-row tight' },
      h('label', { className: 'eew-label' }, '币种（两家相同）'),
      h('input', { className: 'eew-input', style: { width: 130 }, value: currency, placeholder: '如：人民币', 'aria-label': '币种', onChange: (e) => setCurrency(e.target.value) })),
    h('div', { className: 'eew-row tight' },
      h('label', { className: 'eew-label' }, '税费口径（两家相同）'),
      h('select', { className: 'eew-select', value: taxValue, 'aria-label': '税费口径', onChange: (e) => setTax(e.target.value) },
        h('option', { value: '' }, '仍按未声明处理'),
        h('option', { value: '不含税' }, '不含税'),
        h('option', { value: '含税' }, '含税'))),
    h('div', { className: 'eew-row tight' },
      h('label', { className: 'eew-label' }, '服务范围（两家相同）'),
      h('input', { className: 'eew-input', style: { width: 200 }, value: scope, placeholder: '如：同范围软件许可', 'aria-label': '服务范围', onChange: (e) => setScope(e.target.value) })),
    h('button', { className: 'eew-btn', disabled: busy, onClick: () => send({
      years: Number(years) || 3,
      ...(currency.trim() ? { currency: currency.trim() } : {}),
      ...(tax.trim() ? { taxBasis: tax.trim() } : {}),
      ...(scope.trim() ? { scope: scope.trim() } : {}),
      quotes: calc.map((c) => ({ vendor: c.vendor, unitPrice: c.unit, quantity: mode === 'qty' && qty ? Number(qty) : c.qty, implementation: c.impl, annualMaintenance: c.maintenance, training: c.training })),
    }) }, busy ? '正在重新比价…' : '确认口径并重新比价'));
}

function ResultView({ result, draft, onOpenTask, onPreview, onOpenCitation, onReadFull, onReadMore, fullText, onSaveKnowledge, onExportAs, onConfirmCorrection }) {
      const [showAllFacts, setShowAllFacts] = useState(false);
      const [showAllAnalysis, setShowAllAnalysis] = useState(false);
      const [openSection, setOpenSection] = useState(null);
      const topRef = React.useRef(null);
      React.useEffect(() => {
        topRef.current?.scrollIntoView({ block: 'start' });
      }, [result.stage, result.task?.id]);
      const outcome = result.outcome ?? {};
      const evidence = outcome.evidence ?? {};
      const body = outcome.result ?? {};
      const tables = body.content?.tables ?? [];
      const analysisText = body.analysis?.text ?? null;
      const allArtifacts = [...(outcome.artifacts ?? []), ...(result.extraArtifact ? [result.extraArtifact] : [])];
      const primary = allArtifacts.find((item) => item.role === 'primary') ?? allArtifacts[0] ?? null;
      const extraFiles = allArtifacts.filter((item) => item !== primary);
      const facts = evidence.facts ?? [];
      const unknowns = evidence.unknowns ?? [];
      const recommendations = evidence.recommendations ?? [];
      const citations = outcome.citations ?? [];
      const conclusion = body.message || outcome.message || result.summary || '';
      const stage = result.stage ?? result.task?.status;
      const status = statusOf(stage);
      const hasOutput = stage === 'completed' || allArtifacts.length > 0 || Boolean(analysisText);
      const sections = analysisText ? splitMarkdownSections(analysisText) : [];
      const leadSection = sections[0] ?? null;
      const restSections = sections.slice(1);
      const recommendedFormat = draft?.format ?? 'docx';
      const structured = body.structured ?? {};
      const confirmType = structured.scoreFields ? 'candidate' : (structured.calculated ? 'procurement' : null);
      const confirmMessages = [
        structured.needsConfirmation && (structured.basisDifferences ?? []).length > 0
          ? '报价口径不一致（' + structured.basisDifferences.join('；') + '），本次只给出各自报价算出的金额，未给出总体优选结论。'
          : null,
        structured.needsConfirmation && (structured.basisPending ?? []).length > 0
          ? '以下口径未声明、不能视为一致：' + structured.basisPending.join('、') + '。金额计算已完成，确认口径后可在原任务上给出同口径结论。'
          : null,
        structured.needsMappingConfirmation ? '有评价维度未找到对应评分字段（' + (structured.dimensions ?? []).filter((item) => !item.mapped).map((item) => item.name).join('、') + '），系统未按相似名称推断。' : null,
        ...(result.conflicts || []).map((item) => item.message),
      ].filter(Boolean);
      const needConfirm = confirmMessages.length > 0;

      const artifactRow = (artifact, primaryRow) => h('div', { className: 'eew-item', key: artifact.id },
        h('div', { className: 'eew-col', style: { gap: 2 } },
          h('div', { className: 'eew-h3' }, artifact.filename),
          h('div', { className: 'eew-meta' }, [primaryRow ? '最终成果' : '附加资料', String(artifact.format).toUpperCase(), formatBytes(artifact.bytes), artifact.verified ? '已回读校验' : '未校验'].filter(Boolean).join(' · '))),
        h('div', { className: 'eew-row tight' },
          h('button', { className: 'eew-btn sec', onClick: () => onPreview(artifact.id) }, '预览'),
          h('a', { className: 'eew-btn ' + (primaryRow ? '' : 'sec'), href: '/eew/artifact?id=' + encodeURIComponent(artifact.id), download: artifact.filename }, '下载')));

      return h('div', { className: 'eew-col', ref: topRef },
        h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-between' },
            h('div', { className: 'eew-col', style: { gap: 4 } },
              h('h2', { className: 'eew-h2' }, businessTitle(result.task) || draft.goal || '本次成果'),
              h('div', { className: 'eew-meta' }, `${status.label}${status.next ? ' · 下一步：' + status.next : ''}`)),
            h('div', { className: 'eew-row tight' },
              result.task?.id ? h('button', { className: 'eew-btn ghost', onClick: () => onOpenTask(result.task.id) }, '查看任务详情') : null)),
          conclusion
            ? h('div', { style: { fontSize: 15, lineHeight: 1.75, fontWeight: 500 } }, conclusion)
            : h('div', { className: 'eew-sub' }, result.summary || '本次没有生成结论')),
        (result.failureReasons || []).length
          ? h('div', { className: 'eew-warnbox' }, '未完成的部分：' + result.failureReasons.join('；') + '。已完成的结论与成果保留，补充资料后可继续。')
          : null,
        needConfirm && result.task?.id
          ? h('section', { className: 'eew-card eew-col' },
            h('div', { className: 'eew-sectiontitle' }, h('h2', { className: 'eew-h2' }, '需要确认')),
            confirmMessages.length ? h('div', { className: 'eew-warnbox' }, confirmMessages.join('；')) : null,
            h(ConfirmPanel, { type: confirmType, structured, onConfirm: onConfirmCorrection }))
          : null,

        facts.length > 0 ? h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-sectiontitle' },
            h('h2', { className: 'eew-h2' }, '关键发现'),
            facts.length > 6 ? h('button', { className: 'eew-btn ghost', onClick: () => setShowAllFacts(!showAllFacts) }, showAllFacts ? '收起' : `查看其余 ${facts.length - 6} 条`) : null),
          h('ul', { style: { margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.8 } },
            ...(showAllFacts ? facts : facts.slice(0, 6)).map((item, i) => h('li', { key: i }, item.statement)))) : null,

        (tables.length > 0 || analysisText) ? h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-sectiontitle' }, h('h2', { className: 'eew-h2' }, '成果预览')),
          ...tables.slice(0, 3).map((table, i) => h(DataTable, { key: i, table })),
          analysisText ? h('div', { className: 'eew-col' },
            h('div', { className: 'eew-sectiontitle' },
              h('h3', { className: 'eew-h3' }, '专业分析'),
              restSections.length ? h('span', { className: 'eew-meta' }, `${sections.length} 个部分` ) : null),
            leadSection ? h('div', { className: 'eew-md', dangerouslySetInnerHTML: { __html: renderMarkdown(leadSection.body) } }) : null,
            restSections.length ? h('div', { className: 'eew-row tight' },
              ...restSections.map((section, index) => h('button', {
                key: index, className: 'eew-btn ' + (openSection === index ? '' : 'sec'),
                onClick: () => setOpenSection(openSection === index ? null : index),
              }, section.title || `部分 ${index + 2}`))) : null,
            openSection !== null && restSections[openSection]
              ? h('div', { className: 'eew-md', dangerouslySetInnerHTML: { __html: renderMarkdown(restSections[openSection].body) } })
              : null,
            restSections.length && openSection === null
              ? h('button', { className: 'eew-btn ghost', onClick: () => setShowAllAnalysis(!showAllAnalysis) }, showAllAnalysis ? '只看结论部分' : '展开完整分析')
              : null,
            showAllAnalysis ? h('div', { className: 'eew-md', dangerouslySetInnerHTML: { __html: renderMarkdown(restSections.map((section) => '## ' + section.title + '\n\n' + section.body).join('\n\n')) } }) : null) : null) : null,

        allArtifacts.length > 0 ? h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-sectiontitle' },
            h('h2', { className: 'eew-h2' }, '成果文件'),
            h('span', { className: 'eew-meta' }, '预览与下载是同一份内容')),
          primary ? artifactRow(primary, true) : null,
          extraFiles.length ? h(Collapse, { title: `更多文件（${extraFiles.length}）` }, ...extraFiles.map((item) => artifactRow(item, false))) : null) : null,

        (citations.length > 0 || recommendations.length > 0) ? h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-sectiontitle' }, h('h2', { className: 'eew-h2' }, '依据')),
          citations.length ? h(Collapse, { title: `来源（${citations.length}）` },
            ...citations.slice(0, 12).map((item, i) => h('button', {
              key: i, className: 'eew-link', style: { textAlign: 'left' }, onClick: () => onOpenCitation(item),
            }, `${item.title || item.docId} / ${item.section || ''} / 行 ${(item.lines || []).join('-')}`))) : null,
          facts.length ? h(Collapse, { title: `事实清单（${facts.length} 条）` },
            ...facts.map((item, i) => h('div', { key: i, className: 'eew-sub' }, '· ' + item.statement))) : null,
          recommendations.length ? h(Collapse, { title: `建议动作（${recommendations.length} 条，由你决定）` },
            ...recommendations.map((item, i) => h('div', { key: i, className: 'eew-sub' }, '· ' + item.statement))) : null) : null,

        h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-sectiontitle' }, h('h2', { className: 'eew-h2' }, '下一步')),
          hasOutput ? h(React.Fragment, null,
            h('div', { className: 'eew-row' },
              primary ? h('a', { className: 'eew-btn', href: '/eew/artifact?id=' + encodeURIComponent(primary.id), download: primary.filename }, '下载成果') : null,
              primary ? h('button', { className: 'eew-btn sec', onClick: () => onPreview(primary.id) }, '预览成果') : null,
              conclusion ? h('button', { className: 'eew-btn sec', onClick: onSaveKnowledge }, '确认并入库') : null,
              result.task?.id ? h('button', { className: 'eew-btn sec', onClick: onReadFull }, '查看完整结果') : null),
            h('div', { className: 'eew-row' },
              h('label', { className: 'eew-field', style: { minWidth: 200 } },
                h('span', null, '换一种格式导出'),
                h('select', {
                  className: 'eew-select', defaultValue: recommendedFormat,
                  onChange: (e) => onExportAs(e.target.value),
                }, ...FORMAT_OPTIONS.map((item) => h('option', { key: item.value, value: item.value }, item.label)))),
              h('span', { className: 'eew-meta' }, '导出会生成一份新的最终成果，原成果保留为历史版本。')),
            h('div', { className: 'eew-meta' }, '重新生成会更新本页结论与最终成果文件（旧的成果保留在成果库的历史版本里），不会删除你已填写的资料。'))
            : h('div', { className: 'eew-sub' }, '还没有生成成果。补充上方缺少的资料后，成果会出现在这里。')),

        fullText ? h('section', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-sectiontitle' }, h('h2', { className: 'eew-h2' }, `完整结果（${fullText.totalLength} 字）`)),
          h('div', { className: 'eew-md', dangerouslySetInnerHTML: { __html: renderMarkdown((fullText.pages ?? [fullText.chunk]).join('\n\n')) } }),
          fullText.hasMore ? h('button', { className: 'eew-btn sec', onClick: onReadMore }, '继续读取下一页') : h('div', { className: 'eew-meta' }, '已读完，没有截断。')) : null,

        h(Collapse, { title: '技术详情（阶段、能力、质量检查）' },
          h('div', { className: 'eew-meta' },
            [`阶段 ${result.stage ?? '-'}`, `能力 ${result.capability?.id ?? result.skill?.name ?? '-'}`, `专家 ${result.routing?.selected?.name ?? '-'}`, result.task ? `任务 ${result.task.id}` : null].filter(Boolean).join(' · ')),
          result.review ? h('div', { className: 'eew-sub' }, '质量检查：' + result.review.verdict + '（' + (result.review.checks || []).filter((c) => c.passed).length + '/' + (result.review.checks || []).length + ' 通过）') : null,
          result.analysis && !result.analysis.available ? h('div', { className: 'eew-sub' }, '本次未生成模型分析：' + (result.analysis.reason || '模型服务不可用') + '。以上为程序化整理结果，不作为模型分析。') : null));
    }

    /* Tasks                                                               */
    /* ------------------------------------------------------------------ */

    function TasksView({ onOpen, onStartNew }) {
      const [query, setQuery] = useState('');
      const [status, setStatus] = useState('');
      const tasks = useLoad(() => api('GET', '/tasks?includeArchived=false').then((r) => r.tasks), []);
      const list = (tasks.data ?? [])
        .filter((task) => !status || task.status === status)
        .filter((task) => !query.trim() || businessTitle(task).toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      const filters = [['', '全部'], ['waiting_input', '待补资料'], ['running', '处理中'], ['failed', '未完成'], ['completed', '已完成'], ['draft', '草稿']];
      return h('div', { className: 'eew-col' },
        h(PageHeader, {
          title: '我的任务',
          description: '按业务名称找到之前的工作，直接看到结论、成果与下一步。',
          children: [h('button', { className: 'eew-btn', onClick: onStartNew }, '开始新工作')],
        }),
        h('div', { className: 'eew-row' },
          h('input', { className: 'eew-input', style: { flex: 1, minWidth: 200 }, placeholder: '搜索任务名称', value: query, onChange: (e) => setQuery(e.target.value), 'aria-label': '搜索任务' }),
          h('div', { className: 'eew-mode' }, ...filters.map(([value, label]) => h('button', {
            key: value || 'all', className: status === value ? 'on' : '', onClick: () => setStatus(value),
          }, label)))),
        h(Notice, { error: tasks.error, empty: tasks.busy ? null : (list.length === 0 ? '还没有任务。回到「开始工作」选择一个场景即可。' : null) }),
        h('div', { className: 'eew-col' }, ...list.map((task) => h('button', {
          key: task.id, type: 'button', className: 'eew-item click', onClick: () => onOpen(task.id),
        },
        h('div', { className: 'eew-col', style: { gap: 4 } },
          h('div', { className: 'eew-h3' }, businessTitle(task)),
          h('div', { className: 'eew-meta' }, `${formatTime(task.updatedAt)} · 下一步：${statusOf(task.status).next}`)),
        h('span', { className: 'eew-pill ' + statusOf(task.status).tone }, statusOf(task.status).label)))));
    }

    function TaskDetail({ taskId, onBack, onContinue, onPreview }) {
      const task = useLoad(() => api('GET', '/task?id=' + encodeURIComponent(taskId)), [taskId]);
      const flows = useLoad(() => api('GET', '/workflows'), []);
      const data = task.data;
      const lastSkillResult = [...(data?.results ?? [])].filter((item) => item.kind === 'skill').pop();
      const artifacts = (data?.results ?? []).flatMap((item) => item.artifacts ?? []);
      const run = (flows.data?.runs ?? []).find((item) => item.taskId === taskId);
      const lastError = [...(data?.errors ?? [])].pop();
      const pendingHints = (lastError?.missing ?? []).map((item) => item.hint || item.name).filter(Boolean);
      const missing = [...new Set([...pendingHints, ...(lastSkillResult?.failureReasons ?? [])])];
      const knowledge = (data?.citations ?? []);
      const uploadNames = Array.from(new Set((data?.inputs ? Object.values(data.inputs) : []).filter((value) => typeof value === 'string').slice(0, 6).map((value) => String(value).slice(0, 40))));
      const status = statusOf(data?.status);
      const canContinue = ['waiting_input', 'failed', 'draft', 'running', 'interrupted'].includes(data?.status);

      const artifactList = artifacts.length === 0
        ? h('div', { className: 'eew-sub' }, '还没有成果文件。')
        : h('div', { className: 'eew-col' },
          h('div', { className: 'eew-sub', style: { fontWeight: 600 } }, '已有成果'),
          ...artifacts.map((artifact) => {
            const name = artifact.filename ?? String(artifact.path ?? '').split(/[\\/]/).pop() ?? '成果文件';
            return h('div', { key: artifact.id, className: 'eew-item' },
              h('div', { className: 'eew-col', style: { gap: 2 } },
                h('div', { style: { fontSize: 12.5 } }, name),
                h('div', { className: 'eew-meta' }, [String(artifact.format ?? '').toUpperCase(), artifact.verified ? '已校验' : null].filter(Boolean).join(' · '))),
              h('div', { className: 'eew-row tight' },
                h('button', { className: 'eew-btn sec', onClick: () => onPreview(artifact.id) }, '预览'),
                h('a', { className: 'eew-btn', href: '/eew/artifact?id=' + encodeURIComponent(artifact.id), download: name }, '下载')));
          }));

      return h('div', { className: 'eew-col' },
        h('div', { className: 'eew-row' },
          h('button', { className: 'eew-btn ghost', onClick: onBack }, '← 返回任务列表'),
          h('h1', { className: 'eew-h1', style: { flex: 1, minWidth: 220 } }, data ? businessTitle(data) : '任务详情'),
          data ? h(StatusBadge, { status: data.status }) : null),
        h(Notice, { error: task.error, busy: task.busy, empty: !task.busy && !task.error && !data ? '没有找到这个任务' : null }),
        data ? h(React.Fragment, null,
          h('div', { className: 'eew-card eew-col' },
            h('div', { className: 'eew-between' },
              h('div', { className: 'eew-sub' }, `最近更新 ${formatTime(data.updatedAt)}`),
              h('div', { className: 'eew-meta' }, `下一步：${status.next}`)),
            h('div', { className: 'eew-h2' }, '上次结论'),
            h('div', { style: { fontSize: 13, lineHeight: 1.75 } },
              lastSkillResult?.summary || (data.results?.length ? '已完成，成果见下方' : '这个任务还没有完成过一次处理。')),
            artifactList,

          h('div', { className: 'eew-split' },
            h('section', { className: 'eew-card eew-col' },
              h('div', { className: 'eew-h2' }, '已提供的资料'),
              uploadNames.length === 0 && knowledge.length === 0 ? h('div', { className: 'eew-sub' }, '这个任务没有上传资料，结论来自你填写的信息。') : null,
              ...(knowledge.length ? [h('div', { className: 'eew-sub' }, `引用 ${knowledge.length} 处，可在结论中回溯原文`)] : []),
              ...uploadNames.map((text, i) => h('div', { key: i, className: 'eew-sub' }, '· ' + text))),
            h('section', { className: 'eew-card eew-col' },
              h('div', { className: 'eew-h2' }, '当前卡点与待补充'),
              missing.length === 0 ? h('div', { className: 'eew-sub' }, data.status === 'completed' ? '没有卡点，任务已完成。' : '没有记录阻塞原因。') : h('div', { className: 'eew-warnbox' }, missing.join('；')),
              data.status === 'waiting_input' ? h('div', { className: 'eew-sub' }, '补充缺失资料后会在这条任务上继续，不会新建任务。') : null)),

          run ? h('section', { className: 'eew-card eew-col' },
            h('div', { className: 'eew-h2' }, '流程进度'),
            h('div', { className: 'eew-sub' }, `${run.flowName} · 已完成 ${run.completedNodes}/${run.totalNodes} 个步骤 · 状态 ${statusOf(run.status).label}`),
            run.missing?.length ? h('div', { className: 'eew-warnbox' }, '待补充：' + run.missing.map((item) => item.hint ?? item.name).join('；')) : null,
            h('div', { className: 'eew-meta' }, '需要继续、重试或取消流程时，可在「能力与设置 → 业务流程」中操作。')) : null,

          h('div', { className: 'eew-row' },
            canContinue ? h('button', { className: 'eew-btn', onClick: () => onContinue(data) }, data.status === 'failed' ? '修改后重做' : data.status === 'waiting_input' ? '补充资料并继续' : '继续这次工作') : null,
            h('button', { className: 'eew-btn sec', disabled: task.busy, onClick: task.reload }, '刷新状态'),
            h('button', { className: 'eew-btn sec', onClick: async () => { try { const exported = await api('GET', '/task/export?id=' + encodeURIComponent(data.id)); download(exported.filename, exported.content, 'application/json'); } catch { /* noop */ } } }, '导出任务记录')))) : null);
    }

    /* ------------------------------------------------------------------ */
    /* Artifact library                                                    */
    /* ------------------------------------------------------------------ */

    function ArtifactsView({ onOpenTask, onPreview }) {
      const [query, setQuery] = useState('');
      const artifacts = useLoad(() => api('GET', '/artifacts').then((r) => r.artifacts), []);
      const tasks = useLoad(() => api('GET', '/tasks').then((r) => r.tasks), []);
      const taskMap = new Map((tasks.data ?? []).map((task) => [task.id, task]));
      const list = (artifacts.data ?? []).filter((artifact) => {
        const goal = taskMap.get(artifact.taskId)?.goal ?? '';
        return !query.trim() || (artifact.filename + goal).toLowerCase().includes(query.trim().toLowerCase());
      });
      return h('div', { className: 'eew-col' },
        h('div', { className: 'eew-between' },
          h('h1', { className: 'eew-h1' }, '成果库'),
          h('input', { className: 'eew-input', style: { minWidth: 240 }, placeholder: '搜索成果或关联任务', value: query, onChange: (e) => setQuery(e.target.value) })),
        h('div', { className: 'eew-sub' }, '这里保存每次工作生成的文件；同一任务可有多份版本，来源任务可直接打开。'),
        h(Notice, { error: artifacts.error, empty: artifacts.busy ? null : (list.length === 0 ? '还没有成果。完成一次工作后，成果会自动出现在这里。' : null) }),
        h('div', { className: 'eew-col' }, ...list.map((artifact) => h('div', { key: artifact.id, className: 'eew-item' },
          h('div', { className: 'eew-col', style: { gap: 3 } },
            h('div', { style: { fontSize: 13, fontWeight: 600 } }, artifact.filename),
            h('div', { className: 'eew-meta' },
              [String(artifact.format).toUpperCase(), formatBytes(artifact.bytes), `版本 v${artifact.version ?? 1}`, formatTime(artifact.createdAt), taskMap.get(artifact.taskId) ? '来源：' + businessTitle(taskMap.get(artifact.taskId)) : '来源：直接生成'].filter(Boolean).join(' · '))),
          h('div', { className: 'eew-row tight' },
            h('button', { className: 'eew-btn sec', onClick: () => onPreview(artifact.id) }, '预览'),
            h('a', { className: 'eew-btn sec', href: '/eew/artifact?id=' + encodeURIComponent(artifact.id), download: artifact.filename }, '下载'),
            artifact.taskId ? h('button', { className: 'eew-btn ghost', onClick: () => onOpenTask(artifact.taskId) }, '打开原任务') : null)))));
    }

    /* ------------------------------------------------------------------ */
    /* Knowledge                                                           */
    /* ------------------------------------------------------------------ */

    function KnowledgeView() {
      const [query, setQuery] = useState('');
      const [domain, setDomain] = useState('');
      const [tags, setTags] = useState('');
      const [title, setTitle] = useState('');
      const [hits, setHits] = useState([]);
      const [section, setSection] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const docs = useLoad(() => api('GET', '/knowledge').then((r) => r.docs), []);
      async function act(fn, message) {
        setBusy(true); setError(null);
        try { const value = await fn(); setNotice(message || '操作成功'); docs.reload(); return value; }
        catch (e) { setError(e.message); return null; } finally { setBusy(false); }
      }
      async function importFileList(fileList) {
        const files = Array.from(fileList || []);
        for (const file of files) {
          try {
            const data = await fileToBase64(file);
            setNotice(`正在解析 ${file.name}…`);
            const parsed = await api('POST', '/files/upload', { name: file.name, data });
            if (!parsed.parsed) { setError(`${file.name} 已上传，但没有解析出正文，请换一份文件或粘贴正文`); continue; }
            await act(() => api('POST', '/knowledge/import', {
              uploadId: parsed.uploadId, title: title || file.name,
              domain: domain || 'uploaded', tags: tags ? tags.split(/[,，]/).map((t) => t.trim()) : [],
            }), `已导入 ${file.name}（待核实）`);
          } catch (e) { setError(e.message); }
        }
        setTitle('');
      }
      return h('div', { className: 'eew-col' },
        h('div', { className: 'eew-between' },
          h('h1', { className: 'eew-h1' }, '知识库'),
          h('div', { className: 'eew-row' },
            h('input', { className: 'eew-input', style: { minWidth: 220 }, value: query, placeholder: '检索知识', onChange: (e) => setQuery(e.target.value) }),
            h('button', { className: 'eew-btn', onClick: async () => {
              setBusy(true); setError(null);
              try { const r = await api('GET', '/knowledge/search?query=' + encodeURIComponent(query)); setHits(r.hits); setNotice(r.status === 'no_match' ? r.note : `命中 ${r.hits.length} 条`); }
              catch (e) { setError(e.message); } finally { setBusy(false); }
            } }, '检索'))),
        h('div', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-h2' }, '导入资料（默认待核实）'),
          h('div', { className: 'eew-row' },
            h(Field, { label: '标题', value: title, onChange: setTitle, placeholder: '留空则用文件名' }),
            h(Field, { label: '分类', value: domain, onChange: setDomain, placeholder: '例如 sales-method' }),
            h(Field, { label: '标签', value: tags, onChange: setTags, placeholder: '逗号分隔' }),
            h('label', { className: 'eew-btn sec' }, '选择文件', h('input', { type: 'file', multiple: true, accept: ACCEPT_UPLOAD, style: { display: 'none' }, onChange: (e) => importFileList(e.target.files) }))),
          h('div', { className: 'eew-sub' }, '支持 Word / Excel / PDF / PPT / CSV / TXT / MD / JSON；也可直接粘贴正文：'),
          h(PasteImport, { onImport: (text, importTitle) => act(() => api('POST', '/knowledge/import', { title: importTitle, text, domain: domain || 'manual' }), '已导入正文（待核实）') })),
        h(Notice, { busy, error: error || docs.error, notice, empty: (docs.data || []).length === 0 ? '还没有知识条目。导入后可在结论中引用原文。' : null }),
        hits.length > 0 ? h('div', { className: 'eew-col' }, h('div', { className: 'eew-sub', style: { fontWeight: 600 } }, '检索命中'),
          ...hits.map((hit, i) => h('button', { key: i, type: 'button', className: 'eew-item click', onClick: async () => {
            try { setSection(await api('GET', `/knowledge/section?docId=${encodeURIComponent(hit.citation.docId)}&section=${encodeURIComponent(hit.citation.section || '')}&part=${hit.citation.part || 1}`)); } catch (e) { setError(e.message); }
          } }, h('div', null, `${hit.citation.title} / ${hit.citation.section} / 行 ${hit.citation.lines?.join('-')}`), h('div', { className: 'eew-sub' }, hit.citation.quote?.slice(0, 100))))) : null,
        section ? h('div', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-h2' }, `原文 ${section.title} / ${section.section}`),
          h('div', { className: 'eew-meta' }, `可信级别 ${section.trust} · 行 ${(section.lines || []).join('-')}`),
          h('pre', { className: 'eew-pre' }, section.text),
          h('button', { className: 'eew-btn sec', onClick: () => setSection(null) }, '关闭')) : null,
        h('div', { className: 'eew-card eew-col' }, h('div', { className: 'eew-h2' }, '知识条目'),
          (docs.data || []).length === 0 ? h('div', { className: 'eew-sub' }, '暂无条目') : null,
          ...(docs.data || []).map((doc) => h('div', { key: doc.id, className: 'eew-item' },
            h('div', { className: 'eew-col', style: { gap: 3 } },
              h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, doc.title),
              h('div', { className: 'eew-meta' }, [`v${doc.version}`, doc.domain, doc.trust === 'verified' ? '已核实' : '待核实', doc.source?.kind === 'upload' ? '来自上传' : doc.source?.kind === 'file' ? '来自文件' : '手动导入'].filter(Boolean).join(' · '))),
            h('div', { className: 'eew-row tight' },
              h('button', { className: 'eew-btn sec', onClick: async () => {
                try { const exported = await api('GET', '/knowledge/export?docId=' + encodeURIComponent(doc.id)); download(exported.filename, exported.content, 'text/markdown'); } catch (e) { setError(e.message); }
              } }, '导出'),
              doc.trust === 'unverified' ? h('button', { className: 'eew-btn', onClick: () => act(() => api('POST', '/knowledge/verify', { docId: doc.id, note: '用户审核' }), '已按用户判断提升为可信') }, '审核通过') : null,
              h('button', { className: 'eew-btn warn', onClick: () => act(() => api('DELETE', '/knowledge?docId=' + encodeURIComponent(doc.id)), '已归档') }, '删除'))))));
    }

    function PasteImport({ onImport }) {
      const [text, setText] = useState('');
      const [name, setName] = useState('粘贴资料');
      return h('div', { className: 'eew-col' },
        h('input', { className: 'eew-input', value: name, 'aria-label': '资料标题', onChange: (e) => setName(e.target.value) }),
        h('textarea', { className: 'eew-area', value: text, placeholder: '粘贴资料正文', rows: 3, onChange: (e) => setText(e.target.value) }),
        h('button', { className: 'eew-btn sec', style: { alignSelf: 'flex-start' }, disabled: !text.trim(), onClick: () => { onImport(text, name); setText(''); } }, '导入正文'));
    }

    /* ------------------------------------------------------------------ */
    /* Settings: skills / workflows / connectors / diagnostics             */
    /* ------------------------------------------------------------------ */

    function SkillsView() {
      const [query, setQuery] = useState('');
      const [scope, setScope] = useState('');
      const [detail, setDetail] = useState(null);
      const [editor, setEditor] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [duplicate, setDuplicate] = useState('reject');
      const list = useLoad(() => api('GET', `/skills?query=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}`).then((r) => r.skills), [query, scope]);

      async function withAction(fn, okMessage) {
        setBusy(true); setError(null); setNotice(null);
        try { const value = await fn(); setNotice(okMessage || '操作成功'); list.reload(); return value; }
        catch (e) { setError(e.message); return null; } finally { setBusy(false); }
      }
      async function importFiles(fileList) {
        const files = Array.from(fileList || []);
        const encoded = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = String(reader.result).split(',')[1] || '';
            const relative = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
            resolve({ path: relative, data: base64 });
          };
          reader.onerror = () => reject(new Error('读取失败：' + file.name));
          reader.readAsDataURL(file);
        })));
        if (!encoded.some((item) => item.path.toLowerCase().endsWith('skill.md'))) { setError('技能包必须包含 SKILL.md'); return; }
        await withAction(() => api('POST', '/skills/import', { files: encoded, onDuplicate: duplicate }), `已导入 ${encoded.length} 个文件；重名策略：${duplicate}`);
      }
      return h('div', { className: 'eew-col' },
        h('div', { className: 'eew-card eew-row' },
          h('input', { className: 'eew-input', value: query, placeholder: '搜索技能', onChange: (e) => setQuery(e.target.value) }),
          h('select', { className: 'eew-select', value: scope, onChange: (e) => setScope(e.target.value) }, h('option', { value: '' }, '全部来源'), h('option', { value: 'builtin' }, '随包技能（只读）'), h('option', { value: 'user' }, '我的技能')),
          h('select', { className: 'eew-select', value: duplicate, onChange: (e) => setDuplicate(e.target.value) }, h('option', { value: 'reject' }, '重名：拒绝'), h('option', { value: 'rename' }, '重名：自动改名'), h('option', { value: 'overwrite' }, '重名：覆盖用户技能')),
          h('label', { className: 'eew-btn sec' }, '导入技能文件包', h('input', { type: 'file', multiple: true, style: { display: 'none' }, onChange: (e) => importFiles(e.target.files) }))),
        h(Notice, { busy, error: error || list.error, notice, empty: (list.data || []).length === 0 ? '没有匹配的技能' : null }),
        h('div', { className: 'eew-grid' }, ...(list.data || []).map((s) => h('button', {
          key: s.name, type: 'button', className: 'eew-item click', onClick: async () => {
            try { const d = await api('GET', '/skill?name=' + encodeURIComponent(s.name)); setDetail(d); setEditor(''); } catch (e) { setError(e.message); }
          },
        }, h('div', { className: 'eew-col', style: { gap: 3 } },
          h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, s.name),
          h('div', { className: 'eew-meta' }, s.description?.slice(0, 70)),
          h('div', { className: 'eew-meta' }, `${s.scope} · v${s.version} · ${s.status}`))))),
        detail ? h('div', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-h2' }, `${detail.name} · ${detail.scope === 'user' ? '我的技能（可编辑）' : '随包技能（只读）'}`),
          h('div', { className: 'eew-sub' }, detail.description),
          h('div', { className: 'eew-meta' }, `执行器 ${detail.executor} · 资源 ${(detail.files || []).length} 个`),
          h('div', { className: 'eew-meta' }, '输入：' + (detail.inputs || []).map((i) => (FIELD_LABELS[i.name] || i.name) + (i.required ? '*' : '')).join('、')),
          h('div', { className: 'eew-meta' }, '验收：' + (detail.acceptance || []).join('；')),
          (detail.missingResources || []).length > 0 ? h('div', { className: 'eew-err' }, '缺少 references：' + detail.missingResources.join('、')) : null,
          detail.scope === 'user' ? h('div', { className: 'eew-col' },
            h('textarea', { className: 'eew-area', value: editor, placeholder: '粘贴新的 SKILL.md（含 YAML frontmatter）后保存', rows: 6, onChange: (e) => setEditor(e.target.value) }),
            h('div', { className: 'eew-row' },
              h('button', { className: 'eew-btn sec', disabled: !editor.trim(), onClick: async () => {
                const check = await withAction(() => api('POST', '/skills/validate', { markdown: editor }), '校验完成');
                if (check?.ok) setNotice('校验通过：' + check.definition.status);
                else if (check) setError('校验失败：' + (check.definition.errors || []).join('；'));
              } }, '校验格式'),
              h('button', { className: 'eew-btn', disabled: !editor.trim(), onClick: () => withAction(() => api('PUT', '/skill?name=' + encodeURIComponent(detail.name), { markdown: editor }), '已保存用户技能') }, '保存修改'),
              h('button', { className: 'eew-btn warn', onClick: () => withAction(() => api('DELETE', '/skill?name=' + encodeURIComponent(detail.name)), '已删除用户技能') }, '删除'),
              h('button', { className: 'eew-btn sec', onClick: async () => {
                try { const pack = await api('GET', '/skill/export?name=' + encodeURIComponent(detail.name)); download(detail.name + '.skill.json', JSON.stringify(pack, null, 2), 'application/json'); } catch (e) { setError(e.message); }
              } }, '导出文件包'))) : h('div', { className: 'eew-sub' }, '随包技能在插件升级时更新，不会被用户技能覆盖；如需自定义请导入改名副本。'),
          h('button', { className: 'eew-btn sec', style: { alignSelf: 'flex-start' }, onClick: () => setDetail(null) }, '关闭')) : null);
    }

    function WorkflowsView() {
      const flows = useLoad(() => api('GET', '/workflows'), []);
      const [flowId, setFlowId] = useState('');
      const [runId, setRunId] = useState('');
      const [inputs, setInputs] = useState({});
      const [supplement, setSupplement] = useState({});
      const [confirm, setConfirm] = useState(false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [detail, setDetail] = useState(null);
      async function act(fn, message) {
        setBusy(true); setError(null);
        try { const value = await fn(); setNotice(message || '操作成功'); flows.reload(); return value; }
        catch (e) { setError(e.message); return null; } finally { setBusy(false); }
      }
      async function loadRun(id) {
        if (!id) { setDetail(null); return; }
        try { setDetail((await api('GET', '/workflows?id=' + encodeURIComponent(id))).run); } catch (e) { setError(e.message); }
      }
      const flow = (flows.data?.flows ?? []).find((item) => item.id === flowId);
      const runs = (flows.data?.runs ?? []).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
      const pendingNode = detail?.flow?.nodes?.find((node) => node.id === detail?.pendingNode);
      return h('div', { className: 'eew-col' },
        h('div', { className: 'eew-sub' }, '跨多人、多步骤的长流程。日常任务无需使用；流程进度也会显示在对应任务详情里。'),
        h('div', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-h2' }, '启动业务流程'),
          h('div', { className: 'eew-row' },
            h('select', { className: 'eew-select', value: flowId, onChange: (e) => setFlowId(e.target.value) }, h('option', { value: '' }, '选择流程'), ...(flows.data?.flows ?? []).map((item) => h('option', { key: item.id, value: item.id }, item.name))),
            h('label', { className: 'eew-field', style: { minWidth: 180 } }, h('span', null, '成果格式'),
              h('select', { className: 'eew-select', value: inputs.format ?? 'md', onChange: (e) => setInputs({ ...inputs, format: e.target.value }) }, ...FORMAT_OPTIONS.map((item) => h('option', { key: item.value, value: item.value }, item.label))))),
          flow ? h(FlowInputForm, { fields: flow.input, values: inputs, onChange: setInputs, title: '业务输入（表单，无需 JSON）' }) : null,
          h('div', { className: 'eew-row' },
            h('button', { className: 'eew-btn', disabled: busy || !flowId, onClick: async () => {
              const started = await act(() => api('POST', '/workflow/start', { flowId, input: inputs }), '流程已启动');
              if (started?.id) { setRunId(started.id); loadRun(started.id); }
            } }, busy ? '正在启动…' : '启动流程'))),
        h(Notice, { busy, error: error || flows.error, notice }),
        h('div', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-h2' }, '流程运行'),
          runs.length === 0 ? h('div', { className: 'eew-sub' }, '还没有运行记录。') : null,
          ...runs.slice(0, 10).map((run) => h('button', {
            key: run.id, type: 'button', className: 'eew-item click', onClick: () => { setRunId(run.id); loadRun(run.id); },
          }, h('div', { className: 'eew-col', style: { gap: 3 } },
            h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, run.flowName ?? run.flowId),
            h('div', { className: 'eew-meta' }, `已完成 ${run.completedNodes}/${run.totalNodes ?? '?'} 步 · ${formatTime(run.updatedAt)}`)),
          h('span', { className: 'eew-pill ' + statusOf(run.status).tone }, statusOf(run.status).label)))),
        detail ? h('div', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-between' },
            h('div', { className: 'eew-h2' }, detail.flow?.name ?? detail.flowId),
            h(StatusBadge, { status: detail.status })),
          h('div', { className: 'eew-sub' }, '真实步骤与当前状态：'),
          ...(detail.flow?.nodes ?? []).map((node) => {
            const state = detail.nodeResults?.[node.id]?.status ?? (detail.pendingNode === node.id ? 'waiting' : 'pending');
            const tone = state === 'completed' ? 'ok' : state === 'failed' ? 'danger' : state === 'waiting' || state === 'needs_input' ? 'warn' : 'neutral';
            return h('div', { key: node.id, className: 'eew-row tight' },
              h('span', { className: 'eew-pill ' + tone }, { completed: '已完成', failed: '未完成', waiting: '等待中', needs_input: '待补资料', pending: '未开始' }[state] ?? state),
              h('span', { className: 'eew-sub' }, node.id + (node.skill ? ` · ${node.skill}` : '')));
          }),
          detail.confirmationPrompt ? h('div', { className: 'eew-warnbox' }, detail.confirmationPrompt) : null,
          detail.confirmationPrompt ? h('label', { className: 'eew-row tight' },
            h('input', { type: 'checkbox', checked: confirm, onChange: (e) => setConfirm(e.target.checked) }),
            h('span', { className: 'eew-sub' }, '我确认执行有外部副作用的步骤')) : null,
          detail.status === 'waiting_input' ? h('div', { className: 'eew-col' },
            h('div', { className: 'eew-sub' }, '待补充：' + (detail.missing ?? []).map((item) => item.hint ?? item.name).join('；')),
            h('div', { className: 'eew-grid' }, ...(detail.missing ?? []).map((item) => h(Field, {
              key: item.name, label: FIELD_LABELS[item.name] || item.name, value: supplement[item.name] ?? '',
              onChange: (value) => setSupplement({ ...supplement, [item.name]: value }),
            })))) : null,
          h('div', { className: 'eew-row' },
            ['waiting_input', 'failed', 'interrupted', 'running'].includes(detail.status) ? h('button', { className: 'eew-btn', disabled: busy, onClick: async () => {
              const resumed = await act(() => api('POST', '/workflow/resume', {
                runId: detail.id, input: { ...(detail.input ?? {}), ...supplement },
                confirm: detail.status === 'waiting_confirmation' ? confirm : undefined,
              }), '已继续');
              if (resumed) loadRun(detail.id);
            } }, '继续执行') : null,
            detail.pendingNode && !['cancelled', 'completed'].includes(detail.status) ? h('button', { className: 'eew-btn sec', disabled: busy, onClick: async () => {
              const retried = await act(() => api('POST', '/workflow/retry', { runId: detail.id, nodeId: detail.pendingNode }), '已重试当前步骤');
              if (retried) loadRun(detail.id);
            } }, '重试当前步骤') : null,
            !['cancelled', 'completed'].includes(detail.status) ? h('button', { className: 'eew-btn warn', onClick: async () => {
              const cancelled = await act(() => api('POST', '/workflow/cancel', { runId: detail.id, reason: '用户取消' }), '已取消');
              if (cancelled) loadRun(detail.id);
            } }, '取消流程') : null,
            h('button', { className: 'eew-btn ghost', onClick: () => { setDetail(null); setRunId(''); } }, '关闭'))) : null);
    }

    function ConnectorsView() {
      const list = useLoad(() => api('GET', '/connectors'), []);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [config, setConfig] = useState('{}');
      return h('div', { className: 'eew-col' },
        h('div', { className: 'eew-sub' }, '外部系统连接需要单独配置与凭据；未连接时不会显示「连接成功」，工作区功能也不受影响。'),
        h(Notice, { error: error || list.error, notice }),
        h('div', { className: 'eew-col' }, ...((list.data?.connectors ?? []).map((connector) => h('div', { key: connector.id, className: 'eew-item' },
          h('div', { className: 'eew-col', style: { gap: 3 } },
            h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, connector.name ?? connector.id),
            h('div', { className: 'eew-meta' }, connector.description ?? '')),
          h('div', { className: 'eew-row tight' },
            h('span', { className: 'eew-pill ' + (connector.status === 'connected' ? 'ok' : 'neutral') }, connector.status === 'connected' ? '已连接' : '未连接'),
            h('button', { className: 'eew-btn sec', onClick: async () => {
              try { const diagnosis = await api('GET', '/connector/diagnose?id=' + encodeURIComponent(connector.id)); setNotice(`${connector.name ?? connector.id}：${diagnosis.status ?? '未知'}`); } catch (e) { setError(e.message); }
            } }, '诊断')))))),
        h('div', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-h2' }, '校验连接配置（技术）'),
          h('textarea', { className: 'eew-area', rows: 3, value: config, onChange: (e) => setConfig(e.target.value), placeholder: '{"endpoint":"https://…"}' }),
          h('button', { className: 'eew-btn sec', style: { alignSelf: 'flex-start' }, onClick: async () => {
            setError(null);
            try { await api('POST', '/connectors/validate', { config: JSON.parse(config || '{}') }); setNotice('配置格式校验通过（不代表已连通）'); }
            catch (e) { setError(e.message); }
          } }, '校验配置')));
    }

    function DiagnosticsView() {
      const diag = useLoad(() => api('GET', '/diagnostics'), []);
      const state = useLoad(() => api('GET', '/state'), []);
      return h('div', { className: 'eew-col' },
        h('div', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-h2' }, '运行状态'),
          h('div', { className: 'eew-kpi' },
            h('div', null, h('div', { className: 'eew-meta' }, '任务'), h('div', null, String(state.data?.state?.tasks ?? '-'))),
            h('div', null, h('div', { className: 'eew-meta' }, '知识条目'), h('div', null, String(state.data?.state?.knowledgeDocs ?? '-'))),
            h('div', null, h('div', { className: 'eew-meta' }, '成果'), h('div', null, String(state.data?.state?.artifacts ?? '-'))),
            h('div', null, h('div', { className: 'eew-meta' }, '模型分析'), h('div', null, state.data?.state?.model?.available ? '可用' : '不可用')))),
        h('div', { className: 'eew-card eew-col' },
          h('div', { className: 'eew-h2' }, '最近操作'),
          h(Notice, { error: diag.error, busy: diag.busy, empty: (diag.data?.recent ?? []).length === 0 ? '暂无记录' : null }),
          h('div', { className: 'eew-col' }, ...((diag.data?.recent ?? []).slice(0, 20)).map((item, i) => h('div', { key: i, className: 'eew-meta' },
            `${formatTime(item.at)} · ${item.action} · ${item.status}${item.taskId ? ' · ' + item.taskId : ''}${item.message ? ' · ' + item.message : ''}`)))));
    }

    function SettingsView({ onOpenKnowledge }) {
      const [tab, setTab] = useState('skills');
      const tabs = [['skills', '技能'], ['workflows', '业务流程'], ['connectors', '外部连接'], ['diagnostics', '运行状态']];
      const body = { skills: SkillsView, workflows: WorkflowsView, connectors: ConnectorsView, diagnostics: DiagnosticsView }[tab];
      return h('div', { className: 'eew-col' },
        h(PageHeader, {
          title: '能力与设置',
          description: '技能、业务流程、外部连接与运行状态集中在这里，日常业务操作不需要进入。',
          children: [h('button', { className: 'eew-btn sec', onClick: onOpenKnowledge }, '打开知识库')],
        }),
        h('div', { className: 'eew-mode' }, ...tabs.map(([id, label]) => h('button', { key: id, className: tab === id ? 'on' : '', onClick: () => setTab(id) }, label))),
        h(body, { key: tab }));
    }

    /* ------------------------------------------------------------------ */
    /* App                                                                 */
    /* ------------------------------------------------------------------ */

    function App() {
      const [tab, setTab] = useState('home');
      const [draft, setDraft] = useState(loadDraft);
      const [work, setWork] = useState({ result: null, missing: [] });
      const [taskId, setTaskId] = useState(null);
      const [previewId, setPreviewId] = useState(null);
      const [toast, setToast] = useState(null);

      useEffect(() => { saveDraft(draft); }, [draft]);
      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 2600);
        return () => clearTimeout(timer);
      }, [toast]);

      const update = useCallback((patch) => {
        setDraft((previous) => {
          if (typeof patch === 'function') return { ...previous, ...patch(previous) };
          return { ...previous, ...patch };
        });
      }, []);

      function startScenario(scenario) {
        try {
          const previous = JSON.parse(localStorage.getItem(RECENT_SCENARIOS_KEY) ?? '[]');
          const next = [scenario.id, ...previous.filter((id) => id !== scenario.id)].slice(0, 6);
          localStorage.setItem(RECENT_SCENARIOS_KEY, JSON.stringify(next));
        } catch { /* storage unavailable: recent list is optional */ }
        update({
          goal: scenario.goal, expertId: scenario.expertId, skillName: scenario.skillName,
          format: scenario.format, scenarioId: scenario.id, actionLabel: scenario.action,
          formValues: {}, uploads: [], taskId: '', submissionKey: uuid(),
        });
        setWork({ result: null, missing: [] });
        setTaskId(null);
        setTab('workbench');
      }

      function quickStart(goal) {
        update({ goal, expertId: '', skillName: '', scenarioId: '', actionLabel: '开始工作', formValues: {}, uploads: [], taskId: '', submissionKey: uuid() });
        setWork({ result: null, missing: [] });
        setTab('workbench');
      }

      function continueTask(task) {
        // Reopening a waiting task shows the same missing questions without
        // running anything again; the uploads and inputs are already kept.
        const lastError = [...(task.errors ?? [])].pop();
        const seeded = Array.isArray(lastError?.missing) ? lastError.missing : [];
        update({
          taskId: task.id, goal: task.goal ?? '', expertId: task.expertId ?? '',
          skillName: '', scenarioId: '', actionLabel: '继续这次工作',
          formValues: task.inputs ?? {},
        });
        setWork({ result: null, missing: seeded });
        setTab('workbench');
        setToast(seeded.length ? '已载入历史任务，只需补充缺少的资料' : '已载入历史任务，可继续处理');
      }

      const views = {
        home: HomeView, workbench: WorkbenchView, tasks: TasksView, task: TaskDetail,
        artifacts: ArtifactsView, knowledge: KnowledgeView, settings: SettingsView,
      };
      const viewProps = tab === 'home'
        ? {
          draft,
          onStart: startScenario,
          onQuickStart: quickStart,
          onOpenTask: (id) => { setTaskId(id); setTab('task'); },
          onOpenArtifact: (id) => setPreviewId(id),
          onOpenTaskList: () => setTab('tasks'),
          onResumeDraft: () => setTab('workbench'),
        }
        : tab === 'workbench'
          ? { draft, update, work, setWork, onOpenTask: (id) => { setTaskId(id); setTab('task'); } }
          : tab === 'tasks'
            ? { onOpen: (id) => { setTaskId(id); setTab('task'); }, onStartNew: () => setTab('home') }
            : tab === 'task'
              ? { taskId, onBack: () => setTab('tasks'), onContinue: continueTask, onPreview: (id) => setPreviewId(id) }
              : tab === 'artifacts'
                ? { onOpenTask: (id) => { setTaskId(id); setTab('task'); }, onPreview: (id) => setPreviewId(id) }
                : tab === 'settings'
                  ? { onOpenKnowledge: () => setTab('knowledge') }
                  : {};

      return h('div', { className: 'eew' },
        h('nav', { className: 'eew-nav', 'aria-label': '主导航' }, ...NAV_GROUPS.map((group) => h('div', { className: 'eew-navgroup', key: group.label },
          h('span', { className: 'eew-navlabel' }, group.label),
          ...group.items.map((item) => h('button', {
            key: item.id, className: tab === item.id || (item.id === 'tasks' && tab === 'task') ? 'on' : '',
            'aria-current': tab === item.id ? 'page' : undefined,
            onClick: () => { setTab(item.id); if (item.id === 'tasks') setTaskId(null); },
          }, h(NavIcon, { name: item.icon }), item.label))))),
        h('div', { className: 'eew-scroll' },
          h(views[tab], { key: tab, ...viewProps })),
        toast ? h('div', { className: 'eew-ok', style: { position: 'absolute', bottom: 14, right: 18, maxWidth: 360 } }, toast) : null,
        previewId ? h(ArtifactPreview, { id: previewId, onClose: () => setPreviewId(null) }) : null);
    }

    function apply(ctx) {
      ctx.effect(function styles() {
        if (document.getElementById('eew-styles')) return undefined;
        const style = document.createElement('style');
        style.id = 'eew-styles'; style.textContent = STYLES + RESPONSIVE_FIX;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'eew:styles');
      ctx.effect(function sidebar() {
        return ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => '企业专家工作台' }, Icon));
      }, 'eew:sidebar');
      ctx.effect(function main() {
        return ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: PANEL_ID, inject: () => ({}) }, EewRoot));
      }, 'eew:main');
    }

    /**
     * A render failure must not leave the user with a blank panel. The boundary
     * keeps the message in business language, keeps the draft in localStorage
     * and offers one obvious way forward.
     */
    class EewBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null }; }
      static getDerivedStateFromError(error) { return { error }; }
      componentDidCatch(error) {
        // The user sees a business-language fallback; the console keeps the
        // technical cause so a failed render can still be diagnosed.
        console.error('[eew] 工作台渲染失败', error);
        try {
          const current = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
          localStorage.setItem(DRAFT_KEY, JSON.stringify(current));
        } catch { /* draft persistence is best effort */ }
      }
      render() {
        if (!this.state.error) return this.props.children;
        return h('div', { className: 'eew-col', style: { padding: '32px 28px', gap: '12px' } },
          h('h1', { className: 't', style: { fontSize: '18px', fontWeight: '650', margin: 0 } }, '工作台没有正常打开'),
          h('p', { className: 'd', style: { fontSize: '13px', color: 'var(--eew-text-2)', margin: 0 } },
            '你填写的内容仍保存在本机草稿里，刷新后可以继续。'),
          h('div', { className: 'eew-row' },
            h('button', { className: 'eew-btn', onClick: () => window.location.reload() }, '刷新页面'),
            h('button', { className: 'eew-btn sec', onClick: () => this.setState({ error: null }) }, '重新打开工作台')));
      }
    }

    function EewRoot() {
      return h(EewBoundary, null, h(App));
    }

    return { inject: ['slots'], apply };
  },
});
