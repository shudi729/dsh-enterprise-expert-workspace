#!/usr/bin/env node
/** Verify that the capability matrix, catalog, shipped skills and executors agree. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { experts, skills, workflows } from '../capabilities/catalog.js';
import { listExecutorNames } from '../src/core/executors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };

const matrix = JSON.parse(await readFile(path.join(ROOT, 'capabilities', 'matrix.json'), 'utf8'));
const executors = new Set(listExecutorNames());
const skillByName = new Map(skills.map((item) => [item.name, item]));
let shippedDirs = [];
try { shippedDirs = await readdir(path.join(ROOT, 'assets', 'skills'), { withFileTypes: true }); } catch { problems.push('assets/skills 不存在，请先运行 npm run assets:index'); }

check(experts.length === 10, `专家数量应为 10，实际 ${experts.length}`);
check(new Set(experts.map((item) => item.id)).size === 10, '专家 id 重复');
check(matrix.experts.length === experts.length, '矩阵专家数量与 catalog 不一致');

for (const expert of experts) {
  check(expert.skills.length > 0, `${expert.id} 没有技能`);
  check((expert.acceptance ?? []).length > 0, `${expert.id} 缺少验收条件`);
  const row = matrix.experts.find((item) => item.expertId === expert.id);
  check(Boolean(row), `矩阵缺少 ${expert.id}`);
  if (row) check(JSON.stringify(row.skills) === JSON.stringify(expert.skills.map((name) => skillByName.get(name)?.executor ?? null)), `${expert.id} 矩阵技能与 catalog 不一致`);
  for (const name of expert.skills) {
    const definition = skillByName.get(name);
    check(Boolean(definition), `${expert.id} 引用了未定义技能 ${name}`);
    if (!definition) continue;
    check(executors.has(definition.executor), `${name} 的执行器 ${definition.executor} 未注册`);
    check(definition.inputs.length > 0, `${name} 没有输入定义`);
    check(definition.steps.length > 0 && definition.acceptance.length > 0, `${name} 缺少步骤或验收条件`);
  }
  const flows = workflows.filter((flow) => flow.expertId === expert.id);
  check(flows.length > 0, `${expert.id} 没有代表性流程`);
}

for (const skill of skills) {
  check(executors.has(skill.executor), `${skill.name}: 执行器 ${skill.executor} 不存在`);
  check(/^[a-z0-9][a-z0-9-]{1,63}$/.test(skill.name), `${skill.name}: 名称不合法`);
  const shipped = shippedDirs.some((entry) => entry.isDirectory() && entry.name === skill.name);
  check(shipped, `${skill.name}: 缺少随包 SKILL.md 目录`);
}
for (const flow of workflows) {
  check(flow.input.length > 0, `${flow.id} 缺少输入定义`);
  check(flow.nodes.length >= 2, `${flow.id} 节点不足`);
  check(flow.acceptance.length > 0, `${flow.id} 缺少验收条件`);
  for (const node of flow.nodes) {
    if (node.skill) check(skillByName.has(node.skill), `${flow.id}.${node.id} 引用了未定义技能 ${node.skill}`);
    for (const required of node.requires ?? []) check(flow.nodes.some((item) => item.id === required), `${flow.id}.${node.id} 依赖不存在的节点 ${required}`);
  }
}
check(workflows.filter((flow) => flow.id.startsWith('cross-')).length >= 3, '跨领域链路少于 3 条');

const report = {
  ok: problems.length === 0,
  experts: experts.length,
  skills: skills.length,
  executors: executors.size,
  workflows: workflows.length,
  shippedSkillDirs: shippedDirs.filter((entry) => entry.isDirectory()).length,
  problems,
};
console.log(JSON.stringify(report, null, 2));
if (problems.length > 0) process.exitCode = 1;
