import type { GPUBackend } from './pipeline_interfaces';
import { WebGLBackend } from './webgl/webgl_backend';

// Minimal per-frame uniform buffer (foundation for future shader blocks)
// Binding indices: keep distinct from lighting UBOs (0,1)
// Use a binding index that doesn't collide with existing UBOs
// DirLightBlock = 0, PointLightBlock = 1 in mesh pipeline. Keep frame at 2.
export const FRAME_UNIFORM_BINDING = 2;

let ubo: WebGLBuffer | null = null;
// Layout (std140-friendly):
// [0..3]   offscreenSize: (offW, offH), logicalSize: (baseW, baseH)
// [4..7]   timing: (time, delta, 0, 0)
// [8..23]  view matrix (mat4)
// [24..39] proj matrix (mat4)
// [40..43] cameraPos.xyz, pad
// [44..47] ambient: (r, g, b, intensity)
const buf = new Float32Array(48);

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
    ambient?: { color: [number, number, number]; intensity: number };
}

function frameBindingIndexFor(backend: GPUBackend): number {
    // WebGL path uses binding 2 to avoid collisions with mesh light UBOs (0,1)
    // WebGPU bind group conventionally uses binding 0 for the frame uniform buffer
    const isWebGL = typeof (backend as WebGLBackend).gl !== 'undefined';
    return isWebGL ? FRAME_UNIFORM_BINDING : 0;
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
        const c = u.cameraPos;
        if (ArrayBuffer.isView(c)) {
            buf[40] = (c as Float32Array)[0] ?? 0;
            buf[41] = (c as Float32Array)[1] ?? 0;
            buf[42] = (c as Float32Array)[2] ?? 0;
        } else {
            const v = c as { x: number; y: number; z: number };
            buf[40] = v.x ?? 0;
            buf[41] = v.y ?? 0;
            buf[42] = v.z ?? 0;
        }
    } else {
        buf[40] = buf[41] = buf[42] = 0;
    }
    buf[43] = 0;
    // Ambient
    const amb = u.ambient;
    if (amb) { buf[44] = amb.color[0]; buf[45] = amb.color[1]; buf[46] = amb.color[2]; buf[47] = amb.intensity; }
    else { buf[44] = buf[45] = buf[46] = buf[47] = 0; }
    backend.updateUniformBuffer(ubo as unknown as WebGLBuffer, buf);
    backend.bindUniformBufferBase(frameBindingIndexFor(backend), ubo as unknown as WebGLBuffer);
}
