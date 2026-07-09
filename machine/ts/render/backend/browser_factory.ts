import type { GameViewHost } from '../../platform';
import { WebGPUBackend } from './webgpu/backend';
import { WebGLBackend } from './webgl/backend';
import type { GPUBackend } from './backend';

const FACTORY_KEY = '__bmsxCreateBackend';
interface BackendFactoryHolder {
	__bmsxCreateBackend?: (host: GameViewHost) => Promise<GPUBackend>;
}

function installFactory(factory: (host: GameViewHost) => Promise<GPUBackend>): void {
	const globalScope = globalThis as BackendFactoryHolder;
	globalScope[FACTORY_KEY] = factory;
}

function hasFactory(): boolean {
	const globalScope = globalThis as BackendFactoryHolder;
	return globalScope[FACTORY_KEY] !== undefined;
}

function createWebGLBackend(canvas: HTMLCanvasElement): GPUBackend {
	const gl = canvas.getContext('webgl2', { alpha: true, depth: true, antialias: false, premultipliedAlpha: true });
	if (!gl) {
		throw new Error('[BrowserBackendFactory] Unable to create WebGL2 context.');
	}
	return new WebGLBackend(gl);
}

async function createWebGPUBackend(canvas: HTMLCanvasElement): Promise<GPUBackend> {
	const gpu = navigator.gpu;
	if (gpu === undefined) {
		return createWebGLBackend(canvas);
	}
	const adapter = await gpu.requestAdapter();
	if (adapter === null) {
		return createWebGLBackend(canvas);
	}
	const device = await adapter.requestDevice();
	const context = canvas.getContext('webgpu') as GPUCanvasContext;
	if (!context) {
		throw new Error('[BrowserBackendFactory] Unable to create WebGPU context.');
	}
	const format = gpu.getPreferredCanvasFormat();
	context.configure({
		device,
		format,
		alphaMode: 'opaque',
	});
	return new WebGPUBackend(device, context, format);
}

async function defaultBackendFactory(host: GameViewHost): Promise<GPUBackend> {
	const canvas = host.surface.handle;
	if (!(canvas instanceof HTMLCanvasElement)) {
		throw new Error('[BrowserBackendFactory] GameViewHost surface handle is not an HTMLCanvasElement.');
	}
	return createWebGPUBackend(canvas);
}

export function ensureBrowserBackendFactory(): void {
	if (hasFactory()) return;
	installFactory(defaultBackendFactory);
}
