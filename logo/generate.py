#!/usr/bin/env python3
"""Script for generating logo.

A square is refined like a quadtree: every cell whose center lies within REACH cell-widths of FOCUS
splits 2x2, down to MAX_DEPTH. Color runs along an OKLCH ramp from violet to cyan, three parts by
how finely a cell is resolved and one part by how close it sits to FOCUS.

    python3 generate.py    # rewrites logo.svg, logo-animated.svg and icon.svg next to this file
"""

import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
FOCUS = (0.75, 0.25)  # center of the top-right quadrant, in units of the square
REACH = 1.25
MAX_DEPTH = 5  # 32 cells across at the finest: a 4x upscale of the 8-across icon
ICON_DEPTH = 3
QUADRANTS = {"tl": (0, 0), "tr": (1, 0), "bl": (0, 1), "br": (1, 1)}

SIZE = 512  # logo viewBox
GAP = 4  # grout between tiles, in viewBox units
ROUNDING = 0.08  # corner radius as a share of the tile, so coarse tiles are soft and fine ones crisp
ICON_SIZE = 32  # icon viewBox: one unit is one pixel at 32px, with a 1px gutter

SPLITS = (1.05, 1.5, 1.9, 2.25, 2.55)  # seconds at which cells of depth 0, 1, 2... split
SETTLE = 0.6  # seconds a split takes to open its gutters and shift its colors


class Cell:
    def __init__(self, x=0.0, y=0.0, size=1.0, depth=0, quadrant=None, parent=None):
        self.x, self.y, self.size, self.depth = x, y, size, depth
        self.quadrant, self.parent = quadrant, parent
        self.center = (x + size / 2, y + size / 2)
        self.children = []
        if depth < MAX_DEPTH and math.dist(self.center, FOCUS) < REACH * size:
            half = size / 2
            self.children = [Cell(x + col * half, y + row * half, half, depth + 1, name, self)
                             for name, (col, row) in QUADRANTS.items()]

    def walk(self):
        """Every cell, parents before their children."""
        yield self
        for child in self.children:
            yield from child.walk()

    def shade(self):
        """Position on the color ramp, 0 (violet) to 1 (cyan)."""
        closeness = 1 - math.dist(self.center, FOCUS) / math.dist((0, 1), FOCUS)
        return 0.75 * self.depth / MAX_DEPTH + 0.25 * closeness

    def mean_shade(self):
        """Area-weighted mean shade of the leaves under this cell: what a box downsample would show."""
        if not self.children:
            return self.shade()
        return sum(child.mean_shade() for child in self.children) / 4


def oklch_to_srgb(lightness, chroma, hue):
    a, b = chroma * math.cos(math.radians(hue)), chroma * math.sin(math.radians(hue))
    l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    linear = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
              -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
              -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    if not all(-1e-4 <= c <= 1 + 1e-4 for c in linear):
        return None
    return [12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055 for c in (min(max(c, 0), 1) for c in linear)]


def color(shade):
    """Violet (shade 0) to cyan (shade 1); chroma is eased down until the color fits sRGB."""
    lightness, chroma, hue = 0.49 + 0.30 * shade, 0.2, 305 - 90 * shade
    while (rgb := oklch_to_srgb(lightness, chroma, hue)) is None:
        chroma -= 0.002
    return "#" + "".join(f"{round(c * 255):02x}" for c in rgb)


def num(value):
    return f"{value:.3f}".rstrip("0").rstrip(".")


def tile(cell):
    """Logo geometry: the cell inset by half the gutter on every side."""
    return cell.x * SIZE + GAP / 2, cell.y * SIZE + GAP / 2, cell.size * SIZE - GAP


def rect(x, y, side, fill, attributes=""):
    assert 0 <= x and 0 <= y and x + side <= SIZE and y + side <= SIZE, (x, y, side)
    return (f'<rect{attributes} x="{num(x)}" y="{num(y)}" width="{num(side)}" height="{num(side)}" '
            f'rx="{num(ROUNDING * side)}" fill="{fill}"/>')


def by_depth(cells, line):
    groups = []
    for depth in sorted({cell.depth for cell in cells}):
        rows = "\n".join(f"    {line(cell)}" for cell in cells if cell.depth == depth)
        groups.append(f'  <g id="depth-{depth}">\n{rows}\n  </g>')
    return "\n".join(groups)


def svg(view, body, label="Upscaler"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view} {view}" role="img" aria-labelledby="title">\n'
            f'  <title id="title">{label}</title>\n{body}\n</svg>\n')


