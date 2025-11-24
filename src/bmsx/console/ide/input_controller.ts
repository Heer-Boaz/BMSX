import { $ } from '../../core/game';
import * as constants from './constants';
import { CHARACTER_CODES, CHARACTER_MAP } from './character_map';
import { consumeIdeKey, getIdeKeyState } from './player_input_adapter';
import { resetActionPromptState, closeCreateResourcePrompt, closeSymbolSearch, closeResourceSearch, closeLineJump, activate, deactivate, closeActiveTab, focusEditorFromProblemsPanel, handleActionPromptSelection, handleCompletionKeybindings, handleCreateResourceInput, handleLineJumpInput, handleResourceSearchInput, handleResourceViewerInput, handleSearchInput, handleSymbolSearchInput, hideProblemsPanel, indentSelectionOrLine, markDiagnosticsDirty, notifyReadOnlyEdit, openCreateResourcePrompt, openGlobalSymbolSearch, openLineJump, openReferenceSearchPopup, openRenamePrompt, openResourceSearch, openSymbolSearch, redo, save, toggleLineComments, toggleProblemsPanel, toggleResolutionMode, toggleResourcePanel, toggleResourcePanelFilterMode, undo, unindentSelectionOrLine, updateDesiredColumn, openDebugPanelTab, performAction, toggleWordWrap } from './console_cart_editor';
import { applyDocumentFormatting, copySelectionToClipboard, cutLineToClipboard, cutSelectionToClipboard, pasteFromClipboard } from './text_editing_and_selection';
import { resetBlink } from './render_caret';
import { closeSearch, jumpToNextMatch, jumpToPreviousMatch, openSearch } from './editor_search';
import { ide_state } from './ide_state';
import { ESCAPE_KEY } from './constants';
import type { ButtonState } from '../../input/inputtypes';
import type { KeyPressRecord, TopBarButtonId } from './types';
import { moveCursorDown, moveCursorEnd, moveCursorHome, moveCursorLeft, moveCursorRight, moveCursorUp, pageDown, pageUp, revealCursor } from './cursor_operations';
import { isResourceViewActive, isCodeTabActive, isEditableCodeTab, isReadOnlyCodeTab, cycleTab, activateCodeTab } from './editor_tabs';
import * as TextEditing from './text_editing_and_selection';
import { prepareDebuggerStepOverlay } from './debugger_overlay_controller';
import { debuggerCommandExecutor } from './debugger_controls';

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
		deltaSeconds: number,
	): void {
		if (handleDebuggerShortcuts()) {
			return;
		}
		if (isKeyJustPressed('F9')) {
			consumeIdeKey('F9');
			this.host.toggleBreakpointAtCursor();
			return;
		}
		// Navigation
		this.handleNavigationKeys(deltaSeconds);
		// Editing
		this.handleEditingKeys(deltaSeconds);
		const { ctrlDown, metaDown, altDown } = { ctrlDown: isCtrlDown(), metaDown: isMetaDown(), altDown: isAltDown() };

		if (ctrlDown || metaDown || altDown) return;
		// Characters
		this.handleCharacterInput();
		if (isKeyJustPressed('Space')) {
			this.host.insertText(' ');
			consumeIdeKey('Space');
		}
	}

	private handleNavigationKeys(deltaSeconds: number): void {
		// Alt+Arrow: move selection lines up/down
		const { ctrlDown, shiftDown, altDown } = { ctrlDown: isCtrlDown(), shiftDown: isShiftDown(), altDown: isAltDown() };

		if (altDown) {
			if (!ctrlDown && !shiftDown) {
				if (isKeyJustPressed('ArrowLeft')) {
					consumeIdeKey('ArrowLeft');
					this.host.navigateBackward();
					return;
				}
				if (isKeyJustPressed('ArrowRight')) {
					consumeIdeKey('ArrowRight');
					this.host.navigateForward();
					return;
				}
			}
			let movedAlt = false;
			const altUpJustPressed = isKeyJustPressed('ArrowUp');
			const altUpRepeat = !altUpJustPressed && this.shouldRepeat('ArrowUp', deltaSeconds);
			if (altUpJustPressed || altUpRepeat) {
				consumeIdeKey('ArrowUp');
				this.host.moveSelectionLines(-1);
				movedAlt = true;
			}
			const altDownJustPressed = isKeyJustPressed('ArrowDown');
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
			moveCursorLeft();
			return;
		}
		if (this.shouldRepeat('ArrowRight', deltaSeconds)) {
			consumeIdeKey('ArrowRight');
			moveCursorRight();
			return;
		}
		if (this.shouldRepeat('ArrowUp', deltaSeconds)) {
			consumeIdeKey('ArrowUp');
			moveCursorUp();
			return;
		}
		if (this.shouldRepeat('ArrowDown', deltaSeconds)) {
			consumeIdeKey('ArrowDown');
			moveCursorDown();
			return;
		}
		// Home/End
		if (this.shouldRepeat('Home', deltaSeconds)) {
			consumeIdeKey('Home');
			moveCursorHome();
			return;
		}
		if (this.shouldRepeat('End', deltaSeconds)) {
			consumeIdeKey('End');
			moveCursorEnd();
			return;
		}
		// PageUp/PageDown
		if (this.shouldRepeat('PageDown', deltaSeconds)) {
			consumeIdeKey('PageDown');
			pageDown();
			return;
		}
		if (this.shouldRepeat('PageUp', deltaSeconds)) {
			consumeIdeKey('PageUp');
			pageUp();
			return;
		}
	}

	private handleEditingKeys(deltaSeconds: number): void {
		// Tab / Shift+Tab
		const { ctrlDown, shiftDown } = { ctrlDown: isCtrlDown(), shiftDown: isShiftDown() };
		if (isKeyJustPressed('Tab')) {
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
		if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
			consumeIdeKey('Enter');
			this.host.insertNewline();
			return;
		}
	}

	private handleCharacterInput(): void {
		for (let i = 0; i < CHARACTER_CODES.length; i++) {
			const code = CHARACTER_CODES[i];
			if (!isKeyTyped(code)) continue;
			const entry = CHARACTER_MAP[code];
			const value = isShiftDown() ? entry.shift : entry.normal;
			if (value && value.length > 0) {
				this.host.insertText(value);
			}
			consumeIdeKey(code);
		}
	}

	// Repeat helper bridged to editor's repeat system via shouldAccept logic
	public shouldRepeat(code: string, deltaSeconds: number): boolean {
		const state = getIdeKeyState(code);
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
		if (shouldAcceptKeyPress(code, state)) {
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

// TODO: Should use existing input handling logic and helpers instead of duplicating here
export function handleEscapeShortcut(): boolean {
	const state = getIdeKeyState(ESCAPE_KEY);
	if (!state || state.pressed !== true) {
		ide_state.lastEscapePressId = null;
		return false;
	}
	const pressId = state.pressId;
	const allow = shouldAcceptKeyPress(ESCAPE_KEY, state)
		|| state.justpressed === true
		|| (pressId !== null && pressId !== ide_state.lastEscapePressId);
	if (!allow) return false;
	ide_state.lastEscapePressId = pressId;
	const handled = handleEscapeKey({ allowRuntimeErrorToggle: true });
	if (handled) {
		consumeIdeKey(ESCAPE_KEY);
	}
	return handled;
}

export function toggleEditorFromShortcut(): void {
	const intercepted = handleEscapeKey({ allowRuntimeErrorToggle: false });
	if (intercepted) {
		return;
	}
	if (ide_state.active) {
		deactivate();
	} else {
		activate();
	}
}

const keyPressRecords = new Map<string, KeyPressRecord>();

export function resetKeyPressRecords(): void {
	keyPressRecords.clear();
}

export function clearKeyPressRecord(code: string): void {
	keyPressRecords.delete(code);
}
function recordKeyState(code: string, state: ButtonState, latched: boolean): void {
	const pressId = state.pressId ?? null;
	keyPressRecords.set(code, { lastPressId: pressId, downLatched: latched });
}

export function shouldAcceptKeyPress(code: string, state: ButtonState): boolean {
	if (state.pressed !== true) {
		keyPressRecords.delete(code);
		return false;
	}
	if (state.consumed === true) {
		recordKeyState(code, state, true);
		return false;
	}
	const existing = keyPressRecords.get(code);
	if (existing?.downLatched) {
		return false;
	}
	if (state.justpressed === true) {
		recordKeyState(code, state, true);
		return true;
	}
	if (!existing) {
		recordKeyState(code, state, true);
		return true;
	}
	return false;
}

export function isKeyJustPressed(code: string): boolean {
	const state = getIdeKeyState(code);
	return state ? shouldAcceptKeyPress(code, state) : false;
}

export function isModifierPressed(code: string): boolean {
	const state = getIdeKeyState(code);
	return state ? state.pressed === true : false;
}

export function isCtrlDown(): boolean {
	return isModifierPressed('ControlLeft') || isModifierPressed('ControlRight');
}

export function isAltDown(): boolean {
	return isModifierPressed('AltLeft') || isModifierPressed('AltRight');
}

export function isMetaDown(): boolean {
	return isModifierPressed('MetaLeft') || isModifierPressed('MetaRight');
}

export function isShiftDown(): boolean {
	return isModifierPressed('ShiftLeft') || isModifierPressed('ShiftRight');
}

export function isKeyPressed(code: string): boolean {
	const state = getIdeKeyState(code);
	return state ? state.pressed === true : false;
}

export function isKeyTyped(code: string): boolean {
	const state = getIdeKeyState(code);
	return state ? shouldAcceptKeyPress(code, state) : false;
}
export function handleActionPromptInput(): void {
	if (!ide_state.pendingActionPrompt) {
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		resetActionPromptState();
		return;
	}
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		void handleActionPromptSelection('save-continue');
	}
}

export function handleEditorInput(deltaSeconds: number): void {
	if (ide_state.resourcePanelVisible && ide_state.resourcePanelFocused) {
		ide_state.resourcePanel.handleKeyboard();
		const st = ide_state.resourcePanel.getStateForRender();
		ide_state.resourcePanelFocused = st.focused;
		return;
	}
	if (isResourceViewActive()) {
		handleResourceViewerInput(deltaSeconds);
		return;
	}
	const { ctrlDown, metaDown, shiftDown, altDown } = { ctrlDown: isCtrlDown(), metaDown: isMetaDown(), shiftDown: isShiftDown(), altDown: isAltDown() };

	const editableCodeTab = isEditableCodeTab();
	const readOnlyCodeTab = isReadOnlyCodeTab();

	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyO')) {
		consumeIdeKey('KeyO');
		openSymbolSearch();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyR')) {
		consumeIdeKey('KeyR');
		toggleResolutionMode();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyL')) {
		consumeIdeKey('KeyL');
		toggleResourcePanelFilterMode();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressed('Comma')) {
		consumeIdeKey('Comma');
		openResourceSearch();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && !shiftDown && isKeyJustPressed('KeyE')) {
		consumeIdeKey('KeyE');
		openResourceSearch();
		return;
	}
	if ((ctrlDown && altDown) && isKeyJustPressed('Comma')) {
		consumeIdeKey('Comma');
		openSymbolSearch();
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyB')) {
		consumeIdeKey('KeyB');
		toggleResourcePanel();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyM')) {
		consumeIdeKey('KeyM');
		toggleProblemsPanel();
		if (ide_state.problemsPanel.isVisible()) {
			markDiagnosticsDirty();
		} else {
			focusEditorFromProblemsPanel();
		}
		return;
	}
	if (!ctrlDown && !metaDown && altDown && isKeyJustPressed('Comma')) {
		consumeIdeKey('Comma');
		openGlobalSymbolSearch();
		return;
	}

	if (ide_state.createResourceActive) {
		handleCreateResourceInput(deltaSeconds);
		return;
	}

	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyN')) {
		consumeIdeKey('KeyN');
		openCreateResourcePrompt();
		return;
	}

	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressed('KeyF')) {
		consumeIdeKey('KeyF');
		openSearch(true, 'global');
		return;
	}
	if ((ctrlDown || metaDown) && !shiftDown && !altDown && isKeyJustPressed('KeyF')) {
		consumeIdeKey('KeyF');
		openSearch(true, 'local');
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressed('Tab')) {
		consumeIdeKey('Tab');
		cycleTab(shiftDown ? -1 : 1);
		return;
	}
	const inlineFieldFocused = ide_state.searchActive
		|| ide_state.symbolSearchActive
		|| ide_state.resourceSearchActive
		|| ide_state.lineJumpActive
		|| ide_state.createResourceActive
		|| ide_state.renameController.isActive();
	if (!inlineFieldFocused && isKeyJustPressed('F12')) {
		consumeIdeKey('F12');
		if (shiftDown) {
			return;
		}
		openReferenceSearchPopup();
		return;
	}
	if (!inlineFieldFocused && editableCodeTab && isKeyJustPressed('F2')) {
		consumeIdeKey('F2');
		openRenamePrompt();
		return;
	}
	if ((ctrlDown || metaDown)
		&& !inlineFieldFocused
		&& !ide_state.resourcePanelFocused
		&& isCodeTabActive()
		&& isKeyJustPressed('KeyA')) {
		consumeIdeKey('KeyA');
		ide_state.selectionAnchor = { row: 0, column: 0 };
		const lastRowIndex = ide_state.lines.length > 0 ? ide_state.lines.length - 1 : 0;
		const lastColumn = ide_state.lines.length > 0 ? ide_state.lines[lastRowIndex].length : 0;
		ide_state.cursorRow = lastRowIndex;
		ide_state.cursorColumn = lastColumn;
		updateDesiredColumn();
		resetBlink();
		revealCursor();
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyL')) {
		consumeIdeKey('KeyL');
		openLineJump();
		return;
	}
	if (ide_state.renameController.isActive()) {
		ide_state.renameController.handleInput(deltaSeconds);
		return;
	}
	if (ide_state.resourceSearchActive) {
		handleResourceSearchInput(deltaSeconds);
		return;
	}
	if (ide_state.symbolSearchActive) {
		handleSymbolSearchInput(deltaSeconds);
		return;
	}
	if (ide_state.lineJumpActive) {
		handleLineJumpInput(deltaSeconds);
		return;
	}
	if (ide_state.searchActive) {
		handleSearchInput(deltaSeconds);
		return;
	}
	if (ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused()) {
		let handled = false;
		if (ide_state.input.shouldRepeat('ArrowUp', deltaSeconds)) {
			consumeIdeKey('ArrowUp');
			handled = ide_state.problemsPanel.handleKeyboardCommand('up');
		} else if (ide_state.input.shouldRepeat('ArrowDown', deltaSeconds)) {
			consumeIdeKey('ArrowDown');
			handled = ide_state.problemsPanel.handleKeyboardCommand('down');
		} else if (ide_state.input.shouldRepeat('PageUp', deltaSeconds)) {
			consumeIdeKey('PageUp');
			handled = ide_state.problemsPanel.handleKeyboardCommand('page-up');
		} else if (ide_state.input.shouldRepeat('PageDown', deltaSeconds)) {
			consumeIdeKey('PageDown');
			handled = ide_state.problemsPanel.handleKeyboardCommand('page-down');
		} else if (ide_state.input.shouldRepeat('Home', deltaSeconds)) {
			consumeIdeKey('Home');
			handled = ide_state.problemsPanel.handleKeyboardCommand('home');
		} else if (ide_state.input.shouldRepeat('End', deltaSeconds)) {
			consumeIdeKey('End');
			handled = ide_state.problemsPanel.handleKeyboardCommand('end');
		} else if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
			if (isKeyJustPressed('Enter')) consumeIdeKey('Enter'); else consumeIdeKey('NumpadEnter');
			handled = ide_state.problemsPanel.handleKeyboardCommand('activate');
		} else if (isKeyJustPressed('Escape')) {
			consumeIdeKey('Escape');
			hideProblemsPanel();
			focusEditorFromProblemsPanel();
			return;
		}
		// Always swallow caret movement while problems panel is focused
		if (ide_state.input.shouldRepeat('ArrowLeft', deltaSeconds)) consumeIdeKey('ArrowLeft');
		if (ide_state.input.shouldRepeat('ArrowRight', deltaSeconds)) consumeIdeKey('ArrowRight');
		if (handled) return; else return;
	}
	if (ide_state.searchQuery.length > 0 && isKeyJustPressed('F3')) {
		consumeIdeKey('F3');
		if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if ((ctrlDown || metaDown) && ide_state.input.shouldRepeat('KeyZ', deltaSeconds)) {
		consumeIdeKey('KeyZ');
		if (!editableCodeTab) {
			notifyReadOnlyEdit();
			return;
		}
		if (shiftDown) {
			redo();
		} else {
			undo();
		}
		return;
	}
	if ((ctrlDown || metaDown) && ide_state.input.shouldRepeat('KeyY', deltaSeconds)) {
		consumeIdeKey('KeyY');
		if (!editableCodeTab) {
			notifyReadOnlyEdit();
			return;
		}
		redo();
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyW')) {
		consumeIdeKey('KeyW');
		closeActiveTab();
		return;
	}
	if (ctrlDown && isKeyJustPressed('KeyS')) {
		consumeIdeKey('KeyS');
		if (readOnlyCodeTab) {
			notifyReadOnlyEdit();
			return;
		}
		void save();
		return;
	}
	if (ctrlDown && isKeyJustPressed('KeyC')) {
		consumeIdeKey('KeyC');
		void copySelectionToClipboard();
		return;
	}
	if (ctrlDown && isKeyJustPressed('KeyX')) {
		consumeIdeKey('KeyX');
		if (readOnlyCodeTab) {
			if (TextEditing.hasSelection()) {
				void copySelectionToClipboard();
			} else {
				notifyReadOnlyEdit();
			}
			return;
		}
		if (TextEditing.hasSelection()) {
			void cutSelectionToClipboard();
		} else {
			void cutLineToClipboard();
		}
		return;
	}
	if (ctrlDown && isKeyJustPressed('KeyV')) {
		consumeIdeKey('KeyV');
		if (readOnlyCodeTab) {
			notifyReadOnlyEdit();
			return;
		}
		pasteFromClipboard();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressed('Slash')) {
		consumeIdeKey('Slash');
		if (!editableCodeTab) {
			notifyReadOnlyEdit();
			return;
		}
		toggleLineComments();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressed('NumpadDivide')) {
		consumeIdeKey('NumpadDivide');
		if (!editableCodeTab) {
			notifyReadOnlyEdit();
			return;
		}
		toggleLineComments();
		return;
	}
	if (ctrlDown && isKeyJustPressed('BracketRight')) {
		consumeIdeKey('BracketRight');
		if (!editableCodeTab) {
			notifyReadOnlyEdit();
			return;
		}
		indentSelectionOrLine();
		return;
	}
	if (ctrlDown && isKeyJustPressed('BracketLeft')) {
		consumeIdeKey('BracketLeft');
		if (!editableCodeTab) {
			notifyReadOnlyEdit();
			return;
		}
		unindentSelectionOrLine();
		return;
	}
	// Manual ide_state.completion open/close handled by CompletionController via handleCompletionKeybindings
	if (handleCompletionKeybindings(deltaSeconds)) {
		return;
	}
	if (handleCodeFormattingShortcut()) {
		return;
	}
	ide_state.input.handleEditorInput(deltaSeconds);
	if (ctrlDown || metaDown || altDown) {
		return;
	}
	// Remaining character ide_state.input after controller handled modifiers is no-op here
}

