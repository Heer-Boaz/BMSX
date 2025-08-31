import { $, attach_components, CatmullRomPath, color_arr, GameObject, Identifier, insavegame, MeshObject, TextureHandle, TextureKey, TransformComponent, V3, vec3arr } from '../bmsx';
import { submitParticle } from '../bmsx/render/3d/particles_pipeline';
import { onload } from '../bmsx/serializer/gameserializer';
import { BitmapId, ModelId } from './resourceids';

@insavegame
@attach_components(TransformComponent)
export class Cube3D extends MeshObject {
    constructor() {
        super('cube');
        this.model_id = ModelId.cube;
    }

    override run(): void {
        this.updateComponentsWithTag('position_update_axis');
        super.run();
    }
}

@insavegame
@attach_components(TransformComponent)
export class SmallCube3D extends MeshObject {
    constructor(overrideTextureIndex?: number) {
        super(`smallCube${overrideTextureIndex ?? ''}`);
        this.model_id = ModelId.cube;
        if (overrideTextureIndex !== undefined) {
            const mesh = this.meshes[0];
            if (mesh?.material) {
                mesh.material.textures.albedo = overrideTextureIndex;
                $.texmanager.fetchModelTextures(this.meshModel).then(tex => {
                    mesh.material.gpuTextures.albedo = tex[overrideTextureIndex];
                });
            }
        }
        this.scale = [0.5, 0.5, 0.5];
    }

    override run(): void {
        this.updateComponentsWithTag('position_update_axis');
        super.run();
    }
}

@insavegame
@attach_components(TransformComponent)
export class AnimatedMorphSphere extends MeshObject {
    constructor() {
        super('animatedSphere');
        this.model_id = ModelId.animatedmorphsphere;
    }

    override run(): void {
        this.updateComponentsWithTag('position_update_axis');
        super.run();
    }
}

interface Spark {
    pos: vec3arr;
    vel: vec3arr;
    life: number;
    color: { r: number; g: number; b: number; a: number };
    texture?: TextureHandle;
}

@insavegame
export class SparkEmitter extends GameObject {
    private sparks: Spark[] = [];
    private textureKey: TextureKey;
    static readonly SPARK_LIFETIME = 100;
    private parent_id: Identifier;

    constructor(parent_id: Identifier) {
        super();
        this.parent_id = parent_id;
        // Request spark texture from Texture Manager
        this.textureKey = $.texmanager.acquireTexture(this.id, () => $.rompack.img[BitmapId.joystick1].imgbinYFlipped, undefined);
    }

    public override run(): void {
        const origin = $.getGameObject(this.parent_id);
        for (let i = 0; i < 3; i++) {
            const vel: vec3arr = [
                (Math.random() - 0.5) * 0.05,
                Math.random() * 0.05 + 0.02,
                (Math.random() - 0.5) * 0.05,
            ];
            for (let i = this.sparks.length - 1; i >= 0; i--) {
                const s = this.sparks[i];
                s.pos[0] += s.vel[0];
                s.pos[1] += s.vel[1];
                s.pos[2] += s.vel[2];
                s.vel[1] -= 0.003; // gravity
                s.life--;
                s.color.a = s.life / SparkEmitter.SPARK_LIFETIME;
                if (s.life <= 0) this.sparks.splice(i, 1);
            }
            this.sparks.push({
                pos: [origin.x, origin.y, origin.z] as vec3arr,
                vel,
                life: SparkEmitter.SPARK_LIFETIME,
                color: { r: 1, g: 0.8, b: 0.2, a: 1 },
                texture: $.texmanager.getTexture(this.textureKey),
            });
        }
    }

    public override paint(): void {
        for (const s of this.sparks) {
            submitParticle({ position: s.pos, size: .5, color: s.color, texture: s.texture });
        }
    }
}

// Append physics test objects
@insavegame
export class PhysTestFloor extends GameObject {
    constructor(public width = 50, public depth = 50) { super('physFloor'); }
}

