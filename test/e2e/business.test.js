import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../../capabilities/catalog.js';
import { createWorkspace } from '../../src/core/workspace.js';
import { readDocument } from '../../src/core/files.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(ROOT, 'assets');

async function fresh() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eew-e2e-'));
  return { dir, ws: await createWorkspace({ dataDir: dir, assetsDir: ASSETS, catalog }) };
}

async function seedKnowledge(ws) {
  return ws.knowledge.importText({
    title: '企业客户方法论',
    text: '# 商机评估\n\n先确认决策链与采购流程，避免把假设当成事实。\n\n# 复盘方法\n\n按背景、决策、结果、经验四栏整理。\n',
    domain: 'sales-method',
    trust: 'unverified',
  });
}

async function assertArtifact(artifact) {
  const info = await stat(artifact.path);
  assert.ok(info.size > 0, '成果文件必须真实存在且非空');
  const reopened = await readDocument(artifact.path);
  assert.equal(reopened.meta.format, artifact.format);
  assert.ok(artifact.verified, '成果必须通过回读校验');
}

/** Ten representative end-to-end business chains, one per professional direction. */
const CHAINS = [
  {
    expert: 'knowledge-management', skill: 'km-review', format: 'md',
    goal: '复盘客户 A 项目并沉淀经验',
    input: { project: '客户 A 项目', material: '按背景、决策、结果整理项目资料', context: '首次交付', decisions: '采用分阶段验证', outcome: '按期交付' },
    expect: (outcome) => assert.ok(outcome.result.content.tables.length > 0),
  },
  {
    expert: 'hr', skill: 'hr-compare-candidates', format: 'xlsx',
    goal: '完成候选人评估对比',
    input: { candidates: [
      { name: '甲', scores: { 专业能力: 5, 经验匹配: 4, 沟通协作: 3 } },
      { name: '乙', scores: { 专业能力: 3, 经验匹配: 5, 沟通协作: 4 } },
    ], criteria: [{ name: '专业能力', weight: 2 }, { name: '经验匹配', weight: 1 }, { name: '沟通协作', weight: 1 }], decisionOwner: '用人部门' },
    expect: (outcome) => assert.ok(outcome.result.content.tables[0].rows.length === 2),
  },
  {
    expert: 'personal-workbench', skill: 'personal-goal-breakdown', format: 'md',
    goal: '拆解本季度岗位目标',
    input: { goal: '提升交付质量', horizon: '本季度', tasks: [{ name: '梳理验收清单', priority: '高', owner: '张三' }, { name: '建立复查点' }] },
    expect: (outcome) => assert.equal(outcome.result.content.tables[0].rows.length, 2),
  },
  {
    expert: 'management', skill: 'management-diagnose', format: 'xlsx',
    goal: '诊断经营指标偏差',
    input: { metrics: [{ name: '营收', target: 1000, actual: 850 }, { name: '成本', target: 600, actual: 660 }, { name: '续约率', target: 0.9 }] },
    expect: (outcome) => assert.equal(outcome.result.structured.problemCount >= 1, true),
  },
  {
    expert: 'key-account-sales', skill: 'sales-opportunity-card', format: 'docx',
    goal: '生成客户 A 商机卡',
    input: { customer: '客户 A', stage: '方案评估', stakeholders: [{ role: '决策者', concern: '投入产出' }], needs: '降本增效', evidence: '会议纪要', nextAction: '确认采购流程', query: '决策链' },
    expect: (outcome) => assert.ok(outcome.result.content.tables[0].rows.some((row) => row[0] === '阶段')),
  },
  {
    expert: 'market-research', skill: 'research-verify', format: 'md',
    goal: '核验行业研究结论',
    input: { claims: [
      { statement: '行业增速 12%', source: '行业报告', evidence: '第 3 页表格' },
      { statement: '竞品已中标', source: '' },
    ], question: '核验' },
    expect: (outcome) => assert.equal(outcome.result.structured.verified, 1),
  },
  {
    expert: 'data-analysis', skill: 'data-metrics', format: 'xlsx',
    goal: '计算区域收入指标',
    input: { rows: [['区域', '收入'], ['华东', 100], ['华南', 200], ['华东', 300]], columns: ['区域', '收入'], field: '收入', groupBy: '区域' },
    expect: (outcome) => assert.equal(outcome.result.structured.metrics.sum, 600),
  },
  {
    expert: 'document-office', skill: 'document-deliver', format: 'pptx',
    goal: '生成客户简报材料',
    input: { title: '客户 A 简报', sections: [{ heading: '结论', paragraphs: ['基于已提供资料的判断。'] }], tables: [{ name: '要点', columns: ['项目', '内容'], rows: [['现状', '已确认']] }] },
    expect: (outcome) => assert.equal(outcome.result.structured.format, 'pptx'),
  },
  {
    expert: 'procurement', skill: 'procurement-tco', format: 'csv',
    goal: '测算三家供应商总成本',
    input: { quotes: [
      { vendor: 'A', unitPrice: 10, quantity: 100, implementation: 500, annualMaintenance: 200, training: 100 },
      { vendor: 'B', unitPrice: 12, quantity: 100, implementation: 0, annualMaintenance: 0, training: 0 },
      { vendor: 'C', unitPrice: 8 },
    ], years: 3, currency: '人民币', taxBasis: '不含税', scope: '同范围硬件维保' },
    expect: (outcome) => assert.equal(outcome.result.structured.calculated[0].vendor, 'B'),
  },
  {
    expert: 'data-governance', skill: 'governance-inventory', format: 'xlsx',
    goal: '盘点数据资产样本',
    input: { samples: [{ name: '客户表', fields: ['id', 'name', 'phone'], rows: [{ id: 1 }] }, { name: '订单表', fields: ['order_id'], rows: [] }] },
    expect: (outcome) => assert.equal(outcome.result.structured.fullScan, false),
  },
];

