// WebGL backend implementation extracted from legacy gpu_backend.ts
import * as SpritesPipeline from '../2d/sprites_pipeline';
import * as MeshPipeline from '../3d/mesh_pipeline';
import * as ParticlesPipeline from '../3d/particles_pipeline';
import * as SkyboxPipeline from '../3d/skybox_pipeline';
import { SkyboxPassState } from '../3d/skybox_pipeline';
// Import remaining constants/types; low-level helpers will be inlined here (migrated from glutils.ts)
import { TEXTURE_UNIT_SHADOW_MAP } from '../3d/mesh_pipeline';
// All low-level helpers now live as static methods below; legacy glutils imports removed.
import { TextureParams } from '../gpu_types';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE, TEXTURE_UNIT_SKYBOX, TEXTURE_UNIT_UPLOAD } from '../view/render_view';
import { GPUBackend, PassEncoder, PipelineDesc, PipelineHandle, PipelineId, RenderPassDesc } from './interfaces';
import { MAX_SPRITES, VERTEXCOORDS_SIZE } from './webgl.constants';
// CRT pipeline shader sources
import fragmentShaderCRTCode from '../post/shaders/crt.frag.glsl';
import vertexShaderCRTCode from '../post/shaders/crt.vert.glsl';

// (Texture units sourced from render_view constants to avoid duplication.)

interface InternalPipeline {
    handle: PipelineHandle;
    exec: (gl: WebGL2RenderingContext, fbo: WebGLFramebuffer | null) => void;
    state?: unknown;
    program?: WebGLProgram | null;
    uniformLocations?: Map<string, WebGLUniformLocation | null>;
    bindingLayout?: PipelineDesc['bindingLayout'];
}

