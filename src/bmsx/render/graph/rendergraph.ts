/**
 * Generic render graph scaffolding (initial draft).
 *
 * Goal: Provide a minimal, engine-agnostic abstraction to declare passes with
 * explicit resource dependencies (textures + values) and execute them in
 * topological order. This file intentionally avoids touching existing pipeline
 * code so migration can be incremental.
 */
import { $ } from '../../core/game';
import { taskGate } from '../../core/taskgate';
import { color_arr } from '../../rompack/rompack';
import { Camera } from '../3d/camera3d';
import { GPUBackend, TextureHandle } from '../backend/pipeline_interfaces';
import { RenderPassBuilder } from '../backend/renderpass_builder';
import { checkWebGLError } from '../backend/webgl/webgl.helpers';
import { WebGPUBackend, WebGPUPassEncoder } from '../backend/webgpu/webgpu_backend';

// Internal graph texture handle. Named distinctly to avoid collision with existing TextureManager TextureHandle.
export type RGTexHandle = number;
export type ValueHandle<T = unknown> = RGTexHandle & { readonly __t?: T };

export interface TexDesc {
    width: number;
    height: number;
    format?: GLenum; // optional, fallback decided at realization
    depth?: boolean; // depth/stencil target if true
    name?: string;
    transient?: boolean; // hint: contents not needed after pass (storeOp dont_care)
}

export interface Viewport { x: number; y: number; w: number; h: number; }

export interface View {
    name: string;
    viewport: Viewport;
    viewMatrix: Float32Array;
    projMatrix: Float32Array;
    viewProj: Float32Array;
    invView: Float32Array;
    invProj: Float32Array;
    cameraPos: Float32Array | { x: number; y: number; z: number };
    flags?: number; // bit flags for skybox, ui, etc.
}

export interface FrameData {
    frameIndex: number;
    time: number;
    delta: number;
    views: View[];
    // Lights, postFx, etc. are attached here later.
    // Using index signature to stay flexible during migration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [k: string]: any;
}


