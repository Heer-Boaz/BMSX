import type { VDP, VdpBlitterCommand } from '../../../machine/devices/vdp/vdp';
import type { GPUBackend } from '../../backend/interfaces';
import { WebGLBackend } from '../../backend/webgl/backend';
import { vdpTextureBackend } from '../texture_transfer';
import { HeadlessVdpBlitterExecutor } from './headless';
import { WebGLVdpBlitterExecutor } from './webgl';
import { WebGPUVdpBlitterExecutor } from './webgpu';

type VdpBlitterExecutorLike = {
	execute(vdp: VDP, commands: readonly VdpBlitterCommand[], timeSeconds: number, deltaSeconds: number): void;
};

let webglExecutorBackend: WebGLBackend | null = null;
let webglExecutor: WebGLVdpBlitterExecutor | null = null;
let headlessExecutor: HeadlessVdpBlitterExecutor | null = null;
let webgpuExecutor: WebGPUVdpBlitterExecutor | null = null;

function getVdpBlitterExecutor(backend: GPUBackend): VdpBlitterExecutorLike {
	switch (backend.type) {
		case 'webgl2':
			if (webglExecutor === null || webglExecutorBackend !== backend) {
				webglExecutorBackend = backend as WebGLBackend;
				webglExecutor = new WebGLVdpBlitterExecutor(webglExecutorBackend);
			}
			return webglExecutor;
		case 'headless':
			if (headlessExecutor === null) {
				headlessExecutor = new HeadlessVdpBlitterExecutor();
			}
			return headlessExecutor;
		case 'webgpu':
			if (webgpuExecutor === null) {
				webgpuExecutor = new WebGPUVdpBlitterExecutor();
			}
			return webgpuExecutor;
	}
}

export function drainReadyVdpExecution(vdp: VDP, timeSeconds: number, deltaSeconds: number): void {
	const queue = vdp.takeReadyExecutionQueue();
	if (queue === null) {
		return;
	}
	getVdpBlitterExecutor(vdpTextureBackend()).execute(vdp, queue, timeSeconds, deltaSeconds);
	vdp.completeReadyExecution(queue);
}
