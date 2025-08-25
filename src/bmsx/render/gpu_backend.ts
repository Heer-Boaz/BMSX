// Unified GPU backend abstraction for both TextureManager and RenderGraph.
// Future WebGPU implementation can implement the same interface.

import { $ } from '../core/game';
import * as GLView2D from './2d/glview.2d';
import * as GLView3D from './3d/glview.3d';
import * as GLViewParticles from './3d/glview.particles';
import * as GLViewSkybox from './3d/glview.skybox';
import { SkyboxPassState } from './3d/glview.skybox';
import { glCreateDepthTexture, glCreateTexture, glCreateTextureFromImage } from './glutils';
import { GLView, TEXTURE_UNIT_SKYBOX, TEXTURE_UNIT_UPLOAD } from './glview';
import { TextureHandle, TextureParams } from './gpu_types';

// Typed pipeline identifiers to avoid label string typos.
export enum PipelineId {
    Skybox = 'skybox',
    MeshBatch = 'meshbatch',
    Particles = 'particles',
    Sprites = 'sprites',
    CRT = 'crt', // post-process / present
}

export interface GPUBackend {
    // TextureManager subset
    createTextureFromImage(img: ImageBitmap, desc: TextureParams): TextureHandle;
    createCubemapFromImages(
        faces: readonly [ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap],
        desc: TextureParams
    ): TextureHandle;
    createSolidCubemap(size: number, rgba: [number, number, number, number], desc: TextureParams): TextureHandle;
    createCubemapEmpty(size: number, desc: TextureParams): TextureHandle;
    uploadCubemapFace(cubemap: TextureHandle, face: number, img: ImageBitmap): void;
    destroyTexture(handle: TextureHandle): void;

    // RenderGraph subset
    createColorTexture(desc: { width: number; height: number; format?: GLenum }): TextureHandle;
    createDepthTexture(desc: { width: number; height: number }): TextureHandle;
    createFBO(color?: TextureHandle | null, depth?: TextureHandle | null): unknown; // opaque framebuffer
    bindFBO(fbo: unknown): void;
    clear(opts: { color?: [number, number, number, number]; depth?: number }): void;

    // --- RHI (initial minimal subset) ---
    beginRenderPass(desc: RenderPassDesc): PassEncoder;
    endRenderPass(pass: PassEncoder): void;
    getCaps(): BackendCaps;
    transitionTexture?(tex: TextureHandle, fromLayout: string | undefined, toLayout: string): void; // backend barrier (no-op WebGL)
    // Pipeline & draw (placeholders for future phases)
    createPipeline?(desc: PipelineDesc): PipelineHandle;
    destroyPipeline?(p: PipelineHandle): void;
    setPipeline?(pass: PassEncoder, pipeline: PipelineHandle): void;
    draw?(pass: PassEncoder, first: number, count: number): void;
    drawIndexed?(pass: PassEncoder, indexCount: number, firstIndex?: number): void;
    // High-level bridging (temporary until full pipeline abstraction):
    setPipelineState?<S = unknown>(label: string, state: S): void; // generic per-pipeline state setter
    executePipeline?(label: PipelineId | string, fbo: unknown): void; // generic explicit pipeline execution
    getPipelineState?<S = unknown>(label: PipelineId | string): S | undefined; // typed state accessor
}

// Compile-time registry mapping known pipelines to expected state payloads (extend as needed)
export interface PipelineStateRegistry {
    [PipelineId.Skybox]: { view: Float32Array; proj: Float32Array; tex: WebGLTexture; width?: number; height?: number };
    [PipelineId.MeshBatch]: { width: number; height: number; view: { camPos: { x: number; y: number; z: number }; viewProj: Float32Array }; fog?: any; lighting?: any };
    [PipelineId.Particles]: { width: number; height: number; viewProj: Float32Array; camRight: Float32Array; camUp: Float32Array };
    [PipelineId.Sprites]: { width: number; height: number };
    __frame_shared__?: { view: any; lighting: any }; // reserved internal id (string literal, not enum)
}

