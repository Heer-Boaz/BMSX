import { $ } from '../../core/engine';
import type { TextureHandle } from '../backend/interfaces';

export function vdpTextureByUri(textureKey: string): TextureHandle {
	return $.texmanager.getTextureByUri(textureKey);
}

export function ensureVdpTextureFromSeed(textureKey: string, seedPixel: Uint8Array, width: number, height: number): TextureHandle {
	let handle = $.texmanager.getTextureByUri(textureKey);
	if (!handle) {
		handle = $.texmanager.createTextureFromPixelsSync(textureKey, seedPixel, 1, 1);
	}
	handle = $.texmanager.resizeTextureForKey(textureKey, width, height);
	$.view.textures[textureKey] = handle;
	return handle;
}

export function resizeVdpTextureForKey(textureKey: string, width: number, height: number): TextureHandle {
	const handle = $.texmanager.resizeTextureForKey(textureKey, width, height);
	$.view.textures[textureKey] = handle;
	return handle;
}

export function updateVdpTextureRegion(textureKey: string, pixels: Uint8Array, width: number, height: number, x: number, y: number): void {
	$.texmanager.updateTextureRegionForKey(textureKey, pixels, width, height, x, y);
}
