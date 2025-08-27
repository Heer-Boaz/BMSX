import { $ } from '../../core/game';
import * as SpritesPipeline from '../2d/sprites_pipeline';
import { Atmosphere, registerAtmosphereHotkeys } from '../3d/atmosphere';
import { M4 } from '../3d/math3d';
import * as MeshPipeline from '../3d/mesh_pipeline';
import * as ParticlesPipeline from '../3d/particles_pipeline';
import * as SkyboxPipeline from '../3d/skybox_pipeline';
import { registerCRT } from '../post/crt_pipeline';
import { GameView } from '../view';
import { LightingSystem } from '../lighting/lightingsystem';
import { RenderGraphRuntime } from '../graph/rendergraph';
import { buildFrameGraph } from '../graph/build_framegraph';
import { RenderContext, RenderPassDef, RenderPassStateId, RenderPassStateRegistry, TextureHandle } from './pipeline_interfaces';
import { GraphicsPipelineManager } from './pipeline_manager';

export function getRenderContext(): RenderContext {
    const v = $.viewAs<GameView>() as unknown as RenderContext;
    return v;
}
const camRight = new Float32Array(3);
const camUp = new Float32Array(3);
// Dedicated state types for passes to eliminate 'any' casts
interface FogPipelineState { width: number; height: number; fog: unknown; }
interface SkyboxPipelineState { width: number; height: number; view: Float32Array; proj: Float32Array; tex: TextureHandle; }
interface MeshBatchPipelineState { width: number; height: number; camPos: any; viewProj: Float32Array; fog: unknown; lighting?: unknown; }
interface ParticlePipelineState { width: number; height: number; viewProj: Float32Array; camRight: Float32Array; camUp: Float32Array; }
interface SpritesPipelineState { width: number; height: number; baseWidth: number; baseHeight: number; }

export class PipelineRegistry {
    private passes: RenderPassDef[] = []; // Mutable list for ordering/scheduling

    constructor(private pm: GraphicsPipelineManager) { }

