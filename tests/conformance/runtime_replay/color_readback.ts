import type { GPUBackend, TextureFormat } from '../../../machine/ts/render/backend/backend';
import type { WebGLBackend } from '../../../machine/ts/render/backend/webgl/backend';
import type { WebGPUBackend } from '../../../machine/ts/render/backend/webgpu/backend';
import { RGBA8_LINEAR_TEXTURE_PARAMS } from '../../../machine/ts/render/backend/texture_params';
import { check } from './studio_fixture';

/** Independent asymmetric pixel oracle, including WebGPU's padded staging rows. */
export async function verifyColorReadback(backend: GPUBackend): Promise<void> {
	const width = 65, height = 3, expected = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const at = (y * width + x) * 4;
		expected[at] = x + y * 65; expected[at + 1] = y * 63; expected[at + 2] = 255 - x; expected[at + 3] = 255;
	}
	const formats: (TextureFormat | undefined)[] = backend.type === 'webgpu' ? ['rgba8unorm', 'bgra8unorm'] : [undefined];
	for (const format of formats) {
		const texture = backend.createColorTexture({ width, height, format });
		if (backend.type === 'webgl2') {
			const gl = (backend as WebGLBackend).gl;
			const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture as WebGLTexture, 0);
			gl.enable(gl.SCISSOR_TEST);
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				const at = (y * width + x) * 4;
				gl.scissor(x, height - y - 1, 1, 1);
				gl.clearColor(expected[at] / 255, expected[at + 1] / 255, expected[at + 2] / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
			}
			gl.disable(gl.SCISSOR_TEST);
			const pixels = await backend.readColorTexture(texture, width, height);
			check(pixels.every((byte, at) => byte === expected[at]), 'WebGL readback must preserve channels and normalize rendered row order');
			check(gl.getParameter(gl.FRAMEBUFFER_BINDING) === fbo && gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === fbo, 'readback preserves GL target bindings');
			gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fbo);
		} else {
			if (backend.type === 'webgpu') {
				const upload = expected.slice();
				if (format === 'bgra8unorm') for (let i = 0; i < upload.length; i += 4) { upload[i] = expected[i + 2]; upload[i + 2] = expected[i]; }
				(backend as WebGPUBackend).device.queue.writeTexture({ texture: texture as GPUTexture }, upload, { bytesPerRow: width * 4 }, { width, height });
			} else backend.updateTexture(texture, expected, width, height, RGBA8_LINEAR_TEXTURE_PARAMS);
			const pixels = await backend.readColorTexture(texture, width, height);
			check(pixels.length === expected.length && pixels.every((byte, at) => byte === expected[at]), `${backend.type}/${format}: tightly packed top-down RGBA8 readback`);
			pixels.fill(0);
			check((await backend.readColorTexture(texture, width, height)).every((byte, at) => byte === expected[at]), 'capture owns pixels, never a texture alias');
		}
		backend.destroyTexture(texture);
	}
}
