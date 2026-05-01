import type { VDP, VdpBlitterCommand } from '../../../machine/devices/vdp/vdp';
import type { GPUBackend } from '../../backend/interfaces';
import { vdpTextureBackend } from '../texture_transfer';
import { HeadlessVdpBlitterExecutor } from './headless';

type VdpBlitterExecutorLike = {
	execute(vdp: VDP, commands: readonly VdpBlitterCommand[]): void;
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
	const queue = vdp.takeReadyExecutionQueue();
	if (queue === null) {
		return;
	}
	getVdpBlitterExecutor(vdpTextureBackend()).execute(vdp, queue);
	vdp.completeReadyExecution(queue);
}
