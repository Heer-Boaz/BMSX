/*
 * Render pass scheduler for the frontend presentation pipeline.
 *
 * Machine-visible VDP state enters through device output snapshots; this graph
 * only orders frontend texture passes and owns no emulated state.
 */
import type { color_arr } from '../../rompack/format';
import type {
	ColorAttachmentSpec,
	DepthAttachmentSpec,
	GPUBackend,
	PassEncoder,
	RenderPassDesc,
	TextureHandle,
} from '../backend/backend';
import { checkWebGLError } from '../backend/webgl/helpers';

// Internal graph texture handle. Named distinctly to avoid collision with existing TextureManager TextureHandle.
export type RGTexHandle = number;

export interface TexDesc {
	width: number;
	height: number;
	format?: GLenum; // optional backend-owned format selection
	depth?: boolean; // depth/stencil target if true
	name?: string;
	transient?: boolean; // hint: contents not needed after pass (storeOp dont_care)
}

export interface FrameData {
	frameIndex: number;
	time: number;
	delta: number;
}

// FrameData helpers (moved here to simplify file structure)
let extFrameIndex = 0;
let extTimeSeconds = 0;
let extDeltaSeconds = 0;
export function updateExternalFrameTiming(frameIndex: number, timeSeconds: number, deltaSeconds: number): void {
	extFrameIndex = frameIndex;
	extTimeSeconds = timeSeconds;
	extDeltaSeconds = deltaSeconds;
}

export function buildFrameData(): FrameData {
	return {
		frameIndex: extFrameIndex,
		time: extTimeSeconds,
		delta: extDeltaSeconds,
	};
}

// Pass authoring interfaces -------------------------------------------------

export interface IOBuilder {
	createTex(desc: TexDesc): RGTexHandle; // allocate logical resource
	readTex(handle: RGTexHandle): void;    // declare read dependency
	writeTex(handle: RGTexHandle, opts?: { clearColor?: color_arr; clearDepth?: number }): void; // declare write + optional clear
	exportToBackbuffer(handle: RGTexHandle): void; // mark final output
}

export interface PassContext {
	getTex(handle: RGTexHandle): TextureHandle;
	getFBO(color: RGTexHandle, depth?: RGTexHandle): unknown;
	setDebugLabel?(label: string): void;
	backend: GPUBackend;
}

export interface RenderPass<SetupOut = unknown> {
	name: string;
	setup(io: IOBuilder, frame: FrameData): SetupOut; // declare dependencies
	execute(ctx: PassContext, frame: FrameData, data: SetupOut): void; // issue GL commands
	/**
	 * Force execution even if the pass has no declared resource dependencies making it unreachable
	 * from the exported backbuffer resource. Useful for side-effect / state aggregation passes
	 * (e.g. FrameSharedState) or passes that perform manual FBO rendering without declaring
	 * writes while pass ownership is being moved into the graph. Long term these should declare proper writeTex() calls and the
	 * single-writer restriction relaxed to allow sequential writers.
	 */
	alwaysExecute?: boolean;
}

type FramebufferHandle = unknown; // Opaque backend-specific framebuffer handle

interface InternalTexResource {
	desc: TexDesc;
	tex: TextureHandle;           // physical texture (may be shared via aliasing)
	fboColorOnly: FramebufferHandle; // color-only convenience FBO (or equivalent)
	fboDepthHandle: FramebufferHandle;
	fboDepthAttachment: RGTexHandle;
	readers: number;
	writerPasses: number[]; // supports multiple sequential writers (overlays)
	readPasses: number[];
	present?: boolean;
	exportPass?: number;
	firstUse?: number;
	lastUse?: number;
	physicalId?: number;
	clearOnWrite?: { color?: color_arr; depth?: number };
}

// Using unified GPUBackend abstraction (WebGLBackend) from backend/backend.ts

export class RenderGraphRuntime {
	public backend: GPUBackend;
	private passes: RenderPass<unknown>[] = [];
	private compiled = false;
	private texResources: InternalTexResource[] = [];
	// DAG data
	private passOrder: number[] = []; // topologically sorted indices
	private reachable: boolean[] = [];
	// Cached per-pass dependency data (populated during compile) for use during execute (transitions, stats)
	private _passWrites: { tex: RGTexHandle; clear?: { color?: color_arr; depth?: number } }[][] = [];
	private _setupData: unknown[] = []; // per-pass setup() return values
	private readonly passContext: PassContext;
	private readonly passDesc: RenderPassDesc = {};
	private readonly passColorAttachments: ColorAttachmentSpec[] = [];
	private readonly passDepthAttachment: DepthAttachmentSpec = { tex: null };

