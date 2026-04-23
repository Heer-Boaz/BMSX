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
const IMPLICIT_CLEAR_QUEUE: readonly VdpBlitterCommand[] = [{ opcode: 'clear', seq: 0, renderCost: 0, color: { r: 0, g: 0, b: 0, a: 255 } }];

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
	const queue = vdp.readyExecutionQueue;
	if (queue === null) {
		return;
	}
	if (queue.length === 0) {
		vdp.completeReadyExecution();
		return;
	}
	const context = vdp.prepareBlitterExecutionContext();
	if (queue[0].opcode !== 'clear') {
		executeVdpBlitterQueue(context, IMPLICIT_CLEAR_QUEUE);
	}
	executeVdpBlitterQueue(context, queue);
	vdp.completeReadyExecution();
}
