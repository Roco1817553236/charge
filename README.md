# 账页

账页是一款本地优先的个人记账 PWA，可安装到 Windows、Android，也能直接在浏览器中使用。它不需要自建服务器：流水先保存在当前设备的 IndexedDB 中；启用同步后，账本会在本机加密，再写入你自己的 OneDrive 应用专属目录。

## 已实现功能

- 快速记录支出和收入，金额按“分”精确保存
- 记账、流水、统计三个页面可横向滑动，也可使用底部导航切换
- 两级分类；大类和二级分类均可新建、改名、换图标/颜色、排序、置顶和归档
- 流水搜索、按月份/收支/大类/二级分类筛选，编辑、复制、软删除和撤销
- 月度环比（本月至今/完整月份可切换并多端同步）、年度同比、今年/去年逐月趋势、分类变化和二级分类下钻
- 完全离线可用，可安装为 Windows/Android 桌面应用
- OneDrive 端到端加密同步、三设备并发合并、冲突选择和最近 5 份加密快照恢复
- 加密 JSON、明文 JSON、CSV 导出，以及备份恢复
- 应用内检查并应用 PWA 更新，账本数据不会因更新被清空

## 费用与数据边界

应用本身是 MIT 开源软件，不含广告、分析追踪或付费接口。日常记账完全不需要账号或联网。

多端同步使用你自己的 Microsoft 账号和 OneDrive，无需部署后端。免费静态托管可选 GitHub Pages；外部平台的免费额度和政策可能调整，请以其届时规则为准。

云端只保存 AES-256-GCM 密文。同步权限为 Microsoft Graph 委托权限 `Files.ReadWrite.AppFolder`，应用只能读写自己的 OneDrive 应用目录，不能浏览其他文件。同步密码不上传；首次创建云端账本时必须另存恢复密钥，二者都丢失后无法解密。

## 本机运行

需要 Node.js 22.12 或更高版本。

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

打开终端显示的本地地址即可。未填写 Microsoft 客户端 ID 时，离线记账、统计和导入导出都可正常使用；也可以稍后在应用“设置与同步”中粘贴客户端 ID。

完整校验：

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run test:coverage
```

## 免费启用 OneDrive 同步

OneDrive 登录需要一次免费的 Microsoft Entra 单页应用注册，不需要客户端密钥，也不需要服务器。

1. 进入 [Microsoft Entra 管理中心](https://entra.microsoft.com/)，打开“应用注册”，新建注册。
2. 选择支持“个人 Microsoft 账号”的账户类型。当前代码使用 `consumers` 登录端点。
3. 在“身份验证”中添加“单页应用 (SPA)”平台，并填写应用的完整地址：
   - 本地开发：`http://localhost:5173/`
   - GitHub Pages：`https://你的用户名.github.io/仓库名/`
4. 在“API 权限”中添加 Microsoft Graph 的委托权限 `Files.ReadWrite.AppFolder`。不要添加 `Files.ReadWrite.All`。
5. 复制“应用程序(客户端) ID”，粘贴到应用设置中；或者写入 `.env.local`：

