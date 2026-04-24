import type { TextureHandle } from '../backend/interfaces';
import type { VDP } from '../../machine/devices/vdp/vdp';
import { $ } from '../../core/engine';
import { FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY } from '../../rompack/format';
import { isVdpFrameBufferSurface } from './surfaces';

function ensureDisplayTexture(seedPixel: Uint8Array, width: number, height: number): void {
	let handle = $.texmanager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	if (!handle) {
		handle = $.texmanager.createTextureFromPixelsSync(FRAMEBUFFER_TEXTURE_KEY, seedPixel, 1, 1);
	}
	handle = $.texmanager.resizeTextureForKey(FRAMEBUFFER_TEXTURE_KEY, width, height);
	$.view.textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
}

export function hasVdpFrameBufferTexture(): boolean {
	return !!getVdpRenderFrameBufferTexture();
}

export function getVdpDisplayFrameBufferTexture(): TextureHandle {
	return $.texmanager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
}

export function getVdpRenderFrameBufferTexture(): TextureHandle {
	return $.texmanager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
}

export function syncVdpDisplayFrameBuffer(vdp: VDP, seedPixel: Uint8Array): void {
	ensureDisplayTexture(seedPixel, vdp.frameBufferWidth, vdp.frameBufferHeight);
	$.texmanager.copyTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY, vdp.frameBufferWidth, vdp.frameBufferHeight);
	vdp.syncDisplayFrameBufferReadback();
}

export function presentVdpFrameBufferPages(vdp: VDP): void {
	$.texmanager.swapTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
	$.view.textures[FRAMEBUFFER_TEXTURE_KEY] = $.texmanager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	$.view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = $.texmanager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
	vdp.swapFrameBufferReadbackPages();
}

export function uploadVdpFrameBufferPixels(pixels: Uint8Array, width: number, height: number): void {
	let handle = getVdpRenderFrameBufferTexture();
	if (!handle) {
		handle = $.texmanager.createTextureFromPixelsSync(FRAMEBUFFER_RENDER_TEXTURE_KEY, pixels, width, height);
		$.view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = handle;
		return;
	}
	handle = $.texmanager.resizeTextureForKey(FRAMEBUFFER_RENDER_TEXTURE_KEY, width, height);
	$.view.backend.updateTexture(handle, { width, height, data: pixels });
	$.view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = handle;
}

export function uploadVdpFrameBufferPixelRegion(pixels: Uint8Array, width: number, height: number, x: number, y: number): void {
	$.texmanager.updateTextureRegionForKey(FRAMEBUFFER_RENDER_TEXTURE_KEY, pixels, width, height, x, y);
}

export function readVdpFrameBufferPixels(x: number, y: number, width: number, height: number, out?: Uint8Array): Uint8Array {
	return $.view.backend.readTextureRegion(getVdpRenderFrameBufferTexture(), x, y, width, height, out);
}

export function readVdpDisplayFrameBufferPixels(x: number, y: number, width: number, height: number, out?: Uint8Array): Uint8Array {
	return $.view.backend.readTextureRegion(getVdpDisplayFrameBufferTexture(), x, y, width, height, out);
}

export function restoreVdpFrameBufferContext(vdp: VDP, seedPixel: Uint8Array): void {
	const slots = vdp.surfaceUploadSlots;
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index];
		if (!isVdpFrameBufferSurface(slot.surfaceId)) {
			continue;
		}
		uploadVdpFrameBufferPixels(slot.cpuReadback, slot.surfaceWidth, slot.surfaceHeight);
		break;
	}
	syncVdpDisplayFrameBuffer(vdp, seedPixel);
}
