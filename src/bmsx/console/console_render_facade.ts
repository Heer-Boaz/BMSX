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
		preservedRenderQueue.forEach(s => $.view.renderer.submit.typed(s));
	}

	public captureCurrentFrameRenderQueue(): RenderSubmission[] {
		// Preserve the current frame's submissions so they can be replayed under overlays.
		// We capture world/ui layers and ignore editor/overlay layers so that
		// console/editor UI can continue rendering on top of the frozen game.
		return this.commands
			.filter(cmd => {
				if (!('layer' in cmd)) return true;
				const layer = this.resolveLayer((cmd as { layer?: RenderLayer }).layer);
				return layer !== 'editor' && layer !== 'overlay';
			})
			.map(cmd => this.cloneSubmission(cmd));
	}

	private readonly commands: ConsoleRenderCommand[] = [];
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
		const submission: RectSubmission = {
			type: 'rect',
			kind: command.kind,
			area: {
				start: { ...command.area.start, z: command.area.start.z ?? ConsoleRenderFacade.RECT_Z },
				end: { ...command.area.end, z: command.area.end.z ?? ConsoleRenderFacade.RECT_Z },
			},
			color: { ...command.color },
			layer: command.layer,
		};
		this.submit(submission);
	}

	public glyphs(command: GlyphRenderSubmission): void {
		const submission: GlyphSubmission = {
			type: 'glyphs',
			glyphs: command.glyphs,
			x: command.x,
			y: command.y,
			z: command.z ?? ConsoleRenderFacade.SPRITE_Z,
			font: command.font,
			color: command.color,
			background_color: command.background_color,
			wrap_chars: command.wrap_chars,
			center_block_width: command.center_block_width,
			align: command.align,
			baseline: command.baseline,
			layer: command.layer,
		};
		this.submit(submission);
	}

	public sprite(command: ImgRenderSubmission): void {
		const submission: ImgSubmission = {
			type: 'img',
			imgid: command.imgid,
			pos: { ...command.pos, z: command.pos.z ?? ConsoleRenderFacade.SPRITE_Z },
			scale: command.scale ? { ...command.scale } : undefined,
			flip: command.flip ? { ...command.flip } : undefined,
			colorize: command.colorize ? { ...command.colorize } : undefined,
			ambient_affected: command.ambient_affected,
			ambient_factor: command.ambient_factor,
			layer: command.layer,
		};
		this.submit(submission);
	}

	public poly(command: PolyRenderSubmission): void {
		const submission: PolySubmission = {
			type: 'poly',
			points: [...command.points],
			z: command.z,
			color: { ...command.color },
			thickness: command.thickness,
			layer: command.layer,
		};
		this.submit(submission);
	}

	public mesh(command: MeshRenderSubmission): void {
		const submission: RenderSubmission = {
			type: 'mesh',
			mesh: command.mesh,
			matrix: command.matrix,
			joint_matrices: command.joint_matrices,
			morph_weights: command.morph_weights,
			receive_shadow: command.receive_shadow,
		};
		this.submit(submission);
	}

	public particle(command: ParticleRenderSubmission): void {
		const submission: RenderSubmission = {
			type: 'particle',
			position: command.position,
			size: command.size,
			color: { ...command.color },
			texture: command.texture,
			ambient_mode: command.ambient_mode,
			ambient_factor: command.ambient_factor,
		};
		this.submit(submission);
	}

	private submit(submission: RenderSubmission): void {
		const resolvedLayer = this.applyDefaultLayer(submission);
		if (!this.capturingFrame) {
			$.view.renderer.submit.typed(resolvedLayer);
			return;
		}
		this.commands.push(this.cloneSubmission(resolvedLayer));
	}

	private applyDefaultLayer(submission: RenderSubmission): RenderSubmission {
		switch (submission.type) {
			case 'rect':
			case 'img':
			case 'glyphs':
			case 'poly': {
				const layer = this.resolveLayer(submission.layer);
				return { ...submission, layer };
			}
			default:
				return submission;
		}
	}

	private resolveLayer(layer?: RenderLayer): RenderLayer {
		return layer ?? this.defaultLayer;
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
			commands: this.commands.map(cmd => this.cloneSubmission(cmd)),
		};
		publishOverlayFrame(frame);
	}


	private cloneSubmission(submission: RenderSubmission): RenderSubmission {
		switch (submission.type) {
			case 'rect':
				return {
					type: 'rect',
					kind: submission.kind,
					area: {
						start: { ...submission.area.start },
						end: { ...submission.area.end },
					},
					color: { ...submission.color },
					layer: submission.layer,
				};
			case 'img':
				return {
					type: 'img',
					imgid: submission.imgid,
					pos: { ...submission.pos },
					scale: submission.scale ? { ...submission.scale } : undefined,
					flip: submission.flip ? { ...submission.flip } : undefined,
					colorize: submission.colorize ? { ...submission.colorize } : undefined,
					ambient_affected: submission.ambient_affected,
					ambient_factor: submission.ambient_factor,
					layer: submission.layer,
				};
			case 'glyphs':
				return {
					type: 'glyphs',
					glyphs: Array.isArray(submission.glyphs) ? [...submission.glyphs] : submission.glyphs,
					x: submission.x,
					y: submission.y,
					z: submission.z,
					font: submission.font,
					color: submission.color ? { ...submission.color } : undefined,
					background_color: submission.background_color ? { ...submission.background_color } : undefined,
					wrap_chars: submission.wrap_chars,
					center_block_width: submission.center_block_width,
					align: submission.align,
					baseline: submission.baseline,
					layer: submission.layer,
				};
			case 'poly':
				return {
					type: 'poly',
					points: [...submission.points],
					z: submission.z,
					color: { ...submission.color },
					thickness: submission.thickness,
					layer: submission.layer,
				};
			case 'mesh':
				return {
					type: 'mesh',
					mesh: submission.mesh,
					matrix: submission.matrix,
					joint_matrices: submission.joint_matrices,
					morph_weights: submission.morph_weights,
					receive_shadow: submission.receive_shadow,
				};
			case 'particle':
				return {
					type: 'particle',
					position: submission.position,
					size: submission.size,
					color: { ...submission.color },
					texture: submission.texture,
					ambient_mode: submission.ambient_mode,
					ambient_factor: submission.ambient_factor,
				};
			default:
				throw new Error(`ConsoleRenderFacade.cloneSubmission: Unsupported submission type '${(submission as any).type}'`);
		}
	}
}

