import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { CODES, fail } from './errors.js';
import { sectionize, sha256 } from './util.js';

const MAX_READ_BYTES = 25 * 1024 * 1024;

/** Declared per-format operations. Nothing is claimed that is not implemented. */
export const FORMAT_CAPABILITIES = Object.freeze({
  md: { read: true, generate: true, verify: true, note: 'UTF-8 Markdown，按标题分节' },
  txt: { read: true, generate: true, verify: true, note: 'UTF-8 纯文本' },
  csv: { read: true, generate: true, verify: true, note: '逗号分隔，首行表头，支持引号转义' },
  json: { read: true, generate: true, verify: true, note: '结构化成果与导入导出' },
  pdf: { read: true, generate: true, verify: 'ascii', note: '读取用 pdf-parse；生成用 pdfkit，中文需系统中文字体，回读校验用 ASCII 标记' },
  docx: { read: true, generate: true, verify: true, note: '读取提取 word/document.xml；生成用 docx 包' },
  xlsx: { read: true, generate: true, verify: true, note: '读取/生成用内置 Open XML 处理器' },
  pptx: { read: true, generate: true, verify: true, note: '读取提取 ppt/slides/*.xml；生成用内置 Open XML 模板' },
});

const CJK_FONT_CANDIDATES = [
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/Deng.ttf',
  'C:/Windows/Fonts/simkai.ttf',
  'C:/Windows/Fonts/simfang.ttf',
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/simsun.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
];

/** pdfkit cannot embed some TTC collections; probe each candidate before use. */
function usableCjkFont() {
  for (const candidate of CJK_FONT_CANDIDATES) {
    if (!existsSync(candidate)) continue;
    try {
      const probe = new PDFDocument();
      probe.registerFont('CJK', candidate);
      probe.font('CJK');
      probe.fontSize(8).text('probe');
      return candidate;
    } catch { /* try the next candidate */ }
  }
  return null;
}

function formatOf(filePath) {
  return path.extname(filePath).replace(/^\./, '').toLowerCase();
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function encodeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function xmlAttribute(source, name) {
  const match = String(source).match(new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

function columnIndex(reference) {
  const letters = String(reference ?? '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A';
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cleanSheetName(value, fallback) {
  const name = String(value ?? '').replace(/[\\/?*\[\]:]/g, '_').slice(0, 31).trim();
  return name || fallback;
}

function zipEntrySize(entry) {
  return Number(entry?._data?.uncompressedSize ?? 0);
}

async function zipText(zip, name, maxBytes = 12 * 1024 * 1024) {
  const entry = zip.files[name];
  if (!entry) fail(CODES.VERIFICATION_FAILED, `压缩文档缺少 ${name}`, { entry: name });
  const declared = zipEntrySize(entry);
  if (declared > maxBytes) fail(CODES.INVALID_INPUT, `压缩文档条目过大：${name}`, { bytes: declared, maxBytes });
  const text = await entry.async('string');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) fail(CODES.INVALID_INPUT, `压缩文档条目过大：${name}`, { maxBytes });
  return text;
}

async function readXlsxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zipText(zip, 'xl/workbook.xml');
  const relationshipsXml = await zipText(zip, 'xl/_rels/workbook.xml.rels');
  const relationTargets = new Map();
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const id = xmlAttribute(match[1], 'Id');
    const target = xmlAttribute(match[1], 'Target');
    if (id && target) relationTargets.set(id, target);
  }
  let sharedStrings = [];
  if (zip.files['xl/sharedStrings.xml']) {
    const sharedXml = await zipText(zip, 'xl/sharedStrings.xml');
    sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((item) =>
      [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => decodeXml(text[1])).join(''));
  }
  const sheets = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const name = xmlAttribute(match[1], 'name') ?? `Sheet${sheets.length + 1}`;
    const relationId = xmlAttribute(match[1], 'r:id');
    const target = relationTargets.get(relationId);
    if (!target) continue;
    const normalized = target.startsWith('/')
      ? target.replace(/^\//, '')
      : path.posix.normalize(path.posix.join('xl', target));
    const sheetXml = await zipText(zip, normalized);
    const rows = [];
    for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1];
        const body = cellMatch[2];
        const index = columnIndex(xmlAttribute(attrs, 'r'));
        const type = xmlAttribute(attrs, 't');
        const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
        let value;
        if (type === 'inlineStr') {
          value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1])).join('');
        } else if (type === 's') value = sharedStrings[Number(rawValue)] ?? '';
        else if (type === 'b') value = rawValue === '1';
        else if (type === 'str' || type === 'e') value = decodeXml(rawValue);
        else value = rawValue === '' || Number.isNaN(Number(rawValue)) ? decodeXml(rawValue) : Number(rawValue);
        while (row.length < index) row.push('');
        row[index] = value;
      }
      while (row.length > 0 && row.at(-1) === '') row.pop();
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  if (sheets.length === 0) fail(CODES.VERIFICATION_FAILED, 'XLSX 无可读取工作表');
  return sheets;
}

