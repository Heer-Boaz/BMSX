import type { BFont } from '../../machine/ts/render/shared/bitmap_font';
import { Host2DKind, type Host2DRef } from '../../machine/ts/render/host_overlay/commands';
import type { HostOverlayClipRect } from '../../machine/ts/render/host_overlay/clip';
import { IDENTITY_HOST_OVERLAY_TRANSFORM, type HostOverlayTransform } from '../../machine/ts/render/host_overlay/transform';
import {
	RectRenderKind,
	type GlyphRenderSubmission,
	type HostImageRenderSubmission,
	type PolyRenderSubmission,
	type RectRenderSubmission,
	type color,
} from '../../machine/ts/render/shared/submissions';
import { LAYER_2D_IDE, type Layer2D } from '../../machine/ts/render/shared/layers';
import type { HostOverlayFrame, HostOverlayQueue } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { Viewport } from '../common/viewport';

type OverlayCommandBuffer = {
	commandKinds: Host2DKind[];
	commandRefs: Host2DRef[];
	commandCount: number;
	frame: HostOverlayFrame;
	rectPool: RectRenderSubmission[];
	imagePool: HostImageRenderSubmission[];
	itemPool: GlyphRenderSubmission[];
	polyPool: PolyRenderSubmission[];
	clipPool: HostOverlayClipRect[];
	clipStack: HostOverlayClipRect[];
	fullClip: HostOverlayClipRect;
	transformPool: HostOverlayTransform[];
	transformStack: Readonly<HostOverlayTransform>[];
	transformCount: number;
	transformDepth: number;
	rectCount: number;
	imageCount: number;
	itemCount: number;
	polyCount: number;
	clipCount: number;
	clipDepth: number;
};

function createRectSubmission(): RectRenderSubmission {
	return {
		kind: RectRenderKind.Fill,
		area: { left: 0, top: 0, right: 0, bottom: 0, z: 0 },
		color: 0xffffffff,
		layer: LAYER_2D_IDE,
	};
}

function createImageSubmission(): HostImageRenderSubmission {
	return {
		imgid: '',
		pos: { x: 0, y: 0, z: 0 },
		scale: { x: 1, y: 1 },
		flip: { flip_h: false, flip_v: false },
		colorize: 0xffffffff,
		ambient_affected: false,
		ambient_factor: 1,
		layer: LAYER_2D_IDE,
	};
}

function createGlyphSubmission(): GlyphRenderSubmission {
	return {
		items: '',
		x: 0,
		y: 0,
		z: 0,
		item_start: 0,
		item_end: 0,
		font: null,
		color: 0xffffffff,
		has_background_color: false,
		background_color: 0xff000000,
		layer: LAYER_2D_IDE,
	};
}

function createOverlayCommandBuffer(): OverlayCommandBuffer {
	const commandKinds: Host2DKind[] = [];
	const commandRefs: Host2DRef[] = [];
	const fullClip = { left: 0, top: 0, right: 0, bottom: 0 };
	return {
		commandKinds,
		commandRefs,
		commandCount: 0,
		frame: {
			logicalWidth: 0,
			logicalHeight: 0,
			commandKinds,
			commandRefs,
			commandCount: 0,
		},
		rectPool: [],
		imagePool: [],
		itemPool: [],
		polyPool: [],
		clipPool: [],
		clipStack: [fullClip],
		fullClip,
		transformPool: [],
		transformStack: [IDENTITY_HOST_OVERLAY_TRANSFORM],
		transformCount: 0,
		transformDepth: 1,
		rectCount: 0,
		imageCount: 0,
		itemCount: 0,
		polyCount: 0,
		clipCount: 0,
		clipDepth: 1,
	};
}

export class OverlayRenderer {
	public active = false;
	public drawFramePending = false;
	public resolutionMode: 'offscreen' | 'viewport' = 'viewport';
	private activeBuffer = createOverlayCommandBuffer();
	private standbyBuffer = createOverlayCommandBuffer();
	private frameLogicalWidth = 0;
	private frameLogicalHeight = 0;
	private overrideSize: Viewport = null;

