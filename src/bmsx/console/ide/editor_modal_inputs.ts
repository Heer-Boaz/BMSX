// Editor modal input + search/symbol/resource/line-jump handling extracted from console_cart_editor.ts
// This module centralizes all non-core text editing input flows to shrink console_cart_editor.ts
// Follows project guidelines: no defensive coding unless necessary, assumes ide_state integrity.
import type { KeyboardInput } from '../../input/keyboardinput';
import { isKeyJustPressed as isKeyJustPressedGlobal, isModifierPressed as isModifierPressedGlobal } from './input_helpers';
import { handleDebuggerShortcuts } from './debugger_shortcuts';
import { ide_state } from './ide_state';
// Use re-exported helpers from main editor module (still hosted there)
import { jumpToNextMatch, jumpToPreviousMatch, moveSearchSelection, applySearchSelection, resetBlink, updateDesiredColumn, revealCursor } from './console_cart_editor';
import { consumeIdeKey } from './player_input_adapter';

declare function applySearchFieldText(text: string, resetSelection: boolean): void;
declare function processInlineFieldEditing(field: any, keyboard: KeyboardInput, opts: any): boolean;
declare function onSearchQueryChanged(): void;
declare function openSearch(useSelection: boolean, scope?: 'local' | 'global'): void;
declare function redo(): void;
declare function undo(): void;
declare function save(): Promise<void>;
declare function hasSelection(): boolean;
declare function openLineJump(): void;
declare function applyLineJumpFieldText(text: string, reset: boolean): void;
declare function applyLineJump(): void;
declare function closeLineJump(clearValue: boolean): void;
declare function closeSearch(clearQuery: boolean, forceHide?: boolean): void;
declare function openResourceSearch(initialQuery?: string): void;
declare function closeResourceSearch(clearQuery: boolean): void;
declare function openSymbolSearch(initialQuery?: string): void;
declare function openGlobalSymbolSearch(initialQuery?: string): void;
declare function closeSymbolSearch(clearQuery: boolean): void;
declare function indentSelectionOrLine(): void;
declare function unindentSelectionOrLine(): void;
declare function toggleLineComments(): void;
declare function cutSelectionToClipboard(): Promise<void>;
declare function cutLineToClipboard(): Promise<void>;
declare function copySelectionToClipboard(): Promise<void>;
declare function pasteFromClipboard(): void;
declare function cycleTab(delta: number): void;
declare function openRenamePrompt(): void;
declare function openReferenceSearchPopup(): void;
declare function handleCompletionKeybindings(keyboard: KeyboardInput, deltaSeconds: number, shift: boolean, ctrl: boolean, alt: boolean, meta: boolean): boolean;
declare function handleResourceSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void;
declare function handleSymbolSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void;
declare function handleLineJumpInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void;
declare function handleSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void;
declare function focusEditorFromResourceSearch(): void;
declare function toggleProblemsPanel(): void;
declare function markDiagnosticsDirty(): void;
declare function focusEditorFromProblemsPanel(): void;
declare function hideProblemsPanel(): void;
declare function shouldFireRepeat(keyboard: KeyboardInput, code: string, deltaSeconds: number): boolean;

// Central dispatcher previously named handleEditorInput (subset dealing with high-level shortcuts)
export function handleHighLevelEditorShortcuts(): boolean {
	const ctrlDown = isModifierPressedGlobal('ControlLeft') || isModifierPressedGlobal('ControlRight');
	const shiftDown = isModifierPressedGlobal('ShiftLeft') || isModifierPressedGlobal('ShiftRight');
	const metaDown = isModifierPressedGlobal('MetaLeft') || isModifierPressedGlobal('MetaRight');
	const altDown = isModifierPressedGlobal('AltLeft') || isModifierPressedGlobal('AltRight');

	// Search toggles
	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressedGlobal('KeyF')) {
		consumeIdeKey('KeyF');
		openSearch(true, 'global');
		return true;
	}
	if ((ctrlDown || metaDown) && !shiftDown && !altDown && isKeyJustPressedGlobal('KeyF')) {
		consumeIdeKey('KeyF');
		openSearch(true, 'local');
		return true;
	}
	// Symbol/resource toggles
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal('KeyO')) {
		consumeIdeKey('KeyO');
		openSymbolSearch();
		return true;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal('Comma')) {
		consumeIdeKey('Comma');
		openResourceSearch();
		return true;
	}
	if (!ctrlDown && !metaDown && altDown && isKeyJustPressedGlobal('Comma')) {
		consumeIdeKey('Comma');
		openGlobalSymbolSearch();
		return true;
	}
	// Problems panel toggle
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal('KeyM')) {
		consumeIdeKey('KeyM');
		// Delegate to original toggleProblemsPanel inside main file via global side-effects
		// (not extracted yet to avoid deep dependency chain)
		// @ts-ignore
		toggleProblemsPanel();
		if (ide_state.problemsPanel.isVisible()) {
			// @ts-ignore markDiagnosticsDirty still lives in console_cart_editor
			markDiagnosticsDirty();
		} else {
			// @ts-ignore focusEditorFromProblemsPanel lives in console_cart_editor
			focusEditorFromProblemsPanel();
		}
		return true;
	}
	// Tabs
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal('Tab')) {
		consumeIdeKey('Tab');
		cycleTab(shiftDown ? -1 : 1);
		return true;
	}
	// Line jump
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal('KeyL')) {
		consumeIdeKey('KeyL');
		openLineJump();
		return true;
	}
	// Rename
	if (!isInlineFieldFocused() && isCodeTabActive() && isKeyJustPressedGlobal('F2')) {
		consumeIdeKey('F2');
		openRenamePrompt();
		return true;
	}
	// References
	if (!isInlineFieldFocused() && isKeyJustPressedGlobal('F12')) {
		consumeIdeKey('F12');
		if (!shiftDown) {
			openReferenceSearchPopup();
		}
		return true;
	}
	// Select all
	if ((ctrlDown || metaDown) && !isInlineFieldFocused() && !ide_state.resourcePanelFocused && isCodeTabActive() && isKeyJustPressedGlobal('KeyA')) {
		consumeIdeKey('KeyA');
		ide_state.selectionAnchor = { row: 0, column: 0 };
		const lastRowIndex = ide_state.lines.length > 0 ? ide_state.lines.length - 1 : 0;
		const lastColumn = ide_state.lines.length > 0 ? ide_state.lines[lastRowIndex].length : 0;
		ide_state.cursorRow = lastRowIndex;
		ide_state.cursorColumn = lastColumn;
		updateDesiredColumn();
		resetBlink();
		revealCursor();
		return true;
	}
	return false;
}

