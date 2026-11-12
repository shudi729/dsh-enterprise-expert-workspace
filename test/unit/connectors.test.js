import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../../capabilities/catalog.js';
import { createWorkspace } from '../../src/core/workspace.js';
import { startMockServer, probe } from '../mock/mock-server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(ROOT, 'assets');

test('mock external service: configured/loaded/toolAvailable/verification stay distinct', async () => {
  const mock = await startMockServer();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eew-conn-'));
  try {
    const ok = await probe(`${mock.url}/ok`);
    assert.equal(ok.state, 'ok');
    assert.equal((await probe(`${mock.url}/missing-credentials`)).state, 'missing_credentials');
    assert.equal((await probe(`${mock.url}/unavailable`)).state, 'unavailable');
    assert.equal((await probe(`${mock.url}/timeout`, { timeoutMs: 120 })).state, 'timeout');
    const disconnected = await probe(`${mock.url}/disconnect`);
    assert.equal(disconnected.state, 'disconnected');
    assert.ok(disconnected.message);

    // A configured-but-not-loaded connector must never be reported as connected.
    const ctx = {
      get(name) {
        if (name === 'loader') return { entries: async () => [{ id: 'mcp-demo', name: '@deepseek-ai/dsh-mcp-client', disabled: true, config: { transport: 'http' } }] };
        if (name === 'tools') return { list: async () => ['mcp__demo__search'] };
        return undefined;
      },
    };
    const ws = await createWorkspace({ dataDir: dir, assetsDir: ASSETS, catalog, contextProvider: () => ctx });
    const list = await ws.connectors.listConnectors();
    assert.equal(list.configured.length, 1);
    assert.equal(list.configured[0].loaded, false);
    assert.equal(list.configured[0].toolAvailable, false, '禁用行不得宣称工具可用');
    assert.equal(list.configured[0].verification, 'not_checked');
    const diagnosis = await ws.connectors.diagnose('mcp-demo');
    assert.equal(diagnosis.status, 'unavailable');
    assert.equal(diagnosis.reason, '已禁用');

    const config = ws.connectors.validateConfig({ name: 'demo', transport: 'http', url: `${mock.url}/ok` });
    assert.equal(config.ok, true);
    assert.equal(config.publicFields.token, undefined);
    assert.ok(config.note.includes('不代表'));
    const bad = ws.connectors.validateConfig({ name: 'demo', transport: 'http', url: `${mock.url}/ok`, appSecret: 'x' });
    assert.equal(bad.ok, false);

    await ws.connectors.recordVerification('mcp-demo', 'missing_credentials', '缺少凭据，未连接');
    const recorded = await ws.connectors.diagnose('mcp-demo');
    assert.equal(recorded.status, 'unavailable');
    assert.ok(mock.requests.length >= 4);
  } finally {
    await mock.close();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
