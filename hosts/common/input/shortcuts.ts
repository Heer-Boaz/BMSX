import type { Input } from './manager';
import { KeyModifier, type PlayerInput } from './player';
import type { BGamepadButton, ButtonState } from './models';

export type ShortcutDisposer = () => void;

type KeyboardShortcutEntry = {
	key: string;
	modifiers: KeyModifier;
	handler: () => void;
	latchKey: string;
};

type ControlChordEntry = {
	buttons: readonly BGamepadButton[];
	handler: () => void;
	active: boolean;
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
		handler: () => void,
	): ShortcutDisposer {
		let entries = this.controlChords.get(playerIndex);
		if (!entries) {
			entries = [];
			this.controlChords.set(playerIndex, entries);
		}
		const entry: ControlChordEntry = { buttons, handler, active: false };
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
				const shift = keyboard.getButtonState('ShiftLeft').pressed || keyboard.getButtonState('ShiftRight').pressed;
				const ctrl = keyboard.getButtonState('ControlLeft').pressed || keyboard.getButtonState('ControlRight').pressed;
				const alt = keyboard.getButtonState('AltLeft').pressed || keyboard.getButtonState('AltRight').pressed;
				const meta = keyboard.getButtonState('MetaLeft').pressed || keyboard.getButtonState('MetaRight').pressed;
				if (((entry.modifiers & KeyModifier.shift) !== 0 && !shift)
					|| ((entry.modifiers & KeyModifier.ctrl) !== 0 && !ctrl)
					|| ((entry.modifiers & KeyModifier.alt) !== 0 && !alt)
					|| ((entry.modifiers & KeyModifier.meta) !== 0 && !meta)) {
					this.release(entry.latchKey);
					continue;
				}
				const state = keyboard.getButtonState(entry.key);
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
		const keyboard = player.inputHandlers['keyboard'];
		const gamepad = player.inputHandlers['gamepad'];
		let keyboardPressed = keyboard !== null;
		let gamepadPressed = gamepad !== null;
		for (let i = 0; i < entry.buttons.length; i++) {
			const button = entry.buttons[i];
			if (keyboardPressed && !keyboard.getButtonState(button).pressed) {
				keyboardPressed = false;
			}
			if (gamepadPressed && !gamepad.getButtonState(button).pressed) {
				gamepadPressed = false;
			}
		}
		const active = keyboardPressed || gamepadPressed;
		if (active === entry.active) {
			return;
		}
		entry.active = active;
		if (active) {
			entry.handler();
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
