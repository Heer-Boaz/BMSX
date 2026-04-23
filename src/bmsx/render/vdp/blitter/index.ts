import { $ } from '../../../core/engine';
import type { VDP, VdpBlitterCommand, VdpBlitterContext } from '../../../machine/devices/vdp/vdp';
import type { GPUBackend } from '../../backend/interfaces';
import { WebGLBackend } from '../../backend/webgl/backend';
import { HeadlessGPUBackend } from '../../headless/backend';
import { HeadlessVdpBlitterExecutor } from './headless';
import { WebGLVdpBlitterExecutor } from './webgl';
import { WebGPUVdpBlitterExecutor } from './webgpu';

type VdpBlitterExecutorLike = {
	execute(context: VdpBlitterContext, commands: readonly VdpBlitterCommand[]): void;
};

let webglExecutorBackend: WebGLBackend | null = null;
let webglExecutor: WebGLVdpBlitterExecutor | null = null;
let headlessExecutorBackend: HeadlessGPUBackend | null = null;
let headlessExecutor: HeadlessVdpBlitterExecutor | null = null;
let webgpuExecutor: WebGPUVdpBlitterExecutor | null = null;

function getVdpBlitterExecutor(backend: GPUBackend): VdpBlitterExecutorLike | null {
	switch (backend.type) {
		case 'webgl2':
			if (webglExecutor === null || webglExecutorBackend !== backend) {
				webglExecutorBackend = backend as WebGLBackend;
				webglExecutor = new WebGLVdpBlitterExecutor(webglExecutorBackend);
			}
			return webglExecutor;
		case 'headless':
			if (headlessExecutor === null || headlessExecutorBackend !== backend) {
				headlessExecutorBackend = backend as HeadlessGPUBackend;
				headlessExecutor = new HeadlessVdpBlitterExecutor(headlessExecutorBackend);
			}
			return headlessExecutor;
		case 'webgpu':
			if (webgpuExecutor === null) {
				webgpuExecutor = new WebGPUVdpBlitterExecutor();
			}
			return webgpuExecutor;
		default:
			return null;
	}
}

export function executeVdpBlitterQueue(context: VdpBlitterContext, commands: readonly VdpBlitterCommand[]): void {
	const executor = getVdpBlitterExecutor($.view.backend);
	if (executor === null) {
		throw new Error(`[VDP] No blitter executor for backend '${$.view.backend.type}'.`);
	}
	executor.execute(context, commands);
}

export function drainReadyVdpExecution(vdp: VDP): void {
	const queue = vdp.takeReadyExecutionQueue();
	if (queue === null) {
		return;
	}
	const context = vdp.prepareBlitterExecutionContext();
	executeVdpBlitterQueue(context, queue);
	vdp.completeReadyExecution();
}
