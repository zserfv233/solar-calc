"""
第 3 步手算脚本：完全不调用 src/lib/calc.ts，按执行方案「计算模型 v0.1」的公式逐步计算，
输出 tests/fixtures/hand-calc.md。运行：python3 tests/fixtures/hand_calc.py
政策和价格数字从 data/ 读取；用例自身的输入（报价、上网电价等）写在 CASES 里。
"""
import json, math, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
load = lambda n: json.loads((ROOT / "data" / n).read_text())["values"]
postcodes, zones, battery, defaults = (load(n) for n in
    ["postcodes-vic.json", "stc-zones.json", "battery-rebate.json", "defaults-vic.json"])
A = defaults["assumptions_from_plan"]

def zone_of(pc):
    return next(r["zone"] for r in postcodes["ranges"] if r["from"] <= pc <= r["to"])

def battery_factor(date):
    return next(p["factor"] for p in battery["factor_periods"] if p["start"] <= date <= p["end"])

def daily(G, L_day, L_night, C, eta):
    D = min(G, L_day); E = G - D
    B = min(E, C); B_out = min(B * eta, L_night); X = E - B
    return D, E, B, B_out, X

CASES = [
    dict(name="用例 1：墨尔本，6.6 kW，无电池，上班族", postcode=3000, P=6.6, C=0, share="away",
         install="2026-11-01", quote=6000, mode="solar"),
    dict(name="用例 2：墨尔本，6.6 kW + 10 kWh 电池，基本在家", postcode=3000, P=6.6, C=10, share="mostly_home",
         install="2026-11-01", quote=6000 + 12000, mode="solar"),
    dict(name="用例 3：已有 6.6 kW 太阳能，只加 20 kWh 电池，部分在家", postcode=3000, P=6.6, C=20, share="partly_home",
         install="2026-11-01", quote=20000, mode="battery_only"),
]
FIT = 5.0  # 测试输入：模拟用户照电费单填的上网电价（c/kWh），不是默认值
p0 = defaults["vdo_flat_2026_27"][defaults["default_distributor"]]["usage_c_per_kwh"] / 100
f = FIT / 100
eta, deg = A["round_trip_efficiency"], A["panel_degradation_per_year"]
annual = defaults["annual_usage_kwh"]
fmt = lambda x, n=3: f"{x:,.{n}f}"

out = ["# 手算结果（第 3 步）", "",
       "由 `tests/fixtures/hand_calc.py` 生成，不调用 `calc.ts`。第 5 步的测试期望值以本文件为准（误差 < 1%）。", "",
       "## 公共输入", "",
       f"- 买电电价 p = {p0*100:.2f} c/kWh（{defaults['default_distributor']}，VDO 2026–27）",
       f"- 上网电价 f = {FIT} c/kWh（**测试输入**，模拟用户照电费单填写）",
       f"- 年用电量 = {annual} kWh，每天 L = {fmt(annual/365)} kWh",
       f"- 充放电效率 η = {eta}，面板年衰减 = {deg}，STC 单价 = ${defaults['stc_price_dollars']}",
       "- 报价均为**测试输入**，按「未扣补贴」处理；上网电价不随电价上涨",
       "- 逐年计算：第 n 年发电 G×(1−衰减)^(n−1)，电价 p×(1+涨幅)^(n−1)，每年重新算一遍 D、B、X", ""]

for c in CASES:
    z = zone_of(c["postcode"]); R = zones["zone_ratings"][str(z)]
    year = int(c["install"][:4]); Y = zones["deeming_years_by_install_year"][str(year)]
    F = battery_factor(c["install"])
    L = annual / 365; L_day = L * A["daytime_share"][c["share"]]; L_night = L - L_day
    G = c["P"] * R * 1000 / 365
    D, E, B, B_out, X = daily(G, L_day, L_night, c["C"], eta)
    if c["mode"] == "solar":
        S1 = 365 * ((D + B_out) * p0 + X * f)
        N_panel = math.floor(c["P"] * R * Y)
    else:  # 只加电池：只算电池带来的增量（用户 2026-10-15 确认）
        S1 = 365 * (B_out * p0 - B * f)
        N_panel = 0
    Cc = c["C"]
    tier = min(Cc, 14) + 0.6 * min(max(Cc - 14, 0), 14) + 0.15 * min(max(Cc - 28, 0), 22)
    N_batt = math.floor(F * tier) if Cc > 0 else 0
    rebate = (N_panel + N_batt) * defaults["stc_price_dollars"]
    net = c["quote"] - rebate

    rows = []
    for esc in A["price_escalation_scenarios"]:
        cum, payback, cum10 = 0.0, None, None
        for n in range(1, 31):
            Gn = G * (1 - deg) ** (n - 1); pn = p0 * (1 + esc) ** (n - 1)
            d, e, b, bo, x = daily(Gn, L_day, L_night, Cc, eta)
            s = 365 * ((d + bo) * pn + x * f) if c["mode"] == "solar" else 365 * (bo * pn - b * f)
            cum += s
            if payback is None and cum >= net: payback = n
            if n == 10: cum10 = cum
        rows.append((esc, payback, cum10, cum10 - net))

    out += [f"## {c['name']}", "",
            f"输入：邮编 {c['postcode']} → 分区 {z}，R = {R}；系统 P = {c['P']} kW；电池 C = {Cc} kWh；"
            f"白天用电占比 {A['daytime_share'][c['share']]}；安装 {c['install']}；报价 ${c['quote']:,}", "",
            "| 中间值 | 公式 | 结果 |", "| --- | --- | --- |",
            f"| L_day / L_night | L×占比 / L−L_day | {fmt(L_day)} / {fmt(L_night)} kWh |",
            f"| G | P×R×1000/365 | {fmt(G)} kWh/天 |",
            f"| D | min(G, L_day) | {fmt(D)} |",
            f"| E | G−D | {fmt(E)} |",
            f"| B | min(E, C) | {fmt(B)} |",
            f"| B_out | min(B×η, L_night) | {fmt(B_out)} |",
            f"| X | E−B | {fmt(X)} |",
            (f"| S（第 1 年） | 365×[(D+B_out)×p + X×f] | ${fmt(S1,2)} |" if c["mode"] == "solar"
             else f"| S（第 1 年，增量） | 365×(B_out×p − B×f) | ${fmt(S1,2)} |"),
            f"| N_panel | ⌊P×R×{Y}⌋ | {N_panel} 张 |",
            f"| N_batt | ⌊{F}×{fmt(tier,2)}⌋ | {N_batt} 张 |",
            f"| 补贴 | (N_panel+N_batt)×38 | ${rebate:,.2f} |",
            f"| 净成本 | 报价−补贴 | ${net:,.2f} |", "",
            "| 电价年涨幅 | 回本年限 | 10 年累计省钱 | 10 年净收益 |", "| --- | --- | --- | --- |"]
    out += [f"| {int(e*100)}% | {pb if pb else '30 年内不回本'} | ${c10:,.2f} | ${n10:,.2f} |"
            for e, pb, c10, n10 in rows]
    out.append("")

(ROOT / "tests/fixtures/hand-calc.md").write_text("\n".join(out))
print("\n".join(out))