function xlsxCellXml(value, reference) {
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${encodeXml(value)}</t></is></c>`;
}

async function writeXlsxBuffer(sheets) {
  const zip = new JSZip();
  const normalized = sheets.map((sheet, index) => ({
    name: cleanSheetName(sheet.name, `Sheet${index + 1}`),
    rows: sheet.rows ?? [],
  }));
  const used = new Set();
  for (const sheet of normalized) {
    const base = sheet.name;
    let suffix = 2;
    while (used.has(sheet.name.toLowerCase())) sheet.name = `${base.slice(0, 27)}_${suffix++}`;
    used.add(sheet.name.toLowerCase());
  }
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${normalized.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${normalized.map((sheet, index) => `<sheet name="${encodeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${normalized.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${normalized.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="微软雅黑"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>');
  normalized.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows.map((row, rowIndex) => {
      const cells = row.map((value, column) => xlsxCellXml(value, `${columnName(column)}${rowIndex + 1}`)).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');
    zip.file(`xl/worksheets/sheet${sheetIndex + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export function contentToText(content) {
  const parts = [String(content.title ?? '未命名成果')];
  if (content.subtitle) parts.push(String(content.subtitle));
  for (const section of content.sections ?? []) {
    parts.push(`# ${section.heading ?? '章节'}`);
    for (const paragraph of section.paragraphs ?? []) parts.push(String(paragraph));
    for (const bullet of section.bullets ?? []) parts.push(`- ${bullet}`);
  }
  for (const table of content.tables ?? []) {
    parts.push(`# ${table.name ?? '表格'}`);
    parts.push((table.columns ?? []).map(String).join(','));
    for (const row of table.rows ?? []) parts.push(row.map((cell) => String(cell ?? '')).join(','));
  }
  for (const citation of content.citations ?? []) {
    parts.push(`[引用] ${citation.title ?? citation.docId ?? ''} / ${citation.section ?? ''} / 行 ${(citation.lines ?? []).join('-')}`);
  }
  return parts.join('\n');
}

export function tablesFromContent(content) {
  const tables = (content.tables ?? []).map((table) => ({
    name: table.name ?? '表格',
    columns: (table.columns ?? []).map(String),
    rows: (table.rows ?? []).map((row) => row.map((cell) => cell ?? '')),
  }));
  if (tables.length > 0) return tables;
  return [{
    name: '成果明细',
    columns: ['章节', '内容'],
    rows: (content.sections ?? []).flatMap((section) => [
      ...(section.paragraphs ?? []).map((p) => [section.heading ?? '', String(p)]),
      ...(section.bullets ?? []).map((b) => [section.heading ?? '', String(b)]),
    ]),
  }];
}

async function extractFromZip(buffer, matcher, formatter) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((name) => matcher.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const blocks = [];
  for (const name of names) {
    const xml = await zipText(zip, name);
    const texts = [...xml.matchAll(formatter)].map((match) => match[1]);
    const text = texts.join(' ').trim();
    if (!text) continue;
    if (names.length === 1) { blocks.push(text); continue; }
    // Internal zip paths are not business text: label slides/pages in Chinese.
    const slide = name.match(/slide(\d+)\.xml$/);
    blocks.push(`# ${slide ? `第 ${slide[1]} 页` : '正文'}\n\n${text}`);
  }
  return blocks.join('\n\n');
}

export async function readDocument(filePath) {
  const info = await stat(filePath).catch(() => fail(CODES.NOT_FOUND, `文件不存在：${filePath}`, { path: filePath }));
  if (info.size > MAX_READ_BYTES) fail(CODES.INVALID_INPUT, '文件超过 25 MiB 读取上限', { bytes: info.size });
  const format = formatOf(filePath);
  if (!FORMAT_CAPABILITIES[format]?.read) fail(CODES.UNSUPPORTED_FORMAT, `不支持读取 .${format}`, { format });
  const buffer = await readFile(filePath);
  let text = '';
  let extra = {};
  if (format === 'md' || format === 'txt') text = buffer.toString('utf8');
  else if (format === 'csv') {
    const rows = parseCsv(buffer.toString('utf8'));
    text = rows.map((row) => row.join(',')).join('\n');
    extra = { rows, columns: rows[0] ?? [], rowCount: Math.max(rows.length - 1, 0) };
  } else if (format === 'json') {
    const parsed = JSON.parse(buffer.toString('utf8'));
    text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
    extra = { parsed };
  } else if (format === 'pdf') {
    const parsed = await pdfParse(buffer);
    text = parsed.text ?? '';
    extra = { pages: parsed.numpages ?? null };
  } else if (format === 'docx') {
    text = await extractFromZip(buffer, /^word\/document\.xml$/, /<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
  } else if (format === 'pptx') {
    text = await extractFromZip(buffer, /^ppt\/slides\/slide\d+\.xml$/, /<a:t>([\s\S]*?)<\/a:t>/g);
  } else if (format === 'xlsx') {
    const sheets = await readXlsxBuffer(buffer);
    extra = { sheetNames: sheets.map((sheet) => sheet.name) };
    text = sheets.map(({ name, rows }) => {
      extra[name] = rows;
      return `# ${name}\n\n${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}`;
    }).join('\n\n');
  }
  const decoded = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return {
    text: decoded,
    sections: sectionize(decoded),
    meta: { format, title: path.basename(filePath), bytes: info.size, sha256: sha256(buffer), ...extra },
  };
}

async function writeMarkdown(target, content) {
  const lines = [`# ${content.title ?? '未命名成果'}`, ''];
  if (content.subtitle) lines.push(content.subtitle, '');
  for (const section of content.sections ?? []) {
    lines.push(`## ${section.heading ?? '章节'}`);
    for (const paragraph of section.paragraphs ?? []) lines.push('', String(paragraph));
    for (const bullet of section.bullets ?? []) lines.push(`- ${bullet}`);
    lines.push('');
  }
  for (const table of content.tables ?? []) {
    lines.push(`## ${table.name ?? '表格'}`, '', `| ${(table.columns ?? []).join(' | ')} |`, `| ${(table.columns ?? []).map(() => '---').join(' | ')} |`);
    for (const row of table.rows ?? []) lines.push(`| ${row.map((cell) => String(cell ?? '').replace(/\|/g, '\\|')).join(' | ')} |`);
    lines.push('');
  }
  if (content.citations?.length) {
    lines.push('## 依据与引用', '');
    for (const c of content.citations) lines.push(`- ${c.title ?? c.docId} / ${c.section ?? ''} / 行 ${(c.lines ?? []).join('-')} / sha256:${String(c.sha256 ?? '').slice(0, 12)}`);
  }
  lines.push('', `<!-- ${content.verifyMarker ?? ''} -->`);
  await writeFile(target, lines.join('\n'), 'utf8');
}

async function writeCsv(target, content) {
  const table = tablesFromContent(content)[0];
  const rows = [table.columns, ...table.rows];
  await writeFile(target, rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n') + '\r\n', 'utf8');
}

async function writeDocx(target, content) {
  const children = [new Paragraph({ children: [new TextRun({ text: String(content.title ?? '成果'), bold: true, size: 32 })] })];
  if (content.subtitle) children.push(new Paragraph({ text: String(content.subtitle), italics: true }));
  for (const section of content.sections ?? []) {
    children.push(new Paragraph({ text: String(section.heading ?? '章节'), bold: true, spacing: { before: 240 } }));
    for (const paragraph of section.paragraphs ?? []) children.push(new Paragraph(String(paragraph)));
    for (const bullet of section.bullets ?? []) children.push(new Paragraph({ text: String(bullet), bullet: { level: 0 } }));
  }
  for (const table of content.tables ?? []) {
    const header = (table.columns ?? []).map((column) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(column), bold: true })] })] }));
    const rows = (table.rows ?? []).map((row) => new TableRow({
      children: row.map((cell) => new TableCell({ children: [new Paragraph(String(cell ?? ''))] })),
    }));
    children.push(new Paragraph({ text: String(table.name ?? '表格'), bold: true }));
    children.push(new Table({ rows: [new TableRow({ children: header }), ...rows], width: { size: 100, type: 'pct' } }));
  }
  if (content.citations?.length) {
    children.push(new Paragraph({ text: '依据与引用', bold: true }));
    for (const c of content.citations) children.push(new Paragraph(`${c.title ?? c.docId} / ${c.section ?? ''} / 行 ${(c.lines ?? []).join('-')}`));
  }
  children.push(new Paragraph(String(content.verifyMarker ?? '')));
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  await writeFile(target, buffer);
}

