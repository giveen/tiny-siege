#!/usr/bin/env python3
"""
Asset pipeline for Tiny Siege.

Reads the raw "Tiny Swords (Free Pack)" art plus the PixelFlush "Pixel
Monsters Mega Pack" enemy sheets (enemies/) and emits a clean, deterministic
asset tree under public/assets/ plus a manifest.json the TypeScript game loads.

What it does:
  * Slices horizontal sprite sheets (variable-width frames) into individual
    frames, normalizing every frame of a sheet into a common cell that is
    bottom-aligned + horizontally centered, so the game can anchor every unit
    at its feet with a stable (cellW/2, cellH-1) point.
  * Extracts the 64px autotile grass tiles from the tileset.
  * Copies/normalizes static art (buildings, UI, decorations) to content bboxes.
  * Emits manifest.json describing every asset, its frames, cell size and anchor.

Run with:  python3 tools/build_assets.py
"""

import os
import json
import math
import shutil
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "Tiny Swords (Free Pack)")
OUT = os.path.join(ROOT, "public", "assets")
# Curated picks from the Kenney All-in-1 library (CC0), committed as build-time
# sources; see vendor/kenney/CREDIT.txt.
KEN = os.path.join(ROOT, "vendor", "kenney")

ALPHA_THR = 10

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def load(path):
    return Image.open(path).convert("RGBA")


def column_segments(im):
    """Return list of (x0, x1) inclusive column ranges that contain opaque px."""
    a = np.array(im.getchannel("A"))
    col = (a > ALPHA_THR).any(axis=0)  # one bool per column
    segs = []
    i = 0
    n = len(col)
    while i < n:
        if col[i]:
            j = i
            while j < n and col[j]:
                j += 1
            segs.append((i, j - 1))
            i = j
        else:
            i += 1
    return segs


def content_bbox(im):
    """Tight opaque bbox (x0, y0, x1, y1) inclusive, or None if empty."""
    a = im.getchannel("A")
    box = a.getbbox()
    if not box:
        return None
    return box  # (left, upper, right, lower) with right/lower exclusive


def slice_sheet(im):
    """Slice a horizontal strip sheet into frame images (full sheet height)."""
    frames = []
    for x0, x1 in column_segments(im):
        frames.append(im.crop((x0, 0, x1 + 1, im.height)))
    return frames


def slice_uniform(im, fw):
    """Slice a horizontal sheet into FIXED-width frames (uniform cell size,
    e.g. GameFX export sheets where every frame is exactly fw px wide)."""
    assert im.width % fw == 0, f"sheet width {im.width} is not a multiple of {fw}"
    return [im.crop((i * fw, 0, (i + 1) * fw, im.height)) for i in range(im.width // fw)]


def normalize_frames(frames):
    """
    Normalize a list of same-height frames into a common cell:
      cellW = max frame width
      cellH = (max bottom) - (min top)
    Each frame is centered horizontally and bottom-aligned in the cell.
    Returns (cell_w, cell_h, [cell-sized RGBA images]).
    """
    bboxes = [content_bbox(f) for f in frames]
    tops = [b[1] for b in bboxes if b]
    bots = [b[3] - 1 for b in bboxes if b]
    widths = [f.width for f in frames]
    if not tops:
        # No opaque content anywhere (empty/faint sheet): use sheet size as-is.
        cell_w = max(widths) if widths else 1
        cell_h = max((f.height for f in frames), default=1)
        cells = [Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0)) for _ in frames]
        for f, c in zip(frames, cells):
            c.paste(f, (0, cell_h - f.height), f)
        return cell_w, cell_h, cells
    min_top = min(tops)
    max_bot = max(bots)
    cell_w = max(widths)
    cell_h = max_bot - min_top + 1
    cell_w = (cell_w + 1) // 2 * 2  # even width for clean centering
    out = []
    for f, b in zip(frames, bboxes):
        cell = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))
        if b:
            x0, y0, x1, y1 = b
            crop = f.crop((x0, y0, x1 + 1, y1 + 1))
            dx = cell_w // 2 - crop.width // 2
            dy = cell_h - crop.height
            cell.paste(crop, (dx, dy), crop)
        out.append(cell)
    return cell_w, cell_h, out


def save(img, rel):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p)
    return rel


