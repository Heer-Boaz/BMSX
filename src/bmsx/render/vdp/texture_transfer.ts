import { $ } from '../../core/engine';
import type { TextureHandle } from '../backend/interfaces';
import type { TextureSource } from '../../rompack/format';

const textureRegionSource: TextureSource = { width: 0, height: 0, data: new Uint8Array(0) };

export function vdpTextureByUri(textureKey: string): TextureHandle {
	return $.texmanager.getTextureByUri(textureKey);
}

export function createVdpTextureFromSeed(textureKey: string, seedPixel: Uint8Array, width: number, height: number): TextureHandle {
	$.texmanager.createTextureFromPixelsSync(textureKey, seedPixel, 1, 1);
	const handle = $.texmanager.resizeTextureForKey(textureKey, width, height);
	$.view.textures[textureKey] = handle;
	return handle;
}

export function resizeVdpTextureForKey(textureKey: string, width: number, height: number): TextureHandle {
	const handle = $.texmanager.resizeTextureForKey(textureKey, width, height);
	$.view.textures[textureKey] = handle;
	return handle;
}

export function updateVdpTextureRegion(textureKey: string, pixels: Uint8Array, width: number, height: number, x: number, y: number): void {
	textureRegionSource.width = width;
	textureRegionSource.height = height;
	textureRegionSource.data = pixels;
	$.view.backend.updateTextureRegion(vdpTextureByUri(textureKey), textureRegionSource, x, y);
}
