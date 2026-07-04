import type { TextureHandle } from '../backend/backend';
import type { VDP } from '../../machine/devices/vdp/vdp';
import { FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY } from '../../rompack/format';
import { RGBA8_LINEAR_TEXTURE_PARAMS } from '../backend/texture_params';
import type { TextureManager } from '../texture_manager';
import type { GameView } from '../gameview';

const EMPTY_TEXTURE_SEED = new Uint8Array(4);

export class VdpFrameBufferTextures {
	private renderFrameBufferTexture: TextureHandle = null as TextureHandle;
	private displayFrameBufferTexture: TextureHandle = null as TextureHandle;
	private frameBufferTextureWidth = 0;
	private frameBufferTextureHeight = 0;

	public constructor(
		private readonly textureManager: TextureManager,
		private readonly view: GameView,
	) {
	}

	public initialize(vdp: VDP): void {
		this.frameBufferTextureWidth = vdp.frameBufferWidth;
		this.frameBufferTextureHeight = vdp.frameBufferHeight;
		this.renderFrameBufferTexture = this.textureManager.createTextureFromPixelsSync(
			FRAMEBUFFER_RENDER_TEXTURE_KEY,
			EMPTY_TEXTURE_SEED,
			1,
			1,
			RGBA8_LINEAR_TEXTURE_PARAMS
		);
		this.renderFrameBufferTexture = this.textureManager.resizeTextureForKey(
			FRAMEBUFFER_RENDER_TEXTURE_KEY,
			vdp.frameBufferWidth,
			vdp.frameBufferHeight,
			RGBA8_LINEAR_TEXTURE_PARAMS
		);
		this.view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = this.renderFrameBufferTexture;
		this.displayFrameBufferTexture = this.textureManager.createTextureFromPixelsSync(
			FRAMEBUFFER_TEXTURE_KEY,
			EMPTY_TEXTURE_SEED,
			1,
			1,
			RGBA8_LINEAR_TEXTURE_PARAMS
		);
		this.displayFrameBufferTexture = this.textureManager.resizeTextureForKey(
			FRAMEBUFFER_TEXTURE_KEY,
			vdp.frameBufferWidth,
			vdp.frameBufferHeight,
			RGBA8_LINEAR_TEXTURE_PARAMS
		);
		this.view.textures[FRAMEBUFFER_TEXTURE_KEY] = this.displayFrameBufferTexture;
		this.view.backend.updateTextureRegion(
			this.textureManager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY, RGBA8_LINEAR_TEXTURE_PARAMS),
			vdp.frameBufferRenderReadback,
			vdp.frameBufferWidth,
			vdp.frameBufferHeight,
			0,
			0,
			RGBA8_LINEAR_TEXTURE_PARAMS
		);
		this.view.backend.updateTextureRegion(
			this.textureManager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY, RGBA8_LINEAR_TEXTURE_PARAMS),
			vdp.frameBufferDisplayReadback,
			vdp.frameBufferWidth,
			vdp.frameBufferHeight,
			0,
			0,
			RGBA8_LINEAR_TEXTURE_PARAMS
		);
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
}
