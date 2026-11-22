# Tools for the store listing, pictures and videos (QCalc 1.12.0, stage M)

Everything shown on a picture or in a video is the real app: the page of `app/assets` in Chromium
(Playwright), with the real calculation engine behind a test server: the harness of the page tests, which
serves app/assets and passes the page's requests to the engine built for the PC (the same way as for
manual/shots.js; the test specification describes the page tests). The pictures are put together in Chromium too, and the videos with ffmpeg.
The tools use only Node.js with Playwright, Python's standard library, Chromium and ffmpeg; nothing is
added to the app.

| File | What it does |
|---|---|
| `listing_check.py` | Checks the store listings in `store/listing-<lang>.md` (app name 30, short description 80, full description 4000 characters; words that Google Play and Japan's law on misleading representations do not allow; names of other apps; no price; the contact address) and the texts on the pictures (`captions.json`) and in the videos (`store/video/*/*.srt`). With `--write`, writes `store/play-import/<locale>/{title,short_description,full_description}.txt` (the folder layout of fastlane "supply"). |
| `qcalc-page.js` | Opens the app's page in a given language and region (number format, currency) and drives it to the screens that the pictures and videos show. |
| `captions.json` | The headlines on the pictures, for each set (ja, en, en-GB, de, es, es-419, fr, fr-CA, ko, zh-TW). |
| `shots.js` | Makes the pictures: `store/screenshots-1.12/<set>/` (8 phone pictures 1080 × 1920, one 1920 × 1080, 5 each for 7-inch and 10-inch tablets; with the kind `alt`, `alt/phone-5-profile.png`, the earlier fifth phone picture kept as an alternative) and `store/feature-graphic-1.12-<lang>.png` (1024 × 500). |
| `assets_check.py` | Checks the sizes and formats of the pictures (and of the videos with `--videos`), and makes contact sheets at the size Google Play shows them (`--sheets`). |
| `video-plan.json` | The videos: for each language, the segments of the promo (16:9, 44 s), the YouTube video (16:9, 2:44, with chapters) and three shorts (9:16, 20–22 s): the recorded scene, the length, the headline, the label of a QCalc Pro feature, and the narration (also the subtitles). |
| `video_plan.py` | Writes `store/video/<lang>/script.md`, `storyboard.md`, the SRT files and `youtube.md` from the plan, and checks that each narration fits its segment at the pace of the language. |
| `video.js` | Records the scenes of the app (the taps shown as circles) as frames with their times, and makes a portrait clip of each with ffmpeg. |
| `video_cards.js` | Draws the backgrounds of the segments (headline, label, the frame of the phone, the closing card) and the YouTube thumbnails (`store/video/<lang>/thumbnail.png`). |
| `video_render.py` | Puts each video together (one file per segment, joined without encoding again), with the subtitles burnt in. Silent; a narration can be added later without encoding the picture again. |
| `video_voice.py` | Adds a narration to the videos at the times of the subtitles: a placeholder by speech synthesis on the work machine (Open JTalk, eSpeak NG), with `--engine gemini` by the Gemini API (`gemini_tts.py`), or with `--engine chatterbox` from the audio of `chatterbox_tts.py` (`<work>/voice-chatterbox/manifest.json`: each paragraph matched by video and segment, its text checked against the plan — a changed text stops the run and names the paragraph —, put at its start, read faster when longer than its room, up to 1.35 times in Japanese and 1.5 in the others; a video with a paragraph or a file missing is not made, and the run says so). The two engines share the mixing (the gain kept under full scale) and the mux. |
| `gemini_tts.py` | Speech synthesis with the Gemini API (gemini-3.8-flash-tts; the spare gemini-3.8-flash-lite-tts with `--model`): the Interactions API, the text read word for word with how to read in `speech_metadata`, WAV as it comes (a header only for headerless PCM), the free tier's limits kept here (3 a minute, 10 a day, 10,000 input tokens a minute; at most 8,192 a request, longer narrations split between paragraphs), the time the daily count starts again (midnight Pacific time, 17:00 in Japan in winter), answers kept so a video made again uses no request (named by model, voice, style and text, the same on any computer), the cut at the pauses checked by the seconds per character. `video_voice.py --sample` (voices to compare) and `--synth-only` (all the audio without videos, then a zip) need Python only; the steps for the owner are in `TTS-GEMINI-ja.md`. The key from `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). |
| `test_gemini_tts.py` | Tests of the two with made-up answers of the server (a local HTTP server; no key, no network). |
| `chatterbox_tts.py` | The narration by Chatterbox Multilingual V3 (Resemble AI, MIT) on the owner's own computer: free, no daily limit, one synthesis per paragraph (the same paragraphs and texts as `video_voice.py`), so nothing is cut afterwards. Writes `<work>/voice-chatterbox/<lang>/<video>-<NN>-<hash>.wav`, a `manifest.json` (video, segment, start, room, text, file, seconds, seed) and a zip per language; goes on where it stopped; `--sample tricky` (the paragraphs with numbers and signs), `--redo lang:n` (another seed), readings from `tts-readings.json`. Runs in a Python 3.11 environment with chatterbox-tts; the steps for the owner are in `TTS-CHATTERBOX-ja.md`. |
| `test_chatterbox_tts.py` | Its tests with a made-up engine (no model, no network, no torch). |
| `test_voice_chatterbox.py` | Tests of `video_voice.py --engine chatterbox` with a small made-up manifest and WAV files (the ones that make videos are skipped without ffmpeg). |
| `tts_engines.py` | The narration by several engines on the owner's own computer, to compare voices and then make everything with the voice chosen for each language: Qwen3-TTS (Apache-2.0; the voice designed by the 1.7B VoiceDesign model, read by the 1.7B or 0.6B Base model), Ming-3.0-tts-0.5B (MIT), Irodori-TTS v4.1-Small (MIT, Japanese only) and Chatterbox (as `chatterbox_tts.py`). A designed voice (female, male: `tts-voices.json`, description and seed) is made once as a short reference and reads every paragraph in every language (one person per engine; no real person's voice). `design`, `sample` (the paragraphs of `--sample tricky`, files named by language, engine, voice and paragraph, and the listening lists `listen.md` / `listen.html` with what to listen for), `all --use ja=irodori:female,en=qwen3:female,...` (`<work>/voice-tts/manifest.json` with the fields of `chatterbox_tts.py`, a zip per language), the time and the GPU memory of each paragraph, readings from `tts-readings.json` (also per engine, `qwen3:ja`). Each engine in its own environment; the steps for the owner are in `TTS-ENGINES-ja.md`, and for Qwen3-TTS alone (the engine chosen on 2026-11-22), on Windows or Ubuntu, in `TTS-QWEN3-ja.md`. |
| `tts-voices.json` | The designed voices of `tts_engines.py`: the description and the seed of each, and the language and the text of its reference. |
| `test_tts_engines.py` | Its tests with made-up engines and made-up model libraries (no model, no network, no torch): the paragraphs, the names, the voices, the runs, and how each engine calls its library. |

