import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? Buffer.from(value, 'utf8') : value).digest('hex');
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Reject traversal, absolute paths, and drive letters in user-supplied relative paths. */
export function safeRelative(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 300) return null;
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  const joined = path.posix.normalize(normalized);
  if (joined.startsWith('..') || joined.includes('\0')) return null;
  return joined;
}

export function safeJoin(root, relative) {
  const safe = safeRelative(relative);
  if (safe === null) return null;
  const target = path.resolve(root, ...safe.split('/'));
  const resolvedRoot = path.resolve(root);
  return target === resolvedRoot || target.startsWith(resolvedRoot + path.sep) ? target : null;
}

export function tokenize(text) {
  const lower = String(text ?? '').toLowerCase();
  const latin = lower.match(/[a-z0-9_.-]{2,}/g) ?? [];
  const cjk = lower.match(/[\u3400-\u9fff]/g) ?? [];
  const bigrams = [];
  for (let i = 0; i < cjk.length - 1; i += 1) bigrams.push(cjk[i] + cjk[i + 1]);
  return [...latin, ...cjk, ...bigrams];
}

/** Split text into citation-addressable sections. Keeps original line numbers. */
export function sectionize(text, { maxChars = 1800 } = {}) {
  const lines = String(text ?? '').split(/\r?\n/);
  const sections = [];
  let heading = '文档开头';
  let buffer = [];
  let startLine = 1;
  let cursor = 1;
  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body.length === 0) return;
    for (let offset = 0; offset < body.length; offset += maxChars) {
      const part = body.slice(offset, offset + maxChars);
      sections.push({
        section: heading,
        startLine,
        endLine: cursor,
        part: Math.floor(offset / maxChars) + 1,
        text: part,
      });
    }
    buffer = [];
  };
  for (const line of lines) {
    const match = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line) || /^\s*(\d+(\.\d+)*)[、.\s]\s*(.+)$/.exec(line);
    if (match) {
      flush();
      heading = (match[2] ?? match[3] ?? '').trim().slice(0, 120) || heading;
      startLine = cursor + 1;
    } else {
      buffer.push(line);
    }
    cursor += 1;
  }
  flush();
  return sections.length > 0 ? sections : [{ section: '全文', startLine: 1, endLine: Math.max(lines.length, 1), part: 1, text: String(text ?? '') }];
}

/** Five-way separation required for every business judgement. */
export function emptyEvidence() {
  return { facts: [], assumptions: [], userJudgements: [], recommendations: [], unknowns: [] };
}

export function appendEvidence(target, key, value) {
  if (!target || !Array.isArray(target[key])) return target;
  const entry = typeof value === 'string' ? { statement: value } : value;
  if (entry && typeof entry.statement === 'string' && entry.statement.length > 0) {
    target[key].push({ ...entry, at: nowIso() });
  }
  return target;
}

export function redact(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(redact);
  if (!isRecord(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (/token|secret|password|appSecret|apiKey|authorization|credential|cookie|privateKey/i.test(key)) {
      out[key] = '[redacted]';
    } else if (/begin-[a-z-]*private-key|bearer\s+[a-z0-9._-]{12,}/i.test(String(child ?? ''))) {
      out[key] = '[redacted]';
    } else {
      out[key] = redact(child);
    }
  }
  return out;
}

export function pick(value, keys) {
  const out = {};
  for (const key of keys) if (value?.[key] !== undefined) out[key] = value[key];
  return out;
}

export function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}
