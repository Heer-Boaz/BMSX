import type { VdpBlitterCommand, VdpBlitterContext } from '../../../machine/devices/vdp/vdp';

export class WebGPUVdpBlitterExecutor {
	public execute(_context: VdpBlitterContext, _commands: readonly VdpBlitterCommand[]): void {
		throw new Error('[WebGPUVdpBlitter] Not implemented.');
	}
}
