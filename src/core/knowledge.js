import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CODES, fail } from './errors.js';
import { assertOwner, currentActor, ownerFilter } from './access.js';
import { clone, isRecord, newId, nowIso, sectionize, sha256, tokenize } from './util.js';

/**
 * Host-side persistent knowledge base.
 * Trust: unverified (external import) < verified (user confirmed) < builtin.
 * External material is NEVER promoted to a rule automatically.
 * `shared` documents are readable by all workspaces and writable only by admin.
 */
export function createKnowledge({ store, files, dataDir, now = nowIso }) {
  const originalsDir = path.join(dataDir, 'originals');

  function citationOf(doc, chunk) {
    return {
      docId: doc.id, title: doc.title, version: doc.version, trust: doc.trust,
      source: doc.source, section: chunk.section, lines: [chunk.startLine, chunk.endLine],
      part: chunk.part, quote: chunk.text.slice(0, 240), sha256: doc.sha256,
      workspaceId: doc.workspaceId,
    };
  }

  function checkWorkspaceScope(workspaceId) {
    const actor = currentActor();
    if (workspaceId && workspaceId !== actor.workspaceId && workspaceId !== 'shared') {
      fail(CODES.PERMISSION_DENIED, '检索范围超出当前工作空间', { requested: workspaceId });
    }
  }

  async function importText(input) {
    const text = String(input.text ?? '');
    const title = String(input.title ?? '').trim();
    if (!title) fail(CODES.MISSING_INPUT, '知识导入需要 title', { field: 'title' });
    if (text.trim().length === 0) fail(CODES.MISSING_INPUT, '知识导入内容为空', { field: 'text' });
    const workspaceId = input.workspaceId ?? currentActor().workspaceId;
    assertOwner({ workspaceId }, 'write');
    const digest = sha256(text);
    const existing = (await store.all('knowledge_docs')).find(
      (doc) => doc.sha256 === digest && doc.workspaceId === workspaceId,
    );
    if (existing) return { duplicate: true, doc: existing, chunks: 0 };

    await mkdir(originalsDir, { recursive: true });
    const ext = String(input.extension ?? (input.source?.path ? path.extname(input.source.path) : '') ?? '.txt') || '.txt';
    const originalRelative = path.posix.join('originals', `${digest}${ext.startsWith('.') ? ext : `.${ext}`}`);
    const originalPayload = Buffer.isBuffer(input.raw) ? input.raw : (typeof input.raw === 'string' ? input.raw : text);
    await writeFile(path.join(dataDir, ...originalRelative.split('/')), originalPayload);

    const doc = {
      id: newId('doc'),
      workspaceId,
      title,
      domain: input.domain ?? 'general',
      tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string') : [],
      trust: ['unverified', 'verified', 'builtin'].includes(input.trust) ? input.trust : 'unverified',
      source: isRecord(input.source) ? clone(input.source) : { kind: 'manual', name: title },
      originalRelative,
      sha256: digest,
      bytes: Buffer.byteLength(text, 'utf8'),
      version: 1, createdAt: now(), updatedAt: now(), archived: false,
    };
    await store.upsert('knowledge_docs', doc);
    const sections = sectionize(text);
    const chunks = sections.map((section, index) => ({
      id: `${doc.id}_c${index + 1}`, docId: doc.id, workspaceId, domain: doc.domain, tags: doc.tags,
      trust: doc.trust, section: section.section, startLine: section.startLine, endLine: section.endLine,
      part: section.part, text: section.text, tokens: tokenize(`${title} ${section.section} ${section.text}`),
    }));
    await store.mutate('knowledge_chunks', async (records) => ({
      records: records.filter((item) => item.docId !== doc.id).concat(chunks),
    }));
    return { duplicate: false, doc, chunks: chunks.length, sections: sections.length };
  }

  async function importFile({ workspaceId, filePath, title, domain, tags, trust, source }) {
    if (!files) fail(CODES.DEPENDENCY_UNAVAILABLE, '文件适配器不可用，无法导入该文件');
    const scope = workspaceId ?? currentActor().workspaceId;
    assertOwner({ workspaceId: scope }, 'write');
    const opened = await files.readDocument(filePath);
    const raw = await readFile(filePath).catch(() => null);
    return importText({
      workspaceId: scope,
      title: title ?? opened.meta?.title ?? path.basename(filePath),
      text: opened.text, raw, extension: path.extname(filePath), domain, tags,
      trust: trust ?? 'unverified',
      source: source ?? { kind: 'file', name: path.basename(filePath), path: path.basename(filePath) },
    });
  }

  /** Reliable lexical retrieval: tf-idf over latin terms and CJK bigrams. */
  async function search({ workspaceId, query, domain, tags, trust, limit = 8 } = {}) {
    const q = String(query ?? '').trim();
    if (!q) fail(CODES.MISSING_INPUT, '知识检索需要 query', { field: 'query' });
    checkWorkspaceScope(workspaceId);
    const queryTokens = [...new Set(tokenize(q))];
    const docs = new Map((await store.all('knowledge_docs')).map((doc) => [doc.id, doc]));
    const candidates = ownerFilter(await store.all('knowledge_chunks')).filter((chunk) => {
      const doc = docs.get(chunk.docId);
      if (!doc || doc.archived) return false;
      if (domain && doc.domain !== domain) return false;
      if (trust && doc.trust !== trust) return false;
      if (Array.isArray(tags) && tags.length > 0 && !tags.some((tag) => doc.tags.includes(tag))) return false;
      return true;
    });
    const df = new Map();
    for (const token of queryTokens) df.set(token, candidates.filter((chunk) => chunk.tokens.includes(token)).length);
    const scored = [];
    for (const chunk of candidates) {
      let score = 0;
      const tf = new Map();
      for (const token of chunk.tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
      for (const token of queryTokens) {
        const freq = tf.get(token) ?? 0;
        if (freq === 0) continue;
        score += (1 + Math.log(freq)) * Math.log(1 + candidates.length / (1 + (df.get(token) ?? 0)));
      }
      if (q.length >= 2 && chunk.text.toLowerCase().includes(q.toLowerCase())) score += 4;
      if (score <= 0) continue;
      const doc = docs.get(chunk.docId);
      scored.push({ score, citation: citationOf(doc, chunk), docId: doc.id });
    }
    scored.sort((a, b) => b.score - a.score);
    const hits = scored.slice(0, Math.max(1, Math.min(limit, 50))).map(({ score, citation }) => ({ score: Number(score.toFixed(4)), citation }));
    return {
      query: q, workspaceId: workspaceId ?? currentActor().workspaceId, totalCandidates: candidates.length, hits,
      status: hits.length > 0 ? 'ok' : 'no_match',
      note: hits.length === 0 ? '未检索到匹配内容；这是真实结果，不代表资料已存在' : undefined,
    };
  }

  /** Return original text for a citation, so a reference always resolves back to source. */
  async function readSection({ docId, section, part = 1, workspaceId }) {
    checkWorkspaceScope(workspaceId);
    const doc = await store.find('knowledge_docs', docId);
    if (!doc) fail(CODES.NOT_FOUND, `知识文档 ${docId} 不存在`, { docId });
    assertOwner(doc, 'read');
    const chunk = (await store.all('knowledge_chunks')).find(
      (item) => item.docId === docId && (!section || item.section === section) && item.part === Number(part),
    );
    if (!chunk) fail(CODES.NOT_FOUND, '未找到引用的章节', { docId, section, part });
    assertOwner(chunk, 'read');
    return { ...citationOf(doc, chunk), text: chunk.text, originalRelative: doc.originalRelative };
  }

  async function verify({ docId, trust = 'verified', note }) {
    const doc = await store.find('knowledge_docs', docId);
    if (!doc) fail(CODES.NOT_FOUND, `知识文档 ${docId} 不存在`, { docId });
    assertOwner(doc, 'write');
    if (doc.trust === 'builtin') fail(CODES.INVALID_INPUT, '随包知识不需要外部核实');
    const next = await store.upsert('knowledge_docs', {
      ...doc, trust, verification: { at: now(), note: note ?? '用户确认', trust },
    }, doc.revision);
    await store.mutate('knowledge_chunks', async (records) => ({
      records: records.map((item) => (item.docId === docId ? { ...item, trust } : item)),
    }));
    return next;
  }

  async function list({ workspaceId, domain, includeArchived = false } = {}) {
    checkWorkspaceScope(workspaceId);
    return ownerFilter(await store.all('knowledge_docs')).filter((doc) =>
      (!workspaceId || doc.workspaceId === workspaceId || doc.workspaceId === 'shared') &&
      (!domain || doc.domain === domain) &&
      (includeArchived || !doc.archived),
    );
  }

  async function exportDocument(docId) {
    const doc = await store.find('knowledge_docs', docId);
    if (!doc) fail(CODES.NOT_FOUND, `知识文档 ${docId} 不存在`, { docId });
    assertOwner(doc, 'read');
    const chunks = ownerFilter(await store.all('knowledge_chunks'))
      .filter((item) => item.docId === docId)
      .sort((a, b) => a.startLine - b.startLine || a.part - b.part);
    const body = chunks.map((chunk) => `## ${chunk.section}（行 ${chunk.startLine}-${chunk.endLine}）\n\n${chunk.text}`).join('\n\n');
    return {
      filename: `${doc.title.replace(/[\\/:*?"<>|]/g, '_')}.knowledge.md`,
      content: `# ${doc.title}\n\n- 版本：${doc.version}\n- 可信级别：${doc.trust}\n- 工作空间：${doc.workspaceId}\n- 来源：${JSON.stringify(doc.source)}\n- SHA256：${doc.sha256}\n\n${body}\n`,
    };
  }

  async function remove(docId) {
    const doc = await store.find('knowledge_docs', docId);
    if (!doc) fail(CODES.NOT_FOUND, `知识文档 ${docId} 不存在`, { docId });
    assertOwner(doc, 'write');
    await store.archive('knowledge_docs', docId, true);
    return { ok: true, docId, archived: true };
  }

  return { importText, importFile, search, readSection, verify, list, exportDocument, remove, originalsDir };
}