@insavegame
export class PhysTestWall extends GameObject {
    // Provide defaults so Reviver (which calls ctor with no args) won't crash.
    constructor(public nameId: string = 'physTestWall', public wallSize: vec3arr = [1, 1, 1]) { super(nameId); }
}

@insavegame
export class PhysDynamicCube extends MeshObject {
    private static _counter = 0;
    constructor(public halfExtent = 0.5) {
        super(`physDynCube_${PhysDynamicCube._counter++}`);
        this.model_id = ModelId.cube;
        // Scale mesh so that its rendered half-extents match physics halfExtents (base cube assumed unit size +/-0.5)
        this.scale = [halfExtent * 2, halfExtent * 2, halfExtent * 2];
    }
}

@insavegame
export class PhysDynamicSphere extends MeshObject {
    private static _counter = 0;
    constructor(public radius = 0.5) {
        super(`physDynSphere_${PhysDynamicSphere._counter++}`);
        this.model_id = ModelId.animatedmorphsphere;
        // Scale mesh so rendered sphere radius matches physics radius
        this.scale = [radius * 2, radius * 2, radius * 2];
    }
}

@insavegame
export class PhysTriggerZone extends GameObject {
    constructor(public triggerSize: vec3arr = [1, 1, 1]) { super('physTrigger'); }
}

// Simple static box (visual + physics via PhysicsComponent attached externally)
@insavegame
export class PhysStaticBox extends MeshObject {
    private static _counter = 0;

    constructor(
        public halfExtents: vec3arr = [0.5, 0.5, 0.5],
        public nameId: string = `physStaticBox_${PhysStaticBox._counter++}`,
        /** Optionele override voor albedo atlas index */
        public albedoTextureIndex?: number,
        /** Optionele override voor normal atlas index */
        public normalTextureIndex?: number,
        /** Optionele override voor base color factor (rgba) */
        public overrideColor?: color_arr,
        /** Optionele override voor metallic en roughness */
        public metallicFactor?: number,
        public roughnessFactor?: number,
    ) {
        super(nameId);
        this.model_id = ModelId.cube;
        this.applyHalfExtentsToScale();
        // Direct overrides via engine API (persistable)
        this.applyOverrides();
    }
    private applyHalfExtentsToScale() {
        if (!this.halfExtents) return;
        const he = this.halfExtents;
        this.scale = [he[0] * 2, he[1] * 2, he[2] * 2];
    }
    private applyOverrides() {
        const mesh = this.meshes[0];
        if (!mesh) return;
        const overrides: any = {};
        if (this.albedoTextureIndex !== undefined) overrides.albedo = this.albedoTextureIndex;
        if (this.normalTextureIndex !== undefined) overrides.normal = this.normalTextureIndex;
        if (this.overrideColor) overrides.color = this.overrideColor;
        if (this.metallicFactor !== undefined) overrides.metallicFactor = this.metallicFactor;
        if (this.roughnessFactor !== undefined) overrides.roughnessFactor = this.roughnessFactor;
        if (Object.keys(overrides).length) this.setMaterialOverride(0, overrides);
    }
    @onload
    public rehydrateScale() { this.applyHalfExtentsToScale(); this.applyOverrides(); }
}

// Lightweight building mesh (uses dedicated building.gltf model) for procedural city; avoids PhysStaticBox overhead
@insavegame
export class BuildingMesh extends MeshObject {
    private static _counter = 0;
    constructor(public halfExtents: vec3arr = [0.5, 0.5, 0.5]) {
        super(`building_${BuildingMesh._counter++}`);
        // model id added to resourceids.ts (ModelId.building)
        // Use direct assignment like other mesh objects; fallback safety retained
        this.model_id = ModelId.building ?? ModelId.cube;
        this.scale = [halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2];
    }
}

