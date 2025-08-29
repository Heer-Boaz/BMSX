import type { GPUBackend } from './pipeline_interfaces';

// Minimal per-frame uniform buffer (foundation for future shader blocks)
// Binding indices: keep distinct from lighting UBOs (0,1)
export const FRAME_UNIFORM_BINDING = 2;

let ubo: WebGLBuffer | null = null;
const buf = new Float32Array(16); // std140-friendly padding (64 bytes)

export function initFrameUniforms(backend: GPUBackend): void {
    if (ubo || !backend.createUniformBuffer) return;
    // Allocate a small UBO with fixed size
    ubo = backend.createUniformBuffer!(buf.byteLength, 'dynamic') as unknown as WebGLBuffer;
}

export interface FrameUniformsUpdate {
    offscreen: { x: number; y: number };
    logical: { x: number; y: number };
    time?: number;
    delta?: number;
}

export function updateAndBindFrameUniforms(backend: GPUBackend, u: FrameUniformsUpdate): void {
    if (!backend.updateUniformBuffer || !backend.bindUniformBufferBase) return;
    if (!ubo) initFrameUniforms(backend);
    if (!ubo) return;
    // Layout: [offW, offH, baseW, baseH, time, delta, 0, 0, ...]
    buf[0] = u.offscreen.x;
    buf[1] = u.offscreen.y;
    buf[2] = u.logical.x;
    buf[3] = u.logical.y;
    buf[4] = u.time ?? 0;
    buf[5] = u.delta ?? 0;
    for (let i = 6; i < buf.length; i++) buf[i] = 0;
    backend.updateUniformBuffer(ubo as unknown as WebGLBuffer, buf);
    backend.bindUniformBufferBase(FRAME_UNIFORM_BINDING, ubo as unknown as WebGLBuffer);
}

