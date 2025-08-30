import { $ } from '../../core/game';
import { color_arr } from '../../rompack/rompack';
import { registerSpritesPass_WebGL } from '../2d/sprites_pipeline';
import { registerSpritesPass_WebGPU } from '../2d/sprites_pipeline.wgpu';
import { Atmosphere, registerAtmosphereHotkeys } from '../3d/atmosphere';
import * as MeshPipeline from '../3d/mesh_pipeline';
import { registerMeshBatchPass_WebGL } from '../3d/mesh_pipeline';
import { registerMeshBatchPass_WebGPU } from '../3d/mesh_pipeline.wgpu';
import { registerParticlesPass_WebGL } from '../3d/particles_pipeline';
import { registerParticlesPass_WebGPU } from '../3d/particles_pipeline.wgpu';
import { registerSkyboxPass_WebGL } from '../3d/skybox_pipeline';
import { registerSkyboxPass_WebGPU } from '../3d/skybox_pipeline.wgpu';
import { RenderGraphRuntime } from '../graph/rendergraph';
import { LightingSystem, isAmbientLight } from '../lighting/lightingsystem';
import { registerCRT_WebGL } from '../post/crt_pipeline';
import { registerCRT_WebGPU } from '../post/crt_pipeline.wgpu';
import { GameView } from '../view';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from './frame_uniforms';
import { GPUBackend, PassEncoder, RenderContext, RenderPassDef, RenderPassDesc, RenderPassInstanceHandle, RenderPassStateId, TextureHandle } from './pipeline_interfaces';
import { checkWebGLError } from './webgl.helpers';

export type FogUniforms = {
    fogColor: [number, number, number];
    fogDensity: number;
    enableFog: boolean;
    fogMode: 0 | 1;
    enableHeightFog: boolean;
    heightFogStart: number;
    heightFogEnd: number;
    heightLowColor: [number, number, number];
    heightHighColor: [number, number, number];
    heightMin: number;
    heightMax: number;
    enableHeightGradient: boolean;
};
export interface FogPipelineState { width: number; height: number; fog: FogUniforms; }
export interface SkyboxPipelineState { width: number; height: number; view: Float32Array; proj: Float32Array; tex: TextureHandle; }
export interface MeshBatchPipelineState { width: number; height: number; camPos: Float32Array | { x: number; y: number; z: number }; viewProj: Float32Array; fog: FogUniforms; lighting?: unknown; }
export interface ParticlePipelineState { width: number; height: number; viewProj: Float32Array; camRight: Float32Array; camUp: Float32Array; }
export interface SpritesPipelineState { width: number; height: number; baseWidth: number; baseHeight: number; atlasTex?: TextureHandle | null; atlasDynamicTex?: TextureHandle | null; }
export interface CRTPipelineState { width: number; height: number; baseWidth: number; baseHeight: number; colorTex: TextureHandle | null; options?: unknown; }
export interface FrameSharedState { view: { camPos: Float32Array | { x: number; y: number; z: number }; viewProj: Float32Array; skyboxView: Float32Array; proj: Float32Array }; lighting: unknown }

// Type-safe pass state map used by this registry (compile-time only)
type PassStateTypes = {
    fog: FogPipelineState;
    skybox: SkyboxPipelineState;
    meshbatch: MeshBatchPipelineState;
    particles: ParticlePipelineState;
    sprites: SpritesPipelineState;
    crt: CRTPipelineState;
    frame_shared: FrameSharedState;
    frame_resolve: undefined;
}

interface RegisteredPassRec {
    id: string;
    exec: (backend: GPUBackend, fbo: unknown, state: unknown) => void;
    prepare?: (backend: GPUBackend, state: unknown) => void;
    pipelineHandle?: RenderPassInstanceHandle | null;
    state?: unknown;
    bindingLayout?: RenderPassDef['bindingLayout'];
    present?: boolean;
}

export class RenderPassLibrary {
    private passes: RenderPassDef[] = []; // Mutable list for ordering/scheduling
    private passEnabled = new Map<string, boolean>();
    private registered = new Map<string, RegisteredPassRec>();

    constructor(private backend: GPUBackend) { }

    registerBuiltin(backend: GPUBackend) {
        switch (backend.type) {
            case 'webgl2':
                this.registerBuiltinPassesWebGL();
                break;
            case 'webgpu':
                this.registerBuiltinPassesWebGPU();
                break;
        }
    }

