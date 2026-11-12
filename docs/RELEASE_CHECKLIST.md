# 发布清单

## 代码与包

- [ ] `git status` 仅包含本次发布内容。
- [ ] `package.json` 的版本、包名、仓库、许可证、兼容范围和 `dsh.bundle.patch` 正确。
- [ ] `pnpm install --frozen-lockfile` 成功。
- [ ] `pnpm audit --prod` 无已知漏洞。
- [ ] `pnpm run verify:all` 全部通过。
- [ ] `pnpm pack --dry-run` 文件列表无私密或无关内容。
- [ ] 生成 `.tgz` 后运行 `pnpm run verify:package`，关键文件与源码一致。
- [ ] 对 `.tgz` 做密钥、绝对路径、日志、测试数据和私人资料扫描。

## 隔离安装

- [ ] 在全新 DSH_HOME 与测试 profile 中从 `.tgz` 安装，不使用源码链接。
- [ ] 确认 bundle 被识别、Host 激活、侧栏出现“企业 AI 专家工作台”。
- [ ] 完成至少一条核心任务，确认结果、任务持久化和成果下载。
- [ ] 重启后状态仍可读取；升级与卸载只作用于测试 profile。

## GitHub（执行发布时）

- [ ] 使用独立公开仓库，不公开包含私人历史的大仓库。
- [ ] 设置仓库简介和 Topics：`dsh-plugin`、`deepseek-harness`、`enterprise-ai`、`workflow`。
- [ ] 推送 `main`，创建签名或可追溯 tag `v1.6.0`，创建 Release 并附 `.tgz` 与 SHA-256。

## npm（执行发布时）

- [ ] 确认 npm 登录账号、registry、包名占用和发布权限。
- [ ] 发布 `1.6.0`，不覆盖既有版本。
- [ ] 查询公开 registry，核对版本、tarball、README、许可证和仓库地址。
- [ ] 从公开 npm 再安装一次并复验 bundle 激活与核心任务。

## dsh.so（执行提交时）

- [ ] 在线检查 npm tarball、README、ID、许可证、源码与安全扫描。
- [ ] 只修复真实问题，不通过隐藏或混淆绕过扫描。
- [ ] 提交后保存 Issue/回执，并标记“已提交，待审核”。
- [ ] 审核通过后再核对详情页、中文搜索、版本和安装命令。
- [ ] 只有从实际索引搜索、安装并运行成功，才宣告该索引下可搜索安装。
