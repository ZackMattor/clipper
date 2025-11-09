## Clip Extractor

TypeScript CLI for carving dialogue clips out of the videos stored under `src_media/`. The workflow relies on `.srt` subtitle files to locate a keyword/regex, linearly interpolates to isolate the smallest possible spoken window for each hit, then copies that window (plus a configurable buffer) with `ffmpeg`.

### Prerequisites

- Node.js 18+
- `ffmpeg` on your `PATH`

### Setup

```bash
npm install
```

### Usage

```bash
npm run extract-clips -- \
  --query "dino" \
  --media-root src_media \
  --output-root clips \
  --buffer-ms 400
```

Append `--container mp4 --accurate --videotoolbox` if you want hardware-accelerated H.264/AAC `.mp4` clips with frame-accurate trimming on Apple Silicon (M-series) hardware.

### REST API

Spin up the NestJS backend (Swagger docs live at `/docs`):

```bash
npm run start:dev
```

Then POST to `/clips` with the same options the CLI accepts:

```bash
curl -X POST http://localhost:3000/api/clips \
  -H "Content-Type: application/json" \
  -d '{
    "query": "dino",
    "mode": "accurate-transcode",
    "container": "mp4",
    "hwAccel": "videotoolbox",
    "bufferMs": 400,
    "srcMedias": [1]
  }'
```

The JSON response mirrors `metadata.yaml`, so automation can consume the API or the filesystem artifacts interchangeably. Explore live docs and try payloads via Swagger UI at `http://localhost:3000/docs`.

Need a catalog of everything that’s been generated already? Hit `GET /api/clips` to receive an aggregated index of every clip discovered under `clips/**/metadata.yaml`. The API keeps these metadata files in memory, so repeated queries stay fast even with many runs.

Need to target specific movies? Call `GET /api/media` to list every registered source (backed by the SQLite `src_media` table). Pass the desired `srcMedias` array of SrcMedia IDs to `POST /api/clips` and the server will run separate extractions for each selection.

Need the exact video path? Call `GET /api/media/{id}/url` to resolve the relative path to the primary video on demand (the server only scans a folder when you ask for its URL).

Need to inspect the subtitles first? `GET /api/media/{id}/subtitles` returns structured subtitle entries (start/end timestamps in milliseconds plus text) sourced directly from the managed subtitle entity, and automatically demuxes an English track if needed.

If a movie only has an `.mkv` file with embedded subtitles, the extractor automatically demuxes the first subtitle track (preferring English text-based streams) into a companion `*.auto.srt` before running, so you don’t have to manage external `.srt` files manually. Image-based codecs (e.g., PGS) are skipped because they can’t be converted to SRT without OCR. Each source is identified by its folder name (e.g., `Jurassic Park 1 (1993)`), and the system always prefers subtitles derived from the container and tagged as English when multiple options exist.***
```json
POST /api/clips
{
  "query": "dino",
  "bufferMs": 2000,
  "mode": "clean-transcode",
  "container": "mp4",
  "srcMedias": [1, 2]
}
```

All assets under the `clips/` directory are also served statically at `http://localhost:3000/clips/...`, so both the `vids/*.mp4` files and the `covers/*.jpg` previews referenced in metadata (and API responses) can be downloaded directly.

### Web UI

A lightweight dashboard is bundled at `http://localhost:3000/`. It offers:

- A form for kicking off new extractions (subset of the CLI/API flags).
- A sortable, filterable gallery of every clip, complete with cover thumbnails, summaries, and direct download links (powered by `GET /api/clips`).
- A per-folder source picker (selection required) mirrors the `srcMedias` option, so you can kick off runs for specific movies without constructing API calls by hand.
- Cover and video links point to the static `/clips/...` assets, so you can preview or share results without touching the filesystem.

API-triggered runs default to verbose ffmpeg logging (`ffmpegVerbose=true`, `ffmpegStats=true`) so you’ll see detailed status lines in the Nest console while jobs are running.

Key flags:

