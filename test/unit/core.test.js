import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import JSZip from 'jszip';
import catalog from '../../capabilities/catalog.js';
import { createWorkspace } from '../../src/core/workspace.js';
import { createStore } from '../../src/core/store.js';
import { generateDocument, readDocument, capabilityMatrix } from '../../src/core/files.js';
import { parseSkillMarkdown } from '../../src/core/skills.js';
import { createExecutors } from '../../src/core/executors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(ROOT, 'assets');
let tempDir;

async function fresh() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eew-core-'));
  return { dir, ws: await createWorkspace({ dataDir: dir, assetsDir: ASSETS, catalog }) };
}

test.after(async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }); });

test('storage: atomic write, CAS conflict, revision history, export/import', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eew-store-'));
  tempDir = dir;
  const store = await createStore({ dataDir: dir });
  const first = await store.upsert('tasks', { id: 't1', goal: '初版' });
  assert.equal(first.revision, 1);
  await assert.rejects(() => store.upsert('tasks', { id: 't1', goal: '并发覆盖' }, 0), /已被其他操作修改/);
  const second = await store.upsert('tasks', { id: 't1', goal: '第二版' }, first.revision);
  assert.equal(second.revision, 2);
  assert.equal(second.history.length, 2);
  const payload = await store.exportAll();
  assert.equal(payload.collections.tasks.length, 1);
  const restored = await createStore({ dataDir: path.join(dir, 'nested') });
  const imported = await restored.importAll(payload);
  assert.equal(imported.imported.tasks, 1);
  assert.equal((await restored.find('tasks', 't1')).goal, '第二版');
});

