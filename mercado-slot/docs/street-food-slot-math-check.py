"""Exact checks for the proposed rules, not an RTP certificate for a reel pack."""
from fractions import Fraction as F
from itertools import product
from pathlib import Path
import json

PAYS = {"tortilla": F(2,5), "chile": F(1), "lime": F(8,5),
        "avocado": F(2), "esquite": F(12,5), "tamal": F(3),
        "taco": F(4), "wild": F(25)}
LINES = [(1,1,1), (0,0,0), (2,2,2), (0,1,2), (2,1,0)]
MULTIPLIERS = [1,2,3,5,10,15]
NORMAL = [1560,520,312,130,52,26]
EXTRA = [0,2329,52,39,13,167]

def line_pay(symbols):
    if all(s == "wild" for s in symbols):
        return PAYS["wild"]
    return max((p for s,p in PAYS.items() if s != "wild"
                and all(x == s or x == "wild" for x in symbols)), default=F(0))

def evaluate(grid):
    return [line_pay([grid[r][c] for c,r in enumerate(rows)]) for rows in LINES]

def moment(weights, power):
    return sum(F(w, sum(weights))*m**power for w,m in zip(weights,MULTIPLIERS))

def check():
    triples = list(product(PAYS, repeat=3))
    assert len(triples) == 512
    assert all(F(0) <= line_pay(t) <= F(25) for t in triples)
    assert line_pay(("wild","wild","taco")) == 4
    assert line_pay(("wild","wild","wild")) == 25
    assert line_pay(("wild","taco","lime")) == 0
    two = [["taco"]*3, ["avocado","esquite","tamal"], ["lime"]*3]
    no = [["tortilla","chile","lime"], ["avocado","esquite","tamal"],
          ["taco","tortilla","lime"]]
    full = [["wild"]*3 for _ in range(3)]
    a = evaluate(two)
    assert a == [F(0),F(4),F(8,5),F(0),F(0)]
    assert sum(evaluate(no)) == 0
    assert sum(evaluate(full))/5 == 25
    assert F(10)*sum(a)/5*3 == F(168,5)  # 33.6 MXN
    assert F(10)*25*15 == 3750
    assert F(3750)/(F(10)*F(3,2)) == 250
    assert F(3750)/F(10) == 375
    assert sum(NORMAL) == sum(EXTRA) == 2600
    assert EXTRA[0] == 0 and EXTRA[1] > NORMAL[1] and EXTRA[-1] > NORMAL[-1]
    normal_mean, extra_mean = moment(NORMAL,1), moment(EXTRA,1)
    normal_m2, extra_m2 = moment(NORMAL,2), moment(EXTRA,2)
    assert normal_mean == F(49,25) and extra_mean == F(147,50)
    assert extra_mean / normal_mean == F(3,2)
    assert normal_m2 == F(399,50) and extra_m2 == F(1909,100)
    assert extra_m2/F(9,4) > normal_m2
    required_grid_mean = F(193,200)/normal_mean
    assert required_grid_mean == F(193,392)
    # This identity assumes a future reel profile actually attains the required mean.
    assert required_grid_mean*normal_mean == F(193,200)
    assert required_grid_mean*extra_mean/F(3,2) == F(193,200)
    # Verify fixed point integrality at proposed base amounts for every possible
    # single-line triple and axis result; additivity extends this to five lines.
    money_cases = 0
    for base_cents in [20,40,100,200,500,1000,2000,5000]:
        units = base_cents * 10000
        assert units*F(3,2) % 10000 == 0
        for t in triples:
            for m in MULTIPLIERS:
                amount = F(units)*line_pay(t)/5*m
                assert amount.denominator == 1
                money_cases += 1
    return {
        "status": "PASS",
        "scope": "Rule bounds and illustrative multiplier distributions only",
        "single_line_triples": len(triples),
        "fixed_point_single_line_amount_cases": money_cases,
        "normal_multiplier_mean": str(normal_mean),
        "extra_multiplier_mean": str(extra_mean),
        "extra_mean_factor": "3/2",
        "normal_multiplier_second_moment": str(normal_m2),
        "extra_normalized_second_moment": str(extra_m2/F(9,4)),
        "required_unverified_grid_mean": str(required_grid_mean),
        "max_return_per_actual_payment": {"standard":375,"extra":250},
        "full_rtp_profile_verified": False,
        "reel_pack": None,
    }

if __name__ == "__main__":
    report = check()
    target = Path(__file__).with_name("street-food-slot-math-check.json")
    target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2))
