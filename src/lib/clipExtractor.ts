import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { performance } from 'node:perf_hooks';

const SUPPORTED_VIDEO_EXTS = new Set(['.mkv', '.mp4', '.mov', '.m4v']);
export type ClipMode = 'fast-copy' | 'accurate-transcode' | 'clean-transcode';
export type ContainerFormat = 'mkv' | 'mp4';
export type HardwareAccel = 'videotoolbox';

export interface ClipExtractionOptions {
  mediaRoot?: string;
  outputRoot?: string;
  query: string;
  caseSensitive?: boolean;
  bufferMs?: number;
  limit?: number;
  dryRun?: boolean;
  ffmpegPath?: string;
  ffmpegStats?: boolean;
  ffmpegVerbose?: boolean;
  mode?: ClipMode;
  container?: ContainerFormat;
  hwAccel?: HardwareAccel;
  subtitleFiles?: string[];
  subtitleVideoMap?: Record<string, string>;
}

interface SubtitleBlock {
  start: number;
  end: number;
  text: string;
  path: string;
}

interface ClipCandidate {
  start: number;
  end: number;
  contextSnippets: string[];
}

type ClipMatch = Omit<ClipCandidate, 'contextSnippets'>;

export interface ClipMetadataEntry {
  file: string;
  video: string;
  subtitle: string;
  start: number;
  end: number;
  processing_ms: number;
  cover_image?: string;
  summary?: string;
  summary_context?: string[];
}

export interface ClipRunMetadata {
  schema: 'clip_run.v1';
  query: string;
  buffer_ms: number;
  generated_at: string;
  ffmpeg_path: string;
  mode: ClipMode;
  container: ContainerFormat;
  hw_accel?: HardwareAccel;
  total_clips: number;
  run_directory: string;
  clips: ClipMetadataEntry[];
}

export class ClipExtractor {
  private readonly mediaRoot: string;
  private readonly outputRoot: string;
  private readonly runRoot: string;
  private readonly vidsRoot: string;
  private readonly coversRoot: string;
  private readonly queryRegex: RegExp;
  private readonly bufferSeconds: number;
  private readonly limit?: number;
  private readonly dryRun: boolean;
  private readonly ffmpegPath: string;
  private readonly ffmpegStats: boolean;
  private readonly metadataEntries: ClipMetadataEntry[] = [];
  private readonly movieClipCounts = new Map<string, number>();
  private readonly mode: ClipMode;
  private readonly container: ContainerFormat;
  private readonly hwAccel?: HardwareAccel;
  private totalClipProcessingMs = 0;
  private readonly subtitleVideoMap: Map<string, string>;

  constructor(private readonly options: RequiredClipOptions) {
    this.mediaRoot = path.resolve(options.mediaRoot);
    this.outputRoot = path.resolve(options.outputRoot);
    this.queryRegex = buildRegex(options.query, options.caseSensitive);
    this.bufferSeconds = options.bufferMs / 1000.0;
    this.limit = options.limit;
    this.dryRun = options.dryRun;
    this.ffmpegPath = options.ffmpegPath;
    this.ffmpegStats = options.ffmpegStats;
    this.mode = options.mode;
    this.container = options.container;
    this.hwAccel = options.hwAccel;
    this.subtitleVideoMap = options.subtitleVideoMap;

    const runSlug = buildRunSlug(options.query);
    this.runRoot = path.join(this.outputRoot, runSlug);
    this.vidsRoot = path.join(this.runRoot, 'vids');
    this.coversRoot = path.join(this.runRoot, 'covers');
  }

