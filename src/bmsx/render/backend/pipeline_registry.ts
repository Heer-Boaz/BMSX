import { $ } from '../../core/game';
import { color_arr, vec2arr } from '../../rompack/rompack';
import spriteFS from '../2d/shaders/2d.frag.glsl';
import spriteVS from '../2d/shaders/2d.vert.glsl';
import * as SpritesPipeline from '../2d/sprites_pipeline';
import { Atmosphere, registerAtmosphereHotkeys } from '../3d/atmosphere';
import { M4 } from '../3d/math3d';
import * as MeshPipeline from '../3d/mesh_pipeline';
import * as ParticlesPipeline from '../3d/particles_pipeline';
import meshFS from '../3d/shaders/3d.frag.glsl';
import meshVS from '../3d/shaders/3d.vert.glsl';
import particleFS from '../3d/shaders/particle.frag.glsl';
import particleVS from '../3d/shaders/particle.vert.glsl';
import skyboxFS from '../3d/shaders/skybox.frag.glsl';
import skyboxVS from '../3d/shaders/skybox.vert.glsl';
import * as SkyboxPipeline from '../3d/skybox_pipeline';
import { RenderGraphRuntime } from '../graph/rendergraph';
import { LightingSystem, isAmbientLight } from '../lighting/lightingsystem';
import { registerCRT } from '../post/crt_pipeline';
import { GameView } from '../view';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from './frame_uniforms';
import { RenderContext, RenderPassDef, RenderPassStateId, TextureHandle } from './pipeline_interfaces';
import { GraphicsPipelineManager } from './pipeline_manager';
import { checkWebGLError } from './webgl.helpers';

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
interface CRTPipelineState { width: number; height: number; baseWidth: number; baseHeight: number; colorTex: TextureHandle | null; options?: unknown; }
interface FrameSharedState { view: { camPos: any; viewProj: Float32Array; skyboxView: Float32Array; proj: Float32Array }; lighting: unknown }

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

export class PipelineRegistry {
	private passes: RenderPassDef[] = []; // Mutable list for ordering/scheduling
	private passEnabled = new Map<string, boolean>();

	constructor(private pm: GraphicsPipelineManager) { }

	registerBuiltin() {
		// FrameResolve: set per-frame default uniforms shared across passes (sprite + mesh)
		this.register({
			id: 'frame_resolve',
			label: 'frame_resolve',
			name: 'FrameResolve',
			stateOnly: true,
			exec: () => { /* state only */ },
			prepare: (backend, _state) => {
				// Upload minimal frame-shared values via a UBO foundation
				const gv = getRenderContext();
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
			vsCode: skyboxVS,
			fsCode: skyboxFS,
			bindingLayout: {
				textures: [{ name: 'u_skybox' }],
				samplers: [{ name: 's_skybox' }],
			},
			bootstrap: (backend) => {
				const gl = (backend as any).gl as WebGL2RenderingContext;
				SkyboxPipeline.init(gl);
			},
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
				// Desired state: no cull, no depth write
				backend.setCullEnabled?.(false);
				backend.setDepthMask?.(false);
				// WebGPU: bind texture + sampler
				backend.bindTextureWithSampler?.(0, 1, tex);
			},
		});

		// Mesh batch
		this.register({
			id: 'meshbatch',
			label: 'meshbatch',
			name: 'Meshes',
			vsCode: meshVS,
			fsCode: meshFS,
			bindingLayout: {
				textures: [
					{ name: 'u_albedoTexture' },
					{ name: 'u_normalTexture' },
					{ name: 'u_metallicRoughnessTexture' },
				],
				buffers: [
					{ name: 'DirLightBlock', size: 0, usage: 'uniform' },
					{ name: 'PointLightBlock', size: 0, usage: 'uniform' },
				],
			},
			bootstrap: (backend) => {
				const gl = (backend as any).gl as WebGL2RenderingContext;
				MeshPipeline.setupVertexShaderLocations3D(gl);
				MeshPipeline.setupBuffers3D(gl);
			},
			writesDepth: true,
			shouldExecute: () => {
				const gv = getRenderContext() as unknown as { renderer?: { queues?: { meshes?: unknown[] } } };
				const qlen = (gv.renderer?.queues?.meshes?.length ?? 0);
				return qlen > 0;
			},
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
				// Desired state: enable culling, enable depth writes
				backend.setCullEnabled?.(true);
				backend.setDepthMask?.(true);
				// Bind-time defaults now that the mesh program is bound (via PipelineManager)
				try { const gl = (backend as any).gl as WebGL2RenderingContext; MeshPipeline.setDefaultUniformValues(gl, 1.0); } catch { /* ignore */ }
			},
		});

