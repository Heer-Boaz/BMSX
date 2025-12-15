import { $ } from '../../core/game';
import { color_arr } from '../../rompack/rompack';
import { registerSpritesPass_WebGL } from '../2d/sprites_pipeline';
import { registerSpritesPass_WebGPU } from '../2d/sprites_pipeline.wgpu';
import { AmbientLight } from '../3d/light';
import * as MeshPipeline from '../3d/mesh_pipeline';
import { registerMeshBatchPass_WebGL } from '../3d/mesh_pipeline';
import { registerMeshBatchPass_WebGPU } from '../3d/mesh_pipeline.wgpu';
import { registerParticlesPass_WebGL } from '../3d/particles_pipeline';
import { registerParticlesPass_WebGPU } from '../3d/particles_pipeline.wgpu';
import { registerSkyboxPass_WebGL } from '../3d/skybox_pipeline';
import { registerAxisGizmoPass_WebGL } from '../3d/axis_gizmo_pipeline';
import { registerSkyboxPass_WebGPU } from '../3d/skybox_pipeline.wgpu';
import { registerSolidColorPass_WebGPU } from '../debug/solidcolor_pipeline.wgpu';
import { RenderGraphRuntime } from '../graph/rendergraph';
import { LightingSystem } from '../lighting/lightingsystem';
import { registerCRT_WebGL } from '../post/crt_pipeline';
import { registerCRT_WebGPU } from '../post/crt_pipeline.wgpu';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from './frame_uniforms';
import { AnyBackend, CRTPipelineState, FogUniforms, FrameSharedState, GPUBackend, MeshBatchPipelineState, ParticlePipelineState, PassEncoder, RenderContext, RenderPassDef, RenderPassDesc, RenderPassInstanceHandle, RenderPassStateId, RenderPassToken, SkyboxPipelineState, SpritesPipelineState } from './pipeline_interfaces';
import { checkWebGLError } from './webgl/webgl.helpers';
import { WebGLBackend } from './webgl/webgl_backend';
import { registerHeadlessPasses } from '../headless/headless_render_passes';
import { ENGINE_ATLAS_TEXTURE_KEY } from '../gameview';

// Type-safe pass state map used by this registry (compile-time only)
type PassStateTypes = {
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
	exec: (backend: AnyBackend, fbo: unknown, state: unknown) => void;
	prepare?: (backend: AnyBackend, state: unknown) => void;
	pipelineHandle?: RenderPassInstanceHandle;
	state?: unknown;
	bindingLayout?: RenderPassDef['bindingLayout'];
	present?: boolean;
}

export class RenderPassLibrary {
	private passes: RenderPassDef[] = []; // Mutable list for ordering/scheduling
	private passEnabled = new Map<string, boolean>();
	private registered = new Map<string, RegisteredPassRec>();
	private readonly tokensById = new Map<string, RenderPassToken>();
	constructor(private backend: GPUBackend) { }

	registerBuiltin(backend: GPUBackend) {
		switch (backend.type) {
			case 'webgl2':
				this.registerBuiltinPassesWebGL();
				break;
			case 'webgpu':
				this.registerBuiltinPassesWebGPU();
				break;
			case 'headless':
				this.registerBuiltinPassesHeadless();
				break;
		}
	}

	private registerBuiltinPassesWebGPU() {
		// Common state-only passes (backend-agnostic)
		this.register({
			id: 'frame_resolve', name: 'FrameResolve', stateOnly: true,
			exec: () => { /* state only */ },
			prepare: (backend, _state) => {
				const gv = $.view;
				updateAndBindFrameUniforms(backend, {
					offscreen: { x: gv.offscreenCanvasSize.x, y: gv.offscreenCanvasSize.y },
					logical: { x: gv.viewportSize.x, y: gv.viewportSize.y },
				});
				// Ambient now resides in the Frame UBO
				const ambientEntry = $.world.activeAmbientLight;
				const amb = ambientEntry ? ambientEntry.light : null;
				updateAndBindFrameUniforms(backend, { offscreen: { x: 0, y: 0 }, logical: { x: 0, y: 0 }, ambient: amb ? { color: amb.color, intensity: amb.intensity } : undefined });
			},
		});
		// Removed: standalone fog pass. Fog state is produced in FrameSharedState.
		this.register({ id: 'frame_shared', name: 'FrameShared', stateOnly: true, exec: () => { } });
		// Backend-specific pass registrations (stubs for now)
		registerSkyboxPass_WebGPU(this);
		registerMeshBatchPass_WebGPU(this);
		registerParticlesPass_WebGPU(this);
		registerSpritesPass_WebGPU(this);
		registerSolidColorPass_WebGPU(this);
		registerCRT_WebGPU(this);
	}

