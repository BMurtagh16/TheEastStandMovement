"""
The wire run. One Claude call does three jobs at once, which is the main cost
saving in this repo: stories, the tone reading behind the mood index, and the
rumour tiering. Three separate calls would triple the search charge for no gain.
"""

import datetime as dt
import json
import pathlib
import re

import claude_client as cc
import football_data as fd

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"

PROMPT = """Search for news about Manchester United published in the last 5 days.
Cover first-team news, transfers, injuries, and club matters. Use reputable
football journalism, not aggregator spam.

Return ONLY a JSON array of up to 10 objects, no prose, no markdown fences:

{
 "headline": "max 90 chars, factual, no clickbait",
 "summary": "max 160 chars, plain and specific",
 "source": "publication name",
 "url": "the URL from the search result, or \\"\\" if you do not have one",
 "published": "e.g. 24 Jul",
 "category": "transfers" | "team news" | "match" | "club" | "opinion",
 "tone": -2 to 2 (how the story reflects on the club: -2 bad, 0 neutral, 2 good),
 "is_rumour": true | false,
 "rumour_subject": "player or manager name if this is a transfer rumour, else \\"\\"",
 "source_tier": 1 to 4
}

Source tiers, applied strictly:
 1 = the club itself, or a competition/governing body
 2 = a named reporter with a strong public record on United business
 3 = established national press or broadcaster
 4 = aggregator, tabloid pickup, or a story that only cites another outlet

Rules that matter more than completeness:
 - Never invent a story, a fee, a quote or a date. Only report what you found.
 - If a claim is speculation, is_rumour must be true, whoever published it.
 - Prefer ten honest items to ten interesting ones. Fewer is fine.
"""


def load(path, default):
    p = DATA / path
    if p.exists():
        try:
            return json.loads(p.read_text())
        except json.JSONDecodeError:
            return default
    return default


def save(path, obj):
    p = DATA / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=1, ensure_ascii=False))


def key_for(subject):
    return re.sub(r"[^a-z0-9]+", "-", subject.lower()).strip("-")


def update_mood(items, today):
    """Mood is the average tone, weighted so tier-4 noise counts for less."""
    weights = {1: 1.0, 2: 1.0, 3: 0.8, 4: 0.4}
    num = den = 0.0
    for it in items:
        w = weights.get(int(it.get("source_tier", 3)), 0.6)
        num += float(it.get("tone", 0)) * w
        den += w
    score = round((num / den) * 50, 1) if den else 0.0

    mood = load("mood.json", [])
    mood = [m for m in mood if m["date"] != today]
    mood.append({"date": today, "mood": score, "stories": len(items)})
    mood.sort(key=lambda m: m["date"])
    save("mood.json", mood[-400:])
    return score


def update_rumours(items, today):
    """Temperature rises with mentions and with source quality, and decays daily."""
    book = load("rumours.json", {})

    for entry in book.values():
        days = (dt.date.fromisoformat(today) - dt.date.fromisoformat(entry["last_seen"])).days
        if days > 0:
            entry["temperature"] = round(entry["temperature"] * (0.88 ** days), 1)

    for it in items:
        subject = (it.get("rumour_subject") or "").strip()
        if not it.get("is_rumour") or not subject:
            continue
        k = key_for(subject)
        tier = int(it.get("source_tier", 4))
        heat = {1: 40, 2: 25, 3: 12, 4: 5}.get(tier, 5)
        entry = book.get(k) or {
            "subject": subject,
            "first_seen": today,
            "last_seen": today,
            "mentions": 0,
            "best_tier": 4,
            "temperature": 0.0,
            "sources": [],
            "status": "live",
        }
        entry["last_seen"] = today
        entry["mentions"] += 1
        entry["best_tier"] = min(entry["best_tier"], tier)
        entry["temperature"] = round(min(100.0, entry["temperature"] + heat), 1)
        if it.get("source") and it["source"] not in entry["sources"]:
            entry["sources"] = (entry["sources"] + [it["source"]])[:8]
        book[k] = entry

    for entry in book.values():
        age = (dt.date.fromisoformat(today) - dt.date.fromisoformat(entry["last_seen"])).days
        if age > 21 and entry["status"] == "live":
            entry["status"] = "cold"
            entry["lifespan_days"] = (
                dt.date.fromisoformat(entry["last_seen"])
                - dt.date.fromisoformat(entry["first_seen"])
            ).days

    save("rumours.json", book)
    return book


def main():
    today = dt.date.today().isoformat()
    items = cc.ask_json(PROMPT, job="wire", max_tokens=3000, max_searches=4)
    items = [i for i in items if i.get("headline")]

    stamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")
    save("wire.json", {"collected": stamp, "items": items})
    save(f"archive/{today}.json", {"collected": stamp, "items": items})