		// Particles
		this.register({
			id: 'particles',
			label: 'particles',
			name: 'Particles',
			vsCode: particleVS,
			fsCode: particleFS,
			bootstrap: (backend) => {
				ParticlesPipeline.init(backend);
				ParticlesPipeline.setupParticleLocations();
				ParticlesPipeline.setupParticleUniforms(backend);
			},
			writesDepth: true,
			shouldExecute: () => {
				const gv = getRenderContext() as unknown as { renderer?: { queues?: { particles?: unknown[] } } };
				const qlen = (gv.renderer?.queues?.particles?.length ?? 0);
				return qlen > 0;
			},
			exec: (_backend, fbo, s) => {
				const state = s as ParticlePipelineState;
				ParticlesPipeline.renderParticleBatch(fbo, state.width, state.height, state);
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
            vsCode: spriteVS,
            fsCode: spriteFS,
            bindingLayout: {
                uniforms: ['FrameUniforms'],
                textures: [{ name: 'u_texture0' }, { name: 'u_texture1' }],
                samplers: [{ name: 's_texture0' }, { name: 's_texture1' }],
            },
            bootstrap: (backend) => {
                SpritesPipeline.setupSpriteShaderLocations(backend);
                SpritesPipeline.setupBuffers(backend);
                SpritesPipeline.setupSpriteLocations(backend);
                // Bind frame UBO block to a consistent binding index
                backend.setUniformBlockBinding?.('FrameUniforms', FRAME_UNIFORM_BINDING);
            },
			writesDepth: true,
			shouldExecute: () => {
				const gv = getRenderContext() as unknown as { renderer?: { queues?: { sprites?: unknown[] } } };
				const qlen = (gv.renderer?.queues?.sprites?.length ?? 0);
				return qlen > 0;
			},
			exec: (_backend, fbo, s) => {
				const state = s as SpritesPipelineState;
				SpritesPipeline.renderSpriteBatch(fbo, state.width, state.height, state.baseWidth, state.baseHeight);
			},
			prepare: (backend, _state) => {
				const gv = getRenderContext();
				const width = gv.offscreenCanvasSize.x;
				const height = gv.offscreenCanvasSize.y;
				const baseWidth = gv.viewportSize.x;
				const baseHeight = gv.viewportSize.y;
				const spriteState: SpritesPipelineState = { width, height, baseWidth, baseHeight };
				this.setState('sprites', spriteState);
				// Program is bound for sprites here; set defaults once per frame
				checkWebGLError('Sprites: before setupDefaultUniformValues');
				if (!backend) throw new Error('Backend not available');
				if (!gv.offscreenCanvasSize) throw new Error('Offscreen canvas size not available');
				SpritesPipeline.setupDefaultUniformValues(
					backend,
					1.0,
					// Use logical viewport resolution for sprite coordinate mapping
					[baseWidth, baseHeight] as vec2arr
				);
                // Ensure atlas textures are bound to expected units for this pass (WebGL path)
                try {
                    const v = gv as unknown as { textures?: { [k: string]: unknown | null }, activeTexUnit: number | null, bind2DTex: (t: unknown | null) => void };
                    if (v && v.textures) {
                        v.activeTexUnit = 0; v.bind2DTex(v.textures['_atlas'] ?? null);
                        v.activeTexUnit = 1; v.bind2DTex(v.textures['_atlas_dynamic'] ?? null);
                    }
                } catch { /* ignore, will be bound elsewhere */ }
                // WebGPU bind-group wiring (basic): uniforms @0, textures @1,2 and samplers @3,4
                try {
                    const tex0 = (gv as any).textures?._atlas as unknown;
                    const tex1 = (gv as any).textures?._atlas_dynamic as unknown;
                    if (backend.bindTextureWithSampler && tex0) backend.bindTextureWithSampler(1, 3, tex0 as any, { mag: 'nearest', min: 'nearest', wrapS: 'clamp', wrapT: 'clamp' });
                    if (backend.bindTextureWithSampler && tex1) backend.bindTextureWithSampler(2, 4, tex1 as any, { mag: 'nearest', min: 'nearest', wrapS: 'clamp', wrapT: 'clamp' });
                } catch { /* ignore if not WebGPU */ }
                // backend.setBlendEnabled(true);
                checkWebGLError('Sprites: after setupDefaultUniformValues');
            },
        });

		// const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
		// const baseW = gv.viewportSize.x;
		// const baseH = gv.viewportSize.y;
		// // Ensure size-dependent uniforms are up-to-date on resize
		// try {
		//     const gl = (backend as any).gl as WebGL2RenderingContext;
		//     SpritesPipeline.setupDefaultUniformValues(gl, 1.0, [gv.offscreenCanvasSize.x, gv.offscreenCanvasSize.y] as unknown as [number, number]);
		//     MeshPipeline.setDefaultUniformValues(gl, 1.0);
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

	setState<PState extends keyof PassStateTypes & RenderPassStateId>(id: PState, state: PassStateTypes[PState]): void { this.pm.setState(id as any, state as any); }
	getState<PState extends keyof PassStateTypes & RenderPassStateId>(id: PState): PassStateTypes[PState] | undefined { return this.pm.getState(id as any) as any; }
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
				this.setState('frame_shared', { view: viewState, lighting } as any);
				try {
					const gv = getRenderContext();
					updateAndBindFrameUniforms(gv.getBackend(), {
						offscreen: { x: gv.offscreenCanvasSize.x, y: gv.offscreenCanvasSize.y },
						logical: { x: gv.viewportSize.x, y: gv.viewportSize.y },
						time: (frame as any)?.time ?? 0,
						delta: (frame as any)?.delta ?? 0,
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
						// const fragScale = view.offscreenCanvasSize.x / view.viewportSize.x;
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
						// Execute the pass; GraphicsPipelineManager ensures the program/pipeline
						// is bound before calling the pass's prepare() (WebGL requires useProgram).
						this.execute(desc.id, null);
					} else if (isStateOnly) {
						// Even for state-only passes, route through execute() to keep behavior uniform.
						this.execute(desc.id, null);
					} else {
						if (frameColorHandle == null || frameDepthHandle == null) return;
						// Execute with the current frame FBO; manager binds pipeline then calls prepare().
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
			// Pass registry validation: unique IDs and shader availability for non-state passes
			const seen = new Set<string>();
			for (const p of this.getPipelinePasses()) {
				const idStr = String(p.id);
				if (seen.has(idStr)) console.warn(`Duplicate pass id registered: ${idStr}`);
				seen.add(idStr);
				const needsShaders = !p.stateOnly && !p.present;
				if (needsShaders && (!p.vsCode || !p.fsCode)) console.warn(`Pass '${p.name}' missing shaders (vs=${!!p.vsCode} fs=${!!p.fsCode})`);
			}
		} catch { /* ignore */ }

		return rg;
	}

	// Enable/disable passes at runtime (debug/editor)
	setPassEnabled(id: string, enabled: boolean): void { this.passEnabled.set(id, !!enabled); }
	isPassEnabled(id: string): boolean { return this.passEnabled.get(id) !== false; }
}