test('ten professional directions: real end-to-end chain, saved state, real artifact', async () => {
  const { dir, ws } = await fresh();
  try {
    const seeded = await seedKnowledge(ws);
    assert.ok(seeded.doc.id);
    for (const chain of CHAINS) {
      const response = await ws.dispatch({
        goal: chain.goal, expertId: chain.expert, skillName: chain.skill,
        input: { ...chain.input, workspaceId: 'default' },
        format: chain.format, workspaceId: 'default',
      });
      assert.equal(response.ok, true, `${chain.expert}: ${JSON.stringify(response.outcome?.error ?? response.outcome?.message)}`);
      assert.equal(response.task.status, 'completed');
      assert.ok(response.outcome.artifacts.length > 0, `${chain.expert} 必须交付成果文件`);
      chain.expect(response.outcome);
      for (const artifact of response.outcome.artifacts) await assertArtifact(artifact);
      for (const citation of response.outcome.citations) {
        const section = await ws.knowledge.readSection({ docId: citation.docId, section: citation.section, part: citation.part ?? 1, workspaceId: 'default' });
        assert.ok(section.text.includes(citation.quote.slice(0, 8)), '引用必须回到实际原文');
      }
      // Progress survives a process restart.
      const restarted = await createWorkspace({ dataDir: dir, assetsDir: ASSETS, catalog });
      const loaded = await restarted.tasks.load(response.task.id);
      assert.equal(loaded.status, 'completed');
      assert.ok(loaded.results.length > 0);
    }
    assert.equal((await ws.tasks.list({ workspaceId: 'default' })).length, CHAINS.length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing input and dependency failure: explicit gaps, no fabricated success', async () => {
  const { dir, ws } = await fresh();
  try {
    const missing = await ws.dispatch({ goal: '岗位分析', expertId: 'hr', skillName: 'hr-job-analysis', input: {}, workspaceId: 'default' });
    assert.equal(missing.ok, false);
    assert.equal(missing.stage, 'waiting_input');
    assert.equal(missing.outcome, null, '缺口未补齐时不得执行并伪造结果');
    assert.ok(missing.missing.some((item) => item.name === 'role'));
    assert.equal(missing.task.status, 'waiting_input');
    assert.ok(missing.questions.includes('岗位名称'), '必须用业务语言询问缺口');

    const resumed = await ws.dispatch({ goal: '岗位分析', skillName: 'hr-job-analysis', input: { role: '客户经理', responsibilities: ['客户开拓'] }, taskId: missing.task.id, workspaceId: 'default' });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.task.id, missing.task.id, '继续处理不能错绑新任务');

    const empty = await ws.dispatch({ goal: '检索知识', skillName: 'knowledge-retrieve', input: { query: '完全不存在的主题ABCXYZ' }, workspaceId: 'default' });
    assert.equal(empty.outcome.result.structured.status, 'no_match');
    assert.ok(empty.outcome.evidence.unknowns.length > 0);

    const failed = await ws.dispatch({ goal: '读取文件并提取内容', expertId: 'document-office', skillName: 'document-extract', input: { path: path.join(dir, 'no-such-file.docx') }, workspaceId: 'default' });
    assert.equal(failed.outcome.status, 'failed');
    assert.ok(failed.outcome.error.message.includes('不存在'));
    assert.equal(failed.task.status, 'failed');

    const badConfig = ws.connectors.validateConfig({ name: 'demo', transport: 'http', url: 'https://example.com', token: 'SHOULD-NOT-BE-HERE' });
    assert.equal(badConfig.ok, false);
    assert.ok(badConfig.problems.some((item) => item.includes('秘密字段')));
    assert.equal(ws.diagnostics.authorize('external.action').granted, false);
    assert.equal(ws.diagnostics.authorize('external.action', { granted: ['external.action'] }).granted, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cross-domain chains pass structured results and citations, not transcripts', async () => {
  const { dir, ws } = await fresh();
  try {
    const seeded = await seedKnowledge(ws);
    // 1. HR -> professional judgement -> onboarding -> personal workbench -> knowledge
    const hr = await ws.dispatch({ goal: '招聘客户经理', expertId: 'hr', skillName: 'hr-compare-candidates', input: {
      candidates: [{ name: '甲', scores: { 专业能力: 5 } }, { name: '乙', scores: { 专业能力: 3 } }],
      criteria: [{ name: '专业能力', weight: 1 }], query: '决策链',
    }, format: 'md', workspaceId: 'default' });
    assert.ok(hr.outcome.citations.length > 0, 'HR 结论必须带可回溯引用');
    const hrHandoff = await ws.experts.handoff({
      fromTaskId: hr.task.id, toExpertId: 'personal-workbench', goal: '生成入职培养计划',
      workspaceId: 'default', conclusions: [hr.outcome.result.structured],
    });
    const onboardingTask = await ws.tasks.load(hrHandoff.taskId);
    assert.equal(onboardingTask.citations.length, hr.outcome.citations.length);
    assert.equal(onboardingTask.parentTaskId, hr.task.id);
    const onboarding = await ws.dispatch({ skillName: 'personal-goal-breakdown', taskId: onboardingTask.id, input: { goal: '入职首月目标', tasks: [{ name: '熟悉客户资料' }] }, format: 'md', workspaceId: 'default' });
    assert.equal(onboarding.ok, true);
    assert.equal(onboarding.task.citations.length, hr.outcome.citations.length, '引用在专家切换后仍绑定原任务');

    // 2. Market research -> sales judgement -> material -> opportunity record
    const research = await ws.dispatch({ goal: '研究客户 A 所在行业', expertId: 'market-research', skillName: 'research-verify', input: {
      claims: [{ statement: '采购流程已确认', source: '客户纪要', evidence: '第 2 节' }], query: '决策链',
    }, format: 'md', workspaceId: 'default' });
    const evidence = await ws.dispatch({ goal: '检索客户与行业证据', skillName: 'knowledge-retrieve', input: { query: '决策链' }, workspaceId: 'default' });
    assert.ok(evidence.outcome.citations.length > 0);
    await ws.tasks.addCitation(research.task.id, evidence.outcome.citations[0]);
    const salesHandoff = await ws.experts.handoff({ fromTaskId: research.task.id, toExpertId: 'key-account-sales', goal: '判断商机并更新记录', workspaceId: 'default', conclusions: [research.outcome.result.structured] });
    const salesTask = await ws.tasks.load(salesHandoff.taskId);
    assert.ok(salesTask.citations.length > 0, '研究证据必须随交接传递到销售任务');
    const sales = await ws.dispatch({ skillName: 'sales-opportunity-card', taskId: salesTask.id, input: { customer: '客户 A', stage: '方案评估' }, format: 'docx', workspaceId: 'default' });
    assert.equal(sales.ok, true);
    await ws.tasks.setBusiness(sales.task.id, 'opportunity', { customer: '客户 A', stage: '方案评估', evidence: '研究结论已传递', nextAction: '确认采购流程' });
    const business = await ws.tasks.load(sales.task.id);
    assert.equal(business.business.type, 'opportunity');
    assert.equal(business.business.fields.customer, '客户 A', '业务对象保留自有字段');

    // 3. Data analysis -> management diagnosis -> responsibility actions -> KM review
    const data = await ws.dispatch({ goal: '计算区域收入', expertId: 'data-analysis', skillName: 'data-metrics', input: {
      rows: [['区域', '收入'], ['华东', 100], ['华南', 250]], columns: ['区域', '收入'], field: '收入',
    }, workspaceId: 'default' });
    const diagnosed = await ws.dispatch({ goal: '诊断经营偏差', expertId: 'management', skillName: 'management-diagnose', input: {
      metrics: [{ name: '收入', target: 400, actual: data.outcome.result.structured.metrics.sum }], query: '复盘',
    }, format: 'md', workspaceId: 'default' });
    assert.equal(diagnosed.outcome.result.structured.diagnosed[0].deviation, -50, '数据结果实际传入经营诊断');
    const improve = await ws.dispatch({ goal: '分解责任与行动', expertId: 'personal-workbench', skillName: 'task-plan', input: {
      goal: '改进收入偏差', tasks: [{ name: '复查华东区域', priority: '高' }],
    }, format: 'md', workspaceId: 'default' });
    assert.equal(improve.ok, true);
    const review = await ws.dispatch({ goal: '保存复盘经验', expertId: 'knowledge-management', skillName: 'km-review', input: {
      project: '经营改进', material: `数据结果 ${data.outcome.result.structured.metrics.sum}，诊断 ${diagnosed.outcome.result.structured.diagnosed[0].deviation}`, query: '复盘',
    }, format: 'md', workspaceId: 'default' });
    assert.ok(review.outcome.citations.length > 0);
    assert.equal(review.outcome.citations[0].docId, seeded.doc.id, '引用来自真实导入的知识');

    const restarted = await createWorkspace({ dataDir: dir, assetsDir: ASSETS, catalog });
    assert.ok((await restarted.tasks.list({ workspaceId: 'default' })).length >= 7);
    assert.equal((await restarted.tasks.load(sales.task.id)).business.fields.customer, '客户 A');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cross-domain workflows execute with persisted node results', async () => {
  const { dir, ws } = await fresh();
  try {
    await seedKnowledge(ws);
    const chains = [
      { id: 'cross-hr-onboarding', input: { role: '客户经理', responsibilities: ['客户开拓'], requirements: '3 年经验', candidates: [{ name: '甲', scores: { 专业能力: 5 } }], goal: '入职首月', query: '复盘' } },
      { id: 'cross-research-sales', input: { question: '行业机会', sources: [{ name: '行业报告', url: 'https://example.com/report' }], claims: [{ statement: '增速 12%', source: '行业报告', evidence: '第 3 页' }], customer: '客户 A', material: '客户资料', query: '决策链' } },
      { id: 'cross-management-improve', input: { rows: [['区域', '收入'], ['华东', 100], ['华南', 200]], columns: ['区域', '收入'], field: '收入', metrics: [{ name: '收入', target: 400, actual: 300 }], problems: [{ name: '收入偏差', action: '复查' }], actions: [{ name: '复查', owner: '张三' }], material: '复盘材料', query: '复盘' } },
    ];
    for (const chain of chains) {
      const run = await ws.workflows.start({ flowId: chain.id, input: chain.input, workspaceId: 'default' });
      assert.ok(['completed', 'waiting_input', 'waiting_confirmation'].includes(run.status), `${chain.id}: ${run.status} ${JSON.stringify(run.error)}`);
      const detail = await ws.workflows.get(run.id);
      assert.ok(Object.keys(detail.nodeResults).length >= 1, '已完成节点必须持久化');
      if (run.status === 'completed') assert.ok(detail.nodeResults[detail.flow.nodes.at(-1).id]?.result, '末节点结果必须存在');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
