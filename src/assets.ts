// Loads the generated asset manifest + every image, and exposes typed accessors.

export type Anchor = "bottom-center" | "center";

export interface AssetDef {
  frames: string[];
  cell: [number, number];
  anchor: Anchor;
  fps?: number;
  loop?: boolean;
}

export interface StaticDef {
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
  /** Animated buildings (wizard tower evolution tiers): key -> looping frames. */
  animatedBuildings: Record<string, AssetDef>;
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
    water_rock: string[];
    sheep_idle: StaticDef;
    sheep_grass: StaticDef;
    sheep_move: AssetDef;
    goldstone: StaticDef;
  };
  /** Drifting atmosphere layer — not tied to any grid cell. */
  clouds: StaticDef[];
  fx: Record<string, AssetDef>;
  special: Record<string, AssetDef>;
  /** Audio (from the Free Fantasy SFX Pack): sfx name -> file, music key -> file. */
  sound?: {
    sfx: Record<string, string>;
    music: Record<string, string>;
  };
  /** Equipment icons (FREE RPG Icon Pack): gear def id -> file. */
  gear?: {
    icons: Record<string, string>;
  };
  /** Relic icons (same pack, repurposed): relic id -> file. */
  relic_icons?: Record<string, string>;
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
    /** Cropped center square of the 3×3 sheets — clean parchment fill. */
    paper_center?: StaticDef;
    paper_special_center?: StaticDef;
    /**
     * paper_special decorative tiles (the sheet is a tile set, not a 9-slice):
     * corner brackets + edge accent lines, placed discretely by the HUD.
     */
    ps_corner_tl?: StaticDef;
    ps_corner_tr?: StaticDef;
    ps_corner_bl?: StaticDef;
    ps_corner_br?: StaticDef;
    ps_edge_t?: StaticDef;
    ps_edge_b?: StaticDef;
    ps_edge_l?: StaticDef;
    ps_edge_r?: StaticDef;
  };
}

export const UNIT_COLORS = ["blue", "red", "black", "purple", "yellow"] as const;
export type UnitColor = (typeof UNIT_COLORS)[number];

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
    for (const def of Object.values(m.animatedBuildings)) def.frames.forEach(add);
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
    d.water_rock.forEach(add);
    add(d.sheep_idle.image);
    add(d.sheep_grass.image);
    d.sheep_move.frames.forEach(add);
    add(d.goldstone.image);
    m.clouds.forEach((c) => add(c.image));
    for (const f of Object.values(m.fx)) f.frames.forEach(add);
    for (const f of Object.values(m.special)) f.frames.forEach(add);
    Object.values(m.gear?.icons ?? {}).forEach(add);
    Object.values(m.relic_icons ?? {}).forEach(add);
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
    add(u.paper_center?.image);
    add(u.paper_special_center?.image);
    for (const k of ["ps_corner_tl", "ps_corner_tr", "ps_corner_bl", "ps_corner_br", "ps_edge_t", "ps_edge_b", "ps_edge_l", "ps_edge_r"] as const) {
      add(u[k]?.image);
    }
    return paths;
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const paths = [...this.collect()];
    let done = 0;
    // Bounded concurrency + retries. Firing every image at once (the old
    // behavior, ~1700 requests in one burst) trips GitHub Pages' edge
    // throttling and produces sporadic 503s; a single transient failure
    // used to reject the entire load. Load in small batches and retry each
    // image with backoff so one throttled request can't kill boot.
    const BATCH = 32;
    const MAX_ATTEMPTS = 4;
    const loadImage = (p: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const attempt = (n: number) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => {
            if (n >= MAX_ATTEMPTS) reject(new Error("Failed to load " + p));
            else setTimeout(() => attempt(n + 1), 250 * 2 ** (n - 1));
          };
          img.src = this.base + p;
        };
        attempt(1);
      });
    for (let i = 0; i < paths.length; i += BATCH) {
      const batch = paths.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (p) => {
          this.imgs.set(p, await loadImage(p));
          done++;
          onProgress?.(done, paths.length);
        })
      );
    }
  }

  img(path: string): HTMLImageElement {
    return this.imgs.get(path)!;
  }

  /** True once the image for this manifest path has finished loading. */
  has(path: string): boolean {
    return this.imgs.has(path);
  }

  // Convenience accessors ------------------------------------------------
  unit(color: string, unit: string, action: string): AssetDef {
    return this.manifest.units[color][unit][action];
  }

  building(color: string, name: string): StaticDef {
    return this.manifest.buildings[color][name];
  }

  animatedBuilding(name: string): AssetDef {
    return this.manifest.animatedBuildings[name];
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

export interface LoadHooks {
  /**
   * Fired once manifest.json has been parsed, before the first image resolves.
   * Receives the (partially populated) Assets so the caller can draw manifest
   * data / images that land early — the loading screen uses it to swap from
   * its vector placeholder to the real castle sprite as soon as it arrives.
   */
  onManifest?: (assets: Assets) => void;
  /** Fired after each image finishes loading. */
  onProgress?: (done: number, total: number) => void;
}

export async function loadAssets(base = "assets/", hooks: LoadHooks = {}): Promise<Assets> {
  const res = await fetch(base + "manifest.json");
  const manifest = (await res.json()) as Manifest;
  const assets = new Assets(manifest, base);
  hooks.onManifest?.(assets);
  await assets.load(hooks.onProgress);
  return assets;
}
