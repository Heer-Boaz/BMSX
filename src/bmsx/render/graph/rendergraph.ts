/**
 * Generic render graph scaffolding (initial draft).
 *
 * Goal: Provide a minimal, engine-agnostic abstraction to declare passes with
 * explicit resource dependencies (textures + values) and execute them in
 * topological order. This file intentionally avoids touching existing pipeline
 * code so migration can be incremental.
 */
import { taskGate } from '../../core/taskgate';
import { GPUBackend, RenderPassDesc } from '../backend/interfaces';
import { TextureHandle } from '../gpu_types';

export type RGHandle = number;
// Internal graph texture handle. Named distinctly to avoid collision with existing TextureManager TextureHandle.
export type RGTexHandle = RGHandle;
export type ValueHandle<T = unknown> = RGHandle & { readonly __t?: T };

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
    cameraPos: Float32Array;
    flags?: number; // bit flags for skybox, ui, etc.
}

export interface FrameData {
    frameIndex: number;
    time: number;
    delta: number;
    views: View[];
    // Draw commands & scene data kept generic for now; filled by framedata.ts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    drawCommands?: RGDrawCommand[];
    // Lights, postFx, etc. are attached here later.
    // Using index signature to stay flexible during migration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [k: string]: any;
}

// Pass authoring interfaces -------------------------------------------------

export interface IOBuilder {
    createTex(desc: TexDesc): RGTexHandle; // allocate logical resource
    readTex(handle: RGTexHandle): void;    // declare read dependency
    writeTex(handle: RGTexHandle, opts?: { clearColor?: [number, number, number, number]; clearDepth?: number }): void; // declare write + optional clear
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

// Draw command kinds -------------------------------------------------------
export const enum RGCommandKind {
    Skybox = 'skybox',
    MeshBatch = 'meshBatch',
    ParticleBatch = 'particleBatch',
    SpriteBatch = 'spriteBatch',
    PostProcess = 'postProcess',
}

export interface RGDrawCommand { kind: RGCommandKind; /* future fields: material, range, etc. */ }

export interface RenderPass<SetupOut = unknown> {
    name: string;
    // Optional list of command kinds this pass wants; runtime provides filtered list
    consumes?: readonly RGCommandKind[];
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
    clearOnWrite?: { color?: [number, number, number, number]; depth?: number };
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
    private _passWrites: { tex: RGTexHandle; clear?: { color?: [number, number, number, number]; depth?: number } }[][] = [];
    private _valueReads: { val: ValueHandle }[][] = [];

    constructor(backend: GPUBackend) { this.backend = backend; }

    addPass(pass: RenderPass): void {
        if (this.compiled) throw Error('RenderGraph already compiled. Add passes before compile().');
        this.passes.push(pass);
    }

    compile(frame: FrameData): void {
        // Build dependency data (reads/writes) & then topologically sort reachable passes.
        let nextHandle: RGHandle = 1; // 0 reserved / invalid

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
        const passWrites: { tex: RGTexHandle; clear?: { color?: [number, number, number, number]; depth?: number } }[][] = [];
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
            // If this pass explicitly exported, include it
            for (const w of passWrites[i]) { /* noop for now */ }
        }
        // Mark any explicitly forced passes reachable (side-effect passes w/o resource edges)
        for (let p = 0; p < passCount; p++) {
            if (this.passes[p].alwaysExecute) this.reachable[p] = true;
        }
        // Topological sort (Kahn) on reachable subgraph
        // Build adjacency & indegree
        const indegree = new Array(passCount).fill(0);
        const adj: number[][] = new Array(passCount).fill(0).map(() => []);
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
        (this as unknown as { _setupData: unknown[] })._setupData = setupData;
        // Persist dependency info for execution phase (avoids rescanning resources)
        this._passReads = passReads;
        this._passWrites = passWrites;
        this._valueReads = valueReads;
        this.compiled = true;
    }

