#!/usr/bin/env node
/** Inspect the final tarball without extracting it to disk. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const archiveName = pkg.name.replace(/^@/, '').replace('/', '-');
const tarball = path.join(ROOT, 'dist', `${archiveName}-${pkg.version}.tgz`);
const problems = [];

const list = spawnSync('tar', ['-tf', tarball], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (list.status !== 0) throw new Error(`无法读取发布包：${list.stderr}`);
const entries = list.stdout.split(/\r?\n/).filter(Boolean);
const files = entries.filter((entry) => !entry.endsWith('/'));

const forbiddenPath = /(?:^|\/)(?:node_modules|test|scripts|dist|\.git|\.env)(?:\/|$)|(?:^|\/)(?:\.credentials|[^/]+\.log)$/i;
for (const entry of entries) if (forbiddenPath.test(entry.replace(/^package\//, ''))) problems.push(`禁止路径：${entry}`);

const textFile = (entry) => /\.(?:js|json|ya?ml|md|txt|svg)$/i.test(entry) || /\/(?:LICENSE|README|SECURITY|CHANGELOG|THIRD_PARTY_NOTICES)$/.test(entry);
const sensitive = [
  { pattern: /[A-Z]:\\Users\\[^\\\s]+/i, label: '用户绝对路径' },
  { pattern: /\bF:\\/i, label: '本机 F 盘路径' },
  { pattern: /CodeBuddy|sales-quest-knowledge|key-account-sales-master/i, label: '私人开发来源' },
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: '私钥' },
  { pattern: /\b(?:ghp|npm|sk)-[A-Za-z0-9_-]{20,}\b/, label: '疑似访问令牌' },
];
for (const entry of files.filter(textFile)) {
  const extracted = spawnSync('tar', ['-xOf', tarball, entry], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (extracted.status !== 0) { problems.push(`无法检查：${entry}`); continue; }
  for (const rule of sensitive) if (rule.pattern.test(extracted.stdout)) problems.push(`${entry} 包含${rule.label}`);
}

const archive = await readFile(tarball);
const report = {
  ok: problems.length === 0,
  tarball,
  bytes: (await stat(tarball)).size,
  files: files.length,
  textFilesScanned: files.filter(textFile).length,
  sha256: createHash('sha256').update(archive).digest('hex').toUpperCase(),
  forbiddenPaths: problems.filter((item) => item.startsWith('禁止路径')).length,
  sensitiveHits: problems.filter((item) => !item.startsWith('禁止路径')).length,
  problems,
};
console.log(JSON.stringify(report, null, 2));
if (problems.length > 0) process.exitCode = 1;
