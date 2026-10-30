# Task 12 validated take

Application baseline: `1e52581`. The completed take uses real January 2026 Elexon-backed responses. There are no mock responses or simulated test results.

- MP4: `demo/output/wind-intelligence-demo.mp4`
- Captions: `demo/output/wind-intelligence-demo.srt`
- Full report: `demo/output/recording-report.md`
- Duration: **580.000000 seconds / 9:40**
- Video: **1920×1080, 30 FPS, H.264, yuv420p**
- Audio: **AAC, 48 kHz**, local macOS Daniel English narration
- Final file size: **44,255,891 bytes**
- Audio mean: **−16.6 dB**; maximum: **−1.1 dB**
- Captions: **104** measured cues, maximum two lines, white text on dark background, 56px safe margin; burned in, embedded English track, and external SRT

Preflight confirmed the frontend, backend, populated charts, Swagger, all four dashboard API calls, and 1,488 January intervals. Browser console/page errors were absent. The full capture recorded 33 successful API responses; the separately preloaded conclusion recorded four more. Filter dates and cutoffs were verified against response content. No intercepted or cached fixture responses were used.

Fresh command evidence: pytest **90 passed**, Vitest **14 passed**, strict TypeScript, ESLint, Ruff, and production build passed. Actual output is displayed during the technical walkthrough. Docker and Vercel configuration are shown without claiming a verified build or deployment.

Final QA included ffprobe metadata assertions, complete audio/video decoding, successful Chromium playback, audio level measurements, all-caption layout and measured timing checks, plus encoded caption transitions within ±250ms at four sampled cues, and representative frame review. The closing scene was replaced with a real capture made after loading finished. Privacy review covered the recording allowlist and sampled frames; environment values, credentials, Git tokens, private browser content, and personal filesystem paths are excluded from the recording.

Timeline:

| Start | Scene                                                |
| ----- | ---------------------------------------------------- |
| 0:00  | Introduction                                         |
| 0:40  | KPI explanation                                      |
| 1:40  | Forecast and error charts                            |
| 2:40  | Interactive filters and refresh                      |
| 3:40  | Accuracy, data quality, methodology and transparency |
| 5:00  | Architecture                                         |
| 5:50  | Elexon retrieval                                     |
| 6:50  | Forecast selection and alignment                     |
| 7:50  | Live Swagger API execution                           |
| 8:40  | Tests and deployment configuration                   |
| 9:20  | Conclusion and AI disclosure                         |

Only automation and documentation are tracked. All generated media and evidence are ignored under `demo/output/`. The remaining delivery step is a **manual Unlisted YouTube upload**. No automatic upload, push, or deployment occurred. There is no remaining video-production blocker. Future recordings depend on Elexon availability; the fixed-publication sampling limitation is disclosed in the video.
