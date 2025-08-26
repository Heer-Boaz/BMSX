// Restored legacy-style CRT shader module adapted to new backend architecture.
// Provides an API close to the original glview.crt.ts so existing higher-level
// code (or future refactors) can call the familiar functions while the render
// graph drives the final present.
import { $ } from '../../core/game';
import { copy_vec2arr, vec2arr_equals } from '../../core/utils';
import type { vec2arr, vec3arr } from '../../rompack/rompack';
import { bvec } from '../2d/vertexutils2d';
import { WebGLBackend } from '../backend/webgl_backend';
import { TEXTURE_UNIT_POST_PROCESSING_SOURCE } from '../view/render_view';
import fragmentShaderCRTCode from './shaders/crt.frag.glsl';
import vertexShaderCRTCode from './shaders/crt.vert.glsl';

export interface CRTShaderOptions {
    applyNoise?: boolean;
    applyColorBleed?: boolean;
    applyScanlines?: boolean;
    applyBlur?: boolean;
    applyGlow?: boolean;
    applyFringing?: boolean;
    blurIntensity?: number;
    noiseIntensity?: number;
    colorBleed?: vec3arr;
    glowColor?: vec3arr;
}

let currentViewportSize: vec2arr | null = null;
let program: WebGLProgram | null = null;
let attribPos = -1;
let attribTex = -1;
let uResolution: WebGLUniformLocation | null = null;
let uTime: WebGLUniformLocation | null = null;
let uRandom: WebGLUniformLocation | null = null;
let uApplyNoise: WebGLUniformLocation | null = null;
let uApplyColorBleed: WebGLUniformLocation | null = null;
let uApplyScanlines: WebGLUniformLocation | null = null;
let uApplyBlur: WebGLUniformLocation | null = null;
let uApplyGlow: WebGLUniformLocation | null = null;
let uApplyFringing: WebGLUniformLocation | null = null;
let uNoiseIntensity: WebGLUniformLocation | null = null;
let uColorBleed: WebGLUniformLocation | null = null;
let uBlurIntensity: WebGLUniformLocation | null = null;
let uGlowColor: WebGLUniformLocation | null = null;
let uScale: WebGLUniformLocation | null = null;
let uFragScale: WebGLUniformLocation | null = null;
let uTexture: WebGLUniformLocation | null = null;
let uSrcResolution: WebGLUniformLocation | null = null;
let vbo: WebGLBuffer | null = null;
let tbo: WebGLBuffer | null = null;

let initialized = false;

function ensure(gl: WebGL2RenderingContext): void {
    if (initialized) return;
    const gv = $.viewAs<any>();
    const backend: WebGLBackend = gv.getBackend();
    program = backend.buildProgram(vertexShaderCRTCode, fragmentShaderCRTCode, 'crt_compat');
    if (!program) throw new Error('Failed to build CRT program');
    // Quad buffers (clip space)
    const vertices = new Float32Array([
        -1.0, -1.0,
        1.0, -1.0,
        -1.0, 1.0,
        1.0, -1.0,
        1.0, 1.0,
        -1.0, 1.0,
    ]);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const texcoords = new Float32Array([
        0.0, 1.0,
        0.0, 0.0,
        1.0, 1.0,
        1.0, 1.0,
        0.0, 0.0,
        1.0, 0.0,
    ]);
    tbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
    gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
    // Locations
    attribPos = gl.getAttribLocation(program, 'a_position');
    attribTex = gl.getAttribLocation(program, 'a_texcoord');
    uResolution = gl.getUniformLocation(program, 'u_resolution');
    uTime = gl.getUniformLocation(program, 'u_time');
    uRandom = gl.getUniformLocation(program, 'u_random');
    uApplyNoise = gl.getUniformLocation(program, 'u_applyNoise');
    uApplyColorBleed = gl.getUniformLocation(program, 'u_applyColorBleed');
    uApplyScanlines = gl.getUniformLocation(program, 'u_applyScanlines');
    uApplyBlur = gl.getUniformLocation(program, 'u_applyBlur');
    uApplyGlow = gl.getUniformLocation(program, 'u_applyGlow');
    uApplyFringing = gl.getUniformLocation(program, 'u_applyFringing');
    uNoiseIntensity = gl.getUniformLocation(program, 'u_noiseIntensity');
    uColorBleed = gl.getUniformLocation(program, 'u_colorBleed');
    uBlurIntensity = gl.getUniformLocation(program, 'u_blurIntensity');
    uGlowColor = gl.getUniformLocation(program, 'u_glowColor');
    uScale = gl.getUniformLocation(program, 'u_scale');
    uFragScale = gl.getUniformLocation(program, 'u_fragscale');
    uTexture = gl.getUniformLocation(program, 'u_texture');
    uSrcResolution = gl.getUniformLocation(program, 'u_srcResolution');
    initialized = true;
}

