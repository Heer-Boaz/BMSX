import type { color, ImgRenderSubmission, RectRenderSubmission, RenderLayer } from '../render/shared/render_types';
import type { ConsoleFont } from './font';
import { renderGlyphs } from '../render/glyphs';
import { $ } from '../core/game';
import { consumeOverlayFrame, publishOverlayFrame, type EditorOverlayFrame, type OverlayCommand } from '../render/editor/editor_overlay_queue';
import { new_vec3, new_vec2 } from '../utils/vector_operations';

export type RectCommand = {
	kind: 'rect' | 'fill';
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	color: color;
	layer?: RenderLayer;
};

export type PrintCommand = {
	kind: 'print';
	text: string;
	x: number;
	y: number;
	color: color;
};

export type SpriteCommand = {
	kind: 'sprite';
	imgId: string;
	spriteIndex: number | null;
	originX: number;
	originY: number;
	baseX: number;
	baseY: number;
	drawX: number;
	drawY: number;
	scale: number;
	layer?: RenderLayer;
	flipH: boolean;
	flipV: boolean;
	spriteId: string | null;
	instanceId: string;
	width: number;
	height: number;
	positionDirty: boolean;
	colorize?: color;
};

export interface AbstractRenderBackend {
	drawRect(command: RectCommand): void;
	drawText(command: PrintCommand, font: ConsoleFont): void;
	drawSprite(command: SpriteCommand): void;
}

export class DirectConsoleRenderBackend implements AbstractRenderBackend {
	public drawRect(command: RectCommand): void {
		const layer = command.layer ?? 'ui';
		$.view.renderer.submit.rect({
			kind: command.kind,
			area: { start: { x: command.x0, y: command.y0 }, end: { x: command.x1, y: command.y1 } },
			color: command.color,
			layer,
		});
	}

	public drawText(command: PrintCommand, font: ConsoleFont): void {
		renderGlyphs(command.x, command.y, command.text, 0, font, command.color, undefined, 'ui');
	}

	public drawSprite(command: SpriteCommand): void {
		$.view.renderer.submit.sprite({
			imgid: command.imgId,
			pos: { x: command.baseX, y: command.baseY, z: 0 },
			scale: { x: command.scale, y: command.scale },
			flip: command.flipH || command.flipV ? { flip_h: command.flipH, flip_v: command.flipV } : undefined,
			layer: command.layer ?? 'ui',
			colorize: command.colorize ? { ...command.colorize } : undefined,
		});
	}
}

export class EditorConsoleRenderBackend implements AbstractRenderBackend {
	private readonly commands: OverlayCommand[] = [];
	private frameLogicalWidth = 0;
	private frameLogicalHeight = 0;
	private frameRenderWidth = 0;
	private frameRenderHeight = 0;
	private overrideSize: { width: number; height: number } | null = null;
	private static readonly RECT_Z = 0;
	private static readonly SPRITE_Z = 0;

	public setFrameOverride(size: { width: number; height: number } | null): void {
		this.overrideSize = size ? { width: size.width, height: size.height } : null;
	}

	public beginFrame(): void {
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

	public drawRect(command: RectCommand): void {
		const rect: RectRenderSubmission = {
			kind: command.kind,
			area: {
				start: { x: command.x0, y: command.y0, z: EditorConsoleRenderBackend.RECT_Z },
				end: { x: command.x1, y: command.y1, z: EditorConsoleRenderBackend.RECT_Z },
			},
			color: { ...command.color },
			layer: command.layer ?? 'editor',
		};
		this.commands.push(rect);
	}

	public drawText(command: PrintCommand, font: ConsoleFont): void {
		let cursorX = command.x;
		let cursorY = command.y;
		for (let i = 0; i < command.text.length; i++) {
			const ch = command.text.charAt(i);
			if (ch === '\n') {
				cursorX = command.x;
				cursorY += font.lineHeight();
				continue;
			}
			const imgId = font.char_to_img(ch);
			const advance = font.char_width(ch);
			const sprite: ImgRenderSubmission = {
				imgid: imgId,
				pos: { x: cursorX, y: cursorY, z: EditorConsoleRenderBackend.SPRITE_Z },
				scale: { x: 1, y: 1 },
				flip: undefined,
				colorize: { ...command.color },
				layer: 'editor',
			};
			this.commands.push(sprite);
			cursorX += advance;
		}
	}

	public drawSprite(command: SpriteCommand): void {
		const sprite: ImgRenderSubmission = {
			imgid: command.imgId,
			pos: { x: command.baseX, y: command.baseY, z: EditorConsoleRenderBackend.SPRITE_Z },
			scale: { x: command.scale, y: command.scale },
			flip: command.flipH || command.flipV ? { flip_h: command.flipH, flip_v: command.flipV } : undefined,
			colorize: command.colorize ? { ...command.colorize } : undefined,
			layer: command.layer ?? 'editor',
		};
		this.commands.push(sprite);
	}

	public endFrame(): void {
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
			commands: this.commands.map(cmd => {
				if ('area' in cmd) {
					return {
						...cmd,
						color: { ...cmd.color },
						area: {
							start: { ...cmd.area.start },
							end: { ...cmd.area.end },
						},
					} as RectRenderSubmission;
				}
				return {
					...cmd,
					pos: { ...cmd.pos },
					scale: cmd.scale ? { ...cmd.scale } : undefined,
					flip: cmd.flip ? { ...cmd.flip } : undefined,
					colorize: cmd.colorize ? { ...cmd.colorize } : undefined,
				} as ImgRenderSubmission;
			}),
		};
		publishOverlayFrame(frame);
	}
}

function submitRect(cmd: RectRenderSubmission, scaleX: number, scaleY: number): void {
	const submission: RectRenderSubmission = {
		kind: cmd.kind,
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
		color: cmd.color,
		layer: cmd.layer ?? 'editor',
	};
	$.view.renderer.submit.rect(submission);
}

function submitSprite(cmd: ImgRenderSubmission, scaleX: number, scaleY: number): void {
	const scale = cmd.scale ?? { x: 1, y: 1 };
	$.view.renderer.submit.sprite({
		...cmd,
		pos: new_vec3(cmd.pos.x * scaleX, cmd.pos.y * scaleY, cmd.pos.z!),
		scale: new_vec2(scale.x * scaleX, scale.y * scaleY),
		layer: cmd.layer ?? 'editor',
	});
}

export function drainOverlayFrameIntoSpriteQueue(_renderWidth: number, _renderHeight: number, logicalWidth: number, logicalHeight: number): void {
	const frame: EditorOverlayFrame | null = consumeOverlayFrame();
	if (!frame) return;
	const captureWidth = frame.width > 0 ? frame.width : logicalWidth;
	const captureHeight = frame.height > 0 ? frame.height : logicalHeight;
	const scaleX = captureWidth > 0 ? logicalWidth / captureWidth : 1;
	const scaleY = captureHeight > 0 ? logicalHeight / captureHeight : 1;
	for (const command of frame.commands) {
		if ('area' in command) {
			submitRect(command as RectRenderSubmission, scaleX, scaleY);
		} else {
			submitSprite(command as ImgRenderSubmission, scaleX, scaleY);
		}
	}
}
