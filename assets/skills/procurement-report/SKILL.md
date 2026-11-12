---
name: procurement-report
description: 采购评估报告
whenToUse: 采购评估报告
executor: procurement.report
version: 1.0.0
invocation:
  modelInvocable: true
  userInvocable: true
inputs:
  - name: quotes
    hint: 报价比较结果
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

# procurement-report

采购评估报告

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

> executor: `procurement.report`。本文件由 capabilities/catalog.js 生成；执行逻辑在 src/core/executors-*.js。
