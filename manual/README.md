# The user manual of QCalc

One source for each language makes two forms with the same text (1.12.0):

| Form | Where | What it has |
| --- | --- | --- |
| Inside the app | `app/assets/manual/<lang>.js` | Text and simple SVG pictures. Read only when the manual is opened (not at start), and offline |
| Full version on the site | `docs/manual/<lang>/index.html` | The same text with photos of the screens (`docs/manual/<lang>/img/`), a search, and a PDF (`QCalc-manual-<lang>.pdf`) |

The made files are committed: `build-apk.sh` and Gradle do not make them.

## Making it

```
python3 manual/build.py          # makes both forms and checks them (Python standard library only)
python3 manual/build.py --check  # only checks
python3 manual/pdf.py            # the PDFs, printed from the web version by Chromium (give its path with CHROME=...)
node manual/shots.js <url> [langs]   # (only when the screens change) the photos, with Node.js and Playwright
```

The check fails when a name of a button or a screen written as `[[...]]` is not a text of the app in that
language, when a link goes to no section, when the ids differ between languages, when an id the app links
to (the "?" of the panels and tools, the rows of QCalc Pro: `MANUAL_IDS` in app.js) is missing, or when
the manuals inside the app are larger than 1.5 MB together.

## The source: `manual/src/<lang>.txt`

```
// a comment
= Title
@sub Subtitle (the cover)
# id | Chapter          ## id | Section          ### id | Subsection
:what: what it does
:step: one step (consecutive steps make a numbered list; at most 7)
:example: an example with real numbers (the same result as the app)
:tip: a tip
:mistake: a common mistake (consecutive ones make one box)
:note: a note of caution
:pro: (optional text)     the mark "QCalc Pro" and "This is a QCalc Pro feature."
:svg: name | caption      a picture of manual/svg/name.svg (both forms)
:legend: 1 text; 2 text   what the numbers of the picture above are
:shot: name | caption     a photo of docs/manual/<lang>/img/name.jpg (web only)
- an item of a list
| a | table | row |       (the first row is the heading)
other lines: paragraphs (a blank line ends one)
```

In a line: `[[name on the screen]]` (checked against the app; in German, Spanish, French, Korean and
Traditional Chinese write the English text of the app and it is replaced by its translation),
`[[!text]]` (shown the same, not checked: keys such as `=`), `**bold**`, `` `expression` ``,
`[text](#id)` and `[text](https://…)`.

**The ids of the sections are English names, the same in every language, and must not change**: the app
links to them.
