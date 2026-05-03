import type { VDP, VdpBlitterCommand, VdpHostOutput } from '../../../machine/devices/vdp/vdp';
import type { GPUBackend } from '../../backend/interfaces';
import { vdpTextureBackend } from '../texture_transfer';
import { syncVdpSlotTextures } from '../slot_textures';
import { HeadlessVdpBlitterExecutor } from './headless';

type VdpBlitterExecutorLike = {
	execute(output: VdpHostOutput, commands: VdpBlitterCommand): void;
};

let headlessExecutor: HeadlessVdpBlitterExecutor | null = null;
const executorFactories = new Map<GPUBackend['type'], (backend: GPUBackend) => VdpBlitterExecutorLike>();

export function registerVdpBlitterExecutorFactory(
	backendType: GPUBackend['type'],
	factory: (backend: GPUBackend) => VdpBlitterExecutorLike,
): void {
	executorFactories.set(backendType, factory);
}

function getVdpBlitterExecutor(backend: GPUBackend): VdpBlitterExecutorLike {
	switch (backend.type) {
		case 'headless':
			if (headlessExecutor === null) {
				headlessExecutor = new HeadlessVdpBlitterExecutor();
			}
			return headlessExecutor;
	}
	const factory = executorFactories.get(backend.type);
	if (!factory) {
		throw new Error(`[VDPBlitter] No executor registered for backend '${backend.type}'.`);
	}
	return factory(backend);
}


export function drainReadyVdpExecution(vdp: VDP): void {
	const output = vdp.readHostOutput();
	const queue = output.executionQueue;
	if (queue === null) {
		return;
	}
	const backend = vdpTextureBackend();
	if (backend.type !== 'headless') {
		syncVdpSlotTextures(vdp);
	}
	if (queue.length !== 0) {
		getVdpBlitterExecutor(backend).execute(output, queue);
	}
	vdp.completeHostExecution(output);
}
