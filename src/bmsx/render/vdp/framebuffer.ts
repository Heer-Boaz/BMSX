import type { TextureHandle } from '../backend/interfaces';
import type { VDP } from '../../machine/devices/vdp/vdp';
import { VDP_RD_SURFACE_FRAMEBUFFER } from '../../machine/devices/vdp/contracts';
import { FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY, type TextureSource } from '../../rompack/format';
import {
	createVdpTextureFromPixels,
	swapVdpTextureHandlesByUri,
	updateVdpTexturePixels,
	vdpTextureBackend,
} from './texture_transfer';

const frameBufferRegionSource: TextureSource = { width: 0, height: 0, data: new Uint8Array(0) };
let renderFrameBufferTexture: TextureHandle;
let displayFrameBufferTexture: TextureHandle;

export function initializeVdpFrameBufferTextures(vdp: VDP): void {
	renderFrameBufferTexture = createVdpTextureFromPixels(FRAMEBUFFER_RENDER_TEXTURE_KEY, vdp.frameBufferRenderReadback, vdp.frameBufferWidth, vdp.frameBufferHeight);
	vdp.clearSurfaceUploadDirty(VDP_RD_SURFACE_FRAMEBUFFER);
	displayFrameBufferTexture = createVdpTextureFromPixels(FRAMEBUFFER_TEXTURE_KEY, vdp.frameBufferDisplayReadback, vdp.frameBufferWidth, vdp.frameBufferHeight);
}

export function vdpDisplayFrameBufferTexture(): TextureHandle {
	return displayFrameBufferTexture;
}

export function vdpRenderFrameBufferTexture(): TextureHandle {
	return renderFrameBufferTexture;
}

export function presentVdpFrameBufferPages(): void {
	swapVdpTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
	// disable-next-line single_use_local_pattern -- texture page swap needs one temporary handle without allocating a pair object.
	const renderTexture = renderFrameBufferTexture;
	renderFrameBufferTexture = displayFrameBufferTexture;
	displayFrameBufferTexture = renderTexture;
}

export function writeVdpRenderFrameBufferPixels(pixels: Uint8Array, width: number, height: number): void {
	renderFrameBufferTexture = updateVdpTexturePixels(FRAMEBUFFER_RENDER_TEXTURE_KEY, pixels, width, height);
}

export function writeVdpDisplayFrameBufferPixels(pixels: Uint8Array, width: number, height: number): void {
	displayFrameBufferTexture = updateVdpTexturePixels(FRAMEBUFFER_TEXTURE_KEY, pixels, width, height);
}

export function writeVdpRenderFrameBufferPixelRegion(pixels: Uint8Array, width: number, height: number, x: number, y: number): void {
	frameBufferRegionSource.width = width;
	frameBufferRegionSource.height = height;
	frameBufferRegionSource.data = pixels;
	vdpTextureBackend().updateTextureRegion(renderFrameBufferTexture, frameBufferRegionSource, x, y);
}

export function applyVdpFrameBufferTextureWrites(vdp: VDP): void {
	const output = vdp.readHostOutput();
	const slots = output.surfaceUploadSlots;
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index]!;
		if (slot.surfaceId !== VDP_RD_SURFACE_FRAMEBUFFER) {
			continue;
		}
		if (slot.dirtyRowStart < slot.dirtyRowEnd) {
			const rowBytes = slot.surfaceWidth * 4;
			const rowStart = slot.dirtyRowStart;
			const rowCount = slot.dirtyRowEnd - rowStart;
			const byteStart = rowStart * rowBytes;
			writeVdpRenderFrameBufferPixelRegion(
				slot.cpuReadback.subarray(byteStart, byteStart + rowCount * rowBytes),
				slot.surfaceWidth,
				rowCount,
				0,
				rowStart,
			);
			vdp.clearSurfaceUploadDirty(slot.surfaceId);
		}
		return;
	}
}

// disable-next-line single_line_method_pattern -- framebuffer readback is the concrete VDP texture boundary for save-state and MMIO reads.
export function readVdpRenderFrameBufferPixels(x: number, y: number, width: number, height: number, out?: Uint8Array): Uint8Array {
	return vdpTextureBackend().readTextureRegion(renderFrameBufferTexture, x, y, width, height, out);
}

// disable-next-line single_line_method_pattern -- display-page readback is the concrete VDP texture boundary for headless presentation and save-state.
export function readVdpDisplayFrameBufferPixels(x: number, y: number, width: number, height: number, out?: Uint8Array): Uint8Array {
	return vdpTextureBackend().readTextureRegion(displayFrameBufferTexture, x, y, width, height, out);
}
