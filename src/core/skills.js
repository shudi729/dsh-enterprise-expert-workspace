import yaml from 'js-yaml';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CODES, fail } from './errors.js';
import { clone, emptyEvidence, isRecord, nowIso, safeRelative, sha256 } from './util.js';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MAX_PACKAGE_FILES = 60;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Real YAML parsing: js-yaml handles block scalars, folded strings, lists and nested objects. */
export function parseSkillMarkdown(markdown) {
  const text = String(markdown ?? '');
  const match = FRONTMATTER.exec(text);
  if (!match) fail(CODES.INVALID_INPUT, 'SKILL.md 必须以 --- YAML frontmatter 开头');
  let meta;
  try {
    meta = yaml.load(match[1]);
  } catch (error) {
    fail(CODES.INVALID_INPUT, `SKILL.md frontmatter YAML 解析失败：${error.message}`);
  }
  if (!isRecord(meta)) fail(CODES.INVALID_INPUT, 'SKILL.md frontmatter 必须是映射');
  return { meta, body: text.slice(match[0].length).trim(), raw: text };
}

export function normalizeDefinition(meta, body, { scope, source, root, resourcePaths = [] }) {
  const name = String(meta.name ?? '').trim();
  const description = typeof meta.description === 'string' ? meta.description.trim() : '';
  const executor = String(meta.executor ?? '').trim();
  const errors = [];
  if (!NAME_PATTERN.test(name)) errors.push(`name「${name}」需为小写字母/数字/连字符`);
  if (!description) errors.push('缺少 description（支持 | 或 > 多行）');
  if (!executor) errors.push('缺少 executor（实际执行器名）');
  const resources = Array.isArray(meta.resources) ? meta.resources.map(String) : [];
  const declared = [...resources, ...resourcePaths];
  const missingResources = [];
  for (const raw of declared) {
    const safe = safeRelative(raw);
    if (safe === null) { errors.push(`资源路径非法：${raw}`); continue; }
    if (!resourcePaths.includes(safe) && !resourcePaths.some((candidate) => candidate.endsWith(`/${safe}`))) {
      missingResources.push(safe);
    }
  }
  const inputs = Array.isArray(meta.inputs) ? meta.inputs.map((input) => ({
    name: String(input.name ?? ''),
    required: Boolean(input.required),
    type: String(input.type ?? 'string'),
    hint: String(input.hint ?? ''),
  })) : [];
  const invocation = isRecord(meta.invocation) ? {
    modelInvocable: meta.invocation.modelInvocable !== false,
    userInvocable: meta.invocation.userInvocable !== false,
  } : { modelInvocable: true, userInvocable: true };
  return {
    name,
    description,
    whenToUse: typeof meta.whenToUse === 'string' ? meta.whenToUse : '',
    executor,
    version: String(meta.version ?? '1.0.0'),
    scope,
    source: clone(source ?? { kind: 'unknown' }),
    inputs,
    outputs: Array.isArray(meta.outputs) ? meta.outputs.map(String) : [],
    steps: Array.isArray(meta.steps) ? meta.steps.map(String) : [],
    acceptance: Array.isArray(meta.acceptance) ? meta.acceptance.map(String) : [],
    resources: [...new Set(declared)],
    missingResources,
    invocation,
    status: errors.length > 0 ? 'invalid' : (missingResources.length > 0 ? 'incomplete' : 'ready'),
    errors,
    checksum: sha256(`${name}\n${description}\n${executor}\n${body}`).slice(0, 16),
    body,
    root: root ?? null,
    updatedAt: nowIso(),
  };
}

async function walk(dir, base = '') {
  let entries = [];
  let names = [];
  try { names = await readdir(dir, { withFileTypes: true }); } catch { return entries; }
  for (const entry of names) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) entries = entries.concat(await walk(path.join(dir, entry.name), relative));
    else if (entry.isFile()) entries.push(relative);
  }
  return entries;
}

/**
 * Builtin skills are read-only files under `assets/skills`. User skills live in
 * the authoritative data dir. Upgrading the bundle replaces assets only and
 * can never overwrite a user skill. Resolution order: user > builtin.
 */