  async run(): Promise<ClipRunMetadata> {
    await ensureFfmpegAvailable(this.ffmpegPath);
    const jobStart = performance.now();
    await fs.mkdir(this.runRoot, { recursive: true });
    await fs.mkdir(this.vidsRoot, { recursive: true });
    await fs.mkdir(this.coversRoot, { recursive: true });

    const subtitleFiles = await this.collectSubtitleFiles();
    if (subtitleFiles.length === 0) {
      throw new Error(`No .srt files found under ${this.mediaRoot}`);
    }

    let processed = 0;

    for (const subtitlePath of subtitleFiles) {
      if (this.limit && processed >= this.limit) {
        break;
      }

      const hits = await this.findHits(subtitlePath);
      if (!hits.length) {
        continue;
      }

      const videoPath = await this.locateVideo(subtitlePath);
      if (!videoPath) {
        console.warn(`Skipping ${subtitlePath}: could not locate sibling video file`);
        continue;
      }

      const relativeMovieDir = path.dirname(path.relative(this.mediaRoot, subtitlePath));

      for (const hit of hits) {
        if (this.limit && processed >= this.limit) {
          break;
        }
        await this.processHit({
          hit,
          videoPath,
          subtitlePath,
          movieOutputDir: this.vidsRoot,
          relativeMovieDir
        });
        processed += 1;
      }
    }

    const metadata = this.buildMetadata();
    await this.writeMetadata(metadata);
    const jobDuration = performance.now() - jobStart;
    const averageClipMs =
      !this.dryRun && this.metadataEntries.length
        ? this.totalClipProcessingMs / this.metadataEntries.length
        : 0;

    console.log(
      `Done. Created ${processed} clip(s) in ${formatDuration(jobDuration)}. Metadata saved to ${path.join(
        this.runRoot,
        'metadata.yaml'
      )}`
    );
    if (averageClipMs) {
      console.log(`Average ffmpeg time per clip: ${formatDuration(averageClipMs)}`);
    }
    return metadata;
  }

  private async processHit({
    hit,
    videoPath,
    subtitlePath,
    movieOutputDir,
    relativeMovieDir
  }: {
    hit: ClipCandidate;
    videoPath: string;
    subtitlePath: string;
    movieOutputDir: string;
    relativeMovieDir: string;
  }): Promise<void> {
    const startTime = Math.max(hit.start - this.bufferSeconds, 0);
    const endTime = hit.end + this.bufferSeconds;
    const duration = endTime - startTime;
    if (duration <= 0) {
      return;
    }

    const nextIndex = (this.movieClipCounts.get(relativeMovieDir) ?? 0) + 1;
    this.movieClipCounts.set(relativeMovieDir, nextIndex);

    const outputName = buildOutputName(relativeMovieDir, nextIndex, startTime, this.container);
    const outputPath = path.join(movieOutputDir, outputName);
    const coverName = buildCoverName(relativeMovieDir, nextIndex, hit.start);
    const coverPath = path.join(this.coversRoot, coverName);

    console.log(
      `Creating ${outputPath} (start=${startTime.toFixed(2)} duration=${duration.toFixed(2)})`
    );

    let processingMs = 0;
    let coverImageRelative: string | undefined;
    let summary: string | undefined;
    let summaryContext: string[] | undefined;

    if (!this.dryRun) {
      const clipStart = performance.now();
      await runFfmpeg({
        ffmpegPath: this.ffmpegPath,
        videoPath,
        startTime,
        duration,
        outputPath,
        mode: this.mode,
        container: this.container,
        hwAccel: this.hwAccel,
        ffmpegStats: this.ffmpegStats,
        verbose: this.options.ffmpegVerbose
      });
      processingMs = performance.now() - clipStart;
      this.totalClipProcessingMs += processingMs;
      console.log(`→ Completed in ${formatDuration(processingMs)}`);

      try {
        await captureCoverFrame({
          ffmpegPath: this.ffmpegPath,
          videoPath,
          seekTime: hit.start,
          outputPath: coverPath
        });
        coverImageRelative = path.relative(this.runRoot, coverPath);
      } catch (error) {
        console.warn(
          `Failed to capture cover for ${outputPath}: ${(error as Error).message}`
        );
      }

      try {
        summaryContext = hit.contextSnippets;
        summary = await maybeSummarizeClip({
          movieTitle: path.basename(videoPath),
          contextSnippets: summaryContext
        });
      } catch (error) {
        console.warn(`Failed to summarize ${outputPath}: ${(error as Error).message}`);
      }
    } else {
      console.log('→ Dry run; ffmpeg skipped');
    }

    this.metadataEntries.push({
      file: path.relative(this.runRoot, outputPath),
      video: path.relative(this.mediaRoot, videoPath),
      subtitle: path.relative(this.mediaRoot, subtitlePath),
      start: roundNumber(startTime),
      end: roundNumber(endTime),
      processing_ms: Math.round(processingMs),
      cover_image: coverImageRelative,
      summary,
      summary_context: summaryContext
    });
  }

