import { mkdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CODES, fail } from './errors.js';
import { clone, isRecord, newId, nowIso, sha256 } from './util.js';

/**
 * Authoritative state store. All business truth lives in `<dataDir>/state/*.json`.
 * The browser cache, model context and Client UI are projections only.
 *
 * - every write is atomic (tmp file + rename) and serialized in-process;
 * - a short-lived lock file protects against a second process;
 * - every record carries `revision`, and updates use compare-and-swap;
 * - every update appends a revision-history entry (no sensitive bodies).
 */
export async function createStore({ dataDir, now = nowIso, lockTtlMs = 30000 } = {}) {
  if (!dataDir) fail(CODES.INVALID_INPUT, 'store 需要 dataDir');
  const stateDir = path.join(dataDir, 'state');
  const lockFile = path.join(stateDir, '.write.lock');
  await mkdir(stateDir, { recursive: true });

  const cache = new Map();
  let queue = Promise.resolve();
  const knownCollections = new Set();

  async function readCollection(name) {
    if (cache.has(name)) return cache.get(name);
    let records = [];
    try {
      const raw = await readFile(path.join(stateDir, `${name}.json`), 'utf8');
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed) || !Array.isArray(parsed.records)) throw new Error('invalid collection file');
      records = parsed.records;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        fail(CODES.STORAGE_FAILURE, `集合 ${name} 读取失败：${error.message}`, { collection: name, retryable: true });
      }
    }
    const entry = { records };
    cache.set(name, entry);
    knownCollections.add(name);
    return entry;
  }

  async function persist(name) {
    const entry = cache.get(name);
    if (!entry) return;
    const payload = JSON.stringify(
      { version: 1, collection: name, updatedAt: now(), records: entry.records },
      null,
      2,
    ) + '\n';
    const target = path.join(stateDir, `${name}.json`);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, payload, 'utf8');
      await rename(temporary, target);
    } catch (error) {
      try { await rm(temporary, { force: true }); } catch { /* cleanup best effort */ }
      fail(CODES.STORAGE_FAILURE, `集合 ${name} 保存失败：${error.message}`, { collection: name, retryable: true });
    }
  }

  /**
   * A reusable lock file, never deleted. Deleting it on every write would
   * trigger bulk-delete safety guards in some managed Node environments after
   * a few hundred requests. Instead the file is overwritten with an explicit
   * `released: true` marker; expiry still recovers from a crashed process.
   */
  async function withLock(fn) {
    const held = JSON.stringify({ pid: process.pid, at: now(), released: false });
    try {
      const raw = await readFile(lockFile, 'utf8');
      let active = false;
      try { const parsed = JSON.parse(raw); active = parsed?.released === false; } catch { active = true; }
      if (active) {
        const info = await stat(lockFile);
        if (Date.now() - info.mtimeMs < lockTtlMs) {
          fail(CODES.LOCKED, '另一个进程正在写入业务数据，请稍后重试', { retryable: true });
        }
      }
      await writeFile(lockFile, held, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        await writeFile(lockFile, held, { flag: 'wx' }).catch((inner) => {
          if (inner?.code === 'EEXIST') fail(CODES.LOCKED, '另一个进程正在写入业务数据，请稍后重试', { retryable: true });
          throw inner;
        });
      } else if (error?.name === 'WorkspaceError') throw error;
      else throw error;
    }
    try {
      return await fn();
    } finally {
      try { await writeFile(lockFile, JSON.stringify({ pid: process.pid, at: now(), released: true }), 'utf8'); }
      catch { /* best effort */ }
    }
  }

  function serialize(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  }

  async function all(name) {
    const entry = await readCollection(name);
    return clone(entry.records);
  }

  async function find(name, id) {
    const entry = await readCollection(name);
    const record = entry.records.find((item) => item.id === id);
    return record ? clone(record) : null;
  }

  async function mutate(name, mutator) {
    return serialize(() => withLock(async () => {
      const entry = await readCollection(name);
      const draft = clone(entry.records);
      const outcome = await mutator(draft);
      const next = Array.isArray(outcome?.records) ? outcome.records : draft;
      entry.records = next;
      await persist(name);
      return outcome?.result;
    }));
  }

  function stamp(record) {
    return {
      ...record,
      id: record.id ?? newId('rec'),
      revision: (record.revision ?? 0) + 1,
      createdAt: record.createdAt ?? now(),
      updatedAt: now(),
      history: [
        ...(record.history ?? []),
        { revision: (record.revision ?? 0) + 1, at: now(), digest: sha256(JSON.stringify(record)).slice(0, 12) },
      ].slice(-50),
    };
  }

  async function upsert(name, record, expectedRevision) {
    if (!isRecord(record) || typeof record.id !== 'string') fail(CODES.INVALID_INPUT, 'upsert 需要带 id 的记录');
    return mutate(name, async (records) => {
      const index = records.findIndex((item) => item.id === record.id);
      const current = index >= 0 ? records[index] : null;
      if (expectedRevision !== undefined && current && current.revision !== expectedRevision) {
        fail(CODES.CONFLICT, `记录 ${record.id} 已被其他操作修改（期望 revision ${expectedRevision}，实际 ${current.revision}）`, {
          id: record.id, expectedRevision, actualRevision: current.revision, retryable: true,
        });
      }
      const next = stamp({ ...(current ?? {}), ...clone(record) });
      if (index >= 0) records[index] = next; else records.push(next);
      return { records, result: clone(next) };
    });
  }

  async function remove(name, id, expectedRevision) {
    return mutate(name, async (records) => {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) fail(CODES.NOT_FOUND, `记录 ${id} 不存在`, { id });
      if (expectedRevision !== undefined && records[index].revision !== expectedRevision) {
        fail(CODES.CONFLICT, `记录 ${id} 已被并发修改`, { id, retryable: true });
      }
      records.splice(index, 1);
      return { records, result: { id, removed: true } };
    });
  }

  async function archive(name, id, archived = true) {
    const record = await find(name, id);
    if (!record) fail(CODES.NOT_FOUND, `记录 ${id} 不存在`, { id });
    return upsert(name, { ...record, archived, archivedAt: archived ? now() : null }, record.revision);
  }

  async function exportAll() {
    const payload = { version: 1, exportedAt: now(), collections: {} };
    for (const name of [...knownCollections, 'tasks', 'knowledge_docs', 'knowledge_chunks', 'skills_user', 'workflow_runs', 'business_objects']) {
      if (payload.collections[name] !== undefined) continue;
      payload.collections[name] = await all(name);
    }
    return payload;
  }

  /** Ordinary workspace export: only this workspace's records + readable shared records. */
  async function exportScoped(workspaceId) {
    const payload = { version: 1, scope: workspaceId, exportedAt: now(), collections: {}, linkedResources: { originals: [], artifacts: [], userSkillDirs: [] } };
    const names = new Set([...knownCollections, 'tasks', 'knowledge_docs', 'knowledge_chunks', 'skills_user', 'workflow_runs', 'artifacts', 'connector_verifications']);
    for (const name of names) {
      const records = await all(name);
      payload.collections[name] = records.filter((record) => {
        const owner = record.workspaceId ?? 'default';
        return owner === workspaceId || owner === 'shared';
      });
    }
    for (const doc of payload.collections.knowledge_docs ?? []) {
      if (doc.workspaceId === workspaceId && doc.originalRelative) payload.linkedResources.originals.push(doc.originalRelative);
    }
    for (const artifact of payload.collections.artifacts ?? []) {
      if (artifact.workspaceId === workspaceId) payload.linkedResources.artifacts.push({ id: artifact.id, path: artifact.path, sha256: artifact.sha256, format: artifact.format });
    }
    for (const skill of payload.collections.skills_user ?? []) {
      if ((skill.workspaceId ?? 'default') === workspaceId) payload.linkedResources.userSkillDirs.push(skill.name);
    }
    return payload;
  }

  async function importAll(payload, { mode = 'merge' } = {}) {
    if (!isRecord(payload) || !isRecord(payload.collections)) fail(CODES.INVALID_INPUT, '导入文件格式无效');
    const report = {};
    for (const [name, records] of Object.entries(payload.collections)) {
      if (!Array.isArray(records)) fail(CODES.INVALID_INPUT, `集合 ${name} 不是数组`);
      await mutate(name, async (current) => {
        const base = mode === 'replace' ? [] : current;
        const byId = new Map(base.map((item) => [item.id, item]));
        for (const record of records) {
          if (!isRecord(record) || typeof record.id !== 'string') continue;
          byId.set(record.id, { ...clone(record), importedAt: now() });
        }
        return { records: [...byId.values()], result: undefined };
      });
      report[name] = records.length;
    }
    return { ok: true, mode, imported: report };
  }

  return { dataDir, stateDir, all, find, mutate, upsert, remove, archive, exportAll, exportScoped, importAll, stamp };
}