```dotenv
VITE_MS_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

每台设备首次使用时，以同一个 Microsoft 账号登录并输入同一个同步密码。第一台设备创建账本时会生成恢复密钥；应用会先把它加密保存在本机，再上传云端账本，但仍应立即点击下载并离线保管。

勾选“信任此设备”后，应用只在当前浏览器的 IndexedDB 中保存不可导出的 Web Crypto 数据密钥，不保存同步密码。以后启动时会先尝试静默登录和同步；微软登录过期时会停止后台同步，等待你主动重新登录，不会在后台突然弹出登录窗口。

云端文件位于 OneDrive 的应用专属目录中：主文件为 `vault-v1.json`，`snapshots/` 中保留最近 5 份覆盖前快照。它们都是密文。即使主文件损坏且本机没有可信会话，也可以登录后用同步密码或恢复密钥直接解锁历史快照。

## 免费发布到 GitHub Pages

仓库已包含 `.github/workflows/deploy.yml`。将代码推送到 GitHub 后：

1. 在仓库 Settings → Pages 中选择 GitHub Actions 作为来源。
2. 可在 Settings → Secrets and variables → Actions → Variables 中添加 `VITE_MS_CLIENT_ID`；不添加也可由用户在应用内填写。
3. 推送到 `main` 或 `master`，工作流会先测试和构建，再发布 `dist/`。
4. 把最终 Pages 地址加入 Entra 的 SPA 重定向 URI。

发布新版本后，已安装的 PWA 会在后台下载更新。“设置与同步”会显示可用更新，用户点击应用即可，不需要卸载重装。存在未保存草稿或编辑中的流水时会直接阻止刷新，必须先保存或清空。

数据库 v1→v2 升级会在打开新版数据库前，把旧快照写入独立的 `-migration-safety` IndexedDB 并回读校验；升级事务中还保留一份迁移备份。升级失败时原数据库事务自动回滚，旧静态缓存也不会主动清理；成功后会核对流水、分类、设备和冲突 ID 并执行本地读写自检。若自检仍失败，设置页会提供“下载迁移救援备份”；该文件是明文 JSON，下载前会再次确认。

## 安装到设备

- Windows：使用 Edge 或 Chrome 打开已发布的 HTTPS 地址，点击地址栏的“安装应用”。
- Android：使用 Chrome 打开同一地址，菜单中选择“安装应用”或“添加到主屏幕”。
- 浏览器：直接访问即可；同一浏览器配置文件中的本地数据会持续保留。

卸载 PWA 前应先完成 OneDrive 同步或导出加密备份。清除站点数据会删除该设备的本地账本。

## 安全实现

- 密钥派生：PBKDF2-HMAC-SHA-256，默认 600,000 次迭代
- 加密信封：严格校验算法、盐、IV、密文块与 KDF 上限；远端响应流或本地文件累计超过 16 MiB 时立即取消
- 内容加密：AES-256-GCM，每个密文块使用独立随机 IV；账本正文的认证数据绑定恢复密钥封装，单独替换封装会让密码、恢复密钥和可信设备三条解锁路径全部拒绝
- 密钥恢复：随机恢复密钥独立包裹数据密钥
- 同步并发：ETag 条件写入、向量时钟、原子同步检查点、显式冲突处理
- 网络权限：严格 CSP，仅允许应用自身、Microsoft 登录、Graph 和 OneDrive 预授权下载域名
- 数据模型：流水软删除与分类墓碑均带向量修订；权威恢复使用账本代际，防止旧设备让记录“复活”

同步过程中产生的新流水不会被旧快照覆盖：仓库以原子检查点记录本地变更代数；即使远端刚恢复为新账本代际，也会把检查点后的本机操作及其活动分类依赖重新生成修订并保留“待同步”，随后立即进行下一轮。网络中断、Graph 限流和 ETag 冲突按退避策略重试，本地记账不受阻塞。

首次建库的临时恢复密钥会绑定云端信封 SHA-256 指纹。条件上传成功后，在任何本地 apply 之前立即确认；若上传响应不确定或页面在中途退出，下次启动会用暂存恢复密钥静默解密并完整验证远端账本，无法静默登录时则在下一次显式同步中核对。只有明确的条件上传竞争失败会作废该次临时密钥；其他指纹不一致会保留本机密钥并停止同步，等待处理。

v1.0 为避免误删，流水软删除标记与分类墓碑会永久保留，不做自动垃圾回收；当前也不提供“停用遗失设备”入口。它会占用少量额外空间，但比在设备确认点不完整时提前清理更安全，后续版本可在重新验证同步密码和所有活动设备确认后加入安全回收。

这是一款个人工具，不替代专业财务、税务或审计系统。请自行保存恢复密钥和定期备份。

## 开源组件

主要使用 [Vue](https://github.com/vuejs/core)、[Pinia](https://github.com/vuejs/pinia)、[Dexie](https://github.com/dexie/Dexie.js)、[MSAL Browser](https://github.com/AzureAD/microsoft-authentication-library-for-js)、[Workbox](https://github.com/GoogleChrome/workbox) 与 [Vite](https://github.com/vitejs/vite)。统计图采用轻量 SVG 绘制，避免额外图表运行时。

## 许可证

[MIT](LICENSE)
