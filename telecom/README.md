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
- `TelecomGetCookie.js`：Loon 抓 Cookie 脚本（自己写的，拦截 `e.dlife.cn` 的请求头）
- `Telecom.lpx`：Loon 插件，`script-path` 里填上面那个 JS 的 raw 地址

## 安装

Scripting 里“导入远程脚本”，填这个文件夹的 GitHub 地址，例如：

`https://github.com/johnwick-xyz/scripting/tree/main/telecom`

## Cookie（后面用 Loon 获取）

1. 把 `TelecomGetCookie.js` 传到 GitHub，拿到 raw 地址，填进 `Telecom.lpx` 的 `script-path`
2. Loon 里启用这个插件
3. 打开中国电信 App，刷一次首页或套餐页，收到“电信 Cookie 已抓取”的通知就好了
4. 小组件会自动从 BoxJs 读 Cookie；没抓到之前也可以先在 App 设置页里手动粘贴 Cookie

Cookie 过期后重新抓一次。Cookie 不要提交到 GitHub。
