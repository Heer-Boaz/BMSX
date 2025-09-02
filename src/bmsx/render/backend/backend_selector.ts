import type { GPUBackend } from './pipeline_interfaces';
import { WebGLBackend } from './webgl_backend';

const WEBGPU_RENDERER_SUPPORT = false;

export interface BackendCreateResult {
	backend: GPUBackend;
	nativeCtx: unknown; // WebGL2RenderingContext | GPUCanvasContext
}

/**
 * Create a GPU backend for the given canvas, preferring WebGPU if available,
 * otherwise falling back to WebGL2. The GameView stays backend-agnostic and
 * only receives the backend interface and the native context for helpers.
 */
export async function createBackendForCanvasAsync(canvas: HTMLCanvasElement): Promise<BackendCreateResult> {
	// Try WebGPU first
	if (WEBGPU_RENDERER_SUPPORT) {
		try {
			const nav: any = navigator;
			if (nav?.gpu && typeof canvas.getContext === 'function') {
				const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
				if (context) {
					const adapter: GPUAdapter | null = await nav.gpu.requestAdapter();
					if (adapter) {
						const device: GPUDevice = await adapter.requestDevice();
						// Configure the canvas context for presentation
						const preferredFormat: GPUTextureFormat = (nav.gpu.getPreferredCanvasFormat && nav.gpu.getPreferredCanvasFormat()) || 'bgra8unorm';
						try {
							context.configure({ device, format: preferredFormat, alphaMode: 'premultiplied' });
						} catch (e) {
							console.error('Failed to configure WebGPU canvas context:', e);
							throw e;
						}
						const { WebGPUBackend } = await import('./webgpu_backend');
						const backend = new WebGPUBackend(device, context);
						return { backend, nativeCtx: context };
					}
				}
			}
		} catch { /* fall back */ }
	}

	// Fallback to WebGL2
	const gl = canvas.getContext('webgl2', { alpha: true, antialias: false }) as WebGL2RenderingContext | null;
	if (!gl) throw new Error('Failed to acquire WebGL2 context');
	const backend = new WebGLBackend(gl);
	console.info(WEBGPU_RENDERER_SUPPORT ? 'Browser doesn\'t support WebGPU, fallback to WebGL2-backend' : 'Forced using WebGL2-backend as the game engine doesn\'t support WebGPU yet');
	return { backend, nativeCtx: gl };
}
