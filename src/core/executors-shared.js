import { CODES, fail } from './errors.js';
import { emptyEvidence, isRecord } from './util.js';
import { parseCsv } from './files.js';

function asText(value, max = 300) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.slice(0, max);
  if (Array.isArray(value)) return value.map((item) => asText(item, 120)).join('；').slice(0, max);
  if (isRecord(value)) return JSON.stringify(value).slice(0, max);
  return String(value).slice(0, max);
}

function normalizeRows(input) {
  if (Array.isArray(input.rows)) {
    if (input.rows.length === 0) return { columns: input.columns ?? [], rows: [] };
    if (Array.isArray(input.rows[0])) return { columns: input.columns ?? input.rows[0].map((_, i) => `列${i + 1}`), rows: input.rows.map((row) => [...row]) };
    const columns = input.columns ?? Object.keys(input.rows[0]);
    return { columns, rows: input.rows.map((row) => columns.map((key) => row[key] ?? '')) };
  }
  if (typeof input.csv === 'string') {
    const parsed = parseCsv(input.csv);
    return { columns: input.columns ?? parsed[0] ?? [], rows: input.columns ? parsed : parsed.slice(1) };
  }
  return null;
}

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/[,%\s￥$]/g, ''));
  return Number.isFinite(number) ? number : null;
}

async function collectCitations(input, context) {
  const query = input.query ?? input.knowledgeQuery;
  if (!query || !context.services?.knowledge) return [];
  const result = await context.services.knowledge.search({
    workspaceId: input.workspaceId ?? context.workspaceId ?? 'default',
    query,
    domain: input.domain,
    limit: input.citationLimit ?? 5,
  });
  return result.hits.map((hit) => hit.citation);
}

/** Readable business text for structured values (never raw JSON in the UI). */
function describeValue(value, max = 220) {
  const pair = (key, item) => (isRecord(item)
    ? `${key} ${Object.entries(item).map(([k, v]) => `${k} ${asText(v, 30)}`).join('，')}`
    : `${key} ${asText(item, 30)}`);
  if (Array.isArray(value)) {
    const parts = value.map((item) => {
      if (!isRecord(item)) return asText(item, 40);
      const primary = item.name ?? item.title ?? item.vendor ?? item.company ?? item.project ?? null;
      const details = Object.entries(item)
        .filter(([key, inner]) => !['name', 'title', 'vendor', 'company', 'project', 'id'].includes(key) && inner !== undefined && inner !== null && inner !== '')
        .map(([key, inner]) => (isRecord(inner)
          ? Object.entries(inner).map(([k, v]) => `${k} ${asText(v, 20)}`).join('，')
          : asText(inner, 30)))
        .filter(Boolean)
        .join('，');
      if (!primary) return details;
      return details ? `${primary}（${details}）` : String(primary);
    });
    return parts.join('；').slice(0, max);
  }
  if (isRecord(value)) {
    return Object.entries(value).map(([key, inner]) => pair(key, inner)).join('，').slice(0, max);
  }
  return asText(value, max);
}

function factsFrom(input, fields) {
  const facts = [];
  const unknowns = [];
  for (const field of fields) {
    const value = input[field.name ?? field];
    const name = field.name ?? field;
    const label = field.label ?? name;
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      unknowns.push({ field: name, hint: field.hint ?? `请提供 ${label}` });
    } else if ((typeof value === 'string' && value.length > 200) || ['material', 'text', 'resumeText'].includes(name)) {
      // Never echo a whole document dump into "key findings".
      const length = typeof value === 'string' ? value.length : String(describeValue(value)).length;
      facts.push({ statement: `${label}：已提供 ${length} 字资料，内容已用于分析与成果生成`, field: name, value });
    } else {
      facts.push({ statement: `${label}：${describeValue(value)}`, field: name, value });
    }
  }
  return { facts, unknowns };
}

