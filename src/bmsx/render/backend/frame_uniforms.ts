import type { GPUBackend } from './pipeline_interfaces';

// Minimal per-frame uniform buffer (foundation for future shader blocks)
// Binding indices: keep distinct from lighting UBOs (0,1)
export const FRAME_UNIFORM_BINDING = 2;

let ubo: WebGLBuffer | null = null;
// Layout (std140-friendly):
// [0..3]   offscreenSize: (offW, offH), logicalSize: (baseW, baseH)
// [4..7]   timing: (time, delta, 0, 0)
// [8..23]  view matrix (mat4)
// [24..39] proj matrix (mat4)
// [40..43] cameraPos.xyz, pad
const buf = new Float32Array(44);

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
    view?: Float32Array; // length 16
    proj?: Float32Array; // length 16
    cameraPos?: { x: number; y: number; z: number } | Float32Array; // xyz
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
    buf[6] = 0;
    buf[7] = 0;
    if (u.view && u.view.length >= 16) buf.set(u.view.subarray(0, 16), 8);
    else for (let i = 8; i < 24; i++) buf[i] = (i % 5 === 8) ? 1 : 0; // identity
    if (u.proj && u.proj.length >= 16) buf.set(u.proj.subarray(0, 16), 24);
    else for (let i = 24; i < 40; i++) buf[i] = (i % 5 === 4) ? 1 : 0; // identity
    if (u.cameraPos) {
        const c = (u.cameraPos as any);
        buf[40] = c.x ?? c[0] ?? 0;
        buf[41] = c.y ?? c[1] ?? 0;
        buf[42] = c.z ?? c[2] ?? 0;
    } else {
        buf[40] = buf[41] = buf[42] = 0;
    }
    buf[43] = 0;
    backend.updateUniformBuffer(ubo as unknown as WebGLBuffer, buf);
    backend.bindUniformBufferBase(FRAME_UNIFORM_BINDING, ubo as unknown as WebGLBuffer);
}
