import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CODES, fail } from './errors.js';
import { nowIso, redact } from './util.js';

export const PERMISSIONS = Object.freeze({
  'knowledge.import': '导入外部资料为待核实知识',
  'knowledge.verify': '把待核实知识提升为可信规则',
  'files.write': '生成或写入成果文件',
  'connectors.configure': '新增或修改连接器配置',
  'external.action': '执行有外部副作用的操作（发送、提交、调用外部系统）',
  'state.export': '导出业务数据',
  'skills.write': '创建、修改或删除用户技能',
});

const DEFAULT_DENIED = new Set(['connectors.configure', 'external.action']);

export function createDiagnostics({ dataDir, settings = {}, now = nowIso }) {
  const logPath = path.join(dataDir, 'diagnostics.ndjson');

  /** Explicit permission classes. Ordinary tasks never get connectors/external rights. */
  function authorize(permission, { elevated = false, granted = [] } = {}) {
    if (!PERMISSIONS[permission]) fail(CODES.INVALID_INPUT, `未知权限 ${permission}`, { permission });
    const explicitlyGranted = Array.isArray(granted) && granted.includes(permission);
    const setting = settings.permissions?.[permission];
    let allowed;
    if (setting === false) allowed = false;
    else if (setting === true) allowed = true;
    else allowed = explicitlyGranted || !DEFAULT_DENIED.has(permission);
    if (elevated && DEFAULT_DENIED.has(permission) && !explicitlyGranted && setting !== true) allowed = false;
    return {
      permission,
      granted: allowed,
      reason: !allowed
        ? (DEFAULT_DENIED.has(permission) ? '该权限默认关闭，需用户在本次操作中显式授权' : '管理员已禁用该权限')
        : (DEFAULT_DENIED.has(permission) ? '本次显式授权生效' : '默认授权的日常操作'),
      retryable: true,
    };
  }

  function assert(permission, context) {
    const result = authorize(permission, context);
    if (!result.granted) fail(CODES.PERMISSION_DENIED, `缺少权限「${PERMISSIONS[permission]}」：${result.reason}`, { permission });
    return result;
  }

  /** Structured, redacted log: task/call/error/source only, never secrets or full bodies. */
  async function log(entry) {
    await mkdir(path.dirname(logPath), { recursive: true });
    const record = redact({
      at: now(),
      taskId: entry.taskId ?? null,
      action: entry.action ?? 'unknown',
      status: entry.status ?? 'ok',
      durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null,
      code: entry.code ?? null,
      message: typeof entry.message === 'string' ? entry.message.slice(0, 300) : null,
      sources: Array.isArray(entry.sources) ? entry.sources.map((item) => String(item).slice(0, 160)).slice(0, 10) : [],
    });
    await appendFile(logPath, JSON.stringify(record) + '\n', 'utf8');
    return record;
  }

  async function recent(limit = 100) {
    const text = await readFile(logPath, 'utf8').catch(() => '');
    const lines = text.trim().split('\n').filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(limit, 1000))).map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
  }

  async function summary() {
    const entries = await recent(1000);
    const failures = entries.filter((entry) => entry.status === 'error' || entry.code);
    return {
      total: entries.length,
      failures: failures.length,
      lastFailure: failures.at(-1) ?? null,
      retryable: failures.filter((entry) => entry.retryable).length,
      permissions: Object.fromEntries(Object.keys(PERMISSIONS).map((permission) => [permission, authorize(permission).granted])),
      note: '日志不含秘密与业务正文；失败项保留重试入口',
    };
  }

  return { authorize, assert, log, recent, summary, logPath, PERMISSIONS };
}
