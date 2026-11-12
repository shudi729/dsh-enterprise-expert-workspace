/** Register the catalog as real, model-invocable DSH skills (prefixed to avoid collisions). */
function skillContent(skill) {
  const inputs = skill.inputs.map((item) => `- \`${item.name}\`${item.required ? '（必填）' : '（可选）'}：${item.hint}`).join('\n');
  return [
    `# 企业 AI 专家工作台 · ${skill.name}`,
    '',
    skill.description,
    '',
    '## 调用方式（真实执行，不是提示词）',
    '',
    '优先使用 Agent 工具 `eew_dispatch`；若该工具未注册，调用 Host API `POST /eew/skill/run`。',
    '',
    '```json',
    JSON.stringify({ name: skill.name, input: { workspaceId: 'default' }, format: 'md' }, null, 2),
    '```',
    '',
    `- 执行器：\`${skill.executor}\`（代码位于 src/core/executors-*.js）`,
    '- 执行器会返回结构化结果、事实/假设/建议/待核实项、可回溯引用与真实文件。',
    '- 资料不足时返回 `needs_input` 并列出缺口，不会伪造结论。',
    '',
    '## 必要输入',
    '',
    inputs || '- 无',
    '',
    '## 输出与验收',
    '',
    ...skill.outputs.map((item) => `- ${item}`),
    ...skill.acceptance.map((item) => `- 验收：${item}`),
  ].join('\n');
}

export function registerSkills(skillCtx, catalog) {
  const disposers = [];
  const failures = [];
  for (const skill of catalog.skills) {
    try {
      disposers.push(skillCtx.skills.register({
        name: `eew-${skill.name}`,
        description: `[企业AI专家工作台/${skill.domain}] ${skill.description}`,
        content: skillContent(skill),
        whenToUse: skill.whenToUse,
        source: 'runtime',
        invocation: { modelInvocable: true, userInvocable: true },
      }));
    } catch (error) {
      failures.push({ name: skill.name, message: error?.message ?? String(error) });
    }
  }
  for (const expert of catalog.experts) {
    try {
      disposers.push(skillCtx.skills.register({
        name: `eew-expert-${expert.id}`,
        description: `[企业AI专家工作台/专家] ${expert.name}：${expert.scenarios.join('、')}`,
        content: [
          `# ${expert.name}`,
          '',
          `可处理场景：${expert.scenarios.join('、')}`,
          '',
          '真实能力（不是角色提示词）：',
          ...expert.skills.map((name) => `- \`${name}\` → \`eew-${name}\``),
          '',
          '调用方式：`eew_dispatch` 工具，或 `POST /eew/dispatch`：',
          '```json',
          JSON.stringify({ goal: '用户目标', expertId: expert.id, skillName: expert.skills[0], input: {}, format: 'md' }, null, 2),
          '```',
          '',
          `交付形式：${expert.deliverables.join('、')}`,
          `验收条件：${expert.acceptance.join('；')}`,
        ].join('\n'),
        source: 'runtime',
        invocation: { modelInvocable: true, userInvocable: true },
      }));
    } catch (error) {
      failures.push({ name: `expert:${expert.id}`, message: error?.message ?? String(error) });
    }
  }
  return {
    registered: disposers.length,
    failures,
    dispose() {
      for (const dispose of disposers) {
        try { if (typeof dispose === 'function') dispose(); } catch { /* teardown race */ }
      }
    },
  };
}
