import { $ } from '../../core/game';
import * as SpritesPipeline from '../2d/sprites_pipeline';
import { Atmosphere, registerAtmosphereHotkeys } from '../3d/atmosphere';
import { M4 } from '../3d/math3d';
import * as MeshPipeline from '../3d/mesh_pipeline';
import * as ParticlesPipeline from '../3d/particles_pipeline';
import * as SkyboxPipeline from '../3d/skybox_pipeline';
import { registerCRT } from '../post/crt_pipeline';
import { GameView } from '../view';
import { GLView as WebGLRenderView } from '../view/render_view';
import { GPUBackend, PipelineId } from './interfaces';
import { PipelineManager } from './pipeline_manager';
import { FogState, FrameSharedState, MeshBatchState, ParticlesState, PipelineStates, SkyboxState, SpritesState } from './pipeline_types';

// Definieer een generieke texture-referentie
type GPUTextureRef = WebGLTexture | GPUTexture;

// Backend-agnostische RenderContext
export interface RenderContext {
    backendType: 'webgl2' | 'webgpu';
    offscreenCanvasSize: { x: number; y: number };
    getBackend(): GPUBackend;
    activeTexUnit: number | null; // Behoud voor WebGL2; WebGPU negeert dit
    bind2DTex(tex: GPUTextureRef | null): void;
    bindCubemapTex(tex: GPUTextureRef | null): void;
}

// Full render-view contract (BaseView + RenderContext) for internal narrowing
export type RenderViewLike = GameView & RenderContext;

export function getRenderContext(): RenderContext {
    const v = $.viewAs<GameView>() as unknown as RenderContext;
    return v;
}


// Local descriptor type for custom registration (shader optional)
export interface RuntimePipelineDescriptor<S> {
    id: string;
    vsCode?: string; fsCode?: string; uniforms?: string[];
    prepare?: (gl: WebGL2RenderingContext, state: S) => void;
    exec: (gl: WebGL2RenderingContext, fbo: WebGLFramebuffer | null, state: S) => void;
}

export class PipelineRegistry {
    constructor(private pm: PipelineManager) { }

    registerBuiltin() {
        // Skybox
        this.pm.register<SkyboxState>({ id: 'Skybox', exec: (gl, fbo, s) => { if (s) SkyboxPipeline.drawSkyboxWithState(gl, fbo, s); } });
        // Mesh batch
        this.pm.register<MeshBatchState>({ id: 'MeshBatch', exec: (gl, fbo, s) => { MeshPipeline.renderMeshBatch(gl, fbo, s.width, s.height, { width: s.width, height: s.height, camPos: s.view.camPos, viewProj: s.view.viewProj, fog: s.fog, lighting: s.lighting }); } });
        // Particles
        this.pm.register<ParticlesState>({ id: 'Particles', exec: (gl, fbo, s) => { ParticlesPipeline.renderParticleBatch(gl, fbo, s.width, s.height, s); } });
        // Sprites
        this.pm.register<SpritesState>({ id: 'Sprites', exec: (gl, fbo, s) => { SpritesPipeline.renderSpriteBatch(gl, fbo, s.width, s.height, s.baseWidth, s.baseHeight); } });
        // CRT
        registerCRT(this.pm);
        // Fog (state only)
        this.pm.register<FogState>({ id: 'Fog', exec: () => { /* state only */ } });
        // FrameShared (state only)
        this.pm.register<FrameSharedState>({ id: 'FrameShared', exec: () => { /* populated per frame by graph */ } });
    }

    register<S>(desc: RuntimePipelineDescriptor<S>): void { this.pm.register(desc); }
    setState<K extends keyof PipelineStates>(id: K, state: PipelineStates[K]): void { this.pm.setState(id, state); }
    getState<K extends keyof PipelineStates>(id: K): PipelineStates[K] | undefined { return this.pm.getState(id); }
    execute(id: string, fbo: WebGLFramebuffer | null): void { this.pm.execute(id, fbo); }
    has(id: string): boolean { return this.pm.has(id); }
}

// High-level pass descriptors (merged from prior separate file) ------------------
export interface PipelinePassDescriptor {
    id: PipelineId; name: string; writesDepth?: boolean; isStateOnly?: boolean; presentStage?: boolean; shouldExecute?(): boolean;
    prepare(view: Partial<WebGLRenderView>, ctx: { backend: GPUBackend; width: number; height: number; srcTex?: WebGLTexture | null }): void;
}
const particleCamRight = new Float32Array(3);
const particleCamUp = new Float32Array(3);

