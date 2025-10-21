import type { color, RenderLayer } from '../render/shared/render_types';
import type { ConsoleFont } from './font';
import { renderGlyphs } from '../render/glyphs';
import { $ } from '../core/game';
import { publishOverlayFrame, type EditorOverlayFrame, type OverlayCommand } from '../render/editor/editor_overlay_queue';

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
	colliderId: string;
	width: number;
	height: number;
	positionDirty: boolean;
	colorize?: color;
};

export interface ConsoleRenderBackend {
	beginFrame(): void;
	drawRect(command: RectCommand): void;
	drawText(command: PrintCommand, font: ConsoleFont): void;
	drawSprite(command: SpriteCommand): void;
	endFrame(): void;
}

export class DirectConsoleRenderBackend implements ConsoleRenderBackend {
	public beginFrame(): void {}

	public drawRect(command: RectCommand): void {
		const layer = command.layer ?? 'ui';
		const x0 = Math.floor(command.x0);
		const y0 = Math.floor(command.y0);
		const x1 = Math.floor(command.x1);
		const y1 = Math.floor(command.y1);
		$.view.renderer.submit.rect({
			kind: command.kind,
			area: { start: { x: x0, y: y0 }, end: { x: x1, y: y1 } },
			color: command.color,
			layer,
		});
	}

	public drawText(command: PrintCommand, font: ConsoleFont): void {
		renderGlyphs(command.x, command.y, command.text, 950, font, command.color, undefined, 'ui');
	}

	public drawSprite(command: SpriteCommand): void {
		const posX = Math.floor(command.baseX);
		const posY = Math.floor(command.baseY);
		$.view.renderer.submit.sprite({
			imgid: command.imgId,
			pos: { x: posX, y: posY, z: 0 },
			scale: { x: command.scale, y: command.scale },
			flip: command.flipH || command.flipV ? { flip_h: command.flipH, flip_v: command.flipV } : undefined,
			layer: command.layer ?? 'ui',
			colorize: command.colorize ? { ...command.colorize } : undefined,
		});
	}

	public endFrame(): void {}
}

export class EditorConsoleRenderBackend implements ConsoleRenderBackend {
	private readonly commands: OverlayCommand[] = [];
	private frameWidth = 0;
	private frameHeight = 0;

	public beginFrame(): void {
		const view = $.view;
		if (!view) {
			throw new Error('[EditorConsoleRenderBackend] Game view unavailable during editor overlay capture.');
		}
		const offscreen = view.offscreenCanvasSize;
		if (!Number.isFinite(offscreen.x) || !Number.isFinite(offscreen.y) || offscreen.x <= 0 || offscreen.y <= 0) {
			throw new Error('[EditorConsoleRenderBackend] Invalid offscreen dimensions.');
		}
		this.frameWidth = offscreen.x;
		this.frameHeight = offscreen.y;
		this.commands.length = 0;
	}

	public drawRect(command: RectCommand): void {
		this.commands.push({
			type: 'rect',
			kind: command.kind,
			x0: command.x0,
			y0: command.y0,
			x1: command.x1,
			y1: command.y1,
			color: { ...command.color },
		});
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
			this.commands.push({
				type: 'sprite',
				imgId,
				x: cursorX,
				y: cursorY,
				scaleX: 1,
				scaleY: 1,
				flipH: false,
				flipV: false,
				color: { ...command.color },
			});
			cursorX += advance;
		}
	}

	public drawSprite(command: SpriteCommand): void {
		const color = command.colorize ? { ...command.colorize } : null;
		this.commands.push({
			type: 'sprite',
			imgId: command.imgId,
			x: command.baseX,
			y: command.baseY,
			scaleX: command.scale,
			scaleY: command.scale,
			flipH: command.flipH,
			flipV: command.flipV,
			color,
		});
	}

	public endFrame(): void {
		if (this.commands.length === 0) {
			publishOverlayFrame(null);
			return;
		}
		const frame: EditorOverlayFrame = {
			width: this.frameWidth,
			height: this.frameHeight,
			commands: this.commands.map(cmd => {
				if (cmd.type === 'rect') {
					return { ...cmd, color: { ...cmd.color } };
				}
				return { ...cmd, color: cmd.color ? { ...cmd.color } : null };
			}),
		};
		publishOverlayFrame(frame);
	}
}
