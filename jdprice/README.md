# 京东价格监控 Scripting 小组件（优化版）

监控一个京东商品的实时价和涨跌，不设目标价。

## 优化点（相对原版）

1. **代码去重**：原版 `index.tsx` 和 `widget.tsx` 中大量重复逻辑（`fetchPrice`、`extractWarePrice`、`strictNum`、`nextSlot`、`currentSlot`、`getCookie`、`getSku`、`readCached`/`saveCache` 等）全部下沉到 `utils.tsx`，两边只保留各自 UI 逻辑，维护成本更低。
2. **TypeScript 类型完善**：新增 `PriceEntry`、`WidgetData`、`AppConfig` 接口，减少 `any` 使用，IDE 补全更准确。
3. **路径集中管理**：`getAppRoot()`、`getCachePath()`、`getPrefPath()` 等集中在 `utils.tsx`，避免重复拼接路径。
4. **网络层统一**：所有请求统一走 `fetchWithTimeout` / `withTimeout`，超时和错误信息更清晰。
5. **错误处理更健壮**：去掉大量空 `catch {}`，关键错误会聚合调试信息抛出（例如“p3 无价；wareBusiness 无价；商品页无价”）。
6. **版本号**：`script.json` 版本由 `1.0.0` 升至 `1.1.0`。

## 文件说明

| 文件 | 作用 |
|------|------|
| `script.json` | Scripting 项目清单（名称、图标、颜色等） |
| `utils.tsx` | **公共层**：类型定义、常量、路径、时间工具、价格解析、网络请求、Cookie/SKU 获取、缓存读写 |
| `index.tsx` | App 内设置页：改商品 SKU、填 Cookie、设置刷新时间、手动刷新、预览小组件 |
| `widget.tsx` | 小组件本体：四种尺寸（小/中/大/锁屏），读缓存显示价格、涨跌、最低/最高、走势条 |
| `Jd.lpx` | Loon 插件配置：拦截京东 App 请求抓 Cookie |
| `JdGetCookie.js` | Loon 脚本：把请求头里的 Cookie 存入 BoxJs |

## 新增功能：强制刷新价格

### App 设置页（index.tsx）

底行新增 **“强制刷新价格”** 按钮，点击后会**忽略更新时间窗口和缓存新鲜度**，强制联网取价。适用于以下场景：

- 想立即看到最新价格，不想等到下一个整点
- 怀疑缓存价格已过时，想强制刷新验证

> ⚠️ 注意：小组件（Widget）本身是 iOS 系统只读组件，**不能放可点击按钮**。因此“强制刷新”按钮只能在 App 设置页里点击。若要立即刷新，请打开 App 后点击该按钮；小组件会在下一个更新点自动读取新缓存。

## 安装

在 Scripting 里使用“导入远程脚本”，填入本文件夹的 GitHub 地址，或直接把文件复制到本地导入。

## 配置步骤

1. 打开 App 设置页，将想监控的京东商品 SKU（`item.jd.com/` 后面的数字）填进去。
2. 填入京东 Cookie：
   - 手动粘贴到设置页的 SecureField 中；或
   - 使用 Loon 安装 `Jd.lpx` + `JdGetCookie.js`，打开京东 App 刷一次商品页，Cookie 会自动抓取并写入 BoxJs，小组件自动读取（无需手动填）。
3. 设置刷新时间点（默认 9:00、15:00、21:00），打开 App 后会自动拉一次价。
4. 小组件会读取缓存显示，秒出，不会转圈；若要看最新价，打开一次 App 或等自动更新点。

## 风险提示

- 代码会在**手机本地**处理京东登录 Cookie（含 `pin=`、`thor=`、`pt_key` 等敏感凭据），不会上传云端。但**不要把 Cookie 或本地缓存文件上传到 GitHub 或任何公共平台**。
- 依赖京东多个 API 域名（`p.3.cn`、`pm.3.cn`、`api.m.jd.com`、`item.m.jd.com`），京东随时可能修改接口或加强反爬，导致取价失效。
- iOS 小组件后台执行受系统限制，可能掐断后台取价，小组件会显示旧价格并提示“更新失败”。

## 默认商品

西昊豆包椅L1，SKU `100244780555`（作者个人商品，使用前请自行修改为你想监控的商品）。
