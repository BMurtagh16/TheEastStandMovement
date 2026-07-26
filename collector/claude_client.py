"""
Thin wrapper around the Claude Messages API.

Every call is metered and appended to docs/data/usage.csv. Nothing in this repo
talks to Claude except through here, so the cost log can never drift out of date.
"""

import csv
import datetime as dt
import json
import os
import pathlib
import re

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
USAGE_CSV = ROOT / "docs" / "data" / "usage.csv"
API_URL = "https://api.anthropic.com/v1/messages"

# USD per million tokens (input, output).
PRICES = {
    "claude-sonnet-5": (3.00, 15.00),
    "claude-haiku-4-5-20251001": (1.00, 5.00),
    "claude-opus-5": (5.00, 25.00),
}
SEARCH_COST = 0.01  # per web search

DEFAULT_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5")


def _price(model, tokens_in, tokens_out, searches):
    rate_in, rate_out = PRICES.get(model, (3.00, 15.00))
    return (
        tokens_in / 1_000_000 * rate_in
        + tokens_out / 1_000_000 * rate_out
        + searches * SEARCH_COST
    )


def log_usage(job, model, tokens_in, tokens_out, searches, cost, ok=True):
    USAGE_CSV.parent.mkdir(parents=True, exist_ok=True)
    new = not USAGE_CSV.exists()
    with USAGE_CSV.open("a", newline="") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(
                ["timestamp", "job", "model", "tokens_in", "tokens_out",
                 "searches", "cost_usd", "ok"]
            )
        w.writerow([
            dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            job, model, tokens_in, tokens_out, searches,
            f"{cost:.5f}", "1" if ok else "0",
        ])


def ask(prompt, job, model=DEFAULT_MODEL, max_tokens=3000, search=True, max_searches=4):
    """Send one prompt, meter it, return the raw text of the reply."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")

    body = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if search:
        body["tools"] = [
            {"type": "web_search_20250305", "name": "web_search", "max_uses": max_searches}
        ]

    resp = requests.post(
        API_URL,
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=body,
        timeout=180,
    )

    if resp.status_code != 200:
        log_usage(job, model, 0, 0, 0, 0.0, ok=False)
        raise RuntimeError(f"Claude returned {resp.status_code}: {resp.text[:400]}")

    data = resp.json()
    usage = data.get("usage", {})
    tokens_in = usage.get("input_tokens", 0)
    tokens_out = usage.get("output_tokens", 0)
    searches_used = (usage.get("server_tool_use") or {}).get("web_search_requests", 0)
    cost = _price(model, tokens_in, tokens_out, searches_used)
    log_usage(job, model, tokens_in, tokens_out, searches_used, cost)
    print(f"[{job}] {tokens_in} in / {tokens_out} out / {searches_used} searches / ${cost:.4f}")

    return "\n".join(
        b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
    )


def ask_json(prompt, job, **kw):
    """Same as ask(), but insists on a JSON array or object coming back."""
    text = ask(prompt, job, **kw)
    clean = re.sub(r"```(?:json)?|```", "", text).strip()
    for opener, closer in (("[", "]"), ("{", "}")):
        start, end = clean.find(opener), clean.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(clean[start:end + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError(f"No usable JSON in reply:\n{text[:600]}")


def totals():
    """Running cost, for the site's own cost ticker."""
    if not USAGE_CSV.exists():
        return {"calls": 0, "searches": 0, "cost_usd": 0.0, "since": None}
    rows = list(csv.DictReader(USAGE_CSV.open()))
    return {
        "calls": len(rows),
        "searches": sum(int(r["searches"] or 0) for r in rows),
        "cost_usd": round(sum(float(r["cost_usd"] or 0) for r in rows), 4),
        "since": rows[0]["timestamp"][:10] if rows else None,
    }