export function handleDebuggerShortcuts(): boolean {
	const handled = evaluateDebuggerShortcuts();
	if (handled) {
		prepareDebuggerStepOverlay();
	}
	return handled;
}

export type DebuggerCommand = 'continue' |
	'step_over' |
	'step_into' |
	'step_out' |
	'ignoreException' |
	'step_out_exception';

export function evaluateDebuggerShortcuts(): boolean {
	const executor = debuggerCommandExecutor;
	const { ctrlDown, metaDown, shiftDown, altDown } = { ctrlDown: isCtrlDown(), metaDown: isMetaDown(), shiftDown: isShiftDown(), altDown: isAltDown() };


	if (!executor || !executor.isSuspended()) {
		return false;
	}
	if (ctrlDown || altDown || metaDown) {
		return false;
	}
	if (isKeyJustPressed('F5')) {
		consumeIdeKey('F5');
		if (shiftDown) {
			return executor.issueDebuggerCommand('ignoreException');
		}
		return executor.issueDebuggerCommand('continue');
	}
	if (isKeyJustPressed('F10')) {
		consumeIdeKey('F10');
		if (shiftDown) {
			return executor.issueDebuggerCommand('step_out_exception');
		}
		return executor.issueDebuggerCommand('step_over');
	}
	if (isKeyJustPressed('F11')) {
		consumeIdeKey('F11');
		if (shiftDown) {
			return executor.issueDebuggerCommand('step_out');
		}
		return executor.issueDebuggerCommand('step_into');
	}
	return false;
}

