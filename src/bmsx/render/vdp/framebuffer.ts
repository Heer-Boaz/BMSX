import { $ } from '../../core/engine';
import { FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY } from '../../rompack/format';

export type VdpFrameBufferSize = {
	width: number;
	height: number;
};

export function currentVdpFrameBufferSize(): VdpFrameBufferSize {
	const viewportSize = $.view.viewportSize;
	return {
		width: viewportSize.x,
		height: viewportSize.y,
	};
}

export function vdpRenderFrameBufferTextureExists(): boolean {
	return !!$.texmanager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
}

export function ensureVdpDisplayFrameBufferTexture(seedPixel: Uint8Array, width: number, height: number): void {
	let handle = $.texmanager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	if (!handle) {
		handle = $.texmanager.createTextureFromPixelsSync(FRAMEBUFFER_TEXTURE_KEY, seedPixel, 1, 1);
	}
	handle = $.texmanager.resizeTextureForKey(FRAMEBUFFER_TEXTURE_KEY, width, height);
	$.view.textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
}

export function swapVdpFrameBufferTexturePages(): void {
	$.texmanager.swapTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
	$.view.textures[FRAMEBUFFER_TEXTURE_KEY] = $.texmanager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
	$.view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = $.texmanager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
}

export function copyVdpRenderFrameBufferToDisplay(width: number, height: number): void {
	$.texmanager.copyTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY, width, height);
}
