import type { GPUBackend, TextureHandle } from '../backend/interfaces';
import type { TextureManager } from '../texture_manager';
import type { GameView } from '../gameview';
import type { TextureSource } from '../../rompack/format';

const textureRegionSource: TextureSource = { width: 0, height: 0, data: new Uint8Array(0) };
let textureManager: TextureManager;
let textureView: GameView;

export function initializeVdpTextureTransfer(manager: TextureManager, view: GameView): void {
	textureManager = manager;
	textureView = view;
}

export function vdpTextureBackend(): GPUBackend {
	return textureView.backend;
}

// disable-next-line single_line_method_pattern -- VDP texture memory owns texture-manager lookup; callers should not reach into the manager.
export function vdpTextureByUri(textureKey: string): TextureHandle {
	return textureManager.getTextureByUri(textureKey);
}

export function createVdpTextureFromSeed(textureKey: string, seedPixel: Uint8Array, width: number, height: number): TextureHandle {
	textureManager.createTextureFromPixelsSync(textureKey, seedPixel, 1, 1);
	const handle = textureManager.resizeTextureForKey(textureKey, width, height);
	textureView.textures[textureKey] = handle;
	return handle;
}

export function createVdpTextureFromPixels(textureKey: string, pixels: Uint8Array, width: number, height: number): TextureHandle {
	textureManager.createTextureFromPixelsSync(textureKey, pixels, width, height);
	const handle = textureManager.resizeTextureForKey(textureKey, width, height);
	vdpTextureBackend().updateTexture(handle, { width, height, data: pixels });
	textureView.textures[textureKey] = handle;
	return handle;
}

export function resizeVdpTextureForKey(textureKey: string, width: number, height: number): TextureHandle {
	const handle = textureManager.resizeTextureForKey(textureKey, width, height);
	textureView.textures[textureKey] = handle;
	return handle;
}

export function updateVdpTexturePixels(textureKey: string, pixels: Uint8Array, width: number, height: number): TextureHandle {
	const handle = resizeVdpTextureForKey(textureKey, width, height);
	vdpTextureBackend().updateTexture(handle, { width, height, data: pixels });
	return handle;
}

export function updateVdpTextureRegion(textureKey: string, pixels: Uint8Array, width: number, height: number, x: number, y: number): void {
	textureRegionSource.width = width;
	textureRegionSource.height = height;
	textureRegionSource.data = pixels;
	vdpTextureBackend().updateTextureRegion(vdpTextureByUri(textureKey), textureRegionSource, x, y);
}

export function swapVdpTextureHandlesByUri(textureKeyA: string, textureKeyB: string): void {
	textureManager.swapTextureHandlesByUri(textureKeyA, textureKeyB);
	textureView.textures[textureKeyA] = vdpTextureByUri(textureKeyA);
	textureView.textures[textureKeyB] = vdpTextureByUri(textureKeyB);
}
