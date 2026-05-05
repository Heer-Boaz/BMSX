import type { GlyphRenderSubmission, RectRenderSubmission } from '../render/shared/submissions';
import type { Host2DKind, Host2DRef } from '../render/shared/queues';
import { consoleCore } from './console';
import { Input } from '../input/manager';
import type { PlayerInput } from '../input/player';
import { IO_VDP_DITHER } from '../machine/bus/io';

type HostMenuValue = {
	readonly label: string;
};

type HostMenuValueOption = {
	readonly kind: 'value';
	readonly label: string;
	readonly values: readonly HostMenuValue[];
	getIndex(): number;
	setIndex(index: number): void;
};

type HostMenuActionOption = {
	readonly kind: 'action';
	readonly label: string;
	execute(): void;
};

type HostMenuOption = HostMenuValueOption | HostMenuActionOption;

type HostMenuButton = {
	readonly gamepad: string;
	readonly keyboard: string;
};

const BUTTON_START: HostMenuButton = { gamepad: 'start', keyboard: 'Enter' };
const BUTTON_SELECT: HostMenuButton = { gamepad: 'select', keyboard: 'Backspace' };
const BUTTON_LB: HostMenuButton = { gamepad: 'lb', keyboard: 'ShiftLeft' };
const BUTTON_RB: HostMenuButton = { gamepad: 'rb', keyboard: 'ShiftRight' };
const BUTTON_UP: HostMenuButton = { gamepad: 'up', keyboard: 'ArrowUp' };
const BUTTON_DOWN: HostMenuButton = { gamepad: 'down', keyboard: 'ArrowDown' };
const BUTTON_LEFT: HostMenuButton = { gamepad: 'left', keyboard: 'ArrowLeft' };
const BUTTON_RIGHT: HostMenuButton = { gamepad: 'right', keyboard: 'ArrowRight' };
const BUTTON_A: HostMenuButton = { gamepad: 'a', keyboard: 'KeyX' };
const BUTTON_B: HostMenuButton = { gamepad: 'b', keyboard: 'KeyC' };

const MENU_TOGGLE_BUTTONS = [BUTTON_START, BUTTON_SELECT, BUTTON_LB, BUTTON_RB] as const;
const MENU_NAV_BUTTONS = [BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT, BUTTON_A, BUTTON_B, BUTTON_START] as const;

const TITLE_TEXT = 'CORE OPTIONS';
const FPS_PREFIX = 'FPS: ';
const USAGE_BAR_COUNT = 4;
const USAGE_LABEL_WIDTH = 28;
const USAGE_BAR_WIDTH = 54;
const USAGE_BAR_HEIGHT = 5;
const USAGE_X = 8;
const USAGE_BAR_X = USAGE_X + USAGE_LABEL_WIDTH;
const USAGE_Y = 8;
const USAGE_Z = 9000;
const USAGE_PANEL_WIDTH = 112;
const USAGE_PANEL_HEIGHT = 42;
const USAGE_ROW_HEIGHT = 10;
const USAGE_LABELS = ['CPU', 'RAM', 'VRAM', 'VDP'] as const;
const USAGE_LOW_PERCENT_TENTHS_LIMIT = 100;
const USAGE_PERCENT_TENTHS_FLAG = 1000000;
const FPS_TEXT_TENTHS_INVALID = -1;
const HOST_MENU_COMMAND_CAPACITY = 128;

const TOGGLE_VALUES: readonly HostMenuValue[] = [{ label: 'OFF' }, { label: 'ON' }];
const DITHER_VALUES: readonly HostMenuValue[] = [
	{ label: 'OFF' },
	{ label: 'PSX RGB555' },
	{ label: 'RGB777 OUTPUT' },
	{ label: 'MSX10 3:4:3' },
];