	constructor(backend: GPUBackend) {
		this.backend = backend;
		this.passContext = {
			getTex: (h) => {
				const resource = this.texResources[h];
				if (!resource) {
					throw new Error(`[RenderGraph] Texture handle ${h} is not registered.`);
				}
				return resource.tex as TextureHandle;
			},
			getFBO: (color, depth) => {
				const colorRes = this.texResources[color];
				if (!colorRes) {
					throw new Error(`[RenderGraph] Color attachment ${color} is not registered.`);
				}
				if (depth === undefined) return colorRes.fboColorOnly;
				const depthRes = this.texResources[depth];
				if (!depthRes) {
					throw new Error(`[RenderGraph] Depth attachment ${depth} is not registered.`);
				}
				if (colorRes.fboDepthAttachment !== depth) {
					throw new Error(`[RenderGraph] FBO for color=${color}, depth=${depth} was not compiled.`);
				}
				return colorRes.fboDepthHandle;
			},
			backend: this.backend,
		};
	}

	addPass(pass: RenderPass): void {
		if (this.compiled) throw Error('RenderGraph already compiled. Add passes before compile().');
		this.passes.push(pass);
	}

	compile(frame: FrameData): void {
		// Build dependency data (reads/writes) & then topologically sort reachable passes.
		let nextHandle: RGTexHandle = 1; // 0 reserved / invalid

		const texMap = new Map<RGTexHandle, InternalTexResource>();
		const self = this;
		function allocTex(desc: TexDesc): RGTexHandle {
			const handle = nextHandle++ as RGTexHandle;
			const res: InternalTexResource = { desc, tex: null, fboColorOnly: null, fboDepthHandle: null, fboDepthAttachment: 0, readers: 0, readPasses: [], writerPasses: [] };
			texMap.set(handle, res);
			return handle;
		}

		const setupData: unknown[] = [];
		const passWrites: { tex: RGTexHandle; clear?: { color?: color_arr; depth?: number } }[][] = [];
		const passReads: { tex: RGTexHandle }[][] = [];

		for (let pIndex = 0; pIndex < this.passes.length; pIndex++) {
			const pass = this.passes[pIndex];
			passWrites[pIndex] = [];
			passReads[pIndex] = [];
			const io: IOBuilder = {
				createTex: (desc) => allocTex(desc),
				readTex: (h) => { const r = texMap.get(h); if (r) { r.readers++; r.readPasses.push(pIndex); r.lastUse = Math.max(r.lastUse ?? -1, pIndex); if (r.firstUse === undefined) r.firstUse = pIndex; passReads[pIndex].push({ tex: h }); } },
				writeTex: (h, opts) => { const r = texMap.get(h); if (r) { if (r.writerPasses[r.writerPasses.length - 1] !== pIndex) r.writerPasses.push(pIndex); r.firstUse = r.firstUse === undefined ? pIndex : Math.min(r.firstUse, pIndex); r.lastUse = Math.max(r.lastUse ?? -1, pIndex); if (opts && (opts.clearColor || opts.clearDepth !== undefined)) r.clearOnWrite = { color: opts.clearColor, depth: opts.clearDepth }; passWrites[pIndex].push({ tex: h, clear: r.clearOnWrite }); } },
				exportToBackbuffer: (h) => { const r = texMap.get(h); if (r) { r.present = true; r.exportPass = pIndex; r.lastUse = Math.max(r.lastUse ?? -1, pIndex); } },
			};
			const data = pass.setup(io, frame);
			setupData.push(data);
		}

		// Validate single present (backbuffer export)
		let presentTex: InternalTexResource = null;
		let presentTexCount = 0;
		for (const resource of texMap.values()) {
			if (resource.present) {
				presentTex = resource;
				presentTexCount += 1;
			}
		}
		if (presentTexCount !== 1) {
			throw Error(`RenderGraph validation failed: expected exactly 1 present/exported texture, found ${presentTexCount}.`);
		}
		// Build reachability from present backwards
		const passCount = this.passes.length;
		this.reachable = new Array(passCount).fill(false);
		function markPass(p: number): void {
			if (p < 0 || self.reachable[p]) return; self.reachable[p] = true;
			// Any pass that wrote a resource this pass reads is a dependency
			for (const r of passReads[p]) {
				const texRes = texMap.get(r.tex);
				if (texRes && texRes.writerPasses.length) for (const wp of texRes.writerPasses) markPass(wp);
			}
			// Also include writer of any texture this pass exports (present) – handled via lastUse marking above
		}
		// Present texture's writer chain
		const finalRes = presentTex;
		if (finalRes.exportPass !== undefined) markPass(finalRes.exportPass);
		// Mark all writers of the presented resource so overlays are retained in execution order
		if (finalRes.writerPasses.length) for (const wp of finalRes.writerPasses) markPass(wp);
		// Also seed reachability from any pass that reads the presented texture (e.g. Present pass)
		if (finalRes.readPasses) for (const rp of finalRes.readPasses) markPass(rp);
		// Ensure pass that does export (if different) is included
		for (let i = 0; i < passCount; i++) {
			// If this pass explicitly exported, include it (placeholder loop to retain structure)
			for (const _ of passWrites[i]) { /* noop for now */ }
		}
		// Mark any explicitly forced passes reachable (side-effect passes w/o resource edges)
		for (let p = 0; p < passCount; p++) {
			if (this.passes[p].alwaysExecute) this.reachable[p] = true;
		}
		// Topological sort (Kahn) on reachable subgraph
		// Build adjacency & indegree
		const indegree = new Array(passCount).fill(0);
		const adj: number[][] = new Array(passCount).fill(0).map((): number[] => []);
		for (let p = 0; p < passCount; p++) {
			if (!this.reachable[p]) continue;
			// For each read, add edge writer -> p
			for (const r of passReads[p]) {
				const texRes = texMap.get(r.tex);
				if (texRes && texRes.writerPasses.length) for (const wp of texRes.writerPasses) if (wp !== p) adj[wp].push(p);
			}
		}
		// Enforce sequential order between multiple writers of the same texture
		for (const res of texMap.values()) {
			if (res.writerPasses.length > 1) {
				const writers = [...res.writerPasses].sort((a, b) => a - b);
				for (let wi = 0; wi < writers.length - 1; wi++) {
					const a = writers[wi];
					const b = writers[wi + 1];
					adj[a].push(b);
				}
			}
		}
		for (let p = 0; p < passCount; p++) if (this.reachable[p]) for (const to of adj[p]) indegree[to]++;
		const queue: number[] = [];
		for (let p = 0; p < passCount; p++) if (this.reachable[p] && indegree[p] === 0) queue.push(p);
		const order: number[] = [];
		while (queue.length) {
			const n = queue.shift()!; order.push(n);
			for (const to of adj[n]) { indegree[to]--; if (indegree[to] === 0 && this.reachable[to]) queue.push(to); }
		}
		this.passOrder = order;
		const reachableCount = this.reachable.reduce((n, v) => v ? n + 1 : n, 0);
		if (order.length !== reachableCount) throw Error('RenderGraph cycle detected (reachable=' + reachableCount + ' sorted=' + order.length + ')');

		// Resource lifetime / alias planning
		const logicalResources: { handle: RGTexHandle; res: InternalTexResource }[] = [];
		for (const [handle, res] of texMap) {
			if (!res.firstUse && res.firstUse !== 0) continue; // unused
			logicalResources.push({ handle, res });
		}
		// Sort by firstUse for greedy aliasing
		logicalResources.sort((a, b) => (a.res.firstUse! - b.res.firstUse!));
		interface ActivePhys { id: number; lastUse: number; desc: TexDesc }
		const active: ActivePhys[] = [];
		const freePool: ActivePhys[] = [];
		let nextPhysId = 1;
		function textureDescriptionsCompatible(a: TexDesc, b: TexDesc): boolean {
			if (!!a.depth !== !!b.depth) return false;
			if (a.width !== b.width || a.height !== b.height) return false;
			return a.format === b.format;
		}
		for (const lr of logicalResources) {
			// Expire finished actives -> freePool
			for (let i = active.length - 1; i >= 0; i--) {
				if (active[i].lastUse < lr.res.firstUse!) { freePool.push(active[i]); active.splice(i, 1); }
			}
			// Pick compatible released physical, prefer matching transient flag
			let chosen: ActivePhys | null = null;
			let chosenIndex = -1;
			for (let i = 0; i < freePool.length; i++) {
				const f = freePool[i];
				if (!textureDescriptionsCompatible(f.desc, lr.res.desc)) continue;
				const matchTransient = (!!f.desc.transient) === (!!lr.res.desc.transient);
				if (matchTransient) {
					chosen = f;
					chosenIndex = i;
					break;
				}
				if (!chosen) {
					chosen = f;
					chosenIndex = i;
				}
			}
			if (chosen !== null) {
				freePool.splice(chosenIndex, 1);
				chosen.lastUse = lr.res.lastUse!;
				chosen.desc = lr.res.desc;
			} else {
				chosen = { id: nextPhysId++, lastUse: lr.res.lastUse!, desc: lr.res.desc };
			}
			lr.res.physicalId = chosen.id;
			active.push(chosen);
		}

		// Store textures
		for (const [handle, res] of texMap) (this.texResources as InternalTexResource[])[handle] = res;
		this._setupData = setupData;
		// Persist dependency info for execution phase (avoids rescanning resources)
		this._passWrites = passWrites;
		this.compiled = true;
	}

