---
name: sales-opportunity-card
description: 把客户、阶段、需求、角色、证据和下一步整理成可持续更新的商机行动卡。
whenToUse: 用户需要判断一个商机是否值得投入、卡在哪里以及下一步做什么时。
executor: sales.opportunityCard
version: 1.0.0
invocation:
  modelInvocable: true
  userInvocable: true
inputs:
  - name: customer
    hint: 客户名称
    required: true
    type: string
outputs:
  - 商机状态
  - 已知事实与关键缺口
  - 下一步行动和验收信号
steps:
  - 识别客户和当前阶段
  - 汇总需求、角色与流程证据
  - 标注风险、未知项和竞争条件
  - 给出一个优先行动及验收信号
acceptance:
  - 结论不超过证据边界
  - 行动包含负责人、时间或可观察信号
  - 不以关系猜测替代正式决策流程
resources: []
---

# 商机行动卡

商机卡是可更新的业务记录，不是一次性建议。每次更新都保留已有事实，明确新信息改变了什么，并将行动收敛到最需要验证的一步。

如果预算、决策角色、采购流程或业务价值没有证据，直接列为未知项；不要据此给出无条件的赢单判断。
