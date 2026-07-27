"""
The wire run. One Claude call does four jobs at once, which is the main cost
saving in this repo: the stories, the tone reading behind the coverage index,
the rumour tiering, and the names each story is about.

Also maintains the things that make the archive useful rather than merely large:
a rolling search index, a most-mentioned board, and an RSS feed.
"""

import datetime as dt
import json
import os
import pathlib
import re
import time

import claude_client as cc
import football_data as fd

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"

SITE_URL = os.environ.get("SITE_URL", "https://theeaststandmovement.github.io/TheEastStandMovement/")
INDEX_CAP = 3000       # stories kept in the searchable index
PEOPLE_WINDOW = 30     # days counted on the most-mentioned board
MAX_ATTEMPTS = 3

PROMPT = """Search for news about Manchester United published in the last 5 days.
Cover first-team news, transfers, injuries, and club matters. Use reputable
football journalism, not aggregator spam.

Return ONLY a JSON array of up to 10 objects, no prose, no markdown fences:

{
 "headline": "max 90 chars, factual, no clickbait",
 "summary": "max 160 chars, plain and specific",
 "source": "publication name",
 "url": "the URL from the search result, or empty string if you do not have one",
 "published": "e.g. 24 Jul",
 "category": "transfers" or "team news" or "match" or "club" or "opinion",
 "tone": -2 to 2 (how the story reflects on the club: -2 bad, 0 neutral, 2 good),
 "is_rumour": true or false,
 "rumour_subject": "player or manager name if this is a transfer rumour, else empty",
 "source_tier": 1 to 4,
 "people": ["full names of the players, managers or executives the story is about"]
}

Source tiers, applied strictly:
 1 = the club itself, or a competition/governing body
 2 = a named reporter with a strong public record on United business
 3 = established national press or broadcaster
 4 = aggregator, tabloid pickup, or a story that only cites another outlet

Rules that matter more than completeness:
 - Never invent a story, a fee, a quote or a date. Only report what you found.
 - If a claim is speculation, is_rumour must be true, whoever published it.
 - Use full names in "people", spelled consistently, and leave it empty if the
   story is not about particular individuals.
 - Prefer ten honest items to ten interesting ones. Fewer is fine.
"""

REQUIRED = ("headline", "summary", "source")


# ---------------------------------------------------------------- storage

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


def key_for(text):
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")


