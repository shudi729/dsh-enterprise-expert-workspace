import { CODES, fail } from './errors.js';
import { nowIso } from './util.js';

const MCP_MODULE = '@deepseek-ai/dsh-mcp-client';
const PUBLIC_FIELDS = ['name', 'serverName', 'transport', 'url', 'command', 'args'];
const SECRET_PATTERN = /token|secret|password|appSecret|apiKey|authorization|credential|cookie|privateKey/i;

export function createConnectors({ store, getContext = () => null, now = nowIso }) {
  /** Tools actually visible in this runtime; never claim a tool by its catalog name alone. */
  async function discoverTools() {
    const ctx = getContext();
    const tools = ctx?.get?.('tools');
    let entries = [];
    try {
      if (tools && typeof tools.list === 'function') entries = await tools.list();
      else if (tools && typeof tools.entries === 'function') entries = await tools.entries();
      else if (tools && typeof tools.snapshot === 'function') entries = await tools.snapshot();
    } catch (error) {
      return { available: false, tools: [], message: `工具目录读取失败：${error.message}`, status: 'unavailable' };
    }
    const names = (Array.isArray(entries) ? entries : Object.keys(entries ?? {})).map((item) => typeof item === 'string' ? item : (item?.name ?? item?.id)).filter(Boolean);
    return { available: true, count: names.length, tools: names.slice(0, 300), status: names.length > 0 ? 'ok' : 'empty' };
  }

  /** Configured / loaded / toolAvailable / verification are four distinct facts. */
  async function listConnectors() {
    const ctx = getContext();
    const loader = ctx?.get?.('loader');
    const configured = [];
    const loaded = [];
    try {
      const entries = typeof loader?.entries === 'function' ? await loader.entries() : [];
      for (const entry of Array.isArray(entries) ? entries : []) {
        const name = entry?.name ?? entry?.module ?? '';
        if (!name) continue;
        if (name === MCP_MODULE || String(entry?.id ?? '').startsWith('mcp-')) configured.push({ id: entry.id, name, disabled: Boolean(entry.disabled), transport: entry.config?.transport ?? null });
        if (!entry.disabled) loaded.push(String(entry.id ?? name));
      }
    } catch (error) {
      return { configured: [], status: 'unavailable', message: `无法读取 profile 配置：${error.message}` };
    }
    const toolState = await discoverTools();
    const records = await store.all('connector_verifications');
    return {
      configured: configured.map((item) => {
        const verification = records.find((record) => record.id === item.id);
        const prefix = `mcp__${(item.id ?? '').replace(/^mcp-/, '')}__`;
        const toolNames = toolState.available ? toolState.tools.filter((name) => name.startsWith(prefix)) : [];
        return {
          ...item,
          loaded: loaded.includes(item.id) && !item.disabled,
          toolAvailable: !item.disabled && toolNames.length > 0,
          toolCount: item.disabled ? 0 : toolNames.length,
          verification: verification?.result ?? 'not_checked',
          verifiedAt: verification?.at ?? null,
          note: item.disabled ? '已配置但禁用' : (toolNames.length === 0 ? '已配置但未检出可用工具；不代表连接成功' : '工具已检出'),
        };
      }),
      toolDirectory: { available: toolState.available, count: toolState.count },
      status: configured.length === 0 ? 'none_configured' : 'ok',
      note: '目录只读；普通任务不会修改 profile 或安装连接器',
    };
  }

  /** Public-field validation. Secrets must come from the credential mechanism, never this payload. */
  function validateConfig(config) {
    const problems = [];
    if (!config || typeof config !== 'object') fail(CODES.INVALID_INPUT, '连接器配置必须是对象');
    const name = String(config.name ?? config.serverName ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) problems.push('name 需为 1-32 位字母/数字/下划线/连字符');
    const transport = String(config.transport ?? '').trim();
    if (!['http', 'stdio', 'sse'].includes(transport)) problems.push('transport 需为 http / stdio / sse');
    if (transport === 'stdio' && !String(config.command ?? '').trim()) problems.push('stdio 需要 command');
    if (['http', 'sse'].includes(transport)) {
      try {
        const url = new URL(String(config.url ?? ''));
        if (!['http:', 'https:'].includes(url.protocol)) problems.push('url 需为 http(s)');
      } catch { problems.push('url 无效'); }
    }
    if (Array.isArray(config.args) && (config.args.length > 20 || config.args.some((arg) => typeof arg !== 'string'))) problems.push('args 需为不超过 20 个字符串');
    const secretKeys = Object.keys(config).filter((key) => SECRET_PATTERN.test(key));
    if (secretKeys.length > 0) problems.push(`配置中不得包含秘密字段：${secretKeys.join(', ')}；请使用凭据机制与 !!js 引用`);
    return {
      ok: problems.length === 0,
      problems,
      publicFields: Object.fromEntries(PUBLIC_FIELDS.filter((key) => config[key] !== undefined).map((key) => [key, config[key]])),
      name,
      transport,
      note: '校验只覆盖公开字段；不代表已配置、已加载、工具可用或连接验证通过',
    };
  }

  async function recordVerification(id, result, message) {
    if (!['ok', 'missing_credentials', 'unavailable', 'timeout', 'disconnected', 'not_checked'].includes(result)) {
      fail(CODES.INVALID_INPUT, `非法验证结果 ${result}`);
    }
    return store.upsert('connector_verifications', { id: `connector:${id}`, name: id, result, message: message ?? null, at: now() });
  }

  async function diagnose(id) {
    const list = await listConnectors();
    const item = list.configured.find((entry) => entry.id === id || entry.name === id);
    if (!item) {
      return { status: 'unavailable', reason: '未配置', guidance: '尚未在 profile 中配置该连接器；本工作台不会自动安装' };
    }
    if (item.disabled) return { status: 'unavailable', reason: '已禁用', guidance: '需要由用户在 profile 层启用' };
    if (!item.loaded) return { status: 'unavailable', reason: '未加载', guidance: '检查 Loader 行是否解析成功，必要时重启 profile' };
    if (!item.toolAvailable) return { status: 'unavailable', reason: '无可用工具', guidance: '检查凭据是否通过凭据机制提供，以及连接器是否被拒绝加载；不宣称连接成功' };
    return { status: item.verification === 'ok' ? 'ok' : 'unverified', reason: item.verification, guidance: item.verification === 'ok' ? '已验证' : '尚未完成连接验证，需显式触发验证' };
  }

  return { discoverTools, listConnectors, validateConfig, recordVerification, diagnose };
}
