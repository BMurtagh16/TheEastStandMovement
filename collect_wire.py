"""
The match card and the manager card.

Facts come from football-data.org where a key is present. Claude supplies the
judgement layer on a fixed rubric, so week 3 is comparable with week 30 — which
is the entire point, and the thing no pundit gives you.
"""

import datetime as dt
import json
import pathlib
import sys

import claude_client as cc
import football_data as fd

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"

RUBRIC = """Score each axis 0-10. 5 is a competent Premier League performance,
not a compliment. 8+ needs clear evidence. Be willing to give 3.

TEAM
 control          Did possession go anywhere, or was it sideways?
 creation         Volume and quality of chances made.
 prevention       Chances conceded, defensive shape, transition security.
 set_pieces       Both boxes.
 intensity        Pressing, duels, whether they ran.
 game_management  Seeing out a lead, or chasing one intelligently.

MANAGER — this is the part that matters, so be specific and evidence-led:
 selection        Did the starting XI fit this opponent? 0-10.
 first_change_min The minute of the first substitution or shape change that was
                  a genuine response to the game, not an injury or a like-for-like
                  swap at 80 minutes. Integer, or null if there was none.
 reaction         How quickly a problem was identified and addressed. 0-10.
 sub_impact       Did the changes alter the score or the pattern? -2 to +2.
 plan_b           Was there an alternative approach when the first did not work?
                  "yes" | "partial" | "no"
 counterfactual   One sentence: a reasonable alternative a fair critic would name.
"""


def build_prompt(facts):
    if facts:
        known = json.dumps(facts, indent=1)
        instruction = (
            "These facts are verified. Treat them as fixed and do not contradict "
            "them. Search for match reports and analysis to inform the judgement "
            "only.\n\n<verified_facts>\n" + known + "\n</verified_facts>"
        )
    else:
        instruction = (
            "No verified feed was available. Search for the result, lineups and "
            "substitutions, and set \"verified\": false in your reply so the site "
            "can label it honestly."
        )

    return f"""You are marking Manchester United's most recent competitive match on a
fixed rubric that is applied identically every week.

{instruction}

{RUBRIC}

Return ONLY this JSON object, no prose and no fences:

{{
 "match": {{"date": "YYYY-MM-DD", "opponent": "", "venue": "H"|"A"|"N",
            "competition": "", "score": "2–1", "result": "W"|"D"|"L"}},
 "verified": true|false,
 "team": {{"control": 0, "creation": 0, "prevention": 0, "set_pieces": 0,
           "intensity": 0, "game_management": 0}},
 "team_rating": 0.0,
 "team_verdict": "two sentences, plain, no clichés",
 "manager": {{"selection": 0, "first_change_min": 0, "reaction": 0,
              "sub_impact": 0, "plan_b": "yes|partial|no",
              "counterfactual": "one sentence"}},
 "manager_rating": 0.0,
 "manager_verdict": "two sentences",
 "turning_point": "one sentence on the moment the match was decided",
 "sources": ["url", "url"]
}}

team_rating is the mean of the six team axes, to one decimal.
manager_rating weights selection 30%, reaction 30%, sub_impact 40% (rescaled from
-2..2 onto 0..10). Compute it, do not guess it.
Never invent a scoreline, a scorer or a substitution minute."""


def main():
    match = fd.recent_match()
    facts = fd.match_facts(match) if match else None

    if facts:
        played = dt.datetime.fromisoformat(facts["date"].replace("Z", "+00:00"))
        age_h = (dt.datetime.now(dt.timezone.utc) - played).total_seconds() / 3600
        if age_h > 72:
            print("No match in the last 72 hours. Nothing to mark.")
            return

    card = cc.ask_json(build_prompt(facts), job="match", max_tokens=2000, max_searches=5)
    card["generated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")

    path = DATA / "matches.json"
    cards = json.loads(path.read_text()) if path.exists() else []
    ident = card.get("match", {}).get("date")
    cards = [c for c in cards if c.get("match", {}).get("date") != ident]
    cards.append(card)
    cards.sort(key=lambda c: c.get("match", {}).get("date", ""))
    path.write_text(json.dumps(cards, indent=1, ensure_ascii=False))

    (DATA / "cost.json").write_text(json.dumps(cc.totals(), indent=1))

    m = card.get("match", {})
    print(f"Marked {m.get('opponent')} ({m.get('score')}): team "
          f"{card.get('team_rating')}, manager {card.get('manager_rating')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Match card failed: {e}", file=sys.stderr)
        sys.exit(1)