  private buildMetadata(): ClipRunMetadata {
    return {
      schema: 'clip_run.v1',
      query: this.options.query,
      buffer_ms: this.options.bufferMs,
      generated_at: new Date().toISOString(),
      ffmpeg_path: this.ffmpegPath,
      mode: this.mode,
      container: this.container,
      hw_accel: this.hwAccel,
      total_clips: this.metadataEntries.length,
      run_directory: path.relative(this.outputRoot, this.runRoot) || '.',
      clips: this.metadataEntries
    };
  }

  private async writeMetadata(metadata: ClipRunMetadata): Promise<void> {
    const metadataPath = path.join(this.runRoot, 'metadata.yaml');
    await fs.writeFile(metadataPath, serializeMetadata(metadata), 'utf8');
  }

  private async collectSubtitleFiles(): Promise<string[]> {
    if (this.options.subtitleFiles?.length) {
      const selected: string[] = [];
      for (const rel of this.options.subtitleFiles) {
        const resolved = await this.resolveSubtitleSelection(rel);
        if (resolved) {
          selected.push(resolved);
        }
      }
      return selected;
    }
    const existing = await findSubtitleFiles(this.mediaRoot);
    const extracted = await this.extractSubtitlesFromVideos(existing);
    return [...existing, ...extracted];
  }

  private async resolveSubtitleSelection(relativePath: string): Promise<string | null> {
    const abs = path.resolve(this.mediaRoot, relativePath);
    if (await exists(abs)) {
      return abs;
    }
    const ext = path.extname(relativePath).toLowerCase();
    if (SUPPORTED_VIDEO_EXTS.has(ext)) {
      const extracted = await extractSubtitleTrack({
        ffmpegPath: this.ffmpegPath,
        videoPath: abs
      });
      return extracted;
    }
    const base = path.join(path.dirname(abs), path.basename(abs, path.extname(abs)));
    for (const videoExt of SUPPORTED_VIDEO_EXTS) {
      const candidate = `${base}${videoExt}`;
      if (await exists(candidate)) {
        const extracted = await extractSubtitleTrack({
          ffmpegPath: this.ffmpegPath,
          videoPath: candidate
        });
        if (extracted) {
          return extracted;
        }
      }
    }
    console.warn(`Requested subtitle not found and no matching video: ${relativePath}`);
    return null;
  }

  private async extractSubtitlesFromVideos(existingSubs: string[]): Promise<string[]> {
    const existingSet = new Set(existingSubs.map((file) => path.resolve(file)));
    const videos = await findVideoFiles(this.mediaRoot);
    const extracted: string[] = [];
    for (const videoPath of videos) {
      const result = await extractSubtitleTrack({
        ffmpegPath: this.ffmpegPath,
        videoPath
      });
      if (result) {
        existingSet.add(result);
        extracted.push(result);
      }
    }
    return extracted;
  }

  private async findHits(subtitlePath: string): Promise<ClipCandidate[]> {
    const blocks = await parseSrt(subtitlePath);
    const matches: ClipCandidate[] = [];

    blocks.forEach((block, index) => {
      const blockMatches = hitsForBlock(block, this.queryRegex);
      if (!blockMatches.length) {
        return;
      }
      const contextSnippets = collectContextSnippets(blocks, index, 5);
      blockMatches.forEach((hit) =>
        matches.push({
          ...hit,
          contextSnippets
        })
      );
    });

    return matches;
  }

