# 京东价格监控 Scripting 小组件

监控一个京东商品的实时价和涨跌，不设目标价。

当前默认商品：西昊豆包椅L1，SKU `100244780555`
链接：https://item.jd.com/100244780555.html

## 数据来源

京东公开的价格接口，不用登录：

- `GET https://p.3.cn/prices/mgets?skuIds=J_<SKU>&type=1`
- 备用：`https://pm.3.cn/prices/mgets?skuIds=J_<SKU>&type=1`
- 返回 `[{"id":"J_100244780555","p":"449.00","m":"499.00"}]`，`p` 是当前价

**注意：这个接口在我的电脑和云浏览器上两次都连接被重置，没法在这边验证。** 小组件是在你手机上直接拉的，手机网络和这边不一样，所以必须在真机上试一次才算数。如果手机上也不通，小组件会显示上次缓存的价格，并提示拉取失败。

**2026-11-21 更新：p.3.cn 在手机 Safari 里也直接没反应。** 查了这个商品的页面，里面写着“登录查看价格”，没登录的请求价格是被遮住的（`jdPrice":"4??"`），所以光靠不登录的 p.3.cn 很可能拿不到价。改法：小组件现在支持京东 Cookie，取价时带 Cookie 去拉 p.3.cn / pm.3.cn，拉不到再带 Cookie 拉商品页，从页里的 `jdPrice` 取真价。Cookie 在 App 设置页手动填，或用 Loon 抓（`JdGetCookie.js` / `Jd.lpx`，抓 p.3.cn 和商品页的请求头，写 BoxJs key `jd_cookie` / `@JD.cookie`，只存含 `pin=` 或 `thor=` 的登录 Cookie）。Cookie 不要提交到 GitHub。

## 涨跌怎么算

每次刷新把价格记进本地 `price_history.json`（最多 30 条），涨跌 = 当前价 - 上一次记录的价。最低 / 最高也是从这份本地历史里算的，不是京东官方的历史价。

iOS 决定刷新频率，一般 15-30 分钟一次，不是秒级实时。

## 文件

- `script.json`：Scripting 项目清单
- `widget.tsx`：小组件本体，四个尺寸：小号 / 中号 / 大号（带最近走势条形图）/ 锁屏（圆形只显示价格，矩形显示简称 + 价格 + 涨跌）
- `index.tsx`：App 内设置页，改商品编号和简称就能换商品，不用改代码；也可以清空价格历史
- `utils.tsx`：`rpt` 换算

## 安装

Scripting 里“导入远程脚本”，填这个文件夹的 GitHub 地址，例如：

`https://github.com/johnwick-xyz/scripting/tree/main/jdprice`