// Public debug info interface (exported separately)
export interface RGTexDebugInfo {
    index: number;
    name?: string;
    firstUse?: number;
    lastUse?: number;
    writers: number[];
    readers: number[];
    physicalId?: number;
    present?: boolean;
    transient?: boolean;
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
interface CRTOptionsCarrier {
    // CRT/post-processing options exposed by the view
    applyNoise: boolean; applyColorBleed: boolean; applyScanlines: boolean; applyBlur: boolean; applyGlow: boolean; applyFringing: boolean;
    noiseIntensity: number; colorBleed: [number, number, number]; blurIntensity: number; glowColor: [number, number, number];
    canvas: HTMLCanvasElement;
}
export function buildFrameData(view: { offscreenCanvasSize: { x: number; y: number } } & Partial<CRTOptionsCarrier>): FrameData {
    const mainCam = $.world.activeCamera3D as Camera | undefined;
    const views: View[] = [];
    if (mainCam) {
        const invView = mainCam.view; // inverse not exposed
        const invProj = mainCam.projection; // inverse not exposed
        const cameraPos = mainCam.position;
        views.push({
            name: 'Main',
            viewport: { x: 0, y: 0, w: view.offscreenCanvasSize.x, h: view.offscreenCanvasSize.y },
            viewMatrix: mainCam.view,
            projMatrix: mainCam.projection,
            viewProj: mainCam.viewProjection,
            invView,
            invProj,
            cameraPos,
            flags: 0,
        });
    }
    const frame: FrameData = {
        frameIndex: extFrameIndex,
        time: extTimeSeconds,
        delta: extDeltaSeconds,
        views,
        postFx: view && typeof view.noiseIntensity === 'number' ? {
            crt: {
                noise: view.noiseIntensity,
                colorBleed: view.colorBleed as [number, number, number],
                blur: view.blurIntensity,
                glowColor: view.glowColor as [number, number, number],
                flags: {
                    noise: !!view.applyNoise,
                    colorBleed: !!view.applyColorBleed,
                    scanlines: !!view.applyScanlines,
                    blur: !!view.applyBlur,
                    glow: !!view.applyGlow,
                    fringe: !!view.applyFringing,
                },
            },
        } : undefined,
    } as FrameData;
    return frame;
}

// Pass authoring interfaces -------------------------------------------------

export interface IOBuilder {
    createTex(desc: TexDesc): RGTexHandle; // allocate logical resource
    readTex(handle: RGTexHandle): void;    // declare read dependency
    writeTex(handle: RGTexHandle, opts?: { clearColor?: color_arr; clearDepth?: number }): void; // declare write + optional clear
    exportToBackbuffer(handle: RGTexHandle): void; // mark final output
    provideValue<T>(val: T): ValueHandle<T>; // immediate value handle
    readValue(handle: ValueHandle): void; // declare value read
}

export interface PassContext {
    getTex(handle: RGTexHandle): TextureHandle | null;
    getFBO(color: RGTexHandle, depth?: RGTexHandle): unknown | null;
    getValue<T>(handle: ValueHandle<T>): T;
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
     * (e.g. FrameSharedState) or legacy passes that perform manual FBO rendering without declaring
     * writes (migration aid). Long term these should declare proper writeTex() calls and the
     * single-writer restriction relaxed to allow sequential writers.
     */
    alwaysExecute?: boolean;
}

type FramebufferHandle = unknown; // Opaque backend-specific framebuffer handle

interface InternalTexResource {
    desc: TexDesc;
    tex: TextureHandle | null;           // physical texture (may be shared via aliasing)
    fboColorOnly: FramebufferHandle | null; // color-only convenience FBO (or equivalent)
    fboWithDepth?: { depth: RGTexHandle; fbo: FramebufferHandle }; // paired depth FBO cache
    readers: number;
    writerPasses: number[]; // supports multiple sequential writers (overlays)
    readPasses: number[];
    present?: boolean;
    exportPass?: number;
    firstUse?: number;
    lastUse?: number;
    physicalId?: number;
    clearOnWrite?: { color?: color_arr; depth?: number };
    state?: { layout: string };
}

interface InternalValueResource<T = unknown> {
    val: T;
    readers: number;
    providerPass?: number; // pass index that created value
    readPasses: number[];  // passes that read it
    firstUse?: number;     // first providing or reading pass
    lastUse?: number;      // last reading pass (or provider if never read)
}

// Using unified GPUBackend abstraction (WebGLBackend) from backend/webgl_backend.ts

export class RenderGraphRuntime {
    public backend: GPUBackend;
    private passes: RenderPass<unknown>[] = [];
    private compiled = false;
    private texResources: InternalTexResource[] = [];
    private valueResources: InternalValueResource[] = [];
    private passStats: { name: string; ms: number }[] = [];
    // DAG data
    private passOrder: number[] = []; // topologically sorted indices
    private reachable: boolean[] = [];
    private _pendingInvalidateOnReady: boolean = false;
    // Cached per-pass dependency data (populated during compile) for use during execute (transitions, stats)
    private _passReads: { tex: RGTexHandle }[][] = [];
    private _passWrites: { tex: RGTexHandle; clear?: { color?: color_arr; depth?: number } }[][] = [];
    private _setupData: unknown[] = []; // per-pass setup() return values

    constructor(backend: GPUBackend) { this.backend = backend; }

    addPass(pass: RenderPass): void {
        if (this.compiled) throw Error('RenderGraph already compiled. Add passes before compile().');
        this.passes.push(pass);
    }

