import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { assertOwner, currentActor, ownerFilter, withActor } from '../core/access.js';
import { CODES, describeError, fail } from '../core/errors.js';

const MAX_BODY = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_FILES = 5;
const MIME = {
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('request body too large'), { code: 'TOO_LARGE' })); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('invalid JSON body'), { code: 'INVALID_JSON' })); }
    });
    req.on('error', reject);
  });
}

/** RFC 5987 filename* plus a conservative ASCII fallback. */
export function contentDisposition(filename) {
  const original = String(filename ?? 'artifact.bin');
  const ascii = original
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\;]/g, '_')
    .replace(/[\r\n\t]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'artifact.bin';
  const utf8 = encodeURIComponent(original).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

function errorStatus(error) {
  switch (error.code) {
    case CODES.NOT_FOUND: return 404;
    case CODES.PERMISSION_DENIED: return 403;
    case CODES.MISSING_INPUT:
    case CODES.INVALID_INPUT:
    case CODES.DUPLICATE:
    case CODES.UNSUPPORTED_FORMAT: return 400;
    case CODES.CONFLICT:
    case CODES.LOCKED:
    case CODES.VERIFICATION_FAILED: return 409;
    case CODES.DEPENDENCY_UNAVAILABLE:
    case CODES.CONNECTOR_UNAVAILABLE: return 503;
    case CODES.EXTERNAL_SIDE_EFFECT_UNCONFIRMED: return 428;
    default: return 500;
  }
}

export function registerRoutes({ ctx, getWorkspace, prefix = '/eew' }) {
  function rejectBy(req) {
    const connection = ctx.get('connection');
    if (connection && typeof connection.requestRejection === 'function') {
      try {
        const rejection = connection.requestRejection(req);
        if (rejection !== undefined && rejection !== null) return typeof rejection === 'number' ? rejection : 403;
      } catch { return 403; }
    }
    const origin = req.headers.origin;
    if (typeof origin === 'string') {
      try { return new URL(origin).host === req.headers.host ? null : 403; } catch { return 403; }
    }
    return null;
  }

  /** Only Host-derived facts determine the actor; body.query/body.grants are suggestions. */
  async function actorFor(req, body, query) {
    const ws = await getWorkspace();
    const connection = ctx.get('connection');
    const session = ctx.get('session');
    const sessionWorkspaceId = session?.workspaceId ?? connection?.workspaceId ?? null;
    return ws.accessPolicy.resolveActor({
      requestedWorkspaceId: query.get('workspaceId') ?? body.workspaceId ?? null,
      requestedGrants: body.grants ?? query.getAll('grants'),
      sessionWorkspaceId,
      isAdmin: false,
      source: 'http',
    });
  }

  function permission(name) {
    const actor = currentActor();
    if (!actor.grants.includes(name) && !['knowledge.import', 'knowledge.verify', 'files.write', 'skills.write', 'state.export'].includes(name)) {
      fail(CODES.PERMISSION_DENIED, `缺少 Host 侧授予的权限 ${name}`, { permission: name });
    }
  }

  async function handle(req, subpath, query, body) {
    const ws = await getWorkspace();
    const method = req.method ?? 'GET';
    const key = `${method} ${subpath}`;
    const actor = currentActor();
    const workspaceId = actor.workspaceId;
    const uploads = Array.isArray(body.uploads) ? body.uploads : [];

    const routes = {
      'GET /state': async () => ({ state: await ws.state(), actor: { workspaceId: actor.workspaceId, source: actor.source } }),
      'GET /experts': async () => ({ experts: ws.experts.list() }),
      'GET /route': async () => ws.experts.route({ goal: String(query.get('goal') ?? ''), expertId: query.get('expertId') ?? undefined, workspaceId, outputPreference: query.get('outputForm') ?? undefined }),
      'GET /skills': async () => ({ skills: await ws.skills.list({ query: query.get('query') ?? undefined, scope: query.get('scope') ?? undefined, status: query.get('status') ?? undefined }) }),
      'GET /skill': async () => ws.skills.detail(String(query.get('name') ?? '')),
      'GET /skill/export': async () => ws.skills.exportSkill(String(query.get('name') ?? '')),
      'POST /skills/validate': async () => { permission('skills.write'); return ws.skills.validate(body.markdown ?? ''); },
      'POST /skills/import': async () => { permission('skills.write'); return ws.skills.importPackage(body); },
      'PUT /skill': async () => { permission('skills.write'); return ws.skills.updateUser(String(query.get('name') ?? ''), body); },
      'DELETE /skill': async () => { permission('skills.write'); return ws.skills.deleteUser(String(query.get('name') ?? '')); },
      'POST /skill/run': async () => {
        const context = ws.makeContext({ taskId: body.taskId ?? null, workspaceId });
        return ws.skills.run(String(body.name ?? ''), { ...(body.input ?? {}), workspaceId }, context);
      },
      'GET /knowledge': async () => ({ docs: await ws.knowledge.list({ domain: query.get('domain') ?? undefined, includeArchived: query.get('includeArchived') === 'true' }) }),
      'GET /knowledge/search': async () => ws.knowledge.search({ query: String(query.get('query') ?? ''), domain: query.get('domain') ?? undefined, limit: Number(query.get('limit') ?? 8) }),
      'GET /knowledge/section': async () => ws.knowledge.readSection({ docId: String(query.get('docId') ?? ''), section: query.get('section') ?? undefined, part: Number(query.get('part') ?? 1) }),
      'GET /knowledge/export': async () => ws.knowledge.exportDocument(String(query.get('docId') ?? '')),
      'POST /knowledge/import': async () => {
        permission('knowledge.import');
        if (body.uploadId) {
          const record = await ws.store.find('uploads', String(body.uploadId));
          if (!record?.path) fail(CODES.NOT_FOUND, '上传文件已不存在，请重新上传', { uploadId: body.uploadId });
          return ws.knowledge.importFile({ filePath: record.path, title: body.title ?? record.name, domain: body.domain, tags: body.tags });
        }
        if (body.path) return ws.knowledge.importFile({ filePath: String(body.path), title: body.title, domain: body.domain, tags: body.tags });
        return ws.knowledge.importText({ title: body.title, text: body.text, domain: body.domain, tags: body.tags, trust: 'unverified', source: body.source });
      },
      'POST /knowledge/verify': async () => { permission('knowledge.verify'); return ws.knowledge.verify({ docId: body.docId, trust: 'verified', note: body.note }); },
      'DELETE /knowledge': async () => { permission('knowledge.verify'); return ws.knowledge.remove(String(query.get('docId') ?? '')); },
      'GET /tasks': async () => ({ tasks: await ws.tasks.list({ expertId: query.get('expertId') ?? undefined, status: query.get('status') ?? undefined, includeArchived: query.get('includeArchived') === 'true' }) }),
      'GET /task': async () => ws.tasks.load(String(query.get('id') ?? ''), 'read'),
      'POST /task': async () => ws.tasks.create({ ...body, workspaceId }),
      'PUT /task': async () => ws.tasks.update(String(query.get('id') ?? ''), body.patch ?? body, body.expectedRevision),
      'POST /task/business': async () => ws.tasks.setBusiness(String(body.taskId ?? ''), String(body.type ?? ''), body.fields ?? {}, body.expectedRevision),
      'POST /task/handoff': async () => ws.experts.handoff({ ...body, workspaceId }),
      'GET /task/export': async () => ws.tasks.exportTask(String(query.get('id') ?? '')),
      'POST /dispatch': async () => ws.dispatch({ ...body, uploads, workspaceId, idempotencyKey: body.idempotencyKey ?? null }),
      'POST /answer': async () => ws.dispatch({ taskId: String(body.taskId ?? ''), answers: body.answers ?? body.input ?? {}, format: body.format, uploads, idempotencyKey: body.idempotencyKey ?? null }),
      'GET /result': async () => ws.readResult({ taskId: String(query.get('id') ?? ''), index: query.has('index') ? Number(query.get('index')) : -1, offset: Number(query.get('offset') ?? 0), limit: Number(query.get('limit') ?? 4000) }),
      'GET /workflows': async () => ({
        flows: ws.workflows.listFlows(),
        runs: ownerFilter(await ws.store.all('workflow_runs')).map((run) => ({
          id: run.id, flowId: run.flowId, taskId: run.taskId ?? null, status: run.status,
          pendingNode: run.pendingNode ?? null, missing: run.missing ?? [],
          completedNodes: Object.keys(run.nodeResults ?? {}).length,
          totalNodes: ws.workflows.listFlows().find((flow) => flow.id === run.flowId)?.nodes ?? 0,
          flowName: ws.workflows.listFlows().find((flow) => flow.id === run.flowId)?.name ?? run.flowId,
          updatedAt: run.updatedAt ?? run.createdAt ?? null,
        })),
        run: query.get('id') ? await ws.workflows.get(String(query.get('id'))) : null,
      }),
      'POST /workflow/start': async () => ws.workflows.start({ ...body, workspaceId }),
      'POST /workflow/resume': async () => ws.workflows.resume(String(body.runId ?? ''), body),
      'POST /workflow/cancel': async () => ws.workflows.cancel(String(body.runId ?? ''), body.reason),
      'POST /workflow/retry': async () => ws.workflows.retry(String(body.runId ?? ''), String(body.nodeId ?? '')),
      'POST /workflow/recover': async () => ws.workflows.recover(),
      'GET /artifacts': async () => ({
        artifacts: ownerFilter(await ws.store.all('artifacts'))
          .filter((item) => item.workspaceId === workspaceId)
          .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
      }),
      'GET /artifact/preview': async () => {
        const artifact = await ws.getArtifact(String(query.get('id') ?? ''), 'read');
        const parsed = await ws.files.readDocument(artifact.path);
        const text = String(parsed.text ?? '');
        return {
          id: artifact.id, filename: artifact.filename, format: artifact.format,
          bytes: artifact.bytes, version: artifact.version ?? 1, taskId: artifact.taskId ?? null,
          createdAt: artifact.createdAt, sha256: artifact.sha256,
          text: text.slice(0, 20000), textLength: text.length, truncated: text.length > 20000,
          sections: parsed.sections.slice(0, 20).map((item) => ({ name: item.section, startLine: item.startLine, endLine: item.endLine })),
          meta: { sheets: parsed.meta?.sheetNames ?? null, columns: parsed.meta?.columns ?? null, pages: parsed.meta?.pages ?? null },
        };
      },
      'GET /formats': async () => ({ formats: (await ws.state()).formats }),
      'POST /files/generate': async () => { permission('files.write'); return ws.deliver({ format: String(body.format ?? 'md'), filename: body.filename, content: body.content, taskId: body.taskId ?? null, workspaceId }); },
      'POST /files/read': async () => ws.files.readDocument(String(body.path ?? '')),
      /** Upload + server-side parse: Word/Excel/PDF/PPTX are decoded here, never as browser text. */
      'POST /files/upload': async () => {
        const name = String(body.name ?? '').trim();
        if (!name) fail(CODES.MISSING_INPUT, '上传文件需要文件名', { field: 'name' });
        const data = String(body.data ?? '');
        if (!data) fail(CODES.MISSING_INPUT, '上传内容为空，请重新选择文件', { field: 'data' });
        const buffer = Buffer.from(data, 'base64');
        if (buffer.length === 0) fail(CODES.INVALID_INPUT, '文件内容无法解码，请重试');
        if (buffer.length > MAX_UPLOAD_BYTES) {
          fail(CODES.INVALID_INPUT, `单个文件不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`, {
            bytes: buffer.length, limit: MAX_UPLOAD_BYTES, hint: '可压缩或拆分为多个文件后再上传',
          });
        }
        const ext = path.extname(name).toLowerCase().replace('.', '');
        const capability = ws.files.capabilityMatrix().find((item) => item.format === ext);
        if (!capability?.read) {
          fail(CODES.UNSUPPORTED_FORMAT, `暂不支持解析 .${ext || '未知'} 文件`, {
            format: ext,
            supported: ws.files.capabilityMatrix().filter((item) => item.read).map((item) => item.format),
            hint: '可另存为 txt / csv / docx / xlsx / pdf 后重试，或直接把正文粘贴到输入框',
          });
        }
        const id = `upl_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const directory = path.join(ws.dataDir, 'uploads');
        await mkdir(directory, { recursive: true });
        const target = path.join(directory, `${id}.${ext}`);
        await writeFile(target, buffer);
        let parsed;
        try {
          parsed = await ws.files.readDocument(target);
        } catch (error) {
          await rm(target, { force: true }).catch(() => undefined);
          fail(error.code ?? CODES.INVALID_INPUT, `文件已收到，但内容解析失败：${error.message}`, {
            format: ext, retryable: true, hint: '文件可能已损坏或加密；可另存为 txt/csv 后重试',
          });
        }
        const text = String(parsed.text ?? '');
        const record = {
          id, name, format: ext, bytes: buffer.length, path: target, workspaceId,
          uploadedAt: new Date().toISOString(), textLength: text.length,
          sections: parsed.sections.slice(0, 12).map((item) => ({ name: item.section, startLine: item.startLine, endLine: item.endLine })),
          meta: { sheets: parsed.meta?.sheetNames ?? null, columns: parsed.meta?.columns ?? null, pages: parsed.meta?.pages ?? null },
        };
        await ws.store.upsert('uploads', record);
        return {
          uploadId: id, name, format: ext, bytes: buffer.length,
          textLength: text.length, parsed: text.trim().length > 0,
          sections: record.sections, meta: record.meta,
          preview: text.slice(0, 1500),
          message: text.trim().length > 0 ? '文件已解析' : '文件已上传，但未提取到正文（可能是扫描件或空文档）',
        };
      },
      'GET /files/limits': async () => ({ maxBytes: MAX_UPLOAD_BYTES, maxFiles: MAX_UPLOAD_FILES, formats: ws.files.capabilityMatrix().filter((item) => item.read).map((item) => ({ format: item.format, note: item.note })) }),
      'GET /connectors': async () => ({ connectors: await ws.connectors.listConnectors(), tools: await ws.connectors.discoverTools() }),
      'POST /connectors/validate': async () => ws.connectors.validateConfig(body.config ?? body),
      'GET /connector/diagnose': async () => ws.connectors.diagnose(String(query.get('id') ?? '')),
      'GET /diagnostics': async () => ({ summary: await ws.diagnostics.summary(), recent: await ws.diagnostics.recent(50) }),
      'GET /state/export': async () => { permission('state.export'); return ws.exportState(); },
      'POST /state/import': async () => { permission('state.export'); return ws.store.importAll(body.payload ?? body, { mode: body.mode ?? 'merge' }); },
      'GET /admin/backup': async () => ws.exportAllAdmin(),
    };

    const handler = routes[key];
    if (!handler) fail(CODES.NOT_FOUND, `未定义的接口 ${key}`, { available: Object.keys(routes) });
    return handler();
  }

  async function serveArtifact(req, res, query) {
    const ws = await getWorkspace();
    const id = query.get('id');
    if (!id) fail(CODES.MISSING_INPUT, '下载成果需要 id', { field: 'id' });
    const artifact = await ws.getArtifact(id, 'read');
    await ws.verifyArtifactFile(artifact);
    const info = await stat(artifact.path);
    let buffer;
    try { buffer = await readFile(artifact.path); }
    catch (error) { fail(CODES.STORAGE_FAILURE, `成果文件读取失败：${error.message}`, { id, retryable: true }); }
    let disposition;
    try { disposition = contentDisposition(artifact.filename); }
    catch (error) { fail(CODES.INVALID_INPUT, `文件名编码失败：${error.message}`, { id }); }
    res.writeHead(200, {
      'content-type': MIME[artifact.format] ?? 'application/octet-stream',
      'content-disposition': disposition,
      'content-length': info.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(buffer);
    void req;
  }

  const route = (ctx.get('webServer') ?? ctx.webServer).register({
    kind: 'prefix',
    path: prefix,
    handler: async (req, res) => {
      const rejection = rejectBy(req);
      if (rejection !== null) { res.statusCode = rejection; res.end(); return; }
      let parsed;
      try { parsed = new URL(typeof req.url === 'string' ? req.url : '', 'http://127.0.0.1'); }
      catch { sendJson(res, 400, { ok: false, error: { code: 'invalid_input', message: 'invalid request URL' } }); return; }
      const subpath = parsed.pathname.slice(prefix.length) || '/';
      const started = Date.now();
      let body = {};
      try {
        if (['POST', 'PUT', 'DELETE'].includes(req.method) && subpath !== '/artifact') body = await readBody(req);
        const actor = await actorFor(req, body, parsed.searchParams);
        await withActor(actor, async () => {
          if (subpath === '/artifact' && req.method === 'GET') return serveArtifact(req, res, parsed.searchParams);
          const result = await handle(req, subpath, parsed.searchParams, body);
          sendJson(res, 200, {
            ok: true, result, durationMs: Date.now() - started,
            actor: { workspaceId: actor.workspaceId, source: actor.source, ignoredRequestGrants: actor.ignoredRequestGrants },
          });
        });
      } catch (error) {
        if (res.headersSent) { res.end(); return; }
        const described = describeError(error);
        try {
          const ws = await getWorkspace();
          await ws.diagnostics.log({ action: 'http', status: 'error', code: described.code, message: described.message, durationMs: Date.now() - started });
        } catch { /* diagnostics must not mask the error */ }
        sendJson(res, errorStatus(described), { ok: false, error: described });
      }
    },
  });
  void assertOwner;
  return route;
}
