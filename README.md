# StudyDesk

A study website built with Python (Flask).

- **Flip clock + flip focus timer** – Pomodoro style (Focus / Short break / Long break), editable lengths, sound + notification when a round ends, keeps count of minutes studied today. Press Space to start/pause.
- **Study timetable maker** – add subjects with priorities, pick study days, start time, hours/day, session and break length. Python builds a balanced week (higher priority = more sessions). Click any block to change subject/time, delete it, or add your own; tick sessions off as you finish. Print-friendly.
- **PDF notes** – upload a text-based PDF. It finds the most important sentences (definitions, laws/formulas, key terms, "important/therefore/in summary" phrases), underlines or highlights them, lists key topics and key points, and lets you control how much gets marked (5-50%).

## Run it

    pip install -r requirements.txt
    python app.py

Open http://127.0.0.1:5000

Everything is saved in your browser (localStorage). Uploaded PDFs are processed in memory and never stored.

## Notes
- Scanned PDFs (photos of pages) have no text to read. Run OCR first.
- Fonts load from Google Fonts; the site still works offline with fallback fonts.