	execute(frame: FrameData): void {
		if (!this.compiled) this.compile(frame);
		const setupData: unknown[] = this._setupData;

		this.realizeAll();

		const order = this.passOrder;
		const desc = this.passDesc;
		const colorAttachments = this.passColorAttachments;
		const depthAttachment = this.passDepthAttachment;
		for (let oi = 0; oi < order.length; oi++) {
			const i = order[oi];
			checkWebGLError(`Before pass execution: ${i}: ${this.passes[i].name}`);
			if (this.reachable.length && !this.reachable[i]) continue;
			const pass = this.passes[i];
			const writes = this._passWrites[i];
			let colorAttachmentCount = 0;
			let depthRes: InternalTexResource = null;
			for (let writeIndex = 0; writeIndex < writes.length; writeIndex++) {
				const resource = this.texResources[writes[writeIndex].tex];
				if (resource.desc.depth) {
					depthRes = resource;
				} else {
					let colorAttachment = colorAttachments[colorAttachmentCount];
					if (colorAttachment === undefined) {
						colorAttachment = { tex: null };
						colorAttachments[colorAttachmentCount] = colorAttachment;
					}
					colorAttachment.tex = resource.tex as TextureHandle;
					colorAttachment.clear = colorAttachmentCount === 0 && resource.writerPasses[0] === i ? resource.clearOnWrite?.color : undefined;
					colorAttachment.discardAfter = !!resource.desc.transient;
					colorAttachmentCount += 1;
				}
			}

			let passEnc: PassEncoder | null = null;
			if (colorAttachmentCount !== 0 || depthRes !== null) {
				colorAttachments.length = colorAttachmentCount;
				desc.label = pass.name;
				desc.color = colorAttachmentCount !== 0 ? colorAttachments[0] : undefined;
				desc.colors = colorAttachmentCount !== 0 ? colorAttachments : undefined;
				if (depthRes !== null) {
					depthAttachment.tex = depthRes.tex as TextureHandle;
					depthAttachment.clearDepth = depthRes.writerPasses[0] === i && depthRes.clearOnWrite ? depthRes.clearOnWrite.depth : undefined;
					depthAttachment.discardAfter = !!depthRes.desc.transient;
					desc.depth = depthAttachment;
				} else {
					desc.depth = undefined;
				}
				passEnc = this.backend.beginRenderPass(desc);
			}

			pass.execute(this.passContext, frame, setupData[i]);
			if (passEnc !== null) {
				this.backend.endRenderPass(passEnc);
			}
		}
	}

