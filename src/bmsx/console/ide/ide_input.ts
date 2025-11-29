import { $ } from '../../core/game';
import { CHARACTER_CODES, CHARACTER_MAP } from './character_map';
import { applyDocumentFormatting, copySelectionToClipboard, cutLineToClipboard, cutSelectionToClipboard, insertText, pasteFromClipboard, writeClipboard } from './text_editing_and_selection';
import { resetBlink } from './render/render_caret';
import { activeSearchMatchCount, applySearchSelection, closeSearch, ensureSearchSelectionVisible, focusEditorFromSearch, jumpToNextMatch, jumpToPreviousMatch, moveSearchSelection, onSearchQueryChanged, openSearch, searchPageSize } from './editor_search';
import { ide_state } from './ide_state';
import { ESCAPE_KEY } from './constants';
import type { ButtonState } from '../../input/inputtypes';
import type { KeyPressRecord, MenuId, PointerSnapshot, ResourceViewerState, RuntimeErrorOverlay, TopBarButtonId } from './types';
import { moveCursorDown, moveCursorEnd, moveCursorHome, moveCursorLeft, moveCursorRight, moveCursorUp, pageDown, pageUp, revealCursor, setCursorPosition } from './caret';
import { isResourceViewActive, isCodeTabActive, isEditableCodeTab, isReadOnlyCodeTab, cycleTab, activateCodeTab, beginTabDrag, closeTab, endTabDrag, setActiveTab, getActiveCodeTabContext, updateTabDrag } from './editor_tabs';
import { prepareDebuggerStepOverlay } from './ide_debugger';
import { handleCompletionKeybindings } from './completion_controller';
import { computeRuntimeErrorOverlayMaxWidth } from './text_utils';
import { drawProblemsPanel, isPointerOverProblemsPanelDivider, setProblemsPanelHeightFromViewportY } from './problems_panel';
import { measureText } from './text_utils';
import { applyScrollbarScroll } from './scrollbar';
import { clearHoverTooltip, updateHoverTooltip } from './intellisense';
import * as TextEditing from './text_editing_and_selection';
import { clamp } from '../../utils/clamp';
import { goBackwardInNavigationHistory, goForwardInNavigationHistory, resetActionPromptState, closeCreateResourcePrompt, closeSymbolSearch, closeResourceSearch, closeLineJump, handleActionPromptSelection, openSymbolSearch, openResourceSearch, focusEditorFromProblemsPanel, openGlobalSymbolSearch, handleCreateResourceInput, openCreateResourcePrompt, openReferenceSearchPopup, openRenamePrompt, updateDesiredColumn, openLineJump, notifyReadOnlyEdit, redo, undo, closeActiveTab, save, toggleLineComments, toggleWordWrap, openDebugPanelTab, performAction, getTabBarTotalHeight, isPointInHoverTooltip, pointerHitsHoverTarget, adjustHoverTooltipScroll, getResourceSearchBarBounds, moveResourceSearchSelection, scrollResourceBrowser, getCodeAreaBounds, scrollRows, clearGotoHoverHighlight, bottomMargin, hideResourcePanel, resetPointerClickTracking, getResourcePanelWidth, getCreateResourceBarBounds, processInlineFieldPointer, resourceSearchEntryHeight, resourceSearchVisibleResultCount, ensureResourceSearchSelectionVisible, applyResourceSearchSelection, getSymbolSearchBarBounds, symbolSearchVisibleResultCount, symbolSearchEntryHeight, ensureSymbolSearchSelectionVisible, applySymbolSearchSelection, getRenameBarBounds, getLineJumpBarBounds, getSearchBarBounds, searchVisibleResultCount, searchResultEntryHeight, resolvePointerRow, clearReferenceHighlights, focusEditorFromLineJump, focusEditorFromResourceSearch, focusEditorFromSymbolSearch, resolvePointerColumn, tryGotoDefinitionAt, handlePointerAutoScroll, refreshGotoHoverHighlight, getActiveResourceViewer, resourceViewerTextCapacity, moveSymbolSearchSelection, symbolSearchPageSize, updateSymbolSearchMatches, applyLineJumpFieldText, resourceSearchWindowCapacity, updateResourceSearchMatches, applyLineJump, mapScreenPointToViewport } from './console_cart_editor';
import { navigateToRuntimeErrorFrameTarget } from './ide_debugger';
import { toggleProblemsPanel, hideProblemsPanel } from './problems_panel';
import { markDiagnosticsDirty } from './diagnostics';
import { point_in_rect } from '../../utils/rect_operations';
import { applyInlineFieldEditing, getFieldText } from './inline_text_field';
import { api, BmsxConsoleRuntime } from '../runtime';
import { computeRuntimeErrorOverlayGeometry, resolveRuntimeErrorOverlayAnchor, computeRuntimeErrorOverlayLayout, findRuntimeErrorOverlayLineAtPosition, RuntimeErrorOverlayClickResult } from './render/render_error_overlay';
import { rebuildRuntimeErrorOverlayView, buildRuntimeErrorOverlayCopyText } from './runtime_error_overlay';
import * as constants from './constants';
import { RuntimeDebuggerCommandExecutor } from './ide_debugger';
import { toggleBreakpointForEditorRow } from './ide_debugger';

export const MENU_IDS: MenuId[] = ['file', 'run', 'view', 'debug'];
export const MENU_COMMANDS = [
	'hot-reload-and-resume',
	'reboot',
	'save',
	'resources',
	'problems',
	'filter',
	'resolution',
	'wrap',
	'debugContinue',
	'debugStepOver',
	'debugStepInto',
	'debugStepOut',
	'debugObjects',
	'debugEvents',
	'debugRegistry',
] as const;

export class InputController {
	private readonly repeatState: Map<string, { cooldown: number }> = new Map();

