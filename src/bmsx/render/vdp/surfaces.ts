import type { TextureHandle } from '../backend/interfaces';
import type { VDP, VdpResolvedBlitterSample } from '../../machine/devices/vdp/vdp';
import {
	ATLAS_PRIMARY_SLOT_ID,
	ATLAS_SECONDARY_SLOT_ID,
	ENGINE_ATLAS_INDEX,
	ENGINE_ATLAS_TEXTURE_KEY,
	FRAMEBUFFER_RENDER_TEXTURE_KEY,
} from '../../rompack/format';
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

export function resolveVdpBlitterSample(vdp: VDP, handle: number): VdpResolvedBlitterSample {
	const source = vdp.resolveBlitterSource(handle);
	const surface = vdp.resolveBlitterSurfaceSize(source.surfaceId);
	return {
		source,
		surfaceWidth: surface.width,
		surfaceHeight: surface.height,
		atlasId: resolveVdpSurfaceAtlasBinding(source.surfaceId),
	};
}

export function resolveVdpSurfaceAtlasBinding(surfaceId: number): number {
	if (surfaceId === VDP_RD_SURFACE_PRIMARY) {
		return 0;
	}
	if (surfaceId === VDP_RD_SURFACE_SECONDARY) {
		return 1;
	}
	if (surfaceId === VDP_RD_SURFACE_ENGINE) {
		return ENGINE_ATLAS_INDEX;
	}
	throw new Error(`[VDPSurfaces] Surface ${surfaceId} cannot be sampled by the blitter atlas pipeline.`);
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
		return ENGINE_ATLAS_TEXTURE_KEY;
	}
	if (surfaceId === VDP_RD_SURFACE_PRIMARY) {
		return ATLAS_PRIMARY_SLOT_ID;
	}
	if (surfaceId === VDP_RD_SURFACE_SECONDARY) {
		return ATLAS_SECONDARY_SLOT_ID;
	}
	if (surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
		return FRAMEBUFFER_RENDER_TEXTURE_KEY;
	}
	throw new Error(`[VDPSurfaces] Unknown surface ${surfaceId}.`);
}
