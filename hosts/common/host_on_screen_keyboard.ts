import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import {
	RectRenderKind,
	type GlyphRenderSubmission,
	type RectRenderSubmission,
} from '../../machine/ts/render/shared/submissions';
import { Host2DKind, type Host2DRef } from '../../machine/ts/render/host_overlay/commands';
import type { HostMenuFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { point_in_rect } from '../../machine/ts/common/rect';
import { OnScreenKeyboard } from './input/on_screen_keyboard';
import { ON_SCREEN_KEYBOARD_TARGET_COUNT, ON_SCREEN_KEY_INDEX_BY_CODE } from './input/on_screen_keyboard_keys';

const TITLES = ['KEYBOARD: TEXT', 'KEYBOARD: SYMBOLS', 'KEYBOARD: FN'] as const;
const HELP_LINES = [
	'A PRESS  B SPACE  X BKSP  Y SHIFT',
	'L/R CURSOR  LT/RT HOME/END',
	'START ENTER  SEL+B DEL  SEL+Y PAGE',
	'SEL+X CLOSE  SEL+L/R HOME/END',
] as const;
const UNIT_WIDTH = 13;
const KEY_GAP = 1;
const ROW_GAP = 2;
const PANEL_PADDING = 4;
const TITLE_GAP = 3;
const HELP_GAP = 3;
const HELP_LINE_GAP = 1;
const COLOR_PANEL = 0x60465264;
const COLOR_KEY = 0x80bccbdb;
const COLOR_KEY_SELECTED = 0xff7eb4d9;
const COLOR_KEY_PRESSED = 0xffffe09a;
const COLOR_SHADOW = 0xff080c12;
const COLOR_TEXT = 0xffefefef;
const COLOR_DIM = 0xffb2b2b2;
const COLOR_TITLE = 0xff5bc6ff;
const COMMAND_COUNT = 3 + ON_SCREEN_KEYBOARD_TARGET_COUNT * 3 + HELP_LINES.length * 2;

/** Bitmap presentation of an explicitly owned keyboard model. */
export class HostOnScreenKeyboard {
	private readonly panelRect: RectRenderSubmission = {
		kind: RectRenderKind.Rect,
		area: { left: 0, top: 0, right: 1, bottom: 1, z: 920 },
		color: COLOR_PANEL,
		layer: LAYER_2D_IDE,
	};
	private readonly titleGlyphs: GlyphRenderSubmission = {
		x: 0, y: 0, z: 922, items: TITLES[0], item_start: 0, item_end: TITLES[0].length,
		font: null, color: COLOR_TITLE, has_background_color: false,
		background_color: 0xff000000,
		layer: LAYER_2D_IDE,
	};
	private readonly titleShadow: GlyphRenderSubmission = { ...this.titleGlyphs, color: COLOR_SHADOW, z: 921 };
	private readonly helpGlyphs = new Array<GlyphRenderSubmission>(HELP_LINES.length);
	private readonly helpShadows = new Array<GlyphRenderSubmission>(HELP_LINES.length);
	private readonly keyRects = new Array<RectRenderSubmission>(ON_SCREEN_KEYBOARD_TARGET_COUNT);
	private readonly keyGlyphs = new Array<GlyphRenderSubmission>(ON_SCREEN_KEYBOARD_TARGET_COUNT);
	private readonly keyShadows = new Array<GlyphRenderSubmission>(ON_SCREEN_KEYBOARD_TARGET_COUNT);
	private readonly commandKinds = new Array<Host2DKind>(COMMAND_COUNT);
	private readonly commandRefs = new Array<Host2DRef>(COMMAND_COUNT);
	private readonly renderFrame: HostMenuFrame = {
		commandKinds: this.commandKinds,
		commandRefs: this.commandRefs,
		commandCount: 0,
	};
	private layoutWidth = -1;
	private layoutLeft = -1;
	private layoutTop = -1;
	private layoutBottom = -1;
	private layoutFont: GlyphRenderSubmission['font'] = null;
	private bottomDocked = false;

	private renderedRevision = -1;
	private renderedPage = -1;
	private renderedShift = false;

	public constructor(
		private readonly presenter: VideoPresenter,
		public readonly model: OnScreenKeyboard,
	) {
		this.commandKinds[0] = Host2DKind.Rect;
		this.commandRefs[0] = this.panelRect;
		this.commandKinds[1] = Host2DKind.Glyphs;
		this.commandRefs[1] = this.titleShadow;
		this.commandKinds[2] = Host2DKind.Glyphs;
		this.commandRefs[2] = this.titleGlyphs;
		this.renderedShift = model.shiftActive;
		for (let index = 0; index < ON_SCREEN_KEYBOARD_TARGET_COUNT; index += 1) {
			const label = model.label(index);
			const rect: RectRenderSubmission = {
				kind: RectRenderKind.Rect,
				area: { left: 0, top: 0, right: 1, bottom: 1, z: 921 },
				color: COLOR_KEY,
				layer: LAYER_2D_IDE,
			};
			const glyphs: GlyphRenderSubmission = {
				x: 0, y: 0, z: 922, items: label,
				item_start: 0, item_end: label.length, font: null,
				color: COLOR_TEXT, has_background_color: false,
				background_color: 0xff000000,
				layer: LAYER_2D_IDE,
			};
			this.keyRects[index] = rect;
			this.keyGlyphs[index] = glyphs;
			const shadow: GlyphRenderSubmission = { ...glyphs, color: COLOR_SHADOW, z: 921 };
			this.keyShadows[index] = shadow;
		}
		for (let index = 0; index < HELP_LINES.length; index += 1) {
			const line = HELP_LINES[index];
			const glyphs: GlyphRenderSubmission = {
				x: 0, y: 0, z: 922, items: line, item_start: 0, item_end: line.length,
				font: null, color: COLOR_DIM, has_background_color: false,
				background_color: 0xff000000,
				layer: LAYER_2D_IDE,
			};
			this.helpGlyphs[index] = glyphs;
			const shadow: GlyphRenderSubmission = { ...glyphs, color: COLOR_SHADOW, z: 921 };
			this.helpShadows[index] = shadow;
		}
	}

	public togglePosition(): void {
		this.bottomDocked = !this.bottomDocked;
		this.layoutWidth = -1;
	}

	/** Only published interactive keys take foreground input, not labels or help text. */
	public containsPoint(x: number, y: number): boolean {
		for (const row of this.model.rows) for (const key of row.keys) {
			if (point_in_rect(x, y, this.keyRects[key].area)) return true;
		}
		return false;
	}
	public selectAt(x: number, y: number): number {
		for (const row of this.model.rows) for (const key of row.keys) {
			if (point_in_rect(x, y, this.keyRects[key].area)) { this.model.selectKey(key); return key; }
		}
		return -1;
	}
	public queueRenderCommands(): void {
		const model = this.model;
		if (model.page !== this.renderedPage) {
			this.renderedPage = model.page;
			this.rebuildPageCommands();
			this.layoutWidth = -1;
		}
		if (model.shiftActive !== this.renderedShift) {
			this.renderedShift = model.shiftActive;
			for (let key = 0; key < this.keyGlyphs.length; key += 1) {
				const glyphs = this.keyGlyphs[key], label = model.label(key);
				glyphs.items = label;
				glyphs.item_end = label.length;
				this.keyShadows[key].items = label;
				this.keyShadows[key].item_end = label.length;
			}
			this.layoutWidth = -1;
		}
		if (model.revision !== this.renderedRevision) {
			this.renderedRevision = model.revision;
			this.updateKeyColors();
		}
		const presenter = this.presenter, bounds = presenter.visibleViewportBounds, font = presenter.default_font;
		const width = bounds.right - bounds.left;
		if (this.layoutLeft !== bounds.left || this.layoutTop !== bounds.top || this.layoutBottom !== bounds.bottom
			|| this.layoutWidth !== width || this.layoutFont !== font) {
			this.layoutLeft = bounds.left; this.layoutTop = bounds.top; this.layoutBottom = bounds.bottom;
			this.layoutWidth = width; this.layoutFont = font;
			this.layoutKeys();
		}
		presenter.hostOverlayQueue.clearHostMenuFrame();
		presenter.hostOverlayQueue.publishHostMenuFrame(this.renderFrame);
	}
	private rebuildPageCommands(): void {
		const title = TITLES[this.model.page];
		this.titleGlyphs.items = title;
		this.titleGlyphs.item_end = title.length;
		this.titleShadow.items = title;
		this.titleShadow.item_end = title.length;
		let command = 3;
		for (const row of this.model.rows) for (const key of row.keys) {
			this.commandKinds[command] = Host2DKind.Rect; this.commandRefs[command++] = this.keyRects[key];
			this.commandKinds[command] = Host2DKind.Glyphs; this.commandRefs[command++] = this.keyShadows[key];
			this.commandKinds[command] = Host2DKind.Glyphs; this.commandRefs[command++] = this.keyGlyphs[key];
		}
		for (let index = 0; index < this.helpGlyphs.length; index += 1) {
			this.commandKinds[command] = Host2DKind.Glyphs; this.commandRefs[command++] = this.helpShadows[index];
			this.commandKinds[command] = Host2DKind.Glyphs; this.commandRefs[command++] = this.helpGlyphs[index];
		}
		this.renderFrame.commandCount = command;
	}
	private updateKeyColors(): void {
		const model = this.model;
		for (const row of model.rows) for (const key of row.keys) {
			const pressed = model.isKeyHighlighted(key);
			this.keyRects[key].color = pressed ? COLOR_KEY_PRESSED : key === model.selectedKey ? COLOR_KEY_SELECTED : COLOR_KEY;
			this.keyGlyphs[key].color = pressed ? COLOR_KEY_PRESSED : key === model.selectedKey ? COLOR_KEY_SELECTED : COLOR_TEXT;
		}
		this.helpGlyphs[1].color = model.isKeyHighlighted(ON_SCREEN_KEY_INDEX_BY_CODE.get('Home'))
			|| model.isKeyHighlighted(ON_SCREEN_KEY_INDEX_BY_CODE.get('End')) ? COLOR_KEY_PRESSED : COLOR_DIM;
	}
	private layoutKeys(): void {
		const presenter = this.presenter;
		const bounds = presenter.visibleViewportBounds;
		const viewportWidth = bounds.right - bounds.left;
		const font = presenter.default_font;
		const lineHeight = font.lineHeight > 10 ? 10 : font.lineHeight;
		const keyHeight = lineHeight + 4;
		const rows = this.model.rows;
		let maxUnits = 0;
		for (const row of rows) maxUnits = Math.max(maxUnits, row.units);
		const unitWidth = Math.min(UNIT_WIDTH, (((viewportWidth - PANEL_PADDING * 2 + KEY_GAP) / maxUnits) | 0) - KEY_GAP);
		const keyboardWidth = maxUnits * (unitWidth + KEY_GAP) - KEY_GAP;
		const keysHeight = rows.length * keyHeight + (rows.length - 1) * ROW_GAP;
		const helpHeight = HELP_LINES.length * lineHeight + (HELP_LINES.length - 1) * HELP_LINE_GAP;
		const panelWidth = keyboardWidth + PANEL_PADDING * 2;
		const panelHeight = PANEL_PADDING * 2 + lineHeight + TITLE_GAP + keysHeight + HELP_GAP + helpHeight;
		const left = bounds.left + (((viewportWidth - panelWidth) / 2) | 0);
		const top = this.bottomDocked ? bounds.bottom - PANEL_PADDING - panelHeight : bounds.top + PANEL_PADDING;
		this.panelRect.area.left = left;
		this.panelRect.area.top = top;
		this.panelRect.area.right = left + panelWidth;
		this.panelRect.area.bottom = top + panelHeight;
		this.titleGlyphs.font = font;
		this.titleGlyphs.x = bounds.left + (((viewportWidth - font.measure(this.titleGlyphs.items as string)) / 2) | 0);
		this.titleGlyphs.y = top + PANEL_PADDING;
		this.titleShadow.font = font;
		this.titleShadow.x = this.titleGlyphs.x + 1;
		this.titleShadow.y = this.titleGlyphs.y + 1;
		const keyTop = top + PANEL_PADDING + lineHeight + TITLE_GAP;
		for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
			const row = rows[rowIndex];
			const rowWidth = row.units * (unitWidth + KEY_GAP) - KEY_GAP;
			const rowLeft = bounds.left + (((viewportWidth - rowWidth) / 2) | 0);
			const keyY = keyTop + rowIndex * (keyHeight + ROW_GAP);
			for (let column = 0; column < row.keys.length; column += 1) {
				const index = row.keys[column];
				const keyLeft = rowLeft + row.starts[column] * (unitWidth + KEY_GAP);
				const width = row.spans[column] * (unitWidth + KEY_GAP) - KEY_GAP;
				const rect = this.keyRects[index];
				rect.area.left = keyLeft;
				rect.area.top = keyY;
				rect.area.right = keyLeft + width;
				rect.area.bottom = keyY + keyHeight;
				const glyphs = this.keyGlyphs[index];
				const textWidth = font.measure(glyphs.items as string);
				glyphs.font = font;
				glyphs.x = keyLeft + (((width - textWidth) / 2) | 0);
				glyphs.y = keyY + (((keyHeight - lineHeight) / 2) | 0);
				const shadow = this.keyShadows[index];
				shadow.font = font;
				shadow.x = glyphs.x + 1;
				shadow.y = glyphs.y + 1;
			}
		}
		const helpTop = keyTop + keysHeight + HELP_GAP;
		for (let index = 0; index < HELP_LINES.length; index += 1) {
			const glyphs = this.helpGlyphs[index];
			glyphs.font = font;
			glyphs.x = bounds.left + (((viewportWidth - font.measure(HELP_LINES[index])) / 2) | 0);
			glyphs.y = helpTop + index * (lineHeight + HELP_LINE_GAP);
			const shadow = this.helpShadows[index];
			shadow.font = font;
			shadow.x = glyphs.x + 1;
			shadow.y = glyphs.y + 1;
		}
	}
}
