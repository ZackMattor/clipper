# Repository Guidelines

## Project Structure & Module Organization
TypeScript sources live under `src/`. `main.ts` boots the NestJS API, `app.module.ts` wires feature modules, and `src/extraction/**` owns the REST contract plus metadata indexing. CLI entry points sit in `src/cli/extractClips.ts`, sharing helpers from `src/lib`. The static dashboard is prebuilt inside `src/frontend` and served by the API. Raw movies and subtitles belong under `src_media/`, while generated artifacts land in timestamped folders within `clips/` (mirrored over HTTP). Auxiliary ffmpeg helpers live in `scripts/`.

## Build, Test, and Development Commands
Run `npm install` once per environment. `npm run build` transpiles TypeScript to `dist/` via `tsc`. `npm run start` executes the compiled Nest server, whereas `npm run start:dev` uses `ts-node` for quicker edit/run cycles and exposes Swagger at `http://localhost:3000/docs`. Use `npm run extract-clips -- --query "term" --media-root src_media --output-root clips` to invoke the CLI directly; append `--dry-run` for quick scans or `--accurate --container mp4` for re-encoded outputs.

## Coding Style & Naming Conventions
Use TypeScript with 2-space indentation and `strict`-friendly typing (see `tsconfig.json`). Follow NestJS layering: controllers stay thin, services own IO, and DTOs live under `src/extraction/dto`. Prefer PascalCase classes (`ClipExtractionService`), camelCase variables/functions, and kebab-case CLI flags/run directories. Keep modules small and colocate shared logic in `src/lib`. Submit formatted code (`tsc --noEmit` should stay clean); linting is manual, so match the existing import/order style.

## Testing Guidelines
There is no automated test suite yet; rely on targeted CLI runs plus API smoke tests. Exercise new parsing logic with `npm run extract-clips -- --dry-run --limit 1` before burning cycles on full encodes, then validate metadata by curling `GET /api/clips`. When touching the API surface, hit `POST /api/clips` with representative payloads and watch the Nest console for validation output. Document any reproducible scenario in the PR description until formal tests exist.

## Commit & Pull Request Guidelines
The workspace lacks Git history here, so default to Conventional Commits (`feat: add videobox accel option`) and keep scope-specific bodies. Each PR should describe the problem, solution, and manual verification (commands, sample payloads, screenshots of the dashboard if UI changes). Link tracking issues when available and confirm media paths or CLI invocations used during testing so reviewers can replay your steps.
