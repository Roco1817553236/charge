# 物品日均成本实施计划

设计依据：`docs/superpowers/specs/2026-08-21-item-daily-cost-design.md`

## 目标版本

v1.4.0。保持完全本地、现有流水不变、旧 JSON 可导入，并在 GitHub Pages 上无缝更新。

## 实施顺序

### 1. 领域模型与纯计算引擎

- 先在 `tests/domain/itemCosts.test.ts` 写失败测试，覆盖本地日历包含首日、闰年、停用冻结、零成本、维修/配件汇总、最终舍入和筛选汇总。
- 在 `src/domain/models.ts` 增加 `ItemCategory`、`OwnedItem`、`ItemCost` 类型。
- 新建 `src/domain/itemCosts.ts`，只实现日期、成本和汇总纯函数。
- 运行定向测试并保持现有领域测试通过。

### 2. 默认物品分类与 IndexedDB v3

- 先扩展 `tests/data/databaseMigration.test.ts` 和 `tests/data/localRepository.test.ts`，要求 v2 数据升级后完全保留，并且新表与默认物品分类只初始化一次。
- 新建 `src/domain/itemCategories.ts`，提供稳定 ID 的独立默认分类。
- 在 `src/data/database.ts` 增加三个表及 v3 索引；扩展升级前独立备份检测以覆盖 v2→v3。
- 扩展 `LocalRepository.initialize()` 初始化新分类。

### 3. 物品与追加成本仓储

- 先在 `tests/data/localRepository.test.ts` 写失败测试：新增/编辑物品、流水来源校验、追加成本、停用/恢复、软删除/撤销、分类归档。
- 在 `src/data/localRepository.ts` 增加类型明确的物品仓储接口与事务方法，复用现有逻辑版本生成和本机待保存状态。
- 任何物品写入不得修改原流水。

### 4. JSON v2 与加密备份兼容

- 先扩展 `tests/services/importExport.test.ts`：旧 schemaVersion 1 文件原样兼容，新 schemaVersion 2 完整往返，损坏引用拒绝。
- 扩展 `LedgerSnapshot`、`createSnapshot()`、`replaceWithBackup()` 和 `src/services/importExport.ts`。
- 新备份包含三个物品数组；旧备份恢复为空物品并创建默认物品分类。
- 确认固定 v1.2 明文/加密测试夹具继续通过。

### 5. ItemStore 与组件交互

- 先新增 `tests/stores/itemStore.test.ts`，覆盖初始化、保存刷新、筛选状态、错误保留和撤销目标。
- 新建 `src/stores/itemStore.ts`，通过仓储接口驱动状态，不直接访问 IndexedDB。
- 先新增 `tests/components/ItemPage.test.ts`，覆盖汇总、三个筛选器、单卡片展开、新增来源选择、追加成本、停用/恢复和空状态。
- 新建 `src/components/ItemPage.vue` 和独立物品分类管理弹层，按已确认预览实现响应式明暗主题。

### 6. 第四页集成

- 先扩展 `tests/components/SwipePager.test.ts` 和 `tests/App.test.ts`，要求第四页、索引上限 3、底部四等分以及 App 初始化物品数据。
- 修改 `src/components/SwipePager.vue`、`src/App.vue` 和必要的全局样式。
- 保持默认启动仍在“记账”页，现有三页次序与行为不变。

### 7. 版本、文档与端到端验证

- 升级 `package.json`、锁文件、`.env.example` 和应用回退版本到 1.4.0。
- 更新 `README.md`、`CHANGELOG.md` 和设置页更新说明。
- 扩展 `e2e/app.spec.ts`，验证手动新增、从流水创建、追加成本、停用和刷新持久化。
- 运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e`、`npm run test:coverage` 和 `npm audit --audit-level=high`。

### 8. 审查与发布

- 提交实现后进行独立代码审查，重点检查日期边界、金额精度、数据库迁移和旧 JSON 数据安全。
- 修复全部 Critical/Important 后推送当前分支。
- 创建并合并 PR 到 `main`，等待 GitHub Actions 和 Pages 部署成功。
- 在线核验 v1.4.0 资源、第四页文案和离线 PWA 更新。

## 约束

- 每个生产行为先有失败测试，再写最小实现。
- 不复制 HomeBox 或 Snipe-IT 的 AGPL 代码与样式。
- 不增加网络请求、图片附件、卖出残值或多段暂停使用。
- 不清除或重写用户已有流水、记账分类和设置。