  private async locateVideo(subtitlePath: string): Promise<string | null> {
    const mapped = this.subtitleVideoMap.get(path.resolve(subtitlePath));
    if (mapped) {
      return mapped;
    }
    const directory = path.dirname(subtitlePath);
    const subtitleBase = path.basename(subtitlePath, path.extname(subtitlePath));

    for (const ext of SUPPORTED_VIDEO_EXTS) {
      const candidate = path.join(directory, `${subtitleBase}${ext}`);
      if (await exists(candidate)) {
        return candidate;
      }
    }

    const entries = await fs.readdir(directory);
    for (const entry of entries) {
      const candidate = path.join(directory, entry);
      if (SUPPORTED_VIDEO_EXTS.has(path.extname(candidate).toLowerCase())) {
        return candidate;
      }
    }

    return null;
  }
}

async function parseSrt(filePath: string): Promise<SubtitleBlock[]> {
  const contents = await fs.readFile(filePath, 'utf8');
  const chunks = contents.split(/\r?\n\r?\n/);
  const blocks: SubtitleBlock[] = [];

  chunks.forEach((chunk) => {
    const lines = chunk.trim().split(/\r?\n/);
    if (lines.length < 2) {
      return;
    }

    const timing = lines[1];
    const [startRaw, endRaw] = timing.split(' --> ');
    if (!startRaw || !endRaw) {
      return;
    }

    const text = lines.slice(2).join(' ').trim();
    if (!text) {
      return;
    }

    try {
      const start = parseTimestamp(startRaw);
      const end = parseTimestamp(endRaw);
      blocks.push({ start, end, text, path: filePath });
    } catch {
      // Ignore malformed timestamps.
    }
  });

  return blocks;
}

function hitsForBlock(block: SubtitleBlock, queryRegex: RegExp): ClipMatch[] {
  const duration = block.end - block.start;
  const textLength = block.text.length;
  if (duration <= 0 || textLength === 0) {
    return [];
  }

  const matches: ClipMatch[] = [];
  const regex = cloneRegex(queryRegex);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(block.text)) !== null) {
    const matchLength = match[0].length || 1;
    const startRatio = match.index / textLength;
    const endRatio = (match.index + matchLength) / textLength;
    const hitStart = block.start + duration * startRatio;
    const hitEnd = block.start + duration * endRatio;
    matches.push({ start: hitStart, end: hitEnd });

    if (matchLength === 0) {
      regex.lastIndex += 1;
    }
  }

  return matches;
}

function collectContextSnippets(
  blocks: SubtitleBlock[],
  centerIndex: number,
  radius: number
): string[] {
  const snippets: string[] = [];
  const startIndex = Math.max(0, centerIndex - radius);
  const endIndex = Math.min(blocks.length - 1, centerIndex + radius);
  for (let i = startIndex; i <= endIndex; i += 1) {
    const snippet = blocks[i];
    const timestamp = `[${formatHumanTime(snippet.start)}] `;
    snippets.push(`${timestamp}${snippet.text}`);
  }
  return snippets;
}

function formatHumanTime(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':');
}

function buildRegex(pattern: string, caseSensitive: boolean): RegExp {
  const flags = caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`Invalid query regex: ${(error as Error).message}`);
  }
}

function buildRunSlug(query: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const querySlug = slugify(query);
  return `${querySlug || 'query'}_${timestamp}`;
}

function buildOutputName(
  relativeMovieDir: string,
  index: number,
  startTime: number,
  container: ContainerFormat
): string {
  const slug = slugify(relativeMovieDir);
  const startTag = formatStartTag(startTime);
  return `${slug}_${index}_${startTag}.${container}`;
}

function buildCoverName(relativeMovieDir: string, index: number, matchTime: number): string {
  const slug = slugify(relativeMovieDir);
  const startTag = formatStartTag(matchTime);
  return `${slug}_${index}_${startTag}.jpg`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
}

