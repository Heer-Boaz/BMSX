import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import {
	RectRenderKind,
	TextAlign,
	TextBaseline,
	type GlyphRenderSubmission,
	type RectRenderSubmission,
} from '../../machine/ts/render/shared/submissions';
import { Host2DKind, type Host2DRef } from '../../machine/ts/render/host_overlay/commands';
import type { HostMenuFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { point_in_rect } from '../../machine/ts/common/rect';
import type { Input } from './input/manager';

type OnScreenKeyDefinition = {
	readonly label: string;
	readonly code: string;
	readonly span: number;
	readonly modifier: number;
};

type OnScreenKeyboardRow = {
	readonly start: number;
	readonly count: number;
	readonly units: number;
};

const NO_MODIFIER = -1;
const MODIFIER_SHIFT = 0;
const MODIFIER_CONTROL = 1;
const MODIFIER_ALT = 2;
const MODIFIER_CODES = ['ShiftLeft', 'ControlLeft', 'AltLeft'] as const;

const KEY_DEFINITIONS: readonly OnScreenKeyDefinition[] = [
	{ label: 'ESC', code: 'Escape', span: 2, modifier: NO_MODIFIER },
	{ label: '1', code: 'Digit1', span: 1, modifier: NO_MODIFIER },
	{ label: '2', code: 'Digit2', span: 1, modifier: NO_MODIFIER },
	{ label: '3', code: 'Digit3', span: 1, modifier: NO_MODIFIER },
	{ label: '4', code: 'Digit4', span: 1, modifier: NO_MODIFIER },
	{ label: '5', code: 'Digit5', span: 1, modifier: NO_MODIFIER },
	{ label: '6', code: 'Digit6', span: 1, modifier: NO_MODIFIER },
	{ label: '7', code: 'Digit7', span: 1, modifier: NO_MODIFIER },
	{ label: '8', code: 'Digit8', span: 1, modifier: NO_MODIFIER },
	{ label: '9', code: 'Digit9', span: 1, modifier: NO_MODIFIER },
	{ label: '0', code: 'Digit0', span: 1, modifier: NO_MODIFIER },
	{ label: '-', code: 'Minus', span: 1, modifier: NO_MODIFIER },
	{ label: '=', code: 'Equal', span: 1, modifier: NO_MODIFIER },
	{ label: 'BKSP', code: 'Backspace', span: 2, modifier: NO_MODIFIER },

	{ label: 'TAB', code: 'Tab', span: 2, modifier: NO_MODIFIER },
	{ label: 'Q', code: 'KeyQ', span: 1, modifier: NO_MODIFIER },
	{ label: 'W', code: 'KeyW', span: 1, modifier: NO_MODIFIER },
	{ label: 'E', code: 'KeyE', span: 1, modifier: NO_MODIFIER },
	{ label: 'R', code: 'KeyR', span: 1, modifier: NO_MODIFIER },
	{ label: 'T', code: 'KeyT', span: 1, modifier: NO_MODIFIER },
	{ label: 'Y', code: 'KeyY', span: 1, modifier: NO_MODIFIER },
	{ label: 'U', code: 'KeyU', span: 1, modifier: NO_MODIFIER },
	{ label: 'I', code: 'KeyI', span: 1, modifier: NO_MODIFIER },
	{ label: 'O', code: 'KeyO', span: 1, modifier: NO_MODIFIER },
	{ label: 'P', code: 'KeyP', span: 1, modifier: NO_MODIFIER },
	{ label: '[', code: 'BracketLeft', span: 1, modifier: NO_MODIFIER },
	{ label: ']', code: 'BracketRight', span: 1, modifier: NO_MODIFIER },
	{ label: '\\', code: 'Backslash', span: 1, modifier: NO_MODIFIER },

	{ label: 'CAPS', code: 'CapsLock', span: 2, modifier: NO_MODIFIER },
	{ label: 'A', code: 'KeyA', span: 1, modifier: NO_MODIFIER },
	{ label: 'S', code: 'KeyS', span: 1, modifier: NO_MODIFIER },
	{ label: 'D', code: 'KeyD', span: 1, modifier: NO_MODIFIER },
	{ label: 'F', code: 'KeyF', span: 1, modifier: NO_MODIFIER },
	{ label: 'G', code: 'KeyG', span: 1, modifier: NO_MODIFIER },
	{ label: 'H', code: 'KeyH', span: 1, modifier: NO_MODIFIER },
	{ label: 'J', code: 'KeyJ', span: 1, modifier: NO_MODIFIER },
	{ label: 'K', code: 'KeyK', span: 1, modifier: NO_MODIFIER },
	{ label: 'L', code: 'KeyL', span: 1, modifier: NO_MODIFIER },
	{ label: ';', code: 'Semicolon', span: 1, modifier: NO_MODIFIER },
	{ label: "'", code: 'Quote', span: 1, modifier: NO_MODIFIER },
	{ label: 'ENTER', code: 'Enter', span: 2, modifier: NO_MODIFIER },

	{ label: 'SHIFT', code: 'ShiftLeft', span: 2, modifier: MODIFIER_SHIFT },
	{ label: 'Z', code: 'KeyZ', span: 1, modifier: NO_MODIFIER },
	{ label: 'X', code: 'KeyX', span: 1, modifier: NO_MODIFIER },
	{ label: 'C', code: 'KeyC', span: 1, modifier: NO_MODIFIER },
	{ label: 'V', code: 'KeyV', span: 1, modifier: NO_MODIFIER },
	{ label: 'B', code: 'KeyB', span: 1, modifier: NO_MODIFIER },
	{ label: 'N', code: 'KeyN', span: 1, modifier: NO_MODIFIER },
	{ label: 'M', code: 'KeyM', span: 1, modifier: NO_MODIFIER },
	{ label: ',', code: 'Comma', span: 1, modifier: NO_MODIFIER },
	{ label: '.', code: 'Period', span: 1, modifier: NO_MODIFIER },
	{ label: '/', code: 'Slash', span: 1, modifier: NO_MODIFIER },
	{ label: 'DEL', code: 'Delete', span: 2, modifier: NO_MODIFIER },

	{ label: 'CTRL', code: 'ControlLeft', span: 2, modifier: MODIFIER_CONTROL },
	{ label: 'ALT', code: 'AltLeft', span: 2, modifier: MODIFIER_ALT },
	{ label: 'SPACE', code: 'Space', span: 6, modifier: NO_MODIFIER },
	{ label: '<', code: 'ArrowLeft', span: 1, modifier: NO_MODIFIER },
	{ label: 'v', code: 'ArrowDown', span: 1, modifier: NO_MODIFIER },
	{ label: '^', code: 'ArrowUp', span: 1, modifier: NO_MODIFIER },
	{ label: '>', code: 'ArrowRight', span: 1, modifier: NO_MODIFIER },
];

const ROWS: readonly OnScreenKeyboardRow[] = [
	{ start: 0, count: 14, units: 16 },
	{ start: 14, count: 14, units: 15 },
	{ start: 28, count: 13, units: 15 },
	{ start: 41, count: 12, units: 14 },
	{ start: 53, count: 7, units: 14 },
];

const TITLE = 'ON-SCREEN KEYBOARD';
const HELP = 'DPAD MOVE   A/TAP TYPE   B BACK';
const INITIAL_ROW = 1;
const INITIAL_KEY = 15;
const UNIT_WIDTH = 13;
const KEY_GAP = 1;
const ROW_GAP = 2;
const PANEL_PADDING = 4;
const TITLE_GAP = 3;
const HELP_GAP = 3;
const COLOR_PANEL = 0xe0101010;
const COLOR_KEY = 0xff252525;
const COLOR_KEY_ACTIVE = 0xff35551f;
const COLOR_KEY_SELECTED = 0xff1e6a95;
const COLOR_TEXT = 0xffefefef;
const COLOR_DIM = 0xffb2b2b2;
const COLOR_TITLE = 0xff5bc6ff;
const COMMAND_COUNT = 3 + KEY_DEFINITIONS.length * 2;

export class HostOnScreenKeyboard {
	private selectedRow = INITIAL_ROW;
	private selectedKey = INITIAL_KEY;
	private pulseCode = '';
	private readonly modifierStates = [false, false, false];
	private readonly panelRect: RectRenderSubmission = {
		kind: RectRenderKind.Fill,
		area: { left: 0, top: 0, right: 1, bottom: 1, z: 920 },
		color: COLOR_PANEL,
		layer: LAYER_2D_IDE,
	};
	private readonly titleGlyphs: GlyphRenderSubmission = {
		x: 0, y: 0, z: 922, items: TITLE, item_start: 0, item_end: TITLE.length,
		font: null, color: COLOR_TITLE, has_background_color: false,
		background_color: 0xff000000, wrap_chars: 0, center_block_width: 0,
		align: TextAlign.Start, baseline: TextBaseline.Alphabetic, layer: LAYER_2D_IDE,
	};
	private readonly helpGlyphs: GlyphRenderSubmission = {
		x: 0, y: 0, z: 922, items: HELP, item_start: 0, item_end: HELP.length,
		font: null, color: COLOR_DIM, has_background_color: false,
		background_color: 0xff000000, wrap_chars: 0, center_block_width: 0,
		align: TextAlign.Start, baseline: TextBaseline.Alphabetic, layer: LAYER_2D_IDE,
	};
	private readonly keyRects = new Array<RectRenderSubmission>(KEY_DEFINITIONS.length);
	private readonly keyGlyphs = new Array<GlyphRenderSubmission>(KEY_DEFINITIONS.length);
	private readonly commandKinds = new Array<Host2DKind>(COMMAND_COUNT);
	private readonly commandRefs = new Array<Host2DRef>(COMMAND_COUNT);
	private readonly renderFrame: HostMenuFrame = {
		commandKinds: this.commandKinds,
		commandRefs: this.commandRefs,
		commandCount: COMMAND_COUNT,
	};
	private layoutWidth = -1;
	private layoutHeight = -1;
	private layoutFont: GlyphRenderSubmission['font'] = null;

	public constructor(
		private readonly presenter: VideoPresenter,
		private readonly input: Input,
	) {
		this.commandKinds[0] = Host2DKind.Rect;
		this.commandRefs[0] = this.panelRect;
		this.commandKinds[1] = Host2DKind.Glyphs;
		this.commandRefs[1] = this.titleGlyphs;
		let command = 2;
		for (let index = 0; index < KEY_DEFINITIONS.length; index += 1) {
			const definition = KEY_DEFINITIONS[index];
			const rect: RectRenderSubmission = {
				kind: RectRenderKind.Fill,
				area: { left: 0, top: 0, right: 1, bottom: 1, z: 921 },
				color: COLOR_KEY,
				layer: LAYER_2D_IDE,
			};
			const glyphs: GlyphRenderSubmission = {
				x: 0, y: 0, z: 922, items: definition.label,
				item_start: 0, item_end: definition.label.length, font: null,
				color: COLOR_TEXT, has_background_color: false,
				background_color: 0xff000000, wrap_chars: 0, center_block_width: 0,
				align: TextAlign.Start, baseline: TextBaseline.Alphabetic, layer: LAYER_2D_IDE,
			};
			this.keyRects[index] = rect;
			this.keyGlyphs[index] = glyphs;
			this.commandKinds[command] = Host2DKind.Rect;
			this.commandRefs[command] = rect;
			command += 1;
			this.commandKinds[command] = Host2DKind.Glyphs;
			this.commandRefs[command] = glyphs;
			command += 1;
		}
		this.commandKinds[command] = Host2DKind.Glyphs;
		this.commandRefs[command] = this.helpGlyphs;
		this.updateKeyColors();
	}

	public open(): void {
		this.selectedRow = INITIAL_ROW;
		this.selectedKey = INITIAL_KEY;
		this.updateKeyColors();
	}

	public close(): void {
		this.releasePulse();
		for (let modifier = 0; modifier < MODIFIER_CODES.length; modifier += 1) {
			if (this.modifierStates[modifier]) {
				this.modifierStates[modifier] = false;
				this.input.setVirtualKeyboardKey(MODIFIER_CODES[modifier], false);
			}
		}
		this.updateKeyColors();
	}

	public releasePulse(): void {
		if (this.pulseCode.length !== 0) {
			this.input.setVirtualKeyboardKey(this.pulseCode, false);
			this.pulseCode = '';
		}
	}

	public moveHorizontal(direction: number): void {
		const row = ROWS[this.selectedRow];
		const offset = this.selectedKey - row.start;
		this.selectedKey = row.start + (offset + row.count + direction) % row.count;
		this.updateKeyColors();
	}

	public moveVertical(direction: number): void {
		const currentCenter = this.keyCenterUnits(this.selectedRow, this.selectedKey);
		this.selectedRow = (this.selectedRow + ROWS.length + direction) % ROWS.length;
		const row = ROWS[this.selectedRow];
		let closest = row.start;
		let closestDistance = Math.abs(this.keyCenterUnits(this.selectedRow, closest) - currentCenter);
		for (let index = row.start + 1; index < row.start + row.count; index += 1) {
			const distance = Math.abs(this.keyCenterUnits(this.selectedRow, index) - currentCenter);
			if (distance < closestDistance) {
				closest = index;
				closestDistance = distance;
			}
		}
		this.selectedKey = closest;
		this.updateKeyColors();
	}

	public activate(): void {
		const key = KEY_DEFINITIONS[this.selectedKey];
		if (key.modifier !== NO_MODIFIER) {
			const down = !this.modifierStates[key.modifier];
			this.modifierStates[key.modifier] = down;
			this.input.setVirtualKeyboardKey(key.code, down);
			this.updateKeyColors();
			return;
		}
		this.input.setVirtualKeyboardKey(key.code, true);
		this.pulseCode = key.code;
	}

	public selectAt(x: number, y: number): number {
		for (let rowIndex = 0; rowIndex < ROWS.length; rowIndex += 1) {
			const row = ROWS[rowIndex];
			for (let index = row.start; index < row.start + row.count; index += 1) {
				const area = this.keyRects[index].area;
				if (point_in_rect(x, y, area)) {
					if (index !== this.selectedKey) {
						this.selectedRow = rowIndex;
						this.selectedKey = index;
						this.updateKeyColors();
					}
					return index;
				}
			}
		}
		return -1;
	}

	public queueRenderCommands(): void {
		const presenter = this.presenter;
		const font = presenter.default_font;
		if (this.layoutWidth !== presenter.viewportSize.x
			|| this.layoutHeight !== presenter.viewportSize.y
			|| this.layoutFont !== font) {
			this.layoutWidth = presenter.viewportSize.x;
			this.layoutHeight = presenter.viewportSize.y;
			this.layoutFont = font;
			this.layoutKeys();
		}
		presenter.hostOverlayQueue.clearHostMenuFrame();
		presenter.hostOverlayQueue.publishHostMenuFrame(this.renderFrame);
	}

	private keyCenterUnits(rowIndex: number, keyIndex: number): number {
		const row = ROWS[rowIndex];
		let unit = 0;
		for (let index = row.start; index < keyIndex; index += 1) {
			unit += KEY_DEFINITIONS[index].span;
		}
		return unit * 2 + KEY_DEFINITIONS[keyIndex].span;
	}

	private updateKeyColors(): void {
		for (let index = 0; index < KEY_DEFINITIONS.length; index += 1) {
			const modifier = KEY_DEFINITIONS[index].modifier;
			this.keyRects[index].color = index === this.selectedKey
				? COLOR_KEY_SELECTED
				: modifier !== NO_MODIFIER && this.modifierStates[modifier]
					? COLOR_KEY_ACTIVE
					: COLOR_KEY;
		}
	}

	private layoutKeys(): void {
		const presenter = this.presenter;
		const font = presenter.default_font;
		const lineHeight = font.lineHeight > 10 ? 10 : font.lineHeight;
		const keyHeight = lineHeight + 4;
		const maxUnits = ROWS[0].units;
		const keyboardWidth = maxUnits * (UNIT_WIDTH + KEY_GAP) - KEY_GAP;
		const keysHeight = ROWS.length * keyHeight + (ROWS.length - 1) * ROW_GAP;
		const panelWidth = keyboardWidth + PANEL_PADDING * 2;
		const panelHeight = PANEL_PADDING * 2 + lineHeight + TITLE_GAP + keysHeight + HELP_GAP + lineHeight;
		const left = ((presenter.viewportSize.x - panelWidth) / 2) | 0;
		const top = ((presenter.viewportSize.y - panelHeight) / 2) | 0;
		this.panelRect.area.left = left;
		this.panelRect.area.top = top;
		this.panelRect.area.right = left + panelWidth;
		this.panelRect.area.bottom = top + panelHeight;
		this.titleGlyphs.font = font;
		this.titleGlyphs.x = ((presenter.viewportSize.x - font.measure(TITLE)) / 2) | 0;
		this.titleGlyphs.y = top + PANEL_PADDING;
		const keyTop = top + PANEL_PADDING + lineHeight + TITLE_GAP;
		for (let rowIndex = 0; rowIndex < ROWS.length; rowIndex += 1) {
			const row = ROWS[rowIndex];
			const rowWidth = row.units * (UNIT_WIDTH + KEY_GAP) - KEY_GAP;
			let keyLeft = ((presenter.viewportSize.x - rowWidth) / 2) | 0;
			const keyY = keyTop + rowIndex * (keyHeight + ROW_GAP);
			for (let index = row.start; index < row.start + row.count; index += 1) {
				const width = KEY_DEFINITIONS[index].span * (UNIT_WIDTH + KEY_GAP) - KEY_GAP;
				const rect = this.keyRects[index];
				rect.area.left = keyLeft;
				rect.area.top = keyY;
				rect.area.right = keyLeft + width;
				rect.area.bottom = keyY + keyHeight;
				const glyphs = this.keyGlyphs[index];
				const textWidth = font.measure(KEY_DEFINITIONS[index].label);
				glyphs.font = font;
				glyphs.x = keyLeft + (((width - textWidth) / 2) | 0);
				glyphs.y = keyY + (((keyHeight - lineHeight) / 2) | 0);
				keyLeft += width + KEY_GAP;
			}
		}
		this.helpGlyphs.font = font;
		this.helpGlyphs.x = ((presenter.viewportSize.x - font.measure(HELP)) / 2) | 0;
		this.helpGlyphs.y = keyTop + keysHeight + HELP_GAP;
	}
}
