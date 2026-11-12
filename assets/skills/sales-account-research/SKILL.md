---
name: sales-account-research
description: 基于用户提供的资料整理客户概况、关键角色、证据缺口和下一步调研任务。
whenToUse: 用户需要研究企业或政企客户，并区分事实、判断与未知项时。
executor: sales.accountResearch
version: 1.0.0
invocation:
  modelInvocable: true
  userInvocable: true
inputs:
  - name: customer
    hint: 客户名称
    required: true
    type: string
  - name: material
    hint: 客户资料
    required: true
    type: string
outputs:
  - 客户研究摘要
  - 关键角色与证据
  - 待核实项和下一步
steps:
  - 读取用户提供的客户资料
  - 提取可验证事实与来源
  - 标注关键角色、影响与未知项
  - 形成下一步调研清单
acceptance:
  - 不把推测写成事实
  - 关键结论能回到输入证据
  - 未知项和建议动作分开呈现
resources: []
---

# 客户研究

只使用用户提供的资料和已接入的可信来源。先列事实，再写判断；没有证据的组织关系、预算、立场和决策权必须标为待核实。

输出优先回答三个问题：客户当前发生了什么、哪些角色会影响决策、下一步最值得验证什么。避免为了显得完整而补造客户背景。