## Making everything again

```sh
# B: the address of the test server that serves app/assets with the engine (as for the page tests)
export NODE_PATH=$(npm root -g)
B=http://127.0.0.1:8790/

python3 store/tools/listing_check.py --write                # listings → store/play-import/
node store/tools/shots.js $B                                # all pictures (about 90 minutes)
node store/tools/shots.js $B ja phone calc,exact            # only some
python3 store/tools/assets_check.py --sheets /tmp/sheets

python3 store/tools/video_plan.py                           # scripts, storyboards, SRT, youtube.md
W=/tmp/qcalc-video
node store/tools/video.js $B $W                             # record the scenes (about 5 minutes a language)
node store/tools/video_cards.js $B $W                       # backgrounds and thumbnails
python3 store/tools/video_render.py $W                      # → $W/out/<lang>/*.mp4
python3 store/tools/assets_check.py --videos $W/out
python3 store/tools/video_voice.py $W                       # placeholder narration (Open JTalk, eSpeak NG) → $W/out-voice/
GEMINI_API_KEY=… python3 store/tools/video_voice.py $W ja --engine gemini   # the narration by the Gemini API
python3 store/tools/video_voice.py $W ja,en --sample 3 --voice Kore,Achird,Sulafat   # voices to compare (one request each)
python3 store/tools/video_voice.py $W --synth-only --voice Achird   # all the audio without videos → $W/voice-gemini-<date>.zip
python3 store/tools/test_gemini_tts.py                      # its tests (no key, no network)
python store/tools/chatterbox_tts.py $W                      # the narration by Chatterbox, on the owner's computer (TTS-CHATTERBOX-ja.md)
python3 store/tools/test_chatterbox_tts.py                  # its tests (no model)
python3 store/tools/video_voice.py $W --engine chatterbox   # its audio (the zips unpacked into $W/voice-chatterbox/) into the videos → $W/out-voice/
python3 store/tools/test_voice_chatterbox.py                # its tests
python3 store/tools/listing_check.py                        # the words on pictures and in subtitles
```

The engine's own currency is set by the test server (on a phone it is the currency of the region). The
calculation notes keep amounts in that currency, so the notes pictures and the notes scene of the videos are
taken with a server in the region's currency: en USD, en-GB GBP, de/es/fr EUR, es-419 MXN, fr-CA CAD, ko KRW,
zh-TW TWD (ja: JPY), e.g. `node store/tools/shots.js http://127.0.0.1:8803/ de phone notes`.

The videos (`*.mp4`) are not committed: they are large and are sent to the owner as files.
When the app's screens change, make the pictures and the videos again; the headlines and the narration
are in `captions.json` and `video-plan.json`.
