# dsh.so 插件市场提交资料

此文件用于准备市场提交，不代表已经发布、提交审核或上架。

## 基本信息

| 字段 | 内容 |
|---|---|
| 插件名称 | 企业 AI 专家工作台 |
| 插件 ID / npm 包名 | `dsh-enterprise-expert-workspace` |
| 版本 | `1.6.1` |
| 一句话简介 | 把企业资料转成可追溯任务、跨部门工作流和可下载成果，而不只是一次对话。 |
| 分类建议 | 企业效率、知识管理、工作流、数据分析 |
| 许可证 | MIT（SPDX：`MIT`） |
| 源码仓库 | `https://github.com/shudi729/dsh-enterprise-expert-workspace` |
| GitHub Release | `https://github.com/shudi729/dsh-enterprise-expert-workspace/releases/tag/v1.6.1` |
| npm | 待发布；预留地址 `https://www.npmjs.com/package/dsh-enterprise-expert-workspace` |
| 当前安装命令 | `dsh plugin --profile web add ./dsh-enterprise-expert-workspace-1.6.1.tgz` |
| npm 发布后安装命令 | `dsh plugin --profile web add dsh-enterprise-expert-workspace` |

## 市场长描述

企业 AI 专家工作台把知识管理、人力资源、个人工作、经营管理、大客户销售、市场研究、数据分析、文档处理、采购管理和数据治理组织成可持续推进的任务。用户可以上传 Word、Excel、PDF 等资料，系统检查必要信息，完成结构化计算与分析，明确事实、假设和待确认项，并交付可预览、可下载、可继续修改的真实成果文件。

它不是单一角色的聊天专家：任务、草稿、知识、工作流和成果版本会持久化保存；采购口径不一致、候选人字段未映射或模型结论与计算冲突时，系统会停止给出不可靠的总体结论，并引导用户在原任务中修正后重新执行。

## 建议搜索词

`企业AI`、`企业专家工作台`、`DeepSeek插件`、`DSH插件`、`知识管理`、`人力资源`、`大客户销售`、`采购管理`、`数据分析`、`文档处理`、`数据治理`、`工作流`。

## dsh.so 接受标准自检

| 标准 | 准备状态 | 证据 |
|---|---|---|
| DSH 兼容信号 | 已准备 | `package.json` 含 `dsh.bundle.patch`，指向 `cordis.patch.yml` |
| README 安装说明 | 已准备 | README 区分当前 GitHub `.tgz` 安装与未来 npm 安装，含 Web/Desktop profile、首次使用、升级、卸载和排障 |
| SPDX 开源许可证 | 已准备 | `package.json: license=MIT`，仓库含 `LICENSE` |
| 插件 ID 合规 | 已准备 | `dsh-enterprise-expert-workspace` 符合 `^[a-z0-9]+(-[a-z0-9]+)*$` |
| 源码可扫描 | 已准备 | 发布仓库包含 JS 源码、patch、Skill 与文档，不是纯文档仓库 |
| 安全扫描 | 本地通过 | 生产依赖 `pnpm audit --prod` 无已知漏洞；仍需以 dsh.so 在线扫描为准 |
| GitHub Topic | 已设置 | `dsh-plugin`、`deepseek-harness`、`enterprise-ai`、`workflow` 等 |
| 已发布 tarball 扫描 | 待发布后执行 | dsh.so 检查公开 npm tarball；发布前不能声称通过 |

## 权限与联网说明

- 任务、知识和成果默认保存在当前 DSH profile 的本地数据目录。
- 插件不含广告追踪或自有遥测。
- 只有在 DSH 已配置模型并执行相关任务时，任务资料才会经 DSH `llm` 服务发送给所选模型提供方。
- API Key 由 DSH profile 管理，插件不打包密钥。
- 外部连接和产生副作用的动作默认拒绝，需要显式授权。

## 审核边界

- 扫描版 PDF 暂无 OCR。
- 未提供真实企业系统凭据，因此连接器必须由用户按组织政策配置并验证。
- 已验证 Windows、Chrome 157 和窄屏布局；未宣称覆盖所有浏览器与移动真机。
- dsh.so 提交成功仅表示进入审核，不等于已上架；只有详情页和搜索结果实际出现后才可标记“已收录”。
