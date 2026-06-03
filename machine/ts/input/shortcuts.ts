import { Input } from './manager';
import { KeyModifier, type PlayerInput } from './player';
import type { ButtonState } from './models';

export type ShortcutDisposer = () => void;

type KeyboardShortcutEntry = {
	key: string;
	modifiers: KeyModifier;
	handler: () => void;
	latchKey: string;
};

export class GlobalShortcutRegistry {
	private readonly keyboardShortcuts = new Map<number, KeyboardShortcutEntry[]>();
	private readonly gamepadChords = new Map<number, Array<{ buttons: string[]; handler: () => void; latchKeys: string[] }>>();
	private readonly latch = new Map<string, number | null>();

	public registerKeyboardShortcut(playerIndex: number, key: string, handler: () => void, modifiers: KeyModifier = KeyModifier.none): ShortcutDisposer {
		Input.instance.setKeyboardCapture(key, true);
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

	public registerGamepadChord(playerIndex: number, buttons: readonly string[], handler: () => void): ShortcutDisposer {
		if (!buttons || buttons.length === 0) {
			throw new Error('[GlobalShortcutRegistry] Gamepad chord must include at least one button.');
		}
		const normalized = buttons.map(button => {
			if (!button) {
				throw new Error('[GlobalShortcutRegistry] Invalid gamepad button specified.');
			}
			return button;
		});
		let entries = this.gamepadChords.get(playerIndex);
		if (!entries) {
			entries = [];
			this.gamepadChords.set(playerIndex, entries);
		}
		const latchKeys = normalized.map((button, index) => `gamepad:${playerIndex}:${button}:${index}`);
		entries.push({ buttons: normalized, handler, latchKeys });
		return () => {
			const target = this.gamepadChords.get(playerIndex);
			if (!target) {
				return;
			}
			const idx = target.findIndex(candidate => candidate.handler === handler && candidate.buttons === normalized);
			if (idx >= 0) {
				const removed = target.splice(idx, 1)[0];
				for (let i = 0; i < removed.latchKeys.length; i++) {
					this.latch.delete(removed.latchKeys[i]);
				}
			}
			if (target.length === 0) {
				this.gamepadChords.delete(playerIndex);
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
		const chords = this.gamepadChords.get(player.playerIndex);
		const gamepad = player.inputHandlers['gamepad'];
		if (chords) {
			for (let i = 0; i < chords.length; i++) {
				this.pollGamepadChord(gamepad, chords[i]);
			}
		}
	}

	private pollGamepadChord(gamepad: PlayerInput['inputHandlers']['gamepad'], entry: { buttons: string[]; handler: () => void; latchKeys: string[] }): void {
		let allPressed = true;
		const states: Array<ButtonState | undefined> = [];
		for (let i = 0; i < entry.buttons.length; i++) {
			let state: ButtonState | undefined;
			if (gamepad) {
				state = gamepad.getButtonState(entry.buttons[i]);
			}
			states.push(state);
			if (!state?.pressed) {
				allPressed = false;
			}
		}
		if (!allPressed) {
			for (let i = 0; i < entry.latchKeys.length; i++) {
				this.release(entry.latchKeys[i], states[i]);
			}
			return;
		}
		for (let i = 0; i < states.length; i++) {
			if (this.shouldAccept(entry.latchKeys[i], states[i])) {
				entry.handler();
				return;
			}
		}
	}

	private shouldAccept(code: string, state?: ButtonState): boolean {
		if (!state?.pressed) {
			this.latch.delete(code);
			return false;
		}
		const existing = this.latch.get(code) ;
		if (typeof state.pressId === 'number') {
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
