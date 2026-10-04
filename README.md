# InvestSense Notebook (trial)

Study notebooks for the research-tool courses on
[InvestSense Learn](https://aryanoleti.github.io/learning-page/). Finish a
course, then open its notebook to ask questions about the lessons or turn them
into something to study with.

Live: https://aryanoleti.github.io/learning-notebook/

## What's in a notebook

- **Sources** — every lesson in the course plus the glossary. Tick which ones
  the AI should use; click one to read it.
- **Chat** — answers come only from the selected sources, with numbered
  citations that open the lesson they came from, and suggested follow-ups.
- **Studio**
  - Audio Overview: a two-host script, voiced with Gemini's multi-speaker
    speech (or the browser's own voices if that fails)
  - Slide deck: view in the page or download as `.pptx`
  - Quiz: multiple choice with explanations
  - Flashcards: flip, shuffle, mark as known
  - Mind map: a foldable map of the course
  - Reports: study guide, briefing doc or FAQ
- **Notes** — save chat answers or write your own.

Course progress is read from InvestSense Learn's saved progress (both sites
are on `aryanoleti.github.io`, so they share browser storage). A notebook
unlocks when its course is complete; as a trial, locked notebooks can still
be previewed.

## Gemini key

The AI runs on Google's Gemini API, called directly from the browser.

- **Per user:** paste a key in Settings. It is stored in that browser only.
- **Site-wide trial key:** add a repository secret named `GEMINI_KEY`. The
  deploy workflow writes it into `config.js`. That makes the key readable by
  anyone who opens the site, so first restrict it in Google Cloud Console
  (APIs & Services → Credentials → the key → Website restrictions →
  `https://aryanoleti.github.io/*`) and keep a spending cap on the project.

Models are tried in order — `gemini-2.5-flash`, `gemini-2.5-flash-lite`,
`gemini-2.0-flash` — so a rate limit on one falls through to the next. A
different preferred model can be set in Settings. Audio uses
`gemini-2.5-flash-preview-tts`.

## Updating the course content

`data/courses.json` is generated from the learning-page repo:

```bash
node tools/build-data.mjs ../learning-page
```

## Local preview

```bash
node tools/serve.mjs 4410
```

No build step: the site is plain HTML, CSS and JavaScript modules.
Educational only — not investment advice. Every company in the courses is
invented.
