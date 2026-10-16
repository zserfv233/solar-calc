"""
第 3 步手算脚本：完全不调用 src/lib/calc.ts，按计算模型逐步计算，输出 tests/fixtures/hand-calc.md。
运行：python3 tests/fixtures/hand_calc.py
政策、价格和质保数字从 data/ 读取；用例自身的输入写在 CASES 里。

模型相对执行方案原文的修订（2026-10-15 用户确认）：
- 第 1 层：电池默认每天充满，按稳定状态计算。C 是「可用容量」，指电池能放出来给家里用的电量（放电端），
  所以 B_out = min(E×η, C_n, L_night)，充进去的电 B = B_out/η（2026-10-16 按核查报告修正测量端）。
  头天晚上没用完的电留在电池里，第二天只需补充用掉的部分。
- 第 2 层：电池利用率 = 全年平均每天放电 B_out ÷ C（第 1 年；2026-10-16 改为放电端，避免超过 100%）。
- 四季各一个平均日（2026-10-16 用户确认 v0.1 先做这一种）：全年发电仍按 CER 分区系数 P×R×1000，
  按 BOM 月平均日照拆到四季；年用电按 AER 四季用电拆到四季。每季按平均一天算 D、E、B_out、B、X，
  再乘以该季天数加总成全年。
- 第 3 层：分别按质保年限和预期寿命区间上端计电池收益，两种情景都受吞吐上限约束；
  吞吐上限在年中触发时，按当年剩余额度折算电池收益。容量从 100% 线性衰减（第 n 年取年初容量）。
  预期寿命情景在质保期后沿用相同衰减速度和吞吐上限，属于额外假设。电池停止计收益后太阳能板继续发电。
"""
import json, math, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
load = lambda n: json.loads((ROOT / "data" / n).read_text())["values"]
postcodes, zones, battery, defaults, seasonal = (load(n) for n in
    ["postcodes-vic.json", "stc-zones.json", "battery-rebate.json", "defaults-vic.json", "seasonal-vic.json"])
A, Q, W = defaults["assumptions_from_plan"], defaults["typical_quotes_after_rebate"], defaults["battery_warranty"]

def zone_of(pc):
    return next(r["zone"] for r in postcodes["ranges"] if r["from"] <= pc <= r["to"])

def battery_factor(date):
    return next(p["factor"] for p in battery["factor_periods"] if p["start"] <= date <= p["end"])

def daily(G, L_day, L_night, C, eta):
    D = min(G, L_day); E = G - D
    B_out = min(E * eta, C, L_night) if C > 0 else 0.0
    B = B_out / eta; X = E - B
    return D, E, B, B_out, X

SEASON_ZH = {"summer": "夏", "autumn": "秋", "winter": "冬", "spring": "春"}

def season_split(z):
    """每季的 (名称, 天数, 发电占全年比例, 用电占全年比例)。"""
    mj, dm = seasonal["solar_mj_per_m2_day_by_zone"][str(z)]["monthly"], seasonal["days_in_month"]
    total_mj = sum(mj[m] * dm[m] for m in range(12))
    total_load = sum(seasonal["load_kwh_by_season"].values())
    res = []
    for s_ in seasonal["seasons"]:
        ms = [m - 1 for m in s_["months"]]
        res.append((s_["name"], sum(dm[m] for m in ms), sum(mj[m] * dm[m] for m in ms) / total_mj,
                    seasonal["load_kwh_by_season"][s_["name"]] / total_load))
    return res

def year_flows(z, G_year, share, C, eta):
    """一年的电量（kWh/年）：四季各一个平均日，乘天数加总。返回 (D, B, B_out, X, 每季明细)。"""
    tot = [0.0, 0.0, 0.0, 0.0]; rows = []
    for name, days, gs, ls in season_split(z):
        G = G_year * gs / days; L = annual * ls / days
        L_day = L * share; L_night = L - L_day
        D, E, B, B_out, X = daily(G, L_day, L_night, C, eta)
        rows.append((name, days, G, L_day, L_night, D, E, B_out, B, X))
        for i, v in enumerate((D, B, B_out, X)): tot[i] += days * v
    return (*tot, rows)

