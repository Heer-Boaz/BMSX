// Particles pipeline (formerly glview.particles) inlined from legacy module.
import { $ } from '../../core/game';

import type { vec3arr } from '../../rompack/rompack';
import { GPUBackend } from '../backend/pipeline_interfaces';
import { getRenderContext } from '../backend/pipeline_registry';
import { TEXTURE_UNIT_PARTICLE } from '../backend/webgl.constants';
import { WebGLBackend } from '../backend/webgl_backend';
import { color } from '../view';
import { M4 } from './math3d';

export interface DrawParticleOptions { position: vec3arr; size: number; color: color; texture?: WebGLTexture; }
// Legacy global queue kept for backward-compat submission; prefer view.renderer.queues.particles
// Legacy queue removed; use centralized view.renderer.queues.particles instead.
const MAX_PARTICLES = 1000;
const INSTANCE_FLOATS = 8; // vec4(position+size) + vec4(color)
const BYTES_PER_FLOAT = 4;
const INSTANCE_BYTES = INSTANCE_FLOATS * BYTES_PER_FLOAT;
let particleProgram: WebGLProgram; let vao: WebGLVertexArrayObject; let quadBuffer: WebGLBuffer; let instanceBuffer: WebGLBuffer; let viewProjLocation: WebGLUniformLocation; let cameraRightLocation: WebGLUniformLocation; let cameraUpLocation: WebGLUniformLocation; let textureLocation: WebGLUniformLocation; let defaultTexture: WebGLTexture; const instanceData = new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS); const camRight = new Float32Array(3); const camUp = new Float32Array(3);
export function init(fbo: unknown): void {
    const backend = (getRenderContext().getBackend() as WebGLBackend);
    const gl = backend.gl;
    vao = backend.createVertexArray ? (backend.createVertexArray() as WebGLVertexArrayObject) : gl.createVertexArray()!;
    const quad = new Float32Array([-0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
    if (backend.createVertexBuffer) {
        quadBuffer = backend.createVertexBuffer(quad, 'static') as WebGLBuffer;
        instanceBuffer = backend.createVertexBuffer(new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS), 'dynamic') as WebGLBuffer;
    } else {
        quadBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
        instanceBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * INSTANCE_BYTES, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
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
// Removed: program creation is handled by the backend/pipeline manager
export function setupParticleUniforms(backend: GPUBackend): void {
    const gl = (backend as WebGLBackend).gl;
    // Pick up program created/bound by GPUBackend/GraphicsPipelineManager
    if (!particleProgram) {
        const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
        if (!current) throw new Error('Particle shader program not bound during bootstrap');
        particleProgram = current;
    }
    viewProjLocation = gl.getUniformLocation(particleProgram, 'u_viewProjection')!;
    cameraRightLocation = gl.getUniformLocation(particleProgram, 'u_cameraRight')!;
    cameraUpLocation = gl.getUniformLocation(particleProgram, 'u_cameraUp')!;
    textureLocation = gl.getUniformLocation(particleProgram, 'u_texture')!;
}
export function setupParticleLocations(): void {
    const backend = (getRenderContext().getBackend() as WebGLBackend);
    const gl = backend.gl;
    // VAO bind
    if (backend.bindVertexArray) backend.bindVertexArray(vao); else gl.bindVertexArray(vao);
    // Static quad buffer at attrib 0
    if (backend.bindArrayBuffer) backend.bindArrayBuffer(quadBuffer); else gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    if (backend.enableVertexAttrib) backend.enableVertexAttrib(0); else gl.enableVertexAttribArray(0);
    if (backend.vertexAttribPointer) backend.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); else gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Instance buffer at attribs 1 and 2
    if (backend.bindArrayBuffer) backend.bindArrayBuffer(instanceBuffer); else gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    if (backend.enableVertexAttrib) backend.enableVertexAttrib(1); else gl.enableVertexAttribArray(1);
    if (backend.vertexAttribPointer) backend.vertexAttribPointer(1, 4, gl.FLOAT, false, INSTANCE_BYTES, 0); else gl.vertexAttribPointer(1, 4, gl.FLOAT, false, INSTANCE_BYTES, 0);
    if (backend.vertexAttribDivisor) backend.vertexAttribDivisor(1, 1); else gl.vertexAttribDivisor(1, 1);
    if (backend.enableVertexAttrib) backend.enableVertexAttrib(2); else gl.enableVertexAttribArray(2);
    if (backend.vertexAttribPointer) backend.vertexAttribPointer(2, 4, gl.FLOAT, false, INSTANCE_BYTES, 4 * BYTES_PER_FLOAT); else gl.vertexAttribPointer(2, 4, gl.FLOAT, false, INSTANCE_BYTES, 4 * BYTES_PER_FLOAT);
    if (backend.vertexAttribDivisor) backend.vertexAttribDivisor(2, 1); else gl.vertexAttribDivisor(2, 1);
    if (backend.bindVertexArray) backend.bindVertexArray(null); else gl.bindVertexArray(null);
    if (backend.bindArrayBuffer) backend.bindArrayBuffer(null); else gl.bindBuffer(gl.ARRAY_BUFFER, null);
}
export interface ParticlePassState { width: number; height: number; viewProj: Float32Array; camRight: Float32Array; camUp: Float32Array }
export function renderParticleBatch(framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number, state?: ParticlePassState): void {
    const gl = (getRenderContext().getBackend() as WebGLBackend).gl;
    // Combine centralized queue (if any) with legacy queue for backward compatibility
    type V = { renderer?: { queues?: { particles?: DrawParticleOptions[] } } };
    const ctx = getRenderContext() as unknown as V;
    // Pooled scratch array to avoid allocations
    const combined: DrawParticleOptions[] = [];
    const q = ctx.renderer?.queues?.particles;
    if (q && q.length) {
        combined.length = 0;
        for (let i = 0; i < q.length; i++) combined.push(q[i]);
    }
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
    // FBO binding handled by RenderGraph beginRenderPass
    (getRenderContext().getBackend() as Partial<WebGLBackend>).setViewport?.({ x: 0, y: 0, w: canvasWidth, h: canvasHeight });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    // Program is bound by backend pipeline
    gl.uniformMatrix4fv(viewProjLocation, false, state ? state.viewProj : $.model.activeCamera3D.viewProjection);
    gl.uniform3fv(cameraRightLocation, camRight);
    gl.uniform3fv(cameraUpLocation, camUp);
    gl.uniform1i(textureLocation, TEXTURE_UNIT_PARTICLE);
    const backend = (getRenderContext().getBackend() as Partial<WebGLBackend>);
    backend.bindVertexArray?.(vao);
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
        const backend = (getRenderContext().getBackend() as Partial<WebGLBackend>);
        backend.bindArrayBuffer!(instanceBuffer);
        backend.updateVertexBuffer!(instanceBuffer, instanceData.subarray(0, batchCount * INSTANCE_FLOATS));
        const v = getRenderContext();
        v.activeTexUnit = TEXTURE_UNIT_PARTICLE;
        v.bind2DTex(tex);
        const passStub = { fbo: framebuffer, desc: { label: 'particles' } } as unknown as Parameters<WebGLBackend['drawInstanced']>[0];
        backend.drawInstanced!(passStub as any, 6, batchCount, 0, 0);
    }
    backend.bindVertexArray?.(null);
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
