# 移除 OneDrive、保留 JSON 备份实施计划

## 目标版本

v1.3.0：完全本地运行，只通过 JSON 文件备份和迁移。

## 任务 1：锁定本地设置界面契约

1. 修改 `tests/components/SettingsPanel.test.ts`，要求设置标题为“设置与备份”。
2. 要求界面保留加密 JSON、明文 JSON、JSON 导入、迁移救援和应用更新。
3. 要求界面不出现 OneDrive、Microsoft、同步、云端快照、冲突和 CSV。
4. 运行目标测试并确认因旧界面仍存在而失败。
5. 精简 `src/components/SettingsPanel.vue` 的属性、事件、状态、模板和样式，使测试通过。

## 任务 2：移除应用层同步编排

1. 修改 `tests/App.test.ts`，要求右上角为普通“设置与备份”入口，且设置组件不再接收或发出云同步接口。
2. 运行目标测试并确认失败。
3. 从 `src/App.vue` 删除后台同步启动、OneDrive 登录、云快照、冲突处理、恢复密钥和同步状态逻辑。
4. 保留本地初始化、JSON 导入导出、迁移救援和应用更新逻辑，使测试通过。

## 任务 3：移除云同步运行时和依赖

1. 扩充安全/架构测试，要求 CSP 不包含 Microsoft、Graph 或 OneDrive，`package.json` 不包含 MSAL。
2. 运行测试并确认旧配置导致失败。
3. 从 `src/stores/bookStore.ts` 删除 OneDrive runner、认证会话、云快照、后台重试和同步操作；保留本地记账及备份恢复。
4. 删除 `src/sync/`、`src/services/backgroundSync.ts`、`src/security/trustedSession.ts` 及专用测试。
5. 删除 `@azure/msal-browser`，更新锁文件、CSP、PWA 描述、环境变量声明与示例。
6. 精简 `src/security/cryptoVault.ts` 中仅被同步使用的接口，同时保持既有加密 JSON 格式兼容。
7. 运行相关测试、类型检查并修复所有残留引用。

## 任务 4：文档、版本与回归

1. 将应用版本升级为 v1.3.0。
2. 更新 README，完整说明本地数据隔离、JSON 备份、手机/电脑迁移、恢复密钥和更新方式。
3. 更新 CHANGELOG 与设置页版本说明。
4. 保留历史设计文档和旧 CHANGELOG 记录，新规格明确取代云同步运行方案。
5. 运行全量单元测试、类型检查、构建、Playwright、覆盖率、依赖审计和 `git diff --check`。

## 任务 5：视觉验收、审查与发布

1. 在桌面与 360px 移动视口检查设置与备份面板。
2. 搜索生产源码、构建产物、README、环境配置和依赖，确认无 OneDrive/Microsoft/MSAL/CSV 运行入口。
3. 提交实现并请求独立代码审查，修复全部 Critical 和 Important 项。
4. 生成 v1.3.0 源代码 ZIP、可部署网页 ZIP、解压上传目录和 GitHub 更新说明。
5. 校验 ZIP 必需文件、版本、禁止路径和逐文件哈希。