	private realizeAll(): void {
		// Create physical textures for each alias group lazily; map physicalId -> backend TextureHandle
		const physTex = new Map<number, TextureHandle>();
		for (let h = 0; h < this.texResources.length; h++) {
			const res = this.texResources[h];
			if (!res) continue;
			if (res.tex) continue; // already realized
			const pid = res.physicalId;
			if (pid === undefined) {
				throw new Error('[RenderGraph] Texture was not assigned a physical resource.');
			}
			if (!physTex.has(pid)) {
				const desc = res.desc;
				const tex = desc.depth ? this.backend.createDepthTexture(desc) : this.backend.createColorTexture(desc);
				physTex.set(pid, tex);
			}
			res.tex = physTex.get(pid)!;
			// Build color-only FBO for color targets
			if (!res.desc.depth && !res.fboColorOnly) {
				res.fboColorOnly = this.backend.createRenderTarget(res.tex, null) as FramebufferHandle;
			}
		}

		for (let passIndex = 0; passIndex < this._passWrites.length; passIndex += 1) {
			const writes = this._passWrites[passIndex];
			let colorHandle: RGTexHandle = 0;
			let depthHandle: RGTexHandle = 0;
			for (let writeIndex = 0; writeIndex < writes.length; writeIndex += 1) {
				const handle = writes[writeIndex].tex;
				const resource = this.texResources[handle];
				if (resource.desc.depth) {
					depthHandle = handle;
				} else if (colorHandle === 0) {
					colorHandle = handle;
				}
			}
			if (colorHandle !== 0 && depthHandle !== 0) {
				const colorResource = this.texResources[colorHandle];
				if (colorResource.fboDepthAttachment !== depthHandle) {
					const depthResource = this.texResources[depthHandle];
					colorResource.fboDepthHandle = this.backend.createRenderTarget(colorResource.tex, depthResource.tex) as FramebufferHandle;
					colorResource.fboDepthAttachment = depthHandle;
				}
			}
		}
	}

	invalidate(): void {
		this.compiled = false;
		this.passOrder = [];
		this.reachable = [];
		this.texResources = [];
	}
}
