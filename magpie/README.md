Magpie Scripting 小组件
Magpie 网关今日用量：请求数、Token、费用、前三个模型排行。
文件
script.json — 项目清单（名字 Magpie，图标 server.rack）
widget.tsx — 小组件本体（四种尺寸 + 锁屏两种）
index.tsx — App 内设置页（服务器地址、网关 Key、周期、手动刷新）
utils.tsx — rpt 尺寸换算、时间、Token、费用格式化（含网页口径 fmtCostWeb）
接口（Magpie 自己的网关 API）
GET {服务器地址}/v1/magpie/usage?period=today|week|month|all，带
Authorization: Bearer <网关 Key>。回来是 Usage 页的汇总 JSON：顶层
就是 Totals——calls（请求数）、errors、input、output、
cache_read、cache_write、cost（美元），还有 models[]（name、
sub 供应商名、calls、input、output、cost，再加 timed、
ttft_ms、decode_ms/out/n、floor_ms/out/n、rates 直方图、
cache_unknown）、agents[]、sessions[]、sessionCount、
series[]（时间轴，每点有 calls）。
出处：Magpie 源码 internal/gateway/usage_api.go、
internal/usage/usage.go（Summary、Totals、Group）。
服务器那边要先做两件事（不然手机连上也是 403）
Web UI → Settings → Network and sharing → Share on local network 打开；
建一个只读网关 Key：Web UI → Gateway → Gateway keys 里建，或在服务器上
   docker exec magpie magpie gateway-key add widget --read-only。
注意：这个 Key 不是 MAGPIE_WEB_KEY（那是进网页用的），是 sk-magpie-…
开头的网关 Key；只读 Key 就够读用量。手机要和服务器在同一个局域网
（同一 Wi-Fi），或服务器有公网地址。远程也可以用 WorkBuddy 的地址 + 3430 端口。
显示
模型排行按 Token 数排（和网页 Usage 页一样），只显示前三个。
模型名只留最后一段，不带供应商前缀
（nvidia/nemotron-3.5-super-vl:free 显示成 nemotron-3.5-super-vl:free）。
小号：标题 + 今日请求数（大字）+ Token / 费用 + 三个模型行（色块 + 短名 + Token 数，不带占比条）+ 更新时间
中号：标题 + 统计行（请求数 · Token · 费用，失败次数标红）+ 三个模型行（色块 + 短名 + Token 数 + 占比条）+ 更新时间
大号：三格统计（请求 / Token / 费用）+ 三个模型行（色块 + 短名 + Token 数 + 占比条 + 灰色明细行）+ 最活跃 agent + 更新时间
锁屏圆形：Token 数；锁屏矩形：请求数 + 费用
大号模型行的灰色明细行，和网页排行行一样的顺序和内容：
请求 · 费用 · 速度 · 首字 · 命中率 · 占比 · 失败，没有的项不写。
失败次数在明细里是灰色的（一段 Text 只能一种颜色，做不到网页那样单独标红）。
口径（和网页 Usage 页一致）
Token 数（排行和右边的数字）：input + output + cache_read + cache_write；占比 = 该模型 Token / 全部模型 Token 之和；条按第一名算占比。
速度：计时回复的中值（rates 直方图的 bin 中值，bin 400 是 1，每档 1.02 倍；只有一条时按 decode_out/decode_ms 实测算），没计时的显示 ≥N token/秒 · K 次回复。
首字：ttft_ms / timed 的平均，<1 秒显示毫秒，否则秒。
命中率：cache_read / (input + cache_read + cache_write - cache_unknown)，两位小数。
费用（明细行）：≥$1 两位小数，<$1 三位小数（$1.64 / $0.023）；标题和紧凑视图沿用原来的 $0.86 样式。
更新与缓存
小组件每天 9–22 点每小时整点自动更新一次；拉不到显示缓存，
绝不转圈。服务器地址和网关 Key 只存在手机本地（preference.json +
共享 Storage），不会上传 GitHub。
注意：App（index.tsx）和小组件（widget.tsx）共用同一份缓存
（共享 Storage magpie_usage），两边的取数结构必须保持一致——
App 刷新一次就会把缓存重写一遍，如果 App 那份里没有模型列表，
小组件读到的就是空的，模型行全没了。改取数逻辑时两个文件要一起改。