	public handleEditorInput(
		deltaSeconds: number,
	): void {
		if (handleDebuggerShortcuts()) {
			return;
		}
		if (isKeyJustPressed('F9')) {
			consumeIdeKey('F9');
			toggleBreakpointForEditorRow();
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
			insertText(' ');
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
					goBackwardInNavigationHistory();
					return;
				}
				if (isKeyJustPressed('ArrowRight')) {
					consumeIdeKey('ArrowRight');
					goForwardInNavigationHistory();
					return;
				}
			}
			let movedAlt = false;
			const altUpJustPressed = isKeyJustPressed('ArrowUp');
			const altUpRepeat = !altUpJustPressed && this.shouldRepeat('ArrowUp', deltaSeconds);
			if (altUpJustPressed || altUpRepeat) {
				consumeIdeKey('ArrowUp');
				TextEditing.moveSelectionLines(-1);
				movedAlt = true;
			}
			const altDownJustPressed = isKeyJustPressed('ArrowDown');
			const altDownRepeat = !altDownJustPressed && this.shouldRepeat('ArrowDown', deltaSeconds);
			if (altDownJustPressed || altDownRepeat) {
				consumeIdeKey('ArrowDown');
				TextEditing.moveSelectionLines(1);
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
			if (shiftDown) TextEditing.unindentSelectionOrLine(); else insertText('\t');
			return;
		}
		// Backspace/Delete
		if (this.shouldRepeat('Backspace', deltaSeconds)) {
			consumeIdeKey('Backspace');
			if (ctrlDown) {
				TextEditing.deleteWordBackward();
			} else if (!TextEditing.deleteSelectionIfPresent()) {
				TextEditing.backspace();
			}
			return;
		}
		if (this.shouldRepeat('Delete', deltaSeconds)) {
			consumeIdeKey('Delete');
			if (shiftDown && !ctrlDown) {
				TextEditing.deleteActiveLines();
			} else if (ctrlDown) {
				TextEditing.deleteWordForward();
			} else if (!TextEditing.deleteSelectionIfPresent()) {
				TextEditing.deleteForward();
			}
			return;
		}
		// Enter
		if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
			consumeIdeKey('Enter');
			TextEditing.insertLineBreak();
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
				insertText(value);
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
	const pressId = state.pressId ?? null;
	const isNewPress = state.justpressed === true || pressId !== ide_state.lastEscapePressId;
	if (!isNewPress) {
		return false;
	}
	ide_state.lastEscapePressId = pressId;
	const handled = handleEscapeKey({ allowRuntimeErrorToggle: true });
	if (handled) {
		consumeIdeKey(ESCAPE_KEY);
	}
	return handled;
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

	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyS')) {
		consumeIdeKey('KeyS');
		activateCodeTab();
		performAction('hot-reload-and-resume');
		return;
	}

	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyR')) {
		consumeIdeKey('KeyR');
		activateCodeTab();
		performAction('reboot');
		return;
	}
	if ((ctrlDown || metaDown) && altDown && isKeyJustPressed('KeyT')) {
		consumeIdeKey('KeyT');
		activateCodeTab();
		performAction('theme-toggle');
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyO')) {
		consumeIdeKey('KeyO');
		openSymbolSearch();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyL')) {
		consumeIdeKey('KeyL');
		ide_state.resourcePanel.toggleFilterMode();
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
		ide_state.resourcePanel.togglePanel();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyM')) {
		consumeIdeKey('KeyM');
		toggleProblemsPanel();
		if (ide_state.problemsPanel.isVisible) {
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
	if (ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused) {
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
	if (ctrlDown && !shiftDown && isKeyJustPressed('KeyS')) {
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
	if (ctrlDown && !shiftDown && isKeyJustPressed('KeyV')) {
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
		TextEditing.indentSelectionOrLine();
		return;
	}
	if (ctrlDown && isKeyJustPressed('BracketLeft')) {
		consumeIdeKey('BracketLeft');
		if (!editableCodeTab) {
			notifyReadOnlyEdit();
			return;
		}
		TextEditing.unindentSelectionOrLine();
		return;
	}
	if (handleCompletionKeybindings(deltaSeconds)) {
		return;
	}
	if (handleCodeFormattingShortcut()) {
		return;
	}
	ide_state.input.handleEditorInput(deltaSeconds);
}

export function handleDebuggerShortcuts(): boolean {
	const handled = evaluateDebuggerShortcuts();
	if (handled) {
		prepareDebuggerStepOverlay();
	}
	return handled;
}

export function evaluateDebuggerShortcuts(): boolean {
	const executor = RuntimeDebuggerCommandExecutor.instance;
	const { ctrlDown, metaDown, shiftDown, altDown } = { ctrlDown: isCtrlDown(), metaDown: isMetaDown(), shiftDown: isShiftDown(), altDown: isAltDown() };

	if (!executor || !executor.suspended) {
		return false;
	}
	if (ctrlDown || altDown || metaDown) {
		return false;
	}
	if (isKeyJustPressed('F5')) {
		consumeIdeKey('F5');
		if (shiftDown) {
			return executor.issueDebuggerCommand('ignore_exception');
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
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('continue');
			return;
		case 'debugStepOver':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('step_over');
			return;
		case 'debugStepInto':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('step_into');
			return;
		case 'debugStepOut':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('step_out');
			return;
		case 'problems':
			toggleProblemsPanel();
			return;
		case 'filter':
			ide_state.resourcePanel.toggleFilterMode();
			return;
		case 'wrap':
			toggleWordWrap();
			return;
		case 'resolution':
			BmsxConsoleRuntime.instance.toggleOverlayResolutionMode();
			return;
		case 'resources':
			ide_state.resourcePanel.togglePanel();
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
		case 'hot-reload-and-resume':
		case 'reboot':
			activateCodeTab();
			performAction(button);
			return;
	}
}
export function getIdeKeyState(code: string): ButtonState | null {
	return $.input.getPlayerInput(ide_state.playerIndex).getButtonState(code, 'keyboard');
}

export function consumeIdeKey(code: string): void {
	$.input.getPlayerInput(ide_state.playerIndex).consumeButton(code, 'keyboard', { sticky: false });
}
export function handleActionPromptPointer(snapshot: PointerSnapshot): void {
	if (!ide_state.pendingActionPrompt) {
		return;
	}
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	const saveBounds = ide_state.actionPromptButtons.saveAndContinue;
	if (saveBounds && point_in_rect(x, y, saveBounds)) {
		void handleActionPromptSelection('save-continue');
		return;
	}
	if (point_in_rect(x, y, ide_state.actionPromptButtons.continue)) {
		void handleActionPromptSelection('continue');
		return;
	}
	if (point_in_rect(x, y, ide_state.actionPromptButtons.cancel)) {
		void handleActionPromptSelection('cancel');
	}
}

export function handleTopBarPointer(snapshot: PointerSnapshot): boolean {
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	const menuOpen = ide_state.openMenuId !== null;
	const inHeader = y >= 0 && y < ide_state.headerHeight;
	const inDropdown = menuOpen && point_in_rect(x, y, ide_state.menuDropdownBounds);
	if (!inHeader && !inDropdown) {
		if (menuOpen) {
			ide_state.openMenuId = null;
			ide_state.menuDropdownBounds = null;
		}
		return false;
	}
	if (inHeader) {
		const menuId = findTopMenuAtPoint(x, y);
		if (menuId) {
			ide_state.openMenuId = ide_state.openMenuId === menuId ? null : menuId;
			return true;
		}
		if (menuOpen) {
			ide_state.openMenuId = null;
			ide_state.menuDropdownBounds = null;
			return true;
		}
		return false;
	}
	const command = findMenuCommandAtPoint(x, y);
	if (!command) {
		return true;
	}
	if (isMenuCommandEnabled(command)) {
		handleTopBarButtonPress(command);
		ide_state.openMenuId = null;
		ide_state.menuDropdownBounds = null;
		return true;
	}
	return true;
}

function findTopMenuAtPoint(x: number, y: number): MenuId | null {
	for (let index = 0; index < MENU_IDS.length; index += 1) {
		const id = MENU_IDS[index];
		if (point_in_rect(x, y, ide_state.menuEntryBounds[id])) {
			return id;
		}
	}
	return null;
}

function findMenuCommandAtPoint(x: number, y: number): TopBarButtonId | null {
	for (let index = 0; index < MENU_COMMANDS.length; index += 1) {
		const command = MENU_COMMANDS[index];
		if (point_in_rect(x, y, ide_state.topBarButtonBounds[command])) {
			return command;
		}
	}
	return null;
}

function isMenuCommandEnabled(command: TopBarButtonId): boolean {
	if (command === 'save') {
		return ide_state.dirty;
	}
	if (command === 'filter') {
		return ide_state.resourcePanelVisible;
	}
	if (command === 'debugContinue' || command === 'debugStepOver' || command === 'debugStepInto' || command === 'debugStepOut') {
		return ide_state.debuggerControls.executionState === 'paused';
	}
	return true;
}

export function handleTabBarPointer(snapshot: PointerSnapshot): boolean {
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		return false;
	}
	const x = snapshot.viewportX;
	for (let index = 0; index < ide_state.tabs.length; index += 1) {
		const tab = ide_state.tabs[index];
		const closeBounds = ide_state.tabCloseButtonBounds.get(tab.id);
		if (closeBounds && point_in_rect(x, y, closeBounds)) {
			endTabDrag();
			closeTab(tab.id);
			ide_state.tabHoverId = null;
			return true;
		}
		const tabBounds = ide_state.tabButtonBounds.get(tab.id);
		if (tabBounds && point_in_rect(x, y, tabBounds)) {
			beginTabDrag(tab.id, x);
			setActiveTab(tab.id);
			return true;
		}
	}
	return false;
}

export function handleTabBarMiddleClick(snapshot: PointerSnapshot): boolean {
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		return false;
	}
	const x = snapshot.viewportX;
	for (let index = 0; index < ide_state.tabs.length; index += 1) {
		const tab = ide_state.tabs[index];
		if (!tab.closable) {
			continue;
		}
		const bounds = ide_state.tabButtonBounds.get(tab.id);
		if (!bounds) {
			continue;
		}
		if (point_in_rect(x, y, bounds)) {
			closeTab(tab.id);
			return true;
		}
	}
	return false;
}

export function handlePointerWheel(): void {
	const playerInput = $.input.getPlayerInput(ide_state.playerIndex);
	if (!playerInput) {
		return;
	}
	const wheelAction = playerInput.getActionState('pointer_wheel');
	if (wheelAction.consumed === true) {
		return;
	}
	const delta = wheelAction.value;
	if (!delta) return;

	const magnitude = Math.abs(delta);
	const steps = Math.max(1, Math.round(magnitude / constants.WHEEL_SCROLL_STEP));
	const direction = delta > 0 ? 1 : -1;
	const pointer = ide_state.lastPointerSnapshot;
	const shiftDown = isShiftDown();
	if (ide_state.hoverTooltip) {
		let canScrollTooltip = false;
		if (!pointer) {
			canScrollTooltip = true;
		} else if (pointer.valid && pointer.insideViewport) {
			if (isPointInHoverTooltip(pointer.viewportX, pointer.viewportY) || pointerHitsHoverTarget(pointer, ide_state.hoverTooltip)) {
				canScrollTooltip = true;
			}
		}
		if (canScrollTooltip && adjustHoverTooltipScroll(direction * steps)) {
			playerInput.consumeAction('pointer_wheel');
			return;
		}
	}
	if (ide_state.resourceSearchVisible) {
		const bounds = getResourceSearchBarBounds();
		const pointerInQuickOpen = bounds !== null
			&& pointer
			&& pointer.valid
			&& pointer.insideViewport
			&& point_in_rect(pointer.viewportX, pointer.viewportY, bounds);
		if (pointerInQuickOpen || ide_state.resourceSearchActive) {
			moveResourceSearchSelection(direction * steps);
			playerInput.consumeAction('pointer_wheel');
			return;
		}
	}
	const panelBounds = ide_state.resourcePanel.getBounds();
	const pointerInPanel = ide_state.resourcePanelVisible
		&& panelBounds !== null
		&& pointer
		&& pointer.valid
		&& pointer.insideViewport
		&& point_in_rect(pointer.viewportX, pointer.viewportY, panelBounds);
	if (pointerInPanel) {
		if (shiftDown) {
			const horizontalPixels = direction * steps * ide_state.charAdvance * 4;
			scrollResourceBrowserHorizontal(horizontalPixels);
			ide_state.resourcePanel.ensureSelectionVisible();
		} else {
			scrollResourceBrowser(direction * steps);
		}
		playerInput.consumeAction('pointer_wheel');
		return;
	}
	if (ide_state.problemsPanel.isVisible) {
		const bounds = drawProblemsPanel();
		if (bounds) {
			let allowScroll = false;
			if (!pointer) {
				allowScroll = ide_state.problemsPanel.isFocused;
			} else if (pointer.valid && pointer.insideViewport && point_in_rect(pointer.viewportX, pointer.viewportY, bounds)) {
				allowScroll = true;
			}
			const stepsAbs = Math.max(1, Math.round(Math.abs(steps)));
			if (ide_state.problemsPanel.isFocused) {
				// Match quick-open/symbol behavior: focused wheel moves selection
				for (let i = 0; i < stepsAbs; i += 1) {
					void ide_state.problemsPanel.handleKeyboardCommand(direction > 0 ? 'down' : 'up');
				}
				playerInput.consumeAction('pointer_wheel');
				return;
			}
			if (allowScroll && ide_state.problemsPanel.handlePointerWheel(direction, stepsAbs)) {
				playerInput.consumeAction('pointer_wheel');
				return;
			}
		}
	}
	if (ide_state.completion.handlePointerWheel(direction, steps, pointer && pointer.valid && pointer.insideViewport ? { x: pointer.viewportX, y: pointer.viewportY } : null)) {
		playerInput.consumeAction('pointer_wheel');
		return;
	}
	if (isResourceViewActive()) {
		scrollResourceViewer(direction * steps);
		playerInput.consumeAction('pointer_wheel');
		return;
	}
	if (isCodeTabActive() && pointer) {
		const bounds = getCodeAreaBounds();
		if (!pointer.valid || !pointer.insideViewport || pointer.viewportY < bounds.codeTop || pointer.viewportY >= bounds.codeBottom || pointer.viewportX < bounds.codeLeft || pointer.viewportX >= bounds.codeRight) {
			playerInput.consumeAction('pointer_wheel');
			return;
		}
	}
	scrollRows(direction * steps);
	ide_state.cursorRevealSuspended = true;
	playerInput.consumeAction('pointer_wheel');
}

export function handleTextEditorPointerInput(): void {
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const gotoModifierActive = ctrlDown || metaDown;
	if (!gotoModifierActive) {
		clearGotoHoverHighlight();
	}
	const activeContext = getActiveCodeTabContext();
	const snapshot = readPointerSnapshot();
	updateTabHoverState(snapshot);
	ide_state.lastPointerSnapshot = snapshot && snapshot.valid ? snapshot : null;
	if (!snapshot) {
		ide_state.pointerPrimaryWasPressed = false;
		ide_state.scrollbarController.cancel();
		ide_state.lastPointerRowResolution = null;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (!snapshot.valid) {
		ide_state.scrollbarController.cancel();
		clearGotoHoverHighlight();
		ide_state.lastPointerRowResolution = null;
	} else if (ide_state.scrollbarController.hasActiveDrag() && !snapshot.primaryPressed) {
		ide_state.scrollbarController.cancel();
	} else if (ide_state.scrollbarController.hasActiveDrag() && snapshot.primaryPressed) {
		if (ide_state.scrollbarController.update(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, (k, s) => applyScrollbarScroll(k, s))) {
			ide_state.pointerSelecting = false;
			clearHoverTooltip();
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			return;
		}
	}
	if (!snapshot.primaryPressed) {
		ide_state.searchField.pointerSelecting = false;
		ide_state.symbolSearchField.pointerSelecting = false;
		ide_state.resourceSearchField.pointerSelecting = false;
		ide_state.lineJumpField.pointerSelecting = false;
		ide_state.createResourceField.pointerSelecting = false;
		ide_state.symbolSearchHoverIndex = -1;
		ide_state.resourceSearchHoverIndex = -1;
	}
	let pointerAuxJustPressed = false;
	let pointerAuxPressed = false;
	const playerInput = $.input.getPlayerInput(ide_state.playerIndex);
	if (playerInput) {
		const auxAction = playerInput.getActionState('pointer_aux');
		if (auxAction && auxAction.justpressed === true && auxAction.consumed !== true) {
			pointerAuxJustPressed = true;
			pointerAuxPressed = true;
		} else if (auxAction && auxAction.pressed === true && auxAction.consumed !== true) {
			pointerAuxPressed = true;
			pointerAuxJustPressed = !ide_state.pointerAuxWasPressed;
		}
	}
	ide_state.pointerAuxWasPressed = pointerAuxPressed;
	const wasPressed = ide_state.pointerPrimaryWasPressed;
	const justPressed = snapshot.primaryPressed && !wasPressed;
	const justReleased = !snapshot.primaryPressed && wasPressed;
	if (justReleased || (!snapshot.primaryPressed && ide_state.pointerSelecting)) {
		ide_state.pointerSelecting = false;
	}
	if (ide_state.tabDragState) {
		if (!snapshot.primaryPressed) {
			endTabDrag();
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearGotoHoverHighlight();
			clearHoverTooltip();
			return;
		}
		if (snapshot.valid) {
			updateTabDrag(snapshot.viewportX, snapshot.viewportY);
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		clearHoverTooltip();
		return;
	}
	if (justPressed && ide_state.scrollbarController.begin(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, bottomMargin(), (k, s) => applyScrollbarScroll(k, s))) {
		ide_state.pointerSelecting = false;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		return;
	}
	if (ide_state.resourcePanelResizing && !snapshot.valid) {
		ide_state.resourcePanelResizing = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	if (!snapshot.valid) {
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (ide_state.resourcePanelResizing) {
		if (!snapshot.primaryPressed) {
			ide_state.resourcePanelResizing = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		} else {
			const ok = ide_state.resourcePanel.setRatioFromViewportX(snapshot.viewportX, ide_state.viewportWidth);
			if (!ok) {
				hideResourcePanel();
			} else {
				ide_state.layout.markVisualLinesDirty();
				/* hscroll handled inside controller */
			}
			ide_state.resourcePanelFocused = true;
			ide_state.pointerSelecting = false;
			resetPointerClickTracking();
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		}
		clearGotoHoverHighlight();
		return;
	}
	if (ide_state.problemsPanelResizing) {
		if (!snapshot.primaryPressed) {
			ide_state.problemsPanelResizing = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		} else {
			setProblemsPanelHeightFromViewportY(snapshot.viewportY);
			ide_state.pointerSelecting = false;
			resetPointerClickTracking();
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		}
		clearGotoHoverHighlight();
		return;
	}
	if (justPressed && handleTopBarPointer(snapshot)) {
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		resetPointerClickTracking();
		clearGotoHoverHighlight();
		return;
	}
	if (ide_state.resourcePanelVisible && justPressed && isPointerOverResourcePanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		if (getResourcePanelWidth() > 0) {
			ide_state.resourcePanelResizing = true;
			ide_state.resourcePanelFocused = true;
			ide_state.pointerSelecting = false;
			resetPointerClickTracking();
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		}
		clearGotoHoverHighlight();
		return;
	}
	if (justPressed && ide_state.problemsPanel.isVisible && isPointerOverProblemsPanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		ide_state.problemsPanelResizing = true;
		ide_state.pointerSelecting = false;
		resetPointerClickTracking();
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	if (pointerAuxJustPressed && handleTabBarMiddleClick(snapshot)) {
		if (playerInput) {
			playerInput.consumeAction('pointer_aux');
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		resetPointerClickTracking();
		clearGotoHoverHighlight();
		return;
	}
	if (justPressed && snapshot.viewportY >= tabTop && snapshot.viewportY < tabBottom) {
		if (handleTabBarPointer(snapshot)) {
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			clearGotoHoverHighlight();
			return;
		}
	}
	const panelBounds = ide_state.resourcePanel.getBounds();
	const pointerInPanel = ide_state.resourcePanelVisible
		&& panelBounds !== null
		&& point_in_rect(snapshot.viewportX, snapshot.viewportY, panelBounds);
	if (pointerInPanel) {
		ide_state.resourcePanel.setFocused(true);
		resetPointerClickTracking();
		clearHoverTooltip();
		const margin = Math.max(4, ide_state.lineHeight);
		if (snapshot.viewportY < panelBounds.top + margin) {
			ide_state.resourcePanel.scrollBy(-1);
		} else if (snapshot.viewportY >= panelBounds.bottom - margin) {
			ide_state.resourcePanel.scrollBy(1);
		}
		const hoverIndex = ide_state.resourcePanel.indexAtPosition(snapshot.viewportX, snapshot.viewportY);
		ide_state.resourcePanel.setHoverIndex(hoverIndex);
		if (hoverIndex >= 0) {
			if (hoverIndex !== ide_state.resourceBrowserSelectionIndex) {
				ide_state.resourcePanel.setSelectionIndex(hoverIndex);
			}
			if (justPressed) {
				ide_state.resourcePanel.openSelected();
				ide_state.resourcePanel.setFocused(false);
			}
		}
		if (!snapshot.primaryPressed && hoverIndex === -1) {
			ide_state.resourcePanel.setHoverIndex(-1);
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		const s = ide_state.resourcePanel.getStateForRender();
		ide_state.resourcePanelFocused = s.focused;
		ide_state.resourceBrowserSelectionIndex = s.selectionIndex;
		return;
	}
	if (justPressed && !pointerInPanel) {
		ide_state.resourcePanel.setFocused(false);
	}
	if (ide_state.resourcePanelVisible && !snapshot.primaryPressed) {
		ide_state.resourcePanel.setHoverIndex(-1);
	}
	const problemsBounds = drawProblemsPanel();
	if (ide_state.problemsPanel.isVisible && problemsBounds) {
		const insideProblems = point_in_rect(snapshot.viewportX, snapshot.viewportY, problemsBounds);
		if (insideProblems) {
			if (ide_state.problemsPanel.handlePointer(snapshot, justPressed, justReleased, problemsBounds)) {
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				resetPointerClickTracking();
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
		} else if (justPressed) {
			ide_state.problemsPanel.setFocused(false);
		}
	}
	if (isResourceViewActive()) {
		resetPointerClickTracking();
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (ide_state.pendingActionPrompt) {
		resetPointerClickTracking();
		if (justPressed) {
			handleActionPromptPointer(snapshot);
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	const createResourceBounds = getCreateResourceBarBounds();
	if (ide_state.createResourceVisible && createResourceBounds) {
		const insideCreateBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, createResourceBounds);
		if (insideCreateBar) {
			if (justPressed) {
				ide_state.createResourceActive = true;
				ide_state.cursorVisible = true;
				resetBlink();
				ide_state.resourcePanelFocused = false;
			}
			const label = 'NEW FILE:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(ide_state.createResourceField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			ide_state.createResourceActive = false;
		}
	}
	const resourceSearchBounds = getResourceSearchBarBounds();
	if (ide_state.resourceSearchVisible && resourceSearchBounds) {
		const insideResourceSearch = point_in_rect(snapshot.viewportX, snapshot.viewportY, resourceSearchBounds);
		if (insideResourceSearch) {
			const baseHeight = ide_state.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
			const fieldBottom = resourceSearchBounds.top + baseHeight;
			const resultsStart = fieldBottom + constants.QUICK_OPEN_RESULT_SPACING;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					closeSearch(false, true);
					closeSymbolSearch(false);
					ide_state.resourceSearchVisible = true;
					ide_state.resourceSearchActive = true;
					ide_state.resourcePanelFocused = false;
					ide_state.cursorVisible = true;
					resetBlink();
				}
				const label = 'FILE :';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(ide_state.resourceSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			const rowHeight = resourceSearchEntryHeight();
			const visibleCount = resourceSearchVisibleResultCount();
			let hoverIndex = -1;
			if (snapshot.viewportY >= resultsStart) {
				const relative = snapshot.viewportY - resultsStart;
				const indexWithin = Math.floor(relative / rowHeight);
				if (indexWithin >= 0 && indexWithin < visibleCount) {
					hoverIndex = ide_state.resourceSearchDisplayOffset + indexWithin;
				}
			}
			ide_state.resourceSearchHoverIndex = hoverIndex;
			if (hoverIndex >= 0 && justPressed) {
				if (hoverIndex !== ide_state.resourceSearchSelectionIndex) {
					ide_state.resourceSearchSelectionIndex = hoverIndex;
					ensureResourceSearchSelectionVisible();
				}
				applyResourceSearchSelection(hoverIndex);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			ide_state.resourceSearchActive = false;
		}
		ide_state.resourceSearchHoverIndex = -1;
	}
	const symbolBounds = getSymbolSearchBarBounds();
	if (ide_state.symbolSearchVisible && symbolBounds) {
		const insideSymbol = point_in_rect(snapshot.viewportX, snapshot.viewportY, symbolBounds);
		if (insideSymbol) {
			const baseHeight = ide_state.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
			const fieldBottom = symbolBounds.top + baseHeight;
			const resultsStart = fieldBottom + constants.SYMBOL_SEARCH_RESULT_SPACING;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					closeSearch(false, true);
					ide_state.symbolSearchVisible = true;
					ide_state.symbolSearchActive = true;
					ide_state.resourcePanelFocused = false;
					ide_state.cursorVisible = true;
					resetBlink();
				}
				const label = ide_state.symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(ide_state.symbolSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			const visibleCount = symbolSearchVisibleResultCount();
			let hoverIndex = -1;
			if (snapshot.viewportY >= resultsStart) {
				const relative = snapshot.viewportY - resultsStart;
				const entryHeight = symbolSearchEntryHeight();
				const indexWithin = entryHeight > 0 ? Math.floor(relative / entryHeight) : -1;
				if (indexWithin >= 0 && indexWithin < visibleCount) {
					hoverIndex = ide_state.symbolSearchDisplayOffset + indexWithin;
				}
			}
			ide_state.symbolSearchHoverIndex = hoverIndex;
			if (hoverIndex >= 0 && justPressed) {
				if (hoverIndex !== ide_state.symbolSearchSelectionIndex) {
					ide_state.symbolSearchSelectionIndex = hoverIndex;
					ensureSymbolSearchSelectionVisible();
				}
				applySymbolSearchSelection(hoverIndex);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			ide_state.symbolSearchActive = false;
		}
		ide_state.symbolSearchHoverIndex = -1;
	}

	const renameBounds = getRenameBarBounds();
	if (ide_state.renameController?.isVisible() && renameBounds) {
		const insideRename = point_in_rect(snapshot.viewportX, snapshot.viewportY, renameBounds);
		if (insideRename) {
			if (justPressed) {
				ide_state.resourcePanelFocused = false;
				ide_state.cursorVisible = true;
				resetBlink();
			}
			const label = 'RENAME:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(ide_state.renameController.getField(), textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			ide_state.renameController.cancel();
		}
	}

	const lineJumpBounds = getLineJumpBarBounds();
	if (ide_state.lineJumpVisible && lineJumpBounds) {
		const insideLineJump = point_in_rect(snapshot.viewportX, snapshot.viewportY, lineJumpBounds);
		if (insideLineJump) {
			if (justPressed) {
				closeSearch(false, true);
				ide_state.lineJumpActive = true;
				resetBlink();
			}
			const label = 'LINE #:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(ide_state.lineJumpField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			ide_state.lineJumpActive = false;
		}
	}
	const searchBounds = getSearchBarBounds();
	if (ide_state.searchVisible && searchBounds) {
		const insideSearch = point_in_rect(snapshot.viewportX, snapshot.viewportY, searchBounds);
		const baseHeight = ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
		const fieldBottom = searchBounds.top + baseHeight;
		const visibleResults = searchVisibleResultCount();
		if (insideSearch) {
			ide_state.searchHoverIndex = -1;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					ide_state.searchVisible = true;
					ide_state.searchActive = true;
					ide_state.resourcePanelFocused = false;
					ide_state.cursorVisible = true;
					resetBlink();
				}
				const label = ide_state.searchScope === 'global' ? 'SEARCH ALL:' : 'SEARCH:';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(ide_state.searchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			if (visibleResults > 0) {
				const resultsStart = fieldBottom + constants.SEARCH_RESULT_SPACING;
				const rowHeight = searchResultEntryHeight();
				let hoverIndex = -1;
				if (snapshot.viewportY >= resultsStart) {
					const relative = snapshot.viewportY - resultsStart;
					const indexWithin = Math.floor(relative / rowHeight);
					if (indexWithin >= 0 && indexWithin < visibleResults) {
						hoverIndex = ide_state.searchDisplayOffset + indexWithin;
					}
				}
				ide_state.searchHoverIndex = hoverIndex;
				if (hoverIndex >= 0 && justPressed) {
					if (hoverIndex !== ide_state.searchCurrentIndex) {
						ide_state.searchCurrentIndex = hoverIndex;
						ensureSearchSelectionVisible();
						if (ide_state.searchScope === 'local') {
							applySearchSelection(hoverIndex, { preview: true });
						}
					}
					applySearchSelection(hoverIndex);
					ide_state.pointerSelecting = false;
					ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
					clearHoverTooltip();
					clearGotoHoverHighlight();
					return;
				}
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
		} else if (justPressed) {
			ide_state.searchActive = false;
			ide_state.searchHoverIndex = -1;
		}
	} else {
		ide_state.searchHoverIndex = -1;
	}

	const bounds = getCodeAreaBounds();
	if (processRuntimeErrorOverlayPointer(snapshot, justPressed, bounds.codeTop, bounds.codeRight, bounds.textLeft)) {
		// Keep primary pressed state in sync when overlay handles the event
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		return;
	}
	const insideCodeArea = snapshot.viewportY >= bounds.codeTop
		&& snapshot.viewportY < bounds.codeBottom
		&& snapshot.viewportX >= bounds.codeLeft
		&& snapshot.viewportX < bounds.codeRight;
	const inGutter = insideCodeArea
		&& snapshot.viewportX >= bounds.gutterLeft
		&& snapshot.viewportX < bounds.gutterRight;
	if (justPressed && inGutter) {
		const targetRow = resolvePointerRow(snapshot.viewportY);
		if (toggleBreakpointForEditorRow(targetRow)) {
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			return;
		}
	}
	if (justPressed && insideCodeArea) {
		clearReferenceHighlights();
		ide_state.resourcePanelFocused = false;
		focusEditorFromLineJump();
		focusEditorFromSearch();
		focusEditorFromResourceSearch();
		focusEditorFromSymbolSearch();
		ide_state.completion.closeSession();
		const targetRow = resolvePointerRow(snapshot.viewportY);
		const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
		if (gotoModifierActive && tryGotoDefinitionAt(targetRow, targetColumn)) {
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			return;
		}

		// TODO: UGLY DUPLICATE CODE WITH TEXT EDITOR CLICK HANDLER
		function registerPointerClick(row: number, column: number): boolean {
			const now = $.platform.clock.now();
			const interval = now - ide_state.lastPointerClickTimeMs;
			const sameRow = row === ide_state.lastPointerClickRow;
			const columnDelta = Math.abs(column - ide_state.lastPointerClickColumn);
			const doubleClick = ide_state.lastPointerClickTimeMs > 0
				&& interval <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS
				&& sameRow
				&& columnDelta <= 2;
			ide_state.lastPointerClickTimeMs = now;
			ide_state.lastPointerClickRow = row;
			ide_state.lastPointerClickColumn = column;
			return doubleClick;
		}
		const doubleClick = registerPointerClick(targetRow, targetColumn);

		if (doubleClick) {
			TextEditing.selectWordAtPosition(targetRow, targetColumn);
			ide_state.pointerSelecting = false;
		} else {
			ide_state.selectionAnchor = { row: targetRow, column: targetColumn };
			setCursorPosition(targetRow, targetColumn);
			ide_state.pointerSelecting = true;
		}
	}
	if (ide_state.pointerSelecting && snapshot.primaryPressed) {
		clearGotoHoverHighlight();
		handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY);
		const targetRow = resolvePointerRow(snapshot.viewportY);
		const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
		if (!ide_state.selectionAnchor) {
			ide_state.selectionAnchor = { row: targetRow, column: targetColumn };
		}
		setCursorPosition(targetRow, targetColumn);
	}
	if (isCodeTabActive() && !snapshot.primaryPressed && !ide_state.pointerSelecting && insideCodeArea && gotoModifierActive) {
		const hoverRow = resolvePointerRow(snapshot.viewportY);
		const hoverColumn = resolvePointerColumn(hoverRow, snapshot.viewportX);
		refreshGotoHoverHighlight(hoverRow, hoverColumn, activeContext);
	} else if (!gotoModifierActive || !insideCodeArea || snapshot.primaryPressed || ide_state.pointerSelecting || !isCodeTabActive()) {
		clearGotoHoverHighlight();
	}
	if (isCodeTabActive()) {
		const altDown = isAltDown();
		if (!snapshot.primaryPressed && !ide_state.pointerSelecting && insideCodeArea && altDown) {
			updateHoverTooltip(snapshot);
		} else {
			clearHoverTooltip();
		}
	} else {
		clearHoverTooltip();
	}
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
}

export function updateTabHoverState(snapshot: PointerSnapshot | null): void {
	if (!snapshot || !snapshot.valid || !snapshot.insideViewport) {
		ide_state.tabHoverId = null;
		return;
	}
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		ide_state.tabHoverId = null;
		return;
	}
	const x = snapshot.viewportX;
	let hovered: string | null = null;
	for (const [tabId, bounds] of ide_state.tabButtonBounds) {
		if (point_in_rect(x, y, bounds)) {
			hovered = tabId;
			break;
		}
	}
	ide_state.tabHoverId = hovered;
}

export function handleResourceViewerInput(deltaSeconds: number): void {
	// Resource viewer specific keys
	const viewer = getActiveResourceViewer();
	if (!viewer) return;
	if (ide_state.input.shouldRepeat('ArrowUp', deltaSeconds)) {
		consumeIdeKey('ArrowUp');
		scrollResourceViewer(-1);
		return;
	}
	if (ide_state.input.shouldRepeat('ArrowDown', deltaSeconds)) {
		consumeIdeKey('ArrowDown');
		scrollResourceViewer(1);
		return;
	}
	if (ide_state.input.shouldRepeat('PageUp', deltaSeconds)) {
		consumeIdeKey('PageUp');
		const capacity = resourceViewerTextCapacity(viewer);
		scrollResourceViewer(-Math.max(1, capacity));
		return;
	}
	if (ide_state.input.shouldRepeat('PageDown', deltaSeconds)) {
		consumeIdeKey('PageDown');
		const capacity = resourceViewerTextCapacity(viewer);
		scrollResourceViewer(Math.max(1, capacity));
		return;
	}
}
export function scrollResourceBrowserHorizontal(delta: number): void {
	if (!ide_state.resourcePanelVisible) return;
	const s = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanel.setHScroll(s.hscroll + delta);
}

export function scrollResourceViewer(amount: number): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	const capacity = resourceViewerTextCapacity(viewer);
	if (capacity <= 0) {
		viewer.scroll = 0;
		return;
	}
	const maxScroll = Math.max(0, viewer.lines.length - capacity);
	viewer.scroll = clamp(viewer.scroll + amount, 0, maxScroll);
	resourceViewerClampScroll(viewer);
}
export function resourceViewerClampScroll(viewer: ResourceViewerState): void {
	const capacity = resourceViewerTextCapacity(viewer);
	if (capacity <= 0) {
		viewer.scroll = 0;
		return;
	}
	const maxScroll = Math.max(0, viewer.lines.length - capacity);
	if (!Number.isFinite(viewer.scroll) || viewer.scroll < 0) {
		viewer.scroll = 0;
		return;
	}
	if (viewer.scroll > maxScroll) {
		viewer.scroll = maxScroll;
	}
}
export function isPointerOverResourcePanelDivider(x: number, y: number): boolean {
	if (!ide_state.resourcePanelVisible) {
		return false;
	}
	const bounds = ide_state.resourcePanel.getBounds();
	if (!bounds) {
		return false;
	}
	const margin = constants.RESOURCE_PANEL_DIVIDER_DRAG_MARGIN;
	const left = bounds.right - margin;
	const right = bounds.right + margin;
	return y >= bounds.top && y <= bounds.bottom && x >= left && x <= right;
}
export function handleSymbolSearchInput(deltaSeconds: number): void {
	const { shiftDown } = { shiftDown: isShiftDown() };
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		if (shiftDown) {
			moveSymbolSearchSelection(-1);
			return;
		}
		if (ide_state.symbolSearchSelectionIndex >= 0) {
			applySymbolSearchSelection(ide_state.symbolSearchSelectionIndex);
		} else {
			ide_state.showMessage('No symbol selected', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeSymbolSearch(true);
		return;
	}
	if (ide_state.input.shouldRepeat('ArrowUp', deltaSeconds)) {
		consumeIdeKey('ArrowUp');
		moveSymbolSearchSelection(-1);
		return;
	}
	if (ide_state.input.shouldRepeat('ArrowDown', deltaSeconds)) {
		consumeIdeKey('ArrowDown');
		moveSymbolSearchSelection(1);
		return;
	}
	if (ide_state.input.shouldRepeat('PageUp', deltaSeconds)) {
		consumeIdeKey('PageUp');
		moveSymbolSearchSelection(-symbolSearchPageSize());
		return;
	}
	if (ide_state.input.shouldRepeat('PageDown', deltaSeconds)) {
		consumeIdeKey('PageDown');
		moveSymbolSearchSelection(symbolSearchPageSize());
		return;
	}
	if (isKeyJustPressed('Home')) {
		consumeIdeKey('Home');
		ide_state.symbolSearchSelectionIndex = ide_state.symbolSearchMatches.length > 0 ? 0 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressed('End')) {
		consumeIdeKey('End');
		ide_state.symbolSearchSelectionIndex = ide_state.symbolSearchMatches.length > 0 ? ide_state.symbolSearchMatches.length - 1 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	const textChanged = applyInlineFieldEditing(ide_state.symbolSearchField, {
		deltaSeconds,
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	ide_state.symbolSearchQuery = getFieldText(ide_state.symbolSearchField);
	if (textChanged) {
		updateSymbolSearchMatches();
	}
}

export function handleResourceSearchInput(deltaSeconds: number): void {
	const { shiftDown } = { shiftDown: isShiftDown() };
	if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		if (shiftDown) {
			moveResourceSearchSelection(-1);
			return;
		}
		if (ide_state.resourceSearchSelectionIndex >= 0) {
			applyResourceSearchSelection(ide_state.resourceSearchSelectionIndex);
			return;
		} else {
			const trimmed = ide_state.resourceSearchQuery.trim();
			if (trimmed.length === 0) {
				closeResourceSearch(true);
				focusEditorFromResourceSearch();
			} else {
				ide_state.showMessage('No resource selected', constants.COLOR_STATUS_WARNING, 1.5);
			}
		}
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeResourceSearch(true);
		focusEditorFromResourceSearch();
		return;
	}
	if (ide_state.input.shouldRepeat('ArrowUp', deltaSeconds)) {
		consumeIdeKey('ArrowUp');
		moveResourceSearchSelection(-1);
		return;
	}
	if (ide_state.input.shouldRepeat('ArrowDown', deltaSeconds)) {
		consumeIdeKey('ArrowDown');
		moveResourceSearchSelection(1);
		return;
	}
	if (ide_state.input.shouldRepeat('PageUp', deltaSeconds)) {
		consumeIdeKey('PageUp');
		moveResourceSearchSelection(-resourceSearchWindowCapacity());
		return;
	}
	if (ide_state.input.shouldRepeat('PageDown', deltaSeconds)) {
		consumeIdeKey('PageDown');
		moveResourceSearchSelection(resourceSearchWindowCapacity());
		return;
	}
	if (isKeyJustPressed('Home')) {
		consumeIdeKey('Home');
		ide_state.resourceSearchSelectionIndex = ide_state.resourceSearchMatches.length > 0 ? 0 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressed('End')) {
		consumeIdeKey('End');
		ide_state.resourceSearchSelectionIndex = ide_state.resourceSearchMatches.length > 0 ? ide_state.resourceSearchMatches.length - 1 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	const textChanged = applyInlineFieldEditing(ide_state.resourceSearchField, {
		deltaSeconds,
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	ide_state.resourceSearchQuery = getFieldText(ide_state.resourceSearchField);
	if (textChanged) {
		if (ide_state.resourceSearchQuery.startsWith('@')) {
			const query = ide_state.resourceSearchQuery.slice(1).trimStart();
			closeResourceSearch(true);
			openSymbolSearch(query);
			return;
		}
		if (ide_state.resourceSearchQuery.startsWith('#')) {
			const query = ide_state.resourceSearchQuery.slice(1).trimStart();
			closeResourceSearch(true);
			openGlobalSymbolSearch(query);
			return;
		}
		if (ide_state.resourceSearchQuery.startsWith(':')) {
			const query = ide_state.resourceSearchQuery.slice(1).trimStart();
			closeResourceSearch(true);
			openLineJump();
			if (query.length > 0) {
				applyLineJumpFieldText(query, true);
				ide_state.lineJumpValue = query;
			}
			return;
		}
		updateResourceSearchMatches();
	}
}
export function handleSearchInput(deltaSeconds: number): void {
	const { shiftDown, ctrlDown, metaDown, altDown } = { shiftDown: isShiftDown(), ctrlDown: isCtrlDown(), metaDown: isMetaDown(), altDown: isAltDown() };
	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressed('KeyF')) {
		consumeIdeKey('KeyF');
		openSearch(false, 'global');
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressed('KeyF')) {
		consumeIdeKey('KeyF');
		openSearch(false, 'local');
		return;
	}
	if ((ctrlDown || metaDown) && ide_state.input.shouldRepeat('KeyZ', deltaSeconds)) {
		consumeIdeKey('KeyZ');
		if (shiftDown) {
			redo();
		} else {
			undo();
		}
		return;
	}
	if ((ctrlDown || metaDown) && ide_state.input.shouldRepeat('KeyY', deltaSeconds)) {
		consumeIdeKey('KeyY');
		redo();
		return;
	}
	if (ctrlDown && isKeyJustPressed('KeyS')) {
		consumeIdeKey('KeyS');
		void save();
		return;
	}
	const hasResults = activeSearchMatchCount() > 0;
	const previewLocal = ide_state.searchScope === 'local';
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		if (hasResults) {
			if (shiftDown) {
				moveSearchSelection(-1, { wrap: true, preview: previewLocal });
			} else if (ide_state.searchCurrentIndex === -1) {
				ide_state.searchCurrentIndex = 0;
			} else {
				moveSearchSelection(1, { wrap: true, preview: previewLocal });
			}
			applySearchSelection(ide_state.searchCurrentIndex);
		} else if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if (isKeyJustPressed('F3')) {
		consumeIdeKey('F3');
		if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if (hasResults) {
		if (ide_state.input.shouldRepeat('ArrowUp', deltaSeconds)) {
			consumeIdeKey('ArrowUp');
			moveSearchSelection(-1, { preview: previewLocal });
			return;
		}
		if (ide_state.input.shouldRepeat('ArrowDown', deltaSeconds)) {
			consumeIdeKey('ArrowDown');
			moveSearchSelection(1, { preview: previewLocal });
			return;
		}
		if (ide_state.input.shouldRepeat('PageUp', deltaSeconds)) {
			consumeIdeKey('PageUp');
			moveSearchSelection(-searchPageSize(), { preview: previewLocal });
			return;
		}
		if (ide_state.input.shouldRepeat('PageDown', deltaSeconds)) {
			consumeIdeKey('PageDown');
			moveSearchSelection(searchPageSize(), { preview: previewLocal });
			return;
		}
		if (isKeyJustPressed('Home')) {
			consumeIdeKey('Home');
			ide_state.searchCurrentIndex = hasResults ? 0 : -1;
			ensureSearchSelectionVisible();
			if (previewLocal) {
				applySearchSelection(ide_state.searchCurrentIndex, { preview: true });
			}
			return;
		}
		if (isKeyJustPressed('End')) {
			consumeIdeKey('End');
			const lastIndex = hasResults ? activeSearchMatchCount() - 1 : -1;
			ide_state.searchCurrentIndex = lastIndex;
			ensureSearchSelectionVisible();
			if (previewLocal) {
				applySearchSelection(ide_state.searchCurrentIndex, { preview: true });
			}
			return;
		}
	}

	const textChanged = applyInlineFieldEditing(ide_state.searchField, {
		deltaSeconds,
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});

	ide_state.searchQuery = getFieldText(ide_state.searchField);
	if (textChanged) {
		onSearchQueryChanged();
	}
}

export function handleLineJumpInput(deltaSeconds: number): void {
	const { shiftDown, ctrlDown, metaDown } = { shiftDown: isShiftDown(), ctrlDown: isCtrlDown(), metaDown: isMetaDown() };
	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyL')) {
		consumeIdeKey('KeyL');
		openLineJump();
		return;
	}
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		applyLineJump();
		return;
	}
	if (!shiftDown && isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('NumpadEnter');
		applyLineJump();
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeLineJump(false);
		return;
	}

	const digitFilter = (value: string): boolean => value >= '0' && value <= '9';
	const textChanged = applyInlineFieldEditing(ide_state.lineJumpField, {
		deltaSeconds,
		allowSpace: false,
		characterFilter: digitFilter,
		maxLength: 6,
	});
	ide_state.lineJumpValue = getFieldText(ide_state.lineJumpField);
	if (textChanged) {
		// keep value in sync; no additional processing required
	}
}export function readPointerSnapshot(): PointerSnapshot | null {
	const playerInput = $.input.getPlayerInput(ide_state.playerIndex);
	if (!playerInput) {
		return null;
	}
	const primaryAction = playerInput.getActionState('pointer_primary');
	const primaryPressed = primaryAction.pressed === true && primaryAction.consumed !== true;

	const positionAction = playerInput.getActionState('pointer_position');
	const coords = positionAction.value2d;
	if (!coords) {
		return {
			viewportX: 0,
			viewportY: 0,
			insideViewport: false,
			valid: false,
			primaryPressed,
		};
	}
	const mapped = mapScreenPointToViewport(coords[0], coords[1]);
	return {
		viewportX: mapped.x,
		viewportY: mapped.y,
		insideViewport: mapped.inside,
		valid: mapped.valid,
		primaryPressed,
	};
}
export function resetInputFocusState(): void {
	if (!api.keyboard) return;
	api.keyboard.reset();
	ide_state.input.resetRepeats();
	resetKeyPressRecords();
	ide_state.repeatState.clear();
}
export function requestWindowFocusState(hasFocus: boolean, immediate: boolean): void {
	ide_state.pendingWindowFocused = hasFocus;
	if (immediate) {
		flushWindowFocusState();
	}
}

export function flushWindowFocusState(): void {
	if (ide_state.pendingWindowFocused === ide_state.windowFocused) {
		return;
	}
	ide_state.windowFocused = ide_state.pendingWindowFocused;
	resetInputFocusState();
}
export function processRuntimeErrorOverlayPointer(snapshot: PointerSnapshot, justPressed: boolean, codeTop: number, codeRight: number, textLeft: number): boolean {
	const overlay = ide_state.runtimeErrorOverlay;
	if (!overlay || overlay.hidden) {
		return false;
	}
	const geometry = computeRuntimeErrorOverlayGeometry(codeRight, textLeft);
	const anchor = resolveRuntimeErrorOverlayAnchor(overlay, codeTop, textLeft, geometry.contentRight, geometry.availableBottom);
	if (!anchor) {
		overlay.layout = null;
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		return false;
	}
	const layout = computeRuntimeErrorOverlayLayout(
		overlay,
		anchor,
		codeTop,
		geometry.contentRight,
		textLeft,
		constants.ERROR_OVERLAY_PADDING_X,
		constants.ERROR_OVERLAY_PADDING_Y,
		computeRuntimeErrorOverlayMaxWidth()
	);
	if (!layout) {
		overlay.layout = null;
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		return false;
	}
	if (!snapshot.valid || !snapshot.insideViewport) {
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		return false;
	}
	const insideBubble = point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.bounds);
	if (!insideBubble) {
		overlay.hovered = false;
		overlay.hoverLine = -1;
		overlay.copyButtonHovered = false;
		if (justPressed && overlay.expanded) {
			overlay.expanded = false;
			rebuildRuntimeErrorOverlayView(overlay);
		}
		return false;
	}
	overlay.hovered = true;
	overlay.copyButtonHovered = point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.copyButtonRect);
	if (overlay.copyButtonHovered) {
		overlay.hoverLine = -1;
		if (!justPressed) {
			return true;
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		resetPointerClickTracking();
		const payload = buildRuntimeErrorOverlayCopyText(overlay);
		void writeClipboard(payload, 'Copied runtime error to clipboard');

		return true;
	}
	overlay.hoverLine = findRuntimeErrorOverlayLineAtPosition(overlay, snapshot.viewportX, snapshot.viewportY);
	if (!justPressed) {
		return true;
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	const clickResult = evaluateRuntimeErrorOverlayClick(overlay, overlay.hoverLine);
	switch (clickResult.kind) {
		case 'expand': {
			overlay.expanded = true;
			rebuildRuntimeErrorOverlayView(overlay);
			return true;
		}
		case 'collapse': {
			overlay.expanded = false;
			rebuildRuntimeErrorOverlayView(overlay);
			return true;
		}
		case 'navigate': {
			overlay.expanded = false;
			rebuildRuntimeErrorOverlayView(overlay);
			navigateToRuntimeErrorFrameTarget(clickResult.frame);
			return true;
		}
		case 'noop':
		default: {
			return true;
		}
	}
}
export function evaluateRuntimeErrorOverlayClick(
	overlay: RuntimeErrorOverlay,
	hoverLine: number
): RuntimeErrorOverlayClickResult {
	if (!overlay.expanded) {
		return { kind: 'expand' };
	}
	if (hoverLine < 0 || hoverLine >= overlay.lineDescriptors.length) {
		return { kind: 'collapse' };
	}
	const descriptor = overlay.lineDescriptors[hoverLine];
	if (descriptor.role === 'frame' && descriptor.frame) {
		if (descriptor.frame.origin === 'lua') {
			return { kind: 'navigate', frame: descriptor.frame };
		}
		return { kind: 'noop' };
	}
	return { kind: 'collapse' };
}export function toggleThemeMode() {
	const currentVariant = constants.getActiveIdeThemeVariant();
	const nextVariant = currentVariant === 'dark' ? 'light' : 'dark';
	constants.setIdeThemeVariant(nextVariant);
	ide_state.themeVariant = constants.getActiveIdeThemeVariant();
	ide_state.metadata.ideTheme = ide_state.themeVariant;
	ide_state.layout.invalidateAllHighlights();
}