const COLOR_PANEL = { r: 0.03, g: 0.03, b: 0.03, a: 0.80 };
const COLOR_HIGHLIGHT = { r: 0.12, g: 0.25, b: 0.38, a: 0.86 };
const COLOR_TEXT = { r: 0.94, g: 0.94, b: 0.94, a: 1.0 };
const COLOR_DIM = { r: 0.70, g: 0.70, b: 0.70, a: 1.0 };
const COLOR_TITLE = { r: 0.36, g: 0.78, b: 1.0, a: 1.0 };
const COLOR_USAGE_PANEL = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
const COLOR_USAGE_TEXT = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
const COLOR_USAGE_DIM = { r: 208 / 255, g: 208 / 255, b: 208 / 255, a: 1.0 };
const COLOR_USAGE_OK = { r: 4 / 255, g: 212 / 255, b: 19 / 255, a: 1.0 };
const COLOR_USAGE_WARN = { r: 226 / 255, g: 210 / 255, b: 4 / 255, a: 1.0 };
const COLOR_USAGE_DANGER = { r: 1.0, g: 81 / 255, b: 52 / 255, a: 1.0 };

function boolIndex(value: boolean): number {
	return value ? 1 : 0;
}

function boolFromIndex(index: number): boolean {
	return index !== 0;
}

function buttonPressed(player: PlayerInput, button: HostMenuButton): boolean {
	if (player.getRawButtonState(button.gamepad, 'gamepad').pressed) {
		return true;
	}
	return player.getRawButtonState(button.keyboard, 'keyboard').pressed;
}

function buttonJustPressed(player: PlayerInput, button: HostMenuButton): boolean {
	return player.getRawButtonState(button.gamepad, 'gamepad').justpressed || player.getRawButtonState(button.keyboard, 'keyboard').justpressed;
}

function buttonEdge(player: PlayerInput, button: HostMenuButton): boolean {
	const gamepad = player.getButtonRepeatState(button.gamepad, 'gamepad');
	const keyboard = player.getButtonRepeatState(button.keyboard, 'keyboard');
	return gamepad.justpressed || keyboard.justpressed || gamepad.repeatpressed || keyboard.repeatpressed;
}

function consumeButton(player: PlayerInput, button: HostMenuButton): void {
	player.consumeRawButton(button.gamepad, 'gamepad');
	player.consumeRawButton(button.keyboard, 'keyboard');
}

function consumeButtons(player: PlayerInput, buttons: readonly HostMenuButton[]): void {
	for (let index = 0; index < buttons.length; index += 1) {
		consumeButton(player, buttons[index]);
	}
}

function usageColor(ratio: number): typeof COLOR_USAGE_OK {
	if (ratio >= 0.9) return COLOR_USAGE_DANGER;
	if (ratio >= 0.7) return COLOR_USAGE_WARN;
	return COLOR_USAGE_OK;
}

function usageFillWidth(used: number, total: number): number {
	let fillWidth = (USAGE_BAR_WIDTH * used / total) | 0;
	if (used > 0 && fillWidth === 0) {
		fillWidth = 1;
	}
	if (fillWidth > USAGE_BAR_WIDTH) {
		fillWidth = USAGE_BAR_WIDTH;
	}
	return fillWidth;
}

function usagePercentCode(used: number, total: number): number {
	if (used === 0) {
		return 0;
	}
	let tenths = ((used * 1000 / total) + 0.5) | 0;
	if (tenths < USAGE_LOW_PERCENT_TENTHS_LIMIT) {
		if (tenths === 0) {
			tenths = 1;
		}
		return USAGE_PERCENT_TENTHS_FLAG + tenths;
	}
	return ((used * 100 / total) + 0.5) | 0;
}

function usagePercentCodeText(code: number): string {
	if (code >= USAGE_PERCENT_TENTHS_FLAG) {
		const tenths = code - USAGE_PERCENT_TENTHS_FLAG;
		const whole = (tenths / 10) | 0;
		return `${whole}.${tenths - whole * 10}%`;
	}
	return `${code}%`;
}