export class WebGLBackend implements GPUBackend {
    private texIds = new WeakMap<WebGLTexture, number>();
    private nextTexId = 1;
    private fboCache = new Map<string, WebGLFramebuffer | null>();
    private pipelines: InternalPipeline[] = [];
    private extraStates = new Map<string, unknown>();
    constructor(private gl: WebGL2RenderingContext) {
        // Create wrapper pipelines
        this.createPipeline({
            label: 'Skybox'
        });
        this.createPipeline({
            label: 'MeshBatch'
        });
        this.createPipeline({
            label: 'Particles'
        });
        this.createPipeline({
            label: 'Sprites'
        });
        this.createPipeline({
            label: 'CRT', vsCode: vertexShaderCRTCode, fsCode: fragmentShaderCRTCode, bindingLayout: {
                uniforms: [
                    'u_resolution', 'u_time', 'u_random', 'u_applyNoise', 'u_applyColorBleed', 'u_applyScanlines', 'u_applyBlur', 'u_applyGlow', 'u_applyFringing',
                    'u_noiseIntensity', 'u_colorBleed', 'u_blurIntensity', 'u_glowColor', 'u_scale', 'u_fragscale', 'u_texture', 'u_srcResolution'
                ]
            }
        });
        this.createPipeline({
            label: 'Fog'
        });
    }
    // === Static low-level WebGL helpers (migrated from glutils.ts) ===
    // NOTE: Kept static so existing call sites can be refactored gradually to import from backend if desired.
    static buildQuadTexCoords(): Float32Array {
        const textureCoordinates = new Float32Array(VERTEXCOORDS_SIZE * MAX_SPRITES);
        for (let i = 0; i < VERTEXCOORDS_SIZE * MAX_SPRITES - VERTEXCOORDS_SIZE; i += VERTEXCOORDS_SIZE) {
            textureCoordinates.set([
                0.0, 1.0,
                0.0, 0.0,
                1.0, 1.0,
                1.0, 1.0,
                0.0, 0.0,
                1.0, 0.0,
            ], i);
        }
        return textureCoordinates;
    }
    static glCreateBuffer(gl: WebGL2RenderingContext, data?: Float32Array | Uint8Array): WebGLBuffer { const buffer = gl.createBuffer()!; if (!data) return buffer; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); return buffer; }
    static glCreateElementBuffer(gl: WebGL2RenderingContext, data?: Uint8Array | Uint16Array | Uint32Array): WebGLBuffer { const buffer = gl.createBuffer()!; if (!data) return buffer; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); return buffer; }
    static glSetupAttributeFloat(gl: WebGL2RenderingContext, buffer: WebGLBuffer, location: number, size: number): void { if (location < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0); }
    static glSetupAttributeInt(gl: WebGL2RenderingContext, buffer: WebGLBuffer, location: number, size: number, type: GLenum = WebGL2RenderingContext.UNSIGNED_BYTE): void { if (location < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(location); gl.vertexAttribIPointer(location, size, type, 0, 0); }
    static glUpdateBuffer(gl: WebGL2RenderingContext, buffer: WebGLBuffer, target: GLenum, offset: number, data: ArrayBufferView): void { gl.bindBuffer(target, buffer); gl.bufferData(target, data.byteLength, gl.STREAM_DRAW); gl.bufferSubData(target, offset, data); }
    static glLoadShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
        const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { throw Error(`Error compiling shader: ${gl.getShaderInfoLog(shader)} `); } return shader;
    }
    static glCreateTexture(gl: WebGL2RenderingContext, img?: ImageBitmap, size?: { x: number; y: number }, unit: number | null = null): WebGLTexture { const tex = gl.createTexture()!; if (unit != null) gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img); else if (size) gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, size.x, size.y, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return tex; }
    static glCreateShadowMapTextureAndFramebuffer(gl: WebGL2RenderingContext, desc: TextureParams, unit = TEXTURE_UNIT_SHADOW_MAP) { const tex = gl.createTexture()!; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, desc.size.x, desc.size.y, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); const fbo = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER); if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Shadow FBO incomplete: 0x${status.toString(16)}`); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { texture: tex, framebuffer: fbo }; }
    static glCreateTextureFromImage(gl: WebGL2RenderingContext, img: ImageBitmap, desc: TextureParams, unit: number | null = null): WebGLTexture { const tex = gl.createTexture()!; if (!img) throw new Error('Image is not defined'); if (img.width === 0 || img.height === 0) throw new Error(`Image has invalid dimensions: ${img.width}x${img.height}`); if (unit != null) gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, desc.wrapS ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, desc.wrapT ?? gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, desc.minFilter ?? gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, desc.magFilter ?? gl.NEAREST); return tex; }
    static glCreateDepthTexture(gl: WebGL2RenderingContext, width: number, height: number, unit = TEXTURE_UNIT_UPLOAD): WebGLTexture { const tex = gl.createTexture()!; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return tex; }
    static glSwitchProgram(gl: WebGL2RenderingContext, program: WebGLProgram): void { gl.useProgram(program); }
    createTextureFromImage(img: ImageBitmap, desc: TextureParams): WebGLTexture {
        return WebGLBackend.glCreateTextureFromImage(this.gl, img, desc, null);
    }
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
    createColorTexture(desc: { width: number; height: number; format?: GLenum }): WebGLTexture { return WebGLBackend.glCreateTexture(this.gl, undefined, { x: desc.width, y: desc.height }, TEXTURE_UNIT_UPLOAD); }
    createDepthTexture(desc: { width: number; height: number }): WebGLTexture { return WebGLBackend.glCreateDepthTexture(this.gl, desc.width, desc.height, TEXTURE_UNIT_UPLOAD); }
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
    createPipeline(desc: PipelineDesc): PipelineHandle {
        const id = this.pipelines.length + 1;
        const handle: PipelineHandle = { id, label: desc.label };
        let exec: InternalPipeline['exec'];
        if (desc.vsCode && desc.fsCode) {
            const program = this.buildProgram(desc.vsCode, desc.fsCode, desc.label ?? 'pipeline' + id);
            const uniformLocations = new Map<string, WebGLUniformLocation | null>();
            if (desc.bindingLayout?.uniforms) {
                for (const u of desc.bindingLayout.uniforms) uniformLocations.set(u, program ? this.gl.getUniformLocation(program, u) : null);
            }
            // Special handling for CRT: create fullscreen quad buffers + default option state
            if (desc.label === 'CRT') {
                const gl = this.gl;
                // Fullscreen quad positions in PIXEL space (vertex shader converts to clip)
                let vbo = gl.createBuffer();
                let lastSrcW = -1, lastSrcH = -1;
                function ensureQuadVerts(srcW: number, srcH: number) {
                    if (srcW === lastSrcW && srcH === lastSrcH && vbo) return;
                    const verts = new Float32Array([
                        0.0, 0.0,          // bottom left (y flipped later in VS)
                        0.0, srcH,         // top left
                        srcW, 0.0,         // bottom right
                        srcW, 0.0,         // bottom right
                        0.0, srcH,         // top left
                        srcW, srcH,        // top right
                    ]);
                    if (!vbo) vbo = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
                    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
                    lastSrcW = srcW; lastSrcH = srcH;
                }
                const texcoords = new Float32Array([
                    0.0, 1.0,
                    0.0, 0.0,
                    1.0, 1.0,
                    1.0, 1.0,
                    0.0, 0.0,
                    1.0, 0.0
                ]);
                const tbo = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
                gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
                const attribPos = gl.getAttribLocation(program!, 'a_position');
                const attribTex = gl.getAttribLocation(program!, 'a_texcoord');
                exec = (glExec) => {
                    const st = this.getPipelineState<any>('CRT');
                    if (!st) return;
                    // Bind default framebuffer (present to screen)
                    glExec.bindFramebuffer(glExec.FRAMEBUFFER, null);
                    const outW = st.outWidth ?? st.width;
                    const outH = st.outHeight ?? st.height;
                    const srcW = st.baseWidth ?? st.width;   // logical resolution
                    const srcH = st.baseHeight ?? st.height; // logical resolution
                    const fragScale = st.fragScale ?? (st.width / srcW);
                    // Ensure quad sized to source (offscreen buffer) dimensions
                    ensureQuadVerts(st.width, st.height);
                    glExec.viewport(0, 0, outW, outH);
                    if (program) glExec.useProgram(program);
                    // Update dynamic uniforms
                    const u = (name: string) => uniformLocations.get(name);
                    const now = Date.now() / 1000;
                    if (u('u_time')) glExec.uniform1f(u('u_time')!, now);
                    if (u('u_random')) glExec.uniform1f(u('u_random')!, Math.random());
                    if (u('u_resolution')) glExec.uniform2f(u('u_resolution')!, outW, outH);
                    if (u('u_srcResolution')) glExec.uniform2f(u('u_srcResolution')!, srcW, srcH); // base logical resolution
                    if (u('u_scale')) glExec.uniform1f(u('u_scale')!, 1.0);
                    if (u('u_fragscale')) glExec.uniform1f(u('u_fragscale')!, fragScale);
                    // Feature toggles & params
                    const opts = st.options || {};
                    function boolU(name: string, val: boolean | undefined, d: boolean) { if (u(name)) glExec.uniform1i(u(name)!, (val ?? d) ? 1 : 0); }
                    boolU('u_applyNoise', opts.applyNoise, true);
                    boolU('u_applyColorBleed', opts.applyColorBleed, true);
                    boolU('u_applyScanlines', opts.applyScanlines, true);
                    boolU('u_applyBlur', opts.applyBlur, true);
                    boolU('u_applyGlow', opts.applyGlow, true);
                    boolU('u_applyFringing', opts.applyFringing, true);
                    if (u('u_noiseIntensity')) glExec.uniform1f(u('u_noiseIntensity')!, opts.noiseIntensity ?? 0.4);
                    if (u('u_colorBleed')) glExec.uniform3fv(u('u_colorBleed')!, new Float32Array(opts.colorBleed ?? [0.02, 0.0, 0.0]));
                    if (u('u_blurIntensity')) glExec.uniform1f(u('u_blurIntensity')!, opts.blurIntensity ?? 0.6);
                    if (u('u_glowColor')) glExec.uniform3fv(u('u_glowColor')!, new Float32Array(opts.glowColor ?? [0.12, 0.10, 0.09]));
                    if (u('u_texture')) glExec.uniform1i(u('u_texture')!, TEXTURE_UNIT_POST_PROCESSING_SOURCE);
                    // Bind source color texture
                    if (st.colorTex) {
                        glExec.activeTexture(glExec.TEXTURE0 + TEXTURE_UNIT_POST_PROCESSING_SOURCE);
                        glExec.bindTexture(glExec.TEXTURE_2D, st.colorTex);
                    }
                    // Setup attributes
                    glExec.bindBuffer(glExec.ARRAY_BUFFER, vbo);
                    if (attribPos !== -1) { glExec.enableVertexAttribArray(attribPos); glExec.vertexAttribPointer(attribPos, 2, glExec.FLOAT, false, 0, 0); }
                    glExec.bindBuffer(glExec.ARRAY_BUFFER, tbo);
                    if (attribTex !== -1) { glExec.enableVertexAttribArray(attribTex); glExec.vertexAttribPointer(attribTex, 2, glExec.FLOAT, false, 0, 0); }
                    glExec.drawArrays(glExec.TRIANGLES, 0, 6);
                };
            } else {
                exec = (glExec) => { if (program) glExec.useProgram(program); };
            }
            this.pipelines.push({ handle, exec, program, uniformLocations, bindingLayout: desc.bindingLayout });
            return handle;
        }
        switch (desc.label) {
            case 'Skybox': exec = (gl, fbo) => {
                const st = this.getPipelineState<SkyboxPassState>('Skybox'); if (!st) return; SkyboxPipeline.drawSkyboxWithState(gl, fbo as WebGLFramebuffer, st);
            }; break;
            case 'MeshBatch': exec = (gl, fbo) => { const st = this.getPipelineState<{ width: number; height: number; view: { camPos: { x: number; y: number; z: number }; viewProj: Float32Array }; fog?: any; lighting?: any }>('MeshBatch'); if (!st) return; MeshPipeline.renderMeshBatch(gl, fbo as WebGLFramebuffer, st.width, st.height, { width: st.width, height: st.height, camPos: st.view.camPos, viewProj: st.view.viewProj, fog: st.fog ?? undefined, lighting: st.lighting }); }; break;
            case 'Particles': exec = (gl, fbo) => { const st = this.getPipelineState<{ width: number; height: number; viewProj: Float32Array; camRight: Float32Array; camUp: Float32Array }>('Particles'); if (!st) return; ParticlesPipeline.renderParticleBatch(gl, fbo as WebGLFramebuffer, st.width, st.height, st); }; break;
            case 'Sprites': exec = (gl, fbo) => { const st = this.getPipelineState<{ width: number; height: number; baseWidth?: number; baseHeight?: number }>('Sprites'); if (!st) return; SpritesPipeline.renderSpriteBatch(gl, fbo as WebGLFramebuffer, st.width, st.height, st.baseWidth, st.baseHeight); }; break;
            case 'CRT': exec = () => { /* should have been created with shaders earlier */ }; break;
            case 'Fog': exec = () => { /* state only */ }; break;
            default: exec = () => { }; break;
        }
        this.pipelines.push({ handle, exec });
        return handle;
    }
    destroyPipeline(p: PipelineHandle): void { this.pipelines = this.pipelines.filter(pl => pl.handle.id !== p.id); }
    setPipeline(pass: PassEncoder, pipeline: PipelineHandle): void { pass._pipelineId = pipeline.id; }
    private runCurrentPipeline(pass: PassEncoder): void { const pid = pass._pipelineId; if (!pid) return; const pl = this.pipelines.find(p => p.handle.id === pid); if (!pl) return; pl.exec(this.gl, pass.fbo as WebGLFramebuffer | null); }
    getPipelineState<S = unknown>(label: PipelineId | string): S | undefined { const p = this.pipelines.find(p => p.handle.label === label); const st = p?.state as S | undefined; if (!p && this.extraStates.has(label as string)) return this.extraStates.get(label as string) as S; return st; }
    setPipelineState(label: string, state: unknown): void { const p = this.pipelines.find(p => p.handle.label === label); if (!p) { this.extraStates.set(label, state); return; } p.state = state; }
    executePipeline(label: PipelineId | string, fbo: unknown): void { const pl = this.pipelines.find(p => p.handle.label === label); if (!pl) throw Error(`Pipeline '${label}' not found`); const pass: PassEncoder = { fbo, desc: {} }; this.setPipeline(pass, pl.handle); this.runCurrentPipeline(pass); }
    buildProgram(vsSource: string, fsSource: string, label: string): WebGLProgram | null { const gl = this.gl; function compile(type: number, src: string): WebGLShader | null { const s = gl.createShader(type); if (!s) return null; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('Shader compile failed (' + label + '):', gl.getShaderInfoLog(s)); gl.deleteShader(s); return null; } return s; } const vs = compile(gl.VERTEX_SHADER, vsSource); const fs = compile(gl.FRAGMENT_SHADER, fsSource); if (!vs || !fs) return null; const prog = gl.createProgram(); if (!prog) return null; gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error('Program link failed (' + label + '):', gl.getProgramInfoLog(prog)); gl.deleteProgram(prog); return null; } gl.deleteShader(vs); gl.deleteShader(fs); return prog; }
}