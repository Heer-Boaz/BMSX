import type { VdpHostOutput } from '../../machine/devices/vdp/vdp';
import { resolveVdpHostSurfaceSlot } from './surfaces';

export type VdpSurfacePixels = {
	pixels: Uint8Array;
	width: number;
	height: number;
	stride: number;
};

export function resolveVdpSurfacePixels(output: VdpHostOutput, surfaceId: number): VdpSurfacePixels {
	const slot = resolveVdpHostSurfaceSlot(output, surfaceId);
	return {
		pixels: slot.cpuReadback,
		width: slot.surfaceWidth,
		height: slot.surfaceHeight,
		stride: slot.surfaceWidth * 4,
	};
}
