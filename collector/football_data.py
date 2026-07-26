"""
Hard facts from football-data.org: fixtures, results, lineups, substitutions.

Everything here is verifiable. Claude never invents a scoreline or a substitution
minute — it only reads what this module returns and forms a judgement on top.

Designed to fail quietly. With no API key, a rate limit, a permission error or a
network problem, every function returns an empty result and the pipeline carries
on with a search-only match card, labelled unverified on the site.
"""

import os

import requests

BASE = "https://api.football-data.org/v4"
TEAM_ID = 66  # Manchester United
TIMEOUT = 30


def _key():
    """Read the key at call time, not import time, so tests can set it."""
    return os.environ.get("FOOTBALL_DATA_KEY")


def _get(path, **params):
    """One GET. Returns a dict on success, or None for every failure mode."""
    key = _key()
    if not key:
        print("No FOOTBALL_DATA_KEY set; skipping the facts feed.")
        return None
    try:
        r = requests.get(
            BASE + path,
            headers={"X-Auth-Token": key},
            params=params,
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        print("football-data.org unreachable: " + str(exc))
        return None

    if r.status_code == 429:
        print("football-data.org rate limit hit; skipping the facts feed this run.")
        return None
    if r.status_code in (401, 403):
        print("football-data.org refused the key or the competition "
              "(status " + str(r.status_code) + "); skipping the facts feed.")
        return None
    if r.status_code != 200:
        print("football-data.org returned " + str(r.status_code) + "; skipping.")
        return None

    try:
        return r.json()
    except ValueError:
        print("football-data.org sent something that was not JSON; skipping.")
        return None


def _team_name(side):
    """shortName is nicer but is not always present."""
    if not isinstance(side, dict):
        return ""
    return side.get("shortName") or side.get("name") or ""


def upcoming(limit=6):
    """The next scheduled fixtures. Always returns a list, possibly empty."""
    data = _get("/teams/" + str(TEAM_ID) + "/matches", status="SCHEDULED", limit=limit)
    if not data:
        return []

    out = []
    for m in (data.get("matches") or [])[:limit]:
        if not isinstance(m, dict):
            continue
        out.append({
            "utcDate": m.get("utcDate", ""),
            "home": _team_name(m.get("homeTeam")),
            "away": _team_name(m.get("awayTeam")),
            "competition": (m.get("competition") or {}).get("name", ""),
        })
    return out


def recent_match():
    """The most recently finished match, or None."""
    data = _get("/teams/" + str(TEAM_ID) + "/matches", status="FINISHED", limit=5)
    if not data:
        return None

    matches = [m for m in (data.get("matches") or []) if isinstance(m, dict)]
    if not matches:
        return None

    matches.sort(key=lambda m: m.get("utcDate", ""), reverse=True)
    return matches[0]


def _substitutions(match):
    """Substitutions for both sides, flattened. Empty list if not published."""
    subs = []
    for side_key in ("homeTeam", "awayTeam"):
        side = match.get(side_key) or {}
        team = _team_name(side)
        for player in (side.get("substitutes") or []):
            if isinstance(player, dict) and player.get("name"):
                subs.append({"team": team, "player": player["name"]})
    return subs


def match_facts(match):
    """Flatten a match into the facts the analyst prompt may rely on."""
    if not isinstance(match, dict):
        return None

    home = _team_name(match.get("homeTeam"))
    away = _team_name(match.get("awayTeam"))
    full_time = ((match.get("score") or {}).get("fullTime") or {})
    home_goals = full_time.get("home")
    away_goals = full_time.get("away")

    if home_goals is None or away_goals is None:
        score = "unknown"
    else:
        score = str(home_goals) + "-" + str(away_goals)

    united_home = "United" in home

    return {
        "id": match.get("id"),
        "date": match.get("utcDate", ""),
        "competition": (match.get("competition") or {}).get("name", ""),
        "home": home,
        "away": away,
        "score": score,
        "united_home": united_home,
        "opponent": away if united_home else home,
        "substitutions": _substitutions(match),
        "source": "football-data.org",
    }
