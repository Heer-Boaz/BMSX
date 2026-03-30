import type {
	GlyphRenderSubmission,
	ImgRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	RenderLayer
} from '../render/shared/render_types';
import { $ } from '../core/engine_core';
import { publishOverlayFrame, type EditorOverlayFrame } from '../render/editor/editor_overlay_queue';
import type { Viewport } from '../rompack/rompack';
import { RenderSubmission } from '../render/backend/pipeline_interfaces';

export type RenderCommand = RenderSubmission;
type RectSubmission = Extract<RenderSubmission, { type: 'rect' }>;
type ImgSubmission = Extract<RenderSubmission, { type: 'img' }>;
type GlyphSubmission = Extract<RenderSubmission, { type: 'glyphs' }>;
type PolySubmission = Extract<RenderSubmission, { type: 'poly' }>;

export class OverlayRenderer {
	private defaultLayer: RenderLayer = 'world';

	private commands: RenderCommand[] = [];
	private commandBuffer: RenderCommand[] = [];
	private frameLogicalWidth = 0;
	private frameLogicalHeight = 0;
	private frameRenderWidth = 0;
	private frameRenderHeight = 0;
	private overrideSize: Viewport = null;
	private capturingFrame = false;
	private static readonly RECT_Z = 0;
	private static readonly SPRITE_Z = 0;

	public setRenderingViewportType(type: 'viewport' | 'offscreen'): void {
		let targetSize: Viewport;
		switch (type) {
			case 'viewport':
				$.view.viewportTypeIde = 'viewport';
				targetSize = { width: $.view.viewportSize.x, height: $.view.viewportSize.y };
				break;
			case 'offscreen':
				$.view.viewportTypeIde = 'offscreen';
			default:
				targetSize = { width: $.view.offscreenCanvasSize.x, height: $.view.offscreenCanvasSize.y };
				break;
		}
		this.overrideSize = targetSize;
	}

	public get viewportSize(): Viewport {
		return this.overrideSize;
	}

	public beginFrame(): void {
		this.capturingFrame = true;
		const view = $.view;
		const offscreen = view.offscreenCanvasSize;
		const logical = view.viewportSize;
		const renderWidth = this.overrideSize ? this.overrideSize.width : offscreen.x;
		const renderHeight = this.overrideSize ? this.overrideSize.height : offscreen.y;
		this.frameLogicalWidth = logical.x;
		this.frameLogicalHeight = logical.y;
		this.frameRenderWidth = renderWidth;
		this.frameRenderHeight = renderHeight;
		this.commands.length = 0;
	}

	public setDefaultLayer(layer: RenderLayer): void {
		this.defaultLayer = layer;
	}

	public rect(command: RectRenderSubmission): void {
		const area = command.area;
		if (area.z === undefined) area.z = OverlayRenderer.RECT_Z;
		if (command.layer === undefined) {
			command.layer = this.defaultLayer;
		}
		const submission = command as RectSubmission;
		submission.type = 'rect';
		this.submit(submission);
	}

	public glyphs(command: GlyphRenderSubmission): void {
		if (command.z === undefined) {
			command.z = OverlayRenderer.SPRITE_Z;
		}
		if (command.glyph_start === undefined) {
			command.glyph_start = 0;
		}
		if (command.glyph_end === undefined) {
			command.glyph_end = Number.MAX_SAFE_INTEGER;
		}
		if (command.layer === undefined) {
			command.layer = this.defaultLayer;
		}
		const submission = command as GlyphSubmission;
		submission.type = 'glyphs';
		this.submit(submission);
	}

	public sprite(command: ImgRenderSubmission): void {
		if (command.pos.z === undefined) {
			command.pos.z = OverlayRenderer.SPRITE_Z;
		}
		if (command.scale === undefined) {
			command.scale = { x: 1, y: 1 };
		}
		if (command.flip === undefined) {
			command.flip = { flip_h: false, flip_v: false };
		}
		if (command.colorize === undefined) {
			command.colorize = { r: 1, g: 1, b: 1, a: 1 };
		}
		if (command.layer === undefined) {
			command.layer = this.defaultLayer;
		}
		const submission = command as ImgSubmission;
		submission.type = 'img';
		this.submit(submission);
	}

	public poly(command: PolyRenderSubmission): void {
		if (command.thickness === undefined) {
			command.thickness = 1;
		}
		if (command.layer === undefined) {
			command.layer = this.defaultLayer;
		}
		const submission = command as PolySubmission;
		submission.type = 'poly';
		this.submit(submission);
	}

	public mesh(command: MeshRenderSubmission): void {
		const submission = command as RenderSubmission;
		submission.type = 'mesh';
		this.submit(submission);
	}

	public particle(command: ParticleRenderSubmission): void {
		const submission = command as RenderSubmission;
		submission.type = 'particle';
		this.submit(submission);
	}

	private submit(submission: RenderSubmission): void {
		if (!this.capturingFrame) {
			$.view.renderer.submit.typed(submission);
			return;
		}
		this.commands.push(submission);
	}

	public endFrame(): void {
		this.capturingFrame = false;
		if (this.commands.length === 0) {
			publishOverlayFrame(null);
			return;
		}
		const frameCommands = this.commands;
		this.commands = this.commandBuffer;
		this.commandBuffer = frameCommands;
		const frame: EditorOverlayFrame = {
			width: this.frameRenderWidth,
			height: this.frameRenderHeight,
			logicalWidth: this.frameLogicalWidth,
			logicalHeight: this.frameLogicalHeight,
			renderWidth: this.frameRenderWidth,
			renderHeight: this.frameRenderHeight,
			commands: frameCommands,
		};
		publishOverlayFrame(frame);
	}

	public abandonFrame(): void {
		this.capturingFrame = false;
		this.commands.length = 0;
	}
}