export function setCrtOptions(gl: WebGL2RenderingContext, opts: CRTShaderOptions): void {
    ensure(gl);
    gl.useProgram(program);
    if (opts.applyNoise !== undefined && uApplyNoise) gl.uniform1i(uApplyNoise, opts.applyNoise ? 1 : 0);
    if (opts.applyColorBleed !== undefined && uApplyColorBleed) gl.uniform1i(uApplyColorBleed, opts.applyColorBleed ? 1 : 0);
    if (opts.applyScanlines !== undefined && uApplyScanlines) gl.uniform1i(uApplyScanlines, opts.applyScanlines ? 1 : 0);
    if (opts.applyBlur !== undefined && uApplyBlur) gl.uniform1i(uApplyBlur, opts.applyBlur ? 1 : 0);
    if (opts.applyGlow !== undefined && uApplyGlow) gl.uniform1i(uApplyGlow, opts.applyGlow ? 1 : 0);
    if (opts.applyFringing !== undefined && uApplyFringing) gl.uniform1i(uApplyFringing, opts.applyFringing ? 1 : 0);
    if (opts.noiseIntensity !== undefined && uNoiseIntensity) gl.uniform1f(uNoiseIntensity, opts.noiseIntensity);
    if (opts.colorBleed && uColorBleed) gl.uniform3fv(uColorBleed, new Float32Array(opts.colorBleed));
    if (opts.blurIntensity !== undefined && uBlurIntensity) gl.uniform1f(uBlurIntensity, opts.blurIntensity);
    if (opts.glowColor && uGlowColor) gl.uniform3fv(uGlowColor, new Float32Array(opts.glowColor));
}

export function setDefaultCRTUniforms(gl: WebGL2RenderingContext, canvasSize: vec2arr, opts: CRTShaderOptions): void {
    ensure(gl);
    gl.useProgram(program);
    setCrtOptions(gl, opts);
    if (uScale) gl.uniform1f(uScale, 1.0);
    if (uFragScale) gl.uniform1f(uFragScale, 1.0);
    if (uTexture) gl.uniform1i(uTexture, TEXTURE_UNIT_POST_PROCESSING_SOURCE);
    if (uSrcResolution) gl.uniform2fv(uSrcResolution, new Float32Array(canvasSize));
}

export function handleCRTResize(gl: WebGL2RenderingContext, w: number, h: number): void {
    ensure(gl);
    const newSize: vec2arr = [w, h];
    if (uResolution && !vec2arr_equals(currentViewportSize, newSize)) {
        gl.useProgram(program);
        gl.uniform2fv(uResolution, new Float32Array(newSize));
        currentViewportSize = copy_vec2arr(newSize);
    }
}

export function drawCRT(gl: WebGL2RenderingContext, outWidth: number, outHeight: number): void {
    ensure(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outWidth, outHeight);
    gl.useProgram(program);
    // dynamic time/random
    const now = Date.now() / 1000;
    if (uTime) gl.uniform1f(uTime, now);
    if (uRandom) gl.uniform1f(uRandom, Math.random());
    // attributes
    if (vbo && attribPos !== -1) { gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.enableVertexAttribArray(attribPos); gl.vertexAttribPointer(attribPos, 2, gl.FLOAT, false, 0, 0); }
    if (tbo && attribTex !== -1) { gl.bindBuffer(gl.ARRAY_BUFFER, tbo); gl.enableVertexAttribArray(attribTex); gl.vertexAttribPointer(attribTex, 2, gl.FLOAT, false, 0, 0); }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// Optional helper to (re)build buffers (legacy compatibility with old function names)
export function createCRTVertexBuffer(gl: WebGL2RenderingContext, width: number, height: number): void {
    ensure(gl);
    const vertices = new Float32Array([
        -1.0, -1.0,
        1.0, -1.0,
        -1.0, 1.0,
        1.0, -1.0,
        1.0, 1.0,
        -1.0, 1.0,
    ]);
    // preserve legacy bvec.set semantics (not strictly needed for full-screen quad now)
    bvec.set(vertices, 0, 0, 0, width, height, 1, 1);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

export function createCRTShaderTexcoordBuffer(gl: WebGL2RenderingContext): void {
    ensure(gl);
    const texcoords = new Float32Array([
        0.0, 1.0,
        0.0, 0.0,
        1.0, 1.0,
        1.0, 1.0,
        0.0, 0.0,
        1.0, 0.0,
    ]);
    tbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
    gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
}

// Convenience one-shot init replicating old sequence
export function initCRT(gl: WebGL2RenderingContext, canvasSize: vec2arr, opts: CRTShaderOptions): void {
    ensure(gl);
    setDefaultCRTUniforms(gl, canvasSize, opts);
    handleCRTResize(gl, canvasSize[0], canvasSize[1]);
}