def xml_safe(text):
    return (str(text).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


# ---------------------------------------------------------------- fetching

def fetch_items():
    """Ask Claude, retrying if the reply is unusable. Cheap failures are common."""
    last = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            raw = cc.ask_json(PROMPT, job="wire", max_tokens=8000, max_searches=2)
        except Exception as exc:
            last = exc
            print("Attempt " + str(attempt) + " failed: " + str(exc))
            time.sleep(4 * attempt)
            continue

        if not isinstance(raw, list):
            last = ValueError("reply was not a list")
            continue

        good = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            if not all(item.get(k) for k in REQUIRED):
                continue
            item.setdefault("category", "club")
            item.setdefault("source_tier", 4)
            item.setdefault("tone", 0)
            item.setdefault("people", [])
            if not isinstance(item.get("people"), list):
                item["people"] = []
            good.append(item)

        if good:
            return good
        last = ValueError("no usable items in reply")
        print("Attempt " + str(attempt) + " returned nothing usable.")

    raise RuntimeError("Wire failed after " + str(MAX_ATTEMPTS) + " attempts: " + str(last))


# ---------------------------------------------------------------- derived data

def update_mood(items, today):
    """Tone of coverage, weighted so tier-4 noise counts for less."""
    weights = {1: 1.0, 2: 1.0, 3: 0.8, 4: 0.4}
    num = 0.0
    den = 0.0
    for it in items:
        w = weights.get(int(it.get("source_tier", 3)), 0.6)
        num += float(it.get("tone", 0)) * w
        den += w
    score = round((num / den) * 50, 1) if den else 0.0

    mood = load("mood.json", [])
    mood = [m for m in mood if m.get("date") != today]
    mood.append({"date": today, "mood": score, "stories": len(items)})
    mood.sort(key=lambda m: m.get("date", ""))
    save("mood.json", mood[-400:])
    return score


def update_rumours(items, today):
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
            "subject": subject, "first_seen": today, "last_seen": today,
            "mentions": 0, "best_tier": 4, "temperature": 0.0,
            "sources": [], "status": "live",
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


def update_index(items, today):
    """A single flat file the browser can search without fetching the archive."""
    index = load("search-index.json", [])
    seen = set(row.get("h") for row in index)

    added = 0
    for it in items:
        if it["headline"] in seen:
            continue
        index.append({
            "d": today,
            "h": it["headline"],
            "s": it.get("source", ""),
            "u": it.get("url", ""),
            "c": it.get("category", "club"),
            "p": it.get("people", [])[:4],
        })
        seen.add(it["headline"])
        added += 1

    index = index[-INDEX_CAP:]
    save("search-index.json", index)
    return index, added


def update_people(index, today):
    """Who the news has actually been about lately."""
    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=PEOPLE_WINDOW)).isoformat()
    counts = {}
    for row in index:
        if row.get("d", "") < cutoff:
            continue
        for name in (row.get("p") or []):
            name = str(name).strip()
            if len(name) < 3:
                continue
            k = key_for(name)
            entry = counts.get(k) or {"name": name, "count": 0, "last": row["d"]}
            entry["count"] += 1
            if row["d"] > entry["last"]:
                entry["last"] = row["d"]
            counts[k] = entry

    board = sorted(counts.values(), key=lambda e: (-e["count"], e["name"]))[:15]
    save("people.json", {"window_days": PEOPLE_WINDOW, "updated": today, "board": board})
    return board


def write_feed(items, stamp):
    """A real RSS feed, so the site behaves like a publication."""
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0"><channel>',
        "<title>The East Stand Movement</title>",
        "<link>" + xml_safe(SITE_URL) + "</link>",
        "<description>Manchester United, marked the same way every week.</description>",
        "<language>en-gb</language>",
        "<lastBuildDate>" + stamp + "</lastBuildDate>",
    ]
    for it in items:
        link = it.get("url") or SITE_URL
        parts.append(
            "<item><title>" + xml_safe(it["headline"]) + "</title>"
            + "<link>" + xml_safe(link) + "</link>"
            + "<description>" + xml_safe(it.get("summary", "")) + "</description>"
            + "<category>" + xml_safe(it.get("category", "club")) + "</category>"
            + "<guid isPermaLink=\"false\">" + xml_safe(key_for(it["headline"])) + "</guid>"
            + "</item>"
        )
    parts.append("</channel></rss>")
    (DATA.parent / "feed.xml").write_text("\n".join(parts), encoding="utf-8")


# ---------------------------------------------------------------- main

def main():
    today = dt.date.today().isoformat()
    items = fetch_items()

    stamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")
    save("wire.json", {"collected": stamp, "items": items})
    save("archive/" + today + ".json", {"collected": stamp, "items": items})

    mood = update_mood(items, today)
    book = update_rumours(items, today)
    index, added = update_index(items, today)
    board = update_people(index, today)
    write_feed(items, stamp)

    fixtures = fd.upcoming(6)
    if fixtures:
        save("fixtures.json", fixtures)

    live = 0
    for entry in book.values():
        if entry["status"] == "live":
            live += 1

    top = board[0]["name"] if board else "nobody"
    print(str(len(items)) + " stories (" + str(added) + " new), coverage " + str(mood)
          + ", " + str(live) + " live rumours, " + str(len(index)) + " indexed, top name: " + top)

    cc.step_summary("Wire")


if __name__ == "__main__":
    main()
