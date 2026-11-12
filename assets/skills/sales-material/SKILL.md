---
name: sales-material
description: 根据客户事实和目标生成结构清楚、可核对的销售沟通或方案材料。
whenToUse: 用户需要把客户资料整理成汇报、沟通、方案或复盘材料时。
executor: sales.material
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
    hint: 素材与证据
    required: true
    type: string
outputs:
  - 客户问题与目标
  - 证据化判断
  - 建议行动或材料正文
steps:
  - 明确材料的读者和目标
  - 从输入中提取事实与限制
  - 组织问题、影响、方案和下一步
  - 校验敏感承诺和未证实结论
acceptance:
  - 内容能回到用户输入
  - 事实、假设和建议分开
  - 不承诺未经确认的价格、效果或交期
resources: []
---

# 销售材料

先明确读者要做什么决定，再组织材料。每一项结论尽量对应事实或来源；不能核实的数字、客户立场和交付承诺必须显式标注。

材料应简洁、可修改，并以清楚的下一步收尾，而不是堆叠销售术语。
