# zotero-feishu-note beta.3 verification — 2026-11-16 (America/Los_Angeles)

- 139 isolated Zotero 10.0.8 host tests passed, including update checks, installer
  errors, the new identity, legacy-plugin coexistence protection and deletion cases.
  The runner returned success; its esbuild service printed a shutdown-only diagnostic
  after the final successful run. Production build and lint are checked separately.
- New plugin identity: zotero-feishu-note@zhangkuns.github.io. Display name, package,
  project directory and GitHub fork use zotero-feishu-note. Credentials require a new
  connection; old local association files are copied once without deleting originals.
- The updates section is visually checked in a real isolated Zotero preferences
  window, above Sync location. Screenshot stays in ignored verification/local.
- Update checks/installations use native AddonManager, a per-addon auto-update toggle,
  a daily background check and a separate HTTPS GitHub update channel with SHA-512.
  No newer real release has yet been installed automatically in a production profile;
  publisher validation and public asset round-trip checks are recorded separately.
- Added a default-enabled deletion control respecting the existing master switch,
  automatic/manual mode and collection scope, plus native delete-permission prompts.
- Host tests cover historical recovery, fresh-machine state, concurrent deletion,
  stale-source resurrection, restoration, late replies, remote edits, lost responses,
  previews, authorization, deletion/sync-finish notifications and UI controls.
- Read-only checks on both computers confirmed the historical Circuit Tracing
  annotation was absent. The Zotero cloud deletion log contained its key and a
  current item-version request confirmed the key was not present.
- A scoped verification harness ran the production deletion module, deletion source,
  native Feishu client and transport against the actual APIs using the existing
  p3tower account. It used a Node HTTP adapter for Zotero.HTTP and a credential pipe;
  this is not a claim of an automatic in-app deletion by an installed beta.3 build.
- The existing Feishu grant already included comment deletion. Preview selected
  exactly the intended root with no follow-up replies. Exactly one DELETE request
  removed it; it disappeared from the remote comment list.
- Before/after snapshots each contained 1174 blocks. After normalizing text runs and
  excluding only the authorized deleted comment ID, the body/style/other-comment
  SHA-256 was identical. No document-block write request was permitted by the harness.
- No real discussion with other people's replies was deleted or changed for testing.
  Reply preservation/resolution and both deletion race cases are host-tested with
  independent state stores; two physical computers simultaneously deleting the same
  real annotation have not been exercised.
- Evidence and the scoped harness remain under ignored verification/local and are
  excluded from Git and source distributions. Upgrading both installed clients is
  still necessary for subsequent automatic deletions; beta.2 retains its old behavior.

# 原生批注同步候选版验证

验证日期：2026-11-10 至 2026-11-11（America/Los_Angeles）。版本：0.8.0-beta.2。
本修改版尚未公开发布；安装包与配套源码位于 ~/Disk/Zotero/zotero-feishu-native/release。

## 实现与安装

复用原插件的应用注册、设备授权、凭据存储、令牌刷新和 FeishuTransport。
原生 TypeScript 负责映射核验、定位、创建／更新、选区回读、持久化和自动任务。
插件运行不调用 lark-cli、Python 或 localhost 桥接。

候选版已通过正常 Zotero 插件安装界面装入 Zotero 10.0.8，active 已核验。
用户已在插件自己的浏览器授权流程中完成授权；真实 API 检查确认评论 scope 齐全。
旧桥接服务已停止并取消开机启动；旧服务状态与 XPI 备份保留以便回滚。

## 本地检查

- 112 项 Zotero 独立宿主测试通过，包括原版 62 项回归。
- 覆盖 PDF／HTML 保存防抖、严格 JSON 映射、真实宿主文件持久化、原生 API
  请求格式与令牌、评论权限、不同机器的 libraryID 恢复、重复同步、同根回复更新、
  丢失响应、不确定 5xx、断点恢复、远端修改冲突和 Unicode。
- 多机并发测试：两个独立状态仓库同时首次上传，随后统一主评论并解决重复；
  不同批注保持独立，已有后续回复的重复讨论保留待处理。
  这些引擎测试使用当前不可见来源编码；同时覆盖旧版文本／链接标记的恢复。
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

## beta.2 不可见来源编码验证

- 飞书创建接口接受自定义 extra，但读回没有该自定义字段，不能用来保存来源。
- 用 U+FE00–U+FE0F 编码来源 URL／校验值，加不可见分隔符，放在正文末尾换行之前。
  这属于文本中的不可见编码，并非飞书原生隐藏字段；复制可能携带，手动编辑可能删除。
- 实际 API 新建、更新与回读均保留编码；Zotero Firefox 渲染测得与纯批注正文宽度一致。
- 本机已安装并启用 beta.2；上述四条真实评论原位迁移成功，批注文字、评论 ID、
  根回复 ID 均保持不变，原始可见后缀和来源 URL 不再出现在评论原文中。
- 通过新版客户端在专用测试文档实测新建长文本（跨文本段编码）、更新同一根回复、
  尖括号／中文／emoji 完整回读，测试评论已标为解决。
- 空本机内存状态恢复四条不可见来源关联，没有新建评论或修改文档快照；
  恢复不依赖 Syncthing 或共享本地索引。再次正常同步为 unchanged。
- 两篇原文共 2248 块与原始快照核对，正文、样式、其他评论、图片和公式均保留。
- 宿主测试增加分段解码、畸形编码拒绝、可见后缀迁移、清除编码后的本机冲突保护。
  飞书端独立编辑且保留编码时，换机仍拒绝覆盖。全新机器遇到已清除编码的评论，
  无法确认来源，可能另建评论；必须保留编码才能可靠恢复关联。
- beta.1 已验证实际 PDF／HTML 保存后自动更新及恢复源批注；beta.2 的同根回复更新
  由新版实际客户端验证和宿主测试覆盖。真实双机并发限制仍见下文。

飞书回复更新接口拒绝外部 docs_link（HTTP 400 / 1069302），旧版链接和可见文本
来源标记仍可恢复并在核验后原位升级，不改变评论选区。

实际证据保存在忽略的 verification/local，包含 native-live-verification.json、
native-body-comparison.json、native-auto-update.json、native-fresh-state-verification.json、
native-creation-verification.json、native-hidden-migration.json、native-hidden-client.json、
native-extra-probe.json、native-invisible-probe.json 与文档快照；不纳入公开源码包。

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
