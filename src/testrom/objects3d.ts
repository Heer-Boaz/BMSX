import { attach_components, GameObject, Identifier, insavegame, MeshObject, TextureHandle, TextureKey, TransformComponent, vec3arr } from '../bmsx';
import { particlesToDraw } from '../bmsx/render/3d/glview.particles';
import { BitmapId, ModelId } from './resourceids';

@insavegame
@attach_components(TransformComponent)
export class Cube3D extends MeshObject {
    constructor() {
        super('cube');
        this.model_id = ModelId.cube;
    }

    override run(): void {
        this.rotation[1] += 0.005; // Slow auto rotation
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
        this.rotation[0] += 0.01;
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
        this.rotation[1] += 0.01; // Slow auto rotation
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

export class SparkEmitter extends GameObject {
    private sparks: Spark[] = [];
    private textureKey: TextureKey;
    static readonly SPARK_LIFETIME = 100;
    private parent_id: Identifier;

    constructor(parent_id: Identifier) {
        super();
        this.parent_id = parent_id;
        // Request spark texture from Texture Manager
        this.textureKey = $.texmanager.acquireTexture(this.id, () => $.rompack.img[BitmapId.joystick1].imgbin, {}, undefined);
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
            particlesToDraw.push({ position: s.pos, size: 4, color: s.color, texture: s.texture });
        }
    }
}