function formatStartTag(seconds: number): string {
  return seconds.toFixed(3).padStart(10, '0').replace('.', '_');
}

function parseTimestamp(input: string): number {
  const match = input.match(/(\d+):(\d+):(\d+),(\d+)/);
  if (!match) {
    throw new Error(`Invalid timestamp: ${input}`);
  }

  const [, hours, minutes, seconds, millis] = match.map(Number);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function formatFfmpegTime(seconds: number): string {
  const totalMs = Math.max(Math.round(seconds * 1000), 0);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${ms.toString().padStart(3, '0')}`;
}

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${ms.toFixed(0)}ms`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

async function findSubtitleFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && fullPath.toLowerCase().endsWith('.srt')) {
        results.push(fullPath);
      }
    }
  }

  await walk(root);
  results.sort();
  return results;
}

async function findVideoFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && SUPPORTED_VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  };
  await walk(root);
  return results;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureFfmpegAvailable(ffmpegPath: string): Promise<void> {
  try {
    await spawnWithProgress(ffmpegPath, ['-version'], false);
  } catch {
    throw new Error('ffmpeg not found. Install ffmpeg or pass --ffmpeg-path.');
  }
}

async function runFfmpeg({
  ffmpegPath,
  videoPath,
  startTime,
  duration,
  outputPath,
  mode,
  container,
  hwAccel,
  ffmpegStats,
  verbose
}: {
  ffmpegPath: string;
  videoPath: string;
  startTime: number;
  duration: number;
  outputPath: string;
  mode: ClipMode;
  container: ContainerFormat;
  hwAccel?: HardwareAccel;
  ffmpegStats: boolean;
  verbose: boolean;
}): Promise<void> {
  const logLevel = verbose ? 'info' : 'error';
  const baseArgs = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    logLevel,
    '-y',
    ...(ffmpegStats ? ['-stats'] : [])
  ];
  const durationArg = ['-t', formatFfmpegTime(duration)];
  const containerArgs = container === 'mp4' ? ['-movflags', '+faststart'] : [];
  const hwDecodeArgs = hwAccel ? ['-hwaccel', hwAccel] : [];

  const ffmpegArgs =
    mode === 'fast-copy'
      ? [
          ...baseArgs,
          ...hwDecodeArgs,
          '-ss',
          formatFfmpegTime(startTime),
          '-i',
          videoPath,
          ...durationArg,
          '-c',
          'copy',
          ...containerArgs,
          outputPath
        ]
      : mode === 'accurate-transcode'
      ? [
          ...baseArgs,
          ...hwDecodeArgs,
          '-i',
          videoPath,
          '-ss',
          formatFfmpegTime(startTime),
          ...durationArg,
          ...buildVideoCodecArgs(hwAccel),
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          ...containerArgs,
          outputPath
        ]
      : [
          ...baseArgs,
          '-ss',
          formatFfmpegTime(startTime),
          '-i',
          videoPath,
          ...durationArg,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          ...containerArgs,
          outputPath
        ];

  await spawnWithProgress(ffmpegPath, ffmpegArgs, verbose || ffmpegStats);
}