	private registerBuiltinPassesWebGL() {
		// FrameResolve: set per-frame default uniforms shared across passes (sprite + mesh)
		this.register({
			id: 'frame_resolve',
			name: 'FrameResolve',
			stateOnly: true,
			exec: () => { /* state only */ },
			prepare: (backend, _state) => {
				// Upload minimal frame-shared values via a UBO foundation
				const gv = $.view;
				updateAndBindFrameUniforms(backend, {
					offscreen: { x: gv.offscreenCanvasSize.x, y: gv.offscreenCanvasSize.y },
					logical: { x: gv.viewportSize.x, y: gv.viewportSize.y },
				});
			},
		});
		// Removed: standalone fog pass. Fog state is produced in FrameSharedState.

		// Skybox (WebGPU)
		registerSkyboxPass_WebGL(this);

		// Mesh batch (WebGPU)
		registerMeshBatchPass_WebGL(this);

		// Particles (WebGPU)
		registerParticlesPass_WebGL(this);

		// Axis gizmo (WebGL) — runs before sprites so labels render this frame
		registerAxisGizmoPass_WebGL(this);

		// Sprites (WebGL)
		registerSpritesPass_WebGL(this);

		// Debug solid writer (WebGL) — ensures content is written before present
		// registerSolidColorPass_WebGL(this);

		// CRT (WebGL)
		registerCRT_WebGL(this); // Registers program + execution

		// FrameShared
		this.register({
			id: 'frame_shared',
			name: 'FrameShared',
			stateOnly: true,
			exec: () => { /* populated per frame by graph */ }
		});
	}

	private registerBuiltinPassesHeadless() {
		registerHeadlessPasses(this);
	}

	public validatePassResources(passId: string, backend: GPUBackend): void {
		let pass: RenderPassDef;
		try {
			const idx = this.findPipelinePassIndex(passId);
			if (idx < 0) return;
			pass = this.passes[idx];
			const layout = pass.bindingLayout; if (!layout) return;
			const gv = $.view;
			const layoutUniforms = Array.isArray(layout.uniforms) ? layout.uniforms : [];
			if (layoutUniforms.includes('FrameUniforms') && !backend.bindUniformBufferBase) {
				console.warn(`[validate] ${pass.name}: backend lacks uniform buffer binding API`);
			}
			if (passId === 'sprites') {
				if (!gv.textures['_atlas']) console.warn(`[validate] ${pass.name}: texture '_atlas' missing`);
				if (!gv.textures['_atlas_dynamic']) console.warn(`[validate] ${pass.name}: texture '_atlas_dynamic' missing`);
				if (!gv.textures[ENGINE_ATLAS_TEXTURE_KEY]) console.warn(`[validate] ${pass.name}: engine atlas texture missing`);
			}
			if (passId === 'meshbatch') {
				const dirBuf = MeshPipeline.getDirectionalLightBuffer();
				const ptBuf = MeshPipeline.getPointLightBuffer();
				if (!dirBuf) console.warn(`[validate] ${pass.name}: DirLightBlock buffer not initialized`);
				if (!ptBuf) console.warn(`[validate] ${pass.name}: PointLightBlock buffer not initialized`);
			}
		} catch (e) {
			const passName = pass ? pass.name : 'unknown';
			console.error(`[validate] ${passName}: error occurred during validation: ${e}`);
		}
	}

