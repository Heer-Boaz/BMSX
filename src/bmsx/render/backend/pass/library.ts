import { consoleCore } from '../../../core/console';
import { registerFramebuffer2DPass_WebGL } from '../../2d/framebuffer_pipeline';
import { registerHostOverlayPass_Headless, registerHostMenuPass_Headless } from '../../host_overlay/headless/pipeline';
import { registerHostOverlayPass_WebGL, registerHostMenuPass_WebGL } from '../../host_overlay/webgl/pipeline';
import { registerMeshPass_WebGL } from '../../3d/mesh/pipeline';
import { registerParticlesPass_WebGL } from '../../3d/particles/pipeline';
import { registerParticlesPass_WebGPU } from '../../3d/particles/pipeline.wgpu';
import { registerSkyboxPass_WebGL } from '../../3d/skybox/pipeline';
import { registerSkyboxPass_WebGPU } from '../../3d/skybox/pipeline.wgpu';
import { RenderGraphRuntime } from '../../graph/graph';
import { LightingSystem } from '../../lighting/system';
import { registerCRT_WebGL } from '../../post/crt/pipeline';
import { registerDeviceQuantize_WebGL } from '../../post/device_quantize_pipeline';
import { registerCRT_WebGPU } from '../../post/crt/pipeline.wgpu';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from '../frame_uniforms';
import { AnyBackend, CRTPipelineState, FrameSharedState, GPUBackend, PassEncoder, RenderContext, RenderGraphSlot, RenderPassDef, RenderPassDesc, RenderPassInstanceHandle, RenderPassStateId, RenderPassStateRegistry } from '../backend';
import { checkWebGLError } from '../webgl/helpers';
import { WebGLBackend } from '../webgl/backend';
import { registerHeadlessPasses, registerHeadlessPresentPass } from '../../headless/passes';

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
	private readonly frameSharedState: FrameSharedState = {
		view: {
			camPos: new Float32Array(3),
			viewProj: new Float32Array(16),
			skyboxView: new Float32Array(16),
			proj: new Float32Array(16),
		},
		lighting: { ambient: null, dirCount: 0, pointCount: 0, dirty: true },
		fog: {
			fogD50: 0,
			fogStart: 0,
			fogColorLow: [0, 0, 0],
			fogColorHigh: [0, 0, 0],
			fogYMin: 0,
			fogYMax: 0,
		},
	};
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
			graph: { skip: true },
			exec: () => { /* state only */ },
			prepare: (backend, _state) => {
				const gv = consoleCore.view;
				updateAndBindFrameUniforms(backend, gv.offscreenCanvasSize.x, gv.offscreenCanvasSize.y, gv.viewportSize.x, gv.viewportSize.y);
			},
		});
		// Removed: standalone fog pass. Fog state is produced in FrameSharedState.
		this.register({ id: 'frame_shared', name: 'FrameShared', stateOnly: true, graph: { skip: true }, exec: () => { } });
		this.register({ id: 'framebuffer_2d', name: 'Framebuffer2D', stateOnly: true, exec: () => { } });
		// Backend-specific pass registrations (stubs for now)
		registerSkyboxPass_WebGPU(this);
		registerParticlesPass_WebGPU(this);
		registerCRT_WebGPU(this);
	}

	private registerBuiltinPassesWebGL() {
		// FrameResolve: set per-frame default uniforms shared across device presentation passes.
		this.register({
			id: 'frame_resolve',
			name: 'FrameResolve',
			stateOnly: true,
			graph: { skip: true },
			exec: () => { /* state only */ },
			prepare: (backend, _state) => {
				const gv = consoleCore.view;
				updateAndBindFrameUniforms(backend, gv.offscreenCanvasSize.x, gv.offscreenCanvasSize.y, gv.viewportSize.x, gv.viewportSize.y);
			},
		});
		// Removed: standalone fog pass. Fog state is produced in FrameSharedState.

		registerSkyboxPass_WebGL(this);
		registerMeshPass_WebGL(this);
		registerParticlesPass_WebGL(this);
		registerFramebuffer2DPass_WebGL(this);
		registerDeviceQuantize_WebGL(this);
		registerCRT_WebGL(this); // Registers program + execution
		registerHostOverlayPass_WebGL(this);
		registerHostMenuPass_WebGL(this);

		// FrameShared
		this.register({
			id: 'frame_shared',
			name: 'FrameShared',
			stateOnly: true,
			graph: { skip: true },
			exec: () => { /* populated per frame by graph */ }
		});
	}

	private registerBuiltinPassesHeadless() {
		registerHeadlessPasses(this);
		registerHostOverlayPass_Headless(this);
		registerHostMenuPass_Headless(this);
		registerHeadlessPresentPass(this);
	}

	register(desc: RenderPassDef): void {
		const idStr = String(desc.id);
		if (this.registered.has(idStr)) throw new Error(`Pipeline '${desc.id}' already registered`);
		let pipelineHandle: RenderPassInstanceHandle = null;
		if (desc.sharedPipelineWith) {
			const sharedPassId = String(desc.sharedPipelineWith);
			const sharedPass = this.registered.get(sharedPassId);
			if (!sharedPass) {
				throw new Error(`Pipeline '${desc.id}' cannot share pipeline with unregistered pass '${sharedPassId}'`);
			}
			if (!sharedPass.pipelineHandle) {
				throw new Error(`Pipeline '${desc.id}' cannot share pipeline with pass '${sharedPassId}' because it has no pipeline handle`);
			}
			if (desc.vsCode || desc.fsCode) {
				throw new Error(`Pipeline '${desc.id}' cannot define shaders when sharedPipelineWith='${sharedPassId}'`);
			}
			pipelineHandle = sharedPass.pipelineHandle;
		} else if (this.backend.createRenderPassInstance && (desc.vsCode || desc.fsCode)) {
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

	setState<PState extends RenderPassStateId>(id: PState, state: RenderPassStateRegistry[PState]): void {
		const p = this.registered.get(String(id)); if (!p) throw new Error(`Pipeline '${String(id)}' not found`);
		p.state = state;
	}
	getState<PState extends RenderPassStateId>(id: PState): RenderPassStateRegistry[PState] {
		return this.registered.get(String(id))?.state as RenderPassStateRegistry[PState];
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
		p.prepare?.(backend, p.state);

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
	insertPipelinePass(pass: RenderPassDef, index: number): void {
		if (index < 0 || index > this.passes.length) index = this.passes.length;
		this.passes.splice(index, 0, pass);
		// Caller must ensure pass conforms to RegisteredPipeline if execution desired
	}

	// Build render graph from current pass registry with Clear/Present wiring
	buildRenderGraph(view: RenderContext, lightingSystem: LightingSystem): RenderGraphRuntime {
		const rg = new RenderGraphRuntime(view.backend);
		const offscreenWidth = view.offscreenCanvasSize.x;
		const offscreenHeight = view.offscreenCanvasSize.y;
		const viewportWidth = view.viewportSize.x;
		const viewportHeight = view.viewportSize.y;
		let frameColorHandle: number = null;
		let frameDepthHandle: number = null;
		let deviceColorHandle: number = null;
		const passList = this.getPipelinePasses().filter(pass => !pass.graph?.skip);
		let deviceColorEnabled = false;
		for (const pass of passList) {
			if (pass.graph?.writes?.includes('device_color')) {
				deviceColorEnabled = true;
				break;
			}
		}
		const getHandle = (slot: RenderGraphSlot): number => {
			switch (slot) {
				case 'frame_color':
					return frameColorHandle;
				case 'frame_depth':
					return frameDepthHandle;
				case 'frame_history_a':
				case 'frame_history_b':
					return null;
				default:
					return deviceColorHandle;
			}
		};

			rg.addPass({
				name: 'FrameTargets',
				setup: (io) => {
					const color = io.createTex({ width: offscreenWidth, height: offscreenHeight, name: 'FrameColor' });
					const depth = io.createTex({ width: offscreenWidth, height: offscreenHeight, depth: true, name: 'FrameDepth' });
					deviceColorHandle = null;
					if (deviceColorEnabled) {
						deviceColorHandle = io.createTex({ width: offscreenWidth, height: offscreenHeight, name: 'DeviceColor', transient: true });
					}
					io.exportToBackbuffer(color);
					frameColorHandle = color;
					frameDepthHandle = depth;
					return null;
				},
				execute: () => { },
			});

		rg.addPass({
			name: 'FrameClear',
			alwaysExecute: true,
			setup: (io) => {
				if (frameColorHandle != null) io.writeTex(frameColorHandle);
				if (frameDepthHandle != null) io.writeTex(frameDepthHandle);
				return null;
			},
			execute: (ctx) => {
				if (frameColorHandle === null) {
					return;
				}
				const clearDesc: RenderPassDesc = {
					color: { tex: ctx.getTex(frameColorHandle), clear: [0, 0, 0, 1] },
				};
				if (frameDepthHandle !== null) {
					clearDesc.depth = { tex: ctx.getTex(frameDepthHandle), clearDepth: 1.0 };
				}
				const clearPass = view.backend.beginRenderPass(clearDesc);
				view.backend.endRenderPass(clearPass);
			},
		});

		// Ensure the frame UBO is uploaded/bound before any draw pass.
		rg.addPass({
			name: 'FrameResolve',
			alwaysExecute: true,
			setup: (io) => {
				if (frameColorHandle != null) io.writeTex(frameColorHandle);
				return null;
			},
			execute: () => {
				this.execute('frame_resolve', null);
			},
		});

		// Per-frame shared state aggregation (camera + lighting + frame UBO update)
		rg.addPass({
			name: 'FrameSharedState',
			alwaysExecute: true,
			setup: (io) => {
				if (frameColorHandle != null) io.writeTex(frameColorHandle);
				return null;
			},
			execute: (_ctx, frame) => {
				const frameTime = frame ? frame.time : 0;
				const frameDelta = frame ? frame.delta : 0;
				const gv = consoleCore.view;
				updateAndBindFrameUniforms(gv.backend, offscreenWidth, offscreenHeight, viewportWidth, viewportHeight, frameTime, frameDelta);
				const transform = gv.vdpTransform;
				const lighting = lightingSystem.update();
				const frameShared = this.frameSharedState;
				frameShared.view.camPos = transform.eye;
				frameShared.view.viewProj = transform.viewProj;
				frameShared.view.skyboxView = transform.skyboxView;
				frameShared.view.proj = transform.proj;
				frameShared.lighting = lighting;
				frameShared.fog.fogD50 = gv.atmosphere.fogD50;
				frameShared.fog.fogStart = gv.atmosphere.fogStart;
				frameShared.fog.fogColorLow = gv.atmosphere.fogColorLow;
				frameShared.fog.fogColorHigh = gv.atmosphere.fogColorHigh;
				frameShared.fog.fogYMin = gv.atmosphere.fogYMin;
				frameShared.fog.fogYMax = gv.atmosphere.fogYMax;
				this.setState('frame_shared', frameShared);
				if (lighting.ambient) {
					updateAndBindFrameUniforms(
						gv.backend,
						offscreenWidth,
						offscreenHeight,
						viewportWidth,
						viewportHeight,
						frameTime,
						frameDelta,
						transform.view,
						transform.proj,
						transform.eye,
						lighting.ambient.color,
						lighting.ambient.intensity,
					);
				} else {
					updateAndBindFrameUniforms(
						gv.backend,
						offscreenWidth,
						offscreenHeight,
						viewportWidth,
						viewportHeight,
						frameTime,
						frameDelta,
						transform.view,
						transform.proj,
						transform.eye,
					);
				}
				},
			});

		// Build pass sequence from registry
		for (const desc of passList) {
			const isPresent = !!desc.present;
			const isStateOnly = !!desc.stateOnly;
			rg.addPass({
				name: desc.name,
				alwaysExecute: isStateOnly,
				setup: (io) => {
					const graph = desc.graph;
					if (isPresent) {
						const presentInput = graph?.presentInput ?? 'auto';
						if (frameColorHandle != null) io.readTex(frameColorHandle);
						if (deviceColorEnabled && presentInput !== 'frame_color') io.readTex(deviceColorHandle);
					} else if (graph && (graph.reads?.length || graph.writes?.length)) {
						if (graph.reads) for (const slot of graph.reads) io.readTex(getHandle(slot));
						if (graph.writes) for (const slot of graph.writes) io.writeTex(getHandle(slot));
					} else if (!isPresent && !isStateOnly) {
						if (frameColorHandle != null) io.writeTex(frameColorHandle);
						if (desc.writesDepth && frameDepthHandle != null) io.writeTex(frameDepthHandle);
						else if (desc.depthTest && frameDepthHandle != null) io.readTex(frameDepthHandle);
					}
					return { width: offscreenWidth, height: offscreenHeight, present: isPresent };
				},
				execute: (ctx, _frame, data: { width: number; height: number; present: boolean }) => {
					const enabled = this.isPassEnabled(desc.id);
					const willRun = enabled && (!desc.shouldExecute || desc.shouldExecute());
					if (!willRun) return;
					const graph = desc.graph;
						if (graph?.buildState) {
							const graphCtx = {
								view: consoleCore.view,
								getTex: (slot: RenderGraphSlot) => ctx.getTex(getHandle(slot)),
							};
						const builtState = graph.buildState(graphCtx) as RenderPassStateRegistry[RenderPassStateId];
						const passId = desc.id as RenderPassStateId;
						this.setState(passId, builtState);
					}
						if (data.present) {
							// Execute the pass; PipelineRegistry ensures the program/pipeline is bound.
							const gv = consoleCore.view;
							const presentInput = graph?.presentInput ?? 'auto';
							const allowDevice = presentInput !== 'frame_color';
							const useDither = allowDevice && deviceColorEnabled && gv.dither_type !== 0;
							if (desc.id === 'crt') {
								const applyCrt = gv.crt_postprocessing_enabled;
								const crtState: CRTPipelineState = {
									width: offscreenWidth,
									height: offscreenHeight,
									baseWidth: viewportWidth,
									baseHeight: viewportHeight,
									colorTex: null,
									options: {
										enableNoise: applyCrt && gv.enable_noise,
										enableColorBleed: applyCrt && gv.enable_colorbleed,
										enableScanlines: applyCrt && gv.enable_scanlines,
										enableBlur: applyCrt && gv.enable_blur,
									enableGlow: applyCrt && gv.enable_glow,
									enableFringing: applyCrt && gv.enable_fringing,
									enableAperture: applyCrt && gv.enable_aperture,
									noiseIntensity: gv.noiseIntensity,
									colorBleed: gv.colorBleed,
									blurIntensity: gv.blurIntensity,
										glowColor: gv.glowColor,
									},
								};
								if (frameColorHandle !== null) {
									crtState.colorTex = ctx.getTex(frameColorHandle);
								}
								if (useDither) {
									crtState.colorTex = ctx.getTex(deviceColorHandle);
								}
								this.setState('crt', crtState);
							}
							this.execute(desc.id, null);
					} else if (isStateOnly) {
						// Even for state-only passes, route through execute() to keep behavior uniform.
						this.execute(desc.id, null);
					} else {
						if (frameColorHandle == null || frameDepthHandle == null) return;
						const needsDepth = desc.writesDepth || desc.depthTest;
						const defaultWrites: RenderGraphSlot[] = needsDepth ? ['frame_color', 'frame_depth'] : ['frame_color'];
						const writeSlots = graph?.writes?.length ? graph.writes : defaultWrites;
						let colorHandle: number = null;
						let depthHandle: number = null;
						for (const slot of writeSlots) {
							switch (slot) {
								case 'frame_depth':
									depthHandle = getHandle(slot);
									break;
								default:
									colorHandle = getHandle(slot);
									break;
							}
						}
						this.execute(desc.id, ctx.getFBO(colorHandle, depthHandle) as WebGLFramebuffer);
					}
				}
			});
		}

		return rg;
	}

	// Enable/disable passes at runtime (debug/editor)
	setPassEnabled(id: string, enabled: boolean): void {
		this.passEnabled.set(id, enabled);
	}
	isPassEnabled(id: string): boolean { return this.passEnabled.get(id) ?? true; }
}