export function createSkillRegistry({ store, dataDir, builtinDir, executors = {}, now = nowIso }) {
  const userRoot = path.join(dataDir, 'user-skills');
  let builtinCache = null;

  async function loadBuiltin() {
    if (builtinCache) return builtinCache;
    const result = [];
    let names = [];
    try { names = await readdir(builtinDir, { withFileTypes: true }); } catch { builtinCache = result; return result; }
    for (const entry of names.filter((item) => item.isDirectory())) {
      const root = path.join(builtinDir, entry.name);
      const markdown = await readFile(path.join(root, 'SKILL.md'), 'utf8').catch(() => null);
      if (markdown === null) continue;
      const parsed = parseSkillMarkdown(markdown);
      const files = await walk(root);
      result.push(normalizeDefinition(parsed.meta, parsed.body, {
        scope: 'builtin',
        source: { kind: 'bundle', version: parsed.meta.version ?? '1.0.0', path: `assets/skills/${entry.name}` },
        root,
        resourcePaths: files.filter((file) => file !== 'SKILL.md'),
      }));
    }
    builtinCache = result;
    return result;
  }

  async function loadUser() {
    const records = await store.all('skills_user');
    const result = [];
    for (const record of records.filter((item) => !item.archived)) {
      const markdown = await readFile(path.join(userRoot, record.name, 'SKILL.md'), 'utf8').catch(() => null);
      if (markdown === null) {
        result.push({ ...record, status: 'incomplete', missingResources: ['SKILL.md'], errors: ['技能目录缺少 SKILL.md'] });
        continue;
      }
      const parsed = parseSkillMarkdown(markdown);
      const files = await walk(path.join(userRoot, record.name));
      result.push(normalizeDefinition(parsed.meta, parsed.body, {
        scope: 'user',
        source: { kind: 'user', version: parsed.meta.version ?? record.version ?? '1.0.0' },
        root: path.join(userRoot, record.name),
        resourcePaths: files.filter((file) => file !== 'SKILL.md'),
      }));
    }
    return result;
  }

  async function allSkills() {
    const builtin = await loadBuiltin();
    const user = await loadUser();
    const activeNames = new Set(user.map((item) => item.name));
    return [...builtin.filter((item) => !activeNames.has(item.name)), ...user];
  }

  async function list({ query, scope, status, includeInvalid = false } = {}) {
    const all = await allSkills();
    const q = String(query ?? '').toLowerCase().trim();
    return all.filter((item) =>
      (includeInvalid || item.status !== 'invalid') &&
      (!scope || item.scope === scope) &&
      (!status || item.status === status) &&
      (!q || `${item.name} ${item.description} ${item.whenToUse}`.toLowerCase().includes(q)),
    ).map(({ body, root, ...rest }) => ({ ...rest, callable: rest.status === 'ready' && Boolean(executors[rest.executor]) }));
  }

  async function get(name) {
    return (await allSkills()).find((item) => item.name === name) ?? null;
  }

  async function detail(name) {
    const skill = await get(name);
    if (!skill) fail(CODES.NOT_FOUND, `技能 ${name} 不存在`, { name });
    const files = skill.root ? await walk(skill.root) : [];
    return { ...skill, files, invocationHint: `/${skill.name} 或在工具中调用 skill.run`, hasExecutor: Boolean(executors[skill.executor]) };
  }

  function validate(markdown) {
    const parsed = parseSkillMarkdown(markdown);
    const definition = normalizeDefinition(parsed.meta, parsed.body, { scope: 'user', source: { kind: 'validation' } });
    return { ok: definition.status === 'ready', definition };
  }

  async function writePackage(name, files) {
    const root = path.join(userRoot, name);
    const temporary = path.join(userRoot, `.tmp-${Date.now().toString(36)}`);
    await mkdir(temporary, { recursive: true });
    try {
      for (const file of files) {
        const safe = safeRelative(file.path);
        if (safe === null) fail(CODES.INVALID_INPUT, `技能包含非法路径：${file.path}`);
        const target = path.join(temporary, ...safe.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(String(file.content ?? ''), 'utf8');
        await writeFile(target, buffer);
      }
      await rm(root, { recursive: true, force: true });
      await mkdir(path.dirname(root), { recursive: true });
      await (await import('node:fs/promises')).rename(temporary, root);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return root;
  }

  async function importPackage({ files, renameTo, onDuplicate = 'reject' }) {
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_PACKAGE_FILES) {
      fail(CODES.INVALID_INPUT, `技能包需包含 1-${MAX_PACKAGE_FILES} 个文件`);
    }
    const normalized = files.map((file) => {
      const safe = safeRelative(file.path);
      if (safe === null) fail(CODES.INVALID_INPUT, `技能包含非法路径：${file.path}`);
      const buffer = typeof file.data === 'string'
        ? Buffer.from(file.data, 'base64')
        : Buffer.from(String(file.content ?? ''), 'utf8');
      if (buffer.length > MAX_FILE_BYTES) fail(CODES.INVALID_INPUT, `技能包文件过大：${file.path}`);
      return { path: safe.toLowerCase() === 'skill.md' ? 'SKILL.md' : safe, buffer };
    });
    const main = normalized.find((file) => file.path === 'SKILL.md');
    if (!main) fail(CODES.INVALID_INPUT, '技能包根目录必须包含 SKILL.md');
    let parsed = parseSkillMarkdown(main.buffer.toString('utf8'));
    const originalName = String(parsed.meta.name ?? '').trim();
    let name = originalName;
    if (renameTo) name = String(renameTo).trim();
    if (!NAME_PATTERN.test(name)) fail(CODES.INVALID_INPUT, `技能名不合法：${name}`);
    const existingUser = (await store.all('skills_user')).some((item) => item.name === name && !item.archived);
    const existingBuiltin = (await loadBuiltin()).some((item) => item.name === name);
    if (existingUser || existingBuiltin) {
      if (onDuplicate === 'reject') fail(CODES.DUPLICATE, `同名技能已存在：${name}（可用 renameTo 或 overwrite）`, { name });
      if (onDuplicate === 'rename') name = `${name}-user-${Date.now().toString(36).slice(-4)}`;
      if (onDuplicate === 'overwrite' && existingBuiltin && !existingUser) {
        fail(CODES.PERMISSION_DENIED, '不能覆盖随包技能；请改名导入');
      }
    }
    // A renamed import must also rename the frontmatter, or the loaded skill
    // would still claim the original name and collide again on next boot.
    if (name !== originalName) {
      main.buffer = Buffer.from(main.buffer.toString('utf8').replace(/^(\s*name:\s*).*$/m, `$1${name}`), 'utf8');
      parsed = parseSkillMarkdown(main.buffer.toString('utf8'));
    }
    const root = await writePackage(name, normalized);
    const diskFiles = (await walk(root)).filter((file) => file !== 'SKILL.md');
    const definition = normalizeDefinition(parsed.meta, parsed.body, {
      scope: 'user', source: { kind: 'imported', fileCount: normalized.length }, root, resourcePaths: diskFiles,
    });
    if (definition.status === 'invalid') {
      await rm(root, { recursive: true, force: true });
      fail(CODES.INVALID_INPUT, `技能校验失败：${definition.errors.join('；')}`, { errors: definition.errors });
    }
    await store.upsert('skills_user', {
      id: `skill:${name}`,
      name,
      version: definition.version,
      status: definition.status,
      missingResources: definition.missingResources,
      checksum: definition.checksum,
      createdAt: now(),
      updatedAt: now(),
      archived: false,
    });
    return {
      name,
      status: definition.status,
      missingResources: definition.missingResources,
      note: definition.status === 'incomplete'
        ? '文件包已落盘，但声明的 references 资源未在包内找到；迁移依赖未满足，不作为可用技能'
        : '技能已导入并可执行',
      files: normalized.length,
    };
  }

  async function updateUser(name, { markdown, files, expectedRevision }) {
    const record = await store.find('skills_user', `skill:${name}`);
    if (!record) fail(CODES.NOT_FOUND, `用户技能 ${name} 不存在`, { name });
    const pack = files ?? [{ path: 'SKILL.md', content: markdown }];
    const normalized = pack.map((file) => ({
      path: safeRelative(file.path) === null ? fail(CODES.INVALID_INPUT, '非法路径') : safeRelative(file.path),
      buffer: typeof file.data === 'string' ? Buffer.from(file.data, 'base64') : Buffer.from(String(file.content ?? ''), 'utf8'),
    }));
    const check = validate(normalized.find((file) => file.path === 'SKILL.md')?.buffer.toString('utf8') ?? '');
    if (!check.ok) fail(CODES.INVALID_INPUT, `技能校验失败：${check.definition.errors.join('；')}`);
    await writePackage(name, normalized);
    return store.upsert('skills_user', {
      ...record, version: check.definition.version, checksum: check.definition.checksum, updatedAt: now(),
    }, expectedRevision ?? record.revision);
  }

  async function deleteUser(name) {
    const record = await store.find('skills_user', `skill:${name}`);
    if (!record) fail(CODES.NOT_FOUND, `用户技能 ${name} 不存在`, { name });
    await rm(path.join(userRoot, name), { recursive: true, force: true });
    return store.archive('skills_user', `skill:${name}`, true);
  }

  async function exportSkill(name) {
    const skill = await detail(name);
    if (!skill.root) fail(CODES.NOT_FOUND, `技能 ${name} 没有可导出文件`);
    const files = await walk(skill.root);
    const payload = [];
    for (const file of files) {
      const buffer = await readFile(path.join(skill.root, ...file.split('/')));
      payload.push({ path: file, data: buffer.toString('base64') });
    }
    return { name, version: skill.version, scope: skill.scope, files: payload, checksum: skill.checksum };
  }

  /** Fallback document body for executors that return structured results only. */
function renderResultContent(skill, result) {
  const structured = result?.structured ?? {};
  const rows = Object.entries(structured).map(([key, value]) => [
    key,
    typeof value === 'object' ? JSON.stringify(value).slice(0, 400) : String(value),
  ]);
  const facts = (result?.evidence?.facts ?? []).map((item) => `事实：${item.statement}`);
  const unknowns = (result?.evidence?.unknowns ?? []).map((item) => `未知：${item.statement}`);
  return {
    title: `${skill.name} 成果`,
    subtitle: `执行器 ${skill.executor} · ${new Date().toISOString()}`,
    sections: [
      { heading: '执行结果', paragraphs: [String(result?.message ?? '已完成')], bullets: [...facts, ...unknowns] },
    ],
    tables: [{ name: '结构化结果', columns: ['字段', '值'], rows }],
    citations: result?.citations ?? [],
  };
}

/** Execute a skill for real. Missing required input is an explicit `needs_input`, never a fake success. */
  async function run(name, input = {}, context = {}) {
    const skill = await get(name);
    if (!skill) fail(CODES.NOT_FOUND, `技能 ${name} 不存在`, { name });
    if (skill.status === 'invalid') fail(CODES.INVALID_INPUT, `技能 ${name} 定义无效：${skill.errors.join('；')}`);
    if (skill.status === 'incomplete') {
      fail(CODES.DEPENDENCY_UNAVAILABLE, `技能 ${name} 缺少 references 资源，不能调用`, { missingResources: skill.missingResources });
    }
    const executor = executors[skill.executor];
    if (!executor) fail(CODES.DEPENDENCY_UNAVAILABLE, `执行器 ${skill.executor} 未注册`, { executor: skill.executor });
    const missing = skill.inputs.filter((field) => field.required && (input[field.name] === undefined || input[field.name] === null || input[field.name] === ''))
      .map((field) => ({ name: field.name, hint: field.hint, type: field.type }));
    if (missing.length > 0) {
      return {
        ok: false,
        status: 'needs_input',
        skill: { name: skill.name, version: skill.version, scope: skill.scope, executor: skill.executor },
        missing,
        completed: [],
        message: `缺少 ${missing.length} 项必要输入：${missing.map((m) => m.name).join('、')}。已保留当前可执行的准备工作，未产生业务结论。`,
        evidence: emptyEvidence(),
      };
    }
    let result;
    try {
      result = await executor(input, { ...context, skill });
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        skill: { name: skill.name, version: skill.version, scope: skill.scope },
        error: { code: error?.code ?? 'internal_error', message: error?.message ?? String(error) },
        message: `技能 ${name} 执行失败：${error?.message ?? error}`,
        evidence: emptyEvidence(),
      };
    }
    // Unified artifact delivery: a requested output format always produces a
    // real, verified file, even for executors that only return structured data.
    if (input.format && input.format !== 'none' && typeof context.deliver === 'function' && (result?.artifacts ?? []).length === 0) {
      try {
        const content = result?.content ?? renderResultContent(skill, result ?? {});
        const artifact = await context.deliver({ format: input.format, filename: input.filename, content });
        result = { ...(result ?? {}), artifacts: [artifact], content };
      } catch (error) {
        return {
          ok: false,
          status: 'failed',
          skill: { name: skill.name, version: skill.version, scope: skill.scope },
          error: { code: error?.code ?? 'verification_failed', message: error?.message ?? String(error) },
          message: `成果生成失败，未宣称成功：${error?.message ?? error}`,
          evidence: result?.evidence ?? emptyEvidence(),
        };
      }
    }
    return {
      ok: result?.ok !== false,
      status: result?.ok === false ? 'failed' : 'completed',
      skill: { name: skill.name, version: skill.version, scope: skill.scope, executor: skill.executor },
      result: result ?? {},
      evidence: result?.evidence ?? emptyEvidence(),
      citations: result?.citations ?? [],
      artifacts: result?.artifacts ?? [],
      unknowns: result?.unknowns ?? [],
      message: result?.message,
    };
  }

  return { list, get, detail, validate, importPackage, updateUser, deleteUser, exportSkill, run, loadBuiltin, userRoot };
}
