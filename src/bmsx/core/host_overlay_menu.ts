import { IO_VDP_DITHER } from '../machine/bus/io';
import { Font } from '../render/shared/bmsx_font';
import { clearHostMenuQueue, submitHostMenuGlyphs, submitHostMenuRectangle } from '../render/host_menu/queue';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../render/shared/submissions';
import { consoleCore } from './console';
import { Input } from '../input/manager';
import type { ActionState } from '../input/models';

type HostMenuValue = {
	readonly label: string;
	readonly value: number | boolean;
};

type HostMenuOption = {
	readonly label: string;
	readonly values: readonly HostMenuValue[];
	getIndex(): number;
	setIndex(index: number): void;
};

const MENU_TOGGLE_ACTIONS = ['start', 'select', 'lb', 'rb'] as const;
const MENU_NAV_ACTIONS = ['up', 'down', 'left', 'right', 'a', 'b', 'start'] as const;

const COLOR_PANEL = { r: 0.03, g: 0.03, b: 0.03, a: 0.80 };
const COLOR_HIGHLIGHT = { r: 0.12, g: 0.25, b: 0.38, a: 0.86 };
const COLOR_TEXT = { r: 0.94, g: 0.94, b: 0.94, a: 1.0 };
const COLOR_DIM = { r: 0.70, g: 0.70, b: 0.70, a: 1.0 };
const COLOR_TITLE = { r: 0.36, g: 0.78, b: 1.0, a: 1.0 };

function boolIndex(value: boolean): number {
	return value ? 1 : 0;
}

function boolFromIndex(index: number): boolean {
	return index !== 0;
}

function edge(state: ActionState): boolean {
	return state.justpressed || state.repeatpressed;
}

function writeDitherType(value: number): void {
	const runtime = consoleCore.runtime;
	consoleCore.view.dither_type = value;
	runtime.machine.memory.writeValue(IO_VDP_DITHER, value);
}

function readDitherIndex(): number {
	return consoleCore.view.dither_type;
}

export class HostOverlayMenu {
	private readonly font = new Font();
	private active = false;
	private selected = 0;
	private dirtyText = true;
	private readonly lineText: string[] = [];
	private readonly panelRect: RectRenderSubmission = { kind: 'fill', area: { left: 0, top: 0, right: 1, bottom: 1, z: 920 }, color: COLOR_PANEL, layer: 'ide' };
	private readonly highlightRect: RectRenderSubmission = { kind: 'fill', area: { left: 0, top: 0, right: 1, bottom: 1, z: 921 }, color: COLOR_HIGHLIGHT, layer: 'ide' };
	private readonly titleGlyphs: GlyphRenderSubmission = { x: 0, y: 0, z: 922, glyphs: 'host options', glyph_start: 0, glyph_end: 12, font: this.font, color: COLOR_TITLE, layer: 'ide' };
	private readonly footerGlyphs: GlyphRenderSubmission = { x: 0, y: 0, z: 922, glyphs: 'd-pad: nav  l/r: change  b: close', glyph_start: 0, glyph_end: 35, font: this.font, color: COLOR_DIM, layer: 'ide' };
	private readonly optionGlyphs: GlyphRenderSubmission[];
	private readonly options: readonly HostMenuOption[] = [
		{
			label: 'show stats',
			values: [{ label: 'off', value: false }, { label: 'on', value: true }],
			getIndex: () => boolIndex(consoleCore.view.show_resource_usage_gizmo),
			setIndex: index => { consoleCore.view.show_resource_usage_gizmo = boolFromIndex(index); },
		},
		{
			label: 'crt post',
			values: [{ label: 'off', value: false }, { label: 'on', value: true }],
			getIndex: () => boolIndex(consoleCore.view.crt_postprocessing_enabled),
			setIndex: index => { consoleCore.view.crt_postprocessing_enabled = boolFromIndex(index); },
		},
		{
			label: 'noise',
			values: [{ label: 'off', value: false }, { label: 'on', value: true }],
			getIndex: () => boolIndex(consoleCore.view.enable_noise),
			setIndex: index => { consoleCore.view.enable_noise = boolFromIndex(index); },
		},
		{
			label: 'color bleed',
			values: [{ label: 'off', value: false }, { label: 'on', value: true }],
			getIndex: () => boolIndex(consoleCore.view.enable_colorbleed),
			setIndex: index => { consoleCore.view.enable_colorbleed = boolFromIndex(index); },
		},
		{
			label: 'scanlines',
			values: [{ label: 'off', value: false }, { label: 'on', value: true }],
			getIndex: () => boolIndex(consoleCore.view.enable_scanlines),
			setIndex: index => { consoleCore.view.enable_scanlines = boolFromIndex(index); },
		},
		{
			label: 'blur',
			values: [{ label: 'off', value: false }, { label: 'on', value: true }],
			getIndex: () => boolIndex(consoleCore.view.enable_blur),
			setIndex: index => { consoleCore.view.enable_blur = boolFromIndex(index); },
		},
		{
			label: 'glow',
			values: [{ label: 'off', value: false }, { label: 'on', value: true }],
			getIndex: () => boolIndex(consoleCore.view.enable_glow),
			setIndex: index => { consoleCore.view.enable_glow = boolFromIndex(index); },
		},
		{
			label: 'fringing',
			values: [{ label: 'off', value: false }, { label: 'on', value: true }],
			getIndex: () => boolIndex(consoleCore.view.enable_fringing),
			setIndex: index => { consoleCore.view.enable_fringing = boolFromIndex(index); },
		},
		{
			label: 'aperture',
			values: [{ label: 'off', value: false }, { label: 'on', value: true }],
			getIndex: () => boolIndex(consoleCore.view.enable_aperture),
			setIndex: index => { consoleCore.view.enable_aperture = boolFromIndex(index); },
		},
		{
			label: 'dither',
			values: [{ label: 'off', value: 0 }, { label: 'psx', value: 1 }, { label: 'rgb777 out', value: 2 }, { label: 'msx10', value: 3 }],
			getIndex: readDitherIndex,
			setIndex: index => { writeDitherType(index); },
		},
	];

