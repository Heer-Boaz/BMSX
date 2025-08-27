// Particles pipeline (formerly glview.particles) inlined from legacy module.
import { $ } from '../../core/game';

import type { vec3arr } from '../../rompack/rompack';
import * as GLR from '../backend/gl_resources';
import { getRenderContext } from '../backend/pipeline_registry';
import { TEXTURE_UNIT_PARTICLE } from '../backend/webgl.constants';
import { WebGLBackend } from '../backend/webgl_backend';
import { Color } from '../view';
import { M4 } from './math3d';
import particleFragCode from './shaders/particle.frag.glsl';
import particleVertCode from './shaders/particle.vert.glsl';

export interface DrawParticleOptions { position: vec3arr; size: number; color: Color; texture?: WebGLTexture; }
// Legacy global queue kept for backward-compat submission; prefer view.renderer.queues.particles
// Legacy queue removed; use centralized view.renderer.queues.particles instead.
const MAX_PARTICLES = 1000;
const INSTANCE_FLOATS = 8; // vec4(position+size) + vec4(color)
const BYTES_PER_FLOAT = 4;
const INSTANCE_BYTES = INSTANCE_FLOATS * BYTES_PER_FLOAT;
let particleProgram: WebGLProgram; let vao: WebGLVertexArrayObject; let quadBuffer: WebGLBuffer; let instanceBuffer: WebGLBuffer; let viewProjLocation: WebGLUniformLocation; let cameraRightLocation: WebGLUniformLocation; let cameraUpLocation: WebGLUniformLocation; let textureLocation: WebGLUniformLocation; let defaultTexture: WebGLTexture; const instanceData = new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS); const camRight = new Float32Array(3); const camUp = new Float32Array(3);
export function init(gl: WebGL2RenderingContext): void {
    vao = gl.createVertexArray()!;
    quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    const quad = new Float32Array([-0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const whitePixel = new Uint8Array([255, 255, 255, 255]);
    defaultTexture = gl.createTexture()!;
    getRenderContext().bind2DTex(defaultTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, whitePixel);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    getRenderContext().bind2DTex(null);
}
export function createParticleProgram(gl: WebGL2RenderingContext): void {
    const b = getRenderContext().getBackend() as WebGLBackend;
    const program = b.buildProgram(particleVertCode, particleFragCode, 'particles');
    if (!program) throw Error('Failed to build particle shader program');
    particleProgram = program;
    viewProjLocation = gl.getUniformLocation(program, 'u_viewProjection')!;
    cameraRightLocation = gl.getUniformLocation(program, 'u_cameraRight')!;
    cameraUpLocation = gl.getUniformLocation(program, 'u_cameraUp')!;
    textureLocation = gl.getUniformLocation(program, 'u_texture')!;
}
export function setupParticleLocations(gl: WebGL2RenderingContext): void { gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer); gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * INSTANCE_BYTES, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, INSTANCE_BYTES, 0); gl.vertexAttribDivisor(1, 1); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, INSTANCE_BYTES, 4 * BYTES_PER_FLOAT); gl.vertexAttribDivisor(2, 1); gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null); }
export interface ParticlePassState { width: number; height: number; viewProj: Float32Array; camRight: Float32Array; camUp: Float32Array }
export function renderParticleBatch(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number, state?: ParticlePassState): void {
    // Combine centralized queue (if any) with legacy queue for backward compatibility
    type V = { renderer?: { queues?: { particles?: DrawParticleOptions[] } } };
    const ctx = getRenderContext() as unknown as V;
    const combined: DrawParticleOptions[] = [];
    const q = ctx.renderer?.queues?.particles;
    if (q && q.length) combined.push(...q);
    const count = combined.length;
    if (count === 0) return;
    if (state) {
        camRight.set(state.camRight);
        camUp.set(state.camUp);
    } else {
        const activeCamera = $.model.activeCamera3D;
        M4.viewRightUpInto(activeCamera.view, camRight, camUp);
    }
    const batches = new Map<WebGLTexture, DrawParticleOptions[]>();
    for (const p of combined) {
        const tex = p.texture ?? defaultTexture;
        let arr = batches.get(tex);
        if (!arr) {
            arr = [];
            batches.set(tex, arr);
        }
        arr.push(p);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    GLR.glSwitchProgram(gl, particleProgram);
    gl.uniformMatrix4fv(viewProjLocation, false, state ? state.viewProj : $.model.activeCamera3D.viewProjection);
    gl.uniform3fv(cameraRightLocation, camRight);
    gl.uniform3fv(cameraUpLocation, camUp);
    gl.uniform1i(textureLocation, TEXTURE_UNIT_PARTICLE);
    gl.bindVertexArray(vao);
    for (const [tex, arr] of batches) {
        const batchCount = Math.min(arr.length, MAX_PARTICLES);
        for (let i = 0; i < batchCount; i++) {
            const p = arr[i];
            const base = i * INSTANCE_FLOATS;
            instanceData[base] = p.position[0];
            instanceData[base + 1] = p.position[1];
            instanceData[base + 2] = p.position[2];
            instanceData[base + 3] = p.size;
            instanceData[base + 4] = p.color.r;
            instanceData[base + 5] = p.color.g;
            instanceData[base + 6] = p.color.b;
            instanceData[base + 7] = p.color.a;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData.subarray(0, batchCount * INSTANCE_FLOATS));
        const v = getRenderContext();
        v.activeTexUnit = TEXTURE_UNIT_PARTICLE;
        v.bind2DTex(tex);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batchCount);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    // Clear queues used
    if (q) q.length = 0;
}
export function setDefaultParticleTexture(tex: WebGLTexture): void { defaultTexture = tex; }
// New submission helper (prefer over touching particlesToDraw)
export function submitParticle(p: DrawParticleOptions): void {
    type V = { renderer?: { queues?: { particles?: DrawParticleOptions[] } } };
    const ctx = getRenderContext() as unknown as V;
    const q = ctx.renderer?.queues?.particles;
    if (q) q.push({ ...p });
}
