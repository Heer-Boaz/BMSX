import { RectRenderKind, TextAlign, TextBaseline, type GlyphRenderSubmission, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { Host2DKind, type Host2DRef } from '../../machine/ts/render/host_overlay/commands';
import { Input } from './input/manager';
import type { PlayerInput } from './input/player';
import type { BGamepadButton, ButtonId } from './input/models';
import {
	HOST_MENU_BUTTON,
	HOST_ON_SCREEN_KEYBOARD_BUTTON,
} from './input/shortcuts';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
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

type HostMenuKeyboardOption = {
	readonly kind: 'keyboard';
	readonly label: string;
};

type HostMenuOption = HostMenuValueOption | HostMenuGamepadOption | HostMenuKeyboardOption | HostMenuActionOption;

type HostMenuButton = BGamepadButton;

const BUTTON_START: HostMenuButton = HOST_MENU_BUTTON;
const BUTTON_UP: HostMenuButton = 'up';
const BUTTON_DOWN: HostMenuButton = 'down';
const BUTTON_LEFT: HostMenuButton = 'left';
const BUTTON_RIGHT: HostMenuButton = 'right';
const BUTTON_A: HostMenuButton = 'a';
const BUTTON_B: HostMenuButton = 'b';
const BUTTON_X: HostMenuButton = 'x';
const BUTTON_Y: HostMenuButton = 'y';
const BUTTON_LEFT_BUMPER: HostMenuButton = 'lb';
const BUTTON_RIGHT_BUMPER: HostMenuButton = 'rb';
const BUTTON_LEFT_TRIGGER: HostMenuButton = 'lt';
const BUTTON_RIGHT_TRIGGER: HostMenuButton = 'rt';
const BUTTON_SELECT: HostMenuButton = 'select';
const LEFT_STICK_LEFT_SIGNAL = 'on-screen-keyboard:left-stick-left';
const LEFT_STICK_RIGHT_SIGNAL = 'on-screen-keyboard:left-stick-right';
const LEFT_STICK_UP_SIGNAL = 'on-screen-keyboard:left-stick-up';
const LEFT_STICK_DOWN_SIGNAL = 'on-screen-keyboard:left-stick-down';
const NAVIGATION_AXIS_THRESHOLD = 0.5;

const MENU_NAV_BUTTONS = [BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT, BUTTON_A, BUTTON_B, BUTTON_START] as const;

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
	{ button: BUTTON_B, command: OnScreenKeyboardCommand.Backspace, repeat: true, requiresSelect: false },
	{ button: BUTTON_X, command: OnScreenKeyboardCommand.Space, repeat: true, requiresSelect: false },
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

const enum HostButtonState {
	Pressed = 1,
	JustPressed = 2,
}

const enum HostOverlayPage {
	Closed,
	Options,
	Keyboard,
}

function boolIndex(value: boolean): number {
	return value ? 1 : 0;
}

function boolFromIndex(index: number): boolean {
	return index !== 0;
}

function readPlayerButtonState(player: PlayerInput, button: HostMenuButton): number {
	let result = 0;
	const gamepadState = player.inputHandlers.gamepad?.getButtonState(button);
	if (gamepadState && !gamepadState.consumed) {
		if (gamepadState.pressed) {
			result |= HostButtonState.Pressed;
		}
		if (gamepadState.justpressed) {
			result |= HostButtonState.JustPressed;
		}
	}
	const keyboardState = player.inputHandlers.keyboard?.getButtonState(button);
	if (keyboardState && !keyboardState.consumed) {
		if (keyboardState.pressed) {
			result |= HostButtonState.Pressed;
		}
		if (keyboardState.justpressed) {
			result |= HostButtonState.JustPressed;
		}
	}
	return result;
}

function readButtonState(input: Input, button: HostMenuButton): number {
	let result = 0;
	for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
		result |= readPlayerButtonState(input.getPlayerInput(playerIndex), button);
	}
	return result;
}

function buttonEdge(input: Input, button: HostMenuButton): boolean {
	let edge = false;
	for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
		const player = input.getPlayerInput(playerIndex);
		if (player.controlButtonRepeatEdge(button, 'gamepad')) {
			edge = true;
		}
		if (player.controlButtonRepeatEdge(button, 'keyboard')) {
			edge = true;
		}
	}
	return edge;
}