    registerBuiltin() {
        // Fog
        this.register({
            id: 'fog',
            label: 'fog',
            name: 'FogState',
            writesDepth: false,
            stateOnly: true,
            shouldExecute: () => Atmosphere.enableFog || Atmosphere.enableHeightFog || Atmosphere.enableHeightGradient,
            exec: () => { /* state only */ },
            prepare: (backend, _state) => {
                const gv = getRenderContext();
                const width = gv.viewportSize.x; const height = gv.viewportSize.y;
                registerAtmosphereHotkeys();
                const density = (() => {
                    const p = Atmosphere.progressFactor;
                    const anim = Atmosphere.enableAutoAnimation ? (0.5 - 0.5 * Math.cos(p * 6.28318530718)) : 0.0;
                    return Atmosphere.baseFogDensity + Atmosphere.dynamicFogDensity * anim;
                })();
                const fog: any = {
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
                this.setState('fog', { width, height, fog } as any);
            },
        });

        // Skybox
        this.register({
            id: 'skybox',
            label: 'skybox',
            name: 'Skybox',
            writesDepth: true,
            shouldExecute: () => !!$.model.activeCamera3D && !!SkyboxPipeline.skyboxKey,
            exec: (backend, fbo, s) => {
                const gl = (backend as any).gl as WebGL2RenderingContext;
                SkyboxPipeline.drawSkyboxWithState(gl, fbo as WebGLFramebuffer, s as SkyboxPipelineState);
            },
            prepare: (backend, _state) => {
                const gv = getRenderContext();
                const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
                const cam = $.model.activeCamera3D;
                if (!cam) return;
                const tex = $.texmanager.getTexture(SkyboxPipeline.skyboxKey) as TextureHandle | undefined;
                if (!tex) return;
                // Update state with dynamic data
                this.setState('skybox', { width, height, view: cam.skyboxView, proj: cam.projection, tex } as any);
            },
        });

        // Mesh batch
        this.register({
            id: 'meshbatch',
            label: 'meshbatch',
            name: 'Meshes',
            writesDepth: true,
            shouldExecute: () => (MeshPipeline.meshesToDraw?.length ?? 0) > 0,
            exec: (backend, fbo, s) => {
                const gl = (backend as any).gl as WebGL2RenderingContext;
                const state = s as MeshBatchPipelineState;
                MeshPipeline.renderMeshBatch(gl, fbo as WebGLFramebuffer, state.width, state.height, state);
            },
            prepare: (backend, _state) => {
                const gv = getRenderContext();
                const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
                const cam = $.model.activeCamera3D;
                if (!cam) return;
                const frameShared = this.getState('frame_shared') as { lighting?: unknown } | undefined;
                const fogStateHolder = this.getState('fog') as { fog?: any } | undefined;
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
                const meshState: MeshBatchPipelineState = {
                    width,
                    height,
                    camPos: cam.position,
                    viewProj: cam.viewProjection,
                    fog,
                    lighting: frameShared ? frameShared.lighting : undefined,
                };
                this.setState('meshbatch', meshState as any);
            },
        });

        // Particles
        this.register({
            id: 'particles',
            label: 'particles',
            name: 'Particles',
            writesDepth: true,
            shouldExecute: () => (ParticlesPipeline.particlesToDraw?.length ?? 0) > 0,
            exec: (backend, fbo, s) => {
                const gl = (backend as any).gl as WebGL2RenderingContext;
                const state = s as ParticlePipelineState;
                ParticlesPipeline.renderParticleBatch(gl, fbo as WebGLFramebuffer, state.width, state.height, state);
            },
            prepare: (backend, _state) => {
                const gv = getRenderContext();
                const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
                const cam = $.model.activeCamera3D;
                if (!cam) return;

                M4.viewRightUpInto(cam.view, camRight, camUp);
                this.setState('particles', { width, height, viewProj: cam.viewProjection, camRight, camUp } as any);
            },
        });

        // Sprites
        this.register({
            id: 'sprites',
            label: 'sprites',
            name: 'Sprites2D',
            writesDepth: true,
            exec: (backend, fbo, s) => {
                const gl = (backend as any).gl as WebGL2RenderingContext;
                const state = s as SpritesPipelineState;
                SpritesPipeline.renderSpriteBatch(gl, fbo as WebGLFramebuffer, state.width, state.height, state.baseWidth, state.baseHeight);
            },
            prepare: (backend, _state) => {
                const gv = getRenderContext();
                const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
                const baseW = gv.viewportSize.x;
                const baseH = gv.viewportSize.y;
                // Ensure size-dependent uniforms are up-to-date on resize
                try {
                    const gl = (backend as any).gl as WebGL2RenderingContext;
                    SpritesPipeline.setupDefaultUniformValues(gl, 1.0, [gv.offscreenCanvasSize.x, gv.offscreenCanvasSize.y] as unknown as [number, number]);
                    MeshPipeline.setDefaultUniformValues(gl, 1.0);
                } catch { /* ignore if not initialized yet */ }
                const spriteState: SpritesPipelineState = { width, height, baseWidth: baseW, baseHeight: baseH };
                this.setState('sprites', spriteState as any);
            },
        });

        // CRT
        registerCRT(this.pm); // Registers program + execution into PipelineManager
        // Also add a present-stage pass to the graph sequence (do not re-register into PM)
        this.insertPipelinePass({
            id: 'crt',
            label: 'crt',
            name: 'Present/CRT',
            present: true,
            exec: () => { /* delegated via this.pm by registry.execute */ },
            prepare: () => { /* state set in framegraph just-in-time */ },
        } as RenderPassDef, this.passes.length);

        // FrameShared
        this.register({
            id: 'frame_shared',
            label: 'frame_shared',
            name: 'FrameShared',
            stateOnly: true,
            exec: () => { /* populated per frame by graph */ }
        });
    }

    register(desc: RenderPassDef): void {
        this.passes.push(desc);
        this.pm.register(desc);
    }

    setState<PState extends RenderPassStateId>(id: PState, state: RenderPassStateRegistry[PState]): void { this.pm.setState(id, state); }
    getState<PState extends RenderPassStateId>(id: PState): RenderPassStateRegistry[PState] | undefined { return this.pm.getState(id); }
    execute(id: string, fbo: unknown): void { this.pm.execute(id, fbo); }
    has(id: string): boolean { return this.pm.has(id); }

    // Passes list access
    getPipelinePasses(): readonly RenderPassDef[] { return this.passes; }
    appendPipelinePass(pass: RenderPassDef): void { this.register(pass); }
    insertPipelinePass(pass: RenderPassDef, index: number): void {
        if (index < 0 || index > this.passes.length) index = this.passes.length;
        this.passes.splice(index, 0, pass);
        // Caller must ensure pass conforms to RegisteredPipeline if execution desired
    }
    replacePipelinePasses(mutator: (arr: RenderPassDef[]) => void): void { mutator(this.passes); }
    findPipelinePassIndex(id: string): number { return this.passes.findIndex(p => String(p.id) === id); }

    // Convenience: build render graph from current pass registry
    buildRenderGraph(view: RenderContext, lighting: LightingSystem): RenderGraphRuntime {
        return buildFrameGraph(view, lighting, this);
    }
}
