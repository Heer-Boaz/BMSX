import { $ } from '../core/game';
import type { color, RectRenderSubmission } from '../render/shared/render_types';
import { Msx1Colors } from '../systems/msx';
import { new_area3d } from '../utils/utils';
import { ConsoleFont } from './font';
import type { ConsoleGlyph } from './font';
import { BmsxConsoleInput } from './input';
import { BmsxConsoleStorage } from './storage';
import { BmsxConsoleButton } from './types';

export type BmsxConsoleApiOptions = {
	input: BmsxConsoleInput;
	storage: BmsxConsoleStorage;
};

const DRAW_LAYER: RectRenderSubmission['layer'] = 'ui';

export class BmsxConsoleApi {
	private readonly input: BmsxConsoleInput;
	private readonly storage: BmsxConsoleStorage;
	private readonly font: ConsoleFont;
	private frameIndex: number = 0;
	private deltaSecondsValue: number = 0;

	constructor(options: BmsxConsoleApiOptions) {
		const view = $.view;
		if (!view) {
			throw new Error('[BmsxConsoleApi] Game view not initialised.');
		}
		const viewport = view.viewportSize;
		if (viewport.x <= 0 || viewport.y <= 0) {
			throw new Error('[BmsxConsoleApi] Invalid viewport size.');
		}
		this.input = options.input;
		this.storage = options.storage;
		this.font = new ConsoleFont();
	}

	public beginFrame(frame: number, deltaSeconds: number): void {
		if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
			throw new Error('[BmsxConsoleApi] Delta seconds must be a finite non-negative number.');
		}
		this.frameIndex = frame;
		this.deltaSecondsValue = deltaSeconds;
	}

	public frameNumber(): number {
		return this.frameIndex;
	}

	public deltaSeconds(): number {
		return this.deltaSecondsValue;
	}

	public get displayWidth(): number {
		return $.view.viewportSize.x;
	}

	public get displayHeight(): number {
		return $.view.viewportSize.y;
	}

	public btn(button: BmsxConsoleButton): boolean {
		return this.input.btn(button);
	}

	public btnp(button: BmsxConsoleButton): boolean {
		return this.input.btnp(button);
	}

	public cls(colorIndex: number): void {
		this.rectfill(0, 0, this.displayWidth, this.displayHeight, colorIndex);
	}

	public rect(x0: number, y0: number, x1: number, y1: number, colorIndex: number): void {
		this.submitRectangle(x0, y0, x1, y1, colorIndex, 'rect');
	}

	public rectfill(x0: number, y0: number, x1: number, y1: number, colorIndex: number): void {
		this.submitRectangle(x0, y0, x1, y1, colorIndex, 'fill');
	}

	public print(text: string, x: number, y: number, colorIndex: number): void {
		const colorRef = this.paletteColor(colorIndex);
		let cursorX = Math.floor(x);
		let cursorY = Math.floor(y);
		for (let index = 0; index < text.length; index++) {
			const ch = text.charAt(index);
			if (ch === '\n') {
				cursorX = Math.floor(x);
				cursorY += this.font.lineHeight();
				continue;
			}
			const glyph = this.font.getGlyph(ch);
			this.drawGlyph(glyph, cursorX, cursorY, colorRef);
			cursorX += glyph.advance;
		}
	}

	public cartdata(namespace: string): void {
		this.storage.setNamespace(namespace);
	}

	public dset(index: number, value: number): void {
		this.storage.setValue(index, value);
	}

	public dget(index: number): number {
		return this.storage.getValue(index);
	}

	private drawGlyph(glyph: ConsoleGlyph, originX: number, originY: number, colorRef: color): void {
		for (let i = 0; i < glyph.segments.length; i++) {
			const segment = glyph.segments[i];
			const px = originX + segment.x;
			const py = originY + segment.y;
			this.submitRectangle(px, py, px + segment.length, py + 1, colorRef, 'fill');
		}
	}

	private submitRectangle(x0: number, y0: number, x1: number, y1: number, color: number | color, kind: 'rect' | 'fill'): void {
		const colorObj: color = typeof color === 'number' ? this.paletteColor(color) : color;
		const sx = Math.floor(x0);
		const sy = Math.floor(y0);
		const ex = Math.floor(x1);
		const ey = Math.floor(y1);
		const minX = Math.min(sx, ex);
		const maxX = Math.max(sx, ex);
		const minY = Math.min(sy, ey);
		const maxY = Math.max(sy, ey);
		const width = maxX - minX;
		const height = maxY - minY;
		if (width === 0 || height === 0) {
			throw new Error('[BmsxConsoleApi] Rectangles must span at least one pixel in width and height.');
		}
		const area = new_area3d(minX, minY, 0, maxX, maxY, 0);
		$.view.renderer.submit.rect({ kind, area, color: colorObj, layer: DRAW_LAYER });
	}

	private paletteColor(index: number): color {
		if (!Number.isInteger(index)) {
			throw new Error('[BmsxConsoleApi] Color index must be an integer.');
		}
		if (index < 0 || index >= Msx1Colors.length) {
			throw new Error(`[BmsxConsoleApi] Color index ${index} outside palette range 0-${Msx1Colors.length - 1}.`);
		}
		return Msx1Colors[index];
	}
}
