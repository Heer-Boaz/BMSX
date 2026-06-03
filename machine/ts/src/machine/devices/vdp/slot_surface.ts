import type { DeviceStatusLatch } from '../device_status';
import {
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
	VDP_RD_SURFACE_SYSTEM,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
} from './contracts';
import type { VdpSurfaceUploadSlot } from './device_output';
import type { VdpVramUnit } from './vram';

export class VdpSlotSurfacePort {
	public constructor(
		private readonly fault: DeviceStatusLatch,
		private readonly vram: VdpVramUnit,
	) {}

	private readonly surfaceScratch = new Uint32Array(1);

	public resolveSurfaceIdForSlot(slot: number, out: Uint32Array, faultCode: number): boolean {
		switch (slot) {
			case VDP_SLOT_SYSTEM:
				out[0] = VDP_RD_SURFACE_SYSTEM;
				return true;
			case VDP_SLOT_PRIMARY:
				out[0] = VDP_RD_SURFACE_PRIMARY;
				return true;
			case VDP_SLOT_SECONDARY:
				out[0] = VDP_RD_SURFACE_SECONDARY;
				return true;
			default:
				this.fault.raise(faultCode, slot);
				return false;
		}
	}

	public resolveSlotSurface(slot: number, faultCode: number): VdpSurfaceUploadSlot | null {
		if (!this.resolveSurfaceIdForSlot(slot, this.surfaceScratch, faultCode)) {
			return null;
		}
		const surfaceId = this.surfaceScratch[0]!;
		const surface = this.vram.findSurface(surfaceId);
		if (surface === null) {
			this.fault.raise(faultCode, surfaceId);
			return null;
		}
		return surface;
	}
}