// Inline field focus helper replicates logic from original code
export function isInlineFieldFocused(): boolean {
	return ide_state.searchActive
		|| ide_state.symbolSearchActive
		|| ide_state.resourceSearchActive
		|| ide_state.lineJumpActive
		|| ide_state.createResourceActive
		|| ide_state.renameController.isActive();
}

// Placeholder; real implementation remains in console_cart_editor.ts
declare function isCodeTabActive(): boolean;

// Search field key handling (simplified extraction wrapper)
export function handleSearchFieldInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): boolean {
	const altDown = isModifierPressedGlobal('AltLeft') || isModifierPressedGlobal('AltRight');
	if (!ide_state.searchActive) return false;
	// Undo/redo repeat now delegated to original handler; kept simple
	if (ctrlDown && isKeyJustPressedGlobal('KeyS')) {
		consumeIdeKey('KeyS');
		void save();
		return true;
	}
	const hasResults = activeSearchMatchCount() > 0;
	const previewLocal = ide_state.searchScope === 'local';
	if (isKeyJustPressedGlobal('Enter')) {
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
		return true;
	}
	if (isKeyJustPressedGlobal('F3')) {
		consumeIdeKey('F3');
		if (shiftDown) jumpToPreviousMatch(); else jumpToNextMatch();
		return true;
	}
	if (hasResults) {
		// Repeat handling delegated to original editor logic; left minimal here
	}
	const textChanged = processInlineFieldEditing(ide_state.searchField, keyboard, {
		ctrlDown,
		metaDown,
		shiftDown,
		altDown,
		deltaSeconds,
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	ide_state.searchQuery = ide_state.searchField.text;
	if (textChanged) {
		onSearchQueryChanged();
	}
	return textChanged;
}

// Utility used locally; actual implementation in main file
declare function activeSearchMatchCount(): number;

// Clipboard shortcuts extracted from editor input
export function handleClipboardShortcuts(): boolean {
	const ctrlDown = isModifierPressedGlobal('ControlLeft') || isModifierPressedGlobal('ControlRight');
	if (!ctrlDown) return false;
	if (isKeyJustPressedGlobal('KeyC')) {
		consumeIdeKey('KeyC');
		void copySelectionToClipboard();
		return true;
	}
	if (isKeyJustPressedGlobal('KeyX')) {
		consumeIdeKey('KeyX');
		if (hasSelection()) void cutSelectionToClipboard(); else void cutLineToClipboard();
		return true;
	}
	if (isKeyJustPressedGlobal('KeyV')) {
		consumeIdeKey('KeyV');
		pasteFromClipboard();
		return true;
	}
	return false;
}

// Indentation + comments shortcuts
export function handleFormattingShortcuts(): boolean {
	const ctrlDown = isModifierPressedGlobal('ControlLeft') || isModifierPressedGlobal('ControlRight');
	const metaDown = isModifierPressedGlobal('MetaLeft') || isModifierPressedGlobal('MetaRight');
	const altDown = isModifierPressedGlobal('AltLeft') || isModifierPressedGlobal('AltRight');
	if (ctrlDown && isKeyJustPressedGlobal('BracketRight')) {
		consumeIdeKey('BracketRight');
		indentSelectionOrLine();
		return true;
	}
	if (ctrlDown && isKeyJustPressedGlobal('BracketLeft')) {
		consumeIdeKey('BracketLeft');
		unindentSelectionOrLine();
		return true;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal('Slash')) {
		consumeIdeKey('Slash');
		toggleLineComments();
		return true;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal('NumpadDivide')) {
		consumeIdeKey('NumpadDivide');
		toggleLineComments();
		return true;
	}
	return false;
}

// Completion integration passthrough
export function handleCompletionIntegration(keyboard: KeyboardInput, deltaSeconds: number): boolean {
	const ctrlDown = isModifierPressedGlobal('ControlLeft') || isModifierPressedGlobal('ControlRight');
	const shiftDown = isModifierPressedGlobal('ShiftLeft') || isModifierPressedGlobal('ShiftRight');
	const metaDown = isModifierPressedGlobal('MetaLeft') || isModifierPressedGlobal('MetaRight');
	const altDown = isModifierPressedGlobal('AltLeft') || isModifierPressedGlobal('AltRight');
	return handleCompletionKeybindings(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown, metaDown);
}

// Route active modals to their respective input handlers; mirrors console_cart_editor's branching
export function processActiveModalInput(keyboard: KeyboardInput, deltaSeconds: number): boolean {
	const ctrlDown = isModifierPressedGlobal('ControlLeft') || isModifierPressedGlobal('ControlRight');
	const shiftDown = isModifierPressedGlobal('ShiftLeft') || isModifierPressedGlobal('ShiftRight');
	const metaDown = isModifierPressedGlobal('MetaLeft') || isModifierPressedGlobal('MetaRight');
	const altDown = isModifierPressedGlobal('AltLeft') || isModifierPressedGlobal('AltRight');

	if (ide_state.renameController.isActive()) {
		ide_state.renameController.handleInput(keyboard, deltaSeconds, { ctrlDown, metaDown, shiftDown, altDown });
		return true;
	}
	if (ide_state.resourceSearchActive) {
		handleResourceSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return true;
	}
	if (ide_state.symbolSearchActive) {
		handleSymbolSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return true;
	}
	if (ide_state.lineJumpActive) {
		handleLineJumpInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return true;
	}
	if (ide_state.searchActive) {
		handleSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return true;
	}
	if (ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused()) {
		if (shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			consumeIdeKey('ArrowUp');
			ide_state.problemsPanel.handleKeyboardCommand('up');
		} else if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			consumeIdeKey('ArrowDown');
			ide_state.problemsPanel.handleKeyboardCommand('down');
		} else if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
			consumeIdeKey('PageUp');
			ide_state.problemsPanel.handleKeyboardCommand('page-up');
		} else if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			consumeIdeKey('PageDown');
			ide_state.problemsPanel.handleKeyboardCommand('page-down');
		} else if (shouldFireRepeat(keyboard, 'Home', deltaSeconds)) {
			consumeIdeKey('Home');
			ide_state.problemsPanel.handleKeyboardCommand('home');
		} else if (shouldFireRepeat(keyboard, 'End', deltaSeconds)) {
			consumeIdeKey('End');
			ide_state.problemsPanel.handleKeyboardCommand('end');
		} else if (isKeyJustPressedGlobal('Enter') || isKeyJustPressedGlobal('NumpadEnter')) {
			if (isKeyJustPressedGlobal('Enter')) consumeIdeKey('Enter'); else consumeIdeKey('NumpadEnter');
			ide_state.problemsPanel.handleKeyboardCommand('activate');
		} else if (isKeyJustPressedGlobal('Escape')) {
			consumeIdeKey('Escape');
			hideProblemsPanel();
			focusEditorFromProblemsPanel();
			return true;
		}
		// Always swallow caret movement while problems panel is focused
		if (shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) consumeIdeKey('ArrowLeft');
		if (shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) consumeIdeKey('ArrowRight');
		return true;
	}
	return false;
}