async function writeXlsx(target, content) {
  const sheets = [{
    name: '成果说明',
    rows: [
      ['字段', '值'],
      ['标题', String(content.title ?? '')],
      ['副标题', String(content.subtitle ?? '')],
      ['校验标记', String(content.verifyMarker ?? '')],
      ['生成时间', String(content.generatedAt ?? '')],
    ],
  }];
  const tables = tablesFromContent(content);
  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    sheets.push({ name: `${cleanSheetName(table.name, 'Sheet').slice(0, 25)}${index + 1}`, rows: [table.columns, ...table.rows] });
  }
  await writeFile(target, await writeXlsxBuffer(sheets));
}

async function writePptx(target, content) {
  const xml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const paragraphs = (lines, size = 1800) => lines.map((line) =>
    `<a:p><a:r><a:rPr lang="zh-CN" sz="${size}"/><a:t>${xml(line)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${size}"/></a:p>`).join('');
  const slides = [{
    title: content.title ?? '成果',
    lines: [content.subtitle ?? '', content.verifyMarker ?? ''].filter(Boolean),
  }];
  for (const section of content.sections ?? []) slides.push({
    title: section.heading ?? '章节',
    lines: [...(section.paragraphs ?? []), ...(section.bullets ?? []).map((item) => `• ${item}`)],
  });
  for (const table of content.tables ?? []) slides.push({
    title: table.name ?? '表格',
    lines: [
      (table.columns ?? []).map(String).join(' ｜ '),
      ...(table.rows ?? []).map((row) => row.map((cell) => String(cell ?? '')).join(' ｜ ')),
    ],
  });
  if (content.citations?.length) slides.push({
    title: '依据与引用',
    lines: content.citations.map((item) => `${item.title ?? item.docId} / ${item.section ?? ''}`),
  });

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}</Relationships>`);
  zip.file('ppt/slideMasters/slideMaster1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>');
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>');
  zip.file('ppt/slideLayouts/slideLayout1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="空白"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld></p:sldLayout>');
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
  zip.file('ppt/theme/theme1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="企业专家工作台"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="0F766E"/></a:accent2><a:accent3><a:srgbClr val="D97706"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4><a:accent5><a:srgbClr val="DC2626"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>');
  slides.forEach((slide, index) => {
    const title = xml(slide.title);
    const bodyLines = (slide.lines ?? []).map(String).flatMap((line) => line.split(/\r?\n/)).slice(0, 24);
    zip.file(`ppt/slides/slide${index + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="650000" y="350000"/><a:ext cx="10800000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="2600" b="1"/><a:t>${title}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="2600"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="正文"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="750000" y="1450000"/><a:ext cx="10600000" cy="4700000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs(bodyLines)}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
  });
  await writeFile(target, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function writePdf(target, content) {
  const fontPath = usableCjkFont();
  const chunks = [];
  const document = new PDFDocument({ size: 'A4', margin: 54, compress: false });
  document.info.Subject = String(content.verifyMarker ?? 'EEW');
  const done = new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', resolve);
    document.on('error', reject);
  });
  let fontRegistered = false;
  if (fontPath) {
    try { document.registerFont('CJK', fontPath); document.font('CJK'); fontRegistered = true; } catch { document.font('Helvetica'); }
  } else {
    document.font('Helvetica');
  }
  const hasCjk = /[\u3400-\u9fff]/.test(contentToText(content));
  if (hasCjk && !fontRegistered) {
    document.end();
    await done;
    fail(CODES.DEPENDENCY_UNAVAILABLE, '未找到可嵌入 PDF 的中文字体，拒绝生成中文乱码 PDF；请安装 TTF 中文字体或改用 DOCX/Markdown', {
      candidates: CJK_FONT_CANDIDATES, retryable: true,
    });
  }
  document.fontSize(20).text(String(content.title ?? '成果'));
  document.fontSize(8).text(String(content.verifyMarker ?? 'EEW'));
  if (content.subtitle) document.moveDown(0.4).fontSize(11).text(String(content.subtitle));
  for (const section of content.sections ?? []) {
    document.moveDown(0.8).fontSize(14).text(String(section.heading ?? '章节'));
    document.fontSize(10);
    for (const paragraph of section.paragraphs ?? []) document.text(String(paragraph));
    for (const bullet of section.bullets ?? []) document.text(`- ${bullet}`);
  }
  for (const table of content.tables ?? []) {
    document.moveDown(0.8).fontSize(12).text(String(table.name ?? '表格'));
    document.fontSize(9).text([table.columns.map(String).join(' | '), ...table.rows.map((row) => row.map((cell) => String(cell ?? '')).join(' | '))].join('\n'));
  }
  document.end();
  await done;
  await writeFile(target, Buffer.concat(chunks));
  return { fontPath: fontRegistered ? fontPath : 'Helvetica' };
}