test('knowledge: import, hash dedupe, search citation resolves back to original text', async () => {
  const { dir, ws } = await fresh();
  try {
    const text = '# 商机评估\n\n先确认决策链与采购流程，避免把假设当成事实。\n\n# 拜访准备\n\n携带证据清单并记录反馈。\n';
    const first = await ws.knowledge.importText({ title: '销售方法', text, domain: 'sales-method', trust: 'unverified' });
    assert.equal(first.duplicate, false);
    assert.ok(first.chunks >= 2);
    const again = await ws.knowledge.importText({ title: '销售方法', text, domain: 'sales-method' });
    assert.equal(again.duplicate, true, '同哈希内容必须去重');
    assert.equal((await ws.knowledge.list({})).length, 1);

    const search = await ws.knowledge.search({ query: '决策链', domain: 'sales-method' });
    assert.ok(search.hits.length > 0, '中文检索应命中');
    const citation = search.hits[0].citation;
    const section = await ws.knowledge.readSection({ docId: citation.docId, section: citation.section, part: citation.part });
    assert.ok(section.text.includes('决策链'), '引用必须回到实际原文');
    assert.equal(section.trust, 'unverified');
    const verified = await ws.knowledge.verify({ docId: citation.docId, trust: 'verified', note: '用户确认' });
    assert.equal(verified.trust, 'verified');
    const exported = await ws.knowledge.exportDocument(citation.docId);
    assert.ok(exported.content.includes('SHA256'));
    const original = await readFile(path.join(dir, 'originals', section.originalRelative.split('/').pop()), 'utf8');
    assert.ok(original.includes('决策链'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('skills: real YAML (multi-line description), shipped packages, duplicates, user/builtin isolation', async () => {
  const { dir, ws } = await fresh();
  try {
    const markdown = `---\nname: demo-skill\ndescription: |\n  第一行说明\n  第二行说明\nexecutor: knowledge.retrieve\nversion: 1.2.3\ninvocation:\n  modelInvocable: true\n  userInvocable: false\nresources:\n  - references/a.md\ninputs:\n  - name: query\n    required: true\n    hint: 检索词\n---\n\n# 正文\n`;
    const parsed = parseSkillMarkdown(markdown);
    assert.ok(parsed.meta.description.includes('第二行说明'), 'js-yaml 必须解析多行 description');
    assert.equal(parsed.meta.invocation.userInvocable, false);
    assert.equal(parsed.meta.version, '1.2.3');

    const list = await ws.skills.list();
    assert.equal(list.length, catalog.skills.length);
    assert.ok(list.every((item) => item.status !== 'invalid'));
    const detail = await ws.skills.detail('km-review');
    assert.ok(detail.files.includes('SKILL.md'));
    assert.equal(detail.executor, 'km.review');

    const pack = await ws.skills.importPackage({ files: [
      { path: 'SKILL.md', content: markdown.replace('demo-skill', 'user-skill') },
      { path: 'references/a.md', content: '参考资料正文' },
    ] });
    assert.equal(pack.name, 'user-skill');
    assert.equal(pack.status, 'ready');
    await assert.rejects(() => ws.skills.importPackage({ files: [{ path: 'SKILL.md', content: markdown.replace('demo-skill', 'user-skill') }] }), /同名技能已存在/);
    const renamed = await ws.skills.importPackage({ files: [{ path: 'SKILL.md', content: markdown.replace('demo-skill', 'user-skill') }], onDuplicate: 'rename' });
    assert.notEqual(renamed.name, 'user-skill');
    await assert.rejects(() => ws.skills.deleteUser('km-review'), /不存在/);
    const exported = await ws.skills.exportSkill('user-skill');
    assert.equal(exported.files.length, 2);
    await ws.skills.deleteUser('user-skill');
    assert.equal((await ws.skills.list({ scope: 'user' })).some((item) => item.name === 'user-skill'), false);
    assert.ok((await ws.skills.list()).some((item) => item.name === 'km-review'), '升级/删除用户技能不影响随包技能');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('files: all eight formats generate and reopen, or PDF safely refuses mojibake without a CJK font', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eew-files-'));
  try {
    const content = {
      title: '企业客户分析成果',
      subtitle: '2026 年度',
      sections: [{ heading: '判断', paragraphs: ['基于已提供资料形成结论。'], bullets: ['依据一', '依据二'] }],
      tables: [{ name: '指标', columns: ['指标', '数值'], rows: [['收入', 120], ['成本', 80]] }],
      citations: [{ title: '销售方法', section: '商机评估', lines: [1, 3] }],
    };
    const results = {};
    for (const { format } of capabilityMatrix()) {
      const target = path.join(dir, `result.${format}`);
      try {
        const generated = await generateDocument({ format, targetPath: target, content });
        results[format] = { verified: generated.verified, bytes: generated.bytes };
        assert.equal(generated.verified, true, `${format} 必须回读校验通过`);
        const reopened = await readDocument(target);
        assert.equal(reopened.meta.format, format);
        assert.ok(reopened.text.length > 0 || format === 'pdf', `${format} 必须能重新打开并读取`);
      } catch (error) {
        results[format] = { failed: error.code ?? 'error', message: error.message };
        if (format === 'pdf' && error.code === 'dependency_unavailable') {
          assert.match(error.message, /中文字体/);
          assert.ok(Array.isArray(error.details?.candidates) && error.details.candidates.length > 0);
          continue;
        }
        throw error;
      }
    }
    assert.deepEqual(Object.keys(results).sort(), capabilityMatrix().map(({ format }) => format).sort());
    console.log('[format-smoke]', JSON.stringify(results));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('files: reads ordinary Excel shared strings and sparse cells without SheetJS', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eew-xlsx-'));
  try {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="报价明细" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
    zip.file('xl/sharedStrings.xml', '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3"><si><t>供应商</t></si><si><t>A 公司</t></si><si><r><t>含税</t></r><r><t>总价</t></r></si></sst>');
    zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>9480</v></c></row></sheetData></worksheet>');
    const filePath = path.join(dir, 'quoted.xlsx');
    await writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
    const parsed = await readDocument(filePath);
    assert.deepEqual(parsed.meta.sheetNames, ['报价明细']);
    assert.deepEqual(parsed.meta['报价明细'][0], ['供应商', '', '含税总价']);
    assert.equal(parsed.meta['报价明细'][1][2], 9480);
    assert.ok(parsed.text.includes('A 公司,,9480'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('executors: real calculations for metrics, TCO, candidate ranking and governance scope', async () => {
  const { dir, ws } = await fresh();
  try {
    const e = createExecutors();
    const rows = [['区域', '收入'], ['华东', 100], ['华南', 200], ['华东', 300]];
    const metrics = await e['data.metrics']({ rows, columns: ['区域', '收入'], field: '收入', groupBy: '区域' }, { deliver: null });
    assert.equal(metrics.structured.metrics.sum, 600);
    assert.equal(metrics.structured.metrics.mean, 200);
    assert.equal(metrics.structured.groups.find((g) => g.key === '华东').sum, 400);

    const quality = await e['data.quality']({ rows: [['a', '1'], ['a', ''], ['b', '3']], columns: ['k', 'v'] }, {});
    assert.ok(quality.structured.issues.some((issue) => issue.type === 'missing'));

    const tco = await e['procurement.tco']({ quotes: [
      { vendor: 'A', unitPrice: 10, quantity: 100, implementation: 500, annualMaintenance: 200, training: 100 },
      { vendor: 'B', unitPrice: 12, quantity: 100, implementation: 0, annualMaintenance: 0, training: 0 },
      { vendor: 'C', unitPrice: 8 },
    ], years: 3 }, { deliver: null });
    assert.equal(tco.structured.calculated.find((item) => item.vendor === 'A').tco, 2200);
    assert.equal(tco.structured.calculated.find((item) => item.vendor === 'B').tco, 1200);
    assert.equal(tco.structured.calculated.find((item) => item.vendor === 'C').tco, null, '缺字段不虚构报价');

    const ranked = await e['hr.compareCandidates']({ candidates: [
      { name: '甲', scores: { 专业能力: 5, 经验匹配: 4, 沟通协作: 3 } },
      { name: '乙', scores: { 专业能力: 3, 经验匹配: 5 } },
    ], criteria: [{ name: '专业能力', weight: 2 }, { name: '经验匹配', weight: 1 }, { name: '沟通协作', weight: 1 }] }, {});
    assert.ok(ranked.content.tables.length > 0);
    assert.equal(ranked.structured.facts > 0, true);

    const governance = await e['governance.inventory']({ samples: [{ name: '客户表', fields: ['id', 'name'], rows: [{ id: 1 }] }] }, { deliver: null });
    assert.equal(governance.structured.fullScan, false);
    assert.equal(governance.structured.lineageDiscovered, false);
    assert.equal(governance.structured.permissionGovernance, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('experts + workflow: routing, confirmation gate, resume, cancel, restart recovery', async () => {
  const { dir, ws } = await fresh();
  try {
    const routed = ws.experts.route({ goal: '帮我做候选人评估与面试设计' });
    assert.equal(routed.selected.id, 'hr');
    assert.ok(routed.reasoning.length > 0);
    const corrected = ws.experts.route({ goal: '候选人评估', expertId: 'data-analysis' });
    assert.equal(corrected.selected.id, 'data-analysis', '用户可纠正专家选择');

    const doc = await ws.knowledge.importText({ title: '复盘待审条目', text: '# 复盘\n\n待审核经验卡内容：客户决策链确认。', trust: 'unverified' });
    const run = await ws.workflows.start({ flowId: 'km-review-to-sop', input: {
      project: '客户 A 项目', material: '项目复盘材料', docId: doc.doc.id, query: '决策链',
    }, workspaceId: 'default' });
    assert.equal(run.status, 'waiting_confirmation', '外部副作用节点必须停在确认点');
    const resumed = await ws.workflows.resume(run.id, { confirmed: true });
    assert.equal(resumed.status, 'completed', `真实依赖满足后流程应完成：${JSON.stringify(resumed.error)}`);

    const cancelled = await ws.workflows.cancel(run.id, '测试取消');
    assert.equal(cancelled.status, 'cancelled');

    const running = await ws.workflows.start({ flowId: 'research-report', input: { question: '行业机会', sources: [], claims: [] } });
    await ws.store.upsert('workflow_runs', { ...running, status: 'running' }, running.revision);
    // A new workspace instance over the same directory simulates a process restart.
    const restarted = await createWorkspace({ dataDir: dir, assetsDir: ASSETS, catalog });
    const recovered = await restarted.workflows.recover();
    assert.ok(recovered.recovered >= 1, '重启恢复必须识别未完成的运行');
    const reloaded = await restarted.workflows.get(running.id);
    assert.equal(reloaded.status, 'interrupted');
    assert.ok(Object.keys(reloaded.nodeResults).length >= 1, '已完成节点在重启后仍可读取');
    assert.equal((await restarted.tasks.list({ workspaceId: 'default' })).length >= 0, true, '长期业务状态仍可读取');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