    private registerBuiltinPassesWebGPU() {
        // Common state-only passes (backend-agnostic)
        this.register({
            id: 'frame_resolve', label: 'frame_resolve', name: 'FrameResolve', stateOnly: true,
            exec: () => { /* state only */ },
            prepare: (backend, _state) => {
                const gv = $.viewAs<GameView>();
                updateAndBindFrameUniforms(backend, {
                    offscreen: { x: gv.offscreenCanvasSize.x, y: gv.offscreenCanvasSize.y },
                    logical: { x: gv.viewportSize.x, y: gv.viewportSize.y },
                });
            },
        });
        this.register({
            id: 'fog', label: 'fog', name: 'FogState', writesDepth: false, stateOnly: true,
            shouldExecute: () => Atmosphere.enableFog || Atmosphere.enableHeightFog || Atmosphere.enableHeightGradient,
            exec: () => { /* state only */ },
            prepare: (_backend, _state) => {
                const gv = $.viewAs<GameView>();
                const width = gv.viewportSize.x; const height = gv.viewportSize.y;
                registerAtmosphereHotkeys();
                const density = (() => {
                    const p = Atmosphere.progressFactor;
                    const anim = Atmosphere.enableAutoAnimation ? (0.5 - 0.5 * Math.cos(p * 6.28318530718)) : 0.0;
                    return Atmosphere.baseFogDensity + Atmosphere.dynamicFogDensity * anim;
                })();
                const fog: FogUniforms = {
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
                this.setState('fog', { width, height, fog });
            },
        });
        this.register({ id: 'frame_shared', label: 'frame_shared', name: 'FrameShared', stateOnly: true, exec: () => { } });
        // Backend-specific pass registrations (stubs for now)
        registerSkyboxPass_WebGPU(this);
        registerMeshBatchPass_WebGPU(this);
        registerParticlesPass_WebGPU(this);
        registerSpritesPass_WebGPU(this);
        registerCRT_WebGPU(this);
    }

    private registerBuiltinPassesWebGL() {
        // FrameResolve: set per-frame default uniforms shared across passes (sprite + mesh)
        this.register({
            id: 'frame_resolve',
            label: 'frame_resolve',
            name: 'FrameResolve',
            stateOnly: true,
            exec: () => { /* state only */ },
            prepare: (backend, _state) => {
                // Upload minimal frame-shared values via a UBO foundation
                const gv = $.viewAs<GameView>();
                updateAndBindFrameUniforms(backend, {
                    offscreen: { x: gv.offscreenCanvasSize.x, y: gv.offscreenCanvasSize.y },
                    logical: { x: gv.viewportSize.x, y: gv.viewportSize.y },
                });
            },
        });
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
                const gv = $.viewAs<GameView>();
                const width = gv.viewportSize.x; const height = gv.viewportSize.y;
                registerAtmosphereHotkeys();
                const density = (() => {
                    const p = Atmosphere.progressFactor;
                    const anim = Atmosphere.enableAutoAnimation ? (0.5 - 0.5 * Math.cos(p * 6.28318530718)) : 0.0;
                    return Atmosphere.baseFogDensity + Atmosphere.dynamicFogDensity * anim;
                })();
                const fog: FogUniforms = {
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
                this.setState('fog', { width, height, fog });
            },
        });

        // Skybox (WebGPU)
        registerSkyboxPass_WebGL(this);

        // Mesh batch (WebGPU)
        registerMeshBatchPass_WebGL(this);

        // Particles (WebGPU)
        registerParticlesPass_WebGL(this);

        // Sprites (WebGL)
        registerSpritesPass_WebGL(this);

        // Debug solid writer (WebGL) — ensures content is written before present
        // registerSolidColorPass_WebGL(this);

        // CRT (WebGL)
        registerCRT_WebGL(this); // Registers program + execution

