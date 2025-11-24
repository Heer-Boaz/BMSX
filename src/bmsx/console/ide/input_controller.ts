import { $ } from '../../core/game';
import type { KeyboardInput } from '../../input/keyboardinput';
import { isKeyJustPressed as isKeyJustPressedGlobal, isModifierPressed as isModifierPressedGlobal, isKeyTyped as isKeyTypedGlobal, shouldAcceptKeyPress as shouldAcceptKeyPressGlobal, clearKeyPressRecord } from './input_helpers';
import * as constants from './constants';
import { CHARACTER_CODES, CHARACTER_MAP } from './character_map';
import { handleDebuggerShortcuts } from './debugger_shortcuts';
import { consumeIdeKey, getIdeKeyState } from './player_input_adapter';
import { resetActionPromptState, closeCreateResourcePrompt, closeSymbolSearch, closeResourceSearch, closeLineJump } from './console_cart_editor';
import { closeSearch } from './editor_search';
import { ide_state } from './ide_state';

export interface InputHost {
	// State queries
	getPlayerIndex(): number;
	isCodeTabActive(): boolean;
	// Text buffer
	getLines(): string[];
	setLines(lines: string[]): void;
	getCursorRow(): number;
	getCursorColumn(): number;
	setCursorPosition(row: number, column: number): void;
	setSelectionAnchor(row: number, column: number): void;
	getSelection(): { start: { row: number; column: number }; end: { row: number; column: number } } | null;
	clearSelection(): void;
	// Rendering/layout helpers
	updateDesiredColumn(): void;
	resetBlink(): void;
	revealCursor(): void;
	ensureCursorVisible(): void;
	// History/undo stack hooks
	recordPreMutationSnapshot(key: string): void;
	pushPostMutationSnapshot(key: string): void;
	// High-level editor ops already exist on host
	deleteSelection(): void;
	deleteCharLeft(): void;
	deleteCharRight(): void;
	deleteActiveLines(): void;
	deleteWordBackward(): void;
	deleteWordForward(): void;
	insertNewline(): void;
	insertText(text: string): void;
	moveCursorLeft(byWord: boolean, select: boolean): void;
	moveCursorRight(byWord: boolean, select: boolean): void;
	moveCursorUp(select: boolean): void;
	moveCursorDown(select: boolean): void;
	moveCursorHome(select: boolean): void;
	moveCursorEnd(select: boolean): void;
	pageDown(select: boolean): void;
	pageUp(select: boolean): void;
	moveSelectionLines(delta: number): void;
	indentSelectionOrLine(): void;
	unindentSelectionOrLine(): void;
	navigateBackward(): void;
	navigateForward(): void;
	toggleBreakpointAtCursor(): void;
}

export class InputController {
	private readonly host: InputHost;
	private readonly repeatState: Map<string, { cooldown: number }> = new Map();

	constructor(host: InputHost) {
		this.host = host;
	}

	public handleEditorInput(
		keyboard: KeyboardInput,
		deltaSeconds: number,
	): void {
		const idx = this.host.getPlayerIndex();
		const ctrlDown = isModifierPressedGlobal('ControlLeft') || isModifierPressedGlobal('ControlRight');
		const shiftDown = isModifierPressedGlobal('ShiftLeft') || isModifierPressedGlobal('ShiftRight');
		const metaDown = isModifierPressedGlobal('MetaLeft') || isModifierPressedGlobal('MetaRight');
		const altDown = isModifierPressedGlobal('AltLeft') || isModifierPressedGlobal('AltRight');

		if (handleDebuggerShortcuts({
			keyboard,
			playerIndex: idx,
			ctrlDown,
			shiftDown,
			altDown,
			metaDown,
		})) {
			return;
		}
		if (isKeyJustPressedGlobal('F9')) {
			consumeIdeKey('F9');
			this.host.toggleBreakpointAtCursor();
			return;
		}
		// Navigation
		this.handleNavigationKeys(deltaSeconds, shiftDown, ctrlDown, altDown);
		// Editing
		this.handleEditingKeys(deltaSeconds, shiftDown, ctrlDown);
		if (ctrlDown || metaDown || altDown) return;
		// Characters
		this.handleCharacterInput(shiftDown);
		if (isKeyJustPressedGlobal('Space')) {
			this.host.insertText(' ');
			consumeIdeKey('Space');
		}
	}

