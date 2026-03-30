import type { VdpBlitterExecutor } from '../../emulator/vdp';
import type { GPUBackend } from '../backend/pipeline_interfaces';
import { WebGLBackend } from '../backend/webgl/webgl_backend';
import { HeadlessGPUBackend } from '../headless/headless_backend';
import { HeadlessVdpBlitterExecutor } from './vdp_blitter_headless';
import { WebGLVdpBlitterExecutor } from './vdp_blitter_webgl';
import { WebGPUVdpBlitterExecutor } from './vdp_blitter_webgpu';

type VdpBlitterExecutorFactory = (backend: GPUBackend) => VdpBlitterExecutor | null;

const EXECUTOR_FACTORIES: Record<GPUBackend['type'], VdpBlitterExecutorFactory> = {
	webgl2: (backend) => new WebGLVdpBlitterExecutor(backend as WebGLBackend),
	webgpu: () => new WebGPUVdpBlitterExecutor(),
	headless: (backend) => new HeadlessVdpBlitterExecutor(backend as HeadlessGPUBackend),
};

export function createVdpBlitterExecutor(backend: GPUBackend): VdpBlitterExecutor | null {
	return EXECUTOR_FACTORIES[backend.type](backend);
}
