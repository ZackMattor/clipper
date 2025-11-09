#!/usr/bin/env node

import 'dotenv/config';
import { extractClips, ClipExtractionOptions, ContainerFormat, HardwareAccel } from '../lib/clipExtractor';

function printUsage(): void {
  console.log(`Usage: ts-node src/cli/extractClips.ts --query "<pattern>" [options]

Options:
  --media-root <path>     Directory that contains movie folders (default: src_media)
  --output-root <path>    Directory to store generated clips+metadata (default: clips)
  --query <pattern>       Substring or regex to look for inside subtitles (required)
  --case-sensitive        Treat the query as case-sensitive (default: false)
  --buffer-ms <number>    Milliseconds of context to include on either side (default: 300)
  --limit <number>        Stop after generating N clips
  --dry-run               Discover matches without invoking ffmpeg
  --ffmpeg-path <path>    Path to ffmpeg binary (default: ffmpeg)
  --ffmpeg-stats          Show ffmpeg progress/statistics output (adds -stats)
  --container <format>    Output container (mkv or mp4, default: mkv)
  --hw-accel <name>       Enable hardware acceleration (currently supported: videotoolbox)
  --videotoolbox          Shortcut for --hw-accel videotoolbox
  --accurate              Re-encode with post-seek trimming (frame-accurate)
  --clean-transcode       Force re-encode with pre-seek (-ss before -i) for clean frames
  --help                  Show this help text
`);
}

function parseArgs(argv: string[]): ClipExtractionOptions {
  const options: ClipExtractionOptions = {
    mediaRoot: 'src_media',
    outputRoot: 'clips',
    query: '',
    caseSensitive: false,
    bufferMs: 300,
    limit: undefined,
    dryRun: false,
    ffmpegPath: 'ffmpeg',
    ffmpegStats: false,
    mode: 'fast-copy',
    container: 'mkv'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--media-root':
        options.mediaRoot = requireValue(argv[++i], '--media-root');
        break;
      case '--output-root':
        options.outputRoot = requireValue(argv[++i], '--output-root');
        break;
      case '--query':
        options.query = requireValue(argv[++i], '--query');
        break;
      case '--case-sensitive':
        options.caseSensitive = true;
        break;
      case '--buffer-ms':
        options.bufferMs = parseInteger(requireValue(argv[++i], '--buffer-ms'), '--buffer-ms');
        break;
      case '--limit':
        options.limit = parseInteger(requireValue(argv[++i], '--limit'), '--limit');
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--ffmpeg-path':
        options.ffmpegPath = requireValue(argv[++i], '--ffmpeg-path');
        break;
      case '--ffmpeg-stats':
        options.ffmpegStats = true;
        break;
      case '--container':
        options.container = parseContainer(requireValue(argv[++i], '--container'));
        break;
      case '--hw-accel':
        options.hwAccel = parseHwAccel(requireValue(argv[++i], '--hw-accel'));
        break;
      case '--videotoolbox':
        options.hwAccel = 'videotoolbox';
        break;
      case '--accurate':
        options.mode = 'accurate-transcode';
        break;
      case '--clean-transcode':
        options.mode = 'clean-transcode';
        break;
      case '--help':
        printUsage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        break;
    }
  }

  if (!options.query) {
    printUsage();
    throw new Error('Missing required option: --query');
  }

  return options;
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`Option ${flag} expects a value`);
  }
  return value;
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Option ${flag} expects a number`);
  }
  return parsed;
}

function parseContainer(value: string, flag = '--container'): ContainerFormat {
  const normalized = value.toLowerCase();
  if (normalized === 'mkv' || normalized === 'mp4') {
    return normalized;
  }
  throw new Error(`Option ${flag} must be one of: mkv, mp4`);
}

function parseHwAccel(value: string, flag = '--hw-accel'): HardwareAccel {
  const normalized = value.toLowerCase();
  if (normalized === 'videotoolbox') {
    return 'videotoolbox';
  }
  throw new Error(`Option ${flag} must be one of: videotoolbox`);
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    await extractClips(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

main();
