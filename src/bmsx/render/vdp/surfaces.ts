import type { VdpSurfaceUpload } from '../../machine/devices/vdp/device_output';
import {
	VDP_PRIMARY_SLOT_TEXTURE_KEY,
	VDP_SECONDARY_SLOT_TEXTURE_KEY,
	SYSTEM_SLOT_TEXTURE_KEY,
	FRAMEBUFFER_RENDER_TEXTURE_KEY,
} from '../../rompack/format';
import {
	VDP_RD_SURFACE_SYSTEM,
	VDP_RD_SURFACE_FRAMEBUFFER,
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
} from '../../machine/devices/vdp/contracts';

export type VdpRenderSurface = {
	textureKey: string;
	width: number;
	height: number;
};

export function resolveVdpRenderSurfaceForUpload(surface: VdpSurfaceUpload): VdpRenderSurface {
	return {
		textureKey: resolveVdpSurfaceTextureKey(surface.surfaceId),
		width: surface.surfaceWidth,
		height: surface.surfaceHeight,
	};
}

export function isVdpFrameBufferSurface(surfaceId: number): boolean {
	return surfaceId === VDP_RD_SURFACE_FRAMEBUFFER;
}

function resolveVdpSurfaceTextureKey(surfaceId: number): string {
	if (surfaceId === VDP_RD_SURFACE_SYSTEM) {
		return SYSTEM_SLOT_TEXTURE_KEY;
	}
	if (surfaceId === VDP_RD_SURFACE_PRIMARY) {
		return VDP_PRIMARY_SLOT_TEXTURE_KEY;
	}
	if (surfaceId === VDP_RD_SURFACE_SECONDARY) {
		return VDP_SECONDARY_SLOT_TEXTURE_KEY;
	}
	if (surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
		return FRAMEBUFFER_RENDER_TEXTURE_KEY;
	}
	throw new Error(`[VDPSurfaces] Unknown surface ${surfaceId}.`);
}