def static_logo(root):
    leaves = [cell for cell in root.walk() if not cell.children]
    return svg(SIZE, by_depth(leaves, lambda cell: rect(*tile(cell), color(cell.shade()))))


def icon(root):
    """The same tree cut at 8 cells across, snapped to a 32px grid with the gutter on each tile's far side."""
    cut = [cell for cell in root.walk() if cell.depth == ICON_DEPTH or (not cell.children and cell.depth < ICON_DEPTH)]

    def pixel_rect(cell):
        x, y, side = cell.x * ICON_SIZE, cell.y * ICON_SIZE, cell.size * ICON_SIZE - 1
        assert x + side <= ICON_SIZE and y + side <= ICON_SIZE, (x, y, side)
        return (f'<rect x="{num(x)}" y="{num(y)}" width="{num(side)}" height="{num(side)}" '
                f'rx="{num(ROUNDING * side)}" fill="{color(cell.mean_shade())}"/>')

    return svg(ICON_SIZE, by_depth(cut, pixel_rect))


STYLE = f"""  <style>
    /* Every tile is drawn at its final state; the animation only covers the time before it. */
    rect {{
      transform-box: fill-box;
      animation: split-in {SETTLE}s cubic-bezier(0.16, 1, 0.3, 1) var(--born) both;
    }}
    .parent {{
      opacity: 0;
      animation: split-in {SETTLE}s cubic-bezier(0.16, 1, 0.3, 1) var(--born) both,
        hand-over 0.2s linear var(--split) forwards;
    }}
    #seed {{
      transform-origin: 0 100%;
      animation: seed 1s cubic-bezier(0.65, 0, 0.35, 1) both, hand-over 0.2s linear var(--split) forwards;
    }}
    .tl {{ transform-origin: 0 0; }}
    .tr {{ transform-origin: 100% 0; }}
    .bl {{ transform-origin: 0 100%; }}
    .br {{ transform-origin: 100% 100%; }}

    /* A child starts as its quarter of the parent, in the parent's color, then the gutter opens.
       Visibility steps on at birth, so a split never blinks. */
    @keyframes split-in {{
      from {{ visibility: hidden; opacity: 1; fill: var(--from); transform: scale(var(--grow)); }}
      to {{ visibility: visible; opacity: 1; }}
    }}
    @keyframes hand-over {{
      from {{ opacity: 1; }}
      to {{ opacity: 0; }}
    }}
    /* The seed is the low-resolution input: it appears at a quarter size and is upscaled 2x, then 4x. */
    @keyframes seed {{
      from {{ opacity: 0; transform: scale(0.25); }}
      15%, 35% {{ opacity: 1; transform: scale(0.25); }}
      55%, 65% {{ opacity: 1; transform: scale(0.5); }}
      85%, to {{ opacity: 1; transform: scale(1); }}
    }}
    @media (prefers-reduced-motion: reduce) {{
      rect {{ animation: none !important; }}
    }}
  </style>"""


def animated_logo(root):
    def line(cell):
        x, y, side = tile(cell)
        variables = [f"--born:{SPLITS[cell.depth - 1] if cell.parent else 0}s"]
        if cell.parent:
            variables += [f"--from:{color(cell.parent.shade())}", f"--grow:{num((side + GAP / 2) / side)}"]
        if cell.children:
            variables.append(f"--split:{SPLITS[cell.depth]}s")
        classes = " ".join(filter(None, (cell.quadrant, "parent" if cell.children else None)))
        attributes = ' id="seed"' if not cell.parent else ""
        attributes += f' class="{classes}"' if classes else ""
        attributes += f' style="{";".join(variables)}"'
        return rect(x, y, side, color(cell.shade()), attributes)

    return svg(SIZE, STYLE + "\n" + by_depth(list(root.walk()), line))


def main():
    root = Cell()
    leaves = [cell for cell in root.walk() if not cell.children]
    assert sum(cell.size ** 2 for cell in leaves) == 1, "leaves must tile the square exactly"
    assert len(SPLITS) >= MAX_DEPTH
    (HERE / "logo.svg").write_text(static_logo(root))
    (HERE / "logo-animated.svg").write_text(animated_logo(root))
    (HERE / "icon.svg").write_text(icon(root))
    counts = {depth: sum(cell.depth == depth for cell in leaves) for depth in range(MAX_DEPTH + 1)}
    print(f"{len(leaves)} tiles by depth {counts}")


if __name__ == "__main__":
    main()
