import type { Input } from './manager';
import { KeyModifier, type PlayerInput } from './player';
import type { BGamepadButton, ButtonState, InputHandler } from './models';

export type ShortcutDisposer = () => void;

type KeyboardShortcutEntry = {
	key: string;
	modifiers: KeyModifier;
	handler: () => void;
	latchKey: string;
};

type ControlChordEntry = {
	buttons: readonly BGamepadButton[];
	onPressed: () => void;
	onReleased?: () => void;
	keyboardActive: boolean;
	gamepadActive: boolean;
};

const pollControlChordSource = (
	handler: InputHandler | null,
	buttons: readonly BGamepadButton[],
	active: boolean,
): boolean => {
	if (handler === null) {
		return false;
	}
	let anyPressed = false;
	let allPressed = true;
	for (let index = 0; index < buttons.length; index += 1) {
		const state = handler.getButtonState(buttons[index]);
		if (state.pressed) {
			anyPressed = true;
			if (!active && state.consumed) {
				allPressed = false;
			}
		} else {
			allPressed = false;
		}
	}
	if (active) {
		if (!anyPressed) {
			return false;
		}
	} else if (!allPressed) {
		return false;
	}
	for (let index = 0; index < buttons.length; index += 1) {
		handler.consumeButton(buttons[index]);
	}
	return true;
};

export class GlobalShortcutRegistry {
	private readonly keyboardShortcuts = new Map<number, KeyboardShortcutEntry[]>();
	private readonly controlChords = new Map<number, ControlChordEntry[]>();
	private readonly latch = new Map<string, number | null>();

	public constructor(private readonly input: Input) {
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

	public registerControlChord(
		playerIndex: number,
		buttons: readonly BGamepadButton[],
		onPressed: () => void,
		onReleased?: () => void,
	): ShortcutDisposer {
		let entries = this.controlChords.get(playerIndex);
		if (!entries) {
			entries = [];
			this.controlChords.set(playerIndex, entries);
		}
		const entry: ControlChordEntry = {
			buttons,
			onPressed,
			onReleased,
			keyboardActive: false,
			gamepadActive: false,
		};
		entries.push(entry);
		return () => {
			const target = this.controlChords.get(playerIndex);
			if (!target) {
				return;
			}
			const idx = target.indexOf(entry);
			if (idx >= 0) {
				target.splice(idx, 1);
			}
			if (target.length === 0) {
				this.controlChords.delete(playerIndex);
			}
		};
	}

	public pollPlayer(player: PlayerInput): void {
		const keyboardEntries = this.keyboardShortcuts.get(player.playerIndex);
		const keyboard = player.inputHandlers['keyboard'];
		if (keyboardEntries && keyboard) {
			for (let i = 0; i < keyboardEntries.length; i++) {
				const entry = keyboardEntries[i];
				const shift = keyboard.getKeyState('ShiftLeft').pressed || keyboard.getKeyState('ShiftRight').pressed;
				const ctrl = keyboard.getKeyState('ControlLeft').pressed || keyboard.getKeyState('ControlRight').pressed;
				const alt = keyboard.getKeyState('AltLeft').pressed || keyboard.getKeyState('AltRight').pressed;
				const meta = keyboard.getKeyState('MetaLeft').pressed || keyboard.getKeyState('MetaRight').pressed;
				if (((entry.modifiers & KeyModifier.shift) !== 0 && !shift)
					|| ((entry.modifiers & KeyModifier.ctrl) !== 0 && !ctrl)
					|| ((entry.modifiers & KeyModifier.alt) !== 0 && !alt)
					|| ((entry.modifiers & KeyModifier.meta) !== 0 && !meta)) {
					this.release(entry.latchKey);
					continue;
				}
				const state = keyboard.getKeyState(entry.key);
				if (this.shouldAccept(entry.latchKey, state)) {
					entry.handler();
				}
			}
		}
		const chords = this.controlChords.get(player.playerIndex);
		if (chords) {
			for (let i = 0; i < chords.length; i++) {
				this.pollControlChord(player, chords[i]);
			}
		}
	}

	private pollControlChord(player: PlayerInput, entry: ControlChordEntry): void {
		const wasActive = entry.keyboardActive || entry.gamepadActive;
		entry.keyboardActive = pollControlChordSource(
			player.inputHandlers.keyboard,
			entry.buttons,
			entry.keyboardActive,
		);
		entry.gamepadActive = pollControlChordSource(
			player.inputHandlers.gamepad,
			entry.buttons,
			entry.gamepadActive,
		);
		const active = entry.keyboardActive || entry.gamepadActive;
		if (active === wasActive) {
			return;
		}
		if (active) {
			entry.onPressed();
		} else {
			entry.onReleased?.();
		}
	}

	private shouldAccept(code: string, state?: ButtonState): boolean {
		if (!state?.pressed) {
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