async function spawnWithProgress(cmd: string, args: string[], pipeOutput: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stdio: ('ignore' | 'pipe')[] = [
      'ignore',
      pipeOutput ? 'pipe' : 'ignore',
      pipeOutput ? 'pipe' : 'ignore'
    ];
    const child = spawn(cmd, args, { stdio });
    child.stdout?.on('data', (chunk) => {
      if (pipeOutput) process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      if (pipeOutput) process.stdout.write(chunk);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}`));
      }
    });
  });
}

async function maybeSummarizeClip({
  movieTitle,
  contextSnippets
}: {
  movieTitle: string;
  contextSnippets: string[];
}): Promise<string | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || contextSnippets.length === 0) {
    return undefined;
  }

  const prompt = [
    `Movie: ${movieTitle}`,
    'Subtitle context (nearest lines around the quote):',
    contextSnippets.map((line) => `- ${line}`).join('\n'),
    '',
    'Write a concise, spoiler-free 1-2 sentence summary of what happens in this clip.'
  ].join('\n');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content:
              'You summarize short movie clips for editors. Keep summaries vivid but under two sentences.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API responded with status ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const summary = data.choices?.[0]?.message?.content?.trim();
    return summary || undefined;
  } catch (error) {
    console.warn(`OpenAI summary request failed: ${(error as Error).message}`);
    return undefined;
  }
}

export async function extractSubtitleTrack({
  ffmpegPath,
  videoPath
}: {
  ffmpegPath: string;
  videoPath: string;
}): Promise<string | null> {
  const outputRoot = path.join(os.tmpdir(), 'subreaderdelux-subtitles');
  await fs.mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(
    outputRoot,
    `${path.basename(path.dirname(videoPath))}.${Date.now()}.auto.srt`
  );
  const selection = await findSubtitleStreamIndex(ffmpegPath, videoPath);
  if (!selection) {
    console.warn(`[SubtitleExtract] No subtitle streams found in ${videoPath}`);
    return null;
  }
  if (selection.codec && !['subrip', 'text', 'ass', 'ssa', 'webvtt', 'mov_text'].includes(selection.codec)) {
    console.warn(
      `[SubtitleExtract] Subtitle codec ${selection.codec} is not text-based for ${videoPath}; skipping extraction.`
    );
    return null;
  }
  console.log(`[SubtitleExtract] Extracting subtitles for ${videoPath} -> ${outputPath}`);
  await spawnWithProgress(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      videoPath,
      '-map',
      `0:${selection.index}`,
      '-c:s',
      'srt',
      outputPath
    ],
    false
  );
  console.log(`[SubCache] Cached subtitles at ${outputPath}`);
  return outputPath;
}

async function findSubtitleStreamIndex(
  ffmpegPath: string,
  videoPath: string
): Promise<{ index: number; codec?: string } | null> {
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  try {
    const ffprobeArgs = [
      '-v',
      'error',
      '-select_streams',
      's',
      '-show_entries',
      'stream=index,codec_name:stream_tags=language',
      '-of',
      'json',
      videoPath
    ];
    console.log(`[SubCache] Running ffprobe: ${ffprobePath} ${ffprobeArgs.join(' ')}`);
    const { stdout } = await execFileAsync(ffprobePath, ffprobeArgs);
    const data = JSON.parse(stdout) as {
      streams?: Array<{ index: number; codec_name?: string; tags?: { language?: string } }>;
    };
    if (!data.streams?.length) {
      console.warn(`[SubCache] ffprobe found no subtitle streams in ${videoPath}`);
    } else {
      console.log(
        `[SubCache] Subtitle streams for ${videoPath}: ${JSON.stringify(
          data.streams.map((s) => ({
            index: s.index,
            codec: s.codec_name,
            language: s.tags?.language
          }))
        )}`
      );
    }
    const english = data.streams?.find((stream) =>
      stream.tags?.language?.toLowerCase().startsWith('en')
    );
    if (english) {
      return { index: english.index, codec: english.codec_name };
    }
    const preferSubrip =
      data.streams?.find((stream) => stream.codec_name === 'subrip') ?? data.streams?.[0];
    return preferSubrip ? { index: preferSubrip.index, codec: preferSubrip.codec_name } : null;
  } catch {
    return null;
  }
}

function execFileAsync(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
      }
    });
  });
}

async function captureCoverFrame({
  ffmpegPath,
  videoPath,
  seekTime,
  outputPath
}: {
  ffmpegPath: string;
  videoPath: string;
  seekTime: number;
  outputPath: string;
}): Promise<void> {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    formatFfmpegTime(Math.max(seekTime, 0)),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    outputPath
  ];

  await spawnWithProgress(ffmpegPath, args, false);
}

function buildVideoCodecArgs(hwAccel?: HardwareAccel): string[] {
  if (hwAccel === 'videotoolbox') {
    return ['-c:v', 'h264_videotoolbox'];
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18'];
}

function cloneRegex(regex: RegExp): RegExp {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  return new RegExp(regex.source, flags);
}

function roundNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function serializeMetadata(metadata: ClipRunMetadata): string {
  const lines: string[] = [];
  lines.push(`schema: ${metadata.schema}`);
  lines.push(`query: ${yamlString(metadata.query)}`);
  lines.push(`buffer_ms: ${metadata.buffer_ms}`);
  lines.push(`generated_at: ${yamlString(metadata.generated_at)}`);
  lines.push(`ffmpeg_path: ${yamlString(metadata.ffmpeg_path)}`);
  lines.push(`mode: ${metadata.mode}`);
  lines.push(`container: ${metadata.container}`);
  if (metadata.hw_accel) {
    lines.push(`hw_accel: ${metadata.hw_accel}`);
  }
  lines.push(`run_directory: ${yamlString(metadata.run_directory)}`);
  lines.push(`total_clips: ${metadata.total_clips}`);
  lines.push('clips:');
  metadata.clips.forEach((clip) => {
    lines.push('  - file: ' + yamlString(clip.file));
    lines.push('    video: ' + yamlString(clip.video));
    lines.push('    subtitle: ' + yamlString(clip.subtitle));
    lines.push('    start: ' + clip.start);
    lines.push('    end: ' + clip.end);
    lines.push('    processing_ms: ' + clip.processing_ms);
    if (clip.cover_image) {
      lines.push('    cover_image: ' + yamlString(clip.cover_image));
    }
    if (clip.summary) {
      lines.push('    summary: ' + yamlString(clip.summary));
    }
    if (clip.summary_context?.length) {
      lines.push('    summary_context:');
      clip.summary_context.forEach((line) => {
        lines.push('      - ' + yamlString(line));
      });
    }
  });
  return lines.join('\n') + '\n';
}

function yamlString(value: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

type RequiredClipOptions = {
  mediaRoot: string;
  outputRoot: string;
  query: string;
  caseSensitive: boolean;
  bufferMs: number;
  limit?: number;
  dryRun: boolean;
  ffmpegPath: string;
  ffmpegStats: boolean;
  ffmpegVerbose: boolean;
  mode: ClipMode;
  container: ContainerFormat;
  hwAccel?: HardwareAccel;
  subtitleFiles?: string[];
  subtitleVideoMap: Map<string, string>;
};

export function normalizeOptions(options: ClipExtractionOptions): RequiredClipOptions {
  if (!options.query) {
    throw new Error('Missing required option: query');
  }

  return {
    mediaRoot: options.mediaRoot ?? process.env.MEDIA_ROOT ?? 'src_media',
    outputRoot: options.outputRoot ?? 'clips',
    query: options.query,
    caseSensitive: options.caseSensitive ?? false,
    bufferMs: options.bufferMs ?? 300,
    limit: options.limit,
    dryRun: options.dryRun ?? false,
    ffmpegPath: options.ffmpegPath ?? 'ffmpeg',
    ffmpegStats: options.ffmpegStats ?? false,
    ffmpegVerbose: options.ffmpegVerbose ?? false,
    mode: options.mode ?? 'fast-copy',
    container: options.container ?? 'mkv',
    hwAccel: options.hwAccel,
    subtitleFiles: options.subtitleFiles,
    subtitleVideoMap: new Map(
      Object.entries(options.subtitleVideoMap ?? {}).map(([subtitle, video]) => [
        path.resolve(subtitle),
        path.resolve(video)
      ])
    )
  };
}

export async function extractClips(options: ClipExtractionOptions): Promise<ClipRunMetadata> {
  const normalized = normalizeOptions(options);
  const extractor = new ClipExtractor(normalized);
  return extractor.run();
}
