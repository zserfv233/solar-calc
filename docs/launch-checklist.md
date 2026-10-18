# 上线前检查记录

检查日期：2026-10-18（Australia/Melbourne）。初检基线：`ae488a50dca33be5b2cca8750ced6fc38ec59d6f`，检查分支：`codex/step-12-checklist`。F01 补验针对修复分支 `codex/f01-capacity-cap` 的最终提交 [`870312e`](https://github.com/zserfv233/solar-calc/commit/870312e0d62eb78333b2941b2649a924f3730986)；下文注明补验的结果来自该修复版本，其余证据保留初检基线口径。

依据：项目规划中的完成标准、已确认的追加核查要求，以及现有代码和独立手算。本轮只记录，不修复代码、不更新数据、不修改测试或期望值、不增加依赖。

项目规划的可读材料给出了验收概要及追加要求，但本地未提供原执行方案的独立逐项清单。因此将已知要求展开成下面的检查项；原清单完整性保留为 LC31，不声称覆盖未提供的条目。

## 结论与计数口径

主表共 **32 项：通过 24 项、未通过 0 项、需用户确认 8 项**。细节表和观察记录不重复计数。

- **通过**：已实际执行自动检查，或有可定位的代码、测试和原始来源证据；不等同于完成实机浏览器验收。
- **未通过**：仍存在可复现的问题；当前无此类条目，原 F01 已修复并补验通过，历史复现保留在下方。
- **需用户确认**：设备、浏览器或部署现场确认尚未完成，或需要用户明确范围。未检查的项目不标为通过。

自动测试和静态构建通过，F01 已按用户决定限制容量并完成补验；修复分支尚不等于正式部署。仍需在人工检查点完成所有待确认项，再由用户决定是否合并上线。

## 逐项检查

| ID | 检查项 | 结果 | 证据与范围 |
| --- | --- | --- | --- |
| LC01 | 正确基线、独立分支与变更范围 | 通过 | `git log -1 --oneline` 为 `ae488a5 Merge pull request #9`；开始时 `git status --short` 为空。交付只增加本报告，见下方变更检查命令。 |
| LC02 | 类型检查与全部自动测试 | 通过 | `npm test` 执行 `tsc --noEmit && vitest run`，初检为 12 个测试文件、176 项全部通过；F01 最终版本补验为 13 个文件、233 项全部通过，见下方 F01。命令定义见 [`package.json:10`](../package.json#L10)。 |
| LC03 | 静态构建、路由与资源完整性 | 通过 | `npm run build` 成功生成 5 页；本地预览 `/`、`/zh/`、`/en/` 及两种语言的 `/sources/` 均为 HTTP 200；构建产物中的内部链接、锚点和本地脚本资源检查发现 0 个断链。 |
| LC04 | 三个独立手算用例误差及手算文件一致性 | 通过 | [`tests/calc.test.ts:64`](../tests/calc.test.ts#L64) 将相对误差限制为小于 1%；三个用例见该文件第 20、35、49 行及 [`hand-calc.md:18`](../tests/fixtures/hand-calc.md#L18)。只在内存中跳过脚本写文件调用后重算，生成文字与现有手算文件完全一致，未写回文件。 |
| LC05 | 抽三个邮编，对照 CER 原表及实际计算入口 | 通过 | 3000 → 4 区 / 1.185；3350 → 3 区 / 1.382；8000 → 4 区 / 1.185。CER 表项、PDF 页码、本地行号及运行输出见下方“邮编抽查”。 |
| LC06 | 已收录的小型系统 STC 年份、系数、分档及资格日期 | 通过 | [CER 计算规则](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/calculate-small-scale-technology-certificate-entitlements) 的视同年限表和电池系数表与 [`stc-zones.json:11`](../data/stc-zones.json#L11)、[`battery-rebate.json:12`](../data/battery-rebate.json#L12) 一致；分档和日期见该电池文件第 69、87 行。此项仅核对当前已收录的小型模型，不代表适用所有容量，见 LC12。 |
| LC07 | 电池补贴对安装商公开示例 | 通过 | 同一政策期的 10 kWh → 68 张、20 kWh → 119 张，与 [Steel City Solar 的公开示例](https://www.steelcitysolar.com.au/cheaper-home-batteries-rebate) 一致。只比较联邦 STC，不套用其新州州级优惠或不同单价；该页其他行的差异也已记录，见下方详情。 |
| LC08 | 默认值来源、核对日期及复核状态完整 | 通过 | 初检 8 条元数据均为 `human`；F01 最终版本新增 `home_system_scope` 后共 9 条，全部为 `human`，日期覆盖 2026-10-15、2026-10-16、2026-10-18。用户已亲自核对新增记录的两页 CER 来源，[元数据第 92 行起](https://github.com/zserfv233/solar-calc/blob/870312e0d62eb78333b2941b2649a924f3730986/data/defaults-vic.json#L92) 保留独立日期与标记；中英构建来源页均已确认显示人工核对。默认值入口及命名来源见 [`Calculator.astro:90`](../src/components/Calculator.astro#L90)、[`sources.ts:20`](../src/lib/sources.ts#L20)。假设与二手参考价仍按备注区分，不把 `human` 解释为官方保证。 |
| LC09 | 数据结构、HTTPS 来源和异常数值校验 | 通过 | [`schema.ts:4`](../src/lib/schema.ts#L4) 限制来源协议为 HTTPS；[`tests/data.test.ts:18`](../tests/data.test.ts#L18) 覆盖单链接、数组、嵌套来源、合法数据和非 HTTPS 拒绝；范围、效率、日期区间、寿命等测试同文件通过。 |
| LC10 | 邮编分区缺日照记录时阻止构建 | 通过 | [`schema.ts:150`](../src/lib/schema.ts#L150) 执行跨文件校验，加载入口 [`data.ts:9`](../src/lib/data.ts#L9) 必须通过；[`tests/data.test.ts:51`](../tests/data.test.ts#L51) 验证缺失记录被拒绝，第 60 行验证数据模块加载直接失败。 |
| LC11 | 非法输入、溢出、字段错误关联及报价联动 | 通过 | [`tests/calc.test.ts:167`](../tests/calc.test.ts#L167)、[`tests/calculator-ui.test.ts:94`](../tests/calculator-ui.test.ts#L94)、[`tests/calculator-interactions.test.ts:104`](../tests/calculator-interactions.test.ts#L104) 覆盖零/负数、邮编、日期、非有限结果、聚焦和 `aria-invalid`；[`form-behavior.test.ts:34`](../tests/form-behavior.test.ts#L34) 覆盖无参考价清空自动价及保留手填价。页面脚本测试使用表单接口替身，不能代替原生浏览器验收。 |
| LC12 | 超出家用小型模型范围时的容量与政策边界 | 通过 | F01 已在 `codex/f01-capacity-cap` 修复并补验，最终提交 `870312e`。新装和已有太阳能最多 100 kW；100 kW 通过，100.01 / 101 kW 在表单与计算入口拒绝，并显示中英范围提示、聚焦对应字段。覆盖三种方案、暂存恢复及切换方案回归；v0.1 不实现中型系统规则，证据见下方 F01。 |
| LC13 | 三种方案、省钱增量及报价扣补贴 | 通过 | [`tests/calc.test.ts:249`](../tests/calc.test.ts#L249) 核对已扣/未扣补贴及补贴超过报价拒绝；第 259 行验证只加电池等于同户有电池减无电池；[`tests/step7-calc.test.ts:25`](../tests/step7-calc.test.ts#L25) 使用独立手算补贴前报价核对净成本。 |
| LC14 | 两套电池计收益期、回本及无放电边界 | 通过 | [`tests/calc.test.ts:89`](../tests/calc.test.ts#L89) 核对两套寿命与回本；第 174 行验证无放电时不出现零年回本或无穷每度指标；[`tests/step7-calc.test.ts:71`](../tests/step7-calc.test.ts#L71) 验证整体预测期未回本提示。 |
| LC15 | 零上网电价、涨价情景、利用率与账单反推 | 通过 | [`tests/calc.test.ts:89`](../tests/calc.test.ts#L89) 核对零 FiT 及涨价情景，第 85 行核对低利用率提示；[`tests/step7-calc.test.ts:35`](../tests/step7-calc.test.ts#L35) 核对先扣供电费的账单反推；[`hand-calc.md:234`](../tests/fixtures/hand-calc.md#L234) 为独立依据。 |
| LC16 | 后续半年节点及政策期外结果 | 通过 | [`tests/calc.test.ts:129`](../tests/calc.test.ts#L129) 精确核对 2027–2030 半年节点及 2031 年边界；依据为 [`hand-calc.md:259`](../tests/fixtures/hand-calc.md#L259)。无电池或政策期外不显示电池资格提示，见 [`tests/presentation.test.ts:13`](../tests/presentation.test.ts#L13)。 |
| LC17 | 首访语言及手选偏好的逻辑 | 通过 | [`tests/language.test.ts:4`](../tests/language.test.ts#L4) 覆盖 `zh*`、其他语言、偏好优先及存储禁用；静态站入口实际调用该函数，见 [`src/pages/index.astro:11`](../src/pages/index.astro#L11)。本项为逻辑核对，真实跨页体验见 LC18。 |
| LC18 | 浏览器跨页切换语言保留表单、结果和手填状态 | 需用户确认 | [`calculator.ts:130`](../src/scripts/calculator.ts#L130) 暂存状态，第 145 行读取并立即删除；自动测试覆盖太阳能手填报价转移（[`calculator-interactions.test.ts:137`](../tests/calculator-interactions.test.ts#L137)）。仍需实际试三种方案、中英往返、禁用存储和结果恢复，特别检查电价及两项报价不被覆盖。 |
| LC19 | 中英键一致、金额与结果文案 | 通过 | [`tests/calc.test.ts:7`](../tests/calc.test.ts#L7) 核对键一致；[`results.ts:6`](../src/lib/results.ts#L6) 统一 `en-AU` / AUD；[`tests/step7-calc.test.ts:65`](../tests/step7-calc.test.ts#L65) 核对只加电池的增量标签，第 80 行核对金额格式。主卡展示净收益、展开项展示电池增量省钱，见 [`results.ts:57`](../src/lib/results.ts#L57)。 |
| LC20 | 能量流 SVG 数值与无障碍引用 | 通过 | [`tests/energy-flow.test.ts:18`](../tests/energy-flow.test.ts#L18) 核对三种方案、中英电量、无电池分支、零值、唯一 ID 和标题引用；[`energy-flow.ts:14`](../src/lib/energy-flow.ts#L14) 只渲染传入的引擎结果。视觉与手机布局另见 LC21。 |
| LC21 | 手机上无横向滚动、文字与 SVG 不裁切 | 需用户确认 | 已有响应式样式（[`calculator.css:136`](../src/styles/calculator.css#L136)、第 164 行），但 CSS 和结构测试不能证明实机不溢出。需手机竖屏/横屏查看表单、三种结果、长金额、两种语言及来源页。 |
| LC22 | 原生浏览器、键盘及运行时控制台/网络验收 | 需用户确认 | 本轮浏览器工具未列出可用浏览器连接，未执行真实浏览器端到端检查。需用桌面及手机浏览器完成提交、Tab 顺序、错误聚焦、展开结果、首访跳转；检查控制台及网络，确认无运行错误且输入未被请求携带。相关实现为 [`calculator.ts:55`](../src/scripts/calculator.ts#L55)、[`calculator-ui.ts:58`](../src/lib/calculator-ui.ts#L58)。 |
| LC23 | 小字对比度及品牌眉题用途 | 需用户确认 | 已修复的页眉/页脚为 6.315:1、5.996:1，测试 [`accessibility.test.ts:23`](../tests/accessibility.test.ts#L23) 通过；结果区品牌眉题为 3.961:1（[`calculator.css:75`](../src/styles/calculator.css#L75)）。若按普通信息文字验收则低于 4.5:1；需确认该处是否属于品牌标识例外及实际可读性，不能据局部测试宣称整站符合无障碍标准。见下方观察记录。 |
| LC24 | 来源页、待复核标记、二手报价及免责声明入口 | 通过 | 初检两种语言均生成 8 张来源记录卡和 `#disclaimer`；F01 最终版本各有 9 张，新增容量范围记录显示“人工核对 / Human reviewed”。[`Sources.astro:47`](../src/components/Sources.astro#L47) 显示原始元数据，第 58 行展示估算/二手来源/财务免责声明；[`Calculator.astro:34`](../src/components/Calculator.astro#L34) 和第 102 行提供入口；[`source-catalog.test.ts:28`](../tests/source-catalog.test.ts#L28) 验证 AI 标记及嵌套元数据。 |
| LC25 | 外部来源链接在用户浏览器实际可打开 | 需用户确认 | 17 个去重来源中 15 个 HEAD 为 HTTP 200；Sigenergy 与 Solar Choice 的 HEAD 为 403，但网页读取工具可读取 PDF/价格页。不能把反爬响应当作失效，也不能据缓存读取保证用户能打开；详见链接证据表。 |
| LC26 | 隐私文案与存储、无表单上传逻辑一致 | 通过 | [`zh.json:9`](../src/i18n/zh.json#L9)、[`en.json:9`](../src/i18n/en.json#L9) 与 README 及四个中英页面一致；[`calculator.ts:136`](../src/scripts/calculator.ts#L136) 使用标签页暂存、第 146 行删除，长期存储仅语言（[`language.ts:16`](../src/lib/language.ts#L16)）。源码静态扫描无 `fetch`、XHR、Beacon、WebSocket、追踪调用或 cookie 写入；生成表单无 `action`，外部脚本为 0。运行时网络仍在 LC22 确认。 |
| LC27 | README、模型限制、隐私与架构图 | 通过 | [`README.md:37`](../README.md#L37) 起说明模型及来源；第 101 行说明已有面板衰减从预测首年重算，第 164 行列出已知局限，第 181 行为隐私，第 191 行为后续规划。`docs/architecture.svg` XML 可解析且含季节数据文件；README 已引用该图。 |
| LC28 | 依赖与本轮代码/数据保护 | 通过 | [`package.json:13`](../package.json#L13) 的应用依赖为 Astro、Zod，开发依赖为 TypeScript、Vitest，无未使用图表包；本轮未安装依赖。源码无追踪调用，本轮不改源代码、数据或测试。 |
| LC29 | 公开站点与基线 Vercel 状态 | 通过 | 当前主域名的五条页面路径 GET 均为 HTTP 200。GitHub 公共提交状态接口返回基线 SHA、`state: success`，`Vercel: success`；URL 和命令输出见下方部署证据。此项不代替 LC30。 |
| LC30 | 正式域名实际部署版本及生产环境最终体验 | 需用户确认 | GitHub 的成功状态不能单独证明正式域名此刻指向哪次部署。需在 Vercel 核对 Production 对应提交及域名，再在正式网址完成操作；入口为 [中文页](https://solar-calc-snowy.vercel.app/zh/)、[英文页](https://solar-calc-snowy.vercel.app/en/)。检查分支已开 [PR #10](https://github.com/zserfv233/solar-calc/pull/10)（head 为 `codex/step-12-checklist`）；PR 状态不代替生产部署验收。 |
| LC31 | 原执行方案逐项清单的覆盖完整性 | 需用户确认 | 当前按项目规划验收概要展开本表；本地没有原执行方案的独立逐项清单。需用户补充或确认没有遗漏的原条目，不能把未见条目默认通过。 |
| LC32 | 人工检查点与上线范围决定 | 需用户确认 | 用户已决定 F01 采用 100 kW（含）上限，修复与补验完成；仍需完成待确认验收，并核对 main 分支保护后决定是否合并上线。这里只推送检查分支，不合并、不进入后续实施步骤。 |

## 邮编抽查：CER 原表与计算入口

原始来源：[CER 邮编与分区 PDF](https://cer.gov.au/document/postcode-zone-ratings-and-zones-solar-panel-systems)。表格标注基准日期为 2020-01-01。

| 抽查邮编 | CER Table 1 所在项 / PDF 页 | 原表区间 | 原表分区 / 系数 | 本地证据 | 实际函数返回 |
| --- | --- | --- | --- | --- | --- |
| 3000 | 第 37 项 / 第 3 页 | 3000–3035 | 4 / 1.185 | [`postcodes-vic.json:8`](../data/postcodes-vic.json#L8)、[`stc-zones.json:10`](../data/stc-zones.json#L10) | `zone="4", rating=1.185` |
| 3350 | 第 58 项 / 第 4 页 | 3340–3758 | 3 / 1.382 | [`postcodes-vic.json:29`](../data/postcodes-vic.json#L29)、[`stc-zones.json:10`](../data/stc-zones.json#L10) | `zone="3", rating=1.382` |
| 8000 | 第 136 项 / 第 8 页 | 7000–8999 | 4 / 1.185 | [`postcodes-vic.json:33`](../data/postcodes-vic.json#L33) 只收录该段的维州部分 | `zone="4", rating=1.185` |

另有 [`tests/calc.test.ts:203`](../tests/calc.test.ts#L203) 检查本地全部区间的起止点；它证明函数与本地表一致，不能代替上面的官方原表抽查。

## 电池补贴公开示例核对

[Steel City Solar 的联邦电池补贴说明](https://www.steelcitysolar.com.au/cheaper-home-batteries-rebate) 的“STC rebate by battery size”列出 10 kWh 为 68 张、20 kWh 为 119 张。本地在同一 May–December 2026 政策段，使用 `2026-11-01` 调用 `batteryStcs`，分别返回 68、119，匹配。

此核对只采用上述两行。该页面使用约 AUD 37/STC，并包含新州额外政策，不作为本项目默认金额的标准答案。该页 13.5 kWh 行保留了非整数，40 kWh 行写 165；本地 40 kWh 返回 164。不能把安装商整页视为权威，或为迎合这些行而改本地数据。

以 [CER 的三档规则](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/calculate-small-scale-technology-certificate-entitlements) 独立计算 40 kWh 的分档总数为 `14×6.8 + 14×6.8×0.6 + 12×6.8×0.15 = 164.56`，向下取整为 164；不是从引擎反推期望值。[DCCEEW 的 STC 说明](https://www.dcceew.gov.au/energy/programs/cheaper-home-batteries/small-scale-technology-certificates)“STC calculation”也明确要求部分证书数向下取整。

现有数据备注及 README 仍把电池向下取整称为保守模型选择。新的官方取整说明可在以后维护来源备注时补充；本轮不更新数据或文案，取整数值本身与官方一致。

## F01：容量适用范围防护——补验通过

修复分支：`codex/f01-capacity-cap`。最终版本：[`870312e0d62eb78333b2941b2649a924f3730986`](https://github.com/zserfv233/solar-calc/commit/870312e0d62eb78333b2941b2649a924f3730986)。实现提交为 `f3813d1`，追加状态回归测试为 `53dbc40`，最终提交记录用户人工核对 CER 来源；此状态仅指修复分支，不代表已经合入 main 或上线。

- 容量上限来自 [data/defaults-vic.json 的 `home_system_scope`](https://github.com/zserfv233/solar-calc/blob/870312e0d62eb78333b2941b2649a924f3730986/data/defaults-vic.json#L92)，为 100 kW，`last_checked=2026-10-18`、`checked_by=human`；用户已亲自核对该记录的两页 CER 来源。
- [计算入口第 14–20 行](https://github.com/zserfv233/solar-calc/blob/870312e0d62eb78333b2941b2649a924f3730986/src/lib/calc.ts#L14) 从数据读取上限；新装和已有太阳能输入、独立面板 STC 入口共同拒绝超限。v0.1 不实现中型系统规则。
- [容量回归测试第 22 行起](https://github.com/zserfv233/solar-calc/blob/870312e0d62eb78333b2941b2649a924f3730986/tests/capacity-scope.test.ts#L22) 验证三种方案下 100 kW 通过、100.01 / 101 kW 拒绝及错误字段映射。[页面回归第 240 行起](https://github.com/zserfv233/solar-calc/blob/870312e0d62eb78333b2941b2649a924f3730986/tests/calculator-interactions.test.ts#L240) 验证 `sessionStorage` 恢复时 `hasResult=true/false`、超限后切换方案再切回，以及 `solar_battery` 的边界提交；中英提示、字段聚焦及 `aria-invalid` 均有覆盖。
- 最终版本实际执行 `npm test`：`tsc --noEmit && vitest run`，13 个文件、233 项通过；`npm run build`：5 页构建通过。解析中英构建来源页，各有 9 条 `human` 记录，容量范围记录日期为 2026-10-18，分别显示“人工核对”和“Human reviewed”，没有待复核样式。

### 原始问题与证据（初检基线，保留历史复现）

复现输入中的 101 kW 是边界探针，不是市场默认值；其他输入沿用现有手算公共输入或参考报价。

```text
existingSolarKw=101, batteryKwh=20, date=2026-11-01, mode=battery_only
battery = { count:119, applicable:true, reason:"applicable" }
notices = ["batteryRebateEligibilityNotice"]

panelStcs(101, 3000, "2026-11-01") = { count:598, applicable:true }
panelStcs(101, 3000, "2027-01-01") = { count:478, applicable:true }
```

证据链：

- [`calc.ts:18`](../src/lib/calc.ts#L18) 的新装和已有太阳能容量仅要求正数；[`calc.ts:79`](../src/lib/calc.ts#L79) 对任何非零容量使用同一年度视同年限表。页面范围也未设上限，见 [`Calculator.astro:69`](../src/components/Calculator.astro#L69)。
- [CER 电池资格说明](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-batteries) 当前要求配套光伏不超过 100 kW。现有提示仅涉及电池标称容量，不提示这个配套光伏条件。
- 同时，[CER 中型太阳能说明](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/mid-scale-solar) 已公布：符合条件、在 2026-10-01 起安装的 100 kW–1 MW 系统适用新安排，采用固定 5 年视同年限。故不能把超过 100 kW 简单断言为“一律没有面板 STC”，也不能默认套用本地 2027 年的递减年限。
- 现有待办已记录容量上限需先找来源（[`docs/todo.md:9`](todo.md#L9)）；本次找到了区分适用范围的官方依据。问题是当前家庭模型没有限制/警示其范围，也没有实现中型规则，并非建议立即把某个上限写死。

用户已决定限制并明确提示不支持超出当前家用模型范围的输入，修复及补验结果见本节开头。电池标称容量资格检查仍按已有决定留待后续版本，不能拿可用容量替代标称容量。

## 浏览器与可读性观察

浏览器工具本轮返回 `browsers: []`，随后连接 Chrome 也返回 `cgWindowNotFound`，所以没有将任何实机交互、手机布局或运行时网络检查标为通过。页面事件自动测试执行真实页面脚本，但使用表单接口替身；不能证明原生输入控件、字体、焦点和滚动行为在各浏览器中一致。

以 CSS 指定颜色及页面背景 `#fafbf8` 计算：

| 对象 | 颜色 | 对比度 | 说明 |
| --- | --- | --- | --- |
| 页眉眉题 | `#4d634b` | 6.315:1 | 已超过 4.5:1 |
| 页脚文字 | `#52664f` | 5.996:1 | 已超过 4.5:1 |
| 结果区 `SOLAR CALC` 眉题 | `#728267` | 3.961:1 | 普通信息性小字标准下不足；品牌标识适用性及实机阅读需确认 |

[W3C 对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) 给普通文字 4.5:1 阈值，并列出纯装饰和品牌标识例外。这里不自行认定例外适用，也不把整站描述为已通过无障碍验收。对应主表 LC23。

## 命令与运行输出摘要

```bash
npm test
npm run build
```

```text
npm test = tsc --noEmit && vitest run
Test Files  12 passed (12)
Tests       176 passed (176)
astro build: 5 page(s) built; Complete!
```

本地服务检查实际使用：

```bash
npm run preview -- --host 127.0.0.1 --port 4329
```

通过标准库 HTTP 客户端 GET 五条页面路径，均返回 `200 text/html`。另解析 `dist/` 所有 HTML 的链接、锚点和本地脚本路径，得到 `built_html_pages=5, broken_internal_links_or_assets=0`。两个来源页各有 `source_records=8, disclaimer=true`；计算器页分别为 `lang=zh-CN / en-AU`，表单无 `action`、外部脚本数为 0。检查后已停止本地预览服务。

邮编、安装商和边界探针通过已安装的 Vite 读取实际模块；复现命令无需安装新包：

```bash
node --input-type=module - <<'JS'
import { createServer } from 'vite';
const server = await createServer({ configFile:false, server:{middlewareMode:true}, appType:'custom' });
try {
  const c = await server.ssrLoadModule('/src/lib/calc.ts');
  const { stcZones } = await server.ssrLoadModule('/src/lib/data.ts');
  for (const p of [3000,3350,8000]) {
    const z = c.zoneForPostcode(p);
    console.log(p, z, stcZones.values.zone_ratings[z]);
  }
  for (const kwh of [10,20,40]) console.log(kwh, c.batteryStcs(kwh,'2026-11-01'));
  console.log(c.panelStcs(101,3000,'2026-11-01'));
  console.log(c.panelStcs(101,3000,'2027-01-01'));
  const r = c.calculateProject({mode:'battery_only',postcode:3000,
    installationDate:'2026-11-01',existingSolarKw:101,batteryKwh:20,
    daytimeShare:'partly_home',solarQuote:0,batteryQuote:16490});
  console.log(r.subsidies.battery, r.notices);
} finally { await server.close(); }
JS
```

手算重算时只在内存 AST 中移除脚本末尾的 `write_text` 调用，并抑制打印，然后将生成的 `out` 与原文件逐字比较。结果 `independent_hand_calc_matches_fixture=True`；原手算文件 SHA-256 为 `5116ca4408c42eb4d0ad9a614216c5735f657c9a797dc7d6e6047b79ccc581cf`。脚本和手算文件均未写回。

## 外部来源与部署证据

去重来源清单来自数据中的 `source`，以标准库 HTTP 客户端并发执行 HEAD。以下是直接请求结果，不把 HTTP 可达误称为数值已重新人工复核。

| 来源 URL | 直接 HEAD 结果 |
| --- | --- |
| [CER 邮编表](https://cer.gov.au/document/postcode-zone-ratings-and-zones-solar-panel-systems) | 200 |
| [CER 电池调整公告](https://cer.gov.au/news-and-media/media/2026/march/battery-rebates-are-changing-1-may-2026) | 200 |
| [CER 电池纳入公告](https://cer.gov.au/news-and-media/news/2025/may/solar-batteries-to-be-eligible-under-small-scale-renewable-energy-scheme) | 200 |
| [CER 电池要求](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-batteries) | 200 |
| [CER STC 计算规则](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/calculate-small-scale-technology-certificate-entitlements) | 200 |
| [Tesla 质保 PDF](https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/General/Warranty/en-au/Powerwall-Warranty-AU-NZ-EN.pdf) | 200 |
| [BYD 质保 PDF](https://saegroup.com.au/wp-content/uploads/BYD-Battery-Box-Premium-HVS-HVM-Limited-Warranty-Letter-AU-v1.0.pdf) | 200 |
| [AER 用电基准 PDF](https://www.aer.gov.au/system/files/Residential%20energy%20consumption%20benchmarks%20-%209%20December%202020_0.pdf) | 200 |
| [BOM Bendigo](https://www.bom.gov.au/climate/averages/tables/cw_081123_All.shtml) | 200 |
| [BOM Melbourne](https://www.bom.gov.au/climate/averages/tables/cw_086338_All.shtml) | 200 |
| [Ecovantage 周报](https://www.ecovantage.com.au/features/market-update-9-october-2026/) | 200 |
| [政府电池寿命参考](https://www.energy.gov.au/solar/use-your-solar-system/replace-and-recycle-your-solar-system) | 200 |
| [Energy Matters 参考价](https://www.energymatters.com.au/renewable-news/how-much-will-batteries-cost-when-the-federal-battery-rebate-reduces-from-1-may-2026/) | 200 |
| [ESC 上网电价](https://www.esc.vic.gov.au/electricity-and-gas/electricity-and-gas-tariffs-and-benchmarks/minimum-feed-tariff) | 200 |
| [ESC VDO](https://www.esc.vic.gov.au/electricity-and-gas/prices-tariffs-and-benchmarks/victorian-default-offer) | 200 |
| [Sigenergy 质保 PDF](https://www.sigenergy.com/uploads/au_download/1779788087551504.pdf) | 403；网页读取工具可读到 PDF，用户浏览器待确认 |
| [Solar Choice 参考价](https://www.solarchoice.net.au/solar-panels/solar-power-system-prices/) | 403；网页读取工具可读到价格页，用户浏览器待确认 |

线上 GET `/`、`/zh/`、`/en/`、`/zh/sources/`、`/en/sources/` 均返回 200，基于 `https://solar-calc-snowy.vercel.app`。

[GitHub 基线提交状态接口](https://api.github.com/repos/zserfv233/solar-calc/commits/ae488a5/status) 本次返回：

```text
sha: ae488a50dca33be5b2cca8750ced6fc38ec59d6f
state: success
context: Vercel
Vercel state: success
```

正式域名与具体 Production 部署的关联仍须在 Vercel 确认，不把提交状态当作域名版本证明。

## 已接受的限制与后续动作

- 电池标称容量资格检查当前只提示，后续才增加真正检查；见 [`calc.ts:62`](../src/lib/calc.ts#L62)。不将已确认的范围决定重新算成此次缺陷。
- 小电池、高夜间负荷、年中达到吞吐上限的独立手算用例留到后续版本（[`docs/todo.md:8`](todo.md#L8)）。已有性质测试验证年中折算和能量守恒（[`tests/calc.test.ts:273`](../tests/calc.test.ts#L273)），但不能替代尚未补充的独立财务手算。
- 错误分类仍依赖比对错误原文，改成专门错误类型已记录（[`docs/todo.md:10`](todo.md#L10)）。本轮不重构。
- F01 已按用户决定修复，来源已人工核对；合并与部署仍由用户决定。其余人工项按主表逐项记录设备、浏览器、网址及结论，再进入用户最终上线决定。

交付范围可用以下命令核对：

```bash
git diff ae488a5 --name-only
git diff ae488a5 -- src data tests package.json package-lock.json
```

预期仅本报告新增，第二条命令无差异。完成本步后停在人工检查点，不自行合并或继续下一步。
