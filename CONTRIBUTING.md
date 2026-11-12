# Contributing

感谢你改进企业 AI 专家工作台。

## 提交问题前

1. 先确认问题发生在受支持的 DSH 与 Node.js 版本中。
2. 用隔离的测试 profile 复现，避免影响日常数据。
3. 删除日志中的 API Key、客户名称、个人信息和原始业务资料。
4. 安全问题请使用 GitHub 私密漏洞报告，不要创建公开 Issue。

## 开发与验证

```sh
pnpm install --frozen-lockfile
pnpm run verify:all
pnpm pack --pack-destination dist
pnpm run verify:package
pnpm run verify:archive
```

涉及 bundle、依赖或客户端入口的修改，还必须从生成的 `.tgz` 安装到隔离 DSH profile，确认 Host 激活、侧栏入口显示和至少一条核心任务可完成。

## 修改要求

- 保持任务式产品形态，不把场景退化为单轮对话提示词。
- 计算与模型解释分离；资料不足、口径不一或结论冲突时不能标记为已完成。
- 新增外部连接、数据发送或文件写入行为时，同步更新 README、隐私说明和权限检查。
- 不提交密钥、`.env`、真实客户数据、日志、测试 profile 或无授权资料。
- 新能力应有自动化测试，并说明真实验证范围与未验证边界。