    compile(frame: FrameData): void {
        // Build dependency data (reads/writes) & then topologically sort reachable passes.
        let nextHandle: RGTexHandle = 1; // 0 reserved / invalid

        const texMap = new Map<RGTexHandle, InternalTexResource>();
        const valueMap = new Map<ValueHandle, InternalValueResource>();

        const self = this;
        function allocTex(desc: TexDesc): RGTexHandle {
            const handle = nextHandle++ as RGTexHandle;
            const res: InternalTexResource = { desc, tex: null, fboColorOnly: null, readers: 0, readPasses: [], writerPasses: [] };
            texMap.set(handle, res);
            return handle;
        }
        function provideValue<T>(val: T, providerPass: number): ValueHandle<T> {
            const handle = nextHandle++ as ValueHandle<T>;
            const res: InternalValueResource<T> = { val, readers: 0, providerPass, readPasses: [], firstUse: providerPass, lastUse: providerPass };
            valueMap.set(handle, res as InternalValueResource);
            return handle;
        }

        const setupData: unknown[] = [];
        const passWrites: { tex: RGTexHandle; clear?: { color?: color_arr; depth?: number } }[][] = [];
        const passReads: { tex: RGTexHandle }[][] = [];
        const valueReads: { val: ValueHandle }[][] = [];

        for (let pIndex = 0; pIndex < this.passes.length; pIndex++) {
            const pass = this.passes[pIndex];
            passWrites[pIndex] = [];
            passReads[pIndex] = [];
            valueReads[pIndex] = [];
            const io: IOBuilder = {
                createTex: (desc) => allocTex(desc),
                readTex: (h) => { const r = texMap.get(h); if (r) { r.readers++; r.readPasses.push(pIndex); r.lastUse = Math.max(r.lastUse ?? -1, pIndex); if (r.firstUse === undefined) r.firstUse = pIndex; passReads[pIndex].push({ tex: h }); } },
                writeTex: (h, opts) => { const r = texMap.get(h); if (r) { if (r.writerPasses[r.writerPasses.length - 1] !== pIndex) r.writerPasses.push(pIndex); r.firstUse = r.firstUse === undefined ? pIndex : Math.min(r.firstUse, pIndex); r.lastUse = Math.max(r.lastUse ?? -1, pIndex); if (opts && (opts.clearColor || opts.clearDepth !== undefined)) r.clearOnWrite = { color: opts.clearColor, depth: opts.clearDepth }; passWrites[pIndex].push({ tex: h, clear: r.clearOnWrite }); } },
                exportToBackbuffer: (h) => { const r = texMap.get(h); if (r) { r.present = true; r.exportPass = pIndex; r.lastUse = Math.max(r.lastUse ?? -1, pIndex); } },
                provideValue: (v) => provideValue(v, pIndex),
                readValue: (h) => { const r = valueMap.get(h); if (r) { r.readers++; r.readPasses.push(pIndex); r.lastUse = Math.max(r.lastUse ?? -1, pIndex); if (r.firstUse === undefined) r.firstUse = pIndex; valueReads[pIndex].push({ val: h }); } },
            };
            const data = pass.setup(io, frame);
            setupData.push(data);
        }

        // Validate single present (backbuffer export)
        const presentTex = Array.from(texMap.values()).filter(r => r.present);
        if (presentTex.length !== 1) {
            throw Error(`RenderGraph validation failed: expected exactly 1 present/exported texture, found ${presentTex.length}.`);
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
            // Any pass that provided a value this pass reads
            for (const vr of valueReads[p]) {
                const valRes = valueMap.get(vr.val);
                if (valRes && valRes.providerPass !== undefined) markPass(valRes.providerPass);
            }
            // Also include writer of any texture this pass exports (present) – handled via lastUse marking above
        }
        // Present texture's writer chain
        const finalRes = presentTex[0];
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
            // For each value read, add provider -> p
            for (const vr of valueReads[p]) {
                const valRes = valueMap.get(vr.val);
                if (valRes && valRes.providerPass !== undefined && valRes.providerPass !== p) {
                    adj[valRes.providerPass].push(p);
                }
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
        function formatsCompatible(a: TexDesc, b: TexDesc): boolean {
            if (!!a.depth !== !!b.depth) return false;
            if (a.depth) return true; // treat all depth formats as compatible placeholder
            if (a.format === b.format) return true;
            if (!a.format || !b.format) return true; // unspecified acts as wildcard
            // Extend with more nuanced matching (bit depth equivalence) as needed
            return false;
        }
        for (const lr of logicalResources) {
            // Expire finished actives -> freePool
            for (let i = active.length - 1; i >= 0; i--) {
                if (active[i].lastUse < lr.res.firstUse!) { freePool.push(active[i]); active.splice(i, 1); }
            }
            // Sort freePool largest-first by area to reduce fragmentation
            freePool.sort((a, b) => (b.desc.width * b.desc.height) - (a.desc.width * a.desc.height));
            // Pick compatible released physical, prefer matching transient flag
            let chosen: ActivePhys | undefined;
            for (let i = 0; i < freePool.length; i++) {
                const f = freePool[i];
                if (!formatsCompatible(f.desc, lr.res.desc)) continue;
                const matchTransient = (!!f.desc.transient) === (!!lr.res.desc.transient);
                if (matchTransient) { chosen = f; freePool.splice(i, 1); break; }
                if (!chosen) { chosen = f; freePool.splice(i, 1); /* keep searching for better match */ }
            }
            if (!chosen) chosen = { id: nextPhysId++, lastUse: lr.res.lastUse!, desc: lr.res.desc }; else chosen.lastUse = lr.res.lastUse!;
            lr.res.physicalId = chosen.id;
            active.push(chosen);
        }

        // Store textures & only keep value resources that are actually read (cull unused)
        for (const [handle, res] of texMap) (this.texResources as InternalTexResource[])[handle] = res;
        for (const [handle, res] of valueMap) if (res.readers > 0) (this.valueResources as InternalValueResource[])[handle] = res;
        this._setupData = setupData;
        // Persist dependency info for execution phase (avoids rescanning resources)
        this._passReads = passReads;
        this._passWrites = passWrites;
        this.compiled = true;
    }

    execute(frame: FrameData): void {
        // If an external asset/task gate system is present (optional), we can delay execution until
        // blocking async loads finish, and then invalidate once to rebuild resource lifetimes.
        // Integration contract: global taskGate?.group('render') or similar provides readiness.
        const gateGroup = taskGate.group('render');
        if (gateGroup && !gateGroup.ready) return; // Defer frame until required assets loaded
        if (gateGroup && gateGroup.ready && this._pendingInvalidateOnReady) { this.invalidate(); this._pendingInvalidateOnReady = false; }
        checkWebGLError('Before compile');
        if (!this.compiled) this.compile(frame);
        checkWebGLError('After compile');
        const setupData: unknown[] = this._setupData;

        const ctx: PassContext = {
            getTex: (h) => this.texResources[h]?.tex ?? null,
            getFBO: (color, depth) => {
                const colorRes = this.texResources[color];
                if (!colorRes) return null;
                if (!depth) return colorRes.fboColorOnly;
                const depthRes = this.texResources[depth];
                if (!depthRes) return null;
                if (colorRes.fboWithDepth && colorRes.fboWithDepth.depth === depth) return colorRes.fboWithDepth.fbo;
                // Lazy allocate FBOs on demand
                return this.ensureFBO(color, depth);
            },
            getValue: <T>(h: ValueHandle<T>) => (this.valueResources[h] as InternalValueResource<T>).val,
            setDebugLabel: undefined,
            backend: this.backend,
        };

        checkWebGLError('Before realizeAll');

        // Ensure GL objects exist before first pass that needs them
        this.realizeAll();
        checkWebGLError('After realizeAll');

        this.passStats.length = 0;
        const order = this.passOrder.length ? this.passOrder : this.passes.map((_, i) => i); // fallback sequential
        for (let oi = 0; oi < order.length; oi++) {
            checkWebGLError(`Before pass execution: ${order[oi]}: ${this.passes[order[oi]].name}`);
            const i = order[oi];
            if (this.reachable.length && !this.reachable[i]) continue; // skip culled
            const pass = this.passes[i];
            const data = setupData[i];
            // Begin implicit render pass if this pass writes any textures
            let rp: { end: () => void } | null = null;
            const writes: RGTexHandle[] = [];
            if (this._passWrites[i]) {
                for (const w of this._passWrites[i]) writes.push(w.tex);
            } else {
                for (let th = 0; th < this.texResources.length; th++) {
                    const tr = this.texResources[th];
                    if (tr && tr.writerPasses.includes(i)) writes.push(th as RGTexHandle);
                }
            }
            if (writes.length) {
                // Multi-attachment discovery (color targets first, single depth optional)
                const colorTargets: InternalTexResource[] = [];
                let depthRes: InternalTexResource | undefined;
                for (const w of writes) {
                    const r = this.texResources[w]; if (!r) continue;
                    if (r.desc.depth) depthRes = r; else colorTargets.push(r);
                }
                const colorRes = colorTargets[0]; // legacy single color path
                // Simple layout / usage transition heuristic (no-op on WebGL):
                //  * Reads -> shaderRead
                //  * Color attachment writes -> colorAttachment
                //  * Depth attachment writes -> depthAttachment
                const backendTransition = this.backend.transitionTexture?.bind(this.backend);
                if (backendTransition) {
                    const desiredLayouts = new Map<number, string>();
                    const passReads = this._passReads[i] ?? [];
                    for (const r of passReads) {
                        const texRes = this.texResources[r.tex];
                        if (!texRes) continue;
                        if (texRes.writerPasses.includes(i)) continue; // treat as attachment
                        desiredLayouts.set(r.tex, 'shaderRead');
                    }
                    if (colorRes) desiredLayouts.set(writes.find(w => this.texResources[w] === colorRes)!, 'colorAttachment');
                    if (depthRes) desiredLayouts.set(writes.find(w => this.texResources[w] === depthRes)!, 'depthAttachment');
                    for (const [handle, layout] of desiredLayouts) {
                        const texRes = this.texResources[handle];
                        if (!texRes) continue;
                        const prev = texRes.state?.layout;
                        if (prev !== layout) {
                            backendTransition(texRes.tex as TextureHandle, prev, layout);
                            texRes.state = { layout };
                        }
                    }
                }
                // Only perform clears on the FIRST writer pass for a given resource. Subsequent overlay writers
                // should preserve previous contents (unless they explicitly requested a clear in the future).
                const isFirstColorWriter = colorRes ? colorRes.writerPasses[0] === i : false;
                const isFirstDepthWriter = depthRes ? depthRes.writerPasses[0] === i : false;
                const builder = new RenderPassBuilder(this.backend).label(this.passes[i].name);
                if (colorTargets.length) {
                    for (let idx = 0; idx < colorTargets.length; idx++) {
                        const ct = colorTargets[idx];
                        const clear = (idx === 0 && ct === colorRes && isFirstColorWriter) ? ct.clearOnWrite?.color : undefined;
                        builder.addColor(ct.tex as TextureHandle, clear, !!ct.desc.transient);
                    }
                }
                if (depthRes) builder.depth(depthRes.tex as TextureHandle, isFirstDepthWriter ? depthRes.clearOnWrite?.depth : undefined, !!depthRes.desc.transient);
                const passEnc = builder.begin();
                // Provide active pass encoder to backend (WebGPU uses it to bind pipeline and draw)
                if (this.backend.type === 'webgpu') {
                    (this.backend as WebGPUBackend).setActivePassEncoder(passEnc as WebGPUPassEncoder);
                }
                rp = {
                    end: () => {
                        if (this.backend.type === 'webgpu') (this.backend as WebGPUBackend).setActivePassEncoder(null);
                        this.backend.endRenderPass(passEnc);
                    }
                };
            }
            const t0 = performance.now();
            pass.execute(ctx, frame, data);
            const dt = performance.now() - t0;
            this.passStats.push({ name: pass.name, ms: dt });
            if (rp) rp.end();
            checkWebGLError(`After pass execution: ${i}: ${this.passes[i].name}`);
        }
    }

    getPassStats(): ReadonlyArray<{ name: string; ms: number }> { return this.passStats; }

    // Introspection API (safe, read-only views for diagnostics / editor tools)
    getPassOrder(): readonly number[] { return this.passOrder; }
    getReachableMask(): readonly boolean[] { return this.reachable; }
    getPassNames(): readonly string[] { return this.passes.map(p => p.name); }
    /** Debug info for each logical texture resource. */
    getTextureDebugInfo(): RGTexDebugInfo[] {
        const list: RGTexDebugInfo[] = [];
        for (let i = 0; i < this.texResources.length; i++) {
            const r = this.texResources[i]; if (!r) continue;
            list.push({ index: i, name: r.desc.name, firstUse: r.firstUse, lastUse: r.lastUse, writers: [...r.writerPasses], readers: [...r.readPasses], physicalId: r.physicalId, present: !!r.present, transient: !!r.desc.transient });
        }
        return list;
    }
    /** Total texture memory (unique physical textures) and breakdown by color/depth. */
    getTotalTextureMemoryInfo(): { total: number; color: number; depth: number } {
        const seen = new Set<number>();
        let color = 0, depth = 0;
        const bpp = (r: InternalTexResource) => (r.desc.depth ? 2 : 4);
        for (let i = 0; i < this.texResources.length; i++) {
            const r = this.texResources[i]; if (!r) continue;
            const pid = r.physicalId ?? i;
            if (seen.has(pid)) continue;
            seen.add(pid);
            const bytes = (r.desc.width * r.desc.height * bpp(r)) | 0;
            if (r.desc.depth) depth += bytes; else color += bytes;
        }
        return { total: color + depth, color, depth };
    }
    /** Rough per-pass texture memory footprint (bytes) based on logical resources (color=4Bpp, depth16=2Bpp). */
    getPassTextureMemoryInfo(): { name: string; bytes: number }[] {
        // Aggregate bytes of textures read or written by each pass
        const names = this.getPassNames();
        const mem = new Array<number>(names.length).fill(0);
        const bpp = (r: InternalTexResource) => (r.desc.depth ? 2 : 4);
        for (let i = 0; i < this.texResources.length; i++) {
            const r = this.texResources[i]; if (!r) continue;
            const bytes = (r.desc.width * r.desc.height * bpp(r)) | 0;
            // Writers
            for (const p of r.writerPasses) mem[p] += bytes;
            // Readers
            for (const p of r.readPasses) mem[p] += bytes;
        }
        return names.map((name, i) => ({ name, bytes: mem[i] }));
    }
    private realizeAll(): void {
        // Create physical textures for each alias group lazily; map physicalId -> backend TextureHandle
        const physTex = new Map<number, TextureHandle>();
        for (let h = 0; h < this.texResources.length; h++) {
            const res = this.texResources[h];
            if (!res) continue;
            if (res.tex) continue; // already realized
            const pid = res.physicalId ?? h; // fallback unique
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
    }

    private ensureFBO(color: RGTexHandle, depth: RGTexHandle): FramebufferHandle | null {
        const cRes = this.texResources[color];
        const dRes = this.texResources[depth];
        if (!cRes || !dRes) return null;
        if (cRes.fboWithDepth && cRes.fboWithDepth.depth === depth) return cRes.fboWithDepth.fbo as FramebufferHandle;
        // Delegate FBO creation to backend abstraction (opaque handle)
        const fbo = this.backend.createRenderTarget(cRes.tex, dRes.tex) as FramebufferHandle | null;
        cRes.fboWithDepth = { depth, fbo };
        return fbo;
    }

    invalidate(): void {
        this.compiled = false;
        this.passOrder = [];
        this.reachable = [];
        this.texResources = [];
        this.valueResources = [];
    }
}
