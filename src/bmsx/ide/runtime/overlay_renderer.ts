import type { BFont } from '../../render/shared/bitmap_font';
import type { RenderLayer, color } from '../../render/shared/submissions';
import type { Host2DSubmission } from '../../render/shared/queues';
import { consoleCore } from '../../core/console';
import { clearOverlayFrame, publishOverlayFrame, type HostOverlayFrame } from '../../render/host_overlay/overlay_queue';
import type { GameView } from '../../render/gameview';
import type { Viewport } from '../../rompack/format';

export type RenderCommand = Host2DSubmission;
type RectSubmission = Extract<Host2DSubmission, { type: 'rect' }>;
type ImgSubmission = Extract<Host2DSubmission, { type: 'img' }>;
type GlyphSubmission = Extract<Host2DSubmission, { type: 'glyphs' }>;

type OverlayCommandBuffer = {
	commands: RenderCommand[];
	rectPool: RectSubmission[];
	imagePool: ImgSubmission[];
	glyphPool: GlyphSubmission[];
	rectCount: number;
	imageCount: number;
	glyphCount: number;
};

function createRectSubmission(): RectSubmission {
	return {
		type: 'rect',
		kind: 'fill',
		area: { left: 0, top: 0, right: 0, bottom: 0, z: 0 },
		color: null,
		layer: 'ide',
	};
}

function createImageSubmission(): ImgSubmission {
	return {
		type: 'img',
		imgid: '',
		pos: { x: 0, y: 0, z: 0 },
		scale: { x: 1, y: 1 },
		flip: { flip_h: false, flip_v: false },
		colorize: null,
		ambient_affected: false,
		ambient_factor: 1,
		layer: 'ide',
		parallax_weight: 0,
	};
}

function createGlyphSubmission(): GlyphSubmission {
	return {
		type: 'glyphs',
		glyphs: '',
		x: 0,
		y: 0,
		z: 0,
		glyph_start: 0,
		glyph_end: 0,
		font: null,
		color: null,
		background_color: null,
		wrap_chars: 0,
		center_block_width: 0,
		align: 'start',
		baseline: 'alphabetic',
		layer: 'ide',
	};
}

function createOverlayCommandBuffer(): OverlayCommandBuffer {
	return {
		commands: [],
		rectPool: [],
		imagePool: [],
		glyphPool: [],
		rectCount: 0,
		imageCount: 0,
		glyphCount: 0,
	};
}

export class OverlayRenderer {
	private activeBuffer = createOverlayCommandBuffer();
	private standbyBuffer = createOverlayCommandBuffer();
	private frameLogicalWidth = 0;
	private frameLogicalHeight = 0;
	private frameRenderWidth = 0;
	private frameRenderHeight = 0;
	private overrideSize: Viewport = null;

	public setViewportSize(viewport: Viewport): void {
		this.overrideSize = { width: viewport.width, height: viewport.height };
	}

	public setRenderingViewportType(view: GameView, type: 'viewport' | 'offscreen'): void {
		let targetSize: Viewport;
		switch (type) {
			case 'viewport':
				view.viewportTypeIde = 'viewport';
				targetSize = { width: view.viewportSize.x, height: view.viewportSize.y };
				break;
			case 'offscreen':
				view.viewportTypeIde = 'offscreen';
			default:
				targetSize = { width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y };
				break;
		}
		this.setViewportSize(targetSize);
	}

	public get viewportSize(): Viewport {
		return this.overrideSize;
	}

	public beginFrame(): void {
		const buffer = this.activeBuffer;
		buffer.commands.length = 0;
		buffer.rectCount = 0;
		buffer.imageCount = 0;
		buffer.glyphCount = 0;
		const view = consoleCore.view;
		const offscreen = view.offscreenCanvasSize;
		const logical = view.viewportSize;
		const renderWidth = this.overrideSize ? this.overrideSize.width : offscreen.x;
		const renderHeight = this.overrideSize ? this.overrideSize.height : offscreen.y;
		this.frameLogicalWidth = logical.x;
		this.frameLogicalHeight = logical.y;
		this.frameRenderWidth = renderWidth;
		this.frameRenderHeight = renderHeight;
	}

