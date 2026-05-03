import type { TextureHandle } from '../backend/interfaces';
import type { VdpHostOutput, VdpSurfaceUploadSlot } from '../../machine/devices/vdp/vdp';
import {
	VDP_PRIMARY_SLOT_TEXTURE_KEY,
	VDP_SECONDARY_SLOT_TEXTURE_KEY,
	SYSTEM_SLOT_TEXTURE_KEY,
	FRAMEBUFFER_RENDER_TEXTURE_KEY,
} from '../../rompack/format';
import {
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
} from '../../machine/bus/io';
import {
	VDP_RD_SURFACE_SYSTEM,
	VDP_RD_SURFACE_FRAMEBUFFER,
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
} from '../../machine/devices/vdp/contracts';
import { vdpRenderFrameBufferTexture } from './framebuffer';
import { vdpTextureByUri } from './texture_transfer';

export type VdpRenderSurface = {
	textureKey: string;
	width: number;
	height: number;
};

export function resolveVdpHostSurfaceSlot(output: VdpHostOutput, surfaceId: number): VdpSurfaceUploadSlot {
	const slots = output.surfaceUploadSlots;
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index]!;
		if (slot.surfaceId === surfaceId) {
			return slot;
		}
	}
	throw new Error(`[VDPSurfaces] Surface ${surfaceId} is not registered for host output.`);
}

export function resolveVdpRenderSurface(output: VdpHostOutput, surfaceId: number): VdpRenderSurface {
	const slot = resolveVdpHostSurfaceSlot(output, surfaceId);
	return {
		textureKey: resolveVdpSurfaceTextureKey(surfaceId),
		width: slot.surfaceWidth,
		height: slot.surfaceHeight,
	};
}

export function resolveVdpSurfaceSlotBinding(surfaceId: number): number {
	if (surfaceId === VDP_RD_SURFACE_PRIMARY) {
		return VDP_SLOT_PRIMARY;
	}
	if (surfaceId === VDP_RD_SURFACE_SECONDARY) {
		return VDP_SLOT_SECONDARY;
	}
	if (surfaceId === VDP_RD_SURFACE_SYSTEM) {
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
