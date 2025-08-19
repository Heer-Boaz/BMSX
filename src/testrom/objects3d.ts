import { attach_components, Component, componenttags_postprocessing, ComponentUpdateParams, GameObject, Identifier, insavegame, MeshObject, TextureHandle, TextureKey, TransformComponent, vec3arr } from '../bmsx';
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

@componenttags_postprocessing('position_update_axis')
export class SparkEmitter extends Component {
    private sparks: Spark[] = [];
    private textureKey: TextureKey;
    static readonly SPARK_LIFETIME = 100;

    constructor(parent_id: Identifier) {
        super(parent_id);
        // Request spark texture from Texture Manager
        this.textureKey = $.texmanager.acquireTexture(this.id, () => $.rompack.img[BitmapId.joystick1].imgbin, {}, undefined);
    }

    override postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void {
        super.postprocessingUpdate({ params, returnvalue });
        this.spawnSparks();
        this.updateSparks();
    }

    private spawnSparks(): void {
        const origin = this.parentAs<GameObject>().pos;
        for (let i = 0; i < 3; i++) {
            const vel: vec3arr = [
                (Math.random() - 0.5) * 0.05,
                Math.random() * 0.05 + 0.02,
                (Math.random() - 0.5) * 0.05,
            ];
            this.sparks.push({
                pos: [origin.x, origin.y, origin.z] as vec3arr,
                vel,
                life: SparkEmitter.SPARK_LIFETIME,
                color: { r: 1, g: 0.8, b: 0.2, a: 1 },
            });
        }
    }

    private updateSparks(): void {
        for (let i = this.sparks.length - 1; i >= 0; i--) {
            const s = this.sparks[i];
            s.pos[0] += s.vel[0];
            s.pos[1] += s.vel[1];
            s.pos[2] += s.vel[2];
            s.vel[1] -= 0.003; // gravity
            s.life--;
            s.color.a = s.life / SparkEmitter.SPARK_LIFETIME;
            const texture = $.texmanager.getTexture(this.textureKey);
            particlesToDraw.push({ position: s.pos, size: 4, color: s.color, texture });
            if (s.life <= 0) this.sparks.splice(i, 1);
        }
    }
}
