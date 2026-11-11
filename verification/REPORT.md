# 原生批注同步候选版验证

验证日期：2026-11-10 至 2026-11-11（America/Los_Angeles）。版本：0.8.0-beta.1。
本修改版尚未提交或公开发布；安装包与配套源码位于项目的 runtime/zotero-feishu-native。

## 实现与安装

复用原插件的应用注册、设备授权、凭据存储、令牌刷新和 FeishuTransport。
原生 TypeScript 负责映射核验、定位、创建／更新、选区回读、持久化和自动任务。
插件运行不调用 lark-cli、Python 或 localhost 桥接。

候选版已通过正常 Zotero 插件安装界面装入 Zotero 10.0.8，active 已核验。
用户已在插件自己的浏览器授权流程中完成授权；真实 API 检查确认评论 scope 齐全。
旧桥接服务已停止并取消开机启动；旧服务状态与 XPI 备份保留以便回滚。

## 本地检查

- 108 项 Zotero 独立宿主测试通过，包括原版 62 项回归。
- 覆盖 PDF／HTML 保存防抖、严格 JSON 映射、真实宿主文件持久化、原生 API
  请求格式与令牌、评论权限、不同机器的 libraryID 恢复、重复同步、同根回复更新、
  丢失响应、不确定 5xx、断点恢复、远端修改冲突和 Unicode。
- 多机并发测试：两个独立状态仓库同时首次上传，随后统一主评论并解决重复；
  不同批注保持独立，已有后续回复的重复讨论保留待处理。
  这些引擎测试使用当前文本来源标记；同时覆盖旧版链接标记的恢复。
- UI 宿主测试：总开关关闭后阻止手动／预览 IO；仅手动模式禁用后台相关控件；
  指定分类包含子分类，分类不可用时拒绝同步；默认全部映射文献。
- Prettier、ESLint、生产／测试 TypeScript 与正式构建通过。

## 真实飞书验证

以下均通过插件自己的 OAuth 和直接 API 完成，没有调用 lark-cli 或桥接服务：

- PDF 文献 Looped Transformers 与 HTML 快照 Circuit Tracing，共四条原有批注。
  从远端恢复后保持四个原评论 ID 和根回复 ID，原位升级来源标记。
- 再次同步两篇文献，均返回 unchanged：评论数量均保持两条，文档版本分别保持
  39 与 290，重复同步前后快照完全相同。
- 分别临时修改 PDF 与 HTML 的一条源批注并保存，由实际保存通知自动触发同步。
  飞书更新同一根回复；随后恢复源批注原文，自动同步也恢复成功。
- 使用全新的独立内存状态库重复两篇文献的原生同步，恢复四条关联；没有增加评论，
  文档快照完全相同。此检查模拟换机后的空本机状态，不是两台物理机器实测。
- 与原始文档快照逐块核对，共 2248 个块：仅排除四条已授权评论的 comment_ids，
  并按字符规范化文本分段，其余正文、样式、其他评论、图片和公式均一致。
- 单独创建一份明确命名为测试的飞书文档，实测新建评论、更新同一根回复、句内
  精确选区和重复评论标为已解决。包含中文、英文、&、尖括号和 emoji；回读确认
  文本、选区与粗体样式保留。测试文档保留供检查，未向用户论文新增测试批注。

发现并修复的真实接口问题：飞书回复更新接口拒绝带校验片段的外部 docs_link
（HTTP 400 / 1069302）。新评论和更新使用严格的尾部文本来源标记
`[Zotero Feishu Sync] https://www.zotero.org/...#zfs=...`，旧链接标记仍可恢复。

实际证据保存在忽略的 verification/local，包含 native-live-verification.json、
native-body-comparison.json、native-auto-update.json、native-fresh-state-verification.json、
native-creation-verification.json 与文档快照；不纳入公开源码包。

## 限制与发布边界

两台物理机器同时在线的实测尚未完成；并发合并由独立状态的宿主测试覆盖。
真实 API 已验证创建、更新、解决及恢复，但真实同时首次上传后的自动合并尚未实测。
匹配必须唯一且位于一个正文块，跨块或歧义选区保留待处理；不从飞书反向同步。

源码保留 AGPL-3.0-or-later 和第三方许可说明。交付包不含账号凭据、profile、真实
文档快照或本机日志。Zotero 强制要求安全更新地址，候选版使用保留的 .invalid HTTPS
地址，防止本地修改版被原版覆盖。正式公开发布前用 ZOTERO_FEISHU_UPDATE_URL
配置发布方的更新清单；当前通过 XPI 手动更新。

原生迁移前源码及桥接 XPI 备份：backups/zotero-feishu-before-native-api-20261110。
配套源码、与上游的完整差异、原生迁移差异、文件清单与 SHA-256 随安装包提供。

没有改动 arxiv-zotero-import skill。其 SKILL.md 的 SHA-256 保持为：
`0d9d1dcf7d146cb40eff34331decdc841414aff17460880a60151c176b20bd7a`。