def battery_stcs(C, date):
    """电池 STC 张数：资格日期之外为 0；2026-05-01 前按全部可用容量计，之后按三档；最多计 50 kWh。"""
    last_end = battery["factor_periods"][-1]["end"]
    if C <= 0 or date < battery["eligible_from"] or date > last_end:
        return 0, 0.0
    Ce = min(C, battery["stc_cap_usable_kwh"])
    if date < battery["tiers_effective_from"]:
        eff = Ce
    else:
        eff = sum(t["share"] * max(0.0, min(Ce, t["to_kwh"]) - t["from_kwh"]) for t in battery["tiers"])
    return math.floor(battery_factor(date) * eff), eff

CASES = [
    dict(name="用例 1：墨尔本，6.6 kW，无电池，上班族", postcode=3000, P=6.6, C=0, share="away",
         install="2026-11-01", solar_quote=Q["solar_6_6kw_dollars"], battery_quote=0, mode="solar"),
    dict(name="用例 2：墨尔本，6.6 kW + 10 kWh 电池，基本在家", postcode=3000, P=6.6, C=10, share="mostly_home",
         install="2026-11-01", solar_quote=Q["solar_6_6kw_dollars"], battery_quote=Q["battery_10kwh_dollars"], mode="solar"),
    dict(name="用例 3：已有 6.6 kW 太阳能，只加 20 kWh 电池，部分在家", postcode=3000, P=6.6, C=20, share="partly_home",
         install="2026-11-01", solar_quote=0, battery_quote=Q["battery_20kwh_dollars"], mode="battery_only"),
]
FIT = 5.0  # 测试输入：模拟用户照电费单填的上网电价（c/kWh），不是默认值（默认是 0）
p0 = defaults["vdo_flat_2026_27"][defaults["default_distributor"]]["usage_c_per_kwh"] / 100
f = FIT / 100
eta, deg = A["round_trip_efficiency"], A["panel_degradation_per_year"]
annual = defaults["annual_usage_kwh"]
fmt = lambda x, n=3: f"{x:,.{n}f}"

out = ["# 手算结果（第 3 步）", "",
       "由 `tests/fixtures/hand_calc.py` 生成，不调用 `calc.ts`。第 5 步的测试期望值以本文件为准（误差 < 1%）。", "",
       "## 公共输入", "",
       f"- 买电电价 p = {p0*100:.2f} c/kWh（{defaults['default_distributor']}，VDO 2026–27）",
       f"- 上网电价 f = {FIT} c/kWh（**测试输入**，模拟用户照电费单填写；网站默认是 0）",
       f"- 年用电量 = {annual} kWh，按 AER 四季用电比例拆到夏/秋/冬/春；全年发电按 BOM 月平均日照拆到四季",
       f"- 充放电效率 η = {eta}，面板年衰减 = {deg}，STC 单价 = ${defaults['stc_price_dollars']}",
       f"- 报价用参考价，**已扣补贴**，所以净成本 = 报价，下表里的 STC 张数只作核对",
       f"- 电池质保：{W['warranty_years']} 年，末期保留 {W['end_of_warranty_retention']:.0%}，"
       f"吞吐上限每 kWh 可用容量 {W['throughput_mwh_per_usable_kwh']} MWh",
       "- 每季按平均一天计算，再乘该季天数加总；电池按「默认充满」的稳定状态计算：B_out = min(E×η, C_n, L_night)，B = B_out/η（C 为放电端可用容量）",
       f"- 第 n 年容量 C_n = C×[1 − {1-W['end_of_warranty_retention']:.1f}×(n−1)/{W['warranty_years']}]，"
       f"超过所选计收益年限或吞吐上限后不计电池收益（不代表电池报废）；吞吐上限年中触发时按剩余额度折算",
       "- 分别按质保期和预期寿命区间上端计电池收益；预期寿命情景在质保期后沿用相同衰减速度和吞吐上限，属于额外假设",
       "- 逐年计算：第 n 年发电 G×(1−衰减)^(n−1)，电价 p×(1+涨幅)^(n−1)，上网电价不变", ""]

EL = defaults["battery_expected_life"]["lithium_ion_years_max"]
WY = W["warranty_years"]

