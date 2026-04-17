import type { VdpBlitterCommand, VdpBlitterExecutor, VdpBlitterHost } from '../../machine/devices/vdp/vdp';

export class WebGPUVdpBlitterExecutor implements VdpBlitterExecutor {
	public readonly backendType = 'webgpu' as const;

	public execute(_host: VdpBlitterHost, _commands: readonly VdpBlitterCommand[]): void {
		throw new Error('[WebGPUVdpBlitter] Not implemented.');
	}
}