	public constructor(private readonly queue: HostOverlayQueue) {
	}

	public setViewportSize(viewport: Viewport): void {
		this.overrideSize = { width: viewport.width, height: viewport.height };
	}

	public setRenderingViewportType(presenter: VideoPresenter, type: 'viewport' | 'offscreen'): void {
		this.resolutionMode = type;
		let targetSize: Viewport;
		switch (type) {
			case 'viewport':
				targetSize = { width: presenter.viewportSize.x, height: presenter.viewportSize.y };
				break;
			case 'offscreen':
				targetSize = { width: presenter.offscreenCanvasSize.x, height: presenter.offscreenCanvasSize.y };
				break;
		}
		this.setViewportSize(targetSize);
	}

	public get viewportSize(): Viewport {
		return this.overrideSize;
	}

	public beginFrame(presenter: VideoPresenter): void {
		const buffer = this.activeBuffer;
		buffer.commandCount = 0;
		buffer.rectCount = 0;
		buffer.imageCount = 0;
		buffer.itemCount = 0;
		buffer.polyCount = 0;
		buffer.clipCount = 0;
		buffer.clipDepth = 1;
		buffer.transformCount = 0;
		buffer.transformDepth = 1;
		const logical = presenter.viewportSize;
		this.frameLogicalWidth = logical.x;
		this.frameLogicalHeight = logical.y;
		buffer.fullClip.right = logical.x;
		buffer.fullClip.bottom = logical.y;
	}

	public pushClipRect(left: number, top: number, right: number, bottom: number): void {
		const buffer = this.activeBuffer;
		const transform = buffer.transformStack[buffer.transformDepth - 1];
		left = left * transform.scale + transform.offsetX;
		top = top * transform.scale + transform.offsetY;
		right = right * transform.scale + transform.offsetX;
		bottom = bottom * transform.scale + transform.offsetY;
		const parent = buffer.clipStack[buffer.clipDepth - 1];
		let clip = buffer.clipPool[buffer.clipCount];
		if (clip === undefined) {
			clip = { left: 0, top: 0, right: 0, bottom: 0 };
			buffer.clipPool.push(clip);
		}
		buffer.clipCount += 1;
		clip.left = Math.max(parent.left, left);
		clip.top = Math.max(parent.top, top);
		clip.right = Math.max(clip.left, Math.min(parent.right, right));
		clip.bottom = Math.max(clip.top, Math.min(parent.bottom, bottom));
		buffer.clipStack[buffer.clipDepth++] = clip;
		this.queueCommand(Host2DKind.Clip, clip);
	}

	public popClipRect(): void {
		const buffer = this.activeBuffer;
		buffer.clipDepth -= 1;
		this.queueCommand(Host2DKind.Clip, buffer.clipStack[buffer.clipDepth - 1]);
	}

	/** Snapshot a composed drawing scope; previously submitted commands never alias its next use. */
	public pushTransform(transform: Readonly<HostOverlayTransform>): void {
		const buffer = this.activeBuffer;
		const parent = buffer.transformStack[buffer.transformDepth - 1];
		let composed = buffer.transformPool[buffer.transformCount];
		if (composed === undefined) {
			composed = { scale: 1, offsetX: 0, offsetY: 0 };
			buffer.transformPool.push(composed);
		}
		buffer.transformCount += 1;
		composed.scale = transform.scale * parent.scale;
		composed.offsetX = transform.offsetX * parent.scale + parent.offsetX;
		composed.offsetY = transform.offsetY * parent.scale + parent.offsetY;
		buffer.transformStack[buffer.transformDepth++] = composed;
		this.queueCommand(Host2DKind.Transform, composed);
	}

	public popTransform(): void {
		const buffer = this.activeBuffer;
		buffer.transformDepth -= 1;
		this.queueCommand(Host2DKind.Transform, buffer.transformStack[buffer.transformDepth - 1]);
	}

