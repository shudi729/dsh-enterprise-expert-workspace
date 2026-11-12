# 企业 AI 专家工作台 1.6.1

这是 GitHub 公开发行的安装说明修订版，不覆盖 `1.6.0`。

## 修订内容

- README 现在明确区分 GitHub Release、npm 与 dsh.so 三种发布状态。
- 在 npm 尚未发布时，用户从 GitHub Release 下载 `.tgz`，再安装到独立 DSH profile；不再给出当前不可用的 npm 直装指引。
- 跨平台测试允许无中文字体的环境明确拒绝生成 PDF，但不允许静默输出中文乱码；具备中文字体时仍执行真实生成、回读与格式校验。
- 发布校验脚本改为跟随 `package.json` 版本检查对应发行说明，降低后续发版遗漏风险。

## 已验证基线

- DeepSeek Harness `0.2.1-rc.5`
- Node.js `24.22.1`
- Windows、Chrome 157、桌面与 430px 窄屏
- 10 个业务方向、61 个 Skill、13 条跨领域工作流

## 发布边界

- GitHub 仓库与 Release：本版本发布范围。
- npm：尚未发布。
- dsh.so：尚未提交，未上架，不能声称客户端市场可搜索安装。
- 扫描版 PDF 暂无 OCR；真实企业系统连接需要用户自行配置并验证凭据。