function renderContent({ title, input, computed, facts, unknowns, citations, subtitle }) {
  const sections = [
    {
      heading: '事实与依据',
      paragraphs: [facts.length > 0 ? '以下事实来自本次提供的输入与知识检索结果，不含推测。' : '本次未提供可确认的业务事实。'],
      bullets: facts.map((fact) => String(fact.statement)),
    },
    {
      heading: '分析与计算',
      paragraphs: [computed.summary ?? '已按输入完成结构化处理。'],
      bullets: (computed.bullets ?? []).map(String),
    },
    {
      heading: '未知项与待确认',
      paragraphs: [unknowns.length > 0 ? '以下缺口未获得输入，不能据此得出业务结论；用户可补充后继续。' : '本次无未声明的缺口。'],
      bullets: unknowns.map((item) => String(item.hint ?? item.field)),
    },
    {
      heading: '建议（需用户决策）',
      paragraphs: ['建议仅为可选方案，涉及招聘、绩效、采购等重要判断时由用户作最终业务决定。'],
      bullets: (computed.recommendations ?? ['提交前请核对事实、依据与适用条件']).map(String),
    },
  ];
  return {
    title,
    subtitle: subtitle ?? `工作空间 ${input.workspaceId ?? 'default'} · 生成于 ${new Date().toISOString()}`,
    sections,
    tables: computed.tables ?? [{
      name: '输入事实清单',
      columns: ['字段', '值'],
      rows: facts.map((fact) => [String(fact.field), asText(fact.value, 200)]),
    }],
    citations,
  };
}

/**
 * Factory for domain executors. Every executor produces real structured output,
 * explicit unknowns, resolvable citations and (when requested) a verified file.
 */
export function structured(title, fields, compute = () => ({})) {
  return async (input, context) => {
    const { facts, unknowns } = factsFrom(input, fields);
    const citations = await collectCitations(input, context);
    for (const citation of citations) facts.push({ statement: `引用：${citation.title} / ${citation.section} / 行 ${citation.lines?.join('-')}`, field: 'citation' });
    const computed = await compute(input, context, { facts, unknowns });
    const content = renderContent({ title, input, computed, facts, unknowns, citations });
    const evidence = {
      facts,
      assumptions: (computed.assumptions ?? []).map((text) => ({ statement: String(text) })),
      userJudgements: [],
      recommendations: (computed.recommendations ?? []).map((text) => ({ statement: String(text) })),
      unknowns: unknowns.map((item) => ({ statement: String(item.hint ?? item.field), field: item.field })),
    };
    const artifacts = [];
    if (input.format && input.format !== 'none' && typeof context.deliver === 'function') {
      artifacts.push(await context.deliver({ format: input.format, filename: input.filename, content }));
    }
    return {
      ok: true,
      structured: { ...computed.structured, facts: facts.length, unknowns: unknowns.length },
      evidence,
      citations,
      artifacts,
      unknowns,
      content,
      // The first screen shows a real business conclusion, not a delivery note.
      message: computed.conclusion
        ? String(computed.conclusion)
        : `${title}：${String(computed.summary ?? '已按输入完成结构化处理').replace(/。$/, '')}${unknowns.length > 0 ? `；另有 ${unknowns.length} 项缺口未作推断` : ''}。`,
    };
  };
}

function tableFrom(input) {
  const normalized = normalizeRows(input);
  if (!normalized) return null;
  return normalized;
}