	public fillRect(left: number, top: number, right: number, bottom: number, z: number, color: color, layer: RenderLayer): void {
		const submission = this.nextRectSubmission();
		submission.kind = 'fill';
		const area = submission.area;
		area.left = left;
		area.top = top;
		area.right = right;
		area.bottom = bottom;
		area.z = z;
		submission.color = color;
		submission.layer = layer;
		this.activeBuffer.commands.push(submission);
	}

	public strokeRect(left: number, top: number, right: number, bottom: number, z: number, color: color, layer: RenderLayer): void {
		const submission = this.nextRectSubmission();
		submission.kind = 'rect';
		const area = submission.area;
		area.left = left;
		area.top = top;
		area.right = right;
		area.bottom = bottom;
		area.z = z;
		submission.color = color;
		submission.layer = layer;
		this.activeBuffer.commands.push(submission);
	}

	public spriteColorized(imgid: string, x: number, y: number, z: number, colorize: color, layer: RenderLayer): void {
		const submission = this.nextImageSubmission();
		submission.imgid = imgid;
		const pos = submission.pos;
		pos.x = x;
		pos.y = y;
		pos.z = z;
		const scale = submission.scale;
		scale.x = 1;
		scale.y = 1;
		const flip = submission.flip;
		flip.flip_h = false;
		flip.flip_v = false;
		submission.colorize = colorize;
		submission.ambient_affected = false;
		submission.ambient_factor = 1;
		submission.layer = layer;
		submission.parallax_weight = 0;
		this.activeBuffer.commands.push(submission);
	}

	public glyphRun(glyphs: string | string[], glyphStart: number, glyphEnd: number, x: number, y: number, z: number, font: BFont, color: color, layer: RenderLayer): void {
		const submission = this.nextGlyphSubmission();
		submission.glyphs = glyphs;
		submission.glyph_start = glyphStart;
		submission.glyph_end = glyphEnd;
		submission.x = x;
		submission.y = y;
		submission.z = z;
		submission.font = font;
		submission.color = color;
		submission.background_color = null;
		submission.wrap_chars = 0;
		submission.center_block_width = 0;
		submission.align = 'start';
		submission.baseline = 'alphabetic';
		submission.layer = layer;
		this.activeBuffer.commands.push(submission);
	}

	private nextRectSubmission(): RectSubmission {
		const buffer = this.activeBuffer;
		const index = buffer.rectCount;
		buffer.rectCount = index + 1;
		let submission = buffer.rectPool[index];
		if (submission === undefined) {
			submission = createRectSubmission();
			buffer.rectPool[index] = submission;
		}
		return submission;
	}

	private nextImageSubmission(): ImgSubmission {
		const buffer = this.activeBuffer;
		const index = buffer.imageCount;
		buffer.imageCount = index + 1;
		let submission = buffer.imagePool[index];
		if (submission === undefined) {
			submission = createImageSubmission();
			buffer.imagePool[index] = submission;
		}
		return submission;
	}

	private nextGlyphSubmission(): GlyphSubmission {
		const buffer = this.activeBuffer;
		const index = buffer.glyphCount;
		buffer.glyphCount = index + 1;
		let submission = buffer.glyphPool[index];
		if (submission === undefined) {
			submission = createGlyphSubmission();
			buffer.glyphPool[index] = submission;
		}
		return submission;
	}

	public endFrame(): void {
		const publishedBuffer = this.activeBuffer;
		if (publishedBuffer.commands.length === 0) {
			clearOverlayFrame();
			return;
		}
		this.activeBuffer = this.standbyBuffer;
		this.standbyBuffer = publishedBuffer;
		const frame: HostOverlayFrame = {
			width: this.frameRenderWidth,
			height: this.frameRenderHeight,
			logicalWidth: this.frameLogicalWidth,
			logicalHeight: this.frameLogicalHeight,
			renderWidth: this.frameRenderWidth,
			renderHeight: this.frameRenderHeight,
			commands: publishedBuffer.commands,
		};
		publishOverlayFrame(frame);
	}

	public abandonFrame(): void {
		const buffer = this.activeBuffer;
		buffer.commands.length = 0;
		buffer.rectCount = 0;
		buffer.imageCount = 0;
		buffer.glyphCount = 0;
	}
}
