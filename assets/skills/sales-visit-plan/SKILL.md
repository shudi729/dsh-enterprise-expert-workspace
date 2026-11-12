---
name: sales-visit-plan
description: 为客户拜访设计目标、问题、资料准备、角色分工和会后验收信号。
whenToUse: 用户即将拜访客户，需要一份可执行且不过度假设的会面计划时。
executor: sales.visitPlan
version: 1.0.0
invocation:
  modelInvocable: true
  userInvocable: true
inputs:
  - name: customer
    hint: 客户名称
    required: true
    type: string
  - name: objective
    hint: 拜访目标
    required: false
    type: string
outputs:
  - 会面目标
  - 问题与资料清单
  - 会后行动和进展信号
steps:
  - 根据已有事实确定一个主目标
  - 设计用于核实需求和流程的问题
  - 准备必要材料与团队分工
  - 设定可观察的会后进展信号
acceptance:
  - 目标具体且可验证
  - 问题不诱导客户泄露不当信息
  - 会后行动有明确责任和时点
resources: []
---

# 客户拜访计划

一次拜访只设一个主目标。问题用于核实客户事实、需求、参与角色和下一步流程，不通过绕过联系人或索取保密信息制造进展。

会后以可观察信号判断是否推进，例如客户确认下一次会议、补充资料或明确评估流程；“感觉良好”不算进展证据。