    execute(frame: FrameData): void {
        // If an external asset/task gate system is present (optional), we can delay execution until
        // blocking async loads finish, and then invalidate once to rebuild resource lifetimes.
        // Integration contract: global taskGate?.group('render') or similar provides readiness.
        try {
            const gateGroup = taskGate.group('render');
            if (gateGroup && !gateGroup.ready) return; // Defer frame until required assets loaded
            if (gateGroup && gateGroup.ready && this._pendingInvalidateOnReady) { this.invalidate(); this._pendingInvalidateOnReady = false; }
        } catch { /* ignore if taskGate not wired */ }
        if (!this.compiled) this.compile(frame);
        const setupData: unknown[] = (this as unknown as { _setupData: unknown[] })._setupData;

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

        // Ensure GL objects exist before first pass that needs them
        this.realizeAll();

        this.passStats.length = 0;
        const order = this.passOrder.length ? this.passOrder : this.passes.map((_, i) => i); // fallback sequential
        for (let oi = 0; oi < order.length; oi++) {
            const i = order[oi];
            if (this.reachable.length && !this.reachable[i]) continue; // skip culled
            const pass = this.passes[i];
            const data = setupData[i];
            // Filter draw commands if pass declares interest
            const originalCmds = frame.drawCommands;
            let filtered: RGDrawCommand[] | undefined;
            if (pass.consumes && originalCmds) {
                const set = new Set(pass.consumes);
                filtered = [];
                for (let j = 0; j < originalCmds.length; j++) {
                    const c = originalCmds[j];
                    if (set.has(c.kind)) filtered.push(c);
                }
            }
            let restore: RGDrawCommand[] | undefined;
            if (filtered) {
                restore = originalCmds;
                frame.drawCommands = filtered;
            }
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
                const desc = {
                    // Provide both single color (for legacy backends) and colors[] array (for MRT-capable backends)
                    color: colorRes ? { tex: colorRes.tex as TextureHandle, clear: isFirstColorWriter ? colorRes.clearOnWrite?.color : undefined, discardAfter: !!colorRes.desc.transient } : undefined,
                    colors: colorTargets.length ? colorTargets.map((ct, idx) => ({
                        tex: ct.tex as TextureHandle,
                        clear: (idx === 0 && ct === colorRes && isFirstColorWriter) ? ct.clearOnWrite?.color : undefined,
                        discardAfter: !!ct.desc.transient,
                    })) : undefined,
                    depth: depthRes ? { tex: depthRes.tex as TextureHandle, clearDepth: isFirstDepthWriter ? depthRes.clearOnWrite?.depth : undefined, discardAfter: !!depthRes.desc.transient } : undefined,
                    label: this.passes[i].name,
                } as RenderPassDesc;
                // TODO(backends): Insert resource state / layout transitions here for non-WebGL (e.g. Vulkan/WebGPU)
                // before beginning the render pass. This requires tracking previous usage and desired new usage
                // (read -> colorAttachment, colorAttachment -> shaderRead, depthWrite -> depthRead, etc.).
                const passEnc = this.backend.beginRenderPass(desc);
                rp = { end: () => this.backend.endRenderPass(passEnc) };
            }
            const t0 = performance.now();
            pass.execute(ctx, frame, data as unknown);
            const dt = performance.now() - t0;
            this.passStats.push({ name: pass.name, ms: dt });
            if (filtered) frame.drawCommands = restore; // restore original list
            if (rp) rp.end();
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
                res.fboColorOnly = this.backend.createFBO(res.tex, null) as FramebufferHandle;
            }
        }
    }

    private ensureFBO(color: RGTexHandle, depth: RGTexHandle): FramebufferHandle | null {
        const cRes = this.texResources[color];
        const dRes = this.texResources[depth];
        if (!cRes || !dRes) return null;
        if (cRes.fboWithDepth && cRes.fboWithDepth.depth === depth) return cRes.fboWithDepth.fbo as FramebufferHandle;
        // Delegate FBO creation to backend abstraction (opaque handle)
        const fbo = this.backend.createFBO(cRes.tex, dRes.tex) as FramebufferHandle | null;
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
