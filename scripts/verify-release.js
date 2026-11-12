#!/usr/bin/env node
/** Static publication and dsh.so acceptance checks. No network or profile mutation. */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };
const read = (relative) => readFile(path.join(ROOT, relative), 'utf8');

const pkg = JSON.parse(await read('package.json'));
const readme = await read('README.md');
const patchPath = pkg.dsh?.bundle?.patch?.replace(/^\.\//, '');
const patchSource = patchPath ? await read(patchPath).catch(() => '') : '';
const patch = patchSource ? yaml.load(patchSource) : null;

check(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pkg.name), '插件 ID / 包名不符合 dsh.so 规则');
check(pkg.private !== true, 'package.json 不能是 private:true');
check(Boolean(pkg.description) && /[\u3400-\u9fff]/.test(pkg.description), '缺少可用于中文检索的插件描述');
check(pkg.license === 'MIT', 'package.json 缺少 SPDX 可识别的 MIT 许可证');
check(await stat(path.join(ROOT, 'LICENSE')).then((item) => item.isFile()).catch(() => false), '缺少 LICENSE 文件');
check(Boolean(pkg.engines?.dsh), '缺少 engines.dsh 兼容范围');
check(Boolean(patchPath), '缺少 dsh.bundle.patch');
check(Boolean(patchSource), `bundle patch 不存在：${patchPath ?? '(未声明)'}`);
const insertedNames = Array.isArray(patch)
  ? patch.flatMap((operation) => operation?.insert ?? []).map((item) => item?.name)
  : [];
check(insertedNames.includes(pkg.name), 'bundle patch 没有引用当前包名');
check(readme.includes(`dsh plugin --profile web add ${pkg.name}`), 'README 缺少可复制的真实安装命令');
check(readme.includes('升级') && readme.includes('卸载') && readme.includes('权限'), 'README 缺少升级、卸载或权限说明');
check(readme.includes('企业 AI 专家工作台'), 'README 缺少中文展示名');
check(pkg.repository?.url?.includes('github.com/shudi729/dsh-enterprise-expert-workspace'), 'repository 指向不正确');
check(pkg.publishConfig?.registry === 'https://registry.npmjs.org/', 'publishConfig.registry 不是公开 npm');
check(pkg.publishConfig?.access === 'public', 'publishConfig.access 不是 public');

for (const required of ['index.js', 'client.js', 'icon.svg', 'README.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'docs/MARKET_SUBMISSION.md']) {
  check(await stat(path.join(ROOT, required)).then((item) => item.isFile()).catch(() => false), `缺少发布文件：${required}`);
}
for (const doc of ['CHANGELOG.md', 'docs/MARKET_SUBMISSION.md', `docs/RELEASE_NOTES_${pkg.version}.md`]) {
  const content = await read(doc).catch(() => '');
  check(content.includes(pkg.version), `${doc} 与 package.json 版本不一致`);
}

const skipped = new Set(['node_modules', 'dist', '.git']);
const sourceFiles = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(?:js|json|ya?ml|md|txt|svg)$/i.test(entry.name) || ['LICENSE', '.gitignore', '.gitattributes', '.editorconfig'].includes(entry.name)) sourceFiles.push(full);
  }
}
await walk(ROOT);
const forbidden = [
  { pattern: /[A-Z]:\\Users\\[^\\\s]+/i, label: '用户绝对路径' },
  { pattern: /\bF:\\/i, label: '本机 F 盘路径' },
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: '私钥' },
  { pattern: /\b(?:ghp|npm|sk)-[A-Za-z0-9_-]{20,}\b/, label: '疑似访问令牌' },
];
for (const file of sourceFiles) {
  const content = await readFile(file, 'utf8');
  for (const rule of forbidden) if (rule.pattern.test(content)) problems.push(`${path.relative(ROOT, file)} 包含${rule.label}`);
}

const skillDirectories = await readdir(path.join(ROOT, 'assets', 'skills'), { withFileTypes: true });
const skills = skillDirectories.filter((item) => item.isDirectory());
check(skills.length === 61, `随包 Skill 应为 61，实际 ${skills.length}`);
for (const skill of skills) check(await stat(path.join(ROOT, 'assets', 'skills', skill.name, 'SKILL.md')).then((item) => item.isFile()).catch(() => false), `${skill.name} 缺少 SKILL.md`);

const report = {
  ok: problems.length === 0,
  name: pkg.name,
  version: pkg.version,
  displayName: '企业 AI 专家工作台',
  dshPatch: patchPath,
  sourceFilesScanned: sourceFiles.length,
  skills: skills.length,
  problems,
};
console.log(JSON.stringify(report, null, 2));
if (problems.length > 0) process.exitCode = 1;