// Procedural simple city block generator placing static boxes along rail flanks
// City generation configuration interfaces
export interface CitySilhouetteConfig {
    /** Inclusive start of u-range (0..1) */
    uStart?: number;
    /** Exclusive end of u-range (0..1) */
    uEnd?: number;
    /** Max lateral distance from rail center where buildings are spawned */
    lateralSpan?: number;
    /** Minimum building height */
    minHeight?: number;
    /** Maximum building height */
    maxHeight?: number;
    /** Probability per grid slot (0..1) */
    density?: number;
    /** Grid cell size */
    gridSize?: number;
    /** Minimal lateral distance of first building row (default = gridSize * 0.5) */
    nearOffset?: number;
    /** Optional custom color palette (rgba). If omitted random neutral palette used */
    palette?: color_arr[];
    /** Optional min fraction of gridSize used for X/Z footprint (default 0.45) */
    footprintMinFactor?: number;
    /** Optional max fraction of gridSize used for X/Z footprint (default 0.70) */
    footprintMaxFactor?: number;
}

export interface SpawnCityOptions extends CitySilhouetteConfig {
    /** Deterministic seed (number or string). If omitted uses Math.random */
    seed?: number | string;
    /** Total number of rail samples for placement */
    steps?: number;
    /** When provided, overrides top-level silhouette settings with per-segment configs */
    silhouettes?: CitySilhouetteConfig[];
    /** Ensure we spawn at least some near buildings early for visibility */
    ensureVisible?: boolean;
    /** Log summary to console */
    debugLog?: boolean;
    /** Uniform world scale multiplier to blow up whole city */
    worldScale?: number;
}