def simulate(c, esc, life_years, fit, C=None):
    """逐年计算。返回 (回本年份或 None, 10 年累计省钱, 电池计收益的年数, 电池累计放电 kWh, 净成本, 逐年累计省钱)。"""
    Cc = c["C"] if C is None else C
    net = c["solar_quote"] + (c["battery_quote"] if Cc > 0 else 0)
    z = zone_of(c["postcode"]); R = zones["zone_ratings"][str(z)]
    share = A["daytime_share"][c["share"]]
    G_year = c["P"] * R * 1000
    limit_kwh = Cc * W["throughput_mwh_per_usable_kwh"] * 1000
    fr = fit / 100
    cum, cum_out, payback, cum10, years, cums = 0.0, 0.0, None, None, 0, []
    for n in range(1, 31):
        Gn = G_year * (1 - deg) ** (n - 1); pn = p0 * (1 + esc) ** (n - 1)
        Cn = 0.0
        if Cc > 0 and n <= life_years and cum_out < limit_kwh:
            Cn = max(0.0, Cc * (1 - (1 - W["end_of_warranty_retention"]) * (n - 1) / WY))
        saving = lambda d, b, bo, x: ((d + bo) * pn + x * fr if c["mode"] == "solar"
                                      else bo * pn - b * fr)
        d, b, bo, x, _ = year_flows(z, Gn, share, Cn, eta)
        k = min(1.0, (limit_kwh - cum_out) / bo) if bo > 0 else 0.0  # 当年电池可用的比例
        if k > 0: years = n
        d0, b0, bo0, x0, _ = year_flows(z, Gn, share, 0.0, eta)
        cum += k * saving(d, b, bo, x) + (1 - k) * saving(d0, b0, bo0, x0)
        cum_out += k * bo
        if payback is None and cum >= net: payback = n
        if n == 10: cum10 = cum
        cums.append(cum)
    if c["mode"] == "battery_only" and cum_out == 0:
        payback = None
    return payback, cum10, years, cum_out, net, cums

def incremental_payback(c, esc, life_years, fit):
    """电池增量回本：逐年比较有电池和没电池的累计省钱差，第一次 ≥ 电池成本的年份。"""
    with_battery = simulate(c, esc, life_years, fit)
    if with_battery[3] == 0:
        return None
    w_ = with_battery[5]
    o_ = simulate(c, esc, life_years, fit, C=0)[5] if c["mode"] == "solar" else [0.0] * 30
    return next((i + 1 for i in range(30) if w_[i] - o_[i] >= c["battery_quote"]), None)

def pb_text(pb, years, has_batt):
    if has_batt and not years:
        return "电池未放电，无法计算增量回本" + (f"（整体方案第 {pb} 年回本）" if pb else "")
    if has_batt and (pb is None or pb > years):
        return f"按当前假设，电池计收益的 {years} 年内未回本" + (f"（第 {pb} 年）" if pb else "")
    return f"第 {pb} 年" if pb else "30 年内不回本"

def per_kwh_text(value, discharge):
    return f"${value/discharge:,.3f}/kWh" if discharge > 0 else "—（无放电）"

