"""Screenshot annotation via Pillow.

Burns reviewer-drawn shapes (rectangle / arrow / highlight / circle / text) onto
a copy of a captured screenshot PNG. Real Pillow rendering only (ADR 0001) — no
simulated/placeholder output.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.schemas import AnnotationShape

_DEFAULT_LINE_WIDTH = 4
_HIGHLIGHT_ALPHA = 90


def _rgba(color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    """Parse a `#rrggbb` (or `#rgb`) hex color string into an RGBA tuple."""
    value = color.lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    r, g, b = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    return (r, g, b, alpha)


def _draw_shape(draw: ImageDraw.ImageDraw, shape: AnnotationShape) -> None:
    color = _rgba(shape.color)
    x1, y1 = shape.x, shape.y

    if shape.tool == "rectangle":
        x2, y2 = x1 + shape.w, y1 + shape.h
        draw.rectangle([x1, y1, x2, y2], outline=color, width=_DEFAULT_LINE_WIDTH)
    elif shape.tool == "circle":
        x2, y2 = x1 + shape.w, y1 + shape.h
        draw.ellipse([x1, y1, x2, y2], outline=color, width=_DEFAULT_LINE_WIDTH)
    elif shape.tool == "arrow":
        x2, y2 = shape.x2, shape.y2
        draw.line([x1, y1, x2, y2], fill=color, width=_DEFAULT_LINE_WIDTH)
        _draw_arrowhead(draw, x1, y1, x2, y2, color)
    elif shape.tool == "highlight":
        x2, y2 = x1 + shape.w, y1 + shape.h
        draw.rectangle([x1, y1, x2, y2], fill=_rgba(shape.color, _HIGHLIGHT_ALPHA))
    elif shape.tool == "text":
        font = ImageFont.load_default()
        draw.text((x1, y1), shape.text, fill=color, font=font)


def _draw_arrowhead(
    draw: ImageDraw.ImageDraw,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    color: tuple[int, int, int, int],
) -> None:
    """Draw a small filled triangle at (x2, y2) pointing away from (x1, y1)."""
    import math

    angle = math.atan2(y2 - y1, x2 - x1)
    length, spread = 14, 0.5
    left = (
        x2 - length * math.cos(angle - spread),
        y2 - length * math.sin(angle - spread),
    )
    right = (
        x2 - length * math.cos(angle + spread),
        y2 - length * math.sin(angle + spread),
    )
    draw.polygon([(x2, y2), left, right], fill=color)


def render_annotations(src_path: Path | str, shapes: list[AnnotationShape], dst_path: Path | str) -> Path:
    """Burn ``shapes`` onto a copy of the PNG at ``src_path`` and save to ``dst_path``.

    Args:
        src_path: Path to the source screenshot (PNG).
        shapes: Annotation shapes to draw, in order.
        dst_path: Output path for the annotated PNG. Parent dirs are created.

    Returns:
        The resolved ``dst_path``.
    """
    src_path = Path(src_path)
    dst_path = Path(dst_path)
    dst_path.parent.mkdir(parents=True, exist_ok=True)

    base = Image.open(src_path).convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for shape in shapes:
        _draw_shape(draw, shape)

    composed = Image.alpha_composite(base, overlay).convert("RGB")
    composed.save(dst_path, format="PNG")
    return dst_path
