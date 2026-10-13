import { HostPauseReason, type HostExecutionControl } from './execution_control';
import { RectRenderKind, type GlyphRenderSubmission, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { Host2DKind, type Host2DRef } from '../../machine/ts/render/host_overlay/commands';
import { Input } from './input/manager';
import { HostUiInput, HostUiInputSource } from './input/ui';
import { INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT, InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
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
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { clamp } from '../../machine/ts/common/clamp';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostRewind } from './rewind';
import { HostRewindTimeline, TimelineAction, type TimelineState } from './rewind_timeline';
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
	type RectBounds,
} from '../../machine/ts/common/rect';

type HostMenuValue = {
	readonly label: string;
};

export type HostMenuValueOption = {
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

export const enum HostMenuExecution {
	Live,
	Paused,
	Rewind,
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
	| (1 << BUTTON_A) | (1 << BUTTON_B) | (1 << BUTTON_X) | (1 << BUTTON_LEFT_BUMPER) | (1 << BUTTON_RIGHT_BUMPER);

type OnScreenKeyboardCommandBinding = {
	readonly button: HostMenuButton;
	readonly command: OnScreenKeyboardCommand;
	readonly requiresSelect: boolean;
};

const ON_SCREEN_KEYBOARD_COMMAND_BINDINGS: readonly OnScreenKeyboardCommandBinding[] = [
	{ button: BUTTON_B, command: OnScreenKeyboardCommand.Delete, requiresSelect: true },
	{ button: BUTTON_LEFT_BUMPER, command: OnScreenKeyboardCommand.Home, requiresSelect: true },
	{ button: BUTTON_RIGHT_BUMPER, command: OnScreenKeyboardCommand.End, requiresSelect: true },
	{ button: BUTTON_B, command: OnScreenKeyboardCommand.Space, requiresSelect: false },
	{ button: BUTTON_X, command: OnScreenKeyboardCommand.Backspace, requiresSelect: false },
	{ button: BUTTON_Y, command: OnScreenKeyboardCommand.Shift, requiresSelect: false },
	{ button: BUTTON_LEFT_BUMPER, command: OnScreenKeyboardCommand.Left, requiresSelect: false },
	{ button: BUTTON_RIGHT_BUMPER, command: OnScreenKeyboardCommand.Right, requiresSelect: false },
	{ button: BUTTON_LEFT_TRIGGER, command: OnScreenKeyboardCommand.Home, requiresSelect: false },
	{ button: BUTTON_RIGHT_TRIGGER, command: OnScreenKeyboardCommand.End, requiresSelect: false },
	{ button: BUTTON_START, command: OnScreenKeyboardCommand.Enter, requiresSelect: false },
	{ button: BUTTON_A, command: OnScreenKeyboardCommand.Activate, requiresSelect: false },
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

export const enum HostOverlayOutcome { Cancel, Accept, Discard, Retain }

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
	private readonly pointerCapturePoint = { x: 0, y: 0 };
	private keyboardVisibilityListener: ((visible: boolean) => void) | null = null;
	private optionLineHeight = 0;
	private optionFirstRow = 0;
	private optionVisibleRows = 0;
	private titleText = TITLE_TEXT;
	private layoutFont: GlyphRenderSubmission['font'] = null;
	private optionTextWidth = 0;
	private titleTextWidth = 0;
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
	private usageOriginLeft = -1;
	private usageOriginTop = -1;
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
	private readonly rootOptions: HostMenuOption[] = [
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
	private readonly timelineFont = new Font({ variant: 'tiny' });
	private readonly timelineState: TimelineState = { earliestCycles: 0, latestCycles: 0, positionCycles: 0, cpuHz: 1,
		status: 'PAUSED', enabledActions: 0, hoveredAction: TimelineAction.None, focusedAction: TimelineAction.None };
	private options: readonly HostMenuOption[];

	public constructor(
		presenter: VideoPresenter,
		private readonly runtime: Runtime,
		private readonly input: Input,
		private readonly rewind: HostRewind,
		private readonly execution: HostExecutionControl,
		frontendOptions: readonly HostMenuValueOption[] = [],
	) {
		this.rootOptions.splice(this.rootOptions.length - 2, 0, ...frontendOptions);
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
		execution.onWillExecute(() => this.dismiss(HostOverlayOutcome.Discard));
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

	public get executionMode(): HostMenuExecution {
		return this.page === HostOverlayPage.Options || this.page === HostOverlayPage.GamepadRemap
			? HostMenuExecution.Paused
			: this.page === HostOverlayPage.Rewind ? HostMenuExecution.Rewind : HostMenuExecution.Live;
	}

	/** Acquire foreground keyboard contacts without changing any existing pointer lease. */
	public readonly capturesPointer = (x: number, y: number): boolean => {
		return this.page === HostOverlayPage.Keyboard
			&& this.presenter.mapDisplayPointToViewport(x, y, this.pointerCapturePoint)
			&& this.keyboard.containsPoint(this.pointerCapturePoint.x, this.pointerCapturePoint.y);
	};

	/** Browser control presentation follows actual page transitions, not frame polling. */
	public setKeyboardVisibilityListener(listener: (visible: boolean) => void): void {
		this.keyboardVisibilityListener = listener;
	}

	public tickInput(): HostMenuInput {
		if (this.onScreenKeyboardShortcutRequested) {
			this.onScreenKeyboardShortcutRequested = false;
			this.transitionTo(this.page === HostOverlayPage.Keyboard ? HostOverlayPage.Closed : HostOverlayPage.Keyboard);
		}
		const currentTimeMs = this.input.getPlayerInput(1).pollTimestampMs;
		this.uiInput.update(currentTimeMs);
		if (this.page === HostOverlayPage.Keyboard) this.keyboard.updateFeedback(currentTimeMs);
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
		const pointerAction = pointerActivated
			? this.timeline.selectAt(this.uiInput.pointerPosition.x, this.uiInput.pointerPosition.y) : TimelineAction.None;
		let result = HostMenuInput.Active;
		if (this.uiInput.buttonJustPressed(BUTTON_B) || pointerAction === TimelineAction.Cancel) {
			this.transitionTo(HostOverlayPage.Closed);
			result = HostMenuInput.Inactive;
		} else if (this.uiInput.buttonJustPressed(BUTTON_A) || pointerAction === TimelineAction.Resume) {
			this.transitionTo(HostOverlayPage.Closed, HostOverlayOutcome.Accept);
			result = HostMenuInput.Inactive;
		} else if (this.uiInput.buttonJustPressed(BUTTON_X)) {
			if (!this.rewind.playing) this.execution.setPauseReason(HostPauseReason.Requested, false);
			this.rewind.togglePlayback();
		} else if (pointerAction === TimelineAction.Seek || this.uiInput.pointerChanged && this.uiInput.pointerCapturedBy(TimelineAction.Seek)) {
			this.rewind.seekTo(this.timeline.cyclesAt(this.uiInput.pointerPosition.x));
		} else if (pointerAction === TimelineAction.Present) {
			this.rewind.seekTo(this.runtime.history.latestCycles);
		} else {
			const leftBumper = this.uiInput.buttonRepeatEdge(BUTTON_LEFT_BUMPER) || pointerAction === TimelineAction.Previous;
			const rightBumper = this.uiInput.buttonRepeatEdge(BUTTON_RIGHT_BUMPER) || pointerAction === TimelineAction.Next;
			const left = this.uiInput.buttonRepeatEdge(BUTTON_LEFT);
			const right = this.uiInput.buttonRepeatEdge(BUTTON_RIGHT);
			if (leftBumper !== rightBumper && !this.rewind.seeking && !this.rewind.playing) {
				const direction = leftBumper ? -1 : 1;
				if (this.rewind.frameStepCycles(direction) !== this.rewind.positionCycles) this.rewind.stepFrame(direction);
			} else if (left !== right) {
				const history = this.runtime.history;
				this.rewind.seekTo(clamp(this.rewind.positionCycles + (left ? -1 : 1) * this.runtime.timing.cpuHz,
					history.earliestCycles, history.latestCycles));
			}
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
			const source = this.uiInput.activeSource;
			this.timeline.setActionLabel(TimelineAction.Resume, source === HostUiInputSource.Gamepad ? 'A OK' : source === HostUiInputSource.Keyboard ? 'ENTER OK' : 'OK');
			this.timeline.setActionLabel(TimelineAction.Cancel, source === HostUiInputSource.Gamepad ? 'B BACK' : source === HostUiInputSource.Keyboard ? 'ESC BACK' : 'BACK');
			const state = this.timelineState, history = this.runtime.history;
			state.earliestCycles = history.earliestCycles; state.latestCycles = history.latestCycles;
			state.positionCycles = this.rewind.positionCycles; state.cpuHz = this.runtime.timing.cpuHz;
			state.status = this.rewind.stopped ? 'STOPPED' : this.rewind.seeking ? 'SEEKING' : this.rewind.playing ? 'REPLAY' : 'PAUSED';
			state.enabledActions = (1 << TimelineAction.Seek) | (1 << TimelineAction.Playback)
				| (1 << TimelineAction.Present) | (1 << TimelineAction.Resume) | (1 << TimelineAction.Cancel);
			if (!this.rewind.seeking && !this.rewind.playing) {
				if (this.rewind.frameStepCycles(-1) < state.positionCycles) state.enabledActions |= 1 << TimelineAction.Previous;
				if (this.rewind.frameStepCycles(1) > state.positionCycles) state.enabledActions |= 1 << TimelineAction.Next;
			}
			const bounds = this.presenter.visibleViewportBounds;
			this.timeline.update(state, bounds.left + 6, bounds.bottom - HostRewindTimeline.height(this.timelineFont) - 6,
				bounds.right - 6, this.timelineFont);
			this.presenter.hostOverlayQueue.publishHostMenuFrame(this.timeline.frame);
			return;
		}
		this.clearRenderCommands();
		const textWasDirty = this.dirtyText;
		if (textWasDirty) {
			this.rebuildText();
		}
		const presenter = this.presenter;
		const font = presenter.default_font;
		const fontChanged = this.layoutFont !== font;
		if (textWasDirty || fontChanged) {
			this.layoutFont = font;
			this.optionTextWidth = 0;
			for (let index = 0; index < this.options.length; index += 1) {
				this.optionTextWidth = Math.max(this.optionTextWidth, font.measure(this.lineText[index]));
			}
		}
		const lineHeight = font.lineHeight > 10 ? 10 : font.lineHeight;
		const padding = 4;
		const titleHeight = lineHeight;
		const titleGap = 4;
		const topBezel = 2;
		const bounds = presenter.visibleViewportBounds;
		const visibleRows = Math.min(this.options.length,
			((bounds.bottom - bounds.top - titleHeight - titleGap - padding * 2 - topBezel) / lineHeight) | 0);
		let firstRow = Math.min(this.optionFirstRow, this.options.length - visibleRows);
		if (this.selected < firstRow) firstRow = this.selected;
		else if (this.selected >= firstRow + visibleRows) firstRow = this.selected - visibleRows + 1;
		if (textWasDirty || fontChanged || firstRow !== this.optionFirstRow || visibleRows !== this.optionVisibleRows) {
			const title = visibleRows === this.options.length ? this.titleText
				: `${this.titleText} [${firstRow + 1}-${firstRow + visibleRows}/${this.options.length}]`;
			this.titleGlyphs.items = title;
			this.titleGlyphs.item_end = title.length;
			this.titleTextWidth = font.measure(title);
		}
		this.optionFirstRow = firstRow;
		this.optionVisibleRows = visibleRows;
		const boxWidth = Math.max(this.optionTextWidth, this.titleTextWidth) + padding * 2;
		const boxHeight = visibleRows * lineHeight + padding * 2;
		const totalHeight = titleHeight + titleGap + boxHeight;
		const left = (bounds.left + bounds.right - boxWidth) / 2;
		const top = (bounds.top + bounds.bottom - totalHeight - topBezel) / 2 + topBezel;
		const boxTop = top + titleHeight + titleGap;
		write_rect_bounds(
			this.optionHitRect,
			left,
			boxTop + padding,
			left + boxWidth,
			boxTop + padding + visibleRows * lineHeight,
		);
		this.optionLineHeight = lineHeight;
		this.panelRect.area.left = left;
		this.panelRect.area.top = top - topBezel;
		this.panelRect.area.right = left + boxWidth;
		this.panelRect.area.bottom = boxTop + boxHeight;
		this.queueCommand(Host2DKind.Rect, this.panelRect);
		this.titleGlyphs.font = font;
		this.titleGlyphs.x = left + padding;
		this.titleGlyphs.y = top;
		this.queueCommand(Host2DKind.Glyphs, this.titleGlyphs);
		for (let row = 0; row < visibleRows; row += 1) {
			const index = firstRow + row;
			const y = boxTop + padding + row * lineHeight;
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
			this.fpsGlyphs.x = presenter.visibleViewportBounds.right - 8 - this.fpsTextWidth;
			this.fpsGlyphs.y = presenter.visibleViewportBounds.top + 8;
			this.queueCommand(Host2DKind.Glyphs, this.fpsGlyphs);
			queued = true;
		}
		if (presenter.show_resource_usage_gizmo) {
			this.layoutUsageGizmo(presenter.visibleViewportBounds);
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

	private layoutUsageGizmo(bounds: Readonly<RectBounds>): void {
		if (bounds.left === this.usageOriginLeft && bounds.top === this.usageOriginTop) return;
		this.usageOriginLeft = bounds.left;
		this.usageOriginTop = bounds.top;
		write_rect_bounds(this.usagePanelRect.area, bounds.left + USAGE_X - 4, bounds.top + USAGE_Y - 4,
			bounds.left + USAGE_X - 4 + USAGE_PANEL_WIDTH, bounds.top + USAGE_Y - 4 + USAGE_PANEL_HEIGHT);
		for (let index = 0; index < USAGE_BAR_COUNT; index += 1) {
			const left = bounds.left + USAGE_BAR_X;
			const top = bounds.top + USAGE_Y + index * USAGE_ROW_HEIGHT + 1;
			write_rect_bounds(this.usageBarBackgrounds[index].area, left, top, left + USAGE_BAR_WIDTH, top + USAGE_BAR_HEIGHT);
			const fill = this.usageBarFills[index].area;
			fill.left = left;
			fill.top = top;
			fill.bottom = top + USAGE_BAR_HEIGHT;
			this.usageLabels[index].x = bounds.left + USAGE_X;
			this.usageLabels[index].y = top;
			this.usagePercents[index].x = left + USAGE_BAR_WIDTH + 1;
			this.usagePercents[index].y = top;
		}
	}

	private queueUsageBar(index: number, used: number, total: number, font: NonNullable<GlyphRenderSubmission['font']>): void {
		const ratio = used / total;
		const fillWidth = usageFillWidth(used, total);
		const fill = this.usageBarFills[index];
		const percentCode = usagePercentCode(used, total);
		fill.area.right = fill.area.left + fillWidth;
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

	/** Yield modal focus without accepting a branch or cancelling back to the present. */
	public dismiss(outcome = HostOverlayOutcome.Retain): void {
		this.transitionTo(HostOverlayPage.Closed, outcome);
	}

	private transitionTo(next: HostOverlayPage, outcome = HostOverlayOutcome.Cancel): void {
		const keyboardWasVisible = this.page === HostOverlayPage.Keyboard;
		switch (this.page) {
			case HostOverlayPage.Keyboard:
				this.keyboard.close();
				break;
			case HostOverlayPage.Rewind:
				if (outcome === HostOverlayOutcome.Accept) {
					this.execution.setPauseReason(HostPauseReason.Requested, false);
					this.rewind.resumeHere();
				}
				else if (outcome === HostOverlayOutcome.Cancel) this.rewind.returnToPresent();
				else if (outcome === HostOverlayOutcome.Retain && this.rewind.active) this.rewind.pauseSeek();
				break;
			case HostOverlayPage.Closed:
			case HostOverlayPage.Options:
			case HostOverlayPage.GamepadRemap:
				break;
		}
		this.page = next;
		if (keyboardWasVisible !== (next === HostOverlayPage.Keyboard)) {
			this.keyboardVisibilityListener?.(next === HostOverlayPage.Keyboard);
		}
		const sources = next === HostOverlayPage.Closed ? HostUiInputSource.None
			: next === HostOverlayPage.Keyboard ? HostUiInputSource.Gamepad | HostUiInputSource.LeftStick | HostUiInputSource.Pointer
				: HostUiInputSource.Gamepad | HostUiInputSource.LeftStick | HostUiInputSource.Keyboard | HostUiInputSource.Pointer;
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
				this.titleText = TITLE_TEXT;
				this.controllerPortRevision = this.input.controllerPortRevision;
				break;
			case HostOverlayPage.GamepadRemap: {
				this.options = this.remapOptions;
				this.selected = 0;
				this.titleText = `PLAYER ${this.remapPlayerIndex} CONTROLS`;
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
		const ui = this.uiInput;
		if (!ui.pointerHeld) this.keyboard.releaseSource(HostOnScreenKeyboard.POINTER_SOURCE);
		const pointerKey = ui.pointerValid && ui.pointerChanged
			? this.keyboard.selectAt(ui.pointerPosition.x, ui.pointerPosition.y) : -1;
		if (ui.pointerJustPressed && pointerKey >= 0) this.keyboard.activate(HostOnScreenKeyboard.POINTER_SOURCE);
		if (ui.buttonRepeatEdge(BUTTON_UP)) this.keyboard.moveVertical(-1);
		if (ui.buttonRepeatEdge(BUTTON_DOWN)) this.keyboard.moveVertical(1);
		if (ui.buttonRepeatEdge(BUTTON_LEFT)) this.keyboard.moveHorizontal(-1);
		if (ui.buttonRepeatEdge(BUTTON_RIGHT)) this.keyboard.moveHorizontal(1);
		for (let player = 0; player < Input.PLAYERS_MAX; player += 1) {
			const sourceBase = player * INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT;
			for (let button = 0; button < INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT; button += 1) {
				if (!ui.gamepadButtonPressed(player, button)) this.keyboard.releaseSource(sourceBase + button);
			}
			for (const binding of ON_SCREEN_KEYBOARD_COMMAND_BINDINGS) {
				if (ui.gamepadButtonJustPressed(player, binding.button)
					&& ui.gamepadButtonPressed(player, BUTTON_SELECT) === binding.requiresSelect) {
					this.keyboard.command(sourceBase + binding.button, binding.command);
				}
			}
		}
		return HostMenuInput.Inactive;
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
			return this.timeline.selectAt(x, y);
		}
		if (!point_in_rect(x, y, this.optionHitRect)) {
			return -1;
		}
		const index = this.optionFirstRow + (((y - this.optionHitRect.top) / this.optionLineHeight) | 0);
		if (index !== this.selected) {
			this.selected = index;
		}
		return index;
	}

}