	register(desc: RenderPassDef): void {
		const idStr = String(desc.id);
		if (this.registered.has(idStr)) throw new Error(`Pipeline '${desc.id}' already registered`);
		let pipelineHandle: RenderPassInstanceHandle = null;
		if (this.backend.createRenderPassInstance && (desc.vsCode || desc.fsCode)) {
			pipelineHandle = this.backend.createRenderPassInstance({
				label: desc.name,
				vsCode: desc.vsCode,
				fsCode: desc.fsCode,
				bindingLayout: desc.bindingLayout,
				usesDepth: !!(desc.writesDepth || desc.depthTest),
				depthTest: !!desc.depthTest,
				depthWrite: desc.depthWrite ?? !!desc.writesDepth,
			});
		}
		const rec: RegisteredPassRec = { id: idStr, exec: desc.exec, prepare: desc.prepare, pipelineHandle, bindingLayout: desc.bindingLayout, present: !!desc.present };
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
	getState<PState extends keyof PassStateTypes & RenderPassStateId>(id: PState): PassStateTypes[PState] {
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
		if (backend.type === 'webgl2') {
			const uniformList = p.bindingLayout && Array.isArray(p.bindingLayout.uniforms) ? p.bindingLayout.uniforms : [];
			if (uniformList.length) {
				for (const u of uniformList) {
					if (u === 'FrameUniforms') (backend as WebGLBackend).setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
					if (u === 'DirLightBlock') (backend as WebGLBackend).setUniformBlockBinding('DirLightBlock', 0);
					if (u === 'PointLightBlock') (backend as WebGLBackend).setUniformBlockBinding('PointLightBlock', 1);
				}
			}
		}
		if (p.prepare) p.prepare(backend, p.state);

		// Special-case: present passes on WebGPU manage their own pass/encoder.
		// Provide pipeline handle via fbo parameter for convenience.
		if ((backend.type === 'webgpu') && p.present) {
			const fboWithPipeline = { pipelineHandle: p.pipelineHandle };
			p.exec(backend, fboWithPipeline, p.state);
		} else {
			p.exec(backend, fbo, p.state);
		}
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
		let frameColorHandle: number = null;
		let frameDepthHandle: number = null;

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
				const cam = $.world.activeCamera3D; if (!cam) return;
				const mats = cam.getMatrices();
				const viewState = { camPos: cam.position, viewProj: mats.vp, skyboxView: cam.skyboxView, proj: mats.proj };
				const activeAmbient = $.world.activeAmbientLight;
				const ambientLight = activeAmbient ? (activeAmbient.light as AmbientLight) : null;
				const lighting = lightingSystem.update(ambientLight);
				// Build fog state alongside frame-shared so consumers can rely on it
				const gv = $.view;
				const fog: FogUniforms = {
					fogD50: gv.atmosphere.fogD50,
					fogStart: gv.atmosphere.fogStart,
					fogColorLow: gv.atmosphere.fogColorLow,
					fogColorHigh: gv.atmosphere.fogColorHigh,
					fogYMin: gv.atmosphere.fogYMin,
					fogYMax: gv.atmosphere.fogYMax,
				};
				this.setState('frame_shared', { view: viewState, lighting, fog });
				const frameTime = frame ? frame.time : 0;
				const frameDelta = frame ? frame.delta : 0;
				const ambientUniform = (lighting && lighting.ambient)
					? { color: lighting.ambient.color, intensity: lighting.ambient.intensity }
					: undefined;
				updateAndBindFrameUniforms(gv.backend, {
					offscreen: { x: gv.offscreenCanvasSize.x, y: gv.offscreenCanvasSize.y },
					logical: { x: gv.viewportSize.x, y: gv.viewportSize.y },
					time: frameTime,
					delta: frameDelta,
					view: mats.view,
					proj: mats.proj,
					cameraPos: cam.position,
					ambient: ambientUniform,
				});
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
						else if (desc.depthTest && frameDepthHandle != null) io.readTex(frameDepthHandle);
					} else {
						if (frameColorHandle != null) io.readTex(frameColorHandle);
					}
					return { width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, present: isPresent };
				},
				execute: (ctx, _frame, data: { width: number; height: number; present: boolean }) => {
					const enabled = this.isPassEnabled(desc.id);
					const willRun = enabled && (!desc.shouldExecute || desc.shouldExecute());
					if (!willRun) return;
					if (data.present) {
						const colorTex = frameColorHandle != null ? ctx.getTex(frameColorHandle) : null;
						const gv = $.view;

						this.setState('crt', {
							width: gv.offscreenCanvasSize.x,
							height: gv.offscreenCanvasSize.y,
							baseWidth: gv.viewportSize.x,
							baseHeight: gv.viewportSize.y,
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

							} as CRTPipelineState['options'],
						});
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
	setPassEnabled(id: string, enabled: boolean): void {
		this.passEnabled.set(id, !!enabled);
	}
	isPassEnabled(id: string): boolean { return this.passEnabled.get(id) !== false; }

	public createPassToken(id: string, options?: { enabled?: boolean }): RenderPassToken {
		const normalized = String(id);
		if (this.tokensById.has(normalized)) {
			return this.tokensById.get(normalized)!;
		}
		if (options && 'enabled' in options) {
			this.setPassEnabled(normalized, !!options.enabled);
		}
		const token: RenderPassToken = {
			id: normalized,
			enable: () => this.setPassEnabled(normalized, true),
			disable: () => this.setPassEnabled(normalized, false),
			set: (enabled: boolean) => this.setPassEnabled(normalized, enabled),
			isEnabled: () => this.isPassEnabled(normalized),
		};
		this.tokensById.set(normalized, token);
		return token;
	}
}