export interface BackendCaps { maxColorAttachments: number; }
export interface PipelineBindingLayout {
    uniforms?: string[]; // names of uniform scalars/matrices
    textures?: { name: string }[]; // future expansion
    samplers?: { name: string }[];
    buffers?: { name: string; size: number; usage: 'uniform' | 'storage' }[]; // WebGPU future
}
export interface PipelineDesc {
    label?: PipelineId | string;
    vsCode?: string; // GLSL vertex shader source (if provided -> generic program pipeline)
    fsCode?: string; // GLSL fragment shader source
    bindingLayout?: PipelineBindingLayout;
}
export interface PipelineHandle { id: number; label?: string }
export interface RenderPassDesc {
    color?: { tex: TextureHandle; clear?: [number, number, number, number]; discardAfter?: boolean };
    depth?: { tex: TextureHandle; clearDepth?: number; discardAfter?: boolean };
    label?: string;
}
export interface PassEncoder { fbo: unknown; desc: RenderPassDesc; _pipelineId?: number }

interface InternalPipeline {
    handle: PipelineHandle;
    exec: (gl: WebGL2RenderingContext, fbo: WebGLFramebuffer | null) => void;
    state?: unknown;
    program?: WebGLProgram | null; // descriptor-based pipeline program
    uniformLocations?: Map<string, WebGLUniformLocation | null>;
    bindingLayout?: PipelineBindingLayout;
}

export class WebGLBackend implements GPUBackend {
    private texIds = new WeakMap<WebGLTexture, number>();
    private nextTexId = 1;
    private fboCache = new Map<string, WebGLFramebuffer | null>();
    private pipelines: InternalPipeline[] = [];
    private pipelineSkybox: PipelineHandle | null = null;
    private pipelineMesh: PipelineHandle | null = null;
    private pipelineParticles: PipelineHandle | null = null;
    private pipelineSprites: PipelineHandle | null = null;
    // Storage for auxiliary non-executable state buckets (e.g. '__frame_shared__')
    private extraStates = new Map<string, unknown>();
    constructor(private gl: WebGL2RenderingContext) {
        // Create basic wrapper pipelines around existing legacy draw entry points.
        this.pipelineSkybox = this.createPipeline({ label: PipelineId.Skybox });
        this.pipelineMesh = this.createPipeline({ label: PipelineId.MeshBatch });
        this.pipelineParticles = this.createPipeline({ label: PipelineId.Particles });
        this.pipelineSprites = this.createPipeline({ label: PipelineId.Sprites });
    }

