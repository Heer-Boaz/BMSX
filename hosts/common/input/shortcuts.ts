import type { Input } from './manager';
import { KeyModifier, type PlayerInput } from './player';
import type { BGamepadButton, ButtonState, InputHandler } from './models';
import { inputControllerGamepadButtonBit } from './gamepad_buttons';

export type ShortcutDisposer = () => void;

export const HOST_CONTROL_MODIFIER: BGamepadButton = 'select';
export const HOST_TERMINAL_BUTTON: BGamepadButton = 'lb';
export const HOST_IDE_BUTTON: BGamepadButton = 'rb';
export const HOST_MENU_BUTTON: BGamepadButton = 'start';
export const HOST_ON_SCREEN_KEYBOARD_BUTTON: BGamepadButton = 'x';
export const HOST_REWIND_BUTTON: BGamepadButton = 'a';
export const HOST_SUPERVISOR_KEY_CODE = 'ScrollLock';

export const enum ControlSource {
	Keyboard = 1,
	Gamepad = 2,
}

type KeyboardShortcutEntry = {
	key: string;
	modifiers: KeyModifier;
	handler: () => void;
	latchKey: string;
};

type ControlShortcutEntry = {
	button: BGamepadButton;
	buttonMask: number;
	sources: number;
	onPressed: () => void;
	onReleased?: () => void;
	activeSources: number;
	blockedSources: number;
	notifiedActive: boolean;
};

type ControlShortcutSet = {
	entries: ControlShortcutEntry[];
	capturedSources: number;
};

export class GlobalShortcutRegistry {
	private readonly keyboardShortcuts = new Map<number, KeyboardShortcutEntry[]>();
	private readonly controlShortcuts = new Map<number, ControlShortcutSet>();
	private readonly latch = new Map<string, number | null>();
	private gamepadControlShortcutMask: number | null = null;

	public constructor(private readonly input: Input) {
	}

	public reset(): void {
		this.latch.clear();
		this.gamepadControlShortcutMask = null;
		this.resetControlShortcutSources(ControlSource.Keyboard | ControlSource.Gamepad);
	}

	/** Null leaves all registered gamepad targets available; a page supplies its eligible target bits. */
	public setGamepadControlShortcutMask(mask: number | null): void {
		if (mask === this.gamepadControlShortcutMask) {
			return;
		}
		this.gamepadControlShortcutMask = mask;
		this.resetControlShortcutSources(ControlSource.Gamepad);
	}

	private resetControlShortcutSources(sources: number): void {
		for (const shortcuts of this.controlShortcuts.values()) {
			shortcuts.capturedSources &= ~sources;
			for (let index = 0; index < shortcuts.entries.length; index += 1) {
				const entry = shortcuts.entries[index];
				entry.activeSources &= ~sources;
				entry.blockedSources &= ~sources;
				if (entry.notifiedActive && entry.activeSources === 0) {
					entry.notifiedActive = false;
					entry.onReleased?.();
				}
			}
		}
	}

	public registerKeyboardShortcut(playerIndex: number, key: string, handler: () => void, modifiers: KeyModifier = KeyModifier.none): ShortcutDisposer {
		this.input.setKeyboardCapture(key, true);
		let shortcuts = this.keyboardShortcuts.get(playerIndex);
		if (!shortcuts) {
			shortcuts = [];
			this.keyboardShortcuts.set(playerIndex, shortcuts);
		}
		const latchKey = `keyboard:${playerIndex}:${key}:${modifiers}`;
		const entry = { key, modifiers, handler, latchKey };
		shortcuts.push(entry);
		return () => {
			const target = this.keyboardShortcuts.get(playerIndex);
			if (!target) return;
			const idx = target.indexOf(entry);
			if (idx >= 0) {
				target.splice(idx, 1);
			}
			if (target.length === 0) {
				this.keyboardShortcuts.delete(playerIndex);
			}
			this.latch.delete(latchKey);
		};
	}

	public registerControlShortcut(
		playerIndex: number,
		button: BGamepadButton,
		onPressed: () => void,
		onReleased?: () => void,
		sources = ControlSource.Keyboard | ControlSource.Gamepad,
	): ShortcutDisposer {
		let shortcuts = this.controlShortcuts.get(playerIndex);
		if (!shortcuts) {
			shortcuts = {
				entries: [],
				capturedSources: 0,
			};
			this.controlShortcuts.set(playerIndex, shortcuts);
		}
		const entry: ControlShortcutEntry = {
			button,
			buttonMask: 1 << inputControllerGamepadButtonBit(button),
			sources,
			onPressed,
			onReleased,
			activeSources: 0,
			blockedSources: 0,
			notifiedActive: false,
		};
		shortcuts.entries.push(entry);
		return () => {
			const target = this.controlShortcuts.get(playerIndex);
			if (!target) {
				return;
			}
			const entryIndex = target.entries.indexOf(entry);
			if (entryIndex >= 0) {
				target.entries.splice(entryIndex, 1);
			}
			if (target.entries.length === 0) {
				this.controlShortcuts.delete(playerIndex);
			}
		};
	}

