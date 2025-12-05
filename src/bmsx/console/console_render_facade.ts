import type {
	GlyphRenderSubmission,
	ImgRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	RenderLayer
} from '../render/shared/render_types';
import { $ } from '../core/game';
import { consumeOverlayFrame, publishOverlayFrame, type EditorOverlayFrame } from '../render/editor/editor_overlay_queue';
import type { Viewport } from '../rompack/rompack';
import type { RenderSubmission } from '../render/gameview';

export type ConsoleRenderCommand = RenderSubmission;
type RectSubmission = Extract<RenderSubmission, { type: 'rect' }>;
type ImgSubmission = Extract<RenderSubmission, { type: 'img' }>;
type GlyphSubmission = Extract<RenderSubmission, { type: 'glyphs' }>;
type PolySubmission = Extract<RenderSubmission, { type: 'poly' }>;

export class ConsoleRenderFacade {
	private defaultLayer: RenderLayer = 'world';

	public playbackRenderQueue(preservedRenderQueue: RenderSubmission[]) {
		for (let i = 0; i < preservedRenderQueue.length; i++) {
			const submission = preservedRenderQueue[i];
			if (submission.layer === 'ide') {
				continue;
			}
			$.view.renderer.submit.typed(submission);
		}
	}

	public captureCurrentFrameRenderQueue(): RenderSubmission[] {
		// Preserve the current frame's submissions so they can be replayed under overlays.
		// We rely on playback to skip editor/overlay layers so we don't duplicate UI layers.
		return this.commands;
	}

	private commands: ConsoleRenderCommand[] = [];
	private frameLogicalWidth = 0;
	private frameLogicalHeight = 0;
	private frameRenderWidth = 0;
	private frameRenderHeight = 0;
	private overrideSize: Viewport = null;
	private capturingFrame = false;
	private static readonly RECT_Z = 0;
	private static readonly SPRITE_Z = 0;

	public setRenderingViewportType(type: 'viewport' | 'offscreen'): void {
		// let targetSize: Viewport;
		switch (type) {
			case 'viewport':
				$.view.viewportTypeIde = 'viewport';
				// targetSize = { width: $.view.viewportSize.x, height: $.view.viewportSize.y };
				break;
			case 'offscreen':
				$.view.viewportTypeIde = 'offscreen';
			default:
				// targetSize = { width: $.view.offscreenCanvasSize.x, height: $.view.offscreenCanvasSize.y };
				break;
		}
		// this.overrideSize = targetSize;
	}

	public get viewportSize(): Viewport {
		return this.overrideSize;
	}

	public beginFrame(): void {
		this.capturingFrame = true;
		this.defaultLayer = 'world';
		this.commands = [];
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
		if (area.start.z === undefined) area.start.z = ConsoleRenderFacade.RECT_Z;
		if (area.end.z === undefined) area.end.z = ConsoleRenderFacade.RECT_Z;
		const submission = command as RectSubmission;
		submission.type = 'rect';
		this.submit(submission);
	}

	public glyphs(command: GlyphRenderSubmission): void {
		if (command.z === undefined) {
			command.z = ConsoleRenderFacade.SPRITE_Z;
		}
		const submission = command as GlyphSubmission;
		submission.type = 'glyphs';
		this.submit(submission);
	}

	public sprite(command: ImgRenderSubmission): void {
		if (command.pos.z === undefined) {
			command.pos.z = ConsoleRenderFacade.SPRITE_Z;
		}
		const submission = command as ImgSubmission;
		submission.type = 'img';
		this.submit(submission);
	}

	public poly(command: PolyRenderSubmission): void {
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
		this.applyDefaultLayer(submission);
		if (!this.capturingFrame) {
			$.view.renderer.submit.typed(submission);
			return;
		}
		this.commands.push(submission);
	}

	private applyDefaultLayer(submission: RenderSubmission): void {
		switch (submission.type) {
			case 'rect':
			case 'img':
			case 'glyphs':
			case 'poly': {
				if (submission.layer === undefined) {
					submission.layer = this.defaultLayer;
				}
				return;
			}
			default:
				return;
		}
	}

	public endFrame(): void {
		this.capturingFrame = false;
		if (this.commands.length === 0) {
			publishOverlayFrame(null);
			return;
		}
		const frame: EditorOverlayFrame = {
			width: this.frameRenderWidth,
			height: this.frameRenderHeight,
			logicalWidth: this.frameLogicalWidth,
			logicalHeight: this.frameLogicalHeight,
			renderWidth: this.frameRenderWidth,
			renderHeight: this.frameRenderHeight,
			commands: [...this.commands],
		};
		publishOverlayFrame(frame);
	}
}

export function drainOverlayFrameIntoSpriteQueue(): void {
	const frame: EditorOverlayFrame = consumeOverlayFrame();
	if (!frame) return;
	for (const command of frame.commands) {
		$.view.renderer.submit.typed(command);
	}
}
