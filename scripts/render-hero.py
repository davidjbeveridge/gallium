"""Render the Gallium mark's deterministic solid-to-liquid hero loop."""
from concurrent.futures import ThreadPoolExecutor
from math import cos, pi, sin
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

root = Path(__file__).resolve().parents[1]
source = (root / "site/media/gallium-hero.svg").read_text()
width = 960
fps = 24
frames = 144


def render(directory, index):
    phase = index / frames
    melt = max(0, min(1, (1 - cos(2 * pi * phase) - .15) / 1.68))
    melt = melt * melt * (3 - 2 * melt)
    ripple = sin(phase * 8 * pi) * melt * (1 - melt)
    mark = f"translate(660 {548 * melt:.2f}) scale({1 + .16 * melt:.4f} {1 - .12 * melt:.4f}) translate(-660 0)"
    pool = f"translate(660 613) scale({1 + .45 * melt:.4f} {1 + .46 * melt + .28 * ripple:.4f}) translate(-660 -613)"
    # The pool surface occludes the mark as it loses its shape.
    effects = f'''<clipPath id="surface"><path d="M0 0h1280v602H0z"/></clipPath>
    <filter id="soften" x="-.2" y="-.2" width="1.4" height="1.4">
      <feTurbulence type="fractalNoise" baseFrequency=".016 .036" numOctaves="2" seed="5" result="flow"/>
      <feDisplacementMap in="SourceGraphic" in2="flow" scale="{24 * melt:.2f}" xChannelSelector="R" yChannelSelector="G"/>
    </filter>'''
    frame = source.replace(
        '</defs>', effects + '</defs>',
    ).replace(
        '<g transform="translate(454 112)',
        f'<g clip-path="url(#surface)"><g filter="url(#soften)" transform="{mark} translate(454 112)',
    ).replace('</svg>', '</g></svg>').replace(
        'fill="url(#pool)"', f'fill="url(#pool)" transform="{pool}"',
    )
    subprocess.run(
        ["rsvg-convert", "-w", str(width), "-o", str(directory / f"{index:04d}.png")],
        input=frame.encode(), check=True,
    )


with TemporaryDirectory(prefix="gallium-motion-") as temporary:
    directory = Path(temporary)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda index: render(directory, index), range(frames)))
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-framerate", str(fps),
        "-i", str(directory / "%04d.png"), "-c:v", "libvpx-vp9",
        "-crf", "32", "-b:v", "0", "-pix_fmt", "yuv420p", "-an",
        str(root / "site/media/gallium-melt.webm"),
    ], check=True)
