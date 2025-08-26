// WebGL backend implementation extracted from legacy gpu_backend.ts
import { TextureParams } from '../gpu_types';
import { TEXTURE_UNIT_SKYBOX, TEXTURE_UNIT_UPLOAD } from '../view/render_view';
import * as GLR from './gl_resources';
import { GPUBackend, PassEncoder, PipelineDesc, PipelineHandle, PipelineId, RenderPassDesc } from './interfaces';
import { PipelineManager } from './pipeline_manager';
import { PipelineRegistry } from './pipeline_registry';
import { PipelineStates } from './pipeline_types';

// (Texture units sourced from render_view constants to avoid duplication.)

export class WebGLBackend implements GPUBackend {
    private texIds = new WeakMap<WebGLTexture, number>();
    private nextTexId = 1;
    private fboCache = new Map<string, WebGLFramebuffer | null>();
    private pipelineManager: PipelineManager;
    private registry: PipelineRegistry;
    // Legacy / custom pipeline states not managed by PipelineManager (or pre-registered);
    // typed as Partial<PipelineStates> for compile-time narrowing while still allowing
    // arbitrary extension via index signature.
    private extraStates: Partial<PipelineStates> & { [k: string]: unknown } = {};
    constructor(private gl: WebGL2RenderingContext) {
        this.pipelineManager = new PipelineManager(gl);
        this.registry = new PipelineRegistry(this.pipelineManager);
        this.registry.registerBuiltin();
    }
    // (Static helpers have moved to core/gl_resources.ts; existing external usages should import from there.)
    createTextureFromImage(img: ImageBitmap, desc: TextureParams): WebGLTexture { return GLR.glCreateTextureFromImage(this.gl, img, desc, null); }
    createCubemapFromImages(faces: readonly [ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap], desc: TextureParams): WebGLTexture {
        const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX); const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        const targets = [gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z] as const;
        for (let i = 0; i < 6; i++) gl.texImage2D(targets[i], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, faces[i]);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        return tex;
    }
    createSolidCubemap(size: number, rgba: [number, number, number, number], desc: TextureParams): WebGLTexture {
        const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX); const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        const data = new Uint8Array(size * size * 4); for (let i = 0; i < size * size; i++) data.set(rgba, i * 4);
        const targets = [gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z] as const;
        for (const t of targets) gl.texImage2D(t, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        return tex;
    }
    createCubemapEmpty(size: number, desc: TextureParams): WebGLTexture {
        const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX); const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        const targets = [gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z] as const;
        for (const t of targets) gl.texImage2D(t, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        return tex;
    }
    uploadCubemapFace(cubemap: WebGLTexture, face: number, img: ImageBitmap): void {
        const gl = this.gl; const targets = [gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z] as const;
        gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX); gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubemap); gl.texImage2D(targets[face], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    }
    destroyTexture(handle: WebGLTexture): void { this.gl.deleteTexture(handle); }
    createColorTexture(desc: { width: number; height: number; format?: GLenum }): WebGLTexture { return GLR.glCreateTexture(this.gl, undefined, { x: desc.width, y: desc.height }, TEXTURE_UNIT_UPLOAD); }
    createDepthTexture(desc: { width: number; height: number }): WebGLTexture { return GLR.glCreateDepthTexture(this.gl, desc.width, desc.height, TEXTURE_UNIT_UPLOAD); }
    createFBO(color?: WebGLTexture | null, depth?: WebGLTexture | null): WebGLFramebuffer | null {
        const gl = this.gl; const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
        if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); return fbo;
    }
    bindFBO(fbo: WebGLFramebuffer | null): void { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo); }
    clear(opts: { color?: [number, number, number, number]; depth?: number }): void { const gl = this.gl; let mask = 0; if (opts.color) { gl.clearColor(...opts.color); mask |= gl.COLOR_BUFFER_BIT; } if (opts.depth !== undefined) { gl.clearDepth(opts.depth); mask |= gl.DEPTH_BUFFER_BIT; } if (mask) gl.clear(mask); }
    beginRenderPass(desc: RenderPassDesc): PassEncoder {
        let fbo: WebGLFramebuffer | null = null;
        // Normalize single color into colors[0]
        const firstColor = desc.colors && desc.colors.length ? desc.colors[0] : desc.color;
        if (firstColor || desc.depth) {
            const colorTex = firstColor?.tex as WebGLTexture | null;
            const depthTex = desc.depth?.tex as WebGLTexture | null;
            if (colorTex) {
                if (!this.texIds.has(colorTex)) this.texIds.set(colorTex, this.nextTexId++);
                const cid = this.texIds.get(colorTex)!;
                let did = 0;
                if (depthTex) { if (!this.texIds.has(depthTex)) this.texIds.set(depthTex, this.nextTexId++); did = this.texIds.get(depthTex)!; }
                const key = cid + ':' + did;
                let cached = this.fboCache.get(key);
                if (!cached) { cached = this.createFBO(colorTex, depthTex) as WebGLFramebuffer | null; this.fboCache.set(key, cached); }
                fbo = cached;
            } else {
                fbo = this.createFBO(colorTex, depthTex) as WebGLFramebuffer | null;
            }
            this.bindFBO(fbo);
            const clearColor = firstColor?.clear;
            if (clearColor || desc.depth?.clearDepth !== undefined) {
                this.clear({ color: clearColor, depth: desc.depth?.clearDepth });
            }
        }
        return { fbo, desc };
    }
    endRenderPass(_pass: PassEncoder): void { }
    getCaps() { return { maxColorAttachments: 1 }; }
    transitionTexture(): void { }
    // --- Dynamic pipeline API (public) ---
    createPipeline(desc: PipelineDesc): PipelineHandle {
        // Keep compatibility with existing interface; convert to PipelineManager descriptor
        const id = desc.label ?? `pipeline_${Math.random().toString(36).slice(2)}`;
        // Only register if not already present
        if (!this.pipelineManager.has(id)) {
            this.pipelineManager.register<any>({
                id,
                vsCode: desc.vsCode,
                fsCode: desc.fsCode,
                uniforms: desc.bindingLayout?.uniforms,
                exec: () => { /* execution performed via executePipeline after state set */ },
            });
        }
        return { id: this.hashString(id), label: id };
    }
    // Public helper for ROMs to register custom pipeline with hooks
    registerCustomPipeline<State>(id: string, hooks: { exec: (gl: WebGL2RenderingContext, fbo: WebGLFramebuffer | null, state: State) => void; prepare?: (gl: WebGL2RenderingContext, state: State) => void; vsCode?: string; fsCode?: string; uniforms?: string[]; }): void {
        if (this.pipelineManager.has(id)) throw new Error(`Pipeline '${id}' already exists`);
        this.pipelineManager.register<State>({ id, vsCode: hooks.vsCode, fsCode: hooks.fsCode, uniforms: hooks.uniforms, prepare: hooks.prepare, exec: hooks.exec });
    }
    destroyPipeline(_p: PipelineHandle): void { /* Not implemented: pipelines persist; could add deregistration if needed */ }
    setPipeline(_pass: PassEncoder, _pipeline: PipelineHandle): void { /* no-op; manager keyed by string id now */ }
    private hashString(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0; return h >>> 0; }
    // Type-safe overloads for known pipeline ids
    getPipelineState<K extends keyof PipelineStates>(label: K): PipelineStates[K] | undefined;
    getPipelineState<S = unknown>(label: string): S | undefined;
    getPipelineState(label: string) {
        if (Object.prototype.hasOwnProperty.call(this.extraStates, label)) return this.extraStates[label];
        return this.pipelineManager.getState(label);
    }
    setPipelineState<K extends keyof PipelineStates>(label: K, state: PipelineStates[K]): void;
    setPipelineState<State = unknown>(label: string, state: State): void;
    setPipelineState(label: string, state: unknown): void {
        if (!this.pipelineManager.has(label)) {
            // Basic runtime shape guards for built-in pipelines when stored in extraStates prior to registration
            // (development aid; shallow checks only to avoid perf impact).
            if (process.env.NODE_ENV !== 'production') {
                const fail = (msg: string) => console.warn('[WebGLBackend] setPipelineState validation warning:', msg);

                const hasProp = (o: unknown, p: string): o is Record<string, unknown> =>
                    typeof o === 'object' && o !== null && p in (o as Record<string, unknown>);

                switch (label) {
                    case 'Skybox':
                        if (!hasProp(state, 'view') || !hasProp(state, 'proj'))
                            fail('Skybox state missing view/proj');
                        break;
                    case 'MeshBatch':
                        if (!hasProp(state, 'view') || !hasProp(state, 'width'))
                            fail('MeshBatch state missing basics');
                        break;
                    case 'Particles':
                        if (!hasProp(state, 'viewProj'))
                            fail('Particles state missing viewProj');
                        break;
                    case 'Sprites':
                        if (!hasProp(state, 'width'))
                            fail('Sprites state missing width');
                        break;
                    case 'CRT':
                        if (!hasProp(state, 'width'))
                            fail('CRT state missing width');
                        break;
                    case 'Fog':
                        if (!hasProp(state, 'fog'))
                            fail('Fog state missing fog');
                        break;
                    case 'FrameShared':
                        if (!hasProp(state, 'view'))
                            fail('FrameShared state missing view');
                        break;
                }
            }

            this.extraStates[label] = state;
            return;
        }

        this.pipelineManager.setState(label, state);
    }
    executePipeline(label: PipelineId | string, fbo: unknown): void {
        this.pipelineManager.execute(label, fbo as WebGLFramebuffer | null);
    }
    buildProgram(vsSource: string, fsSource: string, label: string): WebGLProgram | null {
        const gl = this.gl;
        function compile(type: number, source: string, stage: string): WebGLShader | null {
            const shader = gl.createShader(type);
            if (!shader) return null;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error(`Shader compile failed (${label}:${stage}):`, gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }
        const vs = compile(gl.VERTEX_SHADER, vsSource, 'vs');
        const fs = compile(gl.FRAGMENT_SHADER, fsSource, 'fs');
        if (!vs || !fs) return null;
        const prog = gl.createProgram();
        if (!prog) return null;
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Program link failed (' + label + '):', gl.getProgramInfoLog(prog));
            gl.deleteProgram(prog);
            return null;
        }
        gl.deleteShader(vs); gl.deleteShader(fs);
        return prog;
    }
}