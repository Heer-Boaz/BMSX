import { attach_components, GameObject, Identifier, insavegame, MeshObject, TextureHandle, TextureKey, TransformComponent, vec3arr } from '../bmsx';
import { particlesToDraw } from '../bmsx/render/3d/glview.particles';
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
            particlesToDraw.push({ position: s.pos, size: .5, color: s.color, texture: s.texture });
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
        public overrideColor?: [number, number, number, number],
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