        // FrameShared
        this.register({
            id: 'frame_shared',
            label: 'frame_shared',
            name: 'FrameShared',
            stateOnly: true,
            exec: () => { /* populated per frame by graph */ }
        });
    }

    public validatePassResources(passId: string, backend: unknown): void {
        let pass: RenderPassDef | undefined;
        try {
            const idx = this.findPipelinePassIndex(passId);
            if (idx < 0) return;
            pass = this.passes[idx];
            const layout = pass.bindingLayout; if (!layout) return;
            const gv = $.viewAs<GameView>();
            if (layout.uniforms?.includes('FrameUniforms') && !(backend as any).bindUniformBufferBase) {
                console.warn(`[validate] ${pass.name}: backend lacks uniform buffer binding API`);
            }
            if (passId === 'sprites') {
                const hasTextures = (v: unknown): v is { textures: { [k: string]: unknown | null } } => typeof v === 'object' && !!v && 'textures' in (v as unknown as Record<string, unknown>);
                if (hasTextures(gv)) {
                    if (!gv.textures?.['_atlas']) console.warn(`[validate] ${pass.name}: texture '_atlas' missing`);
                    if (!gv.textures?.['_atlas_dynamic']) console.warn(`[validate] ${pass.name}: texture '_atlas_dynamic' missing`);
                }
            }
            if (passId === 'meshbatch') {
                try {
                    const dirBuf = MeshPipeline.getDirectionalLightBuffer();
                    const ptBuf = MeshPipeline.getPointLightBuffer();
                    if (!dirBuf) console.warn(`[validate] ${pass.name}: DirLightBlock buffer not initialized`);
                    if (!ptBuf) console.warn(`[validate] ${pass.name}: PointLightBlock buffer not initialized`);
                } catch { /* ignore */ }
            }
        } catch {
            console.error(`[validate] ${pass?.name ?? 'unknown'}: error occurred during validation`);
        }
    }

    register(desc: RenderPassDef): void {
        const idStr = String(desc.id);
        if (this.registered.has(idStr)) throw new Error(`Pipeline '${desc.id}' already registered`);
        let pipelineHandle: RenderPassInstanceHandle | null = null;
        if (this.backend.createRenderPassInstance && (desc.vsCode || desc.fsCode)) {
            pipelineHandle = this.backend.createRenderPassInstance({ label: desc.label ?? desc.name, vsCode: desc.vsCode, fsCode: desc.fsCode, bindingLayout: desc.bindingLayout });
        }
        const rec: RegisteredPassRec = { id: idStr, exec: desc.exec as any, prepare: desc.prepare as any, pipelineHandle, bindingLayout: desc.bindingLayout, present: !!desc.present };
        // One-time bootstrap for GPU resources
        if (desc.bootstrap) {
            if (pipelineHandle && this.backend.setGraphicsPipeline) {
                const stubPass: PassEncoder = { fbo: null, desc: { label: desc.id } as RenderPassDesc };
                this.backend.setGraphicsPipeline(stubPass, pipelineHandle);
            }
            desc.bootstrap(this.backend);
            checkWebGLError(`after bootstrap ${desc.id}`);
        }
        this.registered.set(rec.id, rec);
        this.passes.push(desc);
    }

    setState<PState extends keyof PassStateTypes & RenderPassStateId>(id: PState, state: PassStateTypes[PState]): void {
        const p = this.registered.get(String(id)); if (!p) throw new Error(`Pipeline '${String(id)}' not found`);
        p.state = state;
    }
    getState<PState extends keyof PassStateTypes & RenderPassStateId>(id: PState): PassStateTypes[PState] | undefined {
        const p = this.registered.get(String(id));
        return p ? (p.state as PassStateTypes[PState]) : undefined;
    }
    execute(id: string, fbo: unknown): void {
        const p = this.registered.get(String(id)); if (!p) throw new Error(`Pipeline '${id}' not found`);
        const backend = this.backend;
        checkWebGLError(`before binding pipeline ${id}`);
        if (p.pipelineHandle && backend.setGraphicsPipeline) {
            const stubPass: PassEncoder = { fbo, desc: { label: id } as RenderPassDesc };
            backend.setGraphicsPipeline(stubPass, p.pipelineHandle);
        }
        const uniforms = p.bindingLayout?.uniforms ?? [];
        if (uniforms.length && (backend as any).setUniformBlockBinding) {
            for (const u of uniforms) {
                if (u === 'FrameUniforms') (backend as any).setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
                if (u === 'DirLightBlock') (backend as any).setUniformBlockBinding('DirLightBlock', 0);
                if (u === 'PointLightBlock') (backend as any).setUniformBlockBinding('PointLightBlock', 1);
            }
        }
        checkWebGLError(`after binding pipeline ${id}`);
        if (p.prepare) p.prepare(backend, p.state);
        checkWebGLError(`after preparing pipeline ${id}`);
        // Special-case: present passes on WebGPU manage their own pass/encoder.
        // Provide pipeline handle via fbo parameter for convenience.
        if ((backend.type === 'webgpu') && p.present) {
            const fboWithPipeline = { pipelineHandle: p.pipelineHandle };
            p.exec(backend, fboWithPipeline, p.state);
        } else {
            p.exec(backend, fbo, p.state);
        }
        checkWebGLError(`after executing pipeline ${id}`);
    }
    has(id: string): boolean { return this.registered.has(String(id)); }

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
        const rg = new RenderGraphRuntime(view.backend);
        let frameColorHandle: number | null = null;
        let frameDepthHandle: number | null = null;

        // Clear pass: create frame color/depth and export to backbuffer
        const DEBUG_FORCE_VISIBLE_CLEAR = false;
        rg.addPass({
            name: 'Clear',
            setup: (io) => {
                const color = io.createTex({ width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, name: 'FrameColor' });
                const depth = io.createTex({ width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, depth: true, name: 'FrameDepth' });
                const clearCol: color_arr = DEBUG_FORCE_VISIBLE_CLEAR ? [1, 0, 1, 1] : [0, 0, 0, 1];
                io.writeTex(color, { clearColor: clearCol });
                io.writeTex(depth, { clearDepth: 1.0 });
                io.exportToBackbuffer(color);
                frameColorHandle = color;
                frameDepthHandle = depth;
                return null;
            },
            execute: () => { },
        });

        // Per-frame shared state aggregation (camera + lighting + frame UBO update)
        rg.addPass({
            name: 'FrameSharedState',
            alwaysExecute: true,
            setup: () => null,
            execute: (_ctx, frame) => {
                const cam = $.model.activeCamera3D; if (!cam) return;
                const viewState = { camPos: cam.position, viewProj: cam.viewProjection, skyboxView: cam.skyboxView, proj: cam.projection };
                const maybeAmbient = $.model.ambientLight?.light;
                const lighting = lightingSystem.update(isAmbientLight(maybeAmbient) ? maybeAmbient : null);
                this.setState('frame_shared', { view: viewState, lighting });
                try {
                    const gv = $.viewAs<GameView>();
                    updateAndBindFrameUniforms(gv.backend, {
                        offscreen: { x: gv.offscreenCanvasSize.x, y: gv.offscreenCanvasSize.y },
                        logical: { x: gv.viewportSize.x, y: gv.viewportSize.y },
                        time: frame?.time ?? 0,
                        delta: frame?.delta ?? 0,
                        view: cam.view,
                        proj: cam.projection,
                        cameraPos: cam.position,
                    });
                } catch { /* ignore if backend does not support UBOs */ }
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
                    const enabled = this.isPassEnabled(desc.id as string);
                    const willRun = enabled && (!desc.shouldExecute || desc.shouldExecute());
                    if (!willRun) return;
                    if (data.present) {
                        const colorTex = frameColorHandle != null ? ctx.getTex(frameColorHandle) : null;
                        try {
                            this.setState('crt', {
                                width: view.offscreenCanvasSize.x,
                                height: view.offscreenCanvasSize.y,
                                baseWidth: view.viewportSize.x,
                                baseHeight: view.viewportSize.y,
                                // fragScale,
                                colorTex,
                                options: frame['postFx']?.crt,
                            });
                        } catch { console.error(`Failed to set CRT state: ${frame['postFx']?.crt}`); }
                        // Execute the pass; PipelineRegistry ensures the program/pipeline is bound.
                        this.execute(desc.id as string, null);
                    } else if (isStateOnly) {
                        // Even for state-only passes, route through execute() to keep behavior uniform.
                        this.execute(desc.id as string, null);
                    } else {
                        if (frameColorHandle == null || frameDepthHandle == null) return;
                        // Execute with the current frame FBO; registry binds pipeline then calls prepare().
                        this.execute(desc.id as string, ctx.getFBO(frameColorHandle, frameDepthHandle) as WebGLFramebuffer);
                    }
                }
            });
        }

        // Quick validation of render passes
        try {
            const dummyFrame: any = { views: [], frameIndex: 0, time: 0, delta: 0 };
            rg.compile(dummyFrame);
            const texInfo = rg.getTextureDebugInfo();
            const frameColor = frameColorHandle != null ? texInfo.find(t => t.index === frameColorHandle) : texInfo.find(t => t.present);
            if (frameColor) {
                const writerNames = frameColor.writers.map(i => rg.getPassNames()[i]);
                const contentWriters = writerNames.filter(n => n !== 'Clear');
                const hasPotentialWriters = this.getPipelinePasses().some(p => !p.stateOnly && !p.present);
                if (contentWriters.length === 0 && hasPotentialWriters) {
                    console.warn('Framegraph validation: Only Clear pass wrote to frame color.');
                }
            }
            // Pass registry validation: unique IDs and shader availability for non-state passes
            const seen = new Set<string>();
            for (const p of this.getPipelinePasses()) {
                const idStr = String(p.id);
                if (seen.has(idStr)) console.warn(`Duplicate pass id registered: ${idStr}`);
                seen.add(idStr);
                const needsShaders = !p.stateOnly && !p.present;
                if (needsShaders && (!p.vsCode || !p.fsCode)) console.warn(`Pass '${p.name}' missing shaders (vs=${!!p.vsCode} fs=${!!p.fsCode})`);
            }
        } catch (e) {
            console.error(`Framegraph validation failed: ${e}`);
        }

        return rg;
    }

    // Enable/disable passes at runtime (debug/editor)
    setPassEnabled(id: string, enabled: boolean): void { this.passEnabled.set(id, !!enabled); }
    isPassEnabled(id: string): boolean { return this.passEnabled.get(id) !== false; }
}
