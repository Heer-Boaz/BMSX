import { Input } from './input';
import { KeyModifier, type PlayerInput } from './playerinput';
import type { ButtonState } from './inputtypes';

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
	private readonly latch = new Map<string, number>();

	public registerKeyboardShortcut(playerIndex: number, key: string, handler: () => void, modifiers: KeyModifier = KeyModifier.none): ShortcutDisposer {
		Input.instance.setKeyboardCapture(key, true);
		const shortcuts = this.keyboardShortcuts.get(playerIndex) ?? [];
		if (!this.keyboardShortcuts.has(playerIndex)) {
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
		const entries = this.gamepadChords.get(playerIndex) ?? [];
		if (!this.gamepadChords.has(playerIndex)) {
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
		if (keyboardEntries) {
			for (let i = 0; i < keyboardEntries.length; i++) {
				const entry = keyboardEntries[i];
				const state = player.getKeyState(entry.key, entry.modifiers);
				if (this.shouldAccept(entry.latchKey, state)) {
					entry.handler();
				}
			}
		}
		const chords = this.gamepadChords.get(player.playerIndex);
		if (chords) {
			for (let i = 0; i < chords.length; i++) {
				this.pollGamepadChord(player, chords[i]);
			}
		}
	}

	private pollGamepadChord(player: PlayerInput, entry: { buttons: string[]; handler: () => void; latchKeys: string[] }): void {
		let allPressed = true;
		const states: Array<ButtonState> = [];
		for (let i = 0; i < entry.buttons.length; i++) {
			const state = player.getButtonState(entry.buttons[i], 'gamepad');
			states.push(state);
			if (!state || state.pressed !== true) {
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

	private shouldAccept(code: string, state: ButtonState): boolean {
		if (!state || state.pressed !== true) {
			this.latch.delete(code);
			return false;
		}
		const pressId = typeof state.pressId === 'number' ? state.pressId : null;
		const existing = this.latch.get(code) ;
		if (pressId !== null) {
			if (existing === pressId) {
				return false;
			}
			this.latch.set(code, pressId);
			return true;
		}
		if (state.justpressed !== true) {
			return false;
		}
		this.latch.set(code, null);
		return true;
	}

	private release(code: string, state: ButtonState): void {
		if (state && state.pressed === true) {
			return;
		}
		this.latch.delete(code);
	}
}