function scaleRect(cmd: RectSubmission, scaleX: number, scaleY: number): RectSubmission {
	return {
		...cmd,
		area: {
			start: {
				x: cmd.area.start.x * scaleX,
				y: cmd.area.start.y * scaleY,
				z: cmd.area.start.z!,
			},
			end: {
				x: cmd.area.end.x * scaleX,
				y: cmd.area.end.y * scaleY,
				z: cmd.area.end.z!,
			},
		},
		layer: cmd.layer ?? 'world',
	};
}

function scaleSprite(cmd: ImgSubmission, scaleX: number, scaleY: number): ImgSubmission {
	const scale = cmd.scale ?? { x: 1, y: 1 };
	return {
		...cmd,
		pos: new_vec3(cmd.pos.x * scaleX, cmd.pos.y * scaleY, cmd.pos.z!),
		scale: new_vec2(scale.x * scaleX, scale.y * scaleY),
		layer: cmd.layer ?? 'world',
	};
}

function scaleGlyphs(cmd: GlyphSubmission, scaleX: number, scaleY: number): GlyphSubmission {
	return {
		...cmd,
		x: cmd.x * scaleX,
		y: cmd.y * scaleY,
		center_block_width: cmd.center_block_width != null ? cmd.center_block_width * scaleX : cmd.center_block_width,
		layer: cmd.layer ?? 'world',
	};
}

function scalePoly(cmd: PolySubmission, scaleX: number, scaleY: number): PolySubmission {
	const points = cmd.points.map((value, index) => (index % 2 === 0 ? value * scaleX : value * scaleY));
	return {
		...cmd,
		points,
		layer: cmd.layer ?? 'world',
	};
}

export function drainOverlayFrameIntoSpriteQueue(_renderWidth: number, _renderHeight: number, logicalWidth: number, logicalHeight: number): void {
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
