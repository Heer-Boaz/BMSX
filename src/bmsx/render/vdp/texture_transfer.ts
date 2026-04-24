import { engineCore } from '../../core/engine';
import type { TextureHandle } from '../backend/interfaces';
import type { TextureSource } from '../../rompack/format';

const textureRegionSource: TextureSource = { width: 0, height: 0, data: new Uint8Array(0) };

export function vdpTextureByUri(textureKey: string): TextureHandle {
	return engineCore.texmanager.getTextureByUri(textureKey);
}

export function createVdpTextureFromSeed(textureKey: string, seedPixel: Uint8Array, width: number, height: number): TextureHandle {
	engineCore.texmanager.createTextureFromPixelsSync(textureKey, seedPixel, 1, 1);
	const handle = engineCore.texmanager.resizeTextureForKey(textureKey, width, height);
	engineCore.view.textures[textureKey] = handle;
	return handle;
}

export function resizeVdpTextureForKey(textureKey: string, width: number, height: number): TextureHandle {
	const handle = engineCore.texmanager.resizeTextureForKey(textureKey, width, height);
	engineCore.view.textures[textureKey] = handle;
	return handle;
}

export function updateVdpTextureRegion(textureKey: string, pixels: Uint8Array, width: number, height: number, x: number, y: number): void {
	textureRegionSource.width = width;
	textureRegionSource.height = height;
	textureRegionSource.data = pixels;
	engineCore.view.backend.updateTextureRegion(vdpTextureByUri(textureKey), textureRegionSource, x, y);
}
