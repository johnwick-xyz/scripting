# 中国电信 Scripting 小组件

样式和联通版一样，都是列表式：顶行蓝色“电”+ 中国电信，话费余额大号蓝色数字，剩余流量 / 剩余通话各一条绿色进度条加百分比，底行是已用流量 + 更新时间。

电信这个接口不给积分，所以底行没有积分，只有已用流量和更新时间。

## 数据来源

电信营业厅 App 自身调的 `e.dlife.cn`：

- `GET https://e.dlife.cn/user/package_detail.do`：套餐明细，流量和通话的剩余、总量、已用（单位 KB），百分比 = 剩余 / 总量
- `GET https://e.dlife.cn/user/balance.do`：话费余额，`totalBalanceAvailable` 单位是分，除以 100 是元

不限量套餐（`balanceAmount` 为 `999999999999`）不计入总量，流量那行显示已用流量。

## 文件

- `script.json`：Scripting 项目清单
- `widget.tsx`：小组件本体，四个尺寸：小号 / 中号 / 大号 / 锁屏（圆形只显示流量 % 环，矩形显示话费和流量两行）
- `index.tsx`：App 内设置页，手动填 Cookie
- `utils.tsx`：`rpt` 换算
- `TelecomGetLoginUrl.js`：Loon 抓登录地址脚本（拦截 `e.dlife.cn/user/loginMiddle`，存去掉 `&sign` 之后的地址）
- `TelecomGetCookie.js`：Loon 抓 Cookie 脚本（拦截 `e.dlife.cn` 的请求头，备用）
- `Telecom.lpx`：Loon 插件，上面两个 JS 的 raw 地址都填在里面了

## 安装

Scripting 里“导入远程脚本”，填这个文件夹的 GitHub 地址，例如：

`https://github.com/johnwick-xyz/scripting/tree/main/telecom`

## 登录地址（首选，不怕过期）

办法来自 GitHub 上 anker 的 `ChinaTelecom_2024.js` 和 dompling 的 `10000/index.js`：不直接存 Cookie，而是抓一个登录地址，小组件每次刷新用它换一个新鲜 Cookie。

1. 把 `TelecomGetLoginUrl.js` 和 `TelecomGetCookie.js` 都传到 GitHub（raw 地址已经填进 `Telecom.lpx` 了）
2. Loon 里启用 `Telecom.lpx`
3. Safari 打开 `https://e.dlife.cn/index.do` 登录一次，跳转经过 `loginMiddle` 时收到“电信登录地址已获取”就好了
4. 小组件每次刷新自动用登录地址换新 Cookie；登录地址很久不用会失效，失效了重新登录抓一次

登录页一直在转圈：先把 Loon 关掉再登录，登完开 Loon 刷新一次页面（走 Cookie 抓取兜底）；或先去 `www.189.cn` 登录，再回 `e.dlife.cn`。

## Cookie（备用）

没抓到登录地址之前，也可以先在 App 设置页里手动粘贴 Cookie；Loon 抓 Cookie 的规则也在 `Telecom.lpx` 里，打开中国电信 App 刷一次首页或套餐页就能抓到。Cookie 过期后重新抓一次。登录地址和 Cookie 都不要提交到 GitHub。
