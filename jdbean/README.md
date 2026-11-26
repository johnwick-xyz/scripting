# 京东京豆 Scripting 小组件

参考脑瓜（anker1209）京东合一 v2（`JD-in-one-v2.js` v2.2.9）里面的京豆统计及显示。

## 显示什么（和脑瓜那版对应）

- 顶部：头像 + 昵称，右边是京豆总数（红色大字 + “京豆”）
- 中间：今日 / 昨日两栏，每栏是净收入大字，下面一行“收入 +X”，有支出时再一行红色“支出 -Y”
- 大号：最近 7 天每日净收入柱状图（收入 - 支出）
- 中号 / 小号：顶部 + 总数 + 今日 / 昨日两栏 + 更新时间
- 锁屏圆形：只显示京豆总数；锁屏矩形：昵称 + 总数 + 今日净收入

## 数据来源（京东自己的接口，都是脑瓜那个脚本用的）

1. 京豆总数 + 昵称 + 头像：
   `GET https://me-api.jd.com/user_new/info/GetJDUserInfoUnion?isLogin=1`，带 Cookie，
   返回 `data.assetInfo.beanNum`（京豆总数）、`data.userInfo.baseInfo.nickname`、`headImageUrl`
2. 京豆收支明细：
   `POST https://api.m.jd.com/client.action?functionId=getJingBeanBalanceDetail`，body `body=<URL编码的 {"pageSize":"20","page":"N"}>&appid=ld`，带 Cookie，用京东 App 的 UA，回来是 `detailList[]`。原来那个 `POST https://bean.m.jd.com/beanDetail/detail.json`（H5 接口）现在回 403 “file-no.2 conf not found”，不是 Cookie 的问题，是京东那边这个接口不给走了，只当备用。
   返回 `code '0'`，`jingDetailList[]` 每条有 `date` 和 `amount`（正数=收入，负数=支出）。
   按天汇总最近 7 天：收入 = 正数之和，支出 = 负数之和，净收入 = 收入 + 支出。
   翻页到日期超出范围或没数据就停，最多 8 页。

脑瓜那版还有个缓存规则：京豆总数没变就用缓存的每日统计，变了才重新拉明细。这里也一样，
总数没变且在更新时间外就不重新拉明细。

## Cookie

和京东价格那个小组件共用同一个 Cookie：优先读 Storage 共享域 `jd_cookie`（价格那个
App 写进去的），再读本项目的 `preference.json`，再读 BoxJs `jd_cookie` / `@JD.cookie`。
填过一次就不用再填；也可以用 Loon 抓（价格那个项目的 `Jd.lpx`），Cookie 会自动写进 BoxJs。
Cookie 只存在手机本地，不会上传云端，也不要提交到 GitHub。

**注意：京豆必须登录才能拉。** 价格那个接口（p.3.cn）不用 Cookie 也能拉，
但京豆这两个接口（用户信息、收支明细）没登录会直接返回 `retcode 1001` / 302 页面，
所以 BoxJs 里必须先有京东 Cookie：要么在 App 里粘贴一次，要么用 Loon 装
价格那个项目的 `Jd.lpx` 抓一次。
2026-11-22 修过一个 bug：BoxJs 里没有 `jd_cookie` 这个 key、或 BoxJs 没起来时，
查出来的东西不是 JSON，直接 `res.json()` 会报
`SyntaxError: JSON Parse error: Unexpected identifier "file"`，整个刷新就崩了。
现在改成先读文本、解析失败就当这个 key 没有，继续找下一个，不会再崩；
明细接口返回 302 的 HTML 时也只停掉翻页，不影响京豆总数显示。

## 更新

小组件到更新点会自己拉一次新数据，用的是系统原生超时
`AbortSignal.timeout()`，拉不到就显示旧数据，不会转圈。更新时间点可以在 App 里手动改
（“刷新时间”一栏，填整点小时，用逗号隔开，例如 9,15,21；也可以写 9:00,15:00，分钟忽略），
默认 9:00、15:00、21:00；两个京东小组件共用同一份设置，改一边两边都生效。打开 App 时也按
更新点这个规则自动拉；点“刷新京豆”随时都能手动拉。

头像和小组件里的商品图一样，App 拉到后下载到本地文件，小组件直接读本地图片，
远程图在小组件里经常加载失败。

## 文件

- `script.json`：项目配置（名字 京东京豆）
- `widget.tsx`：小组件
- `index.tsx`：App 设置页（Cookie、刷新、最近 7 天明细）
- `utils.tsx`：共用工具（rpt）
- `README.md`：本说明

## 导入

GitHub 文件夹地址（传到 `johnwick-xyz/scripting` 的 `jdbean` 文件夹后）：

`https://github.com/johnwick-xyz/scripting/tree/main/jdbean`

一键导入：

`https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2Fjohnwick-xyz%2Fscripting%2Ftree%2Fmain%2Fjdbean%22%5D`

## 注意

- 京豆即将过期数脑瓜那版也不显示，这里也没有；要的话以后再加接口。
- 预览里的数字是示例，不是真实京豆数；第一次打开 App 拉一次就有真数了。