const WRITERS = {
  md: writeMarkdown,
  txt: async (target, content) => writeFile(target, `${contentToText(content)}\n${content.verifyMarker ?? ''}`, 'utf8'),
  csv: writeCsv,
  json: async (target, content) => writeFile(target, JSON.stringify({ ...content, source: 'enterprise-expert-workspace' }, null, 2), 'utf8'),
  docx: writeDocx,
  xlsx: writeXlsx,
  pptx: writePptx,
  pdf: writePdf,
};

export async function verifyDocument(filePath, format = formatOf(filePath), expectedText) {
  const info = await stat(filePath).catch(() => fail(CODES.VERIFICATION_FAILED, '生成文件不存在', { path: filePath }));
  if (info.size === 0) fail(CODES.VERIFICATION_FAILED, '生成文件为空', { path: filePath });
  const buffer = await readFile(filePath);
  let readableText = '';
  if (format === 'md' || format === 'txt' || format === 'csv') readableText = buffer.toString('utf8');
  else if (format === 'json') { JSON.parse(buffer.toString('utf8')); readableText = buffer.toString('utf8'); }
  else if (format === 'docx' || format === 'pptx') {
    const zip = await JSZip.loadAsync(buffer);
    const required = format === 'docx' ? 'word/document.xml' : 'ppt/presentation.xml';
    if (!zip.files[required]) fail(CODES.VERIFICATION_FAILED, `${format.toUpperCase()} 缺少 ${required}`, { path: filePath });
    readableText = await extractFromZip(buffer, format === 'docx' ? /^word\/document\.xml$/ : /^ppt\/slides\/slide\d+\.xml$/, format === 'docx' ? /<w:t[^>]*>([\s\S]*?)<\/w:t>/g : /<a:t>([\s\S]*?)<\/a:t>/g);
  } else if (format === 'xlsx') {
    const sheets = await readXlsxBuffer(buffer);
    readableText = sheets.map((sheet) => sheet.rows.map((row) => row.map(escapeCsv).join(',')).join('\n')).join('\n');
  } else if (format === 'pdf') {
    const source = buffer.toString('latin1');
    if (!source.startsWith('%PDF-') || !source.includes('%%EOF')) {
      fail(CODES.VERIFICATION_FAILED, 'PDF 缺少有效文件头或结束标记', { path: filePath });
    }
    const xref = source.match(/startxref\s+(\d+)\s+%%EOF/);
    const offset = Number(xref?.[1]);
    if (!Number.isInteger(offset) || offset < 0 || offset >= buffer.length || source.slice(offset, offset + 4) !== 'xref') {
      fail(CODES.VERIFICATION_FAILED, 'PDF 交叉引用表无效', { path: filePath });
    }
    readableText = source;
  }
  if (expectedText && !readableText.includes(String(expectedText))) {
    fail(CODES.VERIFICATION_FAILED, `回读内容缺少预期标记「${expectedText}」`, { path: filePath, format });
  }
  return { ok: true, format, bytes: info.size, sha256: sha256(buffer), readableText: readableText.slice(0, 4000) };
}

