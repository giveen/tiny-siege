#!/usr/bin/env python3
"""
Asset pipeline for Tiny Siege.

Reads the raw "Tiny Swords (Free Pack)" art and emits a clean, deterministic
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
        shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)

    manifest = {
        "tileSize": 64,
        "units": {},
        "buildings": {},
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

    # sheep: idle/grass static, move animated
    for name, fn in [("sheep_idle", "Meat/Sheep/Sheep_Idle.png"),
                     ("sheep_grass", "Meat/Sheep/Sheep_Grass.png")]:
        p = os.path.join(SRC, "Terrain", "Resources", fn)
        if os.path.exists(p):
            img = crop_to_bbox(load(p))
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

    # ---- Special enemies (external packs in ./enemies) --------------------
    ENEMY = os.path.join(ROOT, "enemies")
    special = manifest["special"] = {}

    def special_anim(key, rel, fps=10, loop=True):
        """Slice a horizontal sheet, normalize frames, save under enemies/."""
        p = os.path.join(ENEMY, rel)
        if not os.path.exists(p):
            print(f"  ! missing enemy sheet {rel}")
            return
        im = load(p)
        frames = slice_sheet(im)
        if len(frames) <= 1:
            frames = [im]
        cw, ch, cells = normalize_frames(frames)
        rels = []
        for i, cell in enumerate(cells):
            r = f"enemies/{key}_{i}.png"
            save(cell, r)
            rels.append(r)
        special[key] = {"frames": rels, "cell": [cw, ch],
                        "anchor": "bottom-center", "fps": fps, "loop": loop}

    def special_grid_row(key, sheet_rel, row, max_frames=None, fps=10):
        """Extract one animation row from a grid sheet (Minotaur)."""
        p = os.path.join(ENEMY, sheet_rel)
        im = load(p)
        H, W = im.height, im.width
        ROWS, COLS = 20, 9
        rh, chw = H / ROWS, W / COLS
        frames = []
        for c in range(COLS):
            cell = im.crop((int(c * chw), int(row * rh),
                            int((c + 1) * chw), int((row + 1) * rh)))
            if content_bbox(cell):
                frames.append(cell)
        if max_frames:
            frames = frames[:max_frames]
        cw, ch, cells = normalize_frames(frames)
        rels = []
        for i, cell in enumerate(cells):
            r = f"enemies/{key}_{i}.png"
            save(cell, r)
            rels.append(r)
        special[key] = {"frames": rels, "cell": [cw, ch],
                        "anchor": "bottom-center", "fps": fps, "loop": True}

    # Flying Demon — a hovering bat (flying enemy)
    special_anim("flydemon", "Flying Demon 2D Pixel Art/Sprites/with_outline/FLYING.png", fps=11)
    # Mushroom — a fast ground runner
    special_anim("mushroom", "Forest_Monsters_FREE/Mushroom/Mushroom without VFX/Mushroom-Run.png", fps=12)
    # Skeleton — a melee swordsman (two color variants)
    special_anim("skeleton_white",
        "Skeletons_Free_Pack/Skeleton_Sword/Skeleton_White/Skeleton_Without_VFX/Skeleton_01_White_Walk.png", fps=12)
    special_anim("skeleton_yellow",
        "Skeletons_Free_Pack/Skeleton_Sword/Skeleton_Yellow/Skeleton_Without_VFX/Skeleton_01_Yellow_Walk.png", fps=12)
    # Minotaur — the boss (walk row of the grid)
    special_grid_row("minotaur", "Minotaur - Sprite Sheet.png", row=1, fps=10)
    # Insects — small ground bugs (variable-width strips)
    special_anim("mantis", "Animated insect enemy assets/MantisMove.png", fps=13)
    special_anim("beetle", "Animated insect enemy assets/BeetleMove.png", fps=9)
    # Enemy3 — a second, smaller flying type
    special_anim("fly3", "FlyingForestEnemies_FREE/Enemy3/Enemy3-Movement-In-Animation/Enemy3-Fly.png", fps=11)

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


if __name__ == "__main__":
    main()