function gamepadButtonEdge(input: Input, button: ButtonId): boolean {
	let edge = false;
	for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
		if (input.getPlayerInput(playerIndex).controlButtonRepeatEdge(button, 'gamepad')) {
			edge = true;
		}
	}
	return edge;
}

function gamepadAxisEdge(
	input: Input,
	signal: ButtonId,
	component: 0 | 1,
	direction: -1 | 1,
): boolean {
	let edge = false;
	for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
		const player = input.getPlayerInput(playerIndex);
		const gamepad = player.inputHandlers.gamepad;
		let pressed = false;
		if (gamepad !== null) {
			const value = gamepad.getButtonState('ls').value2d![component];
			pressed = direction < 0
				? value <= -NAVIGATION_AXIS_THRESHOLD
				: value >= NAVIGATION_AXIS_THRESHOLD;
		}
		if (player.controlSignalRepeatEdge(signal, 'gamepad', pressed)) {
			edge = true;
		}
	}
	return edge;
}

function consumeButtons(input: Input, buttons: readonly HostMenuButton[]): void {
	for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
		const player = input.getPlayerInput(playerIndex);
		for (let index = 0; index < buttons.length; index += 1) {
			const button = buttons[index];
			player.inputHandlers.gamepad?.consumeButton(button);
			player.inputHandlers.keyboard?.consumeButton(button);
		}
	}
}

function consumeGamepadInput(input: Input): void {
	for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
		input.getPlayerInput(playerIndex).inputHandlers.gamepad?.consumeAllInput();
	}
}

function resetControlButtonRepeats(input: Input): void {
	for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
		input.getPlayerInput(playerIndex).resetControlButtonRepeats();
	}
}