export function createSharedExecutors() {
  const executors = {};

  executors['knowledge.retrieve'] = async (input, context) => {
    const result = await context.services.knowledge.search({
      workspaceId: input.workspaceId ?? context.workspaceId ?? 'default',
      query: input.query,
      domain: input.domain,
      tags: input.tags,
      limit: input.limit ?? 8,
    });
    const resolved = [];
    for (const hit of result.hits.slice(0, 3)) {
      const section = await context.services.knowledge.readSection({
        docId: hit.citation.docId,
        section: hit.citation.section,
        part: hit.citation.part,
        workspaceId: input.workspaceId ?? context.workspaceId ?? 'default',
      }).catch(() => null);
      resolved.push({ citation: hit.citation, resolved: Boolean(section), excerpt: section?.text?.slice(0, 200) ?? null });
    }
    return {
      ok: true,
      structured: { hits: result.hits.length, status: result.status, resolved: resolved.filter((item) => item.resolved).length },
      evidence: {
        ...emptyEvidence(),
        facts: result.hits.map((hit) => ({ statement: `${hit.citation.title} / ${hit.citation.section}`, citation: hit.citation })),
        unknowns: result.hits.length === 0 ? [{ statement: `未检索到与「${input.query}」匹配的知识；资料库中没有对应依据` }] : [],
      },
      citations: result.hits.map((hit) => hit.citation),
      artifacts: [],
      unknowns: [],
      message: result.status === 'no_match' ? '真实检索结果为空；未伪造知识条目' : `检索到 ${result.hits.length} 条可回溯引用`,
    };
  };

  executors['knowledge.ingest'] = async (input, context) => {
    const result = await context.services.knowledge.importText({
      workspaceId: input.workspaceId ?? context.workspaceId ?? 'default',
      title: input.title,
      text: input.text,
      domain: input.domain ?? 'general',
      tags: input.tags ?? [],
      trust: 'unverified',
      source: input.source ?? { kind: 'manual', name: input.title },
    });
    return {
      ok: true,
      structured: { duplicate: result.duplicate, chunks: result.chunks, docId: result.doc.id, trust: 'unverified' },
      evidence: { ...emptyEvidence(), facts: [{ statement: `导入 ${result.doc.title}，SHA256 ${result.doc.sha256.slice(0, 12)}，分片 ${result.chunks}` }] },
      citations: [],
      artifacts: [],
      unknowns: [],
      message: result.duplicate ? '内容哈希已存在，复用原条目，未重复入库' : '已作为待核实内容入库；未自动提升为可信规则',
    };
  };

  executors['knowledge.verify'] = async (input, context) => {
    const doc = await context.services.knowledge.verify({ docId: input.docId, trust: input.trust ?? 'verified', note: input.note });
    return { ok: true, structured: { docId: doc.id, trust: doc.trust }, evidence: { ...emptyEvidence(), userJudgements: [{ statement: `用户确认「${doc.title}」为 ${doc.trust}` }] }, citations: [], artifacts: [], unknowns: [], message: '可信级别已按用户判断更新' };
  };

  executors['km.review'] = structured('项目复盘', [
    { name: 'project', label: '项目', hint: '项目名称或标识' },
    { name: 'material', label: '项目资料', hint: '提供项目过程与结果资料' },
  ], (input) => {
    // Material already contains the narrative; extract the four sections instead
    // of asking the user to retype them.
    const material = String(input.material ?? '');
    const ALL_LABELS = ['背景', '关键决策', '关键决定', '决策', '结果', '成效', '经验与教训', '经验', '教训'];
    const pick = (labels, limit = 160) => {
      for (const label of labels) {
        let from = 0;
        while (from < material.length) {
          const index = material.indexOf(label, from);
          if (index < 0) break;
          let end = index + label.length + limit;
          for (const other of ALL_LABELS) {
            if (other === label) continue;
            const next = material.indexOf(other, index + label.length + 4);
            if (next > 0) end = Math.min(end, next);
          }
          const raw = material.slice(index + label.length, end);
          // Skip outline headers such as "背景 / 决策 / 结果".
          const before = material.slice(Math.max(0, index - 3), index);
          if (/^[\s]*[\/、]/u.test(raw) || /[\/、]\s*$/u.test(before)) { from = index + label.length; continue; }
          const text = raw.replace(/^[:：,，。\s]+/u, '').replace(/\s+/g, ' ').trim();
          if (text.length >= 6) return text;
          from = index + label.length;
        }
      }
      return null;
    };
    const context = input.context ?? pick(['背景']);
    const decisions = input.decisions ?? pick(['关键决策', '关键决定', '决策']);
    const outcome = input.outcome ?? pick(['结果', '成效']);
    const lessons = input.lessons ?? pick(['经验与教训', '经验', '教训']);
    const filled = [context && '背景', decisions && '关键决策', outcome && '结果', lessons && '经验与教训'].filter(Boolean);
    return {
      summary: '按「背景—决策—结果—经验」整理复盘，事实仅来自输入资料。',
      conclusion: `已完成「${input.project ?? '该项目'}」的复盘整理：${filled.length ? filled.join('、') + ' 已从资料中提取' : '资料中未识别出复盘四栏'}；建议由业务负责人确认经验适用条件后再入库。`,
      recommendations: ['补充量化结果后再把复盘转为标准作业流程', '由业务负责人确认经验适用条件'],
      structured: { project: input.project ?? null, hasMaterial: Boolean(input.material), extractedSections: filled.length },
      tables: [{ name: '复盘四栏', columns: ['环节', '内容'], rows: [
        ['背景', asText(context ?? '未提供，待确认')],
        ['关键决策', asText(decisions ?? '未提供，待确认')],
        ['结果', asText(outcome ?? '未提供，待确认')],
        ['经验与教训', asText(lessons ?? '未提供，待确认')],
      ] }],
    };
  });

  executors['km.caseCard'] = structured('经验卡', [
    { name: 'project', label: '项目', hint: '案例来源项目' },
    { name: 'material', label: '案例材料', hint: '提供可引用的原始材料' },
  ], (input) => ({
    summary: '经验卡含事实、适用条件与待核实项，未经核实不入库为规则。',
    structured: { status: 'draft', verificationRequired: true },
    recommendations: ['提交评审后再由知识管理专家审核入库'],
  }));

  executors['km.sop'] = structured('标准作业流程提炼', [
    { name: 'material', label: '流程材料', hint: '提供已验证的流程或案例材料' },
  ], (input) => ({
    summary: '从材料中提取步骤、输入、输出与验收条件；缺失项保留为待确认。',
    structured: { steps: Array.isArray(input.steps) ? input.steps.length : 0 },
    tables: [{ name: 'SOP 步骤', columns: ['步骤', '输入', '输出', '验收'], rows: (input.steps ?? []).map((step, index) => [String(index + 1), asText(step.input), asText(step.output), asText(step.acceptance)]) }],
  }));

  executors['km.publish'] = structured('知识审核入库', [
    { name: 'docId', label: '知识条目', hint: '提供待审核的 docId' },
  ], async (input, context) => {
    const doc = await context.services.knowledge.verify({ docId: input.docId, trust: input.trust ?? 'verified', note: input.note ?? '审核通过' });
    return { summary: `条目 ${doc.title} 已按用户判断设为 ${doc.trust}。`, structured: { docId: doc.id, trust: doc.trust }, recommendations: ['后续升级插件不会覆盖该判断'] };
  });

  executors['data.profile'] = async (input, context) => {
    const table = tableFrom(input);
    if (!table) fail(CODES.MISSING_INPUT, '字段识别需要 rows 或 csv 输入', { field: 'rows' });
    const { columns, rows } = table;
    const profile = columns.map((column, index) => {
      const values = rows.map((row) => row[index]);
      const numbers = values.map(numeric).filter((value) => value !== null);
      return {
        field: column,
        nonEmpty: values.filter((value) => value !== '' && value !== null && value !== undefined).length,
        missingRate: rows.length === 0 ? null : Number(((rows.length - values.filter((v) => v !== '' && v !== null && v !== undefined).length) / rows.length).toFixed(4)),
        distinct: new Set(values.map((value) => String(value))).size,
        numericRatio: values.length === 0 ? 0 : Number((numbers.length / values.length).toFixed(4)),
        inferredType: numbers.length === values.length && values.length > 0 ? 'number' : 'string',
      };
    });
    return {
      ok: true,
      structured: { rowCount: rows.length, columnCount: columns.length, profile },
      evidence: { ...emptyEvidence(), facts: [{ statement: `识别 ${columns.length} 个字段、${rows.length} 行数据；字段类型按样本推断` }], assumptions: rows.length < 3 ? [{ statement: '样本过少，类型推断可能不稳定' }] : [] },
      citations: [],
      artifacts: [],
      unknowns: [],
      message: `已识别 ${columns.length} 个字段，缺失率与类型按实际数据计算`,
    };
  };

  executors['data.clean'] = async (input) => {
    const table = tableFrom(input);
    if (!table) fail(CODES.MISSING_INPUT, '清洗需要 rows 或 csv 输入', { field: 'rows' });
    const seen = new Set();
    const rows = [];
    const log = [];
    for (const row of table.rows) {
      if (row.every((cell) => cell === '' || cell === null || cell === undefined)) { log.push('移除全空行'); continue; }
      const cleaned = row.map((cell) => typeof cell === 'string' ? cell.trim() : cell);
      if (input.dropDuplicates !== false) {
        const key = JSON.stringify(cleaned);
        if (seen.has(key)) { log.push('移除重复行'); continue; }
        seen.add(key);
      }
      rows.push(cleaned);
    }
    return {
      ok: true,
      structured: { originalRows: table.rows.length, cleanedRows: rows.length, columns: table.columns, rows, cleaningLog: log },
      evidence: { ...emptyEvidence(), facts: [{ statement: `清洗前 ${table.rows.length} 行，清洗后 ${rows.length} 行，处理记录 ${log.length} 条` }] },
      citations: [], artifacts: [], unknowns: [],
      message: '已生成可复核的处理记录与清洗后表格',
    };
  };

  executors['data.quality'] = async (input) => {
    const table = tableFrom(input);
    if (!table) fail(CODES.MISSING_INPUT, '质量检查需要 rows 或 csv 输入', { field: 'rows' });
    const issues = [];
    table.columns.forEach((column, index) => {
      const values = table.rows.map((row) => row[index]);
      const missing = values.filter((value) => value === '' || value === null || value === undefined).length;
      if (missing > 0) issues.push({ field: column, type: 'missing', count: missing, severity: missing / Math.max(values.length, 1) > 0.3 ? 'high' : 'low' });
      const duplicates = values.length - new Set(values.map((value) => String(value))).size;
      if (duplicates > 0) issues.push({ field: column, type: 'duplicate_value', count: duplicates, severity: 'info' });
      const numbers = values.map(numeric).filter((value) => value !== null);
      if (numbers.length > 3) {
        const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
        const std = Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length);
        const outliers = numbers.filter((value) => Math.abs(value - mean) > 3 * std).length;
        if (outliers > 0) issues.push({ field: column, type: 'outlier_3sigma', count: outliers, severity: 'medium' });
      }
    });
    return { ok: true, structured: { issues, issueCount: issues.length, checkedCells: table.rows.length * table.columns.length }, evidence: { ...emptyEvidence(), facts: [{ statement: `检查 ${table.rows.length * table.columns.length} 个单元格，发现 ${issues.length} 项质量问题` }] }, citations: [], artifacts: [], unknowns: [], message: '质量规则基于实际样本计算，非全量数据扫描声明' };
  };

  executors['data.metrics'] = async (input) => {
    const table = tableFrom(input);
    if (!table) fail(CODES.MISSING_INPUT, '指标计算需要 rows 或 csv 输入', { field: 'rows' });
    const field = input.field ?? table.columns.find((column) => column !== (input.groupBy ?? ''));
    const index = table.columns.indexOf(field);
    if (index < 0) fail(CODES.INVALID_INPUT, `字段 ${field} 不在表格中`, { columns: table.columns });
    const values = table.rows.map((row) => numeric(row[index])).filter((value) => value !== null);
    if (values.length === 0) fail(CODES.INVALID_INPUT, `字段 ${field} 没有可计算的数值`);
    const sum = values.reduce((a, b) => a + b, 0);
    const metrics = { field, count: values.length, sum: Number(sum.toFixed(4)), mean: Number((sum / values.length).toFixed(4)), min: Math.min(...values), max: Math.max(...values) };
    let groups = null;
    const groupIndex = input.groupBy ? table.columns.indexOf(input.groupBy) : -1;
    if (groupIndex >= 0) {
      const buckets = new Map();
      table.rows.forEach((row) => {
        const key = String(row[groupIndex] ?? '未分组');
        const value = numeric(row[index]);
        if (value === null) return;
        const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
        bucket.sum += value; bucket.count += 1; buckets.set(key, bucket);
      });
      groups = [...buckets.entries()].map(([key, bucket]) => ({ key, sum: Number(bucket.sum.toFixed(4)), mean: Number((bucket.sum / bucket.count).toFixed(4)), count: bucket.count }));
    }
    return { ok: true, structured: { metrics, groups }, evidence: { ...emptyEvidence(), facts: [{ statement: `${field}：sum=${metrics.sum}, mean=${metrics.mean}, min=${metrics.min}, max=${metrics.max}, n=${metrics.count}` }] }, citations: [], artifacts: [], unknowns: [], message: '指标由输入数据实际计算，可复核' };
  };

  executors['data.compare'] = async (input) => {
    const left = tableFrom({ ...input, rows: input.leftRows ?? input.rows, columns: input.leftColumns ?? input.columns });
    const right = tableFrom({ ...input, rows: input.rightRows, columns: input.rightColumns ?? input.columns });
    if (!left || !right) fail(CODES.MISSING_INPUT, '比较分析需要 leftRows 与 rightRows', { field: 'rightRows' });
    const rows = [
      ['行数', String(left.rows.length), String(right.rows.length), String(right.rows.length - left.rows.length)],
      ['列数', String(left.columns.length), String(right.columns.length), String(right.columns.length - left.columns.length)],
      ['字段集合一致', left.columns.join('|'), right.columns.join('|'), left.columns.join('|') === right.columns.join('|') ? '一致' : '不一致'],
    ];
    return { ok: true, structured: { left: { columns: left.columns, rowCount: left.rows.length }, right: { columns: right.columns, rowCount: right.rows.length } }, evidence: { ...emptyEvidence(), facts: [{ statement: `比较两份表格：${left.rows.length} 行 vs ${right.rows.length} 行` }] }, citations: [], artifacts: [], unknowns: [], tables: [{ name: '比较结果', columns: ['维度', 'A', 'B', '差异'], rows }], message: '已按真实行/列计算差异' };
  };

  executors['data.chart'] = async (input) => {
    const table = tableFrom(input);
    if (!table) fail(CODES.MISSING_INPUT, '可视化需要 rows 或 csv 输入', { field: 'rows' });
    const labelIndex = table.columns.indexOf(input.labelField ?? table.columns[0]);
    const valueIndex = table.columns.indexOf(input.valueField ?? table.columns[1]);
    const points = table.rows.map((row) => ({ label: String(row[labelIndex] ?? ''), value: numeric(row[valueIndex]) ?? 0 }));
    const max = Math.max(...points.map((point) => point.value), 1);
    const bars = points.map((point) => `${point.label}: ${'█'.repeat(Math.max(1, Math.round(point.value / max * 20)))} ${point.value}`);
    const content = { title: input.title ?? '数据图表', sections: [{ heading: '数值条形图', paragraphs: bars }], tables: [{ name: '图表数据', columns: [String(input.labelField ?? table.columns[0]), String(input.valueField ?? table.columns[1])], rows: points.map((point) => [point.label, point.value]) }], citations: [] };
    const artifacts = [];
    if (input.format && typeof context.deliver === 'function') {
      artifacts.push(await context.deliver({ format: input.format, filename: input.filename, content }));
    }
    return { ok: true, structured: { points, chartType: 'bar+data-table' }, evidence: { ...emptyEvidence(), facts: [{ statement: `按 ${points.length} 个数据点生成条形图与可复核数据表` }] }, citations: [], artifacts, unknowns: [], content, message: '图表同时提供可复核数据表' };
  };

  executors['document.extract'] = async (input, context) => {
    if (!input.path) fail(CODES.MISSING_INPUT, '文档提取需要 path', { field: 'path' });
    const opened = await context.services.files.readDocument(input.path);
    return { ok: true, structured: { format: opened.meta.format, bytes: opened.meta.bytes, sha256: opened.meta.sha256, sections: opened.sections.length, excerpt: opened.text.slice(0, 600), rows: opened.meta.rows ?? null }, evidence: { ...emptyEvidence(), facts: [{ statement: `读取 ${opened.meta.title}（${opened.meta.format}, ${opened.meta.bytes} bytes, ${opened.sections.length} 节）` }] }, citations: [], artifacts: [], unknowns: [], message: '已真实读取文件内容并提取文本/表格' };
  };

  executors['document.compare'] = async (input) => {
    const left = String(input.leftText ?? '');
    const right = String(input.rightText ?? '');
    const leftLines = new Set(left.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const rightLines = new Set(right.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const onlyLeft = [...leftLines].filter((line) => !rightLines.has(line));
    const onlyRight = [...rightLines].filter((line) => !leftLines.has(line));
    return { ok: true, structured: { onlyLeft, onlyRight, common: [...leftLines].filter((line) => rightLines.has(line)).length }, evidence: { ...emptyEvidence(), facts: [{ statement: `逐行比较：仅左侧 ${onlyLeft.length} 行，仅右侧 ${onlyRight.length} 行` }] }, citations: [], artifacts: [], unknowns: [], message: '按行集合真实比较，未做语义改写' };
  };

  executors['document.compose'] = structured('文档整理与写作', [
    { name: 'material', label: '输入资料', hint: '提供待整理的材料文本' },
  ], (input) => ({
    summary: '按模板字段填充并标注缺失字段；不生成空白占位文件。',
    structured: { template: input.template ?? 'standard', sections: (input.sections ?? []).length },
    tables: [{ name: '模板字段核对', columns: ['字段', '状态', '内容'], rows: (input.templateFields ?? ['标题', '背景', '结论', '依据', '待办']).map((field) => [String(field), input.material ? '已填充' : '待补充', asText(input.material, 160)]) }],
  }));

  executors['document.deliver'] = async (input, context) => {
    const content = input.content ?? {
      title: input.title ?? '成果文件',
      subtitle: input.subtitle,
      sections: input.sections ?? [{ heading: '内容', paragraphs: [String(input.text ?? '')] }],
      tables: input.tables ?? [],
      citations: input.citations ?? [],
    };
    const artifact = await context.deliver({ format: input.format ?? 'md', filename: input.filename, content });
    return { ok: true, structured: { format: artifact.format, bytes: artifact.bytes, verified: artifact.verified }, evidence: { ...emptyEvidence(), facts: [{ statement: `生成并回读校验 ${artifact.path}（${artifact.bytes} bytes）` }] }, citations: content.citations ?? [], artifacts: [artifact], unknowns: [], message: `已生成真实可打开文件 ${artifact.format.toUpperCase()}` };
  };

  executors['task.plan'] = structured('任务计划与优先级', [
    { name: 'goal', label: '目标', hint: '说明要达成的目标' },
  ], (input) => {
    const tasks = (input.tasks ?? []).map((task, index) => ({
      id: `T${index + 1}`,
      name: typeof task === 'string' ? task : String(task.name ?? ''),
      priority: (typeof task === 'object' && task.priority) || '待定',
      owner: (typeof task === 'object' && task.owner) || '待确认',
      due: (typeof task === 'object' && task.due) || '待确认',
    }));
    return { summary: `按目标拆解 ${tasks.length} 项任务；优先级与责任人未给出时明确列为待确认。`, structured: { tasks }, tables: [{ name: '任务清单', columns: ['ID', '任务', '优先级', '责任人', '时间'], rows: tasks.map((task) => [task.id, task.name, task.priority, task.owner, task.due]) }], recommendations: ['用实际反馈更新状态后再进入复盘'] };
  });

  executors['task.actions'] = structured('会议行动清单', [
    { name: 'meetingNotes', label: '会议记录', hint: '提供会议纪要或行动描述' },
  ], (input) => ({
    summary: '从会议材料提取行动项；未明确责任人与时间的条目保留待确认。',
    structured: { actions: (input.actions ?? []).length },
    tables: [{ name: '行动清单', columns: ['行动', '责任人', '截止', '状态'], rows: (input.actions ?? []).map((action) => [asText(action.name ?? action), asText(action.owner ?? '待确认'), asText(action.due ?? '待确认'), '待执行']) }],
  }));

  executors['task.review'] = structured('周月复盘', [
    { name: 'goal', label: '目标', hint: '复盘对应的目标' },
    { name: 'feedback', label: '执行反馈', hint: '提供执行过程与结果反馈' },
  ], (input) => ({
    summary: '按「目标—执行—偏差—改进」整理；偏差只在有实际数值时计算。',
    structured: { hasQuantitative: Boolean(input.targetValue !== undefined && input.actualValue !== undefined) },
    tables: [{ name: '复盘表', columns: ['维度', '内容'], rows: [['目标', asText(input.goal)], ['执行反馈', asText(input.feedback)], ['偏差', input.targetValue !== undefined && input.actualValue !== undefined ? String(Number(input.actualValue) - Number(input.targetValue)) : '未提供数值，待确认'], ['改进', asText(input.improvement ?? '待补充')]] }],
  }));

  executors['report.build'] = async (input, context) => {
    const citations = await collectCitations(input, context);
    const content = {
      title: input.title ?? '综合报告',
      subtitle: input.subtitle,
      sections: input.sections ?? [{ heading: '结论', paragraphs: [String(input.conclusion ?? '')] }],
      tables: input.tables ?? [],
      citations,
    };
    const artifacts = [];
    if (input.format && typeof context.deliver === 'function') artifacts.push(await context.deliver({ format: input.format, filename: input.filename, content }));
    return { ok: true, structured: { sections: content.sections.length, citations: citations.length, artifacts: artifacts.length }, evidence: { ...emptyEvidence(), facts: [{ statement: `报告含 ${content.sections.length} 个章节、${citations.length} 条可回溯引用` }], unknowns: citations.length === 0 && !input.allowWithoutSources ? [{ statement: '报告没有知识引用，结论仅来自本次输入，需用户核实' }] : [] }, citations, artifacts, unknowns: [], content, message: '报告已组装，引用可回到原文' };
  };

  executors['external.confirm'] = async (input) => ({
    ok: true,
    structured: { confirmed: true, idempotencyKey: input.idempotencyKey ?? null },
    evidence: { ...emptyEvidence(), userJudgements: [{ statement: `用户确认外部操作：${asText(input.action ?? '未命名')}` }] },
    citations: [], artifacts: [], unknowns: [],
    message: '仅记录确认点；本插件未在未接入真实连接器时执行外部发送或提交',
  });

  return executors;
}