	public pollPlayer(player: PlayerInput): void {
		// Physical host chords route their contribution before editor key commands.
		const shortcuts = this.controlShortcuts.get(player.playerIndex);
		if (shortcuts) this.pollControlShortcut(player, shortcuts);
		const keyboardEntries = this.keyboardShortcuts.get(player.playerIndex);
		const keyboard = player.inputHandlers['keyboard'];
		if (keyboardEntries && keyboard) {
			for (let i = 0; i < keyboardEntries.length; i++) {
				const entry = keyboardEntries[i];
				const modifiers = player.getModifiers();
				if ((modifiers & entry.modifiers) !== entry.modifiers) {
					this.release(entry.latchKey);
					continue;
				}
				const state = keyboard.getKeyState(entry.key);
				if (this.shouldAccept(entry.latchKey, state)) {
					entry.handler();
				}
			}
		}
	}

	private pollControlShortcut(player: PlayerInput, shortcuts: ControlShortcutSet): void {
		const entries = shortcuts.entries;
		this.pollControlShortcutSource(
			player.inputHandlers.keyboard,
			shortcuts,
			ControlSource.Keyboard,
		);
		this.pollControlShortcutSource(
			player.inputHandlers.gamepad,
			shortcuts,
			ControlSource.Gamepad,
		);
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const active = entry.activeSources !== 0;
			if (active === entry.notifiedActive) {
				continue;
			}
			entry.notifiedActive = active;
			if (active) {
				entry.onPressed();
			} else {
				entry.onReleased?.();
			}
		}
	}

	private pollControlShortcutSource(
		handler: InputHandler | null,
		shortcuts: ControlShortcutSet,
		source: ControlSource,
	): void {
		const entries = shortcuts.entries;
		const allowedTargets = source === ControlSource.Gamepad
			? this.gamepadControlShortcutMask
			: null;
		if (handler === null) {
			shortcuts.capturedSources &= ~source;
			for (let index = 0; index < entries.length; index += 1) {
				entries[index].activeSources &= ~source;
				entries[index].blockedSources &= ~source;
			}
			return;
		}
		const modifier = handler.getButtonState(HOST_CONTROL_MODIFIER);
		let captured = (shortcuts.capturedSources & source) !== 0;
		if (!captured && modifier.pressed) {
			captured = true;
			shortcuts.capturedSources |= source;
			for (let index = 0; index < entries.length; index += 1) {
				const entry = entries[index];
				if ((entry.sources & source) === 0 || (allowedTargets !== null && (entry.buttonMask & allowedTargets) === 0)) {
					entry.blockedSources &= ~source;
					continue;
				}
				const button = handler.getButtonState(entry.button);
				if (button.pressed && !button.justpressed) {
					entry.blockedSources |= source;
				} else {
					entry.blockedSources &= ~source;
				}
			}
		}
		if (!captured) {
			for (let index = 0; index < entries.length; index += 1) {
				entries[index].activeSources &= ~source;
				entries[index].blockedSources &= ~source;
			}
			return;
		}

		handler.consumeButton(HOST_CONTROL_MODIFIER);
		let anyButtonPressed = false;
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if ((entry.sources & source) === 0 || (allowedTargets !== null && (entry.buttonMask & allowedTargets) === 0)) {
				entry.activeSources &= ~source;
				entry.blockedSources &= ~source;
				continue;
			}
			const button = handler.getButtonState(entry.button);
			if (!button.pressed) {
				entry.blockedSources &= ~source;
			} else {
				anyButtonPressed = true;
				if (!modifier.pressed) {
					entry.blockedSources |= source;
				}
			}
			if (modifier.pressed
				&& button.pressed
				&& (entry.blockedSources & source) === 0) {
				entry.activeSources |= source;
			} else {
				entry.activeSources &= ~source;
			}
			handler.consumeButton(entry.button);
		}
		if (!modifier.pressed && !anyButtonPressed) {
			shortcuts.capturedSources &= ~source;
		}
	}

	private shouldAccept(code: string, state?: ButtonState): boolean {
		if (!state?.pressed || state.consumed) {
			this.latch.delete(code);
			return false;
		}
		const existing = this.latch.get(code) ;
		if (state.pressId) {
			if (existing === state.pressId) {
				return false;
			}
			this.latch.set(code, state.pressId);
			return true;
		}
		if (!state.justpressed) {
			return false;
		}
		this.latch.set(code, null);
		return true;
	}

	private release(code: string, state?: ButtonState): void {
		if (state?.pressed) {
			return;
		}
		this.latch.delete(code);
	}
}
