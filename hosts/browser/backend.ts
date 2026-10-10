import type { GPUBackend } from '../../machine/ts/render/backend/backend';
import { WebGLBackend } from '../../machine/ts/render/backend/webgl/backend';
import { WebGPUBackend } from '../../machine/ts/render/backend/webgpu/backend';

export function createWebGLBackend(canvas: HTMLCanvasElement, gxGpuVramBytes: number): WebGLBackend {
	const gl = canvas.getContext('webgl2', { alpha: true, depth: true, antialias: false, premultipliedAlpha: true });
	if (!gl) {
		throw new Error('Unable to create WebGL2 context.');
	}
	return new WebGLBackend(gl, gxGpuVramBytes);
}

export async function createBrowserBackend(canvas: HTMLCanvasElement, gxGpuVramBytes: number): Promise<GPUBackend> {
	const gpu = navigator.gpu;
	if (!gpu) {
		return createWebGLBackend(canvas, gxGpuVramBytes);
	}
	const adapter = await gpu.requestAdapter();
	if (!adapter) {
		return createWebGLBackend(canvas, gxGpuVramBytes);
	}
	return createWebGPUBackend(canvas, adapter, gxGpuVramBytes);
}

/** Construct the selected WebGPU backend; browser capability selection stays above this boundary. */
export async function createWebGPUBackend(
	canvas: HTMLCanvasElement,
	adapter: GPUAdapter,
	gxGpuVramBytes: number,
): Promise<WebGPUBackend> {
	const device = await adapter.requestDevice();
	const context = canvas.getContext('webgpu');
	if (!context) {
		throw new Error('Unable to create WebGPU context.');
	}
	const format = navigator.gpu.getPreferredCanvasFormat();
	context.configure({
		device,
		format,
		alphaMode: 'opaque',
	});
	return new WebGPUBackend(device, context, format, gxGpuVramBytes);
}