for c in CASES:
    z = zone_of(c["postcode"]); R = zones["zone_ratings"][str(z)]
    year = int(c["install"][:4]); Y = zones["deeming_years_by_install_year"][str(year)]
    F = battery_factor(c["install"])
    share = A["daytime_share"][c["share"]]
    G_year = c["P"] * R * 1000
    Cc = c["C"]; has_b = Cc > 0
    D, B, B_out, X, rows = year_flows(z, G_year, share, Cc, eta)
    if c["mode"] == "solar":
        S1 = (D + B_out) * p0 + X * f
        N_panel = math.floor(c["P"] * R * Y)
    else:  # 只加电池：只算电池带来的增量
        S1 = B_out * p0 - B * f
        N_panel = 0
    N_batt, tier = battery_stcs(Cc, c["install"])
    net = simulate(c, 0, WY, FIT)[4]
    limit_kwh = Cc * W["throughput_mwh_per_usable_kwh"] * 1000
    util = B_out / 365 / Cc if has_b else None

    out += [f"## {c['name']}", "",
            f"输入：邮编 {c['postcode']} → 分区 {z}，R = {R}；系统 P = {c['P']} kW；电池 C = {Cc} kWh；"
            f"白天用电占比 {share}；安装 {c['install']}；报价（已扣补贴）${net:,}", "",
            f"四季平均一天（第 1 年，kWh/天；全年发电 P×R×1000 = {G_year:,.1f} kWh）：", "",
            "| 季节 | 天数 | G | L_day | L_night | D | E | B_out | B | X |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    out += [f"| {SEASON_ZH[r[0]]} | {r[1]} | " + " | ".join(fmt(v, 2) for v in r[2:]) + " |" for r in rows]
    out += ["",
            "| 全年合计（第 1 年） | 公式 | 结果 |", "| --- | --- | --- |",
            f"| D | Σ 天数×D | {fmt(D, 1)} kWh |",
            f"| B_out | Σ 天数×B_out | {fmt(B_out, 1)} kWh |",
            f"| B | Σ 天数×B | {fmt(B, 1)} kWh |",
            f"| 电池损耗 | B − B_out | {fmt(B-B_out, 2)} kWh |",
            f"| X | Σ 天数×X | {fmt(X, 1)} kWh |",
            (f"| S（第 1 年） | (D+B_out)×p + X×f | ${fmt(S1,2)} |" if c["mode"] == "solar"
             else f"| S（第 1 年，增量） | B_out×p − B×f | ${fmt(S1,2)} |"),
            f"| 电池利用率 | (B_out/365)/C | {util:.1%} |" if has_b else "| 电池利用率 | 无电池 | — |",
            f"| 吞吐上限 | C×{W['throughput_mwh_per_usable_kwh']} MWh | {limit_kwh/1000:,.1f} MWh |",
            f"| N_panel（核对用） | ⌊P×R×{Y}⌋ | {N_panel} 张 |",
            f"| N_batt（核对用） | ⌊{F}×{fmt(tier,2)}⌋（2026-05-01 起三档，最多 50 kWh） | {N_batt} 张 |",
            f"| 净成本 | 报价已扣补贴 | ${net:,.2f} |", ""]

    bases = [("按质保期计电池收益", WY)] + ([(f"按预期寿命 {EL} 年（政府指南 10–15 年的上端情景）", EL)] if has_b else [])
    for label, life in bases:
        out += [f"**{label}**（上网电价 {FIT} c/kWh）" if has_b else f"**结果**（上网电价 {FIT} c/kWh）", "",
                "| 电价年涨幅 | 回本 | 电池计收益年数 | 10 年累计省钱 | 10 年净收益（未计维护及资金成本） | 电池累计放电 |",
                "| --- | --- | --- | --- | --- | --- |"]
        for esc in A["price_escalation_scenarios"]:
            pb, c10, yrs, co, nt, _ = simulate(c, esc, life, FIT)
            benefit_text = (f"{yrs} 年" if yrs else "未放电") if has_b else "—"
            out.append(f"| {int(esc*100)}% | {pb_text(pb, yrs, has_b)} | {benefit_text} | "
                       f"${c10:,.2f} | ${c10-nt:,.2f} | {f'{co/1000:,.1f} MWh' if has_b else '—'} |")
        out.append("")

    for label, life in bases:
        out += [f"**上网电价为 0 时的对比**（{label}）", "",
                "| 电价年涨幅 | 回本：{0} c → 0 c | 10 年净收益：{0} c → 0 c |".format(FIT), "| --- | --- | --- |"]
        for esc in A["price_escalation_scenarios"]:
            a_ = simulate(c, esc, life, FIT); b_ = simulate(c, esc, life, 0.0)
            out.append(f"| {int(esc*100)}% | {pb_text(a_[0], a_[2], has_b)} → {pb_text(b_[0], b_[2], has_b)} | "
                       f"${a_[1]-a_[4]:,.2f} → ${b_[1]-b_[4]:,.2f} |")
        out.append("")

    if has_b:
        # 电池增量：同一家庭、同一太阳能条件下，有电池减去没电池（只加电池的用例本身就是增量）
        out += ["**电池部分单独看**（同一家庭、同样的太阳能，有电池 − 没电池）", "",
                "| 计算口径 | 电价年涨幅 | 电池成本 | 电池带来的 10 年增量省钱 | 增量回本 | 每放 1 度电的电池成本 | 每放 1 度电平均替你省的钱 |",
                "| --- | --- | --- | --- | --- | --- | --- |"]
        for label, life in bases:
            for esc in A["price_escalation_scenarios"]:
                cost = c["battery_quote"]
                if c["mode"] == "solar":
                    w_ = simulate(c, esc, life, FIT); o_ = simulate(c, esc, life, FIT, C=0)
                    inc10 = w_[1] - o_[1]; inc_life = w_[5][life - 1] - o_[5][life - 1]
                    co, yrs = w_[3], w_[2]
                else:
                    w_ = simulate(c, esc, life, FIT); inc10 = w_[1]; inc_life = w_[5][life - 1]
                    co, yrs = w_[3], w_[2]
                inc_pb = incremental_payback(c, esc, life, FIT)
                out.append(f"| {label} | {int(esc*100)}% | ${cost:,} | ${inc10:,.2f} | {pb_text(inc_pb, yrs, True)} | "
                           f"{per_kwh_text(cost, co)} | {per_kwh_text(inc_life, co)} |")
        out += ["", f"说明：「每放 1 度电的电池成本」= 电池成本 ÷ 计收益期间累计放电量，思路同 HOMER 的电池损耗成本；"
                f"「每放 1 度电平均替你省的钱」= 同一期间电池带来的累计增量省钱 ÷ 同一期间累计放电量，已包含电价上涨和少卖的上网电量（放 1 度电要少卖 1/η 度）。"
                f"两者口径相同，所以前者高于后者，就等于这段期间内电池单独看回不了本。", ""]

out += ["## 电池 STC 边界核对（第 5 步边界测试用）", "",
        "| 可用容量 | 安装日期 | 计入容量 | STC 张数 | 说明 |", "| --- | --- | --- | --- | --- |"]
for Cb, dt, why in [(20, "2026-04-30", "分档生效前，全部容量按 100%"), (20, "2026-05-01", "分档生效当天"),
                    (14, "2026-11-01", "正好第一档上限"), (28, "2026-11-01", "正好第二档上限"),
                    (50, "2026-11-01", "正好 50 kWh 上限"), (60, "2026-11-01", "超过 50 kWh 的部分不计"),
                    (20, "2025-06-30", "早于 2025-07-01，不适用"), (20, "2031-01-01", "晚于系数表，不适用")]:
    n_, eff_ = battery_stcs(Cb, dt)
    out.append(f"| {Cb} kWh | {dt} | {fmt(eff_, 2)} kWh | {n_} 张 | {why} |")
out.append("")

out += ["## 第 7 步补充核对（独立手算，不调用 calc.ts）", "",
        "### 用例 2：报价未扣补贴", ""]
c2 = CASES[1]
panel_count = math.floor(c2["P"] * zones["zone_ratings"][str(zone_of(c2["postcode"]))] * zones["deeming_years_by_install_year"][c2["install"][:4]])
battery_count = battery_stcs(c2["C"], c2["install"])[0]
panel_value = panel_count * defaults["stc_price_dollars"]
battery_value = battery_count * defaults["stc_price_dollars"]
out += ["把已扣补贴报价加回对应 STC 金额，构造同一系统的补贴前报价，再扣回补贴。", "",
        "| 项目 | 金额 |", "| --- | --- |",
        f"| 面板补贴（{panel_count} × ${defaults['stc_price_dollars']}） | ${panel_value:,.2f} |",
        f"| 电池补贴（{battery_count} × ${defaults['stc_price_dollars']}） | ${battery_value:,.2f} |",
        f"| 太阳能补贴前报价 | ${c2['solar_quote']+panel_value:,.2f} |",
        f"| 电池补贴前报价 | ${c2['battery_quote']+battery_value:,.2f} |",
        f"| 扣补贴后太阳能成本 | ${c2['solar_quote']:,.2f} |",
        f"| 扣补贴后电池成本 | ${c2['battery_quote']:,.2f} |",
        f"| 净成本 | ${c2['solar_quote']+c2['battery_quote']:,.2f} |", "",
        "### 电费单反推全年用电", ""]
billing_days = 90  # 使用原手算夏季天数作为测试账期；是输入，不是默认账期。
supply = defaults["vdo_flat_2026_27"][defaults["default_distributor"]]["supply_dollars_per_day"]
bill = round(annual * billing_days / 365 * p0 + supply * billing_days, 2)
recovered = (bill - supply * billing_days) / p0 * 365 / billing_days
out += [f"测试输入：{defaults['default_distributor']}，买电 {p0*100:.2f} c/kWh，供电费 ${supply}/天，账期 {billing_days} 天。",
        "从原手算全年用电构造账单并取整到澳分，再按账单反推；账单取整会产生微小误差。", "",
        "| 项目 | 公式 | 结果 |", "| --- | --- | --- |",
        f"| 账单总额 | round(年用电×账期/365×p + 供电费×账期, 2) | ${bill:,.2f} |",
        f"| 反推全年用电 | (账单总额 − 供电费×账期)/p×365/账期 | {recovered:,.6f} kWh |", "",
        "### 用例 2：整体 30 年不回本的显示压力用例", "",
        "仅把原用例 2 的两项已扣补贴报价放大 10 倍，用于验证未回本的展示；不是市场报价或默认值。其他输入不变。", ""]
stress = dict(c2, solar_quote=c2["solar_quote"] * 10, battery_quote=c2["battery_quote"] * 10)
out += [f"太阳能报价 ${stress['solar_quote']:,}，电池报价 ${stress['battery_quote']:,}，净成本 ${stress['solar_quote']+stress['battery_quote']:,}。", "",
        "| 电池计收益口径 | 电价年涨幅 | 整体回本 |", "| --- | --- | --- |"]
for life in [WY, EL]:
    for esc in A["price_escalation_scenarios"]:
        pb = simulate(stress, esc, life, FIT)[0]
        out.append(f"| {life} 年 | {int(esc*100)}% | " + ("30 年内未回本" if pb is None else f"第 {pb} 年") + " |")
out.append("")

out += ["## 2027–2031 半年节点 STC 核对", "",
        "独立读取 data/ 的政策参数计算，不调用 calc.ts；输入为 6.6 kW 面板、20 kWh 可用容量电池、邮编 3000。",
        "每年取 1 月 1 日和 7 月 1 日，共 10 个节点；2031 年已超出政策期，面板与电池 STC 均不适用（张数为 0）。", ""]
stc_panel_kw, stc_battery_kwh, stc_postcode = 6.6, 20, 3000
stc_zone = zone_of(stc_postcode)
stc_rating = zones["zone_ratings"][str(stc_zone)]

def panel_stcs(P, postcode, date):
    """面板 STC：按安装年视同年限向下取整；政策表之外为 0。"""
    years = zones["deeming_years_by_install_year"].get(date[:4], 0)
    return math.floor(P * zones["zone_ratings"][str(zone_of(postcode))] * years)

stc_effective_capacity = battery_stcs(stc_battery_kwh, "2027-01-01")[1]
baseline = "2026-12-31"
out += [f"邮编 {stc_postcode} → 分区 {stc_zone}，R = {stc_rating}。面板张数 = ⌊{stc_panel_kw}×R×视同年限⌋；"
        f"电池分档计入容量为 {stc_effective_capacity:g} kWh，张数 = ⌊计入容量×当期系数⌋。", "",
        f"切换前基线 {baseline}：面板 {panel_stcs(stc_panel_kw, stc_postcode, baseline)} 张，"
        f"电池 {battery_stcs(stc_battery_kwh, baseline)[0]} 张。", "",
        "| 安装日期 | 视同年限 | 电池系数 | 面板 STC（张） | 电池 STC（张） |",
        "| --- | --- | --- | --- | --- |"]
for year in range(2027, 2032):
    for month in (1, 7):
        date = f"{year}-{month:02d}-01"
        years = zones["deeming_years_by_install_year"].get(str(year))
        factor = next((p["factor"] for p in battery["factor_periods"] if p["start"] <= date <= p["end"]), None)
        panels = panel_stcs(stc_panel_kw, stc_postcode, date)
        batteries = battery_stcs(stc_battery_kwh, date)[0]
        out.append(f"| {date} | {years if years is not None else '不适用'} | "
                   f"{factor if factor is not None else '不适用'} | {panels} | {batteries} |")
out.append("")

(ROOT / "tests/fixtures/hand-calc.md").write_text("\n".join(out))
print("\n".join(out))
