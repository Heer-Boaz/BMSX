import type { DeviceStatusLatch } from '../device_status';
import {
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
	VDP_RD_SURFACE_SYSTEM,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
} from './contracts';
import type { VdpBlitterSource } from './blitter';
import type { VdpSurfaceUploadSlot } from './device_output';
import type { VdpVramUnit } from './vram';

export class VdpBlitterSourcePort {
	public constructor(
		private readonly fault: DeviceStatusLatch,
		private readonly vram: VdpVramUnit,
	) {}

	private readonly surfaceScratch = new Uint32Array(1);

	public resolveSurfaceIdForSlot(slot: number, out: Uint32Array, faultCode: number): boolean {
		if (slot === VDP_SLOT_SYSTEM) {
			out[0] = VDP_RD_SURFACE_SYSTEM;
			return true;
		}
		if (slot === VDP_SLOT_PRIMARY) {
			out[0] = VDP_RD_SURFACE_PRIMARY;
			return true;
		}
		if (slot === VDP_SLOT_SECONDARY) {
			out[0] = VDP_RD_SURFACE_SECONDARY;
			return true;
		}
		this.fault.raise(faultCode, slot);
		return false;
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

	public resolveWordsInto(slot: number, u: number, v: number, w: number, h: number, target: VdpBlitterSource, faultCode: number): boolean {
		if (!this.resolveSurfaceIdForSlot(slot, this.surfaceScratch, faultCode)) {
			return false;
		}
		target.surfaceId = this.surfaceScratch[0]!;
		target.srcX = u;
		target.srcY = v;
		target.width = w;
		target.height = h;
		return true;
	}

	public validateSurface(source: VdpBlitterSource, faultCode: number, zeroSizeFaultCode: number): boolean {
		if (source.width === 0 || source.height === 0) {
			this.fault.raise(zeroSizeFaultCode, (source.width | (source.height << 16)) >>> 0);
			return false;
		}
		const surface = this.vram.findSurface(source.surfaceId);
		if (surface === null) {
			this.fault.raise(faultCode, source.surfaceId);
			return false;
		}
		if (source.srcX + source.width > surface.surfaceWidth || source.srcY + source.height > surface.surfaceHeight) {
			this.fault.raise(faultCode, (source.srcX | (source.srcY << 16)) >>> 0);
			return false;
		}
		return true;
	}
}
