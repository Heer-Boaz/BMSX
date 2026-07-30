import type { GxGpuDeviceOutput } from '../../../machine/devices/gx/device_output';
import type { VideoPresenter } from '../../video_presenter';
import { RenderGraphRuntime, type PassContext } from '../../graph/graph';
import type { vec4arr } from '../../../common/vector';
import { GPUBackend, PassEncoder, RenderGraphPassContext, RenderGraphSlot, RenderPassDef, RenderPassDesc, RenderPassInstanceHandle, RenderPassStateId, RenderPassStateRegistry } from '../backend';

const FRAME_CLEAR_COLOR: vec4arr = [0, 0, 0, 1];

interface RegisteredPassRec {
	id: string;
	exec: (
		backend: GPUBackend,
		fbo: unknown,
		state: unknown,
		pipelineHandle: RenderPassInstanceHandle | null,
		output: GxGpuDeviceOutput,
	) => void;
	prepare?: (backend: GPUBackend, state: unknown) => void;
	teardown?: (backend: GPUBackend) => void;
	pipelineHandle: RenderPassInstanceHandle | null;
	ownsPipelineHandle: boolean;
	passEncoder: PassEncoder;
	state?: unknown;
	bindingLayout?: RenderPassDef['bindingLayout'];
	present?: boolean;
}

export class RenderPassLibrary {
	private passes: RenderPassDef[] = []; // Mutable list for ordering/scheduling
	private passEnabled = new Map<string, boolean>();
	private registered = new Map<string, RegisteredPassRec>();
	constructor(private backend: GPUBackend, public readonly presenter: VideoPresenter) {
		this.backend.registerBuiltinPasses(this);
	}

	register<S = unknown>(desc: RenderPassDef<S>): void {
		const idStr = String(desc.id);
		if (this.registered.has(idStr)) throw new Error(`Render pass '${desc.id}' already registered`);
		let pipelineHandle: RenderPassInstanceHandle | null = null;
		let ownsPipelineHandle = false;
		if (desc.sharedPipelineWith) {
			const sharedPassId = String(desc.sharedPipelineWith);
			const sharedPass = this.registered.get(sharedPassId);
			if (!sharedPass) {
				throw new Error(`Render pass '${desc.id}' cannot share GPU pipeline with unregistered pass '${sharedPassId}'`);
			}
			if (!sharedPass.pipelineHandle) {
				throw new Error(`Render pass '${desc.id}' cannot share GPU pipeline with pass '${sharedPassId}' because it has no pipeline handle`);
			}
			if (desc.vsCode || desc.fsCode) {
				throw new Error(`Render pass '${desc.id}' cannot define shaders when sharedPipelineWith='${sharedPassId}'`);
			}
			pipelineHandle = sharedPass.pipelineHandle;
		} else if (desc.vsCode || desc.fsCode) {
			pipelineHandle = this.backend.createRenderPassInstance({
				label: desc.name,
				vsCode: desc.vsCode,
				fsCode: desc.fsCode,
				bindingLayout: desc.bindingLayout,
				usesDepth: !!(desc.writesDepth || desc.depthTest),
				depthTest: !!desc.depthTest,
				depthWrite: desc.depthWrite ?? !!desc.writesDepth,
			});
			ownsPipelineHandle = true;
		}
		const rec: RegisteredPassRec = {
			id: idStr,
			exec: desc.exec,
			prepare: desc.prepare,
			teardown: desc.teardown,
			pipelineHandle,
			ownsPipelineHandle,
			passEncoder: { fbo: null, desc: { label: idStr } as RenderPassDesc },
			state: desc.initialState,
			bindingLayout: desc.bindingLayout,
			present: !!desc.present,
		};
		// One-time bootstrap for GPU resources
		if (desc.bootstrap) {
			if (pipelineHandle && this.backend.bindRenderPassPipeline) {
				this.backend.bindRenderPassPipeline(rec.passEncoder, pipelineHandle, desc.bindingLayout);
			}
			desc.bootstrap(this.backend);
		}
		this.registered.set(rec.id, rec);
		this.passes.push(desc);
	}