function markerFor(format, content) {
  const stamp = `EEW-${sha256(contentToText(content)).slice(0, 8)}`;
  if (format === 'csv') return String(tablesFromContent(content)[0].columns[0] ?? '');
  return format === 'pdf' ? stamp : String(content.title ?? '').slice(0, 40) || stamp;
}

/** Generate a real, openable artifact; a failed verification removes the file and raises. */
export async function generateDocument({ format, targetPath, content, verify = true, generatedAt }) {
  if (!FORMAT_CAPABILITIES[format]?.generate) fail(CODES.UNSUPPORTED_FORMAT, `不支持生成 .${format}`, { format });
  if (!targetPath) fail(CODES.MISSING_INPUT, '生成文件需要 targetPath', { field: 'targetPath' });
  await mkdir(path.dirname(targetPath), { recursive: true });
  const marker = format === 'pdf' ? `EEW-${sha256(contentToText(content)).slice(0, 8)}` : markerFor(format, content);
  const enriched = { ...content, verifyMarker: `EEW-${sha256(contentToText(content)).slice(0, 8)}`, generatedAt: generatedAt ?? new Date().toISOString() };
  const writerMeta = await WRITERS[format](targetPath, enriched);
  if (!verify) return { path: targetPath, format, verified: false, meta: writerMeta ?? null };
  try {
    const checked = await verifyDocument(targetPath, format, marker);
    return { path: targetPath, format, verified: true, ...checked, meta: writerMeta ?? null };
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => undefined);
    fail(CODES.VERIFICATION_FAILED, `成果文件校验失败：${error.message}`, { path: targetPath, format, retryable: true });
  }
}

export function capabilityMatrix() {
  return Object.entries(FORMAT_CAPABILITIES).map(([format, value]) => ({ format, ...value }));
}
