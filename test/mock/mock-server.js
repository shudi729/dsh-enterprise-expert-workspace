import http from 'node:http';

/**
 * Deterministic stand-in for an external connector, used only for repeatable
 * unit/e2e tests. It is explicitly NOT evidence of a real integration: real
 * integration is covered by test/integration/dsh.test.js (actual DSH app-boot
 * API) and scripts/verify-bundle.js (actual 0.2.1-rc.5 CLI --dump-config).
 */
export async function startMockServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, method: req.method, at: new Date().toISOString() });
    if (req.url.startsWith('/ok')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok', tools: ['mock_search'] }));
      return;
    }
    if (req.url.startsWith('/missing-credentials')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing_credentials' }));
      return;
    }
    if (req.url.startsWith('/unavailable')) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unavailable' }));
      return;
    }
    if (req.url.startsWith('/disconnect')) {
      req.socket.destroy();
      return;
    }
    if (req.url.startsWith('/timeout')) {
      // Deliberately never responds; the client owns the timeout.
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Probe a connector URL and classify the outcome without claiming success. */
export async function probe(url, { timeoutMs = 250 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 401) return { state: 'missing_credentials', status: response.status };
    if (response.status === 503) return { state: 'unavailable', status: response.status };
    if (!response.ok) return { state: 'unavailable', status: response.status };
    return { state: 'ok', status: response.status, body: await response.json() };
  } catch (error) {
    if (error?.name === 'AbortError') return { state: 'timeout', message: '连接超时' };
    return { state: 'disconnected', message: error?.message ?? String(error) };
  } finally {
    clearTimeout(timer);
  }
}
