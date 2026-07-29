import { WebGPUBackend } from './webgpu/backend';
import { WebGLBackend } from './webgl/backend';
import type { GPUBackend } from './backend';

function createWebGLBackend(canvas: HTMLCanvasElement, gxGpuVramBytes: number): GPUBackend {
	const gl = canvas.getContext('webgl2', { alpha: true, depth: true, antialias: false, premultipliedAlpha: true });
	if (!gl) {
		throw new Error('[BrowserBackendFactory] Unable to create WebGL2 context.');
	}
	return new WebGLBackend(gl, gxGpuVramBytes);
}

async function createWebGPUBackend(canvas: HTMLCanvasElement, gxGpuVramBytes: number): Promise<GPUBackend> {
	const gpu = navigator.gpu;
	if (!gpu) {
		return createWebGLBackend(canvas, gxGpuVramBytes);
	}
	const adapter = await gpu.requestAdapter();
	if (!adapter) {
		return createWebGLBackend(canvas, gxGpuVramBytes);
	}
	const device = await adapter.requestDevice();
	const context = canvas.getContext('webgpu');
	if (!context) {
		throw new Error('[BrowserBackendFactory] Unable to create WebGPU context.');
	}
	const format = gpu.getPreferredCanvasFormat();
	context.configure({
		device,
		format,
		alphaMode: 'opaque',
	});
	return new WebGPUBackend(device, context, format, gxGpuVramBytes);
}

export async function createBrowserBackend(canvas: HTMLCanvasElement, gxGpuVramBytes: number): Promise<GPUBackend> {
	return createWebGPUBackend(canvas, gxGpuVramBytes);
}