// Aggregate handler to replace portions of handleEditorInput
export function processModalAndShortcutInput(keyboard: KeyboardInput, deltaSeconds: number): void {
	const playerIndex = ide_state.playerIndex;
	const ctrlDown = isModifierPressedGlobal('ControlLeft') || isModifierPressedGlobal('ControlRight');
	const shiftDown = isModifierPressedGlobal('ShiftLeft') || isModifierPressedGlobal('ShiftRight');
	const metaDown = isModifierPressedGlobal('MetaLeft') || isModifierPressedGlobal('MetaRight');
	const altDown = isModifierPressedGlobal('AltLeft') || isModifierPressedGlobal('AltRight');
	if (handleDebuggerShortcuts({
		keyboard,
		playerIndex,
		ctrlDown,
		shiftDown,
		altDown,
		metaDown,
	})) {
		return;
	}
	if (processActiveModalInput(keyboard, deltaSeconds)) return;
	if (handleHighLevelEditorShortcuts()) return;
	if (handleClipboardShortcuts()) return;
	if (handleFormattingShortcuts()) return;
	if (handleCompletionIntegration(keyboard, deltaSeconds)) return;
	// Let the original input controller continue (hosted in ide_state.input)
	ide_state.input.handleEditorInput(keyboard, deltaSeconds);
}

// Additional stubs for future extraction (symbol/resource/line jump could move here fully later)
// Currently kept minimal to avoid breaking incremental refactor.