// Simple mulberry32 PRNG for deterministic layout
function createMulberry32(seed: number) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeed(seed: number | string): number {
    if (typeof seed === 'number') return seed;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * Spawn a procedural city around a rail path. Deterministic when a seed is supplied.
 * Supports multiple silhouette segments each with varying density / height / span.
 */
export function spawnSimpleCity(rail: CatmullRomPath, options: SpawnCityOptions = {}): void {
    const {
        seed, steps = 160, silhouettes, debugLog,
        ensureVisible = true,
        worldScale = 1,
    } = options; // higher default steps for horizon-scale city density

    const rng = seed !== undefined ? createMulberry32(hashSeed(seed)) : Math.random;

    const segs: CitySilhouetteConfig[] = silhouettes && silhouettes.length
        ? silhouettes
        : [options]; // treat top-level as single silhouette

    // Normalize segments (fill defaults & clamp ranges)
    for (const seg of segs) {
        if (seg.uStart === undefined) seg.uStart = 0;
        if (seg.uEnd === undefined) seg.uEnd = 1;
        if (seg.uStart < 0) seg.uStart = 0; if (seg.uEnd > 1) seg.uEnd = 1;
        if (seg.uEnd < seg.uStart) [seg.uStart, seg.uEnd] = [seg.uEnd, seg.uStart];
        if (!seg.gridSize) seg.gridSize = 8;
        if (seg.nearOffset === undefined) seg.nearOffset = seg.gridSize * 0.5;
        if (seg.lateralSpan === undefined) seg.lateralSpan = 50;
        if (seg.minHeight === undefined) seg.minHeight = 6;
        if (seg.maxHeight === undefined) seg.maxHeight = 28;
        if (seg.density === undefined) seg.density = 0.5;
        if (seg.footprintMinFactor === undefined) seg.footprintMinFactor = 0.45;
        if (seg.footprintMaxFactor === undefined) seg.footprintMaxFactor = 0.70;
    }

    const samples = Array.from({ length: steps + 1 }, (_, i) => ({ u: i / steps, s: rail.sample(i / steps) }));
    let totalSpawned = 0;
    let skippedDuplicates = 0;
    // World-space occupancy set to avoid spawning multiple buildings in the same grid cell (which caused heavy z-fighting / garbled look)
    // Keying strategy: quantize X/Z to grid cells per segment gridSize (we'll use the candidate segment's gridSize when generating key)
    const occupied = new Set<string>();
    // Pass 1: iterate segments
    let segIndex = 0;
    for (const seg of segs) {
        const { uStart = 0, uEnd = 1, lateralSpan = 50, minHeight = 6, maxHeight = 28, density = 0.5, gridSize = 8, nearOffset = gridSize * 0.5, palette } = seg;
        const gSize = gridSize * worldScale;
        const nOffset = nearOffset * worldScale;
        const effectiveLateralSpan = lateralSpan * (1 + segIndex * 0.15) * worldScale; // gradually widen span for later segments & scale
        const minH = minHeight * worldScale;
        const maxH = maxHeight * worldScale;
        for (const { u, s } of samples) {
            if (u < uStart || u >= uEnd) continue;
            const f = s.fwd;
            const rightLen = Math.hypot(f.z, f.x) || 1;
            const rx = f.z / rightLen; const rz = -f.x / rightLen;
            for (const side of [-1, 1] as const) {
                for (let dist = nOffset; dist <= effectiveLateralSpan; dist += gSize) {
                    // Instead of spawning multiple longitudinal jitter variants per sample (which caused massive overdraw),
                    // we quantize forward progress into grid cells using the sample's position projected onto the rail forward.
                    if (rng() > density) continue;
                    const px = s.p.x + rx * dist * side;
                    const pz = s.p.z + rz * dist * side;
                    const cellX = Math.round(px / gSize);
                    const cellZ = Math.round(pz / gSize);
                    const key = cellX + ':' + cellZ; // coarse world grid
                    if (occupied.has(key)) { skippedDuplicates++; continue; }
                    occupied.add(key);
                    const height = minH + rng() * (maxH - minH);
                    const fMin = seg.footprintMinFactor ?? 0.45;
                    const fMax = seg.footprintMaxFactor ?? 0.70;
                    const fRange = Math.max(0.01, fMax - fMin);
                    const footprintScaleX = gSize * (fMin + rng() * fRange);
                    const footprintScaleZ = gSize * (fMin + rng() * fRange);
                    const he: [number, number, number] = [footprintScaleX, height * 0.5, footprintScaleZ];
                    const box = new BuildingMesh([he[0], he[1], he[2]]);
                    const topY = s.p.y + he[1] * 2;
                    $.model.spawn(box, V3.of(px, s.p.y + he[1], pz));
                    // Color selection
                    if (palette && palette.length) {
                        const col = palette[Math.floor(rng() * palette.length)];
                        box.setMaterialOverride(0, { color: col });
                    } else {
                        const base = 0.50 + rng() * 0.40; // neutral brightness
                        const accent = base * (0.85 + rng() * 0.25);
                        box.setMaterialOverride(0, { color: [base, accent, base * 0.75, 1] });
                    }
                    totalSpawned++;
                }
            }
        }
        segIndex++;
    }

    if (ensureVisible && totalSpawned === 0) {
        // Fallback: spawn a tiny cluster near the first sample so player sees something
        const first = samples[0].s;
        for (let i = 0; i < 6; i++) {
            const h = (8 + rng() * 12) * worldScale;
            const he: [number, number, number] = [(2 + rng() * 2) * worldScale, h * 0.5, (2 + rng() * 2) * worldScale];
            const box = new BuildingMesh([he[0], he[1], he[2]]);
            const topY = first.p.y + he[1] * 2;
            $.model.spawn(box, V3.of(first.p.x + (i - 3) * 4, first.p.y + he[1], first.p.z - 6 - rng() * 6));
        }
    }
    if (debugLog) console.log('[CityGen] spawned buildings:', totalSpawned, 'segments:', segs.length, 'seed:', seed, 'skippedDuplicates:', skippedDuplicates, 'cells:', occupied.size, 'worldScale:', worldScale);
}