	dispose(): void {
		for (let index = this.passes.length - 1; index >= 0; index -= 1) {
			const rec = this.registered.get(String(this.passes[index].id))!;
			rec.teardown?.(this.backend);
			if (rec.ownsPipelineHandle) this.backend.destroyRenderPassInstance(rec.pipelineHandle!);
		}
		this.passes.length = 0;
		this.passEnabled.clear();
		this.registered.clear();
	}

	setState<PState extends RenderPassStateId>(id: PState, state: RenderPassStateRegistry[PState]): void {
		const p = this.registered.get(String(id)); if (!p) throw new Error(`Render pass '${String(id)}' not found`);
		p.state = state;
	}
	getState<PState extends RenderPassStateId>(id: PState): RenderPassStateRegistry[PState] {
		const pass = this.registered.get(String(id));
		if (!pass) throw new Error(`Render pass '${String(id)}' not found`);
		return pass.state as RenderPassStateRegistry[PState];
	}

	execute(id: string, fbo: unknown, output: GxGpuDeviceOutput): void {
		const p = this.registered.get(String(id)); if (!p) throw new Error(`Render pass '${id}' not found`);
		const backend = this.backend;
		if (p.pipelineHandle) {
			const passEncoder = p.passEncoder;
			passEncoder.fbo = fbo;
			if (backend.bindRenderPassPipeline) {
				backend.bindRenderPassPipeline(passEncoder, p.pipelineHandle, p.bindingLayout);
			} else {
				backend.setGraphicsPipeline(passEncoder, p.pipelineHandle);
			}
		}
		p.prepare?.(backend, p.state);
		p.exec(backend, fbo, p.state, p.pipelineHandle, output);
	}
	has(id: string): boolean { return this.registered.has(String(id)); }

	// Passes list access
	getPipelinePasses(): readonly RenderPassDef[] { return this.passes; }
	insertPipelinePass(pass: RenderPassDef, index: number): void {
		if (index < 0 || index > this.passes.length) index = this.passes.length;
		this.passes.splice(index, 0, pass);
		// Caller must register executable passes before insertion.
	}