	private handleNavigationKeys(deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, altDown: boolean): void {
		// Alt+Arrow: move selection lines up/down
		if (altDown) {
			if (!ctrlDown && !shiftDown) {
				if (isKeyJustPressedGlobal('ArrowLeft')) {
					consumeIdeKey('ArrowLeft');
					this.host.navigateBackward();
					return;
				}
				if (isKeyJustPressedGlobal('ArrowRight')) {
					consumeIdeKey('ArrowRight');
					this.host.navigateForward();
					return;
				}
			}
			let movedAlt = false;
			const altUpJustPressed = isKeyJustPressedGlobal('ArrowUp');
			const altUpRepeat = !altUpJustPressed && this.shouldRepeat('ArrowUp', deltaSeconds);
			if (altUpJustPressed || altUpRepeat) {
				consumeIdeKey('ArrowUp');
				this.host.moveSelectionLines(-1);
				movedAlt = true;
			}
			const altDownJustPressed = isKeyJustPressedGlobal('ArrowDown');
			const altDownRepeat = !altDownJustPressed && this.shouldRepeat('ArrowDown', deltaSeconds);
			if (altDownJustPressed || altDownRepeat) {
				consumeIdeKey('ArrowDown');
				this.host.moveSelectionLines(1);
				movedAlt = true;
			}
			if (movedAlt) {
				return;
			}
			return;
		}
		// Arrow keys
		if (this.shouldRepeat('ArrowLeft', deltaSeconds)) {
			consumeIdeKey('ArrowLeft');
			this.host.moveCursorLeft(ctrlDown, shiftDown);
			return;
		}
		if (this.shouldRepeat('ArrowRight', deltaSeconds)) {
			consumeIdeKey('ArrowRight');
			this.host.moveCursorRight(ctrlDown, shiftDown);
			return;
		}
		if (this.shouldRepeat('ArrowUp', deltaSeconds)) {
			consumeIdeKey('ArrowUp');
			this.host.moveCursorUp(shiftDown);
			return;
		}
		if (this.shouldRepeat('ArrowDown', deltaSeconds)) {
			consumeIdeKey('ArrowDown');
			this.host.moveCursorDown(shiftDown);
			return;
		}
		// Home/End
		if (this.shouldRepeat('Home', deltaSeconds)) {
			consumeIdeKey('Home');
			this.host.moveCursorHome(shiftDown);
			return;
		}
		if (this.shouldRepeat('End', deltaSeconds)) {
			consumeIdeKey('End');
			this.host.moveCursorEnd(shiftDown);
			return;
		}
		// PageUp/PageDown
		if (this.shouldRepeat('PageDown', deltaSeconds)) {
			consumeIdeKey('PageDown');
			this.host.pageDown(shiftDown);
			return;
		}
		if (this.shouldRepeat('PageUp', deltaSeconds)) {
			consumeIdeKey('PageUp');
			this.host.pageUp(shiftDown);
			return;
		}
	}

	private handleEditingKeys(deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean): void {
		// Tab / Shift+Tab
		if (isKeyJustPressedGlobal('Tab')) {
			consumeIdeKey('Tab');
			if (shiftDown) this.host.unindentSelectionOrLine(); else this.host.insertText('\t');
			return;
		}
		// Backspace/Delete
		if (this.shouldRepeat('Backspace', deltaSeconds)) {
			consumeIdeKey('Backspace');
			if (ctrlDown) {
				this.host.deleteWordBackward();
			} else if (this.host.getSelection()) {
				this.host.deleteSelection();
			} else {
				this.host.deleteCharLeft();
			}
			return;
		}
		if (this.shouldRepeat('Delete', deltaSeconds)) {
			consumeIdeKey('Delete');
			if (shiftDown && !ctrlDown) {
				this.host.deleteActiveLines();
			} else if (ctrlDown) {
				this.host.deleteWordForward();
			} else if (this.host.getSelection()) {
				this.host.deleteSelection();
			} else {
				this.host.deleteCharRight();
			}
			return;
		}
		// Enter
		if (isKeyJustPressedGlobal('Enter') || isKeyJustPressedGlobal('NumpadEnter')) {
			consumeIdeKey('Enter');
			this.host.insertNewline();
			return;
		}
	}

