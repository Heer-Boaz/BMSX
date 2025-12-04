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
import { new_vec3, new_vec2 } from '../utils/vector_operations';
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
			if ('layer' in submission) {
				const layer = (submission as { layer?: RenderLayer }).layer;
				if (layer === 'editor' || layer === 'overlay') {
					continue;
				}
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
		let targetSize: Viewport;
		switch (type) {
			case 'viewport':
				targetSize = { width: $.view.viewportSize.x, height: $.view.viewportSize.y };
				break;
			case 'offscreen':
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
		(submission as any).type = 'rect';
		this.submit(submission);
	}

	public glyphs(command: GlyphRenderSubmission): void {
		if (command.z === undefined) {
			command.z = ConsoleRenderFacade.SPRITE_Z;
		}
		const submission = command as GlyphSubmission;
		(submission as any).type = 'glyphs';
		this.submit(submission);
	}

	public sprite(command: ImgRenderSubmission): void {
		if (command.pos.z === undefined) {
			command.pos.z = ConsoleRenderFacade.SPRITE_Z;
		}
		const submission = command as ImgSubmission;
		(submission as any).type = 'img';
		this.submit(submission);
	}

	public poly(command: PolyRenderSubmission): void {
		const submission = command as PolySubmission;
		(submission as any).type = 'poly';
		this.submit(submission);
	}

	public mesh(command: MeshRenderSubmission): void {
		const submission = command as RenderSubmission;
		(submission as any).type = 'mesh';
		this.submit(submission);
	}

	public particle(command: ParticleRenderSubmission): void {
		const submission = command as RenderSubmission;
		(submission as any).type = 'particle';
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

function scaleRect(cmd: RectSubmission, scaleX: number, scaleY: number): RectSubmission {
	cmd.area.start.x *= scaleX;
	cmd.area.start.y *= scaleY;
	cmd.area.end.x *= scaleX;
	cmd.area.end.y *= scaleY;
	if (cmd.layer === undefined) cmd.layer = 'world';
	return cmd;
}

function scaleSprite(cmd: ImgSubmission, scaleX: number, scaleY: number): ImgSubmission {
	const scale = cmd.scale ?? { x: 1, y: 1 };
	cmd.pos = new_vec3(cmd.pos.x * scaleX, cmd.pos.y * scaleY, cmd.pos.z!);
	cmd.scale = new_vec2(scale.x * scaleX, scale.y * scaleY);
	if (cmd.layer === undefined) cmd.layer = 'world';
	return cmd;
}

function scaleGlyphs(cmd: GlyphSubmission, scaleX: number, scaleY: number): GlyphSubmission {
	cmd.x *= scaleX;
	cmd.y *= scaleY;
	if (cmd.center_block_width != null) cmd.center_block_width *= scaleX;
	if (cmd.layer === undefined) cmd.layer = 'world';
	return cmd;
}

function scalePoly(cmd: PolySubmission, scaleX: number, scaleY: number): PolySubmission {
	for (let i = 0; i < cmd.points.length; i += 2) {
		cmd.points[i] *= scaleX;
		cmd.points[i + 1] *= scaleY;
	}
	if (cmd.layer === undefined) cmd.layer = 'world';
	return cmd;
}

export function drainOverlayFrameIntoSpriteQueue(logicalWidth: number, logicalHeight: number): void {
	const frame: EditorOverlayFrame = consumeOverlayFrame();
	if (!frame) return;
	const captureWidth = frame.width > 0 ? frame.width : logicalWidth;
	const captureHeight = frame.height > 0 ? frame.height : logicalHeight;
	const scaleX = captureWidth > 0 ? logicalWidth / captureWidth : 1;
	const scaleY = captureHeight > 0 ? logicalHeight / captureHeight : 1;
	for (const command of frame.commands) {
		switch (command.type) {
			case 'rect':
				$.view.renderer.submit.typed(scaleRect(command, scaleX, scaleY));
				break;
			case 'img':
				$.view.renderer.submit.typed(scaleSprite(command, scaleX, scaleY));
				break;
			case 'glyphs':
				$.view.renderer.submit.typed(scaleGlyphs(command, scaleX, scaleY));
				break;
			case 'poly':
				$.view.renderer.submit.typed(scalePoly(command, scaleX, scaleY));
				break;
			default:
				$.view.renderer.submit.typed(command);
				break;
		}
	}
}
