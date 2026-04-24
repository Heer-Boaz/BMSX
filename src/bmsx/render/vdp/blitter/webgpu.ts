import type { VDP, VdpBlitterCommand } from '../../../machine/devices/vdp/vdp';

export class WebGPUVdpBlitterExecutor {
	public execute(_vdp: VDP, _commands: readonly VdpBlitterCommand[]): void {
		throw new Error('[WebGPUVdpBlitter] Not implemented.');
	}
}
