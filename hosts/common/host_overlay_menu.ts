import { RectRenderKind, type GlyphRenderSubmission, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { Host2DKind, type Host2DRef } from '../../machine/ts/render/host_overlay/commands';
import { Input } from './input/manager';
import { HostUiInput, HostUiInputSource } from './input/ui';
import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import {
	GAMEPAD_REMAP_CONTROLS,
	gamepadRemapChoiceIndex,
	setGamepadRemapChoice,
	type GamepadRemapControl,
} from './input/gamepad_remap_controls';
import {
	HOST_MENU_BUTTON,
	HOST_ON_SCREEN_KEYBOARD_BUTTON,
} from './input/shortcuts';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostRewind } from './rewind';
import { HostRewindTimeline } from './rewind_timeline';
import type { DeviceQuantizeMode } from '../../machine/ts/render/post/device_quantize/mode';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostMenuFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import { BASE_RAM_USED_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import {
	HostOnScreenKeyboard,
	OnScreenKeyboardCommand,
} from './host_on_screen_keyboard';
import {
	create_rect_bounds,
	point_in_rect,
	write_rect_bounds,
} from '../../machine/ts/common/rect';

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

export const enum HostMenuInput {
	Inactive,
	Active,
	RebootCart,
	ExitGame,
}

type HostMenuActionOption = {
	readonly kind: 'action';
	readonly label: string;
	readonly action: HostMenuInput.RebootCart | HostMenuInput.ExitGame;
};

type HostMenuGamepadOption = {
	readonly kind: 'gamepad';
	readonly label: string;
	readonly playerIndex: number;
};

type HostMenuRemapGamepadOption = {
	readonly kind: 'remap-gamepad';
	readonly label: string;
};

type HostMenuKeyboardOption = {
	readonly kind: 'keyboard';
	readonly label: string;
};

type HostMenuRemapOption = {
	readonly kind: 'remap';
	readonly control: GamepadRemapControl;
};

type HostMenuResetRemapOption = {
	readonly kind: 'reset-remap';
	readonly label: string;
};

type HostMenuBackOption = {
	readonly kind: 'back';
	readonly label: string;
};

type HostMenuRewindOption = {
	readonly kind: 'rewind';
	readonly label: string;
};

type HostMenuOption =
	| HostMenuRewindOption
	| HostMenuValueOption
	| HostMenuGamepadOption
	| HostMenuRemapGamepadOption
	| HostMenuKeyboardOption
	| HostMenuActionOption
	| HostMenuRemapOption
	| HostMenuResetRemapOption
	| HostMenuBackOption;

type HostMenuButton = InputControllerGamepadButtonBit;

const BUTTON_START: HostMenuButton = InputControllerGamepadButtonBit.Start;
const BUTTON_UP: HostMenuButton = InputControllerGamepadButtonBit.Up;
const BUTTON_DOWN: HostMenuButton = InputControllerGamepadButtonBit.Down;
const BUTTON_LEFT: HostMenuButton = InputControllerGamepadButtonBit.Left;
const BUTTON_RIGHT: HostMenuButton = InputControllerGamepadButtonBit.Right;
const BUTTON_A: HostMenuButton = InputControllerGamepadButtonBit.A;
const BUTTON_B: HostMenuButton = InputControllerGamepadButtonBit.B;
const BUTTON_X: HostMenuButton = InputControllerGamepadButtonBit.X;
const BUTTON_Y: HostMenuButton = InputControllerGamepadButtonBit.Y;
const BUTTON_LEFT_BUMPER: HostMenuButton = InputControllerGamepadButtonBit.LeftBumper;
const BUTTON_RIGHT_BUMPER: HostMenuButton = InputControllerGamepadButtonBit.RightBumper;
const BUTTON_LEFT_TRIGGER: HostMenuButton = InputControllerGamepadButtonBit.LeftTrigger;
const BUTTON_RIGHT_TRIGGER: HostMenuButton = InputControllerGamepadButtonBit.RightTrigger;
const BUTTON_SELECT: HostMenuButton = InputControllerGamepadButtonBit.Select;
const MENU_KEYBOARD_BUTTONS = (1 << BUTTON_UP) | (1 << BUTTON_DOWN) | (1 << BUTTON_LEFT) | (1 << BUTTON_RIGHT)
	| (1 << BUTTON_A) | (1 << BUTTON_B) | (1 << BUTTON_START) | (1 << BUTTON_LEFT_BUMPER) | (1 << BUTTON_RIGHT_BUMPER);

type OnScreenKeyboardCommandBinding = {
	readonly button: HostMenuButton;
	readonly command: OnScreenKeyboardCommand;
	readonly repeat: boolean;
	readonly requiresSelect: boolean;
};

const ON_SCREEN_KEYBOARD_COMMAND_BINDINGS: readonly OnScreenKeyboardCommandBinding[] = [
	{ button: BUTTON_B, command: OnScreenKeyboardCommand.Delete, repeat: false, requiresSelect: true },
	{ button: BUTTON_LEFT_BUMPER, command: OnScreenKeyboardCommand.Home, repeat: true, requiresSelect: true },
	{ button: BUTTON_RIGHT_BUMPER, command: OnScreenKeyboardCommand.End, repeat: true, requiresSelect: true },
	{ button: BUTTON_B, command: OnScreenKeyboardCommand.Space, repeat: true, requiresSelect: false },
	{ button: BUTTON_X, command: OnScreenKeyboardCommand.Backspace, repeat: true, requiresSelect: false },
	{ button: BUTTON_Y, command: OnScreenKeyboardCommand.Shift, repeat: false, requiresSelect: false },
	{ button: BUTTON_LEFT_BUMPER, command: OnScreenKeyboardCommand.Left, repeat: true, requiresSelect: false },
	{ button: BUTTON_RIGHT_BUMPER, command: OnScreenKeyboardCommand.Right, repeat: true, requiresSelect: false },
	{ button: BUTTON_LEFT_TRIGGER, command: OnScreenKeyboardCommand.Home, repeat: true, requiresSelect: false },
	{ button: BUTTON_RIGHT_TRIGGER, command: OnScreenKeyboardCommand.End, repeat: true, requiresSelect: false },
	{ button: BUTTON_START, command: OnScreenKeyboardCommand.Enter, repeat: false, requiresSelect: false },
	{ button: BUTTON_A, command: OnScreenKeyboardCommand.Activate, repeat: false, requiresSelect: false },
];

const TITLE_TEXT = 'CORE OPTIONS';
const FPS_PREFIX = 'HOST: ';
const USAGE_BAR_COUNT = 3;
const USAGE_LABEL_WIDTH = 28;
const USAGE_BAR_WIDTH = 54;
const USAGE_BAR_HEIGHT = 5;
const USAGE_X = 8;
const USAGE_BAR_X = USAGE_X + USAGE_LABEL_WIDTH;
const USAGE_Y = 8;
const USAGE_Z = 9000;
const USAGE_PANEL_WIDTH = 112;
const USAGE_PANEL_HEIGHT = 32;
const USAGE_ROW_HEIGHT = 10;
const USAGE_LABELS = ['CPU', 'RAM', 'VRAM'] as const;
const USAGE_LOW_PERCENT_TENTHS_LIMIT = 100;
const USAGE_PERCENT_TENTHS_FLAG = 1000000;
const FPS_TEXT_TENTHS_INVALID = -1;
const HOST_MENU_COMMAND_CAPACITY = 128;

const TOGGLE_VALUES: readonly HostMenuValue[] = [{ label: 'OFF' }, { label: 'ON' }];
const DEVICE_QUANTIZE_VALUES: readonly HostMenuValue[] = [
	{ label: 'OFF' },
	{ label: 'RGB565' },
	{ label: 'MSX10 3:4:3' },
];

const COLOR_PANEL = 0xcc070707;
const COLOR_HIGHLIGHT = 0xdb1e3f60;
const COLOR_TEXT = 0xffefefef;
const COLOR_DIM = 0xffb2b2b2;
const COLOR_TITLE = 0xff5bc6ff;
const COLOR_USAGE_PANEL = 0xff000000;
const COLOR_USAGE_TEXT = 0xffffffff;
const COLOR_USAGE_DIM = 0xffd0d0d0;
const COLOR_USAGE_OK = 0xff04d413;
const COLOR_USAGE_WARN = 0xffe2d204;
const COLOR_USAGE_DANGER = 0xffff5134;

const enum HostOverlayPage {
	Closed,
	Options,
	GamepadRemap,
	Keyboard,
	Rewind,
}

const enum HostOverlayOutcome { Cancel, Accept, Discard }

function boolIndex(value: boolean): number {
	return value ? 1 : 0;
}

function boolFromIndex(index: number): boolean {
	return index !== 0;
}

function usageColor(ratio: number): number {
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
	private readonly presenter: VideoPresenter;
	private page = HostOverlayPage.Closed;
	private readonly keyboard: HostOnScreenKeyboard;
	private readonly uiInput: HostUiInput;
	private readonly optionHitRect = create_rect_bounds();
	private optionLineHeight = 0;
	private selected = 0;
	private dirtyText = true;
	private readonly lineText: string[] = [];
	private readonly panelRect: RectRenderSubmission = { kind: RectRenderKind.Fill, area: { left: 0, top: 0, right: 1, bottom: 1, z: 920 }, color: COLOR_PANEL, layer: LAYER_2D_IDE };
	private readonly highlightRect: RectRenderSubmission = { kind: RectRenderKind.Fill, area: { left: 0, top: 0, right: 1, bottom: 1, z: 921 }, color: COLOR_HIGHLIGHT, layer: LAYER_2D_IDE };
	private readonly titleGlyphs: GlyphRenderSubmission = { x: 0, y: 0, z: 922, items: TITLE_TEXT, item_start: 0, item_end: TITLE_TEXT.length, font: null, color: COLOR_TITLE, has_background_color: false, background_color: 0xff000000, layer: LAYER_2D_IDE };
	private readonly fpsGlyphs: GlyphRenderSubmission = { x: 0, y: 0, z: 922, items: '', item_start: 0, item_end: 0, font: null, color: COLOR_TITLE, has_background_color: false, background_color: 0xff000000, layer: LAYER_2D_IDE };
	private readonly usagePanelRect: RectRenderSubmission = { kind: RectRenderKind.Fill, area: { left: USAGE_X - 4, top: USAGE_Y - 4, right: USAGE_X - 4 + USAGE_PANEL_WIDTH, bottom: USAGE_Y - 4 + USAGE_PANEL_HEIGHT, z: USAGE_Z }, color: COLOR_USAGE_PANEL, layer: LAYER_2D_IDE };
	private readonly usageBarBackgrounds: RectRenderSubmission[] = new Array(USAGE_BAR_COUNT);
	private readonly usageBarFills: RectRenderSubmission[] = new Array(USAGE_BAR_COUNT);
	private readonly usageLabels: GlyphRenderSubmission[] = new Array(USAGE_BAR_COUNT);
	private readonly usagePercents: GlyphRenderSubmission[] = new Array(USAGE_BAR_COUNT);
	private readonly usagePercentCode: number[] = new Array(USAGE_BAR_COUNT);
	private readonly optionGlyphs: GlyphRenderSubmission[];
	private readonly commandKinds = new Array<Host2DKind>(HOST_MENU_COMMAND_CAPACITY);
	private readonly commandRefs = new Array<Host2DRef>(HOST_MENU_COMMAND_CAPACITY);
	private readonly renderFrame: HostMenuFrame = {
		commandKinds: this.commandKinds,
		commandRefs: this.commandRefs,
		commandCount: 0,
	};
	private commandCount = 0;
	private fpsTextTenths = FPS_TEXT_TENTHS_INVALID;
	private fpsTextWidth = 0;
	private showFps = false;
	private controllerPortRevision = -1;
	private onScreenKeyboardShortcutRequested = false;
	private remapPlayerIndex = 1;
	private rootSelection = 0;
	private readonly rootOptions: readonly HostMenuOption[] = [
		{
			kind: 'value',
			label: 'Show Usage Gizmo',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(this.presenter.show_resource_usage_gizmo),
			setIndex: index => { this.presenter.show_resource_usage_gizmo = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Post-processing',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(this.presenter.crt_postprocessing_enabled),
			setIndex: index => { this.presenter.crt_postprocessing_enabled = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Noise',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(this.presenter.enable_noise),
			setIndex: index => { this.presenter.enable_noise = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Color Bleed',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(this.presenter.enable_colorbleed),
			setIndex: index => { this.presenter.enable_colorbleed = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Scanlines',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(this.presenter.enable_scanlines),
			setIndex: index => { this.presenter.enable_scanlines = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Blur',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(this.presenter.enable_blur),
			setIndex: index => { this.presenter.enable_blur = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Glow',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(this.presenter.enable_glow),
			setIndex: index => { this.presenter.enable_glow = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Fringing',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(this.presenter.enable_fringing),
			setIndex: index => { this.presenter.enable_fringing = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'CRT Aperture',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(this.presenter.enable_aperture),
			setIndex: index => { this.presenter.enable_aperture = boolFromIndex(index); },
		},
		{
			kind: 'value',
			label: 'Output Quantize',
			values: DEVICE_QUANTIZE_VALUES,
			getIndex: () => this.presenter.deviceQuantizeMode,
			setIndex: index => { this.presenter.deviceQuantizeMode = index as DeviceQuantizeMode; },
		},
		{
			kind: 'value',
			label: 'HOST: SHOW FPS',
			values: TOGGLE_VALUES,
			getIndex: () => boolIndex(this.showFps),
			setIndex: index => { this.showFps = boolFromIndex(index); },
		},
		{ kind: 'gamepad', label: 'PLAYER 1 CONTROLS', playerIndex: 1 },
		{ kind: 'gamepad', label: 'PLAYER 2 CONTROLS', playerIndex: 2 },
		{ kind: 'gamepad', label: 'PLAYER 3 CONTROLS', playerIndex: 3 },
		{ kind: 'gamepad', label: 'PLAYER 4 CONTROLS', playerIndex: 4 },
		{ kind: 'keyboard', label: 'ON-SCREEN KEYBOARD' },
		{ kind: 'rewind', label: 'REWIND' },
		{
			kind: 'action',
			label: 'REBOOT CART',
			action: HostMenuInput.RebootCart,
		},
		{
			kind: 'action',
			label: 'EXIT GAME',
			action: HostMenuInput.ExitGame,
		},
	];
	private readonly remapGamepadOption: HostMenuRemapGamepadOption = {
		kind: 'remap-gamepad',
		label: 'GAMEPAD',
	};
	private readonly remapOptions: readonly HostMenuOption[];
	private readonly timeline = new HostRewindTimeline();
	private options: readonly HostMenuOption[];

	public constructor(
		presenter: VideoPresenter,
		private readonly runtime: Runtime,
		private readonly input: Input,
		private readonly rewind: HostRewind,
	) {
		this.presenter = presenter;
		this.keyboard = new HostOnScreenKeyboard(presenter, input);
		this.uiInput = new HostUiInput(input, presenter);
		const remapOptions: HostMenuOption[] = new Array(
			GAMEPAD_REMAP_CONTROLS.length + 3,
		);
		remapOptions[0] = this.remapGamepadOption;
		for (let index = 0; index < GAMEPAD_REMAP_CONTROLS.length; index += 1) {
			remapOptions[index + 1] = {
				kind: 'remap',
				control: GAMEPAD_REMAP_CONTROLS[index],
			};
		}
		remapOptions[GAMEPAD_REMAP_CONTROLS.length + 1] = {
			kind: 'reset-remap',
			label: 'RESET CONTROLS',
		};
		remapOptions[GAMEPAD_REMAP_CONTROLS.length + 2] = {
			kind: 'back',
			label: 'BACK',
		};
		this.remapOptions = remapOptions;
		this.options = this.rootOptions;
		const shortcuts = input.getGlobalShortcutRegistry();
		for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
			shortcuts.registerControlShortcut(
				playerIndex,
				HOST_MENU_BUTTON,
				() => this.transitionTo(this.page === HostOverlayPage.Closed ? HostOverlayPage.Options : HostOverlayPage.Closed),
			);
			shortcuts.registerControlShortcut(
				playerIndex,
				HOST_ON_SCREEN_KEYBOARD_BUTTON,
				() => { this.onScreenKeyboardShortcutRequested = true; },
			);
		}
		const optionCapacity = Math.max(
			this.rootOptions.length,
			this.remapOptions.length,
		);
		this.optionGlyphs = new Array(optionCapacity);
		for (let index = 0; index < optionCapacity; index += 1) {
			this.optionGlyphs[index] = { x: 0, y: 0, z: 922, items: '', item_start: 0, item_end: 0, font: null, color: COLOR_TEXT, has_background_color: false, background_color: 0xff000000, layer: LAYER_2D_IDE };
			this.lineText[index] = '';
		}
		for (let index = 0; index < USAGE_BAR_COUNT; index += 1) {
			const rowY = USAGE_Y + index * USAGE_ROW_HEIGHT;
			const label = USAGE_LABELS[index];
			this.usageBarBackgrounds[index] = { kind: RectRenderKind.Fill, area: { left: USAGE_BAR_X, top: rowY + 1, right: USAGE_BAR_X + USAGE_BAR_WIDTH, bottom: rowY + 1 + USAGE_BAR_HEIGHT, z: USAGE_Z + 1 }, color: COLOR_USAGE_DIM, layer: LAYER_2D_IDE };
			this.usageBarFills[index] = { kind: RectRenderKind.Fill, area: { left: USAGE_BAR_X, top: rowY + 1, right: USAGE_BAR_X, bottom: rowY + 1 + USAGE_BAR_HEIGHT, z: USAGE_Z + 2 }, color: COLOR_USAGE_OK, layer: LAYER_2D_IDE };
			this.usageLabels[index] = { x: USAGE_X, y: rowY + 1, z: USAGE_Z + 3, items: label, item_start: 0, item_end: label.length, font: null, color: COLOR_USAGE_DIM, has_background_color: false, background_color: 0xff000000, layer: LAYER_2D_IDE };
			this.usagePercents[index] = { x: USAGE_BAR_X + USAGE_BAR_WIDTH + 1, y: rowY + 1, z: USAGE_Z + 3, items: '', item_start: 0, item_end: 0, font: null, color: COLOR_USAGE_TEXT, has_background_color: false, background_color: 0xff000000, layer: LAYER_2D_IDE };
			this.usagePercentCode[index] = -1;
		}
	}

	public tickInput(): HostMenuInput {
		if (this.onScreenKeyboardShortcutRequested) {
			this.onScreenKeyboardShortcutRequested = false;
			this.transitionTo(this.page === HostOverlayPage.Keyboard ? HostOverlayPage.Closed : HostOverlayPage.Keyboard);
		}
		this.uiInput.update(this.input.getPlayerInput(1).pollTimestampMs);
		const result = this.handleInput();
		this.uiInput.consume();
		return result;
	}

	private handleInput(): HostMenuInput {
		if (this.page === HostOverlayPage.Closed) {
			return HostMenuInput.Inactive;
		}
		if (this.page === HostOverlayPage.Keyboard) {
			return this.tickKeyboardInput();
		}
		if (this.page === HostOverlayPage.Rewind) {
			return this.tickTimelineInput();
		}
		if (this.controllerPortRevision !== this.input.controllerPortRevision) {
			this.controllerPortRevision = this.input.controllerPortRevision;
			this.dirtyText = true;
		}
		const pointerActivated = this.tickPointerInput();
		if (this.uiInput.buttonJustPressed(BUTTON_B)) {
			if (this.page === HostOverlayPage.GamepadRemap) {
				this.transitionTo(HostOverlayPage.Options);

				return HostMenuInput.Active;
			} else {
				this.transitionTo(HostOverlayPage.Closed);
			}

			return HostMenuInput.Inactive;
		}
		if (pointerActivated) {
			const result = this.activateSelected();

			return result;
		}
		if (this.uiInput.buttonRepeatEdge(BUTTON_UP)) {
			this.selected = this.selected === 0 ? this.options.length - 1 : this.selected - 1;
		}
		if (this.uiInput.buttonRepeatEdge(BUTTON_DOWN)) {
			this.selected = (this.selected + 1) % this.options.length;
		}
		if (this.uiInput.buttonRepeatEdge(BUTTON_LEFT)) {
			this.changeSelected(-1);
		}
		if (this.uiInput.buttonRepeatEdge(BUTTON_RIGHT)) {
			this.changeSelected(1);
		}
		const result = this.uiInput.buttonJustPressed(BUTTON_A)
			? this.activateSelected()
			: HostMenuInput.Active;

		return result;
	}

	private tickTimelineInput(): HostMenuInput {
		const pointerActivated = this.tickPointerInput();
		let result = HostMenuInput.Active;
		if (this.uiInput.buttonJustPressed(BUTTON_B)) {
			this.transitionTo(HostOverlayPage.Closed);
			result = HostMenuInput.Inactive;
		} else if (this.uiInput.buttonJustPressed(BUTTON_START) || this.uiInput.buttonJustPressed(BUTTON_A)) {
			this.transitionTo(HostOverlayPage.Closed, HostOverlayOutcome.Accept);
			result = HostMenuInput.Inactive;
		} else if (pointerActivated) {
			this.timeline.seekAt(this.runtime, this.rewind, this.uiInput.pointerPosition.x);
		} else {
			const leftBumper = this.uiInput.buttonRepeatEdge(BUTTON_LEFT_BUMPER);
			const rightBumper = this.uiInput.buttonRepeatEdge(BUTTON_RIGHT_BUMPER);
			const left = this.uiInput.buttonRepeatEdge(BUTTON_LEFT);
			const right = this.uiInput.buttonRepeatEdge(BUTTON_RIGHT);
			const backward = leftBumper || left;
			const forward = rightBumper || right;
			if (backward !== forward) this.timeline.moveCursor(this.runtime, this.rewind, backward ? -1 : 1);
		}

		return result;
	}

	private clearRenderCommands(): void {
		this.commandCount = 0;
		this.presenter.hostOverlayQueue.clearHostMenuFrame();
	}

	private publishRenderCommands(): void {
		this.renderFrame.commandCount = this.commandCount;
		this.presenter.hostOverlayQueue.publishHostMenuFrame(this.renderFrame);
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
		if (this.page === HostOverlayPage.Keyboard) {
			this.keyboard.queueRenderCommands();
			return;
		}
		if (this.page === HostOverlayPage.Rewind) {
			this.timeline.queueRenderCommands(this.runtime, this.presenter, this.rewind);
			return;
		}
		this.clearRenderCommands();
		if (this.dirtyText) {
			this.rebuildText();
		}
		const presenter = this.presenter;
		const font = presenter.default_font;
		const lineHeight = font.lineHeight > 10 ? 10 : font.lineHeight;
		const padding = 4;
		const titleHeight = lineHeight;
		const titleGap = 4;
		let boxWidth = font.measure(this.titleGlyphs.items as string);
		for (let index = 0; index < this.options.length; index += 1) {
			const width = font.measure(this.lineText[index]);
			if (width > boxWidth) {
				boxWidth = width;
			}
		}
		boxWidth += padding * 2;
		const boxHeight = this.options.length * lineHeight + padding * 2;
		const totalHeight = titleHeight + titleGap + boxHeight;
		const left = (presenter.viewportSize.x - boxWidth) / 2;
		const top = (presenter.viewportSize.y - totalHeight) / 2;
		const boxTop = top + titleHeight + titleGap;
		write_rect_bounds(
			this.optionHitRect,
			left,
			boxTop + padding,
			left + boxWidth,
			boxTop + padding + this.options.length * lineHeight,
		);
		this.optionLineHeight = lineHeight;
		this.panelRect.area.left = left;
		this.panelRect.area.top = top - 2;
		this.panelRect.area.right = left + boxWidth;
		this.panelRect.area.bottom = boxTop + boxHeight;
		this.queueCommand(Host2DKind.Rect, this.panelRect);
		this.titleGlyphs.font = font;
		this.titleGlyphs.x = left + padding;
		this.titleGlyphs.y = top;
		this.queueCommand(Host2DKind.Glyphs, this.titleGlyphs);
		for (let index = 0; index < this.options.length; index += 1) {
			const y = boxTop + padding + index * lineHeight;
			if (index === this.selected) {
				this.highlightRect.area.left = left;
				this.highlightRect.area.top = y - 2;
				this.highlightRect.area.right = left + boxWidth;
				this.highlightRect.area.bottom = y + lineHeight - 2;
				this.queueCommand(Host2DKind.Rect, this.highlightRect);
			}
			const line = this.optionGlyphs[index];
			line.font = font;
			line.x = left + padding;
			line.y = y;
			line.color = index === this.selected ? COLOR_TEXT : COLOR_DIM;
			this.queueCommand(Host2DKind.Glyphs, line);
		}
		this.publishRenderCommands();
	}

	public queueFrameOverlayCommands(hostFps: number): boolean {
		if (this.page !== HostOverlayPage.Closed) {
			this.queueRenderCommands();
			return true;
		}
		this.clearRenderCommands();
		const presenter = this.presenter;
		const font = presenter.default_font;
		let queued = false;
		if (this.showFps) {
			const fpsTenths = ((hostFps * 10) + 0.5) | 0;
			const fpsTextChanged = this.fpsTextTenths !== fpsTenths || this.fpsGlyphs.font !== font;
			this.fpsGlyphs.font = font;
			if (fpsTextChanged) {
				this.fpsTextTenths = fpsTenths;
				const whole = (fpsTenths / 10) | 0;
				const text = `${FPS_PREFIX}${whole}.${fpsTenths - whole * 10}`;
				this.fpsGlyphs.items = text;
				this.fpsGlyphs.item_start = 0;
				this.fpsGlyphs.item_end = text.length;
				this.fpsTextWidth = font.measure(text);
			}
			this.fpsGlyphs.x = presenter.viewportSize.x - 8 - this.fpsTextWidth;
			this.fpsGlyphs.y = 8;
			this.queueCommand(Host2DKind.Glyphs, this.fpsGlyphs);
			queued = true;
		}
		if (presenter.show_resource_usage_gizmo) {
			const runtime = this.runtime;
			const gxGpuVramBytes = runtime.machine.gxGpu.readVramSnapshotBytes().byteLength;
			this.queueCommand(Host2DKind.Rect, this.usagePanelRect);
			this.queueUsageBar(0, runtime.cpuUsageCyclesUsed(), runtime.cpuUsageCyclesGranted(), font);
			this.queueUsageBar(
				1,
				BASE_RAM_USED_SIZE + runtime.machine.cpu.luaHeap.usedBytes(),
				runtime.machine.memory.ramByteCount(),
				font,
			);
			this.queueUsageBar(2, gxGpuVramBytes, gxGpuVramBytes, font);
			queued = true;
		}
		if (queued) {
			this.publishRenderCommands();
		}
		return queued;
	}

	private queueUsageBar(index: number, used: number, total: number, font: NonNullable<GlyphRenderSubmission['font']>): void {
		const ratio = used / total;
		const fillWidth = usageFillWidth(used, total);
		const fill = this.usageBarFills[index];
		const percentCode = usagePercentCode(used, total);
		fill.area.right = USAGE_BAR_X + fillWidth;
		fill.color = usageColor(ratio);
		this.usageLabels[index].font = font;
		const pct = this.usagePercents[index];
		pct.font = font;
		if (this.usagePercentCode[index] !== percentCode) {
			this.usagePercentCode[index] = percentCode;
			const percentText = usagePercentCodeText(percentCode);
			pct.items = percentText;
			pct.item_start = 0;
			pct.item_end = percentText.length;
		}
		this.queueCommand(Host2DKind.Rect, this.usageBarBackgrounds[index]);
		if (fillWidth > 0) {
			this.queueCommand(Host2DKind.Rect, fill);
		}
		this.queueCommand(Host2DKind.Glyphs, this.usageLabels[index]);
		this.queueCommand(Host2DKind.Glyphs, pct);
	}

	private changeSelected(direction: number): void {
		const option = this.options[this.selected];
		switch (option.kind) {
			case 'action':
			case 'rewind':
			case 'keyboard':
			case 'reset-remap':
			case 'back':
				return;
			case 'remap': {
				const remap = this.input.gamepadPortRemaps[this.remapPlayerIndex - 1];
				const choices = option.control.choices;
				const next = (
					gamepadRemapChoiceIndex(remap, option.control)
					+ choices.length
					+ direction
				) % choices.length;
				setGamepadRemapChoice(remap, option.control, next);
				this.dirtyText = true;
				return;
			}
			case 'gamepad':
			case 'remap-gamepad': {
				const gamepads = this.input.connectedGamepads;
				if (gamepads.length === 0) {
					return;
				}
				const playerIndex = option.kind === 'gamepad'
					? option.playerIndex
					: this.remapPlayerIndex;
				const current = this.input.getPlayerInput(playerIndex).inputHandlers.gamepad;
				const currentIndex = current === null ? -1 : gamepads.indexOf(current);
				const nextIndex = currentIndex < 0
					? (direction > 0 ? 0 : gamepads.length - 1)
					: (currentIndex + gamepads.length + direction) % gamepads.length;
				this.input.assignGamepadToPlayer(gamepads[nextIndex], playerIndex);
				this.controllerPortRevision = this.input.controllerPortRevision;
				this.dirtyText = true;
				return;
			}
			case 'value': {
				const next = (option.getIndex() + option.values.length + direction) % option.values.length;
				option.setIndex(next);
				this.dirtyText = true;
				return;
			}
		}
	}

	private activateSelected(): HostMenuInput {
		const option = this.options[this.selected];
		if (option.kind === 'rewind') {
			if (!this.rewind.available) return HostMenuInput.Active;
			this.rootSelection = this.selected;
			this.transitionTo(HostOverlayPage.Rewind);
			return HostMenuInput.Active;
		}
		if (option.kind === 'keyboard') {
			this.transitionTo(HostOverlayPage.Keyboard);
			return HostMenuInput.Inactive;
		}
		if (option.kind === 'action') {
			this.transitionTo(HostOverlayPage.Closed);
			return option.action;
		}
		if (option.kind === 'back') {
			this.transitionTo(HostOverlayPage.Options);
			return HostMenuInput.Active;
		}
		if (option.kind === 'reset-remap') {
			this.input.gamepadPortRemaps[this.remapPlayerIndex - 1].reset();
			this.dirtyText = true;
			return HostMenuInput.Active;
		}
		if (option.kind === 'gamepad'
			&& this.page === HostOverlayPage.Options) {
			this.rootSelection = this.selected;
			this.remapPlayerIndex = option.playerIndex;
			this.transitionTo(HostOverlayPage.GamepadRemap);
			return HostMenuInput.Active;
		}
		this.changeSelected(1);
		return HostMenuInput.Active;
	}

	private transitionTo(next: HostOverlayPage, outcome = HostOverlayOutcome.Cancel): void {
		switch (this.page) {
			case HostOverlayPage.Keyboard:
				this.keyboard.close();
				break;
			case HostOverlayPage.Rewind:
				if (outcome === HostOverlayOutcome.Accept) this.rewind.resumeHere();
				else if (outcome === HostOverlayOutcome.Cancel) this.rewind.returnToPresent();
				break;
			case HostOverlayPage.Closed:
			case HostOverlayPage.Options:
			case HostOverlayPage.GamepadRemap:
				break;
		}
		this.page = next;
		const sources = next === HostOverlayPage.Closed ? HostUiInputSource.None
			: next === HostOverlayPage.Keyboard ? HostUiInputSource.Gamepad | HostUiInputSource.LeftStick | HostUiInputSource.Pointer
				: HostUiInputSource.Gamepad | HostUiInputSource.Keyboard | HostUiInputSource.Pointer;
		this.uiInput.reset(sources, MENU_KEYBOARD_BUTTONS);
		this.input.getGlobalShortcutRegistry().setExclusiveGamepadControlShortcut(
			next === HostOverlayPage.Keyboard ? HOST_ON_SCREEN_KEYBOARD_BUTTON : null,
		);
		this.dirtyText = true;
		switch (next) {
			case HostOverlayPage.Closed:
				this.rootSelection = 0;
				this.selected = 0;
				break;
			case HostOverlayPage.Options:
				this.options = this.rootOptions;
				this.selected = this.rootSelection;
				this.titleGlyphs.items = TITLE_TEXT;
				this.titleGlyphs.item_end = TITLE_TEXT.length;
				this.controllerPortRevision = this.input.controllerPortRevision;
				break;
			case HostOverlayPage.GamepadRemap: {
				this.options = this.remapOptions;
				this.selected = 0;
				const title = `PLAYER ${this.remapPlayerIndex} CONTROLS`;
				this.titleGlyphs.items = title;
				this.titleGlyphs.item_end = title.length;
				break;
			}
			case HostOverlayPage.Keyboard:
				this.keyboard.open();
				break;
			case HostOverlayPage.Rewind:
				break;
		}
	}

	private rebuildText(): void {
		const remap = this.input.gamepadPortRemaps[this.remapPlayerIndex - 1];
		for (let index = 0; index < this.options.length; index += 1) {
			const option = this.options[index];
			let line: string;
			switch (option.kind) {
				case 'action':
				case 'rewind':
				case 'keyboard':
				case 'reset-remap':
				case 'back':
					line = option.label;
					break;
				case 'gamepad':
				case 'remap-gamepad': {
					const playerIndex = option.kind === 'gamepad'
						? option.playerIndex
						: this.remapPlayerIndex;
					const gamepad = this.input.getPlayerInput(playerIndex).inputHandlers.gamepad;
					line = `${option.label}  ${gamepad === null ? 'NONE' : gamepad.device.label}`;
					break;
				}
				case 'remap': {
					const choice = option.control.choices[
						gamepadRemapChoiceIndex(remap, option.control)
					];
					line = `${option.control.label}  <-  ${choice.label}`;
					break;
				}
				case 'value':
					line = `${option.label}  ${option.values[option.getIndex()].label}`;
					break;
			}
			this.lineText[index] = line;
			const items = this.optionGlyphs[index];
			items.items = line;
			items.item_start = 0;
			items.item_end = line.length;
		}
		this.dirtyText = false;
	}

	private tickKeyboardInput(): HostMenuInput {
		this.keyboard.releasePulse();
		const pointerActivated = this.tickPointerInput();
		if (pointerActivated) {
			this.keyboard.activate();

			return HostMenuInput.Inactive;
		}
		if (this.uiInput.buttonRepeatEdge(BUTTON_UP)) {
			this.keyboard.moveVertical(-1);
		}
		if (this.uiInput.buttonRepeatEdge(BUTTON_DOWN)) {
			this.keyboard.moveVertical(1);
		}
		if (this.uiInput.buttonRepeatEdge(BUTTON_LEFT)) {
			this.keyboard.moveHorizontal(-1);
		}
		if (this.uiInput.buttonRepeatEdge(BUTTON_RIGHT)) {
			this.keyboard.moveHorizontal(1);
		}
		const command = this.onScreenKeyboardCommand();
		if (command !== OnScreenKeyboardCommand.None) {
			this.keyboard.command(command);
		}

		return HostMenuInput.Inactive;
	}

	private onScreenKeyboardCommand(): OnScreenKeyboardCommand {
		for (const binding of ON_SCREEN_KEYBOARD_COMMAND_BINDINGS) {
			for (let player = 0; player < Input.PLAYERS_MAX; player += 1) {
				if (this.uiInput.gamepadButtonPressed(player, BUTTON_SELECT) !== binding.requiresSelect) continue;
				const active = binding.repeat
					? this.uiInput.gamepadButtonRepeatEdge(player, binding.button)
					: this.uiInput.gamepadButtonJustPressed(player, binding.button);
				if (active) return binding.command;
			}
		}
		return OnScreenKeyboardCommand.None;
	}

	private tickPointerInput(): boolean {
		const input = this.uiInput;
		const target = input.pointerValid && input.pointerChanged
			? this.selectPointerTargetAt(input.pointerPosition.x, input.pointerPosition.y) : -1;
		return input.activatePointer(target);
	}

	private selectPointerTargetAt(x: number, y: number): number {
		if (this.page === HostOverlayPage.Keyboard) {
			return this.keyboard.selectAt(x, y);
		}
		if (this.page === HostOverlayPage.Rewind) {
			return point_in_rect(x, y, this.timeline.hitRect) ? 0 : -1;
		}
		if (!point_in_rect(x, y, this.optionHitRect)) {
			return -1;
		}
		const index = ((y - this.optionHitRect.top) / this.optionLineHeight) | 0;
		if (index !== this.selected) {
			this.selected = index;
		}
		return index;
	}

}