export function isInlineFieldFocused(): boolean {
	return ide_state.searchActive
			|| ide_state.symbolSearchActive
			|| ide_state.resourceSearchActive
			|| ide_state.lineJumpActive
			|| ide_state.createResourceActive
			|| ide_state.renameController.isActive();
}

function handleCodeFormattingShortcut(): boolean {
	const { altDown, shiftDown, ctrlDown, metaDown } = { altDown: isAltDown(), shiftDown: isShiftDown(), ctrlDown: isCtrlDown(), metaDown: isMetaDown() };
	if (!isCodeTabActive() || ide_state.searchActive || isInlineFieldFocused()) {
		return false;
	}
	if (!altDown || !shiftDown || ctrlDown || metaDown) {
		return false;
	}
	if (!isKeyJustPressed('KeyF')) {
		return false;
	}
	consumeIdeKey('KeyF');
	applyDocumentFormatting();
	return true;
}

export function handleTopBarButtonPress(button: TopBarButtonId): void {
	switch (button) {
		case 'debugContinue':
			debuggerCommandExecutor.issueDebuggerCommand('continue');
			return;
		case 'debugStepOver':
			debuggerCommandExecutor.issueDebuggerCommand('step_over');
			return;
		case 'debugStepInto':
			debuggerCommandExecutor.issueDebuggerCommand('step_into');
			return;
		case 'debugStepOut':
			debuggerCommandExecutor.issueDebuggerCommand('step_out');
			return;
		case 'problems':
			toggleProblemsPanel();
			return;
		case 'filter':
			toggleResourcePanelFilterMode();
			return;
		case 'wrap':
			toggleWordWrap();
			return;
		case 'resolution':
			toggleResolutionMode();
			return;
		case 'resources':
			toggleResourcePanel();
			return;
		case 'save':
			if (ide_state.dirty) {
				void save();
			}
			return;
		case 'debugObjects':
			openDebugPanelTab('objects');
			return;
		case 'debugEvents':
			openDebugPanelTab('events');
			return;
		case 'debugRegistry':
			openDebugPanelTab('registry');
			return;
		case 'resume':
		case 'reboot':
			activateCodeTab();
			performAction(button);
			return;
	}
}

