#!/usr/bin/env python3
"""Render Musicwire genre demo cuts in the PR 25 terminal-card style."""

from __future__ import annotations

import math
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

MENLO = "/System/Library/Fonts/Menlo.ttc"
BG = (0, 0, 0)
WHITE = (236, 238, 240)
GOLD = (201, 166, 107)
KHAKI = (214, 196, 158)
MINT = (143, 203, 181)
PINK = (224, 112, 154)
GRAY = (154, 160, 166)
DIM = (92, 96, 102)
LINE = (70, 74, 78)


def font(size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(MENLO, size=size, index=index)


def trunc_tx(tx: str) -> str:
    body = tx[2:] if tx.startswith("0x") else tx
    return f"0x{body[:8]}..{body[-6:]}"


def measure(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


class Demo:
    def __init__(self, spec: dict):
        self.spec = spec

    def layout(self, aspect: str) -> dict:
        if aspect == "16x9":
            return {"w": 1920, "h": 1080, "caption": "right", "log_x": 56, "log_y": 150, "fs": 22, "head": 28}
        if aspect == "9x16":
            return {"w": 1080, "h": 1920, "caption": "top", "log_x": 48, "log_y": 360, "fs": 20, "head": 26}
        if aspect == "1x1":
            return {"w": 1080, "h": 1080, "caption": "right-tight", "log_x": 40, "log_y": 150, "fs": 18, "head": 22}
        raise ValueError(aspect)

    def frame(self, aspect: str, t: float) -> Image.Image:
        L = self.layout(aspect)
        im = Image.new("RGB", (L["w"], L["h"]), BG)
        d = ImageDraw.Draw(im)
        stage = self.stage(t)
        self.draw_caption(d, L, stage)
        self.draw_header(d, L)
        self.draw_log(d, L, t, stage)
        return im

    def stage(self, t: float) -> str:
        if t < 1.0:
            return "black"
        if t < 8.0:
            return "compose"
        if t < 16.0:
            return "validate"
        if t < 28.0:
            return "render"
        if t < 44.0:
            return "play"
        return "done"

    def caption_copy(self, stage: str) -> tuple[str, str]:
        s = self.spec
        return {
            "black": ("", ""),
            "compose": ("COMPOSE", f"MusicXML  ·  {s['score']}"),
            "validate": ("VALIDATE", "PAY  ·  0.10 USDC"),
            "render": ("RENDER", f"PAY  ·  {s['render_price']} USDC"),
            "play": ("PLAY", "score.mp3"),
            "done": ("DONE", "compose  ·  validate  ·  render  ·  pay  ·  play"),
        }[stage]

    def draw_caption(self, d: ImageDraw.ImageDraw, L: dict, stage: str) -> None:
        title, sub = self.caption_copy(stage)
        if not title:
            return
        f_big = font(64 if L["w"] >= 1600 else 52, 1)
        f_sub = font(22 if L["w"] >= 1600 else 18)
        if L["caption"] == "top":
            tw, _ = measure(d, title, f_big)
            d.text(((L["w"] - tw) / 2, 64), title, font=f_big, fill=WHITE)
            sw, _ = measure(d, sub, f_sub)
            d.text(((L["w"] - sw) / 2, 140), sub, font=f_sub, fill=GRAY)
        else:
            right = L["w"] - 56
            tw, _ = measure(d, title, f_big)
            d.text((right - tw, 48), title, font=f_big, fill=WHITE)
            sw, _ = measure(d, sub, f_sub)
            d.text((right - sw, 120), sub, font=f_sub, fill=GRAY)

    def draw_header(self, d: ImageDraw.ImageDraw, L: dict) -> None:
        f_brand = font(20, 1)
        f_meta = font(18)
        y = 250 if L["caption"] == "top" else 40
        x = L["log_x"]
        header_right = L["w"] - 520 if L["caption"] == "right" else L["w"] - 48
        if L["caption"] == "right-tight":
            header_right = L["w"] - 360
        if L["caption"] == "top":
            header_right = L["w"] - 48
        d.line((x, y, header_right, y), fill=LINE, width=2)
        d.text((x, y + 10), "MUSICWIRE", font=f_brand, fill=GOLD)
        d.text((x + 150, y + 12), "agent demo  ·  live production", font=f_meta, fill=KHAKI)
        d.text((x, y + 40), "https://musicwire.5432wire.com", font=f_meta, fill=GRAY)
        d.line((x, y + 74, header_right, y + 74), fill=LINE, width=2)

    def rows_for(self, t: float) -> list[tuple[str, str, tuple[int, int, int]]]:
        s = self.spec
        rows: list[tuple[str, str, tuple[int, int, int]]] = []
        if t < 1.0:
            return rows
        rows += [
            ("h", "COMPOSE", GOLD),
            ("c", f"$ GET /v1/compose-guide?style={s['style_query']}", MINT),
            ("kv", "score", s["score"]),
            ("kv", "form", s["form"]),
            ("kv", "part", s["part"]),
            ("kv", "wrote", s["wrote"]),
        ]
        if t >= 8.0:
            rows += [
                ("sp", "", WHITE),
                ("h", "VALIDATE", GOLD),
                ("c", "$ POST /v1/validate", MINT),
                ("pay", f"agent pays USDC  {s['validate_price']}  ·  x402 Exact  ·  Base", PINK),
                ("kv", "valid", "true"),
                ("kv", "payment", "settled"),
                ("kv", "tx", trunc_tx(s["validate_tx"])),
            ]
        if t >= 16.0:
            dots = max(1, min(16, int((t - 16.0) * 1.6)))
            rows += [
                ("sp", "", WHITE),
                ("h", "RENDER", GOLD),
                ("c", '$ POST /v1/render  { "formats": ["mp3"] }', MINT),
                ("pay", f"agent pays USDC  {s['render_price']}  ·  x402 Exact  ·  Base", PINK),
                ("kv", "job", s["job_id"]),
                ("kv", "status", "queued" if t < 24 else "completed"),
                ("kv", "price", s["render_price"]),
                ("kv", "qc", "." * dots),
            ]
            if t >= 24.0:
                rows += [
                    ("kv", "job_status", "completed"),
                    ("kv", "qc", "passed"),
                    ("kv", "payment", "settled"),
                    ("kv", "tx", trunc_tx(s["render_tx"])),
                ]
        if t >= 28.0:
            rows += [
                ("sp", "", WHITE),
                ("h", "PLAY", GOLD),
                ("c", "$ GET artifact  score.mp3", MINT),
                ("kv", "track", s["score"]),
                ("kv", "file", f"{s['mp3_name']}  {s['mp3_bytes']:,} bytes"),
            ]
        return rows

    def draw_log(self, d: ImageDraw.ImageDraw, L: dict, t: float, stage: str) -> None:
        f = font(L["fs"])
        f_h = font(L["head"], 1)
        x = L["log_x"]
        y = L["log_y"]
        col = 210 if L["w"] >= 1600 else 180
        lh = L["fs"] + 10
        for item in self.rows_for(t):
            kind = item[0]
            if kind == "sp":
                y += 10
                continue
            if kind == "h":
                d.text((x, y), item[1], font=f_h, fill=item[2])
                y += lh + 4
                continue
            if kind == "c":
                d.text((x, y), item[1], font=f, fill=item[2])
                y += lh
                continue
            if kind == "pay":
                d.text((x + 8, y), "agent ", font=f, fill=GRAY)
                aw, _ = measure(d, "agent ", f)
                d.text((x + 8 + aw, y), "pays USDC", font=f, fill=PINK)
                pw, _ = measure(d, "pays USDC", f)
                rest = item[1].split("pays USDC", 1)[-1]
                d.text((x + 8 + aw + pw, y), rest, font=f, fill=GRAY)
                y += lh
                continue
            key = item[1]
            val = item[2]
            d.text((x + 8, y), key, font=f, fill=DIM)
            d.text((x + col, y), val, font=f, fill=WHITE)
            y += lh
        if stage in ("play", "done"):
            self.draw_playbar(d, L, x, y + 8, t)

        if stage == "done":
            fy = L["h"] - 64
            d.line((x, fy - 18, L["w"] - 48, fy - 18), fill=LINE, width=2)
            d.text((x, fy), "done  compose  ·  validate  ·  render  ·  pay  ·  play", font=f, fill=GRAY)

    def draw_playbar(self, d: ImageDraw.ImageDraw, L: dict, x: int, y: int, t: float) -> None:
        audio_t = max(0.0, min(self.spec["duration"], t))
        shown = audio_t if t >= 28 else 0.0
        width = 420 if L["w"] >= 1600 else 320
        f = font(L["fs"])
        d.polygon([(x + 8, y + 6), (x + 8, y + 22), (x + 20, y + 14)], fill=WHITE)
        bx = x + 32
        d.rectangle((bx, y + 10, bx + width, y + 16), outline=LINE, width=1)
        filled = int(width * (shown / self.spec["duration"]))
        if filled > 0:
            d.rectangle((bx, y + 10, bx + filled, y + 16), fill=WHITE)
        d.text((bx + width + 16, y), f"{int(shown)}s", font=f, fill=GRAY)


def write_ass(path: Path, spec: dict, aspect: str, duration: float) -> None:
    if aspect == "9x16":
        playres = "PlayResX: 1080\nPlayResY: 1920"
        align = 8
        marginv = 80
        marginl = 40
        marginr = 40
        size = 64
    elif aspect == "1x1":
        playres = "PlayResX: 1080\nPlayResY: 1080"
        align = 9
        marginv = 48
        marginl = 40
        marginr = 48
        size = 48
    else:
        playres = "PlayResX: 1920\nPlayResY: 1080"
        align = 9
        marginv = 48
        marginl = 40
        marginr = 56
        size = 60
    events = [
        (1.0, 8.0, "COMPOSE", f"MusicXML  ·  {spec['score']}"),
        (8.0, 16.0, "VALIDATE", "PAY  ·  0.10 USDC"),
        (16.0, 28.0, "RENDER", f"PAY  ·  {spec['render_price']} USDC"),
        (28.0, 44.0, "PLAY", "score.mp3"),
        (44.0, duration, "DONE", "compose · validate · render · pay · play"),
    ]

    def ts(sec: float) -> str:
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = sec % 60
        return f"{h}:{m:02d}:{s:05.2f}"

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        playres,
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Title,Menlo,{size},&H00F0F0F0,&H000000FF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,{align},{marginl},{marginr},{marginv},1",
        f"Style: Sub,Menlo,{max(22, size // 3)},&H00A6A0A0,&H000000FF,&H00101010,&H00000000,0,0,0,0,100,100,0,0,1,2,0,{align},{marginl},{marginr},{marginv + int(size * 1.15)},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for start, end, title, sub in events:
        lines.append(f"Dialogue: 0,{ts(start)},{ts(end)},Title,,0,0,0,,{title}")
        lines.append(f"Dialogue: 0,{ts(start)},{ts(end)},Sub,,0,0,0,,{sub}")
    path.write_text("\n".join(lines) + "\n")


def render_aspect(spec: dict, aspect: str, out_mp4: Path, audio: Path) -> None:
    duration = float(spec["duration"])
    Ldemo = Demo(spec)
    L = Ldemo.layout(aspect)
    work = Path(tempfile.mkdtemp(prefix=f"mw-{aspect}-", dir="/private/tmp"))
    times = []
    t = 0.0
    while t < duration - 0.001:
        step = 0.5 if 16 <= t < 28 or t >= 28 else 1.0
        if t < 1:
            step = 1.0
        times.append(t)
        t += step
    times.append(duration - 0.04)

    frames = []
    for i, ts in enumerate(times):
        img = Ldemo.frame(aspect, ts)
        png = work / f"f{i:04d}.png"
        img.save(png, "PNG")
        nxt = times[i + 1] if i + 1 < len(times) else duration
        frames.append((png, max(0.04, nxt - ts)))

    lst = work / "concat.txt"
    with lst.open("w") as fh:
        for png, dur in frames:
            fh.write(f"file '{png}'\n")
            fh.write(f"duration {dur:.3f}\n")
        fh.write(f"file '{frames[-1][0]}'\n")

    ass = work / "captions.ass"
    write_ass(ass, spec, aspect, duration)
    raw = work / "video.mp4"
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(lst),
            "-vf",
            "fps=30,format=yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            str(raw),
        ]
    )
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(raw),
            "-i",
            str(audio),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(out_mp4),
        ]
    )
    out_mp4.with_suffix(".ass").write_text(ass.read_text())


if __name__ == "__main__":
    import json
    import sys

    spec = json.loads(Path(sys.argv[1]).read_text())
    audio = Path(sys.argv[2])
    outdir = Path(sys.argv[3])
    stem = sys.argv[4]
    outdir.mkdir(parents=True, exist_ok=True)
    for aspect in ("16x9", "9x16", "1x1"):
        dest = outdir / f"{stem}-{aspect}.mp4"
        print("rendering", dest, flush=True)
        render_aspect(spec, aspect, dest, audio)
        print("wrote", dest, dest.stat().st_size, flush=True)
