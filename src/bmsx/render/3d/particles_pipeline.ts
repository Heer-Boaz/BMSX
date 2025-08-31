import { $ } from '../../core/game';

import type { vec3arr } from '../../rompack/rompack';
import particleFS from '../3d/shaders/particle.frag.glsl';
import particleVS from '../3d/shaders/particle.vert.glsl';
import { FeatureQueue } from '../backend/feature_queue';
import { PassEncoder } from '../backend/pipeline_interfaces';
import { ParticlePipelineState, RenderPassLibrary } from '../backend/renderpasslib';
import { TEXTURE_UNIT_PARTICLE } from '../backend/webgl.constants';
import { WebGLBackend } from '../backend/webgl_backend';
import { color } from '../view';
import { M4 } from './math3d';

function getRenderContext() {
    return $.view;
}

const camRight = new Float32Array(3);
const camUp = new Float32Array(3);
let particleAmbientModeDefault: 0 | 1 = 0;
let particleAmbientFactorDefault = 1.0;

export function setAmbientDefaults(mode: 0 | 1, factor = 1.0): void {
    particleAmbientModeDefault = mode;
    particleAmbientFactorDefault = Math.max(0, Math.min(1, factor));
}

export interface DrawParticleOptions { position: vec3arr; size: number; color: color; texture?: WebGLTexture; ambientMode?: 0 | 1; ambientFactor?: number; }
const MAX_PARTICLES = 1000;
const INSTANCE_FLOATS = 8; // vec4(position+size) + vec4(color)
const BYTES_PER_FLOAT = 4;
const INSTANCE_BYTES = INSTANCE_FLOATS * BYTES_PER_FLOAT;
let particleProgram: WebGLProgram; let vao: WebGLVertexArrayObject; let quadBuffer: WebGLBuffer; let instanceBuffers: WebGLBuffer[] = []; let viewProjLocation: WebGLUniformLocation; let cameraRightLocation: WebGLUniformLocation; let cameraUpLocation: WebGLUniformLocation; let textureLocation: WebGLUniformLocation; let ambientModeLocation: WebGLUniformLocation; let ambientFactorLocation: WebGLUniformLocation; let defaultTexture: WebGLTexture; const instanceData = new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS);
const particleQueue = new FeatureQueue<DrawParticleOptions>(1024);
let framePage = 0;
export function init(_fbo: unknown): void {
    const backend = (getRenderContext().backend as WebGLBackend);
    const gl = backend.gl;
    vao = backend.createVertexArray() as WebGLVertexArrayObject;
    const quad = new Float32Array([-0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
    quadBuffer = backend.createVertexBuffer(quad, 'static') as WebGLBuffer;
    instanceBuffers = [0, 1, 2].map(() => backend.createVertexBuffer(new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS), 'dynamic') as WebGLBuffer);
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

export function setupParticleUniforms(backend: WebGLBackend): void {
    const gl = backend.gl;
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
    ambientModeLocation = gl.getUniformLocation(particleProgram, 'u_particleAmbientMode')!;
    ambientFactorLocation = gl.getUniformLocation(particleProgram, 'u_particleAmbientFactor')!;
}

export function setupParticleLocations(): void {
    const backend = (getRenderContext().backend as WebGLBackend);
    const gl = backend.gl;
    backend.bindVertexArray(vao);
    // Static quad buffer at attrib 0
    backend.bindArrayBuffer(quadBuffer);
    backend.enableVertexAttrib(0);
    backend.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Instance attributes 1 & 2 are (re)bound once per frame for the selected buffer
    backend.bindVertexArray(null);
    backend.bindArrayBuffer(null);
}
export interface ParticlePassState { width: number; height: number; viewProj: Float32Array; camRight: Float32Array; camUp: Float32Array }
export function renderParticleBatch(framebuffer: WebGLFramebuffer, canvasWidth: number, canvasHeight: number, state?: ParticlePassState): void {
    const gl = (getRenderContext().backend as WebGLBackend).gl;
    // No legacy ingestion; swap feature queue
    particleQueue.swap();
    if (particleQueue.sizeFront() === 0) return;
    if (state) {
        camRight.set(state.camRight);
        camUp.set(state.camUp);
    } else {
        const activeCamera = $.model.activeCamera3D;
        M4.viewRightUpInto(activeCamera.view, camRight, camUp);
    }
    // Batch by texture + ambient config
    const batches = new Map<WebGLTexture, Map<string, DrawParticleOptions[]>>();
    particleQueue.forEachFront((p) => {
        if (!p) return;
        const tex = p.texture ?? defaultTexture;
        let byAmbient = batches.get(tex);
        if (!byAmbient) { byAmbient = new Map(); batches.set(tex, byAmbient); }
        const mode = (p.ambientMode ?? particleAmbientModeDefault) | 0;
        const factor = Math.max(0, Math.min(1, p.ambientFactor ?? particleAmbientFactorDefault));
        const key = mode + ':' + factor.toFixed(2);
        let arr = byAmbient.get(key);
        if (!arr) { arr = []; byAmbient.set(key, arr); }
        arr.push({ ...p, ambientMode: mode as 0 | 1, ambientFactor: factor });
    });
    // FBO binding handled by RenderGraph beginRenderPass
    (getRenderContext().backend as WebGLBackend).setViewport({ x: 0, y: 0, w: canvasWidth, h: canvasHeight });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    // Program is bound by backend pipeline
    gl.uniformMatrix4fv(viewProjLocation, false, state ? state.viewProj : $.model.activeCamera3D.viewProjection);
    gl.uniform3fv(cameraRightLocation, camRight);
    gl.uniform3fv(cameraUpLocation, camUp);
    gl.uniform1i(textureLocation, TEXTURE_UNIT_PARTICLE);
    gl.uniform1i(ambientModeLocation, 0);
    gl.uniform1f(ambientFactorLocation, 1.0);
    const backend = (getRenderContext().backend as WebGLBackend);
    backend.bindVertexArray(vao);
    // Rotate to next instance buffer for this frame and (re)bind instance attrib pointers once
    framePage = (framePage + 1) % 3;
    const instBuf = instanceBuffers[framePage];
    backend.bindArrayBuffer(instBuf);
    backend.enableVertexAttrib(1); backend.enableVertexAttrib(2);
    backend.vertexAttribPointer(1, 4, gl.FLOAT, false, INSTANCE_BYTES, 0);
    backend.vertexAttribDivisor(1, 1);
    backend.vertexAttribPointer(2, 4, gl.FLOAT, false, INSTANCE_BYTES, 4 * BYTES_PER_FLOAT);
    backend.vertexAttribDivisor(2, 1);
    for (const [tex, byAmbient] of batches) {
        for (const [ambKey, arr] of byAmbient) {
            const batchCount = Math.min(arr.length, MAX_PARTICLES);
            // Set ambient uniforms per sub-batch
            const [modeStr, factorStr] = ambKey.split(':');
            gl.uniform1i(ambientModeLocation, parseInt(modeStr, 10) | 0);
            gl.uniform1f(ambientFactorLocation, parseFloat(factorStr));
            for (let i = 0; i < batchCount; i++) {
                const p = arr[i]; if (!p) continue;
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
            const backend2 = (getRenderContext().backend as WebGLBackend);
            backend2.bindArrayBuffer(instBuf);
            backend2.updateVertexBuffer(instBuf, instanceData.subarray(0, batchCount * INSTANCE_FLOATS), 0);
            const v = getRenderContext();
            v.activeTexUnit = TEXTURE_UNIT_PARTICLE;
            v.bind2DTex(tex);
            const passStub: PassEncoder = { fbo: framebuffer, desc: { label: 'particles' } };
            backend2.drawInstanced(passStub, 6, batchCount, 0, 0);
        }
    }
    backend.bindVertexArray(null);
    gl.depthMask(true);
    // Ring cursor keeps its head; no additional action
}
export function setDefaultParticleTexture(tex: WebGLTexture): void { defaultTexture = tex; }
// New submission helper (prefer over touching particlesToDraw)
export function submitParticle(p: DrawParticleOptions): void {
    particleQueue.submit({ ...p });
}
export function getQueuedParticleCount(): number { return particleQueue.sizeBack(); }
export function getParticleQueueDebug(): { front: number; back: number } { return { front: particleQueue.sizeFront(), back: particleQueue.sizeBack() }; }

export function registerParticlesPass_WebGL(registry: RenderPassLibrary): void {
    registry.register({
        id: 'particles',
        label: 'particles',
        name: 'Particles',
        vsCode: particleVS,
        fsCode: particleFS,
        bindingLayout: { uniforms: ['FrameUniforms'] },
        bootstrap: (backend) => {
            init(null);
            setupParticleLocations();
            setupParticleUniforms(backend as WebGLBackend);
        },
        writesDepth: true,
        shouldExecute: () => !!getQueuedParticleCount(),
        exec: (_backend, fbo, s) => {
            const state = s as ParticlePipelineState;
            renderParticleBatch(fbo as WebGLFramebuffer, state.width, state.height, state);
        },
        prepare: (backend, _state) => {
            const gv = getRenderContext();
            const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
            const cam = $.model.activeCamera3D;
            if (!cam) return;

            M4.viewRightUpInto(cam.view, camRight, camUp);
            registry.setState('particles', { width, height, viewProj: cam.viewProjection, camRight, camUp });
        },
    });
}