export class HostOverlayMenu {
	private active = false;
	private selected = 0;
	private dirtyText = true;
	private readonly lineText: string[] = [];
	private readonly panelRect: RectRenderSubmission = { kind: 'fill', area: { left: 0, top: 0, right: 1, bottom: 1, z: 920 }, color: COLOR_PANEL, layer: 'ide' };
	private readonly highlightRect: RectRenderSubmission = { kind: 'fill', area: { left: 0, top: 0, right: 1, bottom: 1, z: 921 }, color: COLOR_HIGHLIGHT, layer: 'ide' };
	private readonly titleGlyphs: GlyphRenderSubmission = { x: 0, y: 0, z: 922, glyphs: TITLE_TEXT, glyph_start: 0, glyph_end: TITLE_TEXT.length, color: COLOR_TITLE, layer: 'ide' };
	private readonly fpsGlyphs: GlyphRenderSubmission = { x: 0, y: 0, z: 922, glyphs: '', glyph_start: 0, glyph_end: 0, color: COLOR_TITLE, layer: 'ide' };
	private readonly usagePanelRect: RectRenderSubmission = { kind: 'fill', area: { left: USAGE_X - 4, top: USAGE_Y - 4, right: USAGE_X - 4 + USAGE_PANEL_WIDTH, bottom: USAGE_Y - 4 + USAGE_PANEL_HEIGHT, z: USAGE_Z }, color: COLOR_USAGE_PANEL, layer: 'ide' };
	private readonly usageBarBackgrounds: RectRenderSubmission[] = new Array(USAGE_BAR_COUNT);
	private readonly usageBarFills: RectRenderSubmission[] = new Array(USAGE_BAR_COUNT);
	private readonly usageLabels: GlyphRenderSubmission[] = new Array(USAGE_BAR_COUNT);
	private readonly usagePercents: GlyphRenderSubmission[] = new Array(USAGE_BAR_COUNT);
	private readonly usagePercentCode: number[] = new Array(USAGE_BAR_COUNT);
	private readonly optionGlyphs: GlyphRenderSubmission[];
	private readonly commandKinds = new Array<Host2DKind>(HOST_MENU_COMMAND_CAPACITY);
	private readonly commandRefs = new Array<Host2DRef>(HOST_MENU_COMMAND_CAPACITY);
	private commandCount = 0;
	private fpsTextTenths = FPS_TEXT_TENTHS_INVALID;
	private fpsTextWidth = 0;
	private readonly options: readonly HostMenuOption[] = [
		{
			kind: 'value',
			label: 'Show Usage Gizmo',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(consoleCore.view.show_resource_usage_gizmo),
			setIndex: index => { consoleCore.view.show_resource_usage_gizmo = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Post-processing',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(consoleCore.view.crt_postprocessing_enabled),
			setIndex: index => { consoleCore.view.crt_postprocessing_enabled = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Noise',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(consoleCore.view.enable_noise),
			setIndex: index => { consoleCore.view.enable_noise = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Color Bleed',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(consoleCore.view.enable_colorbleed),
			setIndex: index => { consoleCore.view.enable_colorbleed = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Scanlines',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(consoleCore.view.enable_scanlines),
			setIndex: index => { consoleCore.view.enable_scanlines = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Blur',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(consoleCore.view.enable_blur),
			setIndex: index => { consoleCore.view.enable_blur = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Glow',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(consoleCore.view.enable_glow),
			setIndex: index => { consoleCore.view.enable_glow = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Fringing',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(consoleCore.view.enable_fringing),
			setIndex: index => { consoleCore.view.enable_fringing = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Aperture',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(consoleCore.view.enable_aperture),
			setIndex: index => { consoleCore.view.enable_aperture = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'Dither',
			values: DITHER_VALUES,
			getIndex: () => consoleCore.runtime.machine.memory.readIoU32(IO_VDP_DITHER),
			setIndex: index => { consoleCore.runtime.machine.memory.writeValue(IO_VDP_DITHER, index); },
		},
		{
			kind: 'value',
			label: 'HOST: SHOW FPS',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(consoleCore.host_show_fps),
			setIndex: index => { consoleCore.host_show_fps = boolFromIndex(index); },
		},
		{
			kind: 'action',
			label: 'REBOOT CART',
			execute: () => { void consoleCore.runtime.rebootToBootRom(); },
		},
		{
			kind: 'action',
			label: 'EXIT GAME',
			execute: () => { consoleCore.platform.requestShutdown(); },
		},
	];

	constructor() {
		this.optionGlyphs = new Array(this.options.length);
		for (let index = 0; index < this.options.length; index += 1) {
			this.optionGlyphs[index] = { x: 0, y: 0, z: 922, glyphs: '', glyph_start: 0, glyph_end: 0, color: COLOR_TEXT, layer: 'ide' };
			this.lineText[index] = '';
		}
		for (let index = 0; index < USAGE_BAR_COUNT; index += 1) {
			const rowY = USAGE_Y + index * USAGE_ROW_HEIGHT;
			const label = USAGE_LABELS[index];
			this.usageBarBackgrounds[index] = { kind: 'fill', area: { left: USAGE_BAR_X, top: rowY + 1, right: USAGE_BAR_X + USAGE_BAR_WIDTH, bottom: rowY + 1 + USAGE_BAR_HEIGHT, z: USAGE_Z + 1 }, color: COLOR_USAGE_DIM, layer: 'ide' };
			this.usageBarFills[index] = { kind: 'fill', area: { left: USAGE_BAR_X, top: rowY + 1, right: USAGE_BAR_X, bottom: rowY + 1 + USAGE_BAR_HEIGHT, z: USAGE_Z + 2 }, color: COLOR_USAGE_OK, layer: 'ide' };
			this.usageLabels[index] = { x: USAGE_X, y: rowY + 1, z: USAGE_Z + 3, glyphs: label, glyph_start: 0, glyph_end: label.length, color: COLOR_USAGE_DIM, layer: 'ide' };
			this.usagePercents[index] = { x: USAGE_BAR_X + USAGE_BAR_WIDTH + 1, y: rowY + 1, z: USAGE_Z + 3, glyphs: '', glyph_start: 0, glyph_end: 0, color: COLOR_USAGE_TEXT, layer: 'ide' };
			this.usagePercentCode[index] = -1;
		}
	}

	public get isActive(): boolean {
		return this.active;
	}

	public queuedCommandCount(): number {
		return this.commandCount;
	}

	public commandKind(index: number): Host2DKind {
		return this.commandKinds[index];
	}

	public commandRef(index: number): Host2DRef {
		return this.commandRefs[index];
	}

	public tickInput(): boolean {
		const player = Input.instance.getPlayerInput(1);
		const comboEdge = buttonPressed(player, BUTTON_START)
			&& buttonPressed(player, BUTTON_SELECT)
			&& buttonPressed(player, BUTTON_LB)
			&& buttonPressed(player, BUTTON_RB)
			&& (
				buttonJustPressed(player, BUTTON_START)
				|| buttonJustPressed(player, BUTTON_SELECT)
				|| buttonJustPressed(player, BUTTON_LB)
				|| buttonJustPressed(player, BUTTON_RB)
			);
		if (comboEdge) {
			this.toggle();
			consumeButtons(player, MENU_TOGGLE_BUTTONS);
		}
		Input.instance.setGameplayCaptureEnabled(!this.active);
		if (!this.active) {
			return false;
		}
		if (buttonJustPressed(player, BUTTON_B)) {
			this.toggle();
			consumeButtons(player, MENU_NAV_BUTTONS);
			Input.instance.setGameplayCaptureEnabled(true);
			return false;
		}
		if (buttonEdge(player, BUTTON_UP)) {
			this.selected = this.selected === 0 ? this.options.length - 1 : this.selected - 1;
			this.dirtyText = true;
		}
		if (buttonEdge(player, BUTTON_DOWN)) {
			this.selected = (this.selected + 1) % this.options.length;
			this.dirtyText = true;
		}
		if (buttonEdge(player, BUTTON_LEFT)) {
			this.changeSelected(-1);
		}
		if (buttonEdge(player, BUTTON_RIGHT)) {
			this.changeSelected(1);
		}
		if (buttonJustPressed(player, BUTTON_A)) {
			this.activateSelected();
		}
		consumeButtons(player, MENU_NAV_BUTTONS);
		return true;
	}

	private clearRenderCommands(): void {
		this.commandCount = 0;
	}

	private queueCommand(kind: Host2DKind, ref: Host2DRef): void {
		if (this.commandCount === HOST_MENU_COMMAND_CAPACITY) {
			throw new Error('[HostOverlayMenu] Command buffer capacity exhausted.');
		}
		this.commandKinds[this.commandCount] = kind;
		this.commandRefs[this.commandCount] = ref;
		this.commandCount += 1;
	}

	public queueRenderCommands(): void {
		this.clearRenderCommands();
		if (this.dirtyText) {
			this.rebuildText();
		}
		const view = consoleCore.view;
		const font = view.default_font;
		const lineHeight = font.lineHeight > 10 ? 10 : font.lineHeight;
		const padding = 4;
		const titleHeight = lineHeight;
		const titleGap = 4;
		let boxWidth = font.measure(this.titleGlyphs.glyphs as string);
		for (let index = 0; index < this.lineText.length; index += 1) {
			const width = font.measure(this.lineText[index]);
			if (width > boxWidth) {
				boxWidth = width;
			}
		}
		boxWidth += padding * 2;
		const boxHeight = this.options.length * lineHeight + padding * 2;
		const totalHeight = titleHeight + titleGap + boxHeight;
		const left = (view.viewportSize.x - boxWidth) / 2;
		const top = (view.viewportSize.y - totalHeight) / 2;
		const boxTop = top + titleHeight + titleGap;
		this.panelRect.area.left = left;
		this.panelRect.area.top = boxTop;
		this.panelRect.area.right = left + boxWidth;
		this.panelRect.area.bottom = boxTop + boxHeight;
		this.queueCommand('rect', this.panelRect);
		this.titleGlyphs.font = font;
		this.titleGlyphs.x = left + padding;
		this.titleGlyphs.y = top;
		this.queueCommand('glyphs', this.titleGlyphs);
		for (let index = 0; index < this.options.length; index += 1) {
			const y = boxTop + padding + index * lineHeight;
			if (index === this.selected) {
				this.highlightRect.area.left = left;
				this.highlightRect.area.top = y - 2;
				this.highlightRect.area.right = left + boxWidth;
				this.highlightRect.area.bottom = y + lineHeight - 2;
				this.queueCommand('rect', this.highlightRect);
			}
			const line = this.optionGlyphs[index];
			line.font = font;
			line.x = left + padding;
			line.y = y;
			line.color = index === this.selected ? COLOR_TEXT : COLOR_DIM;
			this.queueCommand('glyphs', line);
		}
	}

	public queueFrameOverlayCommands(): boolean {
		this.clearRenderCommands();
		if (this.active) {
			return false;
		}
		const view = consoleCore.view;
		const font = view.default_font;
		let queued = false;
		if (consoleCore.host_show_fps) {
			const fpsTenths = ((consoleCore.host_fps * 10) + 0.5) | 0;
			const fpsTextChanged = this.fpsTextTenths !== fpsTenths || this.fpsGlyphs.font !== font;
			this.fpsGlyphs.font = font;
			if (fpsTextChanged) {
				this.fpsTextTenths = fpsTenths;
				const whole = (fpsTenths / 10) | 0;
				const text = `${FPS_PREFIX}${whole}.${fpsTenths - whole * 10}`;
				this.fpsGlyphs.glyphs = text;
				this.fpsGlyphs.glyph_start = 0;
				this.fpsGlyphs.glyph_end = text.length;
				this.fpsTextWidth = font.measure(text);
			}
			this.fpsGlyphs.x = view.viewportSize.x - 8 - this.fpsTextWidth;
			this.fpsGlyphs.y = 8;
			this.queueCommand('glyphs', this.fpsGlyphs);
			queued = true;
		}
		if (view.show_resource_usage_gizmo) {
			const runtime = consoleCore.runtime;
			const vdpBudget = ((runtime.timing.vdpWorkUnitsPerSec * 1000000 / runtime.timing.ufpsScaled) + 0.5) | 0;
			this.queueCommand('rect', this.usagePanelRect);
			this.queueUsageBar(0, runtime.cpuUsageCyclesUsed(), runtime.cpuUsageCyclesGranted(), font);
			this.queueUsageBar(1, runtime.ramUsedBytes(), runtime.ramTotalBytes(), font);
			this.queueUsageBar(2, runtime.vramUsedBytes(), runtime.vramTotalBytes(), font);
			this.queueUsageBar(3, runtime.vdpUsageWorkUnitsLast(), vdpBudget, font, runtime.vdpUsageFrameHeld() ? COLOR_USAGE_DANGER : undefined);
			queued = true;
		}
		return queued;
	}

	private queueUsageBar(index: number, used: number, total: number, font: NonNullable<GlyphRenderSubmission['font']>, colorOverride?: typeof COLOR_USAGE_OK): void {
		const ratio = used / total;
		const fillWidth = usageFillWidth(used, total);
		const fill = this.usageBarFills[index];
		const percentCode = usagePercentCode(used, total);
		fill.area.right = USAGE_BAR_X + fillWidth;
		fill.color = colorOverride === undefined ? usageColor(ratio) : colorOverride;
		this.usageLabels[index].font = font;
		const pct = this.usagePercents[index];
		pct.font = font;
		if (this.usagePercentCode[index] !== percentCode) {
			this.usagePercentCode[index] = percentCode;
			const percentText = usagePercentCodeText(percentCode);
			pct.glyphs = percentText;
			pct.glyph_start = 0;
			pct.glyph_end = percentText.length;
		}
		this.queueCommand('rect', this.usageBarBackgrounds[index]);
		if (fillWidth > 0) {
			this.queueCommand('rect', fill);
		}
		this.queueCommand('glyphs', this.usageLabels[index]);
		this.queueCommand('glyphs', pct);
	}

	private toggle(): void {
		this.active = !this.active;
		this.selected = 0;
		this.dirtyText = true;
	}

	private changeSelected(direction: number): void {
		const option = this.options[this.selected];
		if (option.kind === 'action') {
			return;
		}
		const next = (option.getIndex() + option.values.length + direction) % option.values.length;
		option.setIndex(next);
		this.dirtyText = true;
	}

	private activateSelected(): void {
		const option = this.options[this.selected];
		if (option.kind === 'action') {
			this.executeAction(option);
		}
	}

	private executeAction(option: HostMenuActionOption): void {
		this.close();
		option.execute();
	}

	private close(): void {
		this.active = false;
		this.selected = 0;
		this.dirtyText = true;
	}

	private rebuildText(): void {
		for (let index = 0; index < this.options.length; index += 1) {
			const option = this.options[index];
			const line = option.kind === 'action'
				? option.label
				: `${option.label}  ${option.values[option.getIndex()].label}`;
			this.lineText[index] = line;
			const glyphs = this.optionGlyphs[index];
			glyphs.glyphs = line;
			glyphs.glyph_start = 0;
			glyphs.glyph_end = line.length;
		}
		this.dirtyText = false;
	}
}

export const hostOverlayMenu = new HostOverlayMenu();
