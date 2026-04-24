import type { VDP, VdpBlitterCommand } from '../../../machine/devices/vdp/vdp';

export class WebGPUVdpBlitterExecutor {
	public execute(_vdp: VDP, _commands: readonly VdpBlitterCommand[], _timeSeconds: number, _deltaSeconds: number): void {
		throw new Error('[WebGPUVdpBlitter] Not implemented.');
	}
}
