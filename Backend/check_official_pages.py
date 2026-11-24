"""Weekly check of the official pages behind Dublin Buddy's answers about laws and rules (visas and work hours,
tenancy law, tax, the minimum wage, fares). Run by .github/workflows/check-official-pages.yml every Monday.

For each page in data/official_sources.json it saves the page's readable text to data/official_pages/<name>.txt.
When the text differs from last week's, the page is listed as changed: the workflow then opens (or adds to) a GitHub
issue so the team reviews what changed (the commit's diff shows the exact wording) and updates the assistant's
instructions or the Things to know page if a rule changed. The assistant itself already searches these sites live,
so its answers follow a change straight away; this check is so a person also looks at it.

    python Backend/check_official_pages.py            # prints what changed; writes changed.md when anything did
"""
import html
import json
import os
import re
import sys
from datetime import date

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, "data", "official_sources.json")
SAVED = os.path.join(HERE, "data", "official_pages")
REPORT = os.path.join(HERE, "..", "changed.md")
HEADERS = {"User-Agent": "FindMyDublin/1.0 (MSc student project; weekly check of official pages; "
                         "https://github.com/Sandyshor/Msc-Group-Project-Team-1)"}


def readable_text(page):
    """The words a person reads on the page (no scripts, menus, header or footer), one line per block."""
    page = re.sub(r"(?is)<(script|style|noscript|svg|nav|header|footer|form)\b.*?</\1>", " ", page)
    main = re.search(r"(?is)<main\b.*?</main>", page)
    page = main.group(0) if main else page
    page = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d|dt|dd|section|article)>", "\n", page)
    text = html.unescape(re.sub(r"<[^>]+>", " ", page))
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line) + "\n"


def file_name(url):
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"^https?://(www\.)?", "", url.lower())).strip("-")[:120] + ".txt"


def main():
    with open(SOURCES, encoding="utf-8") as f:
        sources = json.load(f)
    os.makedirs(SAVED, exist_ok=True)
    changed, failed, new = [], [], []
    for topic in sources.get("topics", []):
        for url in topic.get("pages", []):
            path = os.path.join(SAVED, file_name(url))
            try:
                r = requests.get(url, headers=HEADERS, timeout=30)
                r.raise_for_status()
                text = readable_text(r.text)
            except requests.RequestException as e:
                failed.append((topic["topic"], url, type(e).__name__))
                continue
            if len(text) < 200:
                failed.append((topic["topic"], url, "almost no text (blocked or moved?)"))
                continue
            old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
            if old == text:
                continue
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            (new if old is None else changed).append((topic["topic"], url))

    for label, rows in (("Changed", changed), ("First saved", new), ("Could not check", failed)):
        for row in rows:
            print(f"{label}: {' | '.join(row)}")
    if changed or failed:
        lines = [f"Weekly check of the official pages, {date.today():%d %B %Y}.", ""]
        if changed:
            lines += ["**These official pages changed since last week.** Please read what changed (this week's commit "
                      "to `Backend/data/official_pages/` shows the exact wording) and, if a rule changed:", "",
                      "1. Check Dublin Buddy's instructions in `Backend/chat.py` (and `Backend/data/official_sources.json`).",
                      "2. Check the Things to know page (`Frontend/pages/things-to-know.json`) and the FAQ.",
                      "3. Set `last_reviewed` in `Backend/data/official_sources.json` to today's date.", ""]
            lines += [f"- {topic}: {url}" for topic, url in changed]
            lines.append("")
        if failed:
            lines += ["These pages could not be checked (a page may have moved: update its address in "
                      "`Backend/data/official_sources.json`):", ""]
            lines += [f"- {topic}: {url} ({why})" for topic, url, why in failed]
        with open(REPORT, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
