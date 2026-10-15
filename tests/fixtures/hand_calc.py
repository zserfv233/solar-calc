"""
第 3 步手算脚本：完全不调用 src/lib/calc.ts，按计算模型逐步计算，输出 tests/fixtures/hand-calc.md。
运行：python3 tests/fixtures/hand_calc.py
政策、价格和质保数字从 data/ 读取；用例自身的输入写在 CASES 里。

模型相对执行方案原文的修订（2026-10-15 用户确认）：
- 第 1 层：电池默认每天充满，按稳定状态计算。C 是「可用容量」，指电池能放出来给家里用的电量（放电端），
  所以 B_out = min(E×η, C_n, L_night)，充进去的电 B = B_out/η（2026-10-16 按核查报告修正测量端）。
  头天晚上没用完的电留在电池里，第二天只需补充用掉的部分。
- 第 2 层：电池利用率 = B / C（第 1 年）。
- 第 3 层：只计算质保期内的电池收益（保守情景，质保到期不等于电池报废）。质保期 = 质保年限与吞吐上限先到者；
  吞吐上限在年中触发时，按当年剩余额度折算电池收益。容量从 100% 线性衰减（第 n 年取年初容量）。
  质保期后电池不再计收益（太阳能板继续发电）。
"""
import json, math, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
load = lambda n: json.loads((ROOT / "data" / n).read_text())["values"]
postcodes, zones, battery, defaults = (load(n) for n in
    ["postcodes-vic.json", "stc-zones.json", "battery-rebate.json", "defaults-vic.json"])
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

def capacity(C, n):
    """第 n 年的可用容量；超过质保年限返回 0（寿命结束）。"""
    if n > W["warranty_years"]:
        return 0.0
    return C * (1 - (1 - W["end_of_warranty_retention"]) * (n - 1) / W["warranty_years"])

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
       f"- 年用电量 = {annual} kWh，每天 L = {fmt(annual/365)} kWh",
       f"- 充放电效率 η = {eta}，面板年衰减 = {deg}，STC 单价 = ${defaults['stc_price_dollars']}",
       f"- 报价用参考价，**已扣补贴**，所以净成本 = 报价，下表里的 STC 张数只作核对",
       f"- 电池质保：{W['warranty_years']} 年，末期保留 {W['end_of_warranty_retention']:.0%}，"
       f"吞吐上限每 kWh 可用容量 {W['throughput_mwh_per_usable_kwh']} MWh",
       "- 电池按「默认充满」的稳定状态计算：B_out = min(E×η, C_n, L_night)，B = B_out/η（C 为放电端可用容量）",
       f"- 第 n 年容量 C_n = C×[1 − {1-W['end_of_warranty_retention']:.1f}×(n−1)/{W['warranty_years']}]，"
       f"超过质保年限或吞吐上限后不计电池收益（保守情景，不代表电池报废）；吞吐上限年中触发时按剩余额度折算",
       "- 逐年计算：第 n 年发电 G×(1−衰减)^(n−1)，电价 p×(1+涨幅)^(n−1)，上网电价不变", ""]

EL = defaults["battery_expected_life"]["lithium_ion_years_max"]
WY = W["warranty_years"]

def simulate(c, esc, life_years, fit, C=None):
    """逐年计算。返回 (回本年份或 None, 10 年累计省钱, 电池计收益的年数, 电池累计放电 kWh, 净成本, 逐年累计省钱)。"""
    Cc = c["C"] if C is None else C
    net = c["solar_quote"] + (c["battery_quote"] if Cc > 0 else 0)
    z = zone_of(c["postcode"]); R = zones["zone_ratings"][str(z)]
    L = annual / 365; L_day = L * A["daytime_share"][c["share"]]; L_night = L - L_day
    G = c["P"] * R * 1000 / 365
    limit_kwh = Cc * W["throughput_mwh_per_usable_kwh"] * 1000
    fr = fit / 100
    cum, cum_out, payback, cum10, years, cums = 0.0, 0.0, None, None, 0, []
    for n in range(1, 31):
        Gn = G * (1 - deg) ** (n - 1); pn = p0 * (1 + esc) ** (n - 1)
        Cn = 0.0
        if Cc > 0 and n <= life_years and cum_out < limit_kwh:
            Cn = max(0.0, Cc * (1 - (1 - W["end_of_warranty_retention"]) * (n - 1) / WY))
        saving = lambda d, b, bo, x: (365 * ((d + bo) * pn + x * fr) if c["mode"] == "solar"
                                      else 365 * (bo * pn - b * fr))
        d, e, b, bo, x = daily(Gn, L_day, L_night, Cn, eta)
        k = min(1.0, (limit_kwh - cum_out) / (365 * bo)) if bo > 0 else 0.0  # 当年电池可用的比例
        if k > 0: years = n
        d0, e0, b0, bo0, x0 = daily(Gn, L_day, L_night, 0.0, eta)
        cum += k * saving(d, b, bo, x) + (1 - k) * saving(d0, b0, bo0, x0)
        cum_out += k * 365 * bo
        if payback is None and cum >= net: payback = n
        if n == 10: cum10 = cum
        cums.append(cum)
    return payback, cum10, years, cum_out, net, cums