	constructor() {
		this.optionGlyphs = new Array(this.options.length);
		for (let index = 0; index < this.options.length; index += 1) {
			this.optionGlyphs[index] = { x: 0, y: 0, z: 922, glyphs: '', glyph_start: 0, glyph_end: 0, font: this.font, color: COLOR_TEXT, layer: 'ide' };
			this.lineText[index] = '';
		}
	}

	public get isActive(): boolean {
		return this.active;
	}

	public tickInput(): boolean {
		const player = Input.instance.getPlayerInput(1);
		const start = player.getActionState('start');
		const select = player.getActionState('select');
		const lb = player.getActionState('lb');
		const rb = player.getActionState('rb');
		const comboEdge = start.pressed && select.pressed && lb.pressed && rb.pressed && (start.justpressed || select.justpressed || lb.justpressed || rb.justpressed);
		if (comboEdge) {
			this.toggle();
			player.consumeActions(...MENU_TOGGLE_ACTIONS);
		}
		Input.instance.setGameplayCaptureEnabled(!this.active);
		if (!this.active) {
			return false;
		}
		const b = player.getActionState('b');
		if (b.justpressed) {
			this.toggle();
			player.consumeActions(...MENU_NAV_ACTIONS);
			Input.instance.setGameplayCaptureEnabled(true);
			return false;
		}
		const up = player.getActionState('up');
		const down = player.getActionState('down');
		const left = player.getActionState('left');
		const right = player.getActionState('right');
		const a = player.getActionState('a');
		if (edge(up)) {
			this.selected = this.selected === 0 ? this.options.length - 1 : this.selected - 1;
			this.dirtyText = true;
		}
		if (edge(down)) {
			this.selected = (this.selected + 1) % this.options.length;
			this.dirtyText = true;
		}
		if (edge(left)) {
			this.cycleSelected(-1);
		}
		if (edge(right) || a.justpressed) {
			this.cycleSelected(1);
		}
		player.consumeActions(...MENU_NAV_ACTIONS);
		return true;
	}

	public queueRenderCommands(): void {
		clearHostMenuQueue();
		if (this.dirtyText) {
			this.rebuildText();
		}
		const view = consoleCore.view;
		const fontWidth = 6;
		const lineHeight = 12;
		const padding = 8;
		const titleHeight = 12;
		const titleGap = 6;
		let maxChars = this.titleGlyphs.glyphs.length;
		for (let index = 0; index < this.lineText.length; index += 1) {
			const len = this.lineText[index].length;
			if (len > maxChars) {
				maxChars = len;
			}
		}
		if (this.footerGlyphs.glyphs.length > maxChars) {
			maxChars = this.footerGlyphs.glyphs.length;
		}
		const boxWidth = maxChars * fontWidth + padding * 2;
		const boxHeight = this.options.length * lineHeight + lineHeight + padding * 2;
		const totalHeight = titleHeight + titleGap + boxHeight;
		const left = (view.viewportSize.x - boxWidth) / 2;
		const top = (view.viewportSize.y - totalHeight) / 2;
		const boxTop = top + titleHeight + titleGap;
		this.panelRect.area.left = left;
		this.panelRect.area.top = boxTop;
		this.panelRect.area.right = left + boxWidth;
		this.panelRect.area.bottom = boxTop + boxHeight;
		submitHostMenuRectangle(this.panelRect);
		this.titleGlyphs.x = left + padding;
		this.titleGlyphs.y = top;
		submitHostMenuGlyphs(this.titleGlyphs);
		for (let index = 0; index < this.options.length; index += 1) {
			const y = boxTop + padding + index * lineHeight;
			if (index === this.selected) {
				this.highlightRect.area.left = left;
				this.highlightRect.area.top = y - 2;
				this.highlightRect.area.right = left + boxWidth;
				this.highlightRect.area.bottom = y + lineHeight - 2;
				submitHostMenuRectangle(this.highlightRect);
			}
			const line = this.optionGlyphs[index];
			line.x = left + padding;
			line.y = y;
			line.color = index === this.selected ? COLOR_TEXT : COLOR_DIM;
			submitHostMenuGlyphs(line);
		}
		this.footerGlyphs.x = left + boxWidth - padding - this.footerGlyphs.glyphs.length * fontWidth;
		this.footerGlyphs.y = boxTop + boxHeight - padding - lineHeight;
		submitHostMenuGlyphs(this.footerGlyphs);
	}

	private toggle(): void {
		this.active = !this.active;
		this.selected = 0;
		this.dirtyText = true;
	}

	private cycleSelected(direction: number): void {
		const option = this.options[this.selected];
		const next = (option.getIndex() + option.values.length + direction) % option.values.length;
		option.setIndex(next);
		this.dirtyText = true;
	}

	private rebuildText(): void {
		for (let index = 0; index < this.options.length; index += 1) {
			const option = this.options[index];
			const value = option.values[option.getIndex()].label;
			const line = `${option.label}  ${value}`;
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
