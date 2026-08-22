// Loads the generated asset manifest + every image, and exposes typed accessors.

export type Anchor = "bottom-center" | "center";

export interface AssetDef {
  frames: string[];
  cell: [number, number];
  anchor: Anchor;
  fps?: number;
  loop?: boolean;
}

interface StaticDef {
  image: string;
  size: [number, number];
  anchor: Anchor;
}

interface UnitActions {
  [action: string]: AssetDef;
}

export interface Manifest {
  tileSize: number;
  units: Record<string, Record<string, UnitActions>>;
  buildings: Record<string, Record<string, StaticDef>>;
  tiles: {
    grass: string[][]; // grass[r][c]
    grass_var: string[];
    corners: Record<string, string>;
    water: string;
    waterfoam: string;
  };
  deco: {
    tree: string[];
    stump: string[];
    bush: string[];
    rock: string[];
    duck: string[];
    sheep_idle: StaticDef;
    sheep_grass: StaticDef;
    sheep_move: AssetDef;
    goldstone: StaticDef;
  };
  fx: Record<string, AssetDef>;
  special: Record<string, AssetDef>;
  /** Audio (from the Free Fantasy SFX Pack): sfx name -> file, music key -> file. */
  sound?: {
    sfx: Record<string, string>;
    music: Record<string, string>;
  };
  ui: {
    bars: Record<string, StaticDef>;
    buttons: Record<string, StaticDef>;
    icons: string[];
    avatars: string[];
    banner: StaticDef;
    banner_slots: StaticDef;
    swords: StaticDef;
    paper: StaticDef;
    paper_special: StaticDef;
  };
}

export const UNIT_COLORS = ["blue", "red", "black", "purple", "yellow"] as const;
export type UnitColor = (typeof UNIT_COLORS)[number];
export const ENEMY_COLORS: UnitColor[] = ["red", "black", "purple", "yellow"];

export class Assets {
  manifest: Manifest;
  private imgs = new Map<string, HTMLImageElement>();
  private base: string;

  constructor(manifest: Manifest, base: string) {
    this.manifest = manifest;
    this.base = base;
  }

  private collect(): Set<string> {
    const paths = new Set<string>();
    const m = this.manifest;
    const add = (p?: string) => {
      if (p) paths.add(p);
    };
    for (const color of Object.values(m.units))
      for (const unit of Object.values(color))
        for (const def of Object.values(unit)) def.frames.forEach(add);
    for (const color of Object.values(m.buildings))
      for (const b of Object.values(color)) add(b.image);
    m.tiles.grass.flat().forEach(add);
    m.tiles.grass_var.forEach(add);
    Object.values(m.tiles.corners).forEach(add);
    add(m.tiles.water);
    add(m.tiles.waterfoam);
    const d = m.deco;
    d.tree.forEach(add);
    d.stump.forEach(add);
    d.bush.forEach(add);
    d.rock.forEach(add);
    d.duck.forEach(add);
    add(d.sheep_idle.image);
    add(d.sheep_grass.image);
    d.sheep_move.frames.forEach(add);
    add(d.goldstone.image);
    for (const f of Object.values(m.fx)) f.frames.forEach(add);
    for (const f of Object.values(m.special)) f.frames.forEach(add);
    const u = m.ui;
    for (const b of Object.values(u.bars)) add(b.image);
    for (const b of Object.values(u.buttons)) add(b.image);
    u.icons.forEach(add);
    u.avatars.forEach(add);
    add(u.banner.image);
    add(u.banner_slots.image);
    add(u.swords.image);
    add(u.paper.image);
    add(u.paper_special.image);
    return paths;
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const paths = [...this.collect()];
    let done = 0;
    await Promise.all(
      paths.map((p) =>
        new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            this.imgs.set(p, img);
            done++;
            onProgress?.(done, paths.length);
            resolve();
          };
          img.onerror = () => reject(new Error("Failed to load " + p));
          img.src = this.base + p;
        })
      )
    );
  }

  img(path: string): HTMLImageElement {
    return this.imgs.get(path)!;
  }

  // Convenience accessors ------------------------------------------------
  unit(color: string, unit: string, action: string): AssetDef {
    return this.manifest.units[color][unit][action];
  }

  building(color: string, name: string): StaticDef {
    return this.manifest.buildings[color][name];
  }

  grassTile(r: number, c: number): HTMLImageElement {
    return this.img(this.manifest.tiles.grass[r][c]);
  }

  special(key: string): AssetDef {
    return this.manifest.special[key];
  }
}

/** Wrap a one-image static def so it can be drawn by the sprite helpers. */
export function asAsset(def: StaticDef): AssetDef {
  return { frames: [def.image], cell: def.size, anchor: def.anchor };
}

export async function loadAssets(base = "assets/"): Promise<Assets> {
  const res = await fetch(base + "manifest.json");
  const manifest = (await res.json()) as Manifest;
  const assets = new Assets(manifest, base);
  await assets.load();
  return assets;
}