function onScreenKeyboardCommand(input: Input): OnScreenKeyboardCommand {
	for (let bindingIndex = 0; bindingIndex < ON_SCREEN_KEYBOARD_COMMAND_BINDINGS.length; bindingIndex += 1) {
		const binding = ON_SCREEN_KEYBOARD_COMMAND_BINDINGS[bindingIndex];
		for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
			const player = input.getPlayerInput(playerIndex);
			const gamepad = player.inputHandlers.gamepad;
			if (gamepad === null
				|| gamepad.getButtonState(BUTTON_SELECT).pressed !== binding.requiresSelect) {
				continue;
			}
			const active = binding.repeat
				? player.controlButtonRepeatEdge(binding.button, 'gamepad')
				: gamepad.getButtonState(binding.button).justpressed;
			if (active) {
				return binding.command;
			}
		}
	}
	return OnScreenKeyboardCommand.None;
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
	private readonly pointerPosition = { x: 0, y: 0 };
	private pointerTimestamp = -1;
	private pointerPressPage = HostOverlayPage.Closed;
	private pointerPressTarget = -1;
	private readonly optionHitRect = create_rect_bounds();
	private optionLineHeight = 0;
	private selected = 0;
	private dirtyText = true;
	private readonly lineText: string[] = [];
	private readonly panelRect: RectRenderSubmission = { kind: RectRenderKind.Fill, area: { left: 0, top: 0, right: 1, bottom: 1, z: 920 }, color: COLOR_PANEL, layer: LAYER_2D_IDE };
	private readonly highlightRect: RectRenderSubmission = { kind: RectRenderKind.Fill, area: { left: 0, top: 0, right: 1, bottom: 1, z: 921 }, color: COLOR_HIGHLIGHT, layer: LAYER_2D_IDE };
	private readonly titleGlyphs: GlyphRenderSubmission = { x: 0, y: 0, z: 922, items: TITLE_TEXT, item_start: 0, item_end: TITLE_TEXT.length, font: null, color: COLOR_TITLE, has_background_color: false, background_color: 0xff000000, wrap_chars: 0, center_block_width: 0, align: TextAlign.Start, baseline: TextBaseline.Alphabetic, layer: LAYER_2D_IDE };
	private readonly fpsGlyphs: GlyphRenderSubmission = { x: 0, y: 0, z: 922, items: '', item_start: 0, item_end: 0, font: null, color: COLOR_TITLE, has_background_color: false, background_color: 0xff000000, wrap_chars: 0, center_block_width: 0, align: TextAlign.Start, baseline: TextBaseline.Alphabetic, layer: LAYER_2D_IDE };
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
	private readonly options: readonly HostMenuOption[] = [
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
		{ kind: 'gamepad', label: 'PLAYER 1 GAMEPAD', playerIndex: 1 },
		{ kind: 'gamepad', label: 'PLAYER 2 GAMEPAD', playerIndex: 2 },
		{ kind: 'gamepad', label: 'PLAYER 3 GAMEPAD', playerIndex: 3 },
		{ kind: 'gamepad', label: 'PLAYER 4 GAMEPAD', playerIndex: 4 },
		{ kind: 'keyboard', label: 'ON-SCREEN KEYBOARD' },
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

	public constructor(
		presenter: VideoPresenter,
		private readonly runtime: Runtime,
		private readonly input: Input,
	) {
		this.presenter = presenter;
		this.keyboard = new HostOnScreenKeyboard(presenter, input);
		const shortcuts = input.getGlobalShortcutRegistry();
		for (let playerIndex = 1; playerIndex <= Input.PLAYERS_MAX; playerIndex += 1) {
			shortcuts.registerControlShortcut(
				playerIndex,
				BUTTON_START,
				() => this.toggle(),
			);
			shortcuts.registerControlShortcut(
				playerIndex,
				HOST_ON_SCREEN_KEYBOARD_BUTTON,
				() => { this.onScreenKeyboardShortcutRequested = true; },
			);
		}
		this.optionGlyphs = new Array(this.options.length);
		for (let index = 0; index < this.options.length; index += 1) {
			this.optionGlyphs[index] = { x: 0, y: 0, z: 922, items: '', item_start: 0, item_end: 0, font: null, color: COLOR_TEXT, has_background_color: false, background_color: 0xff000000, wrap_chars: 0, center_block_width: 0, align: TextAlign.Start, baseline: TextBaseline.Alphabetic, layer: LAYER_2D_IDE };
			this.lineText[index] = '';
		}
		for (let index = 0; index < USAGE_BAR_COUNT; index += 1) {
			const rowY = USAGE_Y + index * USAGE_ROW_HEIGHT;
			const label = USAGE_LABELS[index];
			this.usageBarBackgrounds[index] = { kind: RectRenderKind.Fill, area: { left: USAGE_BAR_X, top: rowY + 1, right: USAGE_BAR_X + USAGE_BAR_WIDTH, bottom: rowY + 1 + USAGE_BAR_HEIGHT, z: USAGE_Z + 1 }, color: COLOR_USAGE_DIM, layer: LAYER_2D_IDE };
			this.usageBarFills[index] = { kind: RectRenderKind.Fill, area: { left: USAGE_BAR_X, top: rowY + 1, right: USAGE_BAR_X, bottom: rowY + 1 + USAGE_BAR_HEIGHT, z: USAGE_Z + 2 }, color: COLOR_USAGE_OK, layer: LAYER_2D_IDE };
			this.usageLabels[index] = { x: USAGE_X, y: rowY + 1, z: USAGE_Z + 3, items: label, item_start: 0, item_end: label.length, font: null, color: COLOR_USAGE_DIM, has_background_color: false, background_color: 0xff000000, wrap_chars: 0, center_block_width: 0, align: TextAlign.Start, baseline: TextBaseline.Alphabetic, layer: LAYER_2D_IDE };
			this.usagePercents[index] = { x: USAGE_BAR_X + USAGE_BAR_WIDTH + 1, y: rowY + 1, z: USAGE_Z + 3, items: '', item_start: 0, item_end: 0, font: null, color: COLOR_USAGE_TEXT, has_background_color: false, background_color: 0xff000000, wrap_chars: 0, center_block_width: 0, align: TextAlign.Start, baseline: TextBaseline.Alphabetic, layer: LAYER_2D_IDE };
			this.usagePercentCode[index] = -1;
		}
	}

	public tickInput(): HostMenuInput {
		if (this.onScreenKeyboardShortcutRequested) {
			this.onScreenKeyboardShortcutRequested = false;
			if (this.page === HostOverlayPage.Keyboard) {
				this.close();
			} else {
				this.openKeyboard();
			}
			return HostMenuInput.Inactive;
		}
		if (this.page === HostOverlayPage.Closed) {
			return HostMenuInput.Inactive;
		}
		if (this.page === HostOverlayPage.Keyboard) {
			return this.tickKeyboardInput();
		}
		if (this.controllerPortRevision !== this.input.controllerPortRevision) {
			this.controllerPortRevision = this.input.controllerPortRevision;
			this.dirtyText = true;
		}
		const pointerActivated = this.tickPointerInput();
		if ((readButtonState(this.input, BUTTON_B) & HostButtonState.JustPressed) !== 0) {
			this.toggle();
			consumeButtons(this.input, MENU_NAV_BUTTONS);
			return HostMenuInput.Inactive;
		}
		if (pointerActivated) {
			const result = this.activateSelected();
			consumeButtons(this.input, MENU_NAV_BUTTONS);
			return result;
		}
		if (buttonEdge(this.input, BUTTON_UP)) {
			this.selected = this.selected === 0 ? this.options.length - 1 : this.selected - 1;
		}
		if (buttonEdge(this.input, BUTTON_DOWN)) {
			this.selected = (this.selected + 1) % this.options.length;
		}
		if (buttonEdge(this.input, BUTTON_LEFT)) {
			this.changeSelected(-1);
		}
		if (buttonEdge(this.input, BUTTON_RIGHT)) {
			this.changeSelected(1);
		}
		const result = (readButtonState(this.input, BUTTON_A) & HostButtonState.JustPressed) !== 0
			? this.activateSelected()
			: HostMenuInput.Active;
		consumeButtons(this.input, MENU_NAV_BUTTONS);
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
		for (let index = 0; index < this.lineText.length; index += 1) {
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
		this.panelRect.area.top = boxTop;
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
		if (this.page === HostOverlayPage.Keyboard) {
			this.keyboard.queueRenderCommands();
			return true;
		}
		this.clearRenderCommands();
		if (this.page === HostOverlayPage.Options) {
			return false;
		}
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

	private toggle(): void {
		if (this.page === HostOverlayPage.Closed) {
			this.page = HostOverlayPage.Options;
			this.selected = 0;
			this.resetPointerPress();
			this.controllerPortRevision = this.input.controllerPortRevision;
			this.dirtyText = true;
			return;
		}
		this.close();
	}

	private changeSelected(direction: number): void {
		const option = this.options[this.selected];
		if (option.kind === 'action' || option.kind === 'keyboard') {
			return;
		}
		if (option.kind === 'gamepad') {
			const gamepads = this.input.connectedGamepads;
			if (gamepads.length === 0) {
				return;
			}
			const current = this.input.getPlayerInput(option.playerIndex).inputHandlers.gamepad;
			const currentIndex = current === null ? -1 : gamepads.indexOf(current);
			const nextIndex = currentIndex < 0
				? (direction > 0 ? 0 : gamepads.length - 1)
				: (currentIndex + gamepads.length + direction) % gamepads.length;
			this.input.assignGamepadToPlayer(gamepads[nextIndex], option.playerIndex);
			this.controllerPortRevision = this.input.controllerPortRevision;
			this.dirtyText = true;
			return;
		}
		const next = (option.getIndex() + option.values.length + direction) % option.values.length;
		option.setIndex(next);
		this.dirtyText = true;
	}

	private activateSelected(): HostMenuInput {
		const option = this.options[this.selected];
		if (option.kind === 'keyboard') {
			this.openKeyboard();
			return HostMenuInput.Inactive;
		}
		if (option.kind === 'action') {
			this.close();
			return option.action;
		}
		this.changeSelected(1);
		return HostMenuInput.Active;
	}

	private close(): void {
		this.keyboard.close();
		this.input.getGlobalShortcutRegistry().setExclusiveGamepadControlShortcut(null);
		resetControlButtonRepeats(this.input);
		this.page = HostOverlayPage.Closed;
		this.selected = 0;
		this.resetPointerPress();
		this.dirtyText = true;
	}

	private openKeyboard(): void {
		this.page = HostOverlayPage.Keyboard;
		this.keyboard.open();
		this.input.getGlobalShortcutRegistry().setExclusiveGamepadControlShortcut(
			HOST_ON_SCREEN_KEYBOARD_BUTTON,
		);
		resetControlButtonRepeats(this.input);
		consumeGamepadInput(this.input);
		this.pointerTimestamp = -1;
		this.resetPointerPress();
	}

	private rebuildText(): void {
		for (let index = 0; index < this.options.length; index += 1) {
			const option = this.options[index];
			let line: string;
			if (option.kind === 'action' || option.kind === 'keyboard') {
				line = option.label;
			} else if (option.kind === 'gamepad') {
				const gamepad = this.input.getPlayerInput(option.playerIndex).inputHandlers.gamepad;
				line = `${option.label}  ${gamepad === null ? 'NONE' : gamepad.device.label}`;
			} else {
				line = `${option.label}  ${option.values[option.getIndex()].label}`;
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
			consumeGamepadInput(this.input);
			return HostMenuInput.Inactive;
		}
		const dpadUp = gamepadButtonEdge(this.input, BUTTON_UP);
		const stickUp = gamepadAxisEdge(this.input, LEFT_STICK_UP_SIGNAL, 1, -1);
		if (dpadUp || stickUp) {
			this.keyboard.moveVertical(-1);
		}
		const dpadDown = gamepadButtonEdge(this.input, BUTTON_DOWN);
		const stickDown = gamepadAxisEdge(this.input, LEFT_STICK_DOWN_SIGNAL, 1, 1);
		if (dpadDown || stickDown) {
			this.keyboard.moveVertical(1);
		}
		const dpadLeft = gamepadButtonEdge(this.input, BUTTON_LEFT);
		const stickLeft = gamepadAxisEdge(this.input, LEFT_STICK_LEFT_SIGNAL, 0, -1);
		if (dpadLeft || stickLeft) {
			this.keyboard.moveHorizontal(-1);
		}
		const dpadRight = gamepadButtonEdge(this.input, BUTTON_RIGHT);
		const stickRight = gamepadAxisEdge(this.input, LEFT_STICK_RIGHT_SIGNAL, 0, 1);
		if (dpadRight || stickRight) {
			this.keyboard.moveHorizontal(1);
		}
		const command = onScreenKeyboardCommand(this.input);
		if (command !== OnScreenKeyboardCommand.None) {
			this.keyboard.command(command);
		}
		consumeGamepadInput(this.input);
		return HostMenuInput.Inactive;
	}

	private tickPointerInput(): boolean {
		const pointer = this.input.getPlayerInput(1).inputHandlers.pointer!;
		const pointerPosition = pointer.getButtonState('pointer_position');
		const pointerPrimary = pointer.getButtonState('pointer_primary');
		const pressed = pointerPrimary.justpressed && !pointerPrimary.consumed;
		const released = pointerPrimary.justreleased && !pointerPrimary.consumed;
		let target = -1;
		if (pointer.positionValid
			&& (pointerPosition.timestamp !== this.pointerTimestamp || pressed || released)) {
			this.pointerTimestamp = pointerPosition.timestamp;
			const screenPosition = pointerPosition.value2d!;
			if (this.presenter.mapDisplayPointToViewport(
				screenPosition[0],
				screenPosition[1],
				this.pointerPosition,
			)) {
				target = this.selectPointerTargetAt(
					this.pointerPosition.x,
					this.pointerPosition.y,
				);
			}
		}
		if (pressed) {
			this.pointerPressPage = this.page;
			this.pointerPressTarget = target;
		}
		let activated = false;
		if (released) {
			if (target >= 0
				&& this.pointerPressPage === this.page
				&& this.pointerPressTarget === target) {
				activated = true;
			}
			this.resetPointerPress();
		}
		pointer.consumeButton('pointer_primary');
		return activated;
	}

	private selectPointerTargetAt(x: number, y: number): number {
		if (this.page === HostOverlayPage.Keyboard) {
			return this.keyboard.selectAt(x, y);
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

	private resetPointerPress(): void {
		this.pointerPressPage = HostOverlayPage.Closed;
		this.pointerPressTarget = -1;
	}
}
