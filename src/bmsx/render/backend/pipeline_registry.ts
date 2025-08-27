import { $ } from '../../core/game';
import * as SpritesPipeline from '../2d/sprites_pipeline';
import { Atmosphere, registerAtmosphereHotkeys } from '../3d/atmosphere';
import { M4 } from '../3d/math3d';
import * as MeshPipeline from '../3d/mesh_pipeline';
import * as ParticlesPipeline from '../3d/particles_pipeline';
import * as SkyboxPipeline from '../3d/skybox_pipeline';
import { registerCRT } from '../post/crt_pipeline';
import { GameView } from '../view';
import { LightingSystem, isAmbientLight } from '../lighting/lightingsystem';
import { RenderGraphRuntime } from '../graph/rendergraph';
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
            shouldExecute: () => {
                const gv = getRenderContext() as unknown as { renderer?: { queues?: { particles?: unknown[] } } };
                const qlen = (gv.renderer?.queues?.particles?.length ?? 0);
                const legacyLen = (ParticlesPipeline.particlesToDraw?.length ?? 0);
                return qlen > 0 || legacyLen > 0;
            },
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

    // Build render graph from current pass registry with Clear/Present wiring
    buildRenderGraph(view: RenderContext, lightingSystem: LightingSystem): RenderGraphRuntime {
        const rg = new RenderGraphRuntime(view.getBackend());
        let frameColorHandle: number | null = null;
        let frameDepthHandle: number | null = null;

        // Clear pass: create frame color/depth and export to backbuffer
        const DEBUG_FORCE_VISIBLE_CLEAR = false;
        rg.addPass({
            name: 'Clear',
            setup: (io) => {
                const color = io.createTex({ width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, name: 'FrameColor' });
                const depth = io.createTex({ width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, depth: true, name: 'FrameDepth' });
                const clearCol: [number, number, number, number] = DEBUG_FORCE_VISIBLE_CLEAR ? [1, 0, 1, 1] : [0, 0, 0, 1];
                io.writeTex(color, { clearColor: clearCol });
                io.writeTex(depth, { clearDepth: 1.0 });
                io.exportToBackbuffer(color);
                frameColorHandle = color;
                frameDepthHandle = depth;
                return null;
            },
            execute: () => { },
        });

        // Per-frame shared state aggregation (camera + lighting)
        rg.addPass({
            name: 'FrameSharedState',
            alwaysExecute: true,
            setup: () => null,
            execute: () => {
                const cam = $.model.activeCamera3D; if (!cam) return;
                const viewState = { camPos: cam.position, viewProj: cam.viewProjection, skyboxView: cam.skyboxView, proj: cam.projection };
                const maybeAmbient = $.model.ambientLight?.light;
                const lighting = lightingSystem.update(isAmbientLight(maybeAmbient) ? maybeAmbient : null);
                this.setState('frame_shared', { view: viewState, lighting } as any);
            }
        });

        // Build pass sequence from registry
        const passList = this.getPipelinePasses();
        for (const desc of passList) {
            const isPresent = !!desc.present;
            const isStateOnly = !!desc.stateOnly;
            rg.addPass({
                name: desc.name,
                alwaysExecute: isStateOnly,
                setup: (io) => {
                    if (!isPresent && !isStateOnly) {
                        if (frameColorHandle != null) io.writeTex(frameColorHandle);
                        if (desc.writesDepth && frameDepthHandle != null) io.writeTex(frameDepthHandle);
                    } else {
                        if (frameColorHandle != null) io.readTex(frameColorHandle);
                    }
                    return { width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, present: isPresent };
                },
                execute: (ctx, frame, data: { width: number; height: number; present: boolean }) => {
                    const willRun = !desc.shouldExecute || desc.shouldExecute();
                    if (!willRun) return;
                    if (data.present) {
                        const colorTex = frameColorHandle != null ? ctx.getTex(frameColorHandle) : null;
                        try {
                            this.setState('crt', {
                                width: view.offscreenCanvasSize.x,
                                height: view.offscreenCanvasSize.y,
                                baseWidth: view.viewportSize.x,
                                baseHeight: view.viewportSize.y,
                                colorTex,
                                options: (frame as any)['postFx']?.crt,
                            } as unknown);
                        } catch { /* ignore */ }
                        desc.prepare?.(ctx.backend, undefined);
                        this.execute(desc.id, null);
                    } else if (isStateOnly) {
                        desc.prepare?.(ctx.backend, undefined);
                    } else {
                        desc.prepare?.(ctx.backend, undefined);
                        if (frameColorHandle == null || frameDepthHandle == null) return;
                        this.execute(desc.id, ctx.getFBO(frameColorHandle, frameDepthHandle) as WebGLFramebuffer);
                    }
                }
            });
        }

        // Optional: quick validation similar to original
        try {
            const dummyFrame: any = { views: [], frameIndex: 0, time: 0, delta: 0 };
            rg.compile(dummyFrame);
            const texInfo = rg.getTextureDebugInfo();
            const frameColor = frameColorHandle != null ? texInfo.find(t => t.index === frameColorHandle) : texInfo.find(t => t.present);
            if (frameColor) {
                const writerNames = frameColor.writers.map(i => rg.getPassNames()[i]);
                const contentWriters = writerNames.filter(n => n !== 'Clear');
                if (contentWriters.length === 0) console.warn('Framegraph validation: Only Clear pass wrote to frame color.');
            }
        } catch { /* ignore */ }

        return rg;
    }
}
