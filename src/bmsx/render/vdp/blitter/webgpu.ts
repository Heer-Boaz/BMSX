import type { VdpBlitterCommand, VdpBlitterExecutor, VdpBlitterContext } from '../../../machine/devices/vdp/vdp';

export class WebGPUVdpBlitterExecutor implements VdpBlitterExecutor {
	public execute(_context: VdpBlitterContext, _commands: readonly VdpBlitterCommand[]): void {
		throw new Error('[WebGPUVdpBlitter] Not implemented.');
	}
}