- `--query` (required): substring or regular expression to look for in the subtitles.
- `--media-root`: top-level directory that contains the movie folders (default: `src_media`).
- `--output-root`: parent directory for generated runs+metadata (default: `clips/`).
- `--buffer-ms`: milliseconds of context to keep on either side of each detected match (default: 300 ms).
- `--dry-run`: scan and print matches without invoking `ffmpeg`.
- `--limit`: stop after creating *n* clips.
- `--accurate`: re-encode each clip (`libx264`/`aac`) so the output duration matches the reported start/stop times exactly (performs a post-input seek).
- `--clean-transcode`: force re-encoding with `-ss` placed *before* `-i`, ensuring clean frames while staying much faster than copy mode.
- `--container`: choose `mkv` (default) or `mp4` for the generated files. Pair this with `--accurate` if you want re-encoded H.264/AAC `.mp4` clips.
- `--videotoolbox` / `--hw-accel videotoolbox`: use Apple’s hardware encoder/decoder (ideal on an M4 Max) when running with `--accurate`. Hardware acceleration dramatically improves encode speed while keeping the buffers tight; the fallback software encoder remains available for other setups.
- `--ffmpeg-stats`: forward `-stats` to ffmpeg so you can watch per-clip progress/status output in real time (handy for long `--accurate` runs).
- `--ffmpeg-verbose`: raise ffmpeg’s log level to `info` so you can tail detailed progress output in the API/CLI console.

Each invocation creates a timestamped subdirectory inside `clips/` (for example `clips/dino_2024-05-04T17-33-02-123Z/`). Inside that run directory you’ll find a `vids/` folder containing all of the extracted clips (the filenames still encode the source movie) **and** a `metadata.yaml` file that captures how those clips were produced.

While running, the CLI emits benchmarking info: every clip log now includes the time `ffmpeg` spent on that item, and the end-of-run summary prints the total wall-clock time plus the average processing time per clip. Use those numbers to understand how much the `--accurate` mode costs versus the default fast stream copy.

### Metadata schema

`metadata.yaml` follows a minimal schema (`clip_run.v1`) so downstream tools can audit or replay a run:

```yaml
schema: clip_run.v1
query: "dino"
buffer_ms: 400
generated_at: 2024-05-04T17:33:02.123Z
ffmpeg_path: ffmpeg
mode: accurate-transcode
container: mp4
hw_accel: videotoolbox
run_directory: dino_2024-05-04T17-33-02-123Z
total_clips: 12
clips:
  - file: "vids/jurassic_park_1_1993_1_000434_740.mp4"
    video: "Jurassic Park 1 (1993)/Jurassic Park (1993) Bluray-1080p Proper.mkv"
    subtitle: "Jurassic Park 1 (1993)/Jurassic Park (1993) Bluray-1080p Proper_Subtitles01.ENG.srt"
    start: 434.74
    end: 435.79
    processing_ms: 842
    cover_image: "covers/jurassic_park_1_1993_1_000434_740.jpg"
    summary: "Dr. Grant reassures Lex as they hide from a nearby dinosaur, whispering about staying quiet."
    summary_context:
      - "[00:07:10] Lex: He left us!"
      - "[00:07:12] Dr. Grant: But that's not what I'm gonna do."
```

Use the metadata to trace which query, buffer, mode, container, hardware acceleration, cover image, summary, and source assets produced each clip—or as an input to additional tooling (e.g., concatenating runs). Re-run the CLI with different queries to build other themed compilations (for example, every Jurassic Park line that mentions “dino”).

> ℹ️ Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`) in the environment to generate the clip summaries. If the key is absent the pipeline simply skips that step.

### Environment variables

Copy `.env.example` to `.env` and adjust as needed. Supported vars:

- `MEDIA_ROOT`: overrides the default `src_media` input directory.
- `SQLITE_PATH`: optional override for the SQLite database file (defaults to `subreaderdelux.sqlite` inside the repo).
- `OPENAI_API_KEY`: enables auto-summarization of clips.
- `OPENAI_MODEL`: optional model override (defaults to `gpt-4o-mini`).
