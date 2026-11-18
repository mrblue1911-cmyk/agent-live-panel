"""Render docs/demo.html frame by frame and encode docs/demo.gif.

Deterministic: the page computes its state from a millisecond value, so every
frame is a pure function of time. No screen recording, no wall-clock timing.

    python docs/capture_gif.py            # 9s, 10 fps -> docs/demo.gif

Requires: playwright (chromium installed) + ffmpeg on PATH.
"""

import shutil
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PAGE = (HERE / "demo.html").as_uri()
FRAMES = HERE / "_frames"
GIF = HERE / "demo.gif"

STEP_MS = 100          # 10 fps
DURATION_MS = 9000     # 9 s loop
SCALE = 2              # device pixel ratio: 11px mono needs 2x to survive a GIF


def main() -> int:
    if not shutil.which("ffmpeg"):
        print("ffmpeg not on PATH", file=sys.stderr)
        return 1

    if FRAMES.exists():
        shutil.rmtree(FRAMES)
    FRAMES.mkdir()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(device_scale_factor=SCALE)
        page.goto(PAGE)
        page.wait_for_timeout(300)
        pane = page.locator("#pane")
        n = DURATION_MS // STEP_MS
        for i in range(n):
            page.evaluate("(ms) => window.renderAt(ms)", i * STEP_MS)
            pane.screenshot(path=str(FRAMES / f"f{i:04d}.png"))
        browser.close()

    print(f"{n} frames -> {GIF}")

    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-framerate", str(1000 // STEP_MS),
            "-i", str(FRAMES / "f%04d.png"),
            "-vf",
            "split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];"
            "[b][p]paletteuse=dither=bayer:bayer_scale=4",
            "-loop", "0",
            str(GIF),
        ],
        check=True,
    )

    print(f"{GIF.stat().st_size / 1e6:.2f} MB")
    shutil.rmtree(FRAMES)
    return 0


if __name__ == "__main__":
    sys.exit(main())
