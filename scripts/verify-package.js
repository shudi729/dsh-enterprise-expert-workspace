#!/usr/bin/env node
/** Verify that the published tarball contains exactly the validated sources. */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../src/core/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idx = process.argv.indexOf('--tarball');
const { name, version } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const archiveName = name.replace(/^@/, '').replace('/', '-');
const TARBALL = idx >= 0 ? path.resolve(process.argv[idx + 1]) : path.join(ROOT, 'dist', `${archiveName}-${version}.tgz`);
const CRITICAL = [
  'package.json', 'cordis.patch.yml', 'index.js', 'client.js', 'icon.svg', 'README.md',
  'src/core/access.js', 'src/core/workspace.js', 'src/core/tasks.js', 'src/core/knowledge.js',
  'src/core/workflows.js', 'src/core/skills.js', 'src/core/store.js', 'src/core/files.js', 'src/core/executors-shared.js',
  'src/core/executors-domains.js',
  'src/host/routes.js', 'src/host/tools.js', 'src/host/model-adapter.js', 'src/host/skills-bridge.js',
  'capabilities/catalog.js', 'capabilities/matrix.json',
  'assets/skills/sales-account-research/SKILL.md',
  'assets/skills/sales-opportunity-card/SKILL.md',
  'assets/skills/sales-material/SKILL.md',
  'assets/skills/sales-visit-plan/SKILL.md',
  'docs/ARCHITECTURE.md', 'docs/PRIVACY.md', 'docs/MARKET_SUBMISSION.md', 'docs/RELEASE_NOTES_1.6.0.md',
  'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md',
];

async function listFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(path.join(directory, entry.name), relative));
    else result.push(relative);
  }
  return result.sort();
}

const temp = await mkdtemp(path.join(os.tmpdir(), 'eew-pack-'));
try {
  const info = await stat(TARBALL);
  const extract = spawnSync('tar', ['-xf', TARBALL, '-C', temp], { encoding: 'utf8', shell: false });
  if (extract.status !== 0) throw new Error(`tar 解压失败：${extract.stderr}`);
  const mismatches = [];
  const checked = [];
  const packageRoot = path.join(temp, 'package');
  const packedFiles = await listFiles(packageRoot);
  for (const relative of CRITICAL) if (!packedFiles.includes(relative)) mismatches.push(`missing:${relative}`);
  for (const relative of packedFiles) {
    if (/^(?:test|scripts|node_modules|dist|\.github)\//.test(relative) || /(?:^|\/)\.env(?:\.|$)/.test(relative)) {
      mismatches.push(`forbidden:${relative}`);
      continue;
    }
    const packed = path.join(temp, 'package', relative);
    const source = path.join(ROOT, relative);
    const [a, b] = await Promise.all([readFile(packed), readFile(source).catch(() => null)]);
    if (!b) {
      mismatches.push(`no-source:${relative}`);
      continue;
    }
    const semanticJson = relative === 'package.json';
    let same;
    if (semanticJson) {
      const packedJson = JSON.parse(a.toString('utf8'));
      const sourceJson = JSON.parse(b.toString('utf8'));
      // pnpm intentionally removes this development-only hint from packed manifests.
      // pnpm also removes prepublishOnly from the published manifest after running it.
      // All runtime, publication and DSH metadata must still match exactly.
      delete sourceJson.packageManager;
      delete sourceJson.scripts?.prepublishOnly;
      same = isDeepStrictEqual(packedJson, sourceJson);
    } else {
      same = sha256(a) === sha256(b);
    }
    checked.push({ file: relative, bytes: a.length, match: same, comparison: semanticJson ? 'json-semantic' : 'sha256' });
    if (!same) mismatches.push(relative);
  }
  const result = {
    ok: mismatches.length === 0 && path.basename(TARBALL).includes(version),
    tarball: TARBALL, bytes: info.size, version, checked: checked.length, packedFiles: packedFiles.length,
    mismatches, allMatch: mismatches.length === 0,
    files: checked,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.allMatch) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true }).catch(() => undefined);
}
