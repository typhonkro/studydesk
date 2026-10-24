from __future__ import annotations

import io
import math
import re
from collections import Counter, defaultdict

from flask import Flask, jsonify, render_template, request
from pypdf import PdfReader

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024  # 30 MB upload limit
MAX_PAGES = 400


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html")


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="That PDF is larger than 30 MB. Try a smaller file or split it."), 413


# --------------------------------------------------------------------------
# PDF analysis
# --------------------------------------------------------------------------
STOP = set(
    """a about above after again against all also am an and any are as at be because been before
    being below between both but by can could did do does doing down during each few for from
    further had has have having he her here hers him his how i if in into is it its itself just
    me more most my no nor not now of off on once only or other our out over own same she should
    so some such than that the their them then there these they this those through to too under
    until up very was we were what when where which while who whom why will with would you your
    yours may might shall one two three use used using like many much however within without upon
    via per etc eg ie fig figure table can't don't also thus hence""".split()
)

WORD = re.compile(r"[A-Za-z][A-Za-z'\-]{2,}")
SENT_SPLIT = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9(\["\u201c\'])')

# Phrases that usually mark an important sentence in textbooks / notes.
DEFINITION = re.compile(
    r"\b(is defined as|are defined as|is called|are called|is known as|are known as|"
    r"refers to|is the process|is a measure|can be defined|means that|stands for)\b",
    re.I,
)
EMPHASIS = re.compile(
    r"\b(important|importantly|key|essential|crucial|remember|note that|significant|"
    r"always|never|must|therefore|in summary|in conclusion|to summari[sz]e|main|"
    r"fundamental|primary)\b",
    re.I,
)
LAWISH = re.compile(
    r"\b(formula|equation|theorem|law|principle|rule|proof|definition|postulate|"
    r"hypothesis|property|properties|axiom|derive[sd]?)\b",
    re.I,
)
MATHISH = re.compile(r"[=\u2248\u221d\u2211\u222b\u221a]|\d\s?(m/s|kg|mol|N|J|W|V|Hz|%|cm|mm|km)\b")


def stem(word: str) -> str:
    """Very light stemming: just fold simple plurals so 'cells' == 'cell'."""
    w = word.lower().strip("-'")
    if len(w) > 4 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def looks_like_heading(line: str) -> bool:
    line = line.strip()
    if len(line) < 3 or len(line) > 70 or line[-1] in ".,;":
        return False
    if re.fullmatch(r"[\d\s\-\u2013/]+", line):  # page numbers
        return False
    words = line.split()
    if len(words) > 10 or sum(c.isalpha() for c in line) < 3:
        return False
    if not (line[0].isupper() or line[0].isdigit()):
        return False
    if line.isupper():
        return True
    if re.match(r"^\d+(\.\d+)*[.)]?\s+\S", line):
        return True
    caps = sum(1 for w in words if w[0].isupper())
    return caps / len(words) >= 0.6


def parse_page(raw: str) -> list[dict]:
    """Turn raw page text into a list of {t: text, k: 'h'|'s', p: paragraph-start}."""
    raw = raw.replace("\u00ad", "").replace("\r", "")
    raw = re.sub(r"-\n(?=[a-z])", "", raw)  # join hyphenated line-breaks
    items: list[dict] = []
    buf: list[str] = []
    new_para = True

    def flush():
        nonlocal buf, new_para
        if not buf:
            return
        text = re.sub(r"\s+", " ", " ".join(buf)).strip()
        for i, sent in enumerate(SENT_SPLIT.split(text)):
            sent = sent.strip()
            if len(sent) > 1:
                items.append({"t": sent, "k": "s", "p": new_para and i == 0})
        buf = []
        new_para = False

    for line in raw.split("\n"):
        s = line.strip()
        if not s:
            flush()
            new_para = True
            continue
        if re.fullmatch(r"\d{1,4}", s):  # lone page number
            continue
        prev_ok = (not buf) or buf[-1][-1:] in ".!?:"
        if prev_ok and looks_like_heading(s):
            flush()
            items.append({"t": s, "k": "h", "p": True})
            new_para = True
        else:
            buf.append(s)
    flush()
    return items


def analyze(pages_text: list[str]) -> dict:
    pages = [parse_page(t) for t in pages_text]
    n_pages = max(len(pages), 1)

    tf: Counter = Counter()
    df: Counter = Counter()
    bigrams: Counter = Counter()
    surface: dict[str, Counter] = defaultdict(Counter)
    heading_terms: set[str] = set()
    total_words = 0

    for items in pages:
        seen: set[str] = set()
        for it in items:
            words = [w.lower() for w in WORD.findall(it["t"])]
            total_words += len(it["t"].split())
            stems = [None if w in STOP else stem(w) for w in words]
            for w, s in zip(words, stems):
                if s:
                    tf[s] += 1
                    seen.add(s)
                    surface[s][w] += 1
                    if it["k"] == "h":
                        heading_terms.add(s)
            for a, b in zip(stems, stems[1:]):
                if a and b and a != b:
                    bigrams[f"{a} {b}"] += 1
        for s in seen:
            df[s] += 1

    # keyword weight = (1 + log tf) * idf-over-pages, headings get a boost
    kw: dict[str, float] = {}
    for s, c in tf.items():
        w = (1 + math.log(c)) * math.log(1 + n_pages / df[s])
        if s in heading_terms:
            w *= 1.5
        kw[s] = w

    # score every sentence
    scored: list[tuple[float, int, int]] = []
    for pi, items in enumerate(pages):
        for ii, it in enumerate(items):
            if it["k"] != "s":
                continue
            text = it["t"]
            stems = [stem(w.lower()) for w in WORD.findall(text) if w.lower() not in STOP]
            if len(stems) < 4:
                it["r"] = 1.0
                continue
            base = sum(kw.get(s, 0.0) for s in set(stems)) / math.sqrt(len(stems))
            if len(text.split()) > 70:
                base *= 0.7
            bonus = 1.0
            if DEFINITION.search(text):
                bonus += 0.5
            if EMPHASIS.search(text):
                bonus += 0.3
            if LAWISH.search(text):
                bonus += 0.3
            if MATHISH.search(text):
                bonus += 0.2
            scored.append((base * bonus, pi, ii))

    scored.sort(reverse=True)
    for rank, (_, pi, ii) in enumerate(scored):
        pages[pi][ii]["r"] = round(rank / max(len(scored), 1), 4)
    for items in pages:
        for it in items:
            it.setdefault("r", 1.0)

    # topics: frequent two-word phrases first, then top single words
    topics: list[dict] = []
    used: list[str] = []
    for phrase, c in bigrams.most_common(60):
        if c < 2 or len(topics) >= 6:
            break
        topics.append({"term": phrase, "count": c})
        used.append(phrase)
    for s, _ in sorted(kw.items(), key=lambda x: -x[1]):
        if len(topics) >= 16:
            break
        if tf[s] < 2 and len(pages) > 1:
            continue
        if any(s in u.split() for u in used):
            continue
        shown = surface[s].most_common(1)[0][0] if surface[s] else s
        topics.append({"term": stem(shown), "count": tf[s]})

    sentence_count = sum(1 for items in pages for it in items if it["k"] == "s")
    return {
        "pages": [{"n": i + 1, "items": items} for i, items in enumerate(pages)],
        "topics": topics,
        "stats": {
            "pages": len(pages),
            "sentences": sentence_count,
            "words": total_words,
            "minutes": max(1, round(total_words / 200)),
        },
    }


@app.post("/api/analyze")
def api_analyze():
    f = request.files.get("pdf")
    if not f or not f.filename:
        return jsonify(error="Choose a PDF file first."), 400
    data = f.read()
    if not data.startswith(b"%PDF"):
        return jsonify(error="That file doesn't look like a PDF."), 400
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                return jsonify(error="This PDF is password-protected. Remove the password and try again."), 422
        texts = []
        for page in list(reader.pages)[:MAX_PAGES]:
            try:
                texts.append(page.extract_text() or "")
            except Exception:
                texts.append("")
    except Exception:
        return jsonify(error="Couldn't read that PDF. It may be damaged."), 422

    if sum(len(t.strip()) for t in texts) < 80:
        return jsonify(
            error="No readable text found. This looks like a scanned PDF (images only). "
            "Run it through OCR first, then upload it again."
        ), 422

    result = analyze(texts)
    result["filename"] = f.filename
    return jsonify(result)


# --------------------------------------------------------------------------
# Timetable generator
# --------------------------------------------------------------------------
def _hhmm(minutes: int) -> str:
    minutes %= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _clamp(v, lo, hi, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def build_timetable(subjects: list[dict], settings: dict) -> dict:
    days = list(settings.get("days") or [])[:7]
    days += [0] * (7 - len(days))
    active = [i for i, d in enumerate(days) if d]
    if not active:
        raise ValueError("Pick at least one study day.")
    if not subjects:
        raise ValueError("Add at least one subject.")

    try:
        h, m = str(settings.get("start", "17:00")).split(":")
        start = int(h) * 60 + int(m)
    except ValueError:
        start = 17 * 60
    hours = _clamp(settings.get("hours"), 0.5, 14, 3)
    session = int(_clamp(settings.get("session"), 10, 180, 45))
    brk = int(_clamp(settings.get("brk"), 0, 60, 10))

    slots = max(1, int((hours * 60 + brk) // (session + brk)))
    total = slots * len(active)
    n = len(subjects)
    weights = [_clamp(s.get("priority"), 1, 5, 3) for s in subjects]

    # how many sessions each subject gets this week (largest remainder method)
    base = [1] * n if total >= n else [0] * n
    left = total - sum(base)
    wsum = sum(weights)
    raw = [left * w / wsum for w in weights]
    quota = [b + int(r) for b, r in zip(base, raw)]
    order = sorted(range(n), key=lambda i: raw[i] - int(raw[i]), reverse=True)
    for i in order[: total - sum(quota)]:
        quota[i] += 1

    schedule: dict[str, list[dict]] = {}
    for di, day in enumerate(active):
        prev = None
        day_blocks = []
        for s in range(slots):
            # most sessions still owed first; rotate ties so days differ
            ranked = sorted(range(n), key=lambda j: (-quota[j], (j - (di + s)) % n))
            pick = next((j for j in ranked if quota[j] > 0 and j != prev), None)
            if pick is None:
                pick = next((j for j in ranked if quota[j] > 0), ranked[0])
            quota[pick] = max(0, quota[pick] - 1)
            prev = pick
            t0 = start + s * (session + brk)
            day_blocks.append(
                {"start": _hhmm(t0), "end": _hhmm(t0 + session), "sid": subjects[pick]["id"]}
            )
        schedule[str(day)] = day_blocks
    return {"schedule": schedule, "slots_per_day": slots}


@app.post("/api/timetable")
def api_timetable():
    body = request.get_json(silent=True) or {}
    try:
        subjects = [s for s in body.get("subjects", []) if str(s.get("name", "")).strip()]
        return jsonify(build_timetable(subjects, body.get("settings", {})))
    except ValueError as e:
        return jsonify(error=str(e)), 400


if __name__ == "__main__":
    app.run(debug=True)
