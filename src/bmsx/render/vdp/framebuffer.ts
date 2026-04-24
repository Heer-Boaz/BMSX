import type { TextureHandle } from '../backend/interfaces';
import type { VDP } from '../../machine/devices/vdp/vdp';
import { engineCore } from '../../core/engine';
import { FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY, type TextureSource } from '../../rompack/format';
import { isVdpFrameBufferSurface } from './surfaces';

const frameBufferRegionSource: TextureSource = { width: 0, height: 0, data: new Uint8Array(0) };

function createVdpFrameBufferTexture(textureKey: string, pixels: Uint8Array, width: number, height: number): void {
	engineCore.texmanager.createTextureFromPixelsSync(textureKey, pixels, width, height);
	const handle = engineCore.texmanager.resizeTextureForKey(textureKey, width, height);
	engineCore.view.backend.updateTexture(handle, { width, height, data: pixels });
	engineCore.view.textures[textureKey] = handle;
}

export function initializeVdpFrameBufferTextures(vdp: VDP): void {
	const slots = vdp.surfaceUploadSlots;
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index];
		if (!isVdpFrameBufferSurface(slot.surfaceId)) {
			continue;
		}
		createVdpFrameBufferTexture(FRAMEBUFFER_RENDER_TEXTURE_KEY, slot.cpuReadback, slot.surfaceWidth, slot.surfaceHeight);
		break;
	}
	createVdpFrameBufferTexture(FRAMEBUFFER_TEXTURE_KEY, vdp.frameBufferDisplayReadback, vdp.frameBufferWidth, vdp.frameBufferHeight);
}

export function getVdpDisplayFrameBufferTexture(): TextureHandle {
	return engineCore.texmanager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
}

export function getVdpRenderFrameBufferTexture(): TextureHandle {
	return engineCore.texmanager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
}

export function presentVdpFrameBufferPages(vdp: VDP): void {
	engineCore.texmanager.swapTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
	engineCore.view.textures[FRAMEBUFFER_TEXTURE_KEY] = engineCore.texmanager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	engineCore.view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = engineCore.texmanager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
	vdp.swapFrameBufferReadbackPages();
}

export function uploadVdpFrameBufferPixels(pixels: Uint8Array, width: number, height: number): void {
	const handle = engineCore.texmanager.resizeTextureForKey(FRAMEBUFFER_RENDER_TEXTURE_KEY, width, height);
	engineCore.view.backend.updateTexture(handle, { width, height, data: pixels });
	engineCore.view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = handle;
}

export function uploadVdpDisplayFrameBufferPixels(pixels: Uint8Array, width: number, height: number): void {
	const handle = engineCore.texmanager.resizeTextureForKey(FRAMEBUFFER_TEXTURE_KEY, width, height);
	engineCore.view.backend.updateTexture(handle, { width, height, data: pixels });
	engineCore.view.textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
}

export function uploadVdpFrameBufferPixelRegion(pixels: Uint8Array, width: number, height: number, x: number, y: number): void {
	frameBufferRegionSource.width = width;
	frameBufferRegionSource.height = height;
	frameBufferRegionSource.data = pixels;
	engineCore.view.backend.updateTextureRegion(getVdpRenderFrameBufferTexture(), frameBufferRegionSource, x, y);
}

export function readVdpFrameBufferPixels(x: number, y: number, width: number, height: number, out?: Uint8Array): Uint8Array {
	return engineCore.view.backend.readTextureRegion(getVdpRenderFrameBufferTexture(), x, y, width, height, out);
}

export function readVdpDisplayFrameBufferPixels(x: number, y: number, width: number, height: number, out?: Uint8Array): Uint8Array {
	return engineCore.view.backend.readTextureRegion(getVdpDisplayFrameBufferTexture(), x, y, width, height, out);
}

export function restoreVdpFrameBufferContext(vdp: VDP): void {
	initializeVdpFrameBufferTextures(vdp);
}
