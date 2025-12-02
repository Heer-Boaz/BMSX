import type { GameViewHost } from '../../platform';
import { WebGLBackend } from './webgl/webgl_backend';
import { WebGPUBackend } from './webgpu/webgpu_backend';
import type { GPUBackend } from './pipeline_interfaces';

const FACTORY_KEY = '__bmsxCreateBackend';
interface BackendFactoryHolder {
	__bmsxCreateBackend?: (host: GameViewHost) => Promise<GPUBackend>;
}
const WEBGPU_RENDERER_SUPPORT = false;

function installFactory(factory: (host: GameViewHost) => Promise<GPUBackend>): void {
	const globalScope = globalThis as BackendFactoryHolder;
	globalScope[FACTORY_KEY] = factory;
}

function hasFactory(): boolean {
	const globalScope = globalThis as BackendFactoryHolder;
	return typeof globalScope[FACTORY_KEY] === 'function';
}

async function createWebGPUBackend(canvas: HTMLCanvasElement): Promise<GPUBackend> {
	if (!WEBGPU_RENDERER_SUPPORT) return null;
	if (!navigator.gpu) return null;
	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) return null;
	const device = await adapter.requestDevice();
	const context = canvas.getContext('webgpu');
	if (!context) return null;
	const format = typeof navigator.gpu.getPreferredCanvasFormat === 'function'
		? navigator.gpu.getPreferredCanvasFormat()
		: 'bgra8unorm';
	try {
		context.configure({ device, format, alphaMode: 'premultiplied' });
	} catch (error) {
		console.error('[BrowserBackendFactory] Failed to configure WebGPU canvas context:', error);
		return null;
	}
	return new WebGPUBackend(device, context);
}

function createWebGLBackend(canvas: HTMLCanvasElement): GPUBackend {
	const gl = canvas.getContext('webgl2', { alpha: true, depth: true, antialias: false, premultipliedAlpha: true });
	if (!gl) {
		throw new Error('[BrowserBackendFactory] Unable to create WebGL2 context.');
	}
	return new WebGLBackend(gl);
}

async function defaultBackendFactory(host: GameViewHost): Promise<GPUBackend> {
	const canvas = host.surface.handle;
	if (!(canvas instanceof HTMLCanvasElement)) {
		throw new Error('[BrowserBackendFactory] GameViewHost surface handle is not an HTMLCanvasElement.');
	}

	const webgpuBackend = await createWebGPUBackend(canvas);
	if (webgpuBackend) return webgpuBackend;

	const webglBackend = createWebGLBackend(canvas);
	if (WEBGPU_RENDERER_SUPPORT) {
		console.info('[BrowserBackendFactory] Falling back to WebGL2 backend.');
	}
	return webglBackend;
}

export function ensureBrowserBackendFactory(): void {
	if (hasFactory()) return;
	installFactory(defaultBackendFactory);
}
