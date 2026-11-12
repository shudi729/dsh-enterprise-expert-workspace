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

async function fresh(options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eew-accept-'));
  return { dir, ws: await createWorkspace({ dataDir: dir, assetsDir: ASSETS, catalog, ...options }) };
}

test('only a natural-language goal plus necessary material executes a capability and delivers a real result', async () => {
  const { dir, ws } = await fresh();
  try {
    const response = await ws.dispatch({
      goal: '复盘客户 A 项目并沉淀经验',
      input: { project: '客户 A 项目' },
      uploads: [{ name: '项目资料.txt', text: '背景：首次交付；决策：分阶段验证；结果：按期交付并验收。' }],
      format: 'docx',
    });
    assert.equal(response.ok, true, JSON.stringify(response.failureReasons));
    assert.equal(response.stage, 'completed');
    assert.ok(response.capability?.id, '必须说明自动选择的能力');
    assert.ok(response.skill?.name);
    assert.ok(response.outcome.result.content.tables.length > 0, '成果内容必须含真实表格，不是空表');
    assert.ok(response.outcome.artifacts.length > 0);
    const artifact = response.outcome.artifacts[0];
    assert.equal((await stat(artifact.path)).size, artifact.bytes);
    const reopened = await readDocument(artifact.path);
    assert.ok(reopened.text.includes('客户 A 项目'), '文件内容必须与任务结果一致');

    const uploaded = await ws.knowledge.search({ query: '分阶段验证' });
    assert.ok(uploaded.hits.length > 0, '上传资料必须真实入库并可检索');
    const section = await ws.knowledge.readSection({ docId: uploaded.hits[0].citation.docId, section: uploaded.hits[0].citation.section });
    assert.ok(section.text.includes('分阶段验证'));

    const full = await ws.readResult({ taskId: response.task.id });
    assert.ok(full.chunk.includes('复盘'), '完整结果正文可通过续读获取，未被截断丢弃');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('five stages are distinct; quality failure and dependency failure never mark a task completed', async () => {
  const { dir, ws } = await fresh();
  try {
    const unclear = await ws.dispatch({ goal: '随便做点什么', input: {} });
    assert.equal(unclear.stage, 'planned');
    assert.equal(unclear.ok, false);
    assert.equal(unclear.task, null);

    const waiting = await ws.dispatch({ goal: '生成商机卡', expertId: 'key-account-sales', input: {}, format: 'md' });
    assert.equal(waiting.stage, 'waiting_input', JSON.stringify(waiting.failureReasons));
    assert.equal(waiting.task.status, 'waiting_input');
    assert.ok(waiting.questions.includes('客户名称'));

    const continued = await ws.dispatch({ taskId: waiting.task.id, answers: { customer: '客户 A', stage: '方案评估' }, format: 'md' });
    assert.equal(continued.stage, 'completed');
    assert.equal(continued.task.id, waiting.task.id, '补充信息后必须在原任务继续');

    const failed = await ws.dispatch({
      goal: '读取文件并提取内容', expertId: 'document-office', skillName: 'document-extract',
      input: { path: path.join(dir, 'missing.docx') },
    });
    assert.equal(failed.stage, 'failed');
    assert.equal(failed.task.status, 'failed');
    assert.ok(failed.failureReasons.length > 0);

    // A failing quality gate must prevent completion even when the skill itself succeeded.
    const originalReview = ws.experts.review;
    ws.experts.review = async () => ({ passed: false, verdict: '引用不可回溯', checks: [{ id: 'citations_resolvable', passed: false, label: '引用', detail: '失败' }] });
    const qualityFailed = await ws.dispatch({
      goal: '复盘客户 A 项目', expertId: 'knowledge-management', skillName: 'km-review',
      input: { project: '客户 A', material: '背景与结果资料' }, format: 'md',
    });
    ws.experts.review = originalReview;
    assert.equal(qualityFailed.stage, 'failed');
    assert.equal(qualityFailed.task.status, 'failed');
    assert.ok(qualityFailed.failureReasons.some((reason) => reason.includes('质量检查')));
    assert.equal(qualityFailed.ok, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cross-domain workflows reach the final aggregate artifact, not just a waiting state', async () => {
  const { dir, ws } = await fresh();
  try {
    await ws.knowledge.importText({ title: '复盘与决策链方法', text: '# 商机评估\n\n先确认决策链与采购流程。\n\n# 复盘方法\n\n按背景、决策、结果、经验四栏整理。\n', trust: 'verified' });
    const chains = [
      {
        id: 'cross-hr-onboarding',
        input: {
          role: '客户经理', responsibilities: ['客户开拓'], requirements: '3 年经验',
          candidates: [{ name: '甲', scores: { 专业能力: 5 } }], criteria: [{ name: '专业能力', weight: 1 }],
          goal: '入职首月目标', tasks: [{ name: '熟悉客户资料' }], query: '决策链', format: 'md',
        },
      },
      {
        id: 'cross-research-sales',
        input: {
          question: '行业机会', sources: [{ name: '行业报告', url: 'https://example.com/report' }],
          claims: [{ statement: '增速 12%', source: '行业报告', evidence: '第 3 页' }],
          customer: '客户 A', material: '客户资料与会议纪要', query: '决策链', format: 'md',
        },
      },
      {
        id: 'cross-management-improve',
        input: {
          rows: [['区域', '收入'], ['华东', 100], ['华南', 200]], columns: ['区域', '收入'], field: '收入',
          metrics: [{ name: '收入', target: 400, actual: 300 }],
          problems: [{ name: '收入偏差', action: '复查' }], actions: [{ name: '复查', owner: '张三' }],
          goal: '改进收入偏差', tasks: [{ name: '复查华东' }],
          project: '经营改进', material: '复盘材料：数据结果与诊断结论', query: '复盘', format: 'md',
        },
      },
    ];
    for (const chain of chains) {
      const run = await ws.workflows.start({ flowId: chain.id, input: chain.input, workspaceId: 'default' });
      assert.equal(run.status, 'completed', `${chain.id} 停在 ${run.status}：${JSON.stringify(run.error)}`);
      const detail = await ws.workflows.get(run.id);
      const last = detail.flow.nodes.at(-1).id;
      assert.equal(detail.nodeResults[last]?.status, 'completed', `${chain.id} 末节点未完成`);
      assert.ok(run.finalArtifacts?.length > 0, `${chain.id} 未交付最终成果`);
      const artifact = run.finalArtifacts[0];
      assert.equal((await stat(artifact.path)).size, artifact.bytes);
      const reopened = await readDocument(artifact.path);
      assert.ok(reopened.text.includes('节点明细') || reopened.text.includes('流程成果'), `${chain.id} 成果内容为空`);
      assert.ok(Object.keys(detail.nodeResults).length >= 4);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('model analysis is real when a model is attached and never impersonated when it is not', async () => {
  const { dir, ws } = await fresh();
  try {
    const plain = await ws.dispatch({
      goal: '复盘客户 A 项目', expertId: 'knowledge-management', skillName: 'km-review',
      input: { project: '客户 A', material: '背景、决策与结果资料' }, format: 'md',
    });
    assert.equal(plain.stage, 'completed', '没有模型时确定性能力仍应完成真实工作');
    assert.equal(plain.analysis.available, false);
    assert.ok(plain.summary.includes('未生成模型分析正文'), '不得把模板整理冒充模型分析');
    assert.equal(plain.outcome.result.analysis, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }

  // Explicitly labelled TEST model: verifies the analysis integration path;
  // a real provider call requires credentials and is listed as a blocker.
  const testModel = {
    available: true,
    async complete({ prompt }) {
      assert.ok(prompt.includes('业务目标'));
      return '## 结论\n客户 A 项目按期交付，分阶段验证降低了交付风险。\n\n## 依据与推理\n依据已确认事实与可回溯引用。\n\n## 适用条件与风险\n仅适用于本次提供的资料范围。\n\n## 建议动作\n补充客户验收证据后入库。\n\n## 仍需确认\n客户长期效果数据未提供。';
    },
  };
  const second = await fresh({ model: testModel });
  try {
    const withModel = await second.ws.dispatch({
      goal: '复盘客户 A 项目', expertId: 'knowledge-management', skillName: 'km-review',
      input: { project: '客户 A', material: '背景、决策与结果资料' }, format: 'md',
    });
    assert.equal(withModel.stage, 'completed', JSON.stringify(withModel.failureReasons));
    assert.equal(withModel.analysis.available, true);
    assert.ok(withModel.analysis.length > 100);
    assert.ok(withModel.outcome.result.analysis.includes('结论'));
    assert.equal(withModel.outcome.result.analysisSource, 'dsh-llm');
    assert.ok(withModel.outcome.artifacts.length >= 2, '分析正文必须另有真实成果文件');
    const analysisArtifact = withModel.outcome.artifacts.at(-1);
    const text = await readFile(analysisArtifact.path, 'utf8');
    assert.ok(text.includes('结论') && text.includes('仍需确认'), '分析成果文件必须包含真实分析正文');
    const full = await second.ws.readResult({ taskId: withModel.task.id });
    assert.ok(full.chunk.includes('分阶段验证') || full.chunk.includes('仍需确认'), '分析正文必须可续读，不被截断丢弃');
  } finally { await rm(second.dir, { recursive: true, force: true }); }
});
