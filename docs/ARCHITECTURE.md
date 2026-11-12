# 架构说明

## Bundle 入口

插件由 Host 与 Web Client 两部分组成：

- `package.json` 用 `dsh.bundle.patch` 指向 `cordis.patch.yml`，并声明 Web 客户端注入依赖。
- `cordis.patch.yml` 将包模块插入 DSH Host 配置。
- `index.js` 注册 Host：HTTP 路由、工具、Skill、模型适配、任务状态、知识、工作流和成果交付。
- `client.js` 通过 DSH 客户端模块加载器注册“企业 AI 专家工作台”侧栏与页面。

Host 是权限、数据和执行边界；Client 只负责交互，不在浏览器中直接读取本机路径或代替 Host 解析上传文件。

## 核心链路

```text
用户目标/场景
  → 上传或录入资料
  → 必要字段与权限检查
  → Skill / Workflow 路由
  → 确定性计算与模型分析
  → 结论、依据、待确认项
  → 文件生成与回读校验
  → 任务、成果与知识持久化
```

任务状态、输入指纹和幂等键由 Host 管理。相同提交重试不会重复创建任务；资料、参数或输出格式变化会形成独立工作。计算结果与模型结论分开保存，冲突时任务进入确认状态。

## 数据与升级边界

运行数据存放在 `EEW_DATA_DIR` 或 `$DSH_HOME/enterprise-expert-workspace`，不写入插件安装目录。内置 Skill 从 `assets/skills` 读取；用户 Skill、知识、任务和成果进入 profile 数据目录，因此升级包不会覆盖用户数据。

公开包不包含私人知识原件、开发日志、测试 profile、凭据或本机绝对路径。Excel 与 PowerPoint 使用内置 Open XML 处理器，避免把有已知漏洞的旧版表格/演示依赖带给安装用户。
