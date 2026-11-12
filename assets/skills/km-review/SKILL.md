---
name: km-review
description: 项目资料复盘：背景、决策、结果、经验
whenToUse: 项目资料复盘：背景、决策、结果、经验
executor: km.review
version: 1.0.0
invocation:
  modelInvocable: true
  userInvocable: true
inputs:
  - name: project
    hint: 项目名称
    required: true
    type: string
  - name: material
    hint: 项目资料
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

# km-review

项目资料复盘：背景、决策、结果、经验

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

> executor: `km.review`。本文件由 capabilities/catalog.js 生成；执行逻辑在 src/core/executors-*.js。