def crop_to_bbox(im):
    b = content_bbox(im)
    if not b:
        return im
    return im.crop(b)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    if os.path.exists(OUT):
        # Clear the CONTENTS but keep the top-level directory itself. Replacing
        # the directory (rmtree + makedirs) breaks a running vite dev server's
        # public-dir index — it then serves index.html for every /assets/* URL
        # until it is restarted. Removing the files in place avoids that.
        for dirpath, dirnames, filenames in os.walk(OUT, topdown=False):
            for fn in filenames:
                os.remove(os.path.join(dirpath, fn))
            for dn in dirnames:
                shutil.rmtree(os.path.join(dirpath, dn), ignore_errors=True)
    os.makedirs(OUT, exist_ok=True)

    manifest = {
        "tileSize": 64,
        "units": {},
        "buildings": {},
        "animatedBuildings": {},
        "tiles": {},
        "deco": {},
        "fx": {},
        "ui": {},
    }

    colors = ["blue", "red", "black", "purple", "yellow"]

    # ---- Units -----------------------------------------------------------
    # action -> (relative filename in the color/unit dir, kind)
    unit_sheets = {
        "archer": {
            "idle": "Archer/Archer_Idle.png",
            "run": "Archer/Archer_Run.png",
            "shoot": "Archer/Archer_Shoot.png",
            "arrow": "Archer/Arrow.png",  # static
        },
        "warrior": {
            "idle": "Warrior/Warrior_Idle.png",
            "run": "Warrior/Warrior_Run.png",
            "attack1": "Warrior/Warrior_Attack1.png",
            "attack2": "Warrior/Warrior_Attack2.png",
            "guard": "Warrior/Warrior_Guard.png",
        },
        "lancer": {
            "idle": "Lancer/Lancer_Idle.png",
            "run": "Lancer/Lancer_Run.png",
            "attack": "Lancer/Lancer_Right_Attack.png",
            "defence": "Lancer/Lancer_Right_Defence.png",
        },
        "monk": {
            "idle": "Monk/Idle.png",
            "run": "Monk/Run.png",
            "heal": "Monk/Heal.png",
            "heal_fx": "Monk/Heal_Effect.png",
        },
        "pawn": {
            "idle": "Pawn/Pawn_Idle.png",
            "run": "Pawn/Pawn_Run.png",
        },
    }

    unit_dirs = {
        "blue": "Blue Units", "red": "Red Units", "black": "Black Units",
        "purple": "Purple Units", "yellow": "Yellow Units",
    }
    for color in colors:
        cdir = os.path.join(SRC, "Units", unit_dirs[color])
        manifest["units"][color] = {}
        for unit, actions in unit_sheets.items():
            manifest["units"][color][unit] = {}
            for action, rel in actions.items():
                path = os.path.join(cdir, rel)
                if not os.path.exists(path):
                    print(f"  ! missing {path}")
                    continue
                im = load(path)
                # static single-frame assets (arrow, and 1-segment sheets)
                segs = column_segments(im)
                if action == "arrow" or len(segs) <= 1:
                    img = crop_to_bbox(im)
                    rel_out = f"units/{color}_{unit}_{action}.png"
                    save(img, rel_out)
                    manifest["units"][color][unit][action] = {
                        "frames": [rel_out],
                        "cell": [img.width, img.height],
                        "anchor": "center",
                    }
                else:
                    frames = slice_sheet(im)
                    cw, ch, cells = normalize_frames(frames)
                    fps = {"shoot": 14, "attack1": 16, "attack2": 16,
                           "heal": 12, "heal_fx": 12, "run": 10,
                           "idle": 8, "attack": 16, "defence": 10}.get(action, 10)
                    rels = []
                    for i, cell in enumerate(cells):
                        r = f"units/{color}_{unit}_{action}_{i}.png"
                        save(cell, r)
                        rels.append(r)
                    manifest["units"][color][unit][action] = {
                        "frames": rels,
                        "cell": [cw, ch],
                        "anchor": "bottom-center",
                        "fps": fps,
                        "loop": action in ("idle", "run", "heal_fx"),
                    }

    # ---- Buildings -------------------------------------------------------
    bdirs = {
        "blue": "Blue Buildings", "red": "Red Buildings", "black": "Black Buildings",
        "purple": "Purple Buildings", "yellow": "Yellow Buildings",
    }
    building_names = {
        "castle": "Castle.png", "tower": "Tower.png", "archery": "Archery.png",
        "barracks": "Barracks.png", "monastery": "Monastery.png",
        "house1": "House1.png", "house2": "House2.png", "house3": "House3.png",
    }
    for color, d in bdirs.items():
        manifest["buildings"][color] = {}
        for name, fn in building_names.items():
            path = os.path.join(SRC, "Buildings", d, fn)
            if not os.path.exists(path):
                continue
            img = crop_to_bbox(load(path))
            rel = f"buildings/{color}_{name}.png"
            save(img, rel)
            manifest["buildings"][color][name] = {
                "image": rel,
                "size": [img.width, img.height],
                "anchor": "bottom-center",
            }

    # ---- Tiles (autotile grass) -----------------------------------------
    tileset = load(os.path.join(SRC, "Terrain", "Tileset", "Tilemap_color1.png"))
    T = 64
    tiles = manifest["tiles"]
    grass = []
    for r in range(4):
        row = []
        for c in range(4):
            t = tileset.crop((c * T, r * T, (c + 1) * T, (r + 1) * T))
            rel = f"tiles/grass_{c}_{r}.png"
            save(t, rel)
            row.append(rel)
        grass.append(row)
    tiles["grass"] = grass  # grass[r][c]
    # interior variations (right block, no edges)
    var = []
    for r in range(4):
        for c in range(5, 9):
            t = tileset.crop((c * T, r * T, (c + 1) * T, (r + 1) * T))
            rel = f"tiles/grassvar_{c}_{r}.png"
            save(t, rel)
            var.append(rel)
    tiles["grass_var"] = var
    # corner tiles for rounded island corners
    corners = {}
    corner_map = {
        "bl": (0, 4), "bl2": (0, 5), "br": (3, 4), "br2": (3, 5),
    }
    for name, (c, r) in corner_map.items():
        t = tileset.crop((c * T, r * T, (c + 1) * T, (r + 1) * T))
        rel = f"tiles/corner_{name}.png"
        save(t, rel)
        corners[name] = rel
    tiles["corners"] = corners

    # water background tile
    wb = load(os.path.join(SRC, "Terrain", "Tileset", "Water Background color.png"))
    save(wb, "tiles/water.png")
    tiles["water"] = "tiles/water.png"

    # water foam (static texture strip; game crops it)
    foam = load(os.path.join(SRC, "Terrain", "Tileset", "Water Foam.png"))
    save(foam, "fx/waterfoam.png")
    tiles["waterfoam"] = "fx/waterfoam.png"

    # ---- Decorations -----------------------------------------------------
    deco = manifest["deco"]

    def static_list(key, files):
        """files: list of paths relative to SRC (single-item images)."""
        rels = []
        for i, rel in enumerate(files):
            p = os.path.join(SRC, rel)
            if not os.path.exists(p):
                continue
            img = crop_to_bbox(load(p))
            out = f"deco/{key}_{i}.png"
            save(img, out)
            rels.append(out)
        return rels

    def slice_list(key, files):
        """files are horizontal sprite sheets; slice each into individual items."""
        rels = []
        idx = 0
        for rel in files:
            p = os.path.join(SRC, rel)
            if not os.path.exists(p):
                continue
            im = load(p)
            frames = slice_sheet(im) if len(column_segments(im)) > 1 else [im]
            for f in frames:
                img = crop_to_bbox(f)
                out = f"deco/{key}_{idx}.png"
                save(img, out)
                rels.append(out)
                idx += 1
        return rels

    deco["tree"] = slice_list("tree",
        [f"Terrain/Resources/Wood/Trees/Tree{i}.png" for i in range(1, 5)])
    deco["bush"] = slice_list("bush",
        [f"Terrain/Decorations/Bushes/Bushe{i}.png" for i in range(1, 5)])
    deco["stump"] = static_list("stump",
        [f"Terrain/Resources/Wood/Trees/Stump {i}.png" for i in range(1, 5)])
    deco["rock"] = static_list("rock",
        [f"Terrain/Decorations/Rocks/Rock{i}.png" for i in range(1, 5)])
    deco["duck"] = static_list("duck",
        ["Terrain/Decorations/Rubber Duck/Rubber duck.png"])
    # Water Rocks_0X.png are each a horizontal strip of many small rock
    # clusters (not one rock each) — slice, don't treat as single images.
    deco["water_rock"] = slice_list("water_rock",
        [f"Terrain/Decorations/Rocks in the Water/Water Rocks_0{i}.png" for i in range(1, 5)])

    # sheep: idle/grass static (one representative frame — each source file is
    # actually a multi-frame animation strip, not a single image), move animated
    for name, fn in [("sheep_idle", "Meat/Sheep/Sheep_Idle.png"),
                     ("sheep_grass", "Meat/Sheep/Sheep_Grass.png")]:
        p = os.path.join(SRC, "Terrain", "Resources", fn)
        if os.path.exists(p):
            frames = slice_sheet(load(p))
            img = crop_to_bbox(frames[0])
            rel = f"deco/{name}.png"
            save(img, rel)
            deco[name] = {"image": rel, "size": [img.width, img.height], "anchor": "bottom-center"}
    p = os.path.join(SRC, "Terrain", "Resources", "Meat", "Sheep", "Sheep_Move.png")
    if os.path.exists(p):
        im = load(p)
        frames = slice_sheet(im) if len(column_segments(im)) > 1 else [im]
        cw, ch, cells = normalize_frames(frames)
        rels = [save(c, f"deco/sheep_move_{i}.png") for i, c in enumerate(cells)]
        deco["sheep_move"] = {"frames": rels, "cell": [cw, ch], "anchor": "bottom-center", "fps": 8, "loop": True}

    # gold coin (for HUD) — use the resource gold stone as a bonus
    p = os.path.join(SRC, "Terrain", "Resources", "Gold", "Gold Stones", "Gold Stone 1.png")
    if os.path.exists(p):
        img = crop_to_bbox(load(p))
        save(img, "deco/goldstone.png")
        deco["goldstone"] = {"image": "deco/goldstone.png", "size": [img.width, img.height], "anchor": "center"}

    # ---- Clouds (drifting atmosphere layer, not tied to any grid cell) ----
    clouds = []
    for i in range(1, 9):
        p = os.path.join(SRC, "Terrain", "Decorations", "Clouds", f"Clouds_0{i}.png")
        if not os.path.exists(p):
            print(f"  ! missing cloud {i}")
            continue
        img = crop_to_bbox(load(p))
        out = f"deco/cloud_{i}.png"
        save(img, out)
        clouds.append({"image": out, "size": [img.width, img.height], "anchor": "center"})
    manifest["clouds"] = clouds

    # ---- FX (particles) --------------------------------------------------
    fx = manifest["fx"]
    fx_sheets = {
        "explosion1": "Particle FX/Explosion_01.png",
        "explosion2": "Particle FX/Explosion_02.png",
        "fire1": "Particle FX/Fire_01.png",
        "fire2": "Particle FX/Fire_02.png",
        "fire3": "Particle FX/Fire_03.png",
        "water_splash": "Particle FX/Water Splash.png",
        "dust1": "Particle FX/Dust_01.png",
        "dust2": "Particle FX/Dust_02.png",
    }
    for name, rel in fx_sheets.items():
        p = os.path.join(SRC, rel)
        im = load(p)
        frames = slice_sheet(im)
        cw, ch, cells = normalize_frames(frames)
        rels = [save(c, f"fx/{name}_{i}.png") for i, c in enumerate(cells)]
        fx[name] = {"frames": rels, "cell": [cw, ch], "anchor": "center", "fps": 20, "loop": False}

    # Wizard tower bolts + impact FX — GameFX export sheets (vendor/gamefx).
    # Uniform frame widths; (sheet, frame_width, fps, loop).
    GFX = os.path.join(ROOT, "vendor", "gamefx")
    wizard_fx = {
        "wizard_fire": ("FireBall_64x64.png", 64, 30, True),
        "wizard_ice": ("IcePick_64x64.png", 64, 24, True),
        "wizard_star": ("MediumStar_64x64.png", 64, 20, True),
        "wizard_fire_impact": ("FireCast_96x96.png", 96, 48, False),
        "wizard_ice_impact": ("IceShatter_96x96.png", 96, 70, False),
        "wizard_star_impact": ("HolyExplosion_96x96.png", 96, 48, False),
    }
    for name, (rel, fw, fps, loop) in wizard_fx.items():
        p = os.path.join(GFX, rel)
        if not os.path.exists(p):
            print(f"  ! missing GameFX sheet {rel}")
            continue
        frames = slice_uniform(load(p), fw)
        cw, ch, cells = normalize_frames(frames)
        rels = [save(c, f"fx/{name}_{i}.png") for i, c in enumerate(cells)]
        fx[name] = {"frames": rels, "cell": [cw, ch], "anchor": "center", "fps": fps, "loop": loop}

    # ---- FX (Kenney All-in-1, CC0 — curated picks in vendor/kenney/fx) ----
    # One-shot particle sequences as individually numbered frames (white
    # silhouettes, tintable at draw time; the pixel explosion is pre-tinted).
    kenney_fx = {
        "kenney_burst":  ("pixelExplosion", 30),
        "kenney_sparks": ("spark", 30),
        "kenney_magic":  ("magic", 24),
        "kenney_smoke":  ("smoke", 15),
        "kenney_star":   ("star", 20),
    }
    for name, (prefix, fps) in kenney_fx.items():
        files = sorted(f for f in os.listdir(os.path.join(KEN, "fx"))
                       if f.startswith(prefix) and f.endswith(".png"))
        if not files:
            print(f"  ! missing kenney fx frames for {prefix}")
            continue
        frames = [load(os.path.join(KEN, "fx", f)) for f in files]
        cw, ch, cells = normalize_frames(frames)
        rels = [save(c, f"fx/{name}_{i}.png") for i, c in enumerate(cells)]
        fx[name] = {"frames": rels, "cell": [cw, ch], "anchor": "center", "fps": fps, "loop": False}

    # ---- UI --------------------------------------------------------------
    ui = manifest["ui"]
    uie = os.path.join(SRC, "UI Elements", "UI Elements")

    def ui_static(key, rel, anchor="center", crop=True):
        p = os.path.join(uie, rel)
        if not os.path.exists(p):
            return
        img = load(p)
        if crop:
            img = crop_to_bbox(img)
        out = f"ui/{key}.png"
        save(img, out)
        return {"image": out, "size": [img.width, img.height], "anchor": anchor}

    ui["bars"] = {}
    for key, rel in [("big_base", "Bars/BigBar_Base.png"), ("big_fill", "Bars/BigBar_Fill.png"),
                     ("small_base", "Bars/SmallBar_Base.png"), ("small_fill", "Bars/SmallBar_Fill.png")]:
        r = ui_static(key, rel, crop=False)
        if r:
            ui["bars"][key] = r

    ui["buttons"] = {}
    for key, rel in [
        ("big_blue", "Buttons/BigBlueButton_Regular.png"),
        ("big_blue_p", "Buttons/BigBlueButton_Pressed.png"),
        ("big_red", "Buttons/BigRedButton_Regular.png"),
        ("big_red_p", "Buttons/BigRedButton_Pressed.png"),
        ("sq_blue", "Buttons/SmallBlueSquareButton_Regular.png"),
        ("sq_blue_p", "Buttons/SmallBlueSquareButton_Pressed.png"),
        ("sq_red", "Buttons/SmallRedSquareButton_Regular.png"),
        ("sq_red_p", "Buttons/SmallRedSquareButton_Pressed.png"),
        ("rd_blue", "Buttons/SmallBlueRoundButton_Regular.png"),
        ("rd_blue_p", "Buttons/SmallBlueRoundButton_Pressed.png"),
        ("rd_red", "Buttons/SmallRedRoundButton_Regular.png"),
        ("rd_red_p", "Buttons/SmallRedRoundButton_Pressed.png"),
    ]:
        r = ui_static(f"btn_{key}", rel, crop=False)
        if r:
            ui["buttons"][key] = r

    ui["icons"] = []
    for i in range(1, 13):
        p = os.path.join(uie, f"Icons/Icon_{i:02d}.png")
        if os.path.exists(p):
            img = crop_to_bbox(load(p))
            rel = f"ui/icon_{i:02d}.png"
            save(img, rel)
            ui["icons"].append(rel)

    ui["avatars"] = []
    for i in range(1, 26):
        p = os.path.join(uie, f"Human Avatars/Avatars_{i:02d}.png")
        if os.path.exists(p):
            img = crop_to_bbox(load(p))
            rel = f"ui/avatar_{i:02d}.png"
            save(img, rel)
            ui["avatars"].append(rel)

    ui["banner"] = ui_static("banner", "Banners/Banner.png", crop=False)
    ui["banner_slots"] = ui_static("banner_slots", "Banners/Banner_Slots.png", crop=False)
    ui["swords"] = ui_static("swords", "Swords/Swords.png", crop=False)
    ui["paper"] = ui_static("paper", "Papers/RegularPaper.png", crop=True)
    ui["paper_special"] = ui_static("paper_special", "Papers/SpecialPaper.png", crop=True)

    # ---- Special enemies (PixelFlush "Pixel Monsters Mega Pack") ----------
    # The pack ships every creature twice: a pre-exported horizontal PNG sheet
    # (pngs/<Name>.png) and a binary .aseprite source (aserprite/<Name>.aseprite)
    # whose header records the frame count (u16 @6) and square cell size
    # (u16 @8, u16 @10). We slice the PNG into exactly that many uniform frames
    # (never content-guessing), bottom-align + center them into one common cell
    # (feet anchoring), and save the frames under enemies/.
    import struct

    ENEMY = os.path.join(ROOT, "enemies", "PixelFlush - Pixel Monsters Mega Pack")
    special = manifest["special"] = {}

    # Pack entries the game does not field as enemies (no usable walk loop).
    ENEMY_SKIP = {"Forest Nymph Sitting"}

    # Pack sheets that ship a multi-variant COMPOSITE on a single canvas
    # (variant poses stacked on one canvas) instead of an animation sheet:
    # extract the usable row bands and build a walk loop from them.
    # key -> [(y0, y1, mirror), ...] on the full-width sheet.
    SPECIAL_FRAMES = {
        # Sandworm: three full-length worm poses stacked; mirror the two
        # head-right poses so the head faces the same way in every frame.
        "sandworm": [(15, 31, False), (32, 44, True), (49, 62, True)],
    }

    # Frames per second by frame count (1 = static idle).
    FPS_BY_FRAMES = {1: 10, 2: 7, 3: 9, 4: 11}

    def slugify(name):
        s = "".join(c if c.isalnum() else "_" for c in name.lower())
        return s.strip("_")

    def aseprite_meta(name):
        """(frames, cell_w, cell_h) from the pack's binary .aseprite header."""
        p = os.path.join(ENEMY, "aserprite", name + ".aseprite")
        with open(p, "rb") as f:
            d = f.read(16)
        frames, w, h = struct.unpack_from("<HHH", d, 6)
        return frames, w, h

    def special_sheet(key, name):
        p = os.path.join(ENEMY, "pngs", name + ".png")
        if not os.path.exists(p):
            print(f"  ! missing enemy sheet {name}.png")
            return
        im = load(p)
        if key in SPECIAL_FRAMES:
            frames = []
            for y0, y1, mirror in SPECIAL_FRAMES[key]:
                fr = im.crop((0, y0, im.width, y1 + 1))
                if mirror:
                    fr = fr.transpose(Image.FLIP_LEFT_RIGHT)
                frames.append(fr)
        else:
            frames_n, fw, fh = aseprite_meta(name)
            if im.size != (frames_n * fw, fh):
                print(f"  ! {name}: sheet {im.size} != {frames_n} frames x {fw}x{fh} per aseprite header")
                return
            frames = [im.crop((i * fw, 0, (i + 1) * fw, fh)) for i in range(frames_n)]
        cw, ch, cells = normalize_frames(frames)
        rels = []
        for i, cell in enumerate(cells):
            r = f"enemies/{key}_{i}.png"
            save(cell, r)
            rels.append(r)
        special[key] = {"frames": rels, "cell": [cw, ch],
                        "anchor": "bottom-center",
                        "fps": FPS_BY_FRAMES.get(len(frames), 10), "loop": True}

    for sheet in sorted(os.listdir(os.path.join(ENEMY, "pngs"))):
        if not sheet.endswith(".png"):
            continue
        name = sheet[:-4]
        if name in ENEMY_SKIP:
            continue
        special_sheet(slugify(name), name)

    print(f"  enemies: {len(special)} creatures from the PixelFlush Mega Pack")

    # ---- Wizard tower (animated building, 3 evolution tiers) --------------
    # "Stone Castle Evolution" pack (vendor/stone-castle): each tier is one
    # horizontal row of 48px-wide frames (idle loop, flag flutter).
    SC = os.path.join(ROOT, "vendor", "stone-castle")
    ab = manifest["animatedBuildings"]
    for lvl in (1, 2, 3):
        p = os.path.join(SC, f"WizardTowerLvl{lvl}.png")
        if not os.path.exists(p):
            print(f"  ! missing wizard tower sheet WizardTowerLvl{lvl}.png")
            continue
        frames = slice_uniform(load(p), 48)
        cw, ch, cells = normalize_frames(frames)
        key = f"wizard_lvl{lvl}"
        rels = [save(c, f"towers/{key}_{i}.png") for i, c in enumerate(cells)]
        ab[key] = {"frames": rels, "cell": [cw, ch], "anchor": "bottom-center", "fps": 5, "loop": True}

    # ---- audio (Free Fantasy SFX Pack, OGG) -------------------------------
    # Copy selected SFX and BGM loops into sound/ under short names.
    SFXPACK = os.path.join(ROOT, "Free Fantasy SFX Pack By TomMusic", "OGG Files")

    def copy_sound(dest_rel, src_rel):
        p = os.path.join(SFXPACK, src_rel)
        if not os.path.exists(p):
            print(f"  ! missing sound {src_rel}")
            return None
        d = os.path.join(OUT, dest_rel)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copyfile(p, d)
        return dest_rel

    # game sfx name -> source file in the pack
    sfx = {}
    SFX_MAP = {
        "shoot":     "SFX/Attacks/Bow Attacks Hits and Blocks/Bow Attack 1.ogg",
        "spear":     "SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 1.ogg",
        "cannon":    "SFX/Spells/Rock Meteor Throw 1.ogg",
        "explosion": "SFX/Spells/Spell Impact 1.ogg",
        "hit":       "SFX/Attacks/Bow Attacks Hits and Blocks/Bow Impact Hit 1.ogg",
        "die":       "SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 2.ogg",
        "coin":      "SFX/Doors Gates and Chests/Chest Open 1.ogg",
        "build":     "SFX/Chopping and Mining/chop 1.ogg",
        "upgrade":   "SFX/Spells/Firebuff 1.ogg",
        "sell":      "SFX/Attacks/Sword Attacks Hits and Blocks/Sword Sheath 1.ogg",
        "boon":      "SFX/Spells/Firebuff 2.ogg",
        "castle":    "SFX/Doors Gates and Chests/Gate Close.ogg",
        "wave":      "SFX/Attacks/Sword Attacks Hits and Blocks/Sword Unsheath 1.ogg",
        "over":      "SFX/Attacks/Sword Attacks Hits and Blocks/Sword Sheath 2.ogg",
    }
    for name, src in SFX_MAP.items():
        r = copy_sound(f"sound/sfx/{name}.ogg", src)
        if r:
            sfx[name] = r

    # background music loops: calm forest (default) + ominous cave (boss waves)
    music = {}
    MUSIC_MAP = {
        "forest": "BGS Loops/Forest Day/Forest Day.ogg",
        "cave":   "BGS Loops/Cave/Cave.ogg",
    }
    for key, src in MUSIC_MAP.items():
        r = copy_sound(f"sound/music/{key}.ogg", src)
        if r:
            music[key] = r

    # ---- audio (Kenney All-in-1, CC0 — curated picks in vendor/kenney) ----
    # UI polish + combat impacts + event jingles. Source layout:
    #   sfx/<file>.ogg, jingles/<file>.ogg, music/<file>.ogg
    def copy_kenney_sound(dest_rel, src_rel):
        p = os.path.join(KEN, src_rel)
        if not os.path.exists(p):
            print(f"  ! missing kenney sound {src_rel}")
            return None
        d = os.path.join(OUT, dest_rel)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copyfile(p, d)
        return dest_rel

    KENNEY_SFX = {
        # Replaces the synthesized "click" for every HUD interaction.
        "click":         "sfx/click_001.ogg",        # Interface Sounds
        "ui_confirm":    "sfx/confirmation_001.ogg", # Interface Sounds
        "ui_error":      "sfx/error_001.ogg",        # Interface Sounds
        "shatter":       "sfx/impactPlate_heavy_000.ogg",   # armor chip
        "shatter_break": "sfx/impactGlass_heavy_000.ogg",   # shatter pool broken
        "castle_hit":    "sfx/impactWood_heavy_000.ogg",    # castle takes damage
        "heavy_hit":     "sfx/impactPunch_heavy_000.ogg",   # boss/elite kill
        "jingle_clear":  "jingles/jingle_clear.ogg",        # Music Jingles (Retro)
    }
    for name, src in KENNEY_SFX.items():
        r = copy_kenney_sound(f"sound/sfx/{name}.ogg", src)
        if r:
            sfx[name] = r

    KENNEY_MUSIC = {
        "defeat": "music/defeat.ogg",  # Music Loops "Game Over" — run-over screen
    }
    for key, src in KENNEY_MUSIC.items():
        r = copy_kenney_sound(f"sound/music/{key}.ogg", src)
        if r:
            music[key] = r

    manifest["sound"] = {"sfx": sfx, "music": music}

    # ---- gear icons (FREE RPG Icon Pack - Accessories and Armor) ---------
    # Curated 30 icons for the equipment system (helm / armor / ring).
    GEARP = os.path.join(
        ROOT, "FREE RPG Icon Pack - 100+ Accessories and Armor - Clockwork Raven Studios", "64x64"
    )
    GEAR_TILES = {
        # archer
        "archer_sentinel": "tile007.png",  # white knight helm
        "archer_ranger": "tile010.png",    # red hood
        "archer_warden": "tile050.png",    # dark teal plate
        "archer_hunter": "tile048.png",    # white tunic
        "archer_eagle": "tile017.png",     # green ring
        "archer_swift": "tile020.png",     # gold ring
        # lancer
        "lancer_horned": "tile002.png",    # viking horn helm
        "lancer_crimson": "tile004.png",   # helm w/ red plume
        "lancer_vanguard": "tile055.png",  # brown leather X
        "lancer_surcoat": "tile074.png",   # white surcoat
        "lancer_warlord": "tile044.png",   # ring w/ pink gem
        "lancer_keen": "tile046.png",      # green ring
        # cannon
        "cannon_powder": "tile008.png",    # dark helm
        "cannon_fusilier": "tile009.png",  # darker helm
        "cannon_blast": "tile051.png",     # dark plate
        "cannon_brass": "tile099.png",     # green plate
        "cannon_salvage": "tile047.png",   # red lifebuoy ring
        "cannon_flint": "tile040.png",     # diamond ring
        # monastery
        "monastery_sage": "tile014.png",   # dark hood
        "monastery_pilgrim": "tile013.png",  # grey helm
        "monastery_benevolent": "tile097.png",  # pink robe
        "monastery_aura": "tile090.png",  # white vest
        "monastery_sanctum": "tile022.png",  # purple ring
        "monastery_glow": "tile023.png",  # ring w/ yellow gem
        # barracks
        "barracks_drill": "tile005.png",    # blue-plume helm
        "barracks_hawk": "tile006.png",     # silver knight helm
        "barracks_cuirass": "tile053.png",  # buckled cuirass
        "barracks_tunic": "tile049.png",    # white tunic
        "barracks_signet": "tile043.png",   # ring w/ red gem
        "barracks_loyal": "tile018.png",    # ring w/ pink gem
        # alchemist
        "alchemist_hood": "tile011.png",     # dark hood
        "alchemist_cowl": "tile015.png",     # dark cloak hood
        "alchemist_vest": "tile098.png",     # green ribbed vest
        "alchemist_robes": "tile100.png",    # green ribbed vest (alt)
        "alchemist_band": "tile012.png",     # dark gem ring
        "alchemist_signet": "tile027.png",   # green crystal ring
        # ballista
        "ballista_sallet": "tile001.png",    # horned steel helm
        "ballista_crest": "tile003.png",     # helm w/ red plume
        "ballista_plating": "tile052.png",   # dark ribbed plate
        "ballista_harness": "tile057.png",   # brown leather harness
        "ballista_sight": "tile041.png",     # gold ring w/ dark gem
        "ballista_windage": "tile042.png",   # ring w/ red+teal gems
    }
    gear_icons = {}
    for gid, tile in GEAR_TILES.items():
        p = os.path.join(GEARP, tile)
        if not os.path.exists(p):
            print(f"  ! missing gear icon {tile}")
            continue
        d = os.path.join(OUT, "gear", gid + ".png")
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copyfile(p, d)
        gear_icons[gid] = f"gear/{gid}.png"
    manifest["gear"] = {"icons": gear_icons}

    # Center-only parchment tiles: the 3×3 sheets carry per-cell padding,
    # so for small stretchable rows we emit the cropped center square.
    for key in ("paper", "paper_special"):
        p = os.path.join(OUT, f"ui/{key}.png")
        if not os.path.exists(p):
            continue
        sheet = load(p)
        cw = sheet.width // 3
        ch = sheet.height // 3
        center = sheet.crop((cw, ch, 2 * cw, 2 * ch))
        center = crop_to_bbox(center)
        out = f"ui/{key}_center.png"
        save(center, out)
        manifest["ui"][key + "_center"] = {
            "image": out,
            "size": [center.width, center.height],
            "anchor": "center",
        }

    # paper_special is a decorative tile sheet (grey corner brackets + edge
    # accent lines + plain center), not a 9-slice. Emit the individual tiles
    # so the HUD can place them discretely around a stretched center fill.
    ps = os.path.join(OUT, "ui/paper_special.png")
    if os.path.exists(ps):
        sheet = load(ps)
        cw = sheet.width // 3
        ch = sheet.height // 3
        for name, (c, r) in {
            "ps_corner_tl": (0, 0), "ps_corner_tr": (2, 0),
            "ps_edge_l": (0, 1), "ps_edge_r": (2, 1),
            "ps_edge_t": (1, 0), "ps_edge_b": (1, 2),
            "ps_corner_bl": (0, 2), "ps_corner_br": (2, 2),
        }.items():
            tile = crop_to_bbox(sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)))
            out = f"ui/{name}.png"
            save(tile, out)
            manifest["ui"][name] = {
                "image": out,
                "size": [tile.width, tile.height],
                "anchor": "center",
            }

    # ---- relic icons (same pack, repurposed for the Codex) ---------------
    # One icon per meta relic so the rune menu has life.
    RELIC_TILES = {
        "provisions": "tile026.png",  # red-trimmed boots — the long march
        "bastion": "tile050.png",     # dark plate — the fortress
        "armory": "tile004.png",      # helm w/ red plume — war
        "mint": "tile020.png",        # gold ring — wealth
        "sage": "tile010.png",        # red mage hood — insight
        "recruit": "tile002.png",     # viking horn helm — the old guard
        "quartermaster": "tile016.png",  # plain green ring — the steward's seal
        "lookouts": "tile014.png",    # grey cowl — watchful eyes
        "drums": "tile035.png",       # armored boots — the marching cadence
        "fortune": "tile021.png",     # gold amulet w/ red gem — the lucky charm
    }
    relic_icons = {}
    for rid, tile in RELIC_TILES.items():
        p = os.path.join(GEARP, tile)
        if not os.path.exists(p):
            print(f"  ! missing relic icon {tile}")
            continue
        d = os.path.join(OUT, "ui", f"relic_{rid}.png")
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copyfile(p, d)
        relic_icons[rid] = f"ui/relic_{rid}.png"
    manifest["relic_icons"] = relic_icons

    # ---- icons (Kenney All-in-1, CC0 — Game Icons white sheet) -----------
    # 50x50 flat white silhouettes matching the UI's visual language; tinted
    # at draw time. The sheet is a libGDX-style atlas: sheet_white1x.png +
    # sheet_white1x.xml. Also three standalone icons from Game Icons Expansion.
    import re as _re
    icons = {}
    sheet = os.path.join(KEN, "icons", "sheet_white1x.png")
    atlas = os.path.join(KEN, "icons", "sheet_white1x.xml")
    if os.path.exists(sheet) and os.path.exists(atlas):
        xml = open(atlas).read()
        regions = {
            m.group("name"): (int(m.group("x")), int(m.group("y")),
                              int(m.group("w")), int(m.group("h")))
            for m in _re.finditer(
                r'<SubTexture name="(?P<name>[^"]+)" x="(?P<x>\d+)" y="(?P<y>\d+)" '
                r'width="(?P<w>\d+)" height="(?P<h>\d+)"/>', xml)
        }
        img = load(sheet)
        # manifest key -> icon file name in the sheet
        icon_map = {
            # top-right panel buttons
            "pause": "pause.png", "stop": "stop.png",
            "fast_forward": "fastForward.png",
            "music_on": "musicOn.png", "music_off": "musicOff.png",
            "home": "home.png",
            "zoom_in": "zoomIn.png", "zoom_out": "zoomOut.png",
            # general UI
            "star": "star.png", "trophy": "trophy.png",
            "medal": "medal1.png", "medal2": "medal2.png",
            "plus": "plus.png", "minus": "minus.png",
            "check": "checkmark.png", "warning": "warning.png",
            "info": "information.png", "gear": "gear.png",
            "target": "target.png", "locked": "locked.png",
            "question": "question.png", "cross": "cross.png",
            # staged for roadmap work: wave-intel traits, weather, events
            "up": "up.png", "power": "power.png",
        }
        for key, fname in icon_map.items():
            if fname not in regions:
                print(f"  ! missing icon region {fname}")
                continue
            x, y, w, h = regions[fname]
            tile = crop_to_bbox(img.crop((x, y, x + w, y + h)))
            out = f"icons/{key}.png"
            save(tile, out)
            icons[key] = out
    else:
        print("  ! missing kenney icon sheet")
    # standalone expansion icons (individual files, already cropped)
    for key, fname in {"cloud": "cloud.png", "coin": "coin.png", "flag": "flag.png"}.items():
        p = os.path.join(KEN, "icons", fname)
        if not os.path.exists(p):
            print(f"  ! missing kenney icon {fname}")
            continue
        tile = crop_to_bbox(load(p))
        out = f"icons/{key}.png"
        save(tile, out)
        icons[key] = out
    manifest["icons"] = icons

    # Browser favicon — the gold coin, copied to the public root (NOT public/
    # assets, which this script wipes on every run).
    coin = os.path.join(OUT, "icons", "coin.png")
    if os.path.exists(coin):
        shutil.copyfile(coin, os.path.join(ROOT, "public", "favicon.png"))

    # ---- write manifest --------------------------------------------------
    mpath = os.path.join(OUT, "manifest.json")
    with open(mpath, "w") as f:
        json.dump(manifest, f, indent=1)

    # stats
    n_files = sum(len(fs) for _, _, fs in os.walk(OUT))
    print(f"Done. {n_files} files in {os.path.relpath(OUT, ROOT)}")
    print(f"  unit actions per color: { {u: len(a) for u, a in list(manifest['units']['blue'].items())} }")
    print(f"  fx: {list(manifest['fx'].keys())}")
    print(f"  ui icons: {len(manifest['ui'].get('icons', []))}, avatars: {len(manifest['ui'].get('avatars', []))}")
    snd = manifest.get("sound", {})
    print(f"  sound: {len(snd.get('sfx', {}))} sfx, {list(snd.get('music', {}).keys())} music")
    print(f"  gear: {len(manifest.get('gear', {}).get('icons', {}))} icons")
    print(f"  relic icons: {len(manifest.get('relic_icons', {}))}")
    print(f"  kenney icons: {len(manifest.get('icons', {}))}")


if __name__ == "__main__":
    main()
