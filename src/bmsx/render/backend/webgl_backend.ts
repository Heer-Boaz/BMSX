// WebGL backend implementation extracted from legacy gpu_backend.ts
import { TEXTURE_UNIT_SKYBOX, TEXTURE_UNIT_UPLOAD } from './webgl.constants';
import * as GLR from './gl_resources';
import { GPUBackend, GraphicsPipelineBuildDesc, PassEncoder, RenderPassDesc, RenderPassId, RenderPassInstanceHandle, RenderPassStateRegistry, TextureParams } from './pipeline_interfaces';

// (Texture units sourced from render_view constants to avoid duplication.)

export class WebGLBackend implements GPUBackend {
    private texIds = new WeakMap<WebGLTexture, number>();
    private nextTexId = 1;
    private fboCache = new Map<string, WebGLFramebuffer | null>();
    // Legacy / custom pipeline states not managed by PipelineManager (or pre-registered);
    // typed as Partial<PipelineStates> for compile-time narrowing while still allowing
    // arbitrary extension via index signature.
    private extraStates: Partial<RenderPassStateRegistry> & { [k: string]: unknown } = {};
    constructor(public gl: WebGL2RenderingContext) {
        // No internal manager; caller creates PipelineManager with this backend
    }
    // (Static helpers have moved to core/gl_resources.ts; existing external usages should import from there.)
    createTextureFromImage(img: ImageBitmap, desc: TextureParams): WebGLTexture { return GLR.glCreateTextureFromImage(this.gl, img, desc, null); }
    createCubemapFromImages(faces: readonly [ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap], desc: TextureParams): WebGLTexture {
        const gl = this.gl;
        // Avoid global state; use local binding if possible, but for simplicity keep as is (refactor later if needed)
        gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX);
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        const targets = [gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z] as const;
        for (let i = 0; i < 6; i++) gl.texImage2D(targets[i], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, faces[i]);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null); // Unbind to clean up
        return tex;
    }
    createSolidCubemap(size: number, rgba: [number, number, number, number], desc: TextureParams): WebGLTexture {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX);
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        const data = new Uint8Array(size * size * 4); for (let i = 0; i < size * size; i++) data.set([Math.round(rgba[0] * 255), Math.round(rgba[1] * 255), Math.round(rgba[2] * 255), Math.round(rgba[3] * 255)], i * 4);
        const targets = [gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z] as const;
        for (const t of targets) gl.texImage2D(t, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
        return tex;
    }
    createCubemapEmpty(size: number, desc: TextureParams): WebGLTexture {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX);
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        const targets = [gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z] as const;
        for (const t of targets) gl.texImage2D(t, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
        return tex;
    }
    uploadCubemapFace(cubemap: WebGLTexture, face: number, img: ImageBitmap): void {
        const gl = this.gl;
        const targets = [gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z] as const;
        gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT_SKYBOX);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubemap);
        gl.texImage2D(targets[face], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    }
    destroyTexture(handle: WebGLTexture): void { this.gl.deleteTexture(handle); }
    createColorTexture(desc: { width: number; height: number; format?: GLenum }): WebGLTexture { return GLR.glCreateTexture(this.gl, undefined, { x: desc.width, y: desc.height }, TEXTURE_UNIT_UPLOAD); }
    createDepthTexture(desc: { width: number; height: number }): WebGLTexture { return GLR.glCreateDepthTexture(this.gl, desc.width, desc.height, TEXTURE_UNIT_UPLOAD); }
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
        if (opts.color) { gl.clearColor(...opts.color); mask |= gl.COLOR_BUFFER_BIT; }
        if (opts.depth !== undefined) { gl.clearDepth(opts.depth); mask |= gl.DEPTH_BUFFER_BIT; }
        if (mask) gl.clear(mask);
    }
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
        return { fbo, desc } as PassEncoder & { encoder?: null }; // No encoder in WebGL
    }
    endRenderPass(_pass: PassEncoder): void {
        // No-op in WebGL; unbind if needed
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }
    getCaps() { return { maxColorAttachments: 1 }; }
    transitionTexture(): void { } // No-op in WebGL
    // --- Pipeline API ---
    createRenderPassInstance(desc: GraphicsPipelineBuildDesc): RenderPassInstanceHandle {
        const program = this.buildProgram(desc.vsCode ?? '', desc.fsCode ?? '', desc.label ?? 'unnamed');
        if (!program) throw new Error(`Failed to create pipeline for ${desc.label}`);
        const id = this.hashString(desc.label ?? Math.random().toString(36).slice(2));
        return { id, label: desc.label, backendData: program };
    }
    destroyRenderPassInstance(p: RenderPassInstanceHandle): void {
        if (p.backendData) this.gl.deleteProgram(p.backendData as WebGLProgram);
    }
    setGraphicsPipeline(pass: PassEncoder, pipeline: RenderPassInstanceHandle): void {
        this.gl.useProgram(pipeline.backendData as WebGLProgram);
    }
    draw(pass: PassEncoder, first: number, count: number): void {
        this.gl.drawArrays(this.gl.TRIANGLES, first, count); // Assume TRIANGLES; customize if needed
    }
    drawIndexed(pass: PassEncoder, indexCount: number, firstIndex?: number): void {
        this.gl.drawElements(this.gl.TRIANGLES, indexCount, this.gl.UNSIGNED_SHORT, (firstIndex ?? 0) * 2); // Assume UNSIGNED_SHORT; adjust as per buffers
    }
    // Remove registerCustomPipeline; use PipelineManager.register directly
    private hashString(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0; return h >>> 0; }
    getPassState<S = unknown>(label: string): S | undefined {
        if (Object.prototype.hasOwnProperty.call(this.extraStates, label)) return this.extraStates[label] as unknown as S | undefined;
        // Assume external PipelineManager; if integrated, call manager.getState
        // For now, keep extraStates for legacy, but migrate to manager
        return this.extraStates[label] as unknown as S | undefined;
    }
    setPassState<State = unknown>(label: string, state: State): void {
        // Migrate to external manager.setState; for now keep extraStates
        this.extraStates[label] = state;
    }
    executePass(label: RenderPassId, fbo: unknown): void {
        // Call external manager.execute(label, fbo)
        // Assuming caller has PipelineManager instance
        throw new Error('executePass requires external GraphicsPipelineManager; migrate calls');
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

    // --- Optional buffer/VAO helpers ---
    createVertexBuffer(data: ArrayBufferView, usage: 'static' | 'dynamic'): WebGLBuffer {
        const gl = this.gl;
        const buf = gl.createBuffer(); if (!buf) throw new Error('Failed to create buffer');
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, usage === 'static' ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        return buf;
    }
    updateVertexBuffer(buf: WebGLBuffer, data: ArrayBufferView, dstOffset = 0): void {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, dstOffset, data);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    bindArrayBuffer(buf: WebGLBuffer | null): void { this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buf); }
    createVertexArray(): WebGLVertexArrayObject { const vao = this.gl.createVertexArray(); if (!vao) throw new Error('Failed to create VAO'); return vao; }
    bindVertexArray(vao: WebGLVertexArrayObject | null): void { this.gl.bindVertexArray(vao); }

    enableVertexAttrib(index: number): void { this.gl.enableVertexAttribArray(index); }
    disableVertexAttrib(index: number): void { this.gl.disableVertexAttribArray(index); }
    vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void {
        this.gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
    }
    vertexAttribDivisor(index: number, divisor: number): void { this.gl.vertexAttribDivisor(index, divisor); }
    bindElementArrayBuffer?(buf: WebGLBuffer | null): void { this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, buf); }
    vertexAttribIPointer(index: number, size: number, type: number, stride: number, offset: number): void {
        this.gl.vertexAttribIPointer(index, size, type, stride, offset);
    }
    vertexAttribI4ui(index: number, x: number, y: number, z: number, w: number): void {
        this.gl.vertexAttribI4ui(index, x, y, z, w);
    }

    drawInstanced(pass: PassEncoder, vertexCount: number, instanceCount: number, firstVertex = 0, _firstInstance = 0): void {
        this.gl.drawArraysInstanced(this.gl.TRIANGLES, firstVertex, vertexCount, instanceCount);
    }
    drawIndexedInstanced(pass: PassEncoder, indexCount: number, instanceCount: number, firstIndex = 0, _baseVertex = 0, _firstInstance = 0): void {
        this.gl.drawElementsInstanced(this.gl.TRIANGLES, indexCount, this.gl.UNSIGNED_SHORT, firstIndex * 2, instanceCount);
    }

    createUniformBuffer(byteSize: number, usage: 'static' | 'dynamic'): WebGLBuffer {
        const gl = this.gl;
        const buf = gl.createBuffer(); if (!buf) throw new Error('Failed to create uniform buffer');
        gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
        gl.bufferData(gl.UNIFORM_BUFFER, byteSize, usage === 'static' ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.UNIFORM_BUFFER, null);
        return buf;
    }
    updateUniformBuffer(buf: WebGLBuffer, data: ArrayBufferView, dstByteOffset = 0): void {
        const gl = this.gl; gl.bindBuffer(gl.UNIFORM_BUFFER, buf); gl.bufferSubData(gl.UNIFORM_BUFFER, dstByteOffset, data); gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    }
    bindUniformBufferBase(bindingIndex: number, buf: WebGLBuffer): void { this.gl.bindBufferBase(this.gl.UNIFORM_BUFFER, bindingIndex, buf); }

    // --- Render state helpers ---
    setViewport(vp: { x: number; y: number; w: number; h: number }): void { this.gl.viewport(vp.x, vp.y, vp.w, vp.h); }
    setCullEnabled(enabled: boolean): void { if (enabled) this.gl.enable(this.gl.CULL_FACE); else this.gl.disable(this.gl.CULL_FACE); }
    setDepthMask(write: boolean): void { this.gl.depthMask(write); }
    setBlendEnabled(enabled: boolean): void { if (enabled) this.gl.enable(this.gl.BLEND); else this.gl.disable(this.gl.BLEND); }
    setBlendFunc(src: number, dst: number): void { this.gl.blendFunc(src, dst); }

    bindTextureWithSampler(texBinding: number, samplerBinding: number, texture: WebGLTexture): void {
        // WebGL path binds textures via conventional texture units + uniforms; this is a no-op here
    }

    vertexAttrib2f(index: number, x: number, y: number): void { this.gl.vertexAttrib2f(index, x, y); }
    vertexAttrib3f(index: number, x: number, y: number, z: number): void { this.gl.vertexAttrib3f(index, x, y, z); }
    vertexAttrib4f(index: number, x: number, y: number, z: number, w: number): void { this.gl.vertexAttrib4f(index, x, y, z, w); }
}
