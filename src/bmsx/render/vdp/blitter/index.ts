import type { VdpBlitterExecutor } from '../../../machine/devices/vdp/vdp';
import type { GPUBackend } from '../../backend/interfaces';
import { WebGLBackend } from '../../backend/webgl/backend';
import { HeadlessGPUBackend } from '../../headless/backend';
import { HeadlessVdpBlitterExecutor } from './headless';
import { WebGLVdpBlitterExecutor } from './webgl';
import { WebGPUVdpBlitterExecutor } from './webgpu';

type VdpBlitterExecutorFactory = (backend: GPUBackend) => VdpBlitterExecutor | null;

const EXECUTOR_FACTORIES: Record<GPUBackend['type'], VdpBlitterExecutorFactory> = {
	webgl2: (backend) => new WebGLVdpBlitterExecutor(backend as WebGLBackend),
	webgpu: () => new WebGPUVdpBlitterExecutor(),
	headless: (backend) => new HeadlessVdpBlitterExecutor(backend as HeadlessGPUBackend),
};

export function createVdpBlitterExecutor(backend: GPUBackend): VdpBlitterExecutor | null {
	return EXECUTOR_FACTORIES[backend.type](backend);
}
