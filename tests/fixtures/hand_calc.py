"""
第 3 步手算脚本：完全不调用 src/lib/calc.ts，按计算模型逐步计算，输出 tests/fixtures/hand-calc.md。
运行：python3 tests/fixtures/hand_calc.py
政策、价格和质保数字从 data/ 读取；用例自身的输入写在 CASES 里。

模型相对执行方案原文的修订（2026-10-15 用户确认）：
- 第 1 层：电池默认每天充满，按稳定状态计算：B = min(E, C_n, L_night/η)，B_out = B×η。
  头天晚上没用完的电留在电池里，第二天只需补充用掉的部分。
- 第 2 层：电池利用率 = B / C（第 1 年）。
- 第 3 层：电池寿命 = 质保年限与吞吐上限先到者；容量从 100% 线性衰减，到质保最后一年后降到末期保留比例。
  寿命结束后电池不再带来收益（太阳能板继续发电）。
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
    B = min(E, C, L_night / eta) if C > 0 else 0.0
    B_out = B * eta; X = E - B
    return D, E, B, B_out, X

def capacity(C, n):
    """第 n 年的可用容量；超过质保年限返回 0（寿命结束）。"""
    if n > W["warranty_years"]:
        return 0.0
    return C * (1 - (1 - W["end_of_warranty_retention"]) * (n - 1) / W["warranty_years"])

CASES = [
    dict(name="用例 1：墨尔本，6.6 kW，无电池，上班族", postcode=3000, P=6.6, C=0, share="away",
         install="2026-11-01", quote=Q["solar_6_6kw_dollars"], mode="solar"),
    dict(name="用例 2：墨尔本，6.6 kW + 10 kWh 电池，基本在家", postcode=3000, P=6.6, C=10, share="mostly_home",
         install="2026-11-01", quote=Q["solar_6_6kw_dollars"] + Q["battery_10kwh_dollars"], mode="solar"),
    dict(name="用例 3：已有 6.6 kW 太阳能，只加 20 kWh 电池，部分在家", postcode=3000, P=6.6, C=20, share="partly_home",
         install="2026-11-01", quote=Q["battery_20kwh_dollars"], mode="battery_only"),
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
       "- 电池按「默认充满」的稳定状态计算：B = min(E, C_n, L_night/η)，B_out = B×η",
       f"- 第 n 年容量 C_n = C×[1 − {1-W['end_of_warranty_retention']:.1f}×(n−1)/{W['warranty_years']}]，"
       f"超过质保年限或吞吐上限后电池收益为 0",
       "- 逐年计算：第 n 年发电 G×(1−衰减)^(n−1)，电价 p×(1+涨幅)^(n−1)，上网电价不变", ""]

for c in CASES:
    z = zone_of(c["postcode"]); R = zones["zone_ratings"][str(z)]
    year = int(c["install"][:4]); Y = zones["deeming_years_by_install_year"][str(year)]
    F = battery_factor(c["install"])
    L = annual / 365; L_day = L * A["daytime_share"][c["share"]]; L_night = L - L_day
    G = c["P"] * R * 1000 / 365
    Cc = c["C"]
    D, E, B, B_out, X = daily(G, L_day, L_night, Cc, eta)
    if c["mode"] == "solar":
        S1 = 365 * ((D + B_out) * p0 + X * f)
        N_panel = math.floor(c["P"] * R * Y)
    else:  # 只加电池：只算电池带来的增量
        S1 = 365 * (B_out * p0 - B * f)
        N_panel = 0
    tier = min(Cc, 14) + 0.6 * min(max(Cc - 14, 0), 14) + 0.15 * min(max(Cc - 28, 0), 22)
    N_batt = math.floor(F * tier) if Cc > 0 else 0
    net = c["quote"]
    limit_kwh = Cc * W["throughput_mwh_per_usable_kwh"] * 1000
    util = B / Cc if Cc > 0 else None

    rows = []
    for esc in A["price_escalation_scenarios"]:
        cum, cum_out, payback, cum10, life = 0.0, 0.0, None, None, 0
        for n in range(1, 31):
            Gn = G * (1 - deg) ** (n - 1); pn = p0 * (1 + esc) ** (n - 1)
            Cn = capacity(Cc, n) if cum_out < limit_kwh else 0.0
            if Cn > 0: life = n
            d, e, b, bo, x = daily(Gn, L_day, L_night, Cn, eta)
            cum_out += 365 * bo
            s = 365 * ((d + bo) * pn + x * f) if c["mode"] == "solar" else 365 * (bo * pn - b * f)
            cum += s
            if payback is None and cum >= net: payback = n
            if n == 10: cum10 = cum
        rows.append((esc, payback, cum10, cum10 - net, life, cum_out))

    out += [f"## {c['name']}", "",
            f"输入：邮编 {c['postcode']} → 分区 {z}，R = {R}；系统 P = {c['P']} kW；电池 C = {Cc} kWh；"
            f"白天用电占比 {A['daytime_share'][c['share']]}；安装 {c['install']}；报价（已扣补贴）${c['quote']:,}", "",
            "| 中间值（第 1 年） | 公式 | 结果 |", "| --- | --- | --- |",
            f"| L_day / L_night | L×占比 / L−L_day | {fmt(L_day)} / {fmt(L_night)} kWh |",
            f"| G | P×R×1000/365 | {fmt(G)} kWh/天 |",
            f"| D | min(G, L_day) | {fmt(D)} |",
            f"| E | G−D | {fmt(E)} |",
            f"| B | min(E, C, L_night/η) | {fmt(B)} |",
            f"| B_out | B×η | {fmt(B_out)} |",
            f"| X | E−B | {fmt(X)} |",
            (f"| S（第 1 年） | 365×[(D+B_out)×p + X×f] | ${fmt(S1,2)} |" if c["mode"] == "solar"
             else f"| S（第 1 年，增量） | 365×(B_out×p − B×f) | ${fmt(S1,2)} |"),
            f"| 电池利用率 | B/C | {util:.1%} |" if util is not None else "| 电池利用率 | 无电池 | — |",
            f"| 吞吐上限 | C×{W['throughput_mwh_per_usable_kwh']} MWh | {limit_kwh/1000:,.1f} MWh |",
            f"| N_panel（核对用） | ⌊P×R×{Y}⌋ | {N_panel} 张 |",
            f"| N_batt（核对用） | ⌊{F}×{fmt(tier,2)}⌋ | {N_batt} 张 |",
            f"| 净成本 | 报价已扣补贴 | ${net:,.2f} |", "",
            "| 电价年涨幅 | 回本年限 | 电池寿命 | 10 年累计省钱 | 10 年净收益 | 电池累计放电 |",
            "| --- | --- | --- | --- | --- | --- |"]
    for e, pb, c10, n10, life, co in rows:
        if Cc > 0 and (pb is None or pb > life):
            pbs = "电池寿命内回不了本" + (f"（第 {pb} 年）" if pb else "")
        else:
            pbs = str(pb) if pb else "30 年内不回本"
        out.append(f"| {int(e*100)}% | {pbs} | {f'{life} 年' if Cc > 0 else '—'} | ${c10:,.2f} | ${n10:,.2f} | "
                   f"{f'{co/1000:,.1f} MWh' if Cc > 0 else '—'} |")
    out.append("")

(ROOT / "tests/fixtures/hand-calc.md").write_text("\n".join(out))
print("\n".join(out))
