import type { GameViewHost } from '../../platform';
import { WebGLBackend } from './webgl/backend';
import { WebGPUBackend } from './webgpu/backend';
import type { GPUBackend } from './backend';

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
	return globalScope[FACTORY_KEY] !== undefined;
}

async function createWebGPUBackend(canvas: HTMLCanvasElement): Promise<GPUBackend> {
	if (!WEBGPU_RENDERER_SUPPORT) return null;
	if (!navigator.gpu) return null;
	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) return null;
	const device = await adapter.requestDevice();
	const context = canvas.getContext('webgpu');
	if (!context) return null;
	const format = navigator.gpu.getPreferredCanvasFormat();
	context.configure({ device, format, alphaMode: 'premultiplied' });
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