def incremental_payback(c, esc, life_years, fit):
    """电池增量回本：逐年比较有电池和没电池的累计省钱差，第一次 ≥ 电池成本的年份。"""
    w_ = simulate(c, esc, life_years, fit)[5]
    o_ = simulate(c, esc, life_years, fit, C=0)[5] if c["mode"] == "solar" else [0.0] * 30
    return next((i + 1 for i in range(30) if w_[i] - o_[i] >= c["battery_quote"]), None)

def pb_text(pb, years, has_batt):
    if has_batt and (pb is None or pb > years):
        return f"按当前假设，电池计收益的 {years} 年内未回本" + (f"（第 {pb} 年）" if pb else "")
    return f"第 {pb} 年" if pb else "30 年内不回本"

for c in CASES:
    z = zone_of(c["postcode"]); R = zones["zone_ratings"][str(z)]
    year = int(c["install"][:4]); Y = zones["deeming_years_by_install_year"][str(year)]
    F = battery_factor(c["install"])
    L = annual / 365; L_day = L * A["daytime_share"][c["share"]]; L_night = L - L_day
    G = c["P"] * R * 1000 / 365
    Cc = c["C"]; has_b = Cc > 0
    D, E, B, B_out, X = daily(G, L_day, L_night, Cc, eta)
    if c["mode"] == "solar":
        S1 = 365 * ((D + B_out) * p0 + X * f)
        N_panel = math.floor(c["P"] * R * Y)
    else:  # 只加电池：只算电池带来的增量
        S1 = 365 * (B_out * p0 - B * f)
        N_panel = 0
    N_batt, tier = battery_stcs(Cc, c["install"])
    net = simulate(c, 0, WY, FIT)[4]
    limit_kwh = Cc * W["throughput_mwh_per_usable_kwh"] * 1000
    util = B / Cc if has_b else None

    out += [f"## {c['name']}", "",
            f"输入：邮编 {c['postcode']} → 分区 {z}，R = {R}；系统 P = {c['P']} kW；电池 C = {Cc} kWh；"
            f"白天用电占比 {A['daytime_share'][c['share']]}；安装 {c['install']}；报价（已扣补贴）${net:,}", "",
            "| 中间值（第 1 年） | 公式 | 结果 |", "| --- | --- | --- |",
            f"| L_day / L_night | L×占比 / L−L_day | {fmt(L_day)} / {fmt(L_night)} kWh |",
            f"| G | P×R×1000/365 | {fmt(G)} kWh/天 |",
            f"| D | min(G, L_day) | {fmt(D)} |",
            f"| E | G−D | {fmt(E)} |",
            f"| B_out | min(E×η, C, L_night) | {fmt(B_out)} |",
            f"| B | B_out/η | {fmt(B)} |",
            f"| X | E−B | {fmt(X)} |",
            (f"| S（第 1 年） | 365×[(D+B_out)×p + X×f] | ${fmt(S1,2)} |" if c["mode"] == "solar"
             else f"| S（第 1 年，增量） | 365×(B_out×p − B×f) | ${fmt(S1,2)} |"),
            f"| 电池利用率 | B/C | {util:.1%} |" if has_b else "| 电池利用率 | 无电池 | — |",
            f"| 吞吐上限 | C×{W['throughput_mwh_per_usable_kwh']} MWh | {limit_kwh/1000:,.1f} MWh |",
            f"| N_panel（核对用） | ⌊P×R×{Y}⌋ | {N_panel} 张 |",
            f"| N_batt（核对用） | ⌊{F}×{fmt(tier,2)}⌋（2026-05-01 起三档，最多 50 kWh） | {N_batt} 张 |",
            f"| 净成本 | 报价已扣补贴 | ${net:,.2f} |", ""]

    bases = [("只算质保期", WY)] + ([(f"按预期寿命 {EL} 年", EL)] if has_b else [])
    for label, life in bases:
        out += [f"**{label}**（上网电价 {FIT} c/kWh）" if has_b else f"**结果**（上网电价 {FIT} c/kWh）", "",
                "| 电价年涨幅 | 回本 | 电池计收益年数 | 10 年累计省钱 | 10 年净收益（未计维护及资金成本） | 电池累计放电 |",
                "| --- | --- | --- | --- | --- | --- |"]
        for esc in A["price_escalation_scenarios"]:
            pb, c10, yrs, co, nt, _ = simulate(c, esc, life, FIT)
            out.append(f"| {int(esc*100)}% | {pb_text(pb, yrs, has_b)} | {f'{yrs} 年' if has_b else '—'} | "
                       f"${c10:,.2f} | ${c10-nt:,.2f} | {f'{co/1000:,.1f} MWh' if has_b else '—'} |")
        out.append("")

    out += [f"**上网电价为 0 时的对比**（只算质保期）", "",
            "| 电价年涨幅 | 回本：{0} c → 0 c | 10 年净收益：{0} c → 0 c |".format(FIT), "| --- | --- | --- |"]
    for esc in A["price_escalation_scenarios"]:
        a_ = simulate(c, esc, WY, FIT); b_ = simulate(c, esc, WY, 0.0)
        out.append(f"| {int(esc*100)}% | {pb_text(a_[0], a_[2], has_b)} → {pb_text(b_[0], b_[2], has_b)} | "
                   f"${a_[1]-a_[4]:,.2f} → ${b_[1]-b_[4]:,.2f} |")
    out.append("")

    if has_b:
        # 电池增量：同一家庭、同一太阳能条件下，有电池减去没电池（只加电池的用例本身就是增量）
        out += ["**电池部分单独看**（同一家庭、同样的太阳能，有电池 − 没电池）", "",
                "| 计算口径 | 电价年涨幅 | 电池成本 | 电池带来的 10 年增量省钱 | 增量回本 | 每放 1 度电的电池成本 | 每度电替你省的钱（第 1 年） |",
                "| --- | --- | --- | --- | --- | --- | --- |"]
        value_per_kwh = p0 - f / eta
        for label, life in bases:
            for esc in A["price_escalation_scenarios"]:
                cost = c["battery_quote"]
                if c["mode"] == "solar":
                    w_ = simulate(c, esc, life, FIT); o_ = simulate(c, esc, life, FIT, C=0)
                    inc10 = w_[1] - o_[1]
                    co, yrs = w_[3], w_[2]
                else:
                    w_ = simulate(c, esc, life, FIT); inc10 = w_[1]; co, yrs = w_[3], w_[2]
                inc_pb = incremental_payback(c, esc, life, FIT)
                out.append(f"| {label} | {int(esc*100)}% | ${cost:,} | ${inc10:,.2f} | {pb_text(inc_pb, yrs, True)} | "
                           f"${cost/co:,.3f}/kWh | ${value_per_kwh:,.3f}/kWh |")
        out += ["", f"说明：「每放 1 度电的电池成本」= 电池成本 ÷ 计收益期间累计放电量，思路同 HOMER 的电池损耗成本；"
                f"「每度电替你省的钱」= 买电电价 − 上网电价/η（放 1 度电要少卖 1/η 度）。前者高于后者时，电池单独看不划算。", ""]

out += ["## 电池 STC 边界核对（第 5 步边界测试用）", "",
        "| 可用容量 | 安装日期 | 计入容量 | STC 张数 | 说明 |", "| --- | --- | --- | --- | --- |"]
for Cb, dt, why in [(20, "2026-04-30", "分档生效前，全部容量按 100%"), (20, "2026-05-01", "分档生效当天"),
                    (14, "2026-11-01", "正好第一档上限"), (28, "2026-11-01", "正好第二档上限"),
                    (50, "2026-11-01", "正好 50 kWh 上限"), (60, "2026-11-01", "超过 50 kWh 的部分不计"),
                    (20, "2025-06-30", "早于 2025-07-01，不适用"), (20, "2031-01-01", "晚于系数表，不适用")]:
    n_, eff_ = battery_stcs(Cb, dt)
    out.append(f"| {Cb} kWh | {dt} | {fmt(eff_, 2)} kWh | {n_} 张 | {why} |")
out.append("")

(ROOT / "tests/fixtures/hand-calc.md").write_text("\n".join(out))
print("\n".join(out))
