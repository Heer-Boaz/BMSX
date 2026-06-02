import type { BufferHandle, GPUBackend } from './backend';

// Minimal per-frame uniform buffer (foundation for future shader blocks)
// Binding index stays outside pass-local shader bindings.
export const FRAME_UNIFORM_BINDING = 2;

let ubo: BufferHandle = null;
// Layout (std140-friendly):
// [0..3]   offscreenSize: (offW, offH), logicalSize: (baseW, baseH)
// [4..7]   timing: (time, delta, 0, 0)
// [8..23]  view matrix (mat4)
// [24..39] proj matrix (mat4)
// [40..43] cameraPos.xyz, pad
// [44..47] ambient: (r, g, b, intensity)
const buf = new Float32Array(48);

export function initFrameUniforms(backend: GPUBackend): void {
	if (ubo) return;
	// Allocate a small UBO with fixed size
	ubo = backend.createUniformBuffer(buf.byteLength, 'dynamic');
}

export function updateAndBindFrameUniforms(
	backend: GPUBackend,
	offscreenX: number,
	offscreenY: number,
	logicalX: number,
	logicalY: number,
	time = 0,
	delta = 0,
	view: Float32Array | null = null,
	proj: Float32Array | null = null,
	cameraPos: Float32Array | null = null,
	ambientColor: readonly [number, number, number] | null = null,
	ambientIntensity = 0,
): void {
	if (!ubo) initFrameUniforms(backend);
	// Layout: [offW, offH, baseW, baseH, time, delta, 0, 0, ...]
	buf[0] = offscreenX;
	buf[1] = offscreenY;
	buf[2] = logicalX;
	buf[3] = logicalY;
	buf[4] = time;
	buf[5] = delta;
	buf[6] = 0;
	buf[7] = 0;
	if (view !== null) buf.set(view, 8);
	else for (let i = 8; i < 24; i++) buf[i] = (i % 5 === 8) ? 1 : 0; // identity
	if (proj !== null) buf.set(proj, 24);
	else for (let i = 24; i < 40; i++) buf[i] = (i % 5 === 4) ? 1 : 0; // identity
	if (cameraPos !== null) {
		buf[40] = cameraPos[0];
		buf[41] = cameraPos[1];
		buf[42] = cameraPos[2];
	} else {
		buf[40] = buf[41] = buf[42] = 0;
	}
	buf[43] = 0;
	if (ambientColor !== null) { buf[44] = ambientColor[0]; buf[45] = ambientColor[1]; buf[46] = ambientColor[2]; buf[47] = ambientIntensity; }
	else { buf[44] = buf[45] = buf[46] = buf[47] = 0; }
	backend.updateUniformBuffer(ubo, buf);
	backend.bindUniformBufferBase(backend.type === 'webgl2' ? FRAME_UNIFORM_BINDING : 0, ubo);
}
