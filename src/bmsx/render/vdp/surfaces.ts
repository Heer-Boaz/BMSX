import type { TextureHandle } from '../backend/interfaces';
import type { VDP } from '../../machine/devices/vdp/vdp';
import {
	TEXTPAGE_PRIMARY_SLOT_ID,
	TEXTPAGE_SECONDARY_SLOT_ID,
	BIOS_TEXTPAGE_TEXTURE_KEY,
	FRAMEBUFFER_RENDER_TEXTURE_KEY,
} from '../../rompack/format';
import {
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
} from '../../machine/bus/io';
import { vdpRenderFrameBufferTexture } from './framebuffer';
import { vdpTextureByUri } from './texture_transfer';

const VDP_RD_SURFACE_ENGINE = 0;
const VDP_RD_SURFACE_PRIMARY = 1;
const VDP_RD_SURFACE_SECONDARY = 2;
const VDP_RD_SURFACE_FRAMEBUFFER = 3;

export type VdpRenderSurface = {
	textureKey: string;
	width: number;
	height: number;
};

export function resolveVdpRenderSurface(vdp: VDP, surfaceId: number): VdpRenderSurface {
	const size = vdp.resolveBlitterSurfaceSize(surfaceId);
	return {
		textureKey: resolveVdpSurfaceTextureKey(surfaceId),
		width: size.width,
		height: size.height,
	};
}

export function resolveVdpSurfaceSlotBinding(surfaceId: number): number {
	if (surfaceId === VDP_RD_SURFACE_PRIMARY) {
		return VDP_SLOT_PRIMARY;
	}
	if (surfaceId === VDP_RD_SURFACE_SECONDARY) {
		return VDP_SLOT_SECONDARY;
	}
	if (surfaceId === VDP_RD_SURFACE_ENGINE) {
		return VDP_SLOT_SYSTEM;
	}
	throw new Error(`[VDPSurfaces] Surface ${surfaceId} cannot be sampled by the blitter slot pipeline.`);
}

export function isVdpFrameBufferSurface(surfaceId: number): boolean {
	return surfaceId === VDP_RD_SURFACE_FRAMEBUFFER;
}

export function getVdpRenderSurfaceTexture(surfaceId: number): TextureHandle {
	if (isVdpFrameBufferSurface(surfaceId)) {
		return vdpRenderFrameBufferTexture();
	}
	return vdpTextureByUri(resolveVdpSurfaceTextureKey(surfaceId));
}

function resolveVdpSurfaceTextureKey(surfaceId: number): string {
	if (surfaceId === VDP_RD_SURFACE_ENGINE) {
		return BIOS_TEXTPAGE_TEXTURE_KEY;
	}
	if (surfaceId === VDP_RD_SURFACE_PRIMARY) {
		return TEXTPAGE_PRIMARY_SLOT_ID;
	}
	if (surfaceId === VDP_RD_SURFACE_SECONDARY) {
		return TEXTPAGE_SECONDARY_SLOT_ID;
	}
	if (surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
		return FRAMEBUFFER_RENDER_TEXTURE_KEY;
	}
	throw new Error(`[VDPSurfaces] Unknown surface ${surfaceId}.`);
}