// Internal mutable list of pipeline passes (ROMs may mutate via exported helpers before graph build)
const pipelinePassesInternal: PipelinePassDescriptor[] = [
    {
        id: 'Fog',
        name: 'FogState',
        writesDepth: false,
        isStateOnly: true,
        shouldExecute: () => Atmosphere.enableFog || Atmosphere.enableHeightFog || Atmosphere.enableHeightGradient,
        prepare(_v, { backend, width, height }) {
            registerAtmosphereHotkeys();
            const fogState = {
                fogColor: Atmosphere.fogColor,
                fogDensity: (() => {
                    const p = Atmosphere.progressFactor;
                    const anim = Atmosphere.enableAutoAnimation ? (0.5 - 0.5 * Math.cos(p * 6.28318530718)) : 0.0;
                    return Atmosphere.baseFogDensity + Atmosphere.dynamicFogDensity * anim;
                })(),
                enableFog: Atmosphere.enableFog,
                fogMode: Atmosphere.fogMode,
                enableHeightFog: Atmosphere.enableHeightFog,
                heightFogStart: Atmosphere.heightFogStart,
                heightFogEnd: Atmosphere.heightFogEnd,
                heightLowColor: Atmosphere.heightLowColor,
                heightHighColor: Atmosphere.heightHighColor,
                heightMin: Atmosphere.heightMin,
                heightMax: Atmosphere.heightMax,
                enableHeightGradient: Atmosphere.enableHeightGradient,
            };

            backend.setPipelineState?.('Fog', { width, height, fog: fogState });
        },
    },

    {
        id: 'Skybox',
        name: 'Skybox',
        writesDepth: true,
        shouldExecute: () => !!$.model.activeCamera3D && !!SkyboxPipeline.skyboxKey,
        prepare(_v, { backend, width, height }) {
            const cam = $.model.activeCamera3D;
            if (!cam) return;
            const tex = $.texmanager.getTexture(SkyboxPipeline.skyboxKey) as WebGLTexture | undefined;
            if (!tex) return;
            backend.setPipelineState?.('Skybox', { view: cam.skyboxView, proj: cam.projection, tex, width, height });
        },
    },

    {
        id: 'MeshBatch',
        name: 'Meshes',
        writesDepth: true,
        shouldExecute: () => (MeshPipeline.meshesToDraw?.length ?? 0) > 0,
        prepare(_v, { backend, width, height }) {
            const cam = $.model.activeCamera3D;
            if (!cam) return;
            const frameShared = backend.getPipelineState?.('FrameShared') as { lighting?: unknown } | undefined;
            const fogStateHolder = backend.getPipelineState?.('Fog') as { fog?: any } | undefined;
            let fog = fogStateHolder?.fog;
            if (!fog) {
                const density = (() => {
                    const p = Atmosphere.progressFactor;
                    const anim = Atmosphere.enableAutoAnimation ? (0.5 - 0.5 * Math.cos(p * 6.28318530718)) : 0.0;
                    return Atmosphere.baseFogDensity + Atmosphere.dynamicFogDensity * anim;
                })();
                fog = {
                    fogColor: Atmosphere.fogColor,
                    fogDensity: density,
                    enableFog: Atmosphere.enableFog,
                    fogMode: Atmosphere.fogMode,
                    enableHeightFog: Atmosphere.enableHeightFog,
                    heightFogStart: Atmosphere.heightFogStart,
                    heightFogEnd: Atmosphere.heightFogEnd,
                    heightLowColor: Atmosphere.heightLowColor,
                    heightHighColor: Atmosphere.heightHighColor,
                    heightMin: Atmosphere.heightMin,
                    heightMax: Atmosphere.heightMax,
                    enableHeightGradient: Atmosphere.enableHeightGradient,
                };
            }

            backend.setPipelineState?.('MeshBatch', {
                width,
                height,
                view: { camPos: cam.position, viewProj: cam.viewProjection },
                lighting: frameShared ? frameShared.lighting : undefined,
                fog,
            });
        },
    },

    {
        id: 'Particles',
        name: 'Particles',
        writesDepth: true,
        shouldExecute: () => (ParticlesPipeline.particlesToDraw?.length ?? 0) > 0,
        prepare(_v, { backend, width, height }) {
            const cam = $.model.activeCamera3D;
            if (!cam) return;
            M4.viewRightUpInto(cam.view, particleCamRight, particleCamUp);
            backend.setPipelineState?.('Particles', { width, height, viewProj: cam.viewProjection, camRight: particleCamRight, camUp: particleCamUp });
        },
    },

    {
        id: 'Sprites',
        name: 'Sprites2D',
        writesDepth: true,
        prepare(v, { backend, width, height }) {
            const gv = v as WebGLRenderView | undefined;
            const baseW = gv?.viewportSize?.x ?? width / 2;
            const baseH = gv?.viewportSize?.y ?? height / 2;
            backend.setPipelineState?.('Sprites', { width, height, baseWidth: baseW, baseHeight: baseH });
        },
    },

    {
        id: 'CRT',
        name: 'CRTPost',
        writesDepth: false,
        presentStage: true,
        prepare(v, { backend, srcTex }) {
            const gv = v as WebGLRenderView | undefined;
            if (!gv) return;
            const colorTex = srcTex ?? gv.textures.post_processing_source_texture;
            backend.setPipelineState?.('CRT', {
                width: gv.offscreenCanvasSize.x,
                height: gv.offscreenCanvasSize.y,
                baseWidth: gv.viewportSize.x,
                baseHeight: gv.viewportSize.y,
                fragScale: gv.offscreenCanvasSize.x / gv.viewportSize.x,
                outWidth: gv.canvasSize.x,
                outHeight: gv.canvasSize.y,
                colorTex,
                options: {
                    applyNoise: gv.applyNoise,
                    applyColorBleed: gv.applyColorBleed,
                    applyScanlines: gv.applyScanlines,
                    applyBlur: gv.applyBlur,
                    applyGlow: gv.applyGlow,
                    applyFringing: gv.applyFringing,
                    noiseIntensity: gv.noiseIntensity,
                    colorBleed: gv.colorBleed,
                    blurIntensity: gv.blurIntensity,
                    glowColor: gv.glowColor,
                },
            });
        },
    },
];

export function getPipelinePasses(): readonly PipelinePassDescriptor[] { return pipelinePassesInternal; }
export function appendPipelinePass(pass: PipelinePassDescriptor): void { pipelinePassesInternal.push(pass); }
export function insertPipelinePass(pass: PipelinePassDescriptor, index: number): void { if (index < 0 || index > pipelinePassesInternal.length) index = pipelinePassesInternal.length; pipelinePassesInternal.splice(index, 0, pass); }
export function replacePipelinePasses(mutator: (arr: PipelinePassDescriptor[]) => void): void { mutator(pipelinePassesInternal); }
export function findPipelinePassIndex(id: string): number { return pipelinePassesInternal.findIndex(p => p.id === id); }