	// Build render graph from current pass registry with Clear/Present wiring
	buildRenderGraph(): RenderGraphRuntime {
		const presenter = this.presenter;
		const rg = new RenderGraphRuntime(presenter.backend);
		const offscreenWidth = presenter.offscreenCanvasSize.x;
		const offscreenHeight = presenter.offscreenCanvasSize.y;
		let frameColorHandle: number = null;
		let frameDepthHandle: number = null;
		let frameHistoryAHandle: number = null;
		let frameHistoryBHandle: number = null;
		let deviceColorHandle: number = null;
		let activePassContext: PassContext = null;
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
					return frameHistoryAHandle;
				case 'frame_history_b':
					return frameHistoryBHandle;
				case 'device_color':
					return deviceColorHandle;
			}
		};
		const declareGraphRead = (io: { readTex(handle: number): void }, slot: RenderGraphSlot): void => {
			if (slot === 'device_color' && !deviceColorEnabled) {
				return;
			}
			io.readTex(getHandle(slot));
		};
		const graphCtx: RenderGraphPassContext = {
			presenter,
			frameIndex: 0,
			time: 0,
			delta: 0,
			getTex: (slot: RenderGraphSlot) => activePassContext.getTex(getHandle(slot)),
			deviceColorEnabled,
		};

		rg.addPass({
			name: 'FrameTargets',
			setup: (io) => {
				const color = io.createTex({ width: offscreenWidth, height: offscreenHeight, name: 'FrameColor' });
				const depth = io.createTex({ width: offscreenWidth, height: offscreenHeight, depth: true, name: 'FrameDepth' });
				const historyA = io.createTex({ width: offscreenWidth, height: offscreenHeight, name: 'FrameHistoryA', initialClearColor: FRAME_CLEAR_COLOR });
				const historyB = io.createTex({ width: offscreenWidth, height: offscreenHeight, name: 'FrameHistoryB', initialClearColor: FRAME_CLEAR_COLOR });
				deviceColorHandle = null;
				if (deviceColorEnabled) {
					deviceColorHandle = io.createTex({ width: offscreenWidth, height: offscreenHeight, name: 'DeviceColor', transient: true });
				}
				io.exportToBackbuffer(historyA);
				frameColorHandle = color;
				frameDepthHandle = depth;
				frameHistoryAHandle = historyA;
				frameHistoryBHandle = historyB;
				return null;
			},
			execute: () => { },
		});

		rg.addPass({
			name: 'FrameClear',
			alwaysExecute: true,
			setup: (io) => {
				if (frameColorHandle != null) io.writeTex(frameColorHandle, { clearColor: FRAME_CLEAR_COLOR });
				if (frameDepthHandle != null) io.writeTex(frameDepthHandle, { clearDepth: 1.0 });
				return null;
			},
			execute: () => { },
		});

		// Ensure the frame UBO is uploaded/bound before any draw pass.
		if (this.has('frame_resolve')) {
			rg.addPass({
				name: 'FrameResolve',
				alwaysExecute: true,
				setup: () => null,
				execute: (_ctx, _frame, _data, output) => {
					this.execute('frame_resolve', null, output);
				},
			});
		}

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
						io.readTex(frameHistoryAHandle);
						io.readTex(frameHistoryBHandle);
					} else if (graph && (graph.reads?.length || graph.writes?.length)) {
						if (graph.reads) for (const slot of graph.reads) declareGraphRead(io, slot);
						if (graph.writes) for (const slot of graph.writes) io.writeTex(getHandle(slot));
					} else if (!isPresent && !isStateOnly) {
						if (frameColorHandle != null) io.writeTex(frameColorHandle);
						if (desc.writesDepth && frameDepthHandle != null) io.writeTex(frameDepthHandle);
						else if (desc.depthTest && frameDepthHandle != null) io.readTex(frameDepthHandle);
					}
					return { width: offscreenWidth, height: offscreenHeight, present: isPresent };
				},
				execute: (ctx, _frame, data: { width: number; height: number; present: boolean }, output) => {
					const enabled = this.isPassEnabled(desc.id);
					const willRun = enabled && (!desc.shouldExecute || desc.shouldExecute(presenter));
					if (!willRun) return;
					const graph = desc.graph;
					if (graph?.writeState) {
						activePassContext = ctx;
						graphCtx.frameIndex = _frame.frameIndex;
						graphCtx.time = _frame.time;
						graphCtx.delta = _frame.delta;
						const passId = desc.id as RenderPassStateId;
						graph.writeState(graphCtx, this.getState(passId));
					} else if (graph?.buildState) {
						activePassContext = ctx;
						graphCtx.frameIndex = _frame.frameIndex;
						graphCtx.time = _frame.time;
						graphCtx.delta = _frame.delta;
						const builtState = graph.buildState(graphCtx) as RenderPassStateRegistry[RenderPassStateId];
						this.setState(desc.id as RenderPassStateId, builtState);
					}
					if (data.present) {
						this.execute(desc.id, null, output);
					} else if (isStateOnly) {
						// Even for state-only passes, route through execute() to keep behavior uniform.
						this.execute(desc.id, null, output);
					} else {
						if (frameColorHandle == null || frameDepthHandle == null) return;
						const needsDepth = desc.writesDepth || desc.depthTest;
						const defaultWrites: RenderGraphSlot[] = needsDepth ? ['frame_color', 'frame_depth'] : ['frame_color'];
						const writeSlots = graph?.writes?.length ? graph.writes : defaultWrites;
						let colorHandle = 0;
						let depthHandle = 0;
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
						const fbo = depthHandle === 0
							? ctx.getFBO(colorHandle)
							: ctx.getFBO(colorHandle, depthHandle);
						this.execute(desc.id, fbo as WebGLFramebuffer, output);
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
