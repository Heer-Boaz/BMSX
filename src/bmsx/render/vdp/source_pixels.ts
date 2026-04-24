import type { VDP, VdpBlitterSource, VdpSurfaceUploadSlot } from '../../machine/devices/vdp/vdp';

export type VdpSurfacePixels = {
	pixels: Uint8Array;
	width: number;
	height: number;
	stride: number;
};

function resolveVdpSurfaceUploadSlot(vdp: VDP, surfaceId: number): VdpSurfaceUploadSlot {
	const slots = vdp.surfaceUploadSlots;
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index]!;
		if (slot.surfaceId === surfaceId) {
			return slot;
		}
	}
	throw new Error(`[VDPSourcePixels] Surface ${surfaceId} is not registered for CPU readback.`);
}

export function resolveVdpSurfacePixels(vdp: VDP, surfaceId: number): VdpSurfacePixels {
	const slot = resolveVdpSurfaceUploadSlot(vdp, surfaceId);
	return {
		pixels: slot.cpuReadback,
		width: slot.surfaceWidth,
		height: slot.surfaceHeight,
		stride: slot.surfaceWidth * 4,
	};
}

export function resolveVdpSourcePixels(vdp: VDP, source: VdpBlitterSource): VdpSurfacePixels {
	return resolveVdpSurfacePixels(vdp, source.surfaceId);
}