	/** Translates a retained route into the published buffer, never mutating the source geometry. */
	public polyline(points: readonly number[], x: number, y: number, z: number, thickness: number, color: color, layer: Layer2D): void {
		const buffer = this.activeBuffer;
		let submission = buffer.polyPool[buffer.polyCount];
		if (submission === undefined) {
			submission = { points: [], z: 0, thickness: 1, color: 0, layer };
			buffer.polyPool.push(submission);
		}
		buffer.polyCount += 1;
		const target = submission.points;
		target.length = points.length;
		for (let index = 0; index < points.length; index += 2) {
			target[index] = points[index] + x;
			target[index + 1] = points[index + 1] + y;
		}
		submission.z = z;
		submission.thickness = thickness;
		submission.color = color;
		submission.layer = layer;
		this.queueCommand(Host2DKind.Poly, submission);
	}

	public fillRect(left: number, top: number, right: number, bottom: number, z: number, color: color, layer: Layer2D): void {
		const submission = this.nextRectSubmission();
		submission.kind = RectRenderKind.Fill;
		const area = submission.area;
		area.left = left;
		area.top = top;
		area.right = right;
		area.bottom = bottom;
		area.z = z;
		submission.color = color;
		submission.layer = layer;
		this.queueCommand(Host2DKind.Rect, submission);
	}

	public strokeRect(left: number, top: number, right: number, bottom: number, z: number, color: color, layer: Layer2D): void {
		const submission = this.nextRectSubmission();
		submission.kind = RectRenderKind.Rect;
		const area = submission.area;
		area.left = left;
		area.top = top;
		area.right = right;
		area.bottom = bottom;
		area.z = z;
		submission.color = color;
		submission.layer = layer;
		this.queueCommand(Host2DKind.Rect, submission);
	}

	public spriteColorized(imgid: string, x: number, y: number, z: number, colorize: color, layer: Layer2D): void {
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
		this.queueCommand(Host2DKind.Img, submission);
	}

	public itemRun(items: string | string[], itemStart: number, itemEnd: number, x: number, y: number, z: number, font: BFont, color: color, layer: Layer2D): void {
		const submission = this.nextGlyphSubmission();
		submission.items = items;
		submission.item_start = itemStart;
		submission.item_end = itemEnd;
		submission.x = x;
		submission.y = y;
		submission.z = z;
		submission.font = font;
		submission.color = color;
		submission.has_background_color = false;
		submission.background_color = 0xff000000;
		submission.layer = layer;
		this.queueCommand(Host2DKind.Glyphs, submission);
	}

	private queueCommand(kind: Host2DKind, ref: Host2DRef): void {
		const buffer = this.activeBuffer;
		const index = buffer.commandCount;
		buffer.commandKinds[index] = kind;
		buffer.commandRefs[index] = ref;
		buffer.commandCount = index + 1;
	}

	private nextRectSubmission(): RectRenderSubmission {
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

	private nextImageSubmission(): HostImageRenderSubmission {
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

	private nextGlyphSubmission(): GlyphRenderSubmission {
		const buffer = this.activeBuffer;
		const index = buffer.itemCount;
		buffer.itemCount = index + 1;
		let submission = buffer.itemPool[index];
		if (submission === undefined) {
			submission = createGlyphSubmission();
			buffer.itemPool[index] = submission;
		}
		return submission;
	}

	public endFrame(): void {
		const publishedBuffer = this.activeBuffer;
		if (publishedBuffer.commandCount === 0) {
			this.queue.clearOverlayFrame();
			return;
		}
		this.activeBuffer = this.standbyBuffer;
		this.standbyBuffer = publishedBuffer;
		const frame = publishedBuffer.frame;
		frame.logicalWidth = this.frameLogicalWidth;
		frame.logicalHeight = this.frameLogicalHeight;
		frame.commandCount = publishedBuffer.commandCount;
		this.queue.publishOverlayFrame(frame);
	}

	public abandonFrame(): void {
		this.drawFramePending = false;
		const buffer = this.activeBuffer;
		buffer.commandCount = 0;
		buffer.rectCount = 0;
		buffer.imageCount = 0;
		buffer.itemCount = 0;
		this.queue.clearOverlayFrame();
	}
}