	private handleCharacterInput(shiftDown: boolean): void {
		for (let i = 0; i < CHARACTER_CODES.length; i++) {
			const code = CHARACTER_CODES[i];
			if (!isKeyTypedGlobal(code)) continue;
			const entry = CHARACTER_MAP[code];
			const value = shiftDown ? entry.shift : entry.normal;
			if (value && value.length > 0) {
				this.host.insertText(value);
			}
			consumeIdeKey(code);
		}
	}

	// Repeat helper bridged to editor's repeat system via shouldAccept logic
	private shouldRepeat(code: string, deltaSeconds: number): boolean {
		const state = getIdeKeyState(code, this.host.getPlayerIndex());
		if (!state || state.pressed !== true) {
			this.repeatState.delete(code);
			clearKeyPressRecord(code);
			return false;
		}
		let entry = this.repeatState.get(code);
		if (!entry) {
			entry = { cooldown: constants.INITIAL_REPEAT_DELAY };
			this.repeatState.set(code, entry);
		}
		if (shouldAcceptKeyPressGlobal(code, state)) {
			entry.cooldown = constants.INITIAL_REPEAT_DELAY;
			return true;
		}
		entry.cooldown -= deltaSeconds;
		if (entry.cooldown <= 0) {
			entry.cooldown = constants.REPEAT_INTERVAL;
			return true;
		}
		this.repeatState.set(code, entry);
		return false;
	}

	// Expose repeat for other controllers (e.g. completion controller)
	public shouldRepeatPublic(_keyboard: KeyboardInput, code: string, deltaSeconds: number): boolean {
		return this.shouldRepeat(code, deltaSeconds);
	}

	public resetRepeats(): void {
		this.repeatState.clear();
	}

	// Apply input overrides (debug hotkeys + keyboard capture)
	public applyOverrides(active: boolean, captureKeys: readonly string[]): void {
		const input = $.input;
		input.setDebugHotkeysPaused(active);
		for (let i = 0; i < captureKeys.length; i++) {
			input.setKeyboardCapture(captureKeys[i], active);
		}
	}
}

type EscapeHandlingOptions = { allowRuntimeErrorToggle?: boolean; };

export function handleEscapeKey(options?: EscapeHandlingOptions): boolean {
	const allowRuntimeErrorToggle = options?.allowRuntimeErrorToggle !== false;
	if (ide_state.pendingActionPrompt) {
		resetActionPromptState();
		return true;
	}
	const overlay = ide_state.runtimeErrorOverlay;
	if (ide_state.createResourceVisible) {
		closeCreateResourcePrompt(true);
		return true;
	}
	if (ide_state.symbolSearchActive || ide_state.symbolSearchVisible) {
		closeSymbolSearch(false);
		return true;
	}
	if (ide_state.resourceSearchActive || ide_state.resourceSearchVisible) {
		closeResourceSearch(false);
		return true;
	}
	if (ide_state.lineJumpActive || ide_state.lineJumpVisible) {
		closeLineJump(false);
		return true;
	}
	if (ide_state.searchActive || ide_state.searchVisible) {
		closeSearch(false, true);
		return true;
	}
	if (overlay && allowRuntimeErrorToggle) {
		overlay.hidden = !overlay.hidden;
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		overlay.layout = null;
		ide_state.message.visible = false;
		return true;
	}
	return false;
}
