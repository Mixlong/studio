#!/usr/bin/env python3
"""Convert WAV or MP3 input to a raw interleaved PCM stream with ffmpeg."""

import argparse
import shutil
import subprocess
import sys


PCM_FORMATS = {
    "s8": ("s8", "pcm_s8"),
    "u8": ("u8", "pcm_u8"),
    "s16": ("s16le", "pcm_s16le"),
    "u16": ("u16le", "pcm_u16le"),
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--format", choices=PCM_FORMATS, required=True)
    parser.add_argument("--sample-rate", type=int, required=True)
    parser.add_argument("--channels", type=int, required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args = parser.parse_args()

    if args.sample_rate <= 0 or args.channels <= 0:
        parser.error("sample rate and channels must be positive")

    ffmpeg = shutil.which(args.ffmpeg)
    if not ffmpeg:
        print("ffmpeg was not found. Install it or pass --ffmpeg PATH.", file=sys.stderr)
        return 2

    container_format, codec = PCM_FORMATS[args.format]
    command = [
        ffmpeg,
        "-y",
        "-i",
        args.input,
        "-vn",
        "-ac",
        str(args.channels),
        "-ar",
        str(args.sample_rate),
        "-f",
        container_format,
        "-acodec",
        codec,
        args.output,
    ]
    completed = subprocess.run(command, check=False)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())

