import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import catalog from '../../capabilities/catalog.js';
import { createWorkspace } from '../../src/core/workspace.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const input = {
  quotes: [{ vendor: 'A', unitPrice: 100, quantity: 10 }, { vendor: 'B', unitPrice: 90, quantity: 10 }],
  years: 3, currency: '人民币', taxBasis: '不含税', scope: '同范围软件许可',
};
const request = {
  goal: '比较供应商报价', expertId: 'procurement', skillName: 'procurement-tco',
  input, idempotencyKey: 'regression-submit',
};

async function fresh() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eew-submission-'));
  const ws = await createWorkspace({
    dataDir: dir, assetsDir: path.join(ROOT, 'assets'), catalog,
    model: { available: false, reason: 'offline regression' },
  });
  return { dir, ws };
}

// Hold creation before persistence so both requests necessarily exercise the
// in-flight branch, rather than accidentally testing only the persisted path.
async function concurrentPair(ws, firstRequest, secondRequest) {
  const create = ws.tasks.create;
  const list = ws.tasks.list;
  let releaseCreation, creationStarted, secondRead;
  const gate = new Promise((resolve) => { releaseCreation = resolve; });
  const started = new Promise((resolve) => { creationStarted = resolve; });
  const listed = new Promise((resolve) => { secondRead = resolve; });
  let creates = 0, reads = 0;
  ws.tasks.create = async (...args) => {
    creates += 1;
    creationStarted();
    await gate;
    return create(...args);
  };
  ws.tasks.list = async (...args) => {
    const result = await list(...args);
    if (++reads === 2) secondRead();
    return result;
  };
  let first, second;
  try {
    first = ws.dispatch(firstRequest);
    await started;
    second = ws.dispatch(secondRequest);
    await listed;
    await nextTurn();
    releaseCreation();
    const results = await Promise.all([first, second]);
    return { results, creates };
  } finally {
    releaseCreation();
    await Promise.allSettled([first, second].filter(Boolean));
    ws.tasks.create = create;
    ws.tasks.list = list;
  }
}

test('submission regression: concurrent same key with different inputs conflicts before persistence', { timeout: 15000 }, async () => {
  const { dir, ws } = await fresh();
  try {
    const changed = { ...request, input: { ...input, years: 5 } };
    const { results: [first, second], creates } = await concurrentPair(ws, request, changed);
    assert.equal(second.stage, 'conflict');
    assert.equal(second.conflict.kind, 'idempotency_fingerprint');
    assert.equal(second.task.id, first.task.id);
    assert.equal(creates, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('submission regression: concurrent identical requests still create and execute once', { timeout: 15000 }, async () => {
  const { dir, ws } = await fresh();
  try {
    let executions = 0;
    const run = ws.skills.run;
    ws.skills.run = (...args) => { executions += 1; return run(...args); };
    const { results: [first, second], creates } = await concurrentPair(ws, request, structuredClone(request));
    assert.equal(first.task.id, second.task.id);
    assert.equal(second.duplicateOf, first.task.id);
    assert.equal(creates, 1);
    assert.equal(executions, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('submission regression: same filename with changed inline text must not reuse old results', async () => {
  const { dir, ws } = await fresh();
  try {
    const uploads = [{ name: '报价说明.txt', text: '第一版说明' }];
    const first = await ws.dispatch({ ...request, uploads });
    const second = await ws.dispatch({ ...request, uploads: [{ ...uploads[0], text: '修订后的说明' }] });
    assert.equal(second.stage, 'conflict');
    assert.equal(second.task.id, first.task.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('submission regression: unchanged inline text remains retryable after reopening', async () => {
  const { dir, ws } = await fresh();
  try {
    const withUpload = { ...request, uploads: [{ name: '报价说明.txt', text: '相同的报价说明' }] };
    const first = await ws.dispatch(withUpload);
    const reopened = await createWorkspace({
      dataDir: dir, assetsDir: path.join(ROOT, 'assets'), catalog,
      model: { available: false, reason: 'offline regression' },
    });
    const second = await reopened.dispatch(structuredClone(withUpload));
    assert.equal(second.duplicateOf, first.task.id);
    assert.notEqual(second.stage, 'conflict');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('submission regression: existing 1.5.0 submissions without inline text remain retryable', async () => {
  const { dir, ws } = await fresh();
  try {
    // Fingerprint produced by 1.5.0 for the request fixture above. Do not
    // recompute it with the current implementation: this is an upgrade check.
    const legacy = await ws.tasks.create({
      goal: request.goal, expertId: request.expertId, inputs: input,
      idempotencyKey: request.idempotencyKey,
      fingerprint: 'db887d55b414e4e8c039216ed8aed141eae4807ff160c3cce48b4e99caa42130',
    });
    const retry = await ws.dispatch(structuredClone(request));
    assert.equal(retry.duplicateOf, legacy.id);
    assert.notEqual(retry.stage, 'conflict');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
