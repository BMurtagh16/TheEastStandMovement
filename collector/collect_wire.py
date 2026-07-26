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
 "url": "the URL from the search result, or empty string if you do not have one",
 "published": "e.g. 24 Jul",
 "category": "transfers" or "team news" or "match" or "club" or "opinion",
 "tone": -2 to 2 (how the story reflects on the club: -2 bad, 0 neutral, 2 good),
 "is_rumour": true or false,
 "rumour_subject": "player or manager name if this is a transfer rumour, else empty",
 "source_tier": 1 to 4
}

Source
