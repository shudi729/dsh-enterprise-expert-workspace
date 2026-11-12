---
name: research-verify
description: 逐条核验结论的来源与证据
whenToUse: 逐条核验结论的来源与证据
executor: research.verify
version: 1.0.0
invocation:
  modelInvocable: true
  userInvocable: true
inputs:
  - name: claims
    hint: 待核验结论
    required: true
    type: string
outputs:
  - 结构化结果
  - 依据与未知项
  - 可选成果文件
steps:
  - 校验必要输入
  - 读取知识/工具
  - 执行计算或整理
  - 分离事实与未知
  - 生成并校验成果
acceptance:
  - 事实、假设、建议、待核实项分离
  - 引用可回到原文
  - 成果文件真实可打开
resources: []
---

# research-verify

逐条核验结论的来源与证据

## 执行步骤

1. 校验必要输入
2. 读取知识/工具
3. 执行计算或整理
4. 分离事实与未知
5. 生成并校验成果

## 验收条件

- 事实、假设、建议、待核实项分离
- 引用可回到原文
- 成果文件真实可打开

> executor: `research.verify`。本文件由 capabilities/catalog.js 生成；执行逻辑在 src/core/executors-*.js。