    createTextureFromImage(img: ImageBitmap, desc: TextureParams): WebGLTexture {
        return glCreateTextureFromImage(this.gl, img, desc, null);
    }
    createCubemapFromImages(faces: readonly [ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap], desc: TextureParams): WebGLTexture {
        const gl = this.gl;
        $.viewAs<GLView>().activeTexUnit = TEXTURE_UNIT_SKYBOX;
        const tex = gl.createTexture()!;
        $.viewAs<GLView>().bindCubemapTex(tex);
        const targets = [
            gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
        ] as const;
        for (let i = 0; i < 6; i++) gl.texImage2D(targets[i], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, faces[i]);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        return tex;
    }
    createSolidCubemap(size: number, rgba: [number, number, number, number], desc: TextureParams): WebGLTexture {
        const gl = this.gl;
        $.viewAs<GLView>().activeTexUnit = TEXTURE_UNIT_SKYBOX;
        const tex = gl.createTexture()!;
        $.viewAs<GLView>().bindCubemapTex(tex);
        const data = new Uint8Array(size * size * 4);
        for (let i = 0; i < size * size; i++) data.set(rgba, i * 4);
        const targets = [
            gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
        ] as const;
        for (const t of targets) gl.texImage2D(t, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        return tex;
    }
    createCubemapEmpty(size: number, desc: TextureParams): WebGLTexture {
        const gl = this.gl;
        $.viewAs<GLView>().activeTexUnit = TEXTURE_UNIT_SKYBOX;
        const tex = gl.createTexture()!;
        $.viewAs<GLView>().bindCubemapTex(tex);
        const targets = [
            gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
        ] as const;
        for (const t of targets) gl.texImage2D(t, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        return tex;
    }
    uploadCubemapFace(cubemap: WebGLTexture, face: number, img: ImageBitmap): void {
        const gl = this.gl;
        const targets = [
            gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
        ] as const;
        $.viewAs<GLView>().activeTexUnit = TEXTURE_UNIT_SKYBOX;
        $.viewAs<GLView>().bindCubemapTex(cubemap);
        gl.texImage2D(targets[face], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    }
    destroyTexture(handle: WebGLTexture): void { this.gl.deleteTexture(handle); }

    createColorTexture(desc: { width: number; height: number; format?: GLenum }): WebGLTexture {
        return glCreateTexture(this.gl, undefined, { x: desc.width, y: desc.height }, TEXTURE_UNIT_UPLOAD);
    }
    createDepthTexture(desc: { width: number; height: number }): WebGLTexture {
        return glCreateDepthTexture(this.gl, desc.width, desc.height, TEXTURE_UNIT_UPLOAD);
    }
    createFBO(color?: WebGLTexture | null, depth?: WebGLTexture | null): WebGLFramebuffer | null {
        const gl = this.gl;
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
        if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return fbo;
    }
    bindFBO(fbo: WebGLFramebuffer | null): void { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo); }
    clear(opts: { color?: [number, number, number, number]; depth?: number }): void {
        const gl = this.gl;
        let mask = 0;
        if (opts.color) { gl.clearColor(opts.color[0], opts.color[1], opts.color[2], opts.color[3]); mask |= gl.COLOR_BUFFER_BIT; }
        if (opts.depth !== undefined) { gl.clearDepth(opts.depth); mask |= gl.DEPTH_BUFFER_BIT; }
        if (mask) gl.clear(mask);
    }

    beginRenderPass(desc: RenderPassDesc): PassEncoder {
        // Create / bind FBO
        let fbo: WebGLFramebuffer | null = null;
        if (desc.color || desc.depth) {
            const colorTex = desc.color?.tex as WebGLTexture | null;
            const depthTex = desc.depth?.tex as WebGLTexture | null;
            if (colorTex) {
                // Compute cache key
                if (!this.texIds.has(colorTex)) this.texIds.set(colorTex, this.nextTexId++);
                const cid = this.texIds.get(colorTex)!;
                let did = 0;
                if (depthTex) { if (!this.texIds.has(depthTex)) this.texIds.set(depthTex, this.nextTexId++); did = this.texIds.get(depthTex)!; }
                const key = cid + ':' + did;
                let cached = this.fboCache.get(key);
                if (!cached) {
                    cached = this.createFBO(colorTex, depthTex) as WebGLFramebuffer | null;
                    this.fboCache.set(key, cached);
                }
                fbo = cached;
            } else {
                fbo = this.createFBO(colorTex, depthTex) as WebGLFramebuffer | null;
            }
            this.bindFBO(fbo);
            if (desc.color?.clear || desc.depth?.clearDepth !== undefined) {
                this.clear({ color: desc.color?.clear, depth: desc.depth?.clearDepth });
            }
        }
        return { fbo, desc };
    }
    endRenderPass(_pass: PassEncoder): void { /* WebGL implicit end */ }
    getCaps(): BackendCaps { return { maxColorAttachments: 1 }; }
    transitionTexture(_tex: TextureHandle): void { /* WebGL has implicit layout transitions */ }

    // --- Minimal pipeline system (wrapping legacy module calls) ---
    createPipeline(desc: PipelineDesc): PipelineHandle {
        // If shader sources provided, build a generic program pipeline; else legacy wrapper.
        const id = this.pipelines.length + 1;
        const handle: PipelineHandle = { id, label: desc.label };
        let exec: InternalPipeline['exec'];
        if (desc.vsCode && desc.fsCode) {
            // Generic program pipeline
            const program = this.buildProgram(desc.vsCode, desc.fsCode, desc.label ?? 'pipeline' + id);
            const uniformLocations = new Map<string, WebGLUniformLocation | null>();
            if (desc.bindingLayout?.uniforms) {
                for (const u of desc.bindingLayout.uniforms) {
                    uniformLocations.set(u, program ? this.gl.getUniformLocation(program, u) : null);
                }
            }
            exec = (gl) => { if (program) gl.useProgram(program); };
            this.pipelines.push({ handle, exec, program, uniformLocations, bindingLayout: desc.bindingLayout });
            return handle;
        }
        switch (desc.label) {
            case PipelineId.Skybox: exec = (gl, fbo) => {
                const st = this.getPipelineState<SkyboxPassState>(PipelineId.Skybox);
                if (!st) throw Error('Skybox pipeline executed without state');
                GLViewSkybox.drawSkyboxWithState(gl, fbo as WebGLFramebuffer, st);
            }; break;
            case PipelineId.MeshBatch: exec = (gl, fbo) => {
                const st = this.getPipelineState<{ width: number; height: number; view: { camPos: { x: number; y: number; z: number }; viewProj: Float32Array }; fog?: any; lighting?: any }>(PipelineId.MeshBatch);
                if (!st) throw Error('Mesh pipeline executed without state');
                GLView3D.renderMeshBatch(gl, fbo as WebGLFramebuffer, st.width, st.height, {
                    width: st.width, height: st.height,
                    camPos: st.view.camPos,
                    viewProj: st.view.viewProj,
                    fog: st.fog ?? undefined,
                    lighting: st.lighting,
                });
            }; break;
            case PipelineId.Particles: exec = (gl, fbo) => {
                const st = this.getPipelineState<{ width: number; height: number; viewProj: Float32Array; camRight: Float32Array; camUp: Float32Array }>(PipelineId.Particles);
                if (!st) throw Error('Particle pipeline executed without state');
                GLViewParticles.renderParticleBatch(gl, fbo as WebGLFramebuffer, st.width, st.height, st);
            }; break;
            case PipelineId.Sprites: exec = (gl, fbo) => {
                const st = this.getPipelineState<{ width: number; height: number }>(PipelineId.Sprites);
                if (!st) throw Error('Sprite pipeline executed without state');
                GLView2D.renderSpriteBatch(gl, fbo as WebGLFramebuffer, st.width, st.height);
            }; break;
            default: exec = () => { /* no-op placeholder */ }; break;
        }
        this.pipelines.push({ handle, exec });
        return handle;
    }
    destroyPipeline(p: PipelineHandle): void {
        this.pipelines = this.pipelines.filter(pl => pl.handle.id !== p.id);
    }
    setPipeline(pass: PassEncoder, pipeline: PipelineHandle): void { pass._pipelineId = pipeline.id; }
    private runCurrentPipeline(pass: PassEncoder): void {
        const pid = pass._pipelineId;
        if (!pid) return;
        const pl = this.pipelines.find(p => p.handle.id === pid);
        if (!pl) return;
        pl.exec(this.gl, pass.fbo as WebGLFramebuffer | null);
    }
    setPipelineBindings(labelOrHandle: PipelineHandle | (PipelineId | string), bindings: Record<string, unknown>): void {
        const pl = typeof labelOrHandle === 'object'
            ? this.pipelines.find(p => p.handle.id === labelOrHandle.id)
            : this.pipelines.find(p => p.handle.label === labelOrHandle);
        if (!pl || !pl.program) return; // only for generic program pipelines
        const gl = this.gl;
        gl.useProgram(pl.program);
        if (pl.bindingLayout?.uniforms) {
            for (const name of pl.bindingLayout.uniforms) {
                if (!(name in bindings)) continue;
                const loc = pl.uniformLocations?.get(name) ?? null;
                if (!loc) continue;
                const v = bindings[name];
                // Minimal type handling (extend as needed)
                if (typeof v === 'number') gl.uniform1f(loc, v);
                else if (v instanceof Float32Array) {
                    // Choose uniform setter based on length
                    switch (v.length) {
                        case 1: gl.uniform1fv(loc, v); break;
                        case 2: gl.uniform2fv(loc, v); break;
                        case 3: gl.uniform3fv(loc, v); break;
                        case 4: gl.uniform4fv(loc, v); break;
                        case 9: gl.uniformMatrix3fv(loc, false, v); break;
                        case 16: gl.uniformMatrix4fv(loc, false, v); break;
                        default: /* ignore unsupported size */ break;
                    }
                }
            }
        }
    }
    getPipelineState<S = unknown>(label: PipelineId | string): S | undefined {
        const p = this.pipelines.find(p => p.handle.label === label);
        const st = p?.state as S | undefined;
        if (!p && this.extraStates.has(label as string)) {
            return this.extraStates.get(label as string) as S;
        }
        if (st && $.debug) {
            // Lightweight invariant checks for common pipelines (avoid heavy perf cost in prod)
            switch (label) {
                case PipelineId.Skybox:
                    const sky: any = st;
                    if (!(sky.view instanceof Float32Array) || !(sky.proj instanceof Float32Array)) console.warn('Skybox state invariant failed');
                    break;
                case PipelineId.MeshBatch:
                    const mesh: any = st;
                    if (!mesh.view || !mesh.view.camPos || !(mesh.view.viewProj instanceof Float32Array)) console.warn('MeshBatch state invariant failed');
                    break;
                case PipelineId.Particles:
                    const part: any = st;
                    if (!(part.viewProj instanceof Float32Array)) console.warn('Particles state invariant failed');
                    break;
            }
        }
        return st;
    }
    setPipelineState(label: string, state: unknown): void {
        const p = this.pipelines.find(p => p.handle.label === label);
        if (!p) {
            // Store in auxiliary map (side-effect / shared frame state that is not an executable pipeline)
            this.extraStates.set(label, state);
            return;
        }
        p.state = state;
    }
    executePipeline(label: PipelineId | string, fbo: unknown): void {
        const pl = this.pipelines.find(p => p.handle.label === label);
        if (!pl) throw Error(`Pipeline '${label}' not found`);
        const pass: PassEncoder = { fbo, desc: {} };
        this.setPipeline(pass, pl.handle);
        this.runCurrentPipeline(pass);
    }

    // Public so legacy modules can temporarily request backend-managed program creation while migrating.
    buildProgram(vsSource: string, fsSource: string, label: string): WebGLProgram | null {
        const gl = this.gl;
        function compile(type: number, src: string): WebGLShader | null {
            const s = gl.createShader(type);
            if (!s) return null;
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                console.error('Shader compile failed (' + label + '):', gl.getShaderInfoLog(s));
                gl.deleteShader(s); return null;
            }
            return s;
        }
        const vs = compile(gl.VERTEX_SHADER, vsSource);
        const fs = compile(gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return null;
        const prog = gl.createProgram();
        if (!prog) return null;
        gl.attachShader(prog, vs); gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Program link failed (' + label + '):', gl.getProgramInfoLog(prog));
            gl.deleteProgram(prog); return null;
        }
        gl.deleteShader(vs); gl.deleteShader(fs);
        return prog;
    }
}

// Stub WebGPU backend (placeholder). Provides the same interface but throws until implemented.
// This allows early wiring & feature-flagging without conditional code elsewhere.
export class WebGPUBackend implements GPUBackend {
    constructor(private device: unknown /* GPUDevice placeholder */) { }
    private unimpl<T = never>(): T { throw new Error('WebGPUBackend not implemented yet'); }
    // Simple transient buffer heap aliasing placeholder (CPU-side simulation)
    private transientHeap: { size: number; free: boolean; id: number }[] = [];
    private nextBufferId = 1;
    allocateTransientBuffer(size: number): { id: number; size: number } {
        // First-fit on free blocks >= size
        for (const blk of this.transientHeap) {
            if (blk.free && blk.size >= size) { blk.free = false; return { id: blk.id, size }; }
        }
        const blk = { size, free: false, id: this.nextBufferId++ };
        this.transientHeap.push(blk);
        return { id: blk.id, size };
    }
    resetTransientHeap(): void { for (const blk of this.transientHeap) blk.free = true; }
    createTextureFromImage(): never { return this.unimpl(); }
    createCubemapFromImages(): never { return this.unimpl(); }
    createSolidCubemap(): never { return this.unimpl(); }
    createCubemapEmpty(): never { return this.unimpl(); }
    uploadCubemapFace(): never { return this.unimpl(); }
    destroyTexture(): void { /* no-op for stub */ }
    createColorTexture(): never { return this.unimpl(); }
    createDepthTexture(): never { return this.unimpl(); }
    createFBO(): never { return this.unimpl(); }
    bindFBO(): void { /* no-op */ }
    clear(): void { /* no-op */ }
    beginRenderPass(_desc: RenderPassDesc): PassEncoder { return { fbo: null, desc: _desc }; }
    endRenderPass(_pass: PassEncoder): void { /* no-op */ }
    getCaps(): BackendCaps { return { maxColorAttachments: 1 }; }
    executePipeline(): void { this.unimpl(); }
}
