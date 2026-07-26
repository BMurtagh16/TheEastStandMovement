"""
Hard facts from football-data.org: results, lineups, substitutions.

Everything here is verifiable. Claude never invents a scoreline or a substitution
minute — it only reads what this module returns and forms a judgement on top.

Works without a key: the functions return None and the pipeline falls back to a
search-only match card, clearly labelled as unverified on the site.
"""

import os

import requests

BASE = "https://api.football-data.org/v4"
TEAM_ID = 66  # Manchester United
KEY = os.environ.get("FOOTBALL_DATA_KEY")


def _get(path, **params):
    if not KEY:
        return None
    try:
        r = requests.get(
            f"{BASE}{path}",
            headers={"X-Auth-Token": KEY},
            params=params,
            timeout=30,
        )
        if r.status_code == 429:
            print("football-data.org rate limit hit; skipping facts this run.")
            return None
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        print(f"football-data.org unavailable: {e}")
        return None


def recent_match(days_back=3):
    """The most recently finished match, if there was one."""
    data = _get(f"/teams/{TEAM_ID}/matches", status="FINISHED", limit=5)
    if not data or not data.get("matches"):
        return None
    matches = sorted(data["matches"], key=lambda m: m["utcDate"], reverse=True)
    return matches[0]


def upcoming(limit=6):
    data = _get(f"/teams/{TEAM_ID}/matches", status="SCHEDULED", limit=limit)
    if not data:
        return []
    return [
        {
            "utcDate": m["utcDate"],
            "home": m["homeTeam"]["shortName"],
            "away": m["awayTeam"]["shortName"],
            "competition": m["competition"]["name"],
        }
        for m in data.get("matches", [])[:limit]
    ]


def match_facts(match):
    """Flatten a match into the facts the analyst prompt is allowed to rely on."""
    if not match:
        return None
    home, away = match["homeTeam"]["shortName"], match["awayTeam"]["shortName"]
    score = match.get("score", {}).get("fullTime", {})
    subs = []
    for side in ("homeTeam", "awayTeam"):
        for s in (match.get(side, {}).get("substitutes") or []):
            subs.append({"team": match[side]["shortName"], "player": s.get("name")})
    return {
        "id": match["id"],
        "date": match["utcDate"],
        "competition": match.get("competition", {}).get("name"),
        "home": home,
        "away": away,
        "score": f"{score.get('home')}–{score.get('away')}",
        "united_home": home.lower().startswith("man united") or "United" in home,
        "lineups_available": bool(match.get("homeTeam", {}).get("lineup")),
        "substitutions": match.get("homeTeam", {}).get("lineup") and subs or [],
        "source": "football-data.org",
    }
