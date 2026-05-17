import type { TextureHandle } from '../backend/backend';
import type { VDP } from '../../machine/devices/vdp/vdp';
import type { VdpFrameBufferPresentation, VdpFrameBufferPresentationSink } from '../../machine/devices/vdp/device_output';
import { FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY } from '../../rompack/format';
import { DEFAULT_TEXTURE_PARAMS } from '../backend/texture_params';
import type { TextureManager } from '../texture_manager';
import type { GameView } from '../gameview';

const EMPTY_TEXTURE_SEED = new Uint8Array(4);
const VDP_FRAMEBUFFER_TEXTURE_PARAMS = Object.freeze({
	...DEFAULT_TEXTURE_PARAMS,
	srgb: false,
});

export class VdpFrameBufferTextures implements VdpFrameBufferPresentationSink {
	private renderFrameBufferTexture: TextureHandle = null as TextureHandle;
	private displayFrameBufferTexture: TextureHandle = null as TextureHandle;
	private frameBufferTextureWidth = 0;
	private frameBufferTextureHeight = 0;

	public constructor(
		private readonly textureManager: TextureManager,
		private readonly view: GameView,
	) {
	}

	public consumeVdpFrameBufferPresentation(presentation: VdpFrameBufferPresentation): void {
		const presentationCount = presentation.presentationCount;
		for (let index = 0; index < presentationCount; index += 1) {
			this.presentVdpFrameBufferPages();
		}
		const frameBufferWidth = presentation.width;
		const frameBufferHeight = presentation.height;
		this.frameBufferTextureWidth = frameBufferWidth;
		this.frameBufferTextureHeight = frameBufferHeight;
		if (!presentation.readbackValid) {
			return;
		}
		if (presentationCount !== 1 || presentation.requiresFullSync) {
			this.view.backend.updateTextureRegion(
				this.textureManager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY, VDP_FRAMEBUFFER_TEXTURE_PARAMS),
				presentation.renderReadback,
				frameBufferWidth,
				frameBufferHeight,
				0,
				0,
				VDP_FRAMEBUFFER_TEXTURE_PARAMS
			);
			this.view.backend.updateTextureRegion(
				this.textureManager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY, VDP_FRAMEBUFFER_TEXTURE_PARAMS),
				presentation.displayReadback,
				frameBufferWidth,
				frameBufferHeight,
				0,
				0,
				VDP_FRAMEBUFFER_TEXTURE_PARAMS
			);
			return;
		}
		const rowBytes = frameBufferWidth * 4;
		const displayReadback = presentation.displayReadback;
		const spans = presentation.dirtySpansByRow;
		for (let row = presentation.dirtyRowStart; row < presentation.dirtyRowEnd; row += 1) {
			const span = spans[row]!;
			if (span.xStart >= span.xEnd) {
				continue;
			}
			const byteStart = row * rowBytes + span.xStart * 4;
			this.view.backend.updateTextureRegion(
				this.textureManager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY, VDP_FRAMEBUFFER_TEXTURE_PARAMS),
				displayReadback,
				span.xEnd - span.xStart,
				1,
				span.xStart,
				row,
				VDP_FRAMEBUFFER_TEXTURE_PARAMS,
				byteStart
			);
		}
	}

	public initialize(vdp: VDP): void {
		this.frameBufferTextureWidth = vdp.frameBufferWidth;
		this.frameBufferTextureHeight = vdp.frameBufferHeight;
		this.renderFrameBufferTexture = this.textureManager.createTextureFromPixelsSync(
			FRAMEBUFFER_RENDER_TEXTURE_KEY,
			EMPTY_TEXTURE_SEED,
			1,
			1,
			VDP_FRAMEBUFFER_TEXTURE_PARAMS
		);
		this.renderFrameBufferTexture = this.textureManager.resizeTextureForKey(
			FRAMEBUFFER_RENDER_TEXTURE_KEY,
			vdp.frameBufferWidth,
			vdp.frameBufferHeight,
			VDP_FRAMEBUFFER_TEXTURE_PARAMS
		);
		this.view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = this.renderFrameBufferTexture;
		this.displayFrameBufferTexture = this.textureManager.createTextureFromPixelsSync(
			FRAMEBUFFER_TEXTURE_KEY,
			EMPTY_TEXTURE_SEED,
			1,
			1,
			VDP_FRAMEBUFFER_TEXTURE_PARAMS
		);
		this.displayFrameBufferTexture = this.textureManager.resizeTextureForKey(
			FRAMEBUFFER_TEXTURE_KEY,
			vdp.frameBufferWidth,
			vdp.frameBufferHeight,
			VDP_FRAMEBUFFER_TEXTURE_PARAMS
		);
		this.view.textures[FRAMEBUFFER_TEXTURE_KEY] = this.displayFrameBufferTexture;
		vdp.syncFrameBufferPresentation(this);
	}

	public width(): number {
		return this.frameBufferTextureWidth;
	}

	public height(): number {
		return this.frameBufferTextureHeight;
	}

	public displayTexture(): TextureHandle {
		return this.displayFrameBufferTexture;
	}

	public renderTexture(): TextureHandle {
		return this.renderFrameBufferTexture;
	}

	private presentVdpFrameBufferPages(): void {
		this.textureManager.swapTextureHandlesByUri(
			FRAMEBUFFER_TEXTURE_KEY,
			FRAMEBUFFER_RENDER_TEXTURE_KEY,
			VDP_FRAMEBUFFER_TEXTURE_PARAMS,
			VDP_FRAMEBUFFER_TEXTURE_PARAMS
		);
		this.view.textures[FRAMEBUFFER_TEXTURE_KEY] = this.textureManager.getTextureByUri(
			FRAMEBUFFER_TEXTURE_KEY,
			VDP_FRAMEBUFFER_TEXTURE_PARAMS
		);
		this.view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = this.textureManager.getTextureByUri(
			FRAMEBUFFER_RENDER_TEXTURE_KEY,
			VDP_FRAMEBUFFER_TEXTURE_PARAMS
		);
		const renderTexture = this.renderFrameBufferTexture;
		this.renderFrameBufferTexture = this.displayFrameBufferTexture;
		this.displayFrameBufferTexture = renderTexture;
	}
}
