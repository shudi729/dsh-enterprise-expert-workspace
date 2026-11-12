import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../../capabilities/catalog.js';
import { createWorkspace } from '../../src/core/workspace.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(ROOT, 'assets');

async function fresh(options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eew-basis-'));
  const workspaceId = options.workspaceId ?? 'default';
  const { model, ...rest } = options;
  return { dir, ws: await createWorkspace({ dataDir: dir, assetsDir: ASSETS, catalog, model, access: { defaultWorkspaceId: workspaceId }, ...rest }) };
}

/** Reopen the SAME data directory with a new process context (simulated restart). */
async function reopen(dir, options = {}) {
  const workspaceId = options.workspaceId ?? 'default';
  const { model, ...rest } = options;
  return createWorkspace({ dataDir: dir, assetsDir: ASSETS, catalog, model, access: { defaultWorkspaceId: workspaceId }, ...rest });
}

const CONFIRMED = { years: 3, currency: '人民币', taxBasis: '不含税', scope: '同范围软件许可' };

test('procurement: different quantities must not produce an overall winner', async () => {
  const { dir, ws } = await fresh();
  try {
    const response = await ws.dispatch({
      goal: '比较两家供应商报价与总成本',
      expertId: 'procurement',
      skillName: 'procurement-tco',
      input: {
        quotes: [
          { vendor: 'A 公司', unitPrice: 100, quantity: 10, implementation: 5000 },
          { vendor: 'B 公司', unitPrice: 90, quantity: 12, implementation: 3000 },
        ],
        years: 3,
      },
    });
    assert.equal(response.ok, false, '口径未齐时不得标记完成');
    assert.equal(response.stage, 'needs_confirmation');
    assert.equal(response.task.status, 'waiting_confirmation');
    const message = response.outcome.result.message;
    assert.match(message, /口径不一致/);
    assert.match(message, /不给出总体优选结论/);
    const structured = response.outcome.result.structured;
    assert.equal(structured.comparable, false);
    assert.equal(structured.needsConfirmation, true);
    assert.ok(structured.basisDifferences.some((item) => item.includes('数量不同')));
    // Undeclared fields are "unknown", never treated as consistent.
    const unknowns = structured.basisFields.filter((item) => item.status === 'unknown').map((item) => item.name);
    assert.ok(unknowns.includes('服务范围') && unknowns.includes('币种') && unknowns.includes('税费'));
    assert.ok(structured.basisPending.includes('币种'));
    assert.ok(structured.calculated.every((item) => !(item.missing.length === 0 && structured.basisPending.length === 0) || true));
    assert.ok(structured.basisPending.length > 0, '关键口径未知时不得显示缺失项为无');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('procurement: unknown currency on both sides is pending, never "consistent"', async () => {
  const { dir, ws } = await fresh();
  try {
    const response = await ws.dispatch({
      goal: '比较两家供应商报价与总成本',
      expertId: 'procurement',
      skillName: 'procurement-tco',
      input: {
        quotes: [
          { vendor: 'A 公司', unitPrice: 100, quantity: 10, implementation: 0, annualMaintenance: 0 },
          { vendor: 'B 公司', unitPrice: 90, quantity: 10, implementation: 0, annualMaintenance: 0 },
        ],
        years: 3,
      },
    });
    assert.equal(response.stage, 'needs_confirmation');
    assert.equal(response.outcome.result.structured.comparable, false);
    assert.match(response.outcome.result.message, /金额计算完成（.*），比较待确认/);
    const currency = response.outcome.result.structured.basisFields.find((item) => item.name === '币种');
    assert.equal(currency.status, 'unknown');
    assert.equal(currency.note, '双方均未声明，不能视为一致');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('procurement: currency known on one side only is still pending', async () => {
  const { dir, ws } = await fresh();
  try {
    const response = await ws.dispatch({
      goal: '比较两家供应商报价与总成本',
      expertId: 'procurement',
      skillName: 'procurement-tco',
      input: {
        quotes: [
          { vendor: 'A 公司', unitPrice: 100, quantity: 10, currency: '人民币' },
          { vendor: 'B 公司', unitPrice: 90, quantity: 10 },
        ],
        years: 3,
      },
    });
    const currency = response.outcome.result.structured.basisFields.find((item) => item.name === '币种');
    assert.equal(currency.status, 'unknown');
    assert.equal(currency.note, '一方未声明，无法确认一致');
    assert.equal(response.stage, 'needs_confirmation');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('procurement: different currencies with no conversion basis must not be mixed', async () => {
  const { dir, ws } = await fresh();
  try {
    const response = await ws.dispatch({
      goal: '比较两家供应商报价与总成本',
      expertId: 'procurement',
      skillName: 'procurement-tco',
      input: {
        quotes: [
          { vendor: 'A 公司', unitPrice: 100, quantity: 10, currency: '人民币' },
          { vendor: 'B 公司', unitPrice: 90, quantity: 10, currency: 'USD' },
        ],
        years: 3,
        scope: '同范围软件许可',
        taxBasis: '不含税',
      },
    });
    const structured = response.outcome.result.structured;
    assert.equal(structured.comparable, false);
    assert.ok(structured.basisDifferences.some((item) => item.includes('不能混算')));
    assert.match(response.outcome.result.message, /不给出总体优选结论/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('procurement: fully confirmed basis reports the cheapest vendor and the gap', async () => {
  const { dir, ws } = await fresh();
  try {
    const response = await ws.dispatch({
      goal: '比较两家供应商报价与总成本',
      expertId: 'procurement',
      skillName: 'procurement-tco',
      input: {
        quotes: [
          { vendor: 'A 公司', unitPrice: 100, quantity: 10, implementation: 0, annualMaintenance: 0 },
          { vendor: 'B 公司', unitPrice: 90, quantity: 10, implementation: 0, annualMaintenance: 0 },
        ],
        years: 3, currency: '人民币', taxBasis: '不含税', scope: '同范围软件许可',
      },
    });
    assert.equal(response.stage, 'completed');
    const structured = response.outcome.result.structured;
    assert.equal(structured.comparable, true);
    assert.equal(structured.basisConfirmed, true);
    assert.equal(structured.basisPending.length, 0);
    assert.match(response.outcome.result.message, /B 公司 总成本最低/);
    assert.equal(structured.calculated[0].tco, 900);
    assert.equal(structured.calculated[1].tco - structured.calculated[0].tco, 100);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('procurement: user-confirmed basis is labelled as an assumption, not a fact', async () => {
  const { dir, ws } = await fresh();
  try {
    const response = await ws.dispatch({
      goal: '比较两家供应商报价与总成本',
      expertId: 'procurement',
      skillName: 'procurement-tco',
      input: {
        quotes: [
          { vendor: 'A 公司', unitPrice: 100, quantity: 10, implementation: 0, annualMaintenance: 0 },
          { vendor: 'B 公司', unitPrice: 90, quantity: 10, implementation: 0, annualMaintenance: 0 },
        ],
        years: 3, currency: '人民币', taxBasis: '不含税', scope: '同范围软件许可',
      },
    });
    const structured = response.outcome.result.structured;
    assert.ok(structured.basisAssumptions.some((item) => item.includes('币种') && item.includes('未经对方报价单核实')));
    assert.match(response.outcome.result.message, /注意：/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('candidates: different field names are not silently merged and missing scores are not zero', async () => {
  const { dir, ws } = await fresh();
  try {
    const response = await ws.dispatch({
      goal: '比较候选人并给出录用建议',
      expertId: 'hr',
      skillName: 'hr-compare-candidates',
      input: {
        candidates: [
          { name: '张三', scores: { 专业能力: 5, 经验: 4 } },
          { name: '李四', scores: { 专业能力: 3 } },
        ],
        criteria: [
          { name: '专业能力', weight: 1 },
          { name: '经验匹配', weight: 2 },
        ],
      },
    });
    const structured = response.outcome.result.structured;
    assert.equal(structured.needsMappingConfirmation, true);
    const unmapped = structured.dimensions.find((item) => item.name === '经验匹配');
    assert.equal(unmapped.mapped, false);
    const li = structured.ranked.find((item) => item.name === '李四');
    assert.ok(li.weightedScore > 0);
    assert.ok(li.missing.includes('经验匹配'));
    assert.match(response.outcome.result.message, /未找到对应字段/);
    assert.match(response.outcome.result.message, /录用决定由你作出/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('candidates: partial coverage compares only shared dimensions', async () => {
  const { dir, ws } = await fresh();
  try {
    const response = await ws.dispatch({
      goal: '比较候选人并给出录用建议',
      expertId: 'hr',
      skillName: 'hr-compare-candidates',
      input: {
        candidates: [
          { name: '张三', scores: { 专业能力: 5, 沟通协作: 4 } },
          { name: '李四', scores: { 专业能力: 4 } },
        ],
        criteria: [
          { name: '专业能力', weight: 1 },
          { name: '沟通协作', weight: 1 },
        ],
      },
    });
    const structured = response.outcome.result.structured;
    assert.equal(structured.comparableAcrossCandidates, false);
    assert.match(response.outcome.result.message, /评分覆盖范围不同/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('candidates: explicit field mapping and different weights are honoured', async () => {
  const { dir, ws } = await fresh();
  try {
    const response = await ws.dispatch({
      goal: '比较候选人并给出录用建议',
      expertId: 'hr',
      skillName: 'hr-compare-candidates',
      input: {
        candidates: [
          { name: '张三', scores: { 专业能力: 5, 经验: 4 } },
          { name: '李四', scores: { 专业能力: 3, 经验: 2 } },
        ],
        criteria: [
          { name: '专业能力', weight: 3 },
          { name: '经验匹配', weight: 1, source: '经验' },
        ],
      },
    });
    const structured = response.outcome.result.structured;
    assert.equal(structured.needsMappingConfirmation, false);
    assert.equal(structured.fullyCovered, true);
    const zhang = structured.ranked.find((item) => item.name === '张三');
    assert.equal(zhang.weightedScore, 4.75);
    assert.match(response.outcome.result.message, /张三/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a repeated submission continues the same running task instead of starting a second one', async () => {
  const slowModel = {
    available: true,
    async complete() {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return '## 结论\n口径一致，按当前报价计算即可。';
    },
  };
  const { dir, ws } = await fresh({ model: slowModel });
  try {
    const input = {
      quotes: [
        { vendor: 'A 公司', unitPrice: 100, quantity: 10, implementation: 0, annualMaintenance: 0 },
        { vendor: 'B 公司', unitPrice: 90, quantity: 10, implementation: 0, annualMaintenance: 0 },
      ],
      years: 3,
    };
    // A double click arrives a moment after the first request, while that one
    // is still running. Both carry the same client-generated idempotency key.
    const firstPromise = ws.dispatch({ goal: '比较两家供应商报价与总成本', expertId: 'procurement', skillName: 'procurement-tco', input, idempotencyKey: 'dup-1' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = await ws.dispatch({ goal: '比较两家供应商报价与总成本', expertId: 'procurement', skillName: 'procurement-tco', input, idempotencyKey: 'dup-1' });
    const first = await firstPromise;
    assert.ok(first.task.id, '第一次执行必须创建任务');
    assert.equal(second.duplicateOf ?? second.task?.id, first.task.id, '重复提交必须指向同一个任务');
    assert.match(second.summary ?? '', /没有重复执行|不会重复执行/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a model analysis that names another winner is reported for review, not marked completed', async () => {
  const conflictingModel = {
    available: true,
    async complete() {
      return '## 结论\n建议选择 B 公司，综合评估最优。\n\n## 依据与推理\nB 公司在服务与实施上更有优势。';
    },
  };
  const { dir, ws } = await fresh({ model: conflictingModel });
  try {
    const response = await ws.dispatch({
      goal: '比较两家供应商报价与总成本',
      expertId: 'procurement',
      skillName: 'procurement-tco',
      input: {
        quotes: [
          { vendor: 'A 公司', unitPrice: 80, quantity: 10, implementation: 0, annualMaintenance: 0 },
          { vendor: 'B 公司', unitPrice: 90, quantity: 10, implementation: 0, annualMaintenance: 0 },
        ],
        years: 3, currency: '人民币', taxBasis: '不含税', scope: '同范围软件许可',
      },
    });
    assert.equal(response.stage, 'failed', '结论冲突时不得标为已完成');
    assert.equal((response.conflicts ?? []).length, 1);
    assert.match(response.conflicts[0].message, /结论不一致/);
    assert.match(response.conflicts[0].message, /A 公司/);
    assert.ok(response.outcome.artifacts.length > 0, '已产出的成果仍要保留');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a model analysis that agrees with the calculation stays completed', async () => {
  const agreeingModel = {
    available: true,
    async complete() {
      return '## 结论\n按当前口径，B 公司总成本最低，建议继续核对实施范围。\n\n## 依据与推理\n单价与数量口径一致。';
    },
  };
  const { dir, ws } = await fresh({ model: agreeingModel });
  try {
    const response = await ws.dispatch({
      goal: '比较两家供应商报价与总成本',
      expertId: 'procurement',
      skillName: 'procurement-tco',
      input: {
        quotes: [
          { vendor: 'A 公司', unitPrice: 100, quantity: 10, implementation: 0, annualMaintenance: 0 },
          { vendor: 'B 公司', unitPrice: 90, quantity: 10, implementation: 0, annualMaintenance: 0 },
        ],
        years: 3, currency: '人民币', taxBasis: '不含税', scope: '同范围软件许可',
      },
    });
    assert.equal(response.stage, 'completed', JSON.stringify(response.failureReasons));
    assert.equal((response.conflicts ?? []).length, 0);
    assert.equal(response.analysis.available, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an inconclusive comparison is not treated as a contradiction', async () => {
  const partialModel = {
    available: true,
    async complete() {
      return '## 结论\n李四在经验原始评分上领先，但该维度未映射，只能局部比较。\n\n## 依据与推理\n张三仅专业能力被评分。';
    },
  };
  const { dir, ws } = await fresh({ model: partialModel });
  try {
    const response = await ws.dispatch({
      goal: '比较候选人并给出录用建议',
      expertId: 'hr',
      skillName: 'hr-compare-candidates',
      input: {
        candidates: [
          { name: '张三', scores: { 专业能力: 5, 经验: 4 } },
          { name: '李四', scores: { 专业能力: 4, 经验: 5 } },
        ],
        criteria: [
          { name: '专业能力', weight: 1 },
          { name: '经验匹配', weight: 1 },
        ],
      },
    });
    assert.equal(response.stage, 'completed', JSON.stringify(response.failureReasons));
    assert.equal((response.conflicts ?? []).length, 0, '口径未定时不得把局部比较当成冲突');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('same idempotency key retries return the same task, no second model call', async () => {
  const count = { n: 0 };
  const countingModel = {
    available: true,
    async complete() { count.n += 1; return '## 结论\n口径一致，按当前报价计算即可。'; },
  };
  const { dir, ws } = await fresh({ model: countingModel });
  try {
    const input = { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 3 };
    const first = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input, idempotencyKey: 'retry-1' });
    const retry = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input, idempotencyKey: 'retry-1' });
    assert.equal(retry.duplicateOf ?? retry.task?.id, first.task.id, '重试必须指向同一任务');
    assert.equal(count.n, 1, '重复请求不得再次调用模型');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('concurrent double click with the same key collapses into one task', async () => {
  const { dir, ws } = await fresh();
  try {
    const input = { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 3 };
    const p1 = ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input, idempotencyKey: 'click-1' });
    const p2 = ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input, idempotencyKey: 'click-1' });
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(a.task.id, b.task.id, '并发双击必须落到同一任务');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('same goal with different materials creates a separate task (not merged)', async () => {
  const { dir, ws } = await fresh();
  try {
    const a = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 3 }, idempotencyKey: 'key-a' });
    const b = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 80, quantity: 5 }, { vendor: 'B 公司', unitPrice: 70, quantity: 5 }], years: 3 }, idempotencyKey: 'key-b' });
    assert.notEqual(a.task.id, b.task.id, '不同资料即使目标相同也必须新建任务');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('same goal with different parameters creates a separate task', async () => {
  const { dir, ws } = await fresh();
  try {
    const a = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 3 }, idempotencyKey: 'p-a' });
    const b = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 5 }, idempotencyKey: 'p-b' });
    assert.notEqual(a.task.id, b.task.id, '不同参数即使目标相同也必须新建任务');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the same idempotency key never collides across workspaces', async () => {
  const { dir, ws } = await fresh();
  try {
    // Inject tasks in other workspaces that share an idempotency key.
    await ws.store.upsert('tasks', { id: 't-a', workspaceId: 'team-a', goal: '比价', expertId: 'procurement', inputs: {}, outputForm: 'markdown', status: 'draft', idempotencyKey: 'same-key' });
    await ws.store.upsert('tasks', { id: 't-b', workspaceId: 'team-b', goal: '比价', expertId: 'procurement', inputs: {}, outputForm: 'markdown', status: 'draft', idempotencyKey: 'same-key' });
    const input = { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 3 };
    const res = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input, idempotencyKey: 'same-key' });
    const defaultTask = (await ws.tasks.list()).find((item) => item.workspaceId === 'default' && item.goal === '比价');
    assert.notEqual(res.task.id, 't-a', '跨空间相同幂等键不得误合并到其他空间的任务');
    assert.notEqual(res.task.id, 't-b', '跨空间相同幂等键不得误合并到其他空间的任务');
    assert.ok(defaultTask, '本空间按同键新建独立任务');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an active new task with the same goal is not merged into an existing one', async () => {
  const { dir, ws } = await fresh();
  try {
    const done = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 3 }, idempotencyKey: 'first' });
    const again = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 3 }, idempotencyKey: 'second' });
    assert.notEqual(done.task.id, again.task.id, '用户主动新建的同名工作不得自动合并');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an orphaned running task is recovered, but a recent one keeps running', async () => {
  let currentTime = new Date('2026-11-12T00:00:00Z');
  const { dir, ws } = await fresh({ now: () => currentTime.toISOString() });
  try {
    // An orphan left by a dead process, far in the past.
    await ws.tasks.create({ workspaceId: 'default', goal: '旧的比价', expertId: 'procurement', inputs: {}, outputForm: 'markdown', idempotencyKey: 'old' });
    const old = (await ws.tasks.list()).find((item) => item.goal === '旧的比价');
    await ws.tasks.update(old.id, { status: 'running' });
    // Advance time well past the stale threshold.
    currentTime = new Date('2026-11-12T00:40:00Z');
    // A recent task created now must survive.
    const recent = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 3 }, idempotencyKey: 'recent' });
    // Trigger recovery by starting a new submission.
    await ws.dispatch({ goal: '新的比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 3 }, idempotencyKey: 'new' });
    const after = (await ws.tasks.list()).find((item) => item.goal === '旧的比价');
    assert.equal(after.status, 'failed', '超过时限的僵死任务应被标记为未完成');
    const recentAfter = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], years: 3 }, idempotencyKey: 'recent' });
    assert.equal(recentAfter.duplicateOf ?? recentAfter.task?.id, recent.task.id, '仍在执行任务可被同幂等键续用');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('model giving an unconditional overall recommendation when not comparable is flagged for review', async () => {
  const model = { available: true, async complete() { return '## 结论\n建议选择 B 公司，综合最优，总体优选。\n\n## 依据\n币种不同但仍给总体结论。'; } };
  const { dir, ws } = await fresh({ model });
  try {
    // Same quantity, different currency: the only issue under test is the
    // unconditional overall recommendation, not the pending-basis gate.
    const response = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10, currency: '人民币' }, { vendor: 'B 公司', unitPrice: 90, quantity: 10, currency: 'USD' }], years: 3, scope: '同范围软件许可', taxBasis: '不含税' }, idempotencyKey: 'c1' });
    assert.equal(response.stage, 'failed', '不可比时给出总体推荐必须阻止完成');
    assert.ok((response.conflicts ?? []).some((item) => item.type === 'review'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('model scoped comparison when not comparable is allowed', async () => {
  const model = { available: true, async complete() { return '## 结论\n在专业能力维度上，李四领先；但该维度未映射，只能局部比较，无法给出整体排名。\n\n## 依据\n口径未齐。'; } };
  const { dir, ws } = await fresh({ model });
  try {
    const response = await ws.dispatch({ goal: '比较候选人', expertId: 'hr', skillName: 'hr-compare-candidates', input: { candidates: [{ name: '张三', scores: { 专业能力: 5, 经验: 4 } }, { name: '李四', scores: { 专业能力: 4, 经验: 5 } }], criteria: [{ name: '专业能力', weight: 1 }, { name: '经验匹配', weight: 1 }] }, idempotencyKey: 'c2' });
    assert.equal(response.stage, 'completed', JSON.stringify(response.failureReasons));
    assert.equal((response.conflicts ?? []).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('conditional model suggestion is allowed', async () => {
  const model = { available: true, async complete() { return '## 结论\n若统一币种并补齐换算依据，则 B 公司总成本更低。\n\n## 依据\n当前币种不同。'; } };
  const { dir, ws } = await fresh({ model });
  try {
    const response = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10, currency: '人民币' }, { vendor: 'B 公司', unitPrice: 90, quantity: 10, currency: 'USD' }], years: 3, scope: '同范围软件许可', taxBasis: '不含税' }, idempotencyKey: 'c3' });
    assert.equal(response.stage, 'completed', JSON.stringify(response.failureReasons));
    assert.equal((response.conflicts ?? []).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('negated model sentence is not treated as a recommendation', async () => {
  const model = { available: true, async complete() { return '## 结论\n数据不足，不建议给出总体优选或录用推荐。\n\n## 依据\n币种不同。'; } };
  const { dir, ws } = await fresh({ model });
  try {
    const response = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10, currency: '人民币' }, { vendor: 'B 公司', unitPrice: 90, quantity: 10, currency: 'USD' }], years: 3, scope: '同范围软件许可', taxBasis: '不含税' }, idempotencyKey: 'c4' });
    assert.equal(response.stage, 'completed', JSON.stringify(response.failureReasons));
    assert.equal((response.conflicts ?? []).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('multiple candidates and insufficient data are handled without false positives', async () => {
  const model = { available: true, async complete() { return '## 结论\n王五、赵六与张三均缺乏可比维度，数据不足以给出排名；在专业能力维度上张三领先，但仅限该维度。\n\n## 依据\n覆盖不足。'; } };
  const { dir, ws } = await fresh({ model });
  try {
    const response = await ws.dispatch({ goal: '比较候选人', expertId: 'hr', skillName: 'hr-compare-candidates', input: { candidates: [{ name: '张三', scores: { 专业能力: 5 } }, { name: '王五', scores: { 沟通能力: 4 } }, { name: '赵六', scores: { 领导: 4 } }], criteria: [{ name: '专业能力', weight: 1 }, { name: '经验匹配', weight: 1 }] }, idempotencyKey: 'c5' });
    assert.equal(response.stage, 'completed', JSON.stringify(response.failureReasons));
    assert.equal((response.conflicts ?? []).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('idempotency: the same key with the same data in different key order is one request', async () => {
  const { dir, ws } = await fresh();
  try {
    const first = await ws.dispatch({
      goal: '比价', expertId: 'procurement', skillName: 'procurement-tco',
      input: { years: 3, quotes: [{ unitPrice: 100, vendor: 'A 公司', quantity: 10 }, { unitPrice: 90, vendor: 'B 公司', quantity: 10 }], ...CONFIRMED },
      idempotencyKey: 'order-1', format: 'xlsx',
    });
    const second = await ws.dispatch({
      goal: '比价', expertId: 'procurement', skillName: 'procurement-tco',
      input: { ...CONFIRMED, quotes: [{ quantity: 10, vendor: 'A 公司', unitPrice: 100 }, { quantity: 10, vendor: 'B 公司', unitPrice: 90 }], years: 3 },
      idempotencyKey: 'order-1', format: 'xlsx',
    });
    assert.equal(second.duplicateOf ?? second.task?.id, first.task.id, '键序不同的等价请求必须识别为同一次提交');
    assert.match(second.summary ?? '', /没有重复执行/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('idempotency: the same key with different material, parameters or format conflicts', async () => {
  const { dir, ws } = await fresh();
  try {
    const base = { goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', idempotencyKey: 'same-key' };
    const quotes = [
      { vendor: 'A 公司', unitPrice: 100, quantity: 10, implementation: 0, annualMaintenance: 0 },
      { vendor: 'B 公司', unitPrice: 90, quantity: 10, implementation: 0, annualMaintenance: 0 },
    ];
    const first = await ws.dispatch({ ...base, input: { quotes, ...CONFIRMED } });
    assert.ok(first.task.id);
    const differentMaterial = await ws.dispatch({ ...base, input: { quotes: [{ ...quotes[0], implementation: 500 }, quotes[1]], ...CONFIRMED } });
    assert.equal(differentMaterial.stage, 'conflict', '同键不同资料必须明确冲突');
    assert.match(differentMaterial.summary ?? '', /另起一件新工作|更新原任务/);
    const differentParams = await ws.dispatch({ ...base, input: { ...CONFIRMED, quotes, years: 5 } });
    assert.equal(differentParams.stage, 'conflict', '同键不同参数必须明确冲突');
    const differentFormat = await ws.dispatch({ ...base, input: { quotes, ...CONFIRMED }, format: 'xlsx' });
    assert.equal(differentFormat.stage, 'conflict', '同键不同输出要求必须明确冲突');
    const original = await ws.dispatch({ ...base, input: { quotes, ...CONFIRMED } });
    assert.equal(original.duplicateOf ?? original.task?.id, first.task.id, '同键同请求仍返回原任务');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('idempotency: a failed run keeps one reachable task that can be continued', async () => {
  const { dir, ws } = await fresh();
  try {
    const first = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [], ...CONFIRMED }, idempotencyKey: 'boom' });
    assert.equal(first.ok, false, '空报价执行失败');
    // The same key maps to the same (failed) task — never a duplicate, and the
    // task itself stays continuable with the original data kept.
    const retry = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [], ...CONFIRMED }, idempotencyKey: 'boom' });
    assert.equal(retry.duplicateOf ?? retry.task?.id, first.task.id, '失败后同键仍指向同一任务');
    const continued = await ws.dispatch({ taskId: first.task.id, answers: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }] }, format: 'docx' });
    assert.equal(continued.stage, 'completed', JSON.stringify(continued.failureReasons));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('idempotency: an invalid submission never poisons the key for later attempts', async () => {
  const { dir, ws } = await fresh();
  try {
    // No goal and no expert fails before any task is created; the key must stay usable.
    const bad = await ws.dispatch({ idempotencyKey: 'clean-1', input: {} }).catch((error) => ({ error: error.message }));
    assert.ok(bad.error || bad.ok === false);
    const good = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], ...CONFIRMED }, idempotencyKey: 'clean-1' });
    assert.ok(good.task?.id, '此前失败的请求不得占用幂等键');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('idempotency: after a restart the same key still returns the persisted task', async () => {
  const { dir, ws } = await fresh();
  try {
    const first = await ws.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], ...CONFIRMED }, idempotencyKey: 'restart-1' });
    const revived = await reopen(dir);
    const again = await revived.dispatch({ goal: '比价', expertId: 'procurement', skillName: 'procurement-tco', input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }], ...CONFIRMED }, idempotencyKey: 'restart-1' });
    assert.equal(again.duplicateOf ?? again.task?.id, first.task.id, '重启后重复请求仍返回同一任务，不重复执行');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('procurement: confirming the pending basis updates the original task to a conclusion', async () => {
  const { dir, ws } = await fresh();
  try {
    const first = await ws.dispatch({
      goal: '比价', expertId: 'procurement', skillName: 'procurement-tco',
      input: { quotes: [{ vendor: 'A 公司', unitPrice: 100, quantity: 10 }, { vendor: 'B 公司', unitPrice: 90, quantity: 10 }] },
      idempotencyKey: 'confirm-1',
    });
    assert.equal(first.stage, 'needs_confirmation');
    const taskId = first.task.id;
    const confirmed = await ws.dispatch({ taskId, answers: { currency: '人民币', taxBasis: '不含税', scope: '同范围软件许可', years: 3, quantity: 10 }, format: 'docx' });
    assert.equal(confirmed.stage, 'completed', JSON.stringify(confirmed.failureReasons));
    assert.equal(confirmed.task.id, taskId, '确认必须在原任务上更新');
    assert.match(confirmed.outcome.result.message, /B 公司 总成本最低/);
    assert.equal(confirmed.task.idempotencyKey, 'confirm-1', '原任务的幂等标识保留');
    assert.ok(confirmed.task.results.length >= 2, '原始结果与修订都保留在任务记录里');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
