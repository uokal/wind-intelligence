# Automated Wind Forecast Intelligence demo

Produces a 580-second (9:40), 1920×1080, 30 FPS H.264/AAC MP4 with English narration, burned-in captions, an embedded English subtitle track, and a separate SRT. The first 300 seconds demonstrate the product; technical content starts at 5:00. No music, upload, push, or deployment is performed.

Prerequisites: project JavaScript dependencies, the API virtualenv, Chromium installed for Playwright, FFmpeg/ffprobe with libx264 and AAC, local Tesseract OCR for caption-clock calibration, and macOS `say` with the installed Daniel English voice. No paid service is used. Other platforms need a replacement local TTS adapter; the current script deliberately fails if its tools are missing.

Start the services from the repository root:

```sh
apps/wind-api/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir apps/wind-api
pnpm exec vite --config apps/wind-web/vite.config.mts --host 127.0.0.1 --port 5173
```

Then run:

```sh
node demo/scripts/record-demo.mjs --all
```

`DEMO_FRONTEND_URL` and `DEMO_BACKEND_URL` can select other local service URLs. The services must be running; the recorder does not silently start or replace them.

Stages may be run separately:

```sh
node demo/scripts/record-demo.mjs --prepare
node demo/scripts/record-demo.mjs --record
node demo/scripts/record-demo.mjs --assemble
node demo/scripts/record-demo.mjs --validate
```

Preparation verifies live January data, populated charts, console output, health and Swagger; runs real pytest, Vitest, strict TypeScript, ESLint, Ruff, and build commands; generates an allowlisted read-only source viewer; substitutes verified KPIs and test counts into narration; and synthesises measured speech cues. Decimal numbers remain intact when splitting speech. Speech is cached by voice, rate, and text. Modest tempo adjustments keep chapter boundaries exact; oversized narration fails instead of silently truncating speech.

Recording uses one Chromium page with Playwright video capture. The conclusion is captured separately after fresh real data finishes loading, then replaces the last twenty seconds during assembly; loading time is excluded from the closing scene. There are no mocked responses, route interceptions, synthetic API results, or simulated terminal output. Product interactions, Swagger executions, and repository source navigation occur in the real browser. The source viewer presents only explicit repository files and captured command output; it excludes `.env`, credentials, personal browser content, and unrelated files. It removes terminal ANSI sequences and redacts the repository's absolute path without rewriting test results. The browser contains only the recording page; its window chrome is not captured.

Captions are rendered over the browser capture using the same measured cue clock as the SRT. This avoids requiring FFmpeg's optional libass filter. They use white text on a translucent dark background, at most two lines, with a 56px bottom margin. Local OCR measures visible caption transitions in the encoded capture and corrects its startup offset against the narration clock; a drift spread above 350 milliseconds fails validation. FFmpeg assembles the recording with brief chapter fades and normalised narration, and embeds the same English subtitle file. The browser applies a small KPI zoom; source code uses a larger readable font with syntax highlighting.

All generated media, raw recordings, audio, API evidence, logs, viewer HTML, metadata, and the recording report live in ignored `demo/output/`. Only automation and documentation belong in Git. `narration.md` is the resolved narration for the verified take; `scenes.json` retains dynamic placeholders for future runs.

The final MP4 is intended for a manual **Unlisted** YouTube upload. Review the local video first. Do not upload automatically.
