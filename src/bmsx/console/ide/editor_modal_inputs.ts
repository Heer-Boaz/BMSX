// Editor modal input + search/symbol/resource/line-jump handling extracted from console_cart_editor.ts
// This module centralizes all non-core text editing input flows to shrink console_cart_editor.ts
// Follows project guidelines: no defensive coding unless necessary, assumes ide_state integrity.
import type { KeyboardInput } from '../../input/keyboardinput';
import { isKeyJustPressed as isKeyJustPressedGlobal, isModifierPressed as isModifierPressedGlobal, consumeKey as consumeKeyboardKey } from './input_helpers';
import { handleDebuggerShortcuts } from './debugger_shortcuts';
import { ide_state } from './ide_state';
// Use re-exported helpers from main editor module (still hosted there)
import { jumpToNextMatch, jumpToPreviousMatch, moveSearchSelection, applySearchSelection, resetBlink, updateDesiredColumn, revealCursor } from './console_cart_editor';

// NOTE: Many helper functions (applySearchFieldText, processInlineFieldEditing, etc.) remain in console_cart_editor.ts.
// To avoid huge churn, we call through to them via the global namespace until a later extraction phase.
// These are declared here to satisfy TypeScript before full migration.
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
export function handleHighLevelEditorShortcuts(keyboard: KeyboardInput): boolean {
  const ctrlDown = isModifierPressedGlobal(ide_state.playerIndex, 'ControlLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ControlRight');
  const shiftDown = isModifierPressedGlobal(ide_state.playerIndex, 'ShiftLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ShiftRight');
  const metaDown = isModifierPressedGlobal(ide_state.playerIndex, 'MetaLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'MetaRight');
  const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');

  // Search toggles
  if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyF')) {
    consumeKeyboardKey(keyboard, 'KeyF');
    openSearch(true, 'global');
    return true;
  }
  if ((ctrlDown || metaDown) && !shiftDown && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyF')) {
    consumeKeyboardKey(keyboard, 'KeyF');
    openSearch(true, 'local');
    return true;
  }
  // Symbol/resource toggles
  if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyO')) {
    consumeKeyboardKey(keyboard, 'KeyO');
    openSymbolSearch();
    return true;
  }
  if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'Comma')) {
    consumeKeyboardKey(keyboard, 'Comma');
    openResourceSearch();
    return true;
  }
  if (!ctrlDown && !metaDown && altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'Comma')) {
    consumeKeyboardKey(keyboard, 'Comma');
    openGlobalSymbolSearch();
    return true;
  }
  // Problems panel toggle
  if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyM')) {
    consumeKeyboardKey(keyboard, 'KeyM');
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
  if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(ide_state.playerIndex, 'Tab')) {
    consumeKeyboardKey(keyboard, 'Tab');
    cycleTab(shiftDown ? -1 : 1);
    return true;
  }
  // Line jump
  if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyL')) {
    consumeKeyboardKey(keyboard, 'KeyL');
    openLineJump();
    return true;
  }
  // Rename
  if (!isInlineFieldFocused() && isCodeTabActive() && isKeyJustPressedGlobal(ide_state.playerIndex, 'F2')) {
    consumeKeyboardKey(keyboard, 'F2');
    openRenamePrompt();
    return true;
  }
  // References
  if (!isInlineFieldFocused() && isKeyJustPressedGlobal(ide_state.playerIndex, 'F12')) {
    consumeKeyboardKey(keyboard, 'F12');
    if (!shiftDown) {
      openReferenceSearchPopup();
    }
    return true;
  }
  // Select all
  if ((ctrlDown || metaDown) && !isInlineFieldFocused() && !ide_state.resourcePanelFocused && isCodeTabActive() && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyA')) {
    consumeKeyboardKey(keyboard, 'KeyA');
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
  const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');
  if (!ide_state.searchActive) return false;
  // Undo/redo repeat now delegated to original handler; kept simple
  if (ctrlDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyS')) {
    consumeKeyboardKey(keyboard, 'KeyS');
    void save();
    return true;
  }
  const hasResults = activeSearchMatchCount() > 0;
  const previewLocal = ide_state.searchScope === 'local';
  if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter')) {
    consumeKeyboardKey(keyboard, 'Enter');
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
  if (isKeyJustPressedGlobal(ide_state.playerIndex, 'F3')) {
    consumeKeyboardKey(keyboard, 'F3');
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
export function handleClipboardShortcuts(keyboard: KeyboardInput): boolean {
  const ctrlDown = isModifierPressedGlobal(ide_state.playerIndex, 'ControlLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ControlRight');
  if (!ctrlDown) return false;
  if (isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyC')) {
    consumeKeyboardKey(keyboard, 'KeyC');
    void copySelectionToClipboard();
    return true;
  }
  if (isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyX')) {
    consumeKeyboardKey(keyboard, 'KeyX');
    if (hasSelection()) void cutSelectionToClipboard(); else void cutLineToClipboard();
    return true;
  }
  if (isKeyJustPressedGlobal(ide_state.playerIndex, 'KeyV')) {
    consumeKeyboardKey(keyboard, 'KeyV');
    pasteFromClipboard();
    return true;
  }
  return false;
}

// Indentation + comments shortcuts
export function handleFormattingShortcuts(keyboard: KeyboardInput): boolean {
  const ctrlDown = isModifierPressedGlobal(ide_state.playerIndex, 'ControlLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ControlRight');
  const metaDown = isModifierPressedGlobal(ide_state.playerIndex, 'MetaLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'MetaRight');
  const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');
  if (ctrlDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'BracketRight')) {
    consumeKeyboardKey(keyboard, 'BracketRight');
    indentSelectionOrLine();
    return true;
  }
  if (ctrlDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'BracketLeft')) {
    consumeKeyboardKey(keyboard, 'BracketLeft');
    unindentSelectionOrLine();
    return true;
  }
  if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'Slash')) {
    consumeKeyboardKey(keyboard, 'Slash');
    toggleLineComments();
    return true;
  }
  if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(ide_state.playerIndex, 'NumpadDivide')) {
    consumeKeyboardKey(keyboard, 'NumpadDivide');
    toggleLineComments();
    return true;
  }
  return false;
}

// Completion integration passthrough
export function handleCompletionIntegration(keyboard: KeyboardInput, deltaSeconds: number): boolean {
  const ctrlDown = isModifierPressedGlobal(ide_state.playerIndex, 'ControlLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ControlRight');
  const shiftDown = isModifierPressedGlobal(ide_state.playerIndex, 'ShiftLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ShiftRight');
  const metaDown = isModifierPressedGlobal(ide_state.playerIndex, 'MetaLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'MetaRight');
  const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');
  return handleCompletionKeybindings(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown, metaDown);
}

// Route active modals to their respective input handlers; mirrors console_cart_editor's branching
export function processActiveModalInput(keyboard: KeyboardInput, deltaSeconds: number): boolean {
  const ctrlDown = isModifierPressedGlobal(ide_state.playerIndex, 'ControlLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ControlRight');
  const shiftDown = isModifierPressedGlobal(ide_state.playerIndex, 'ShiftLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ShiftRight');
  const metaDown = isModifierPressedGlobal(ide_state.playerIndex, 'MetaLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'MetaRight');
  const altDown = isModifierPressedGlobal(ide_state.playerIndex, 'AltLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'AltRight');

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
      consumeKeyboardKey(keyboard, 'ArrowUp');
  ide_state.problemsPanel.handleKeyboardCommand('up');
    } else if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'ArrowDown');
  ide_state.problemsPanel.handleKeyboardCommand('down');
    } else if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'PageUp');
  ide_state.problemsPanel.handleKeyboardCommand('page-up');
    } else if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'PageDown');
  ide_state.problemsPanel.handleKeyboardCommand('page-down');
    } else if (shouldFireRepeat(keyboard, 'Home', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'Home');
  ide_state.problemsPanel.handleKeyboardCommand('home');
    } else if (shouldFireRepeat(keyboard, 'End', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'End');
  ide_state.problemsPanel.handleKeyboardCommand('end');
    } else if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter') || isKeyJustPressedGlobal(ide_state.playerIndex, 'NumpadEnter')) {
      if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Enter')) consumeKeyboardKey(keyboard, 'Enter'); else consumeKeyboardKey(keyboard, 'NumpadEnter');
  ide_state.problemsPanel.handleKeyboardCommand('activate');
    } else if (isKeyJustPressedGlobal(ide_state.playerIndex, 'Escape')) {
      consumeKeyboardKey(keyboard, 'Escape');
      hideProblemsPanel();
      focusEditorFromProblemsPanel();
      return true;
    }
    // Always swallow caret movement while problems panel is focused
    if (shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) consumeKeyboardKey(keyboard, 'ArrowLeft');
    if (shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) consumeKeyboardKey(keyboard, 'ArrowRight');
    return true;
  }
  return false;
}

// Aggregate handler to replace portions of handleEditorInput
export function processModalAndShortcutInput(keyboard: KeyboardInput, deltaSeconds: number): void {
  const playerIndex = ide_state.playerIndex;
  const ctrlDown = isModifierPressedGlobal(playerIndex, 'ControlLeft') || isModifierPressedGlobal(playerIndex, 'ControlRight');
  const shiftDown = isModifierPressedGlobal(playerIndex, 'ShiftLeft') || isModifierPressedGlobal(playerIndex, 'ShiftRight');
  const metaDown = isModifierPressedGlobal(playerIndex, 'MetaLeft') || isModifierPressedGlobal(playerIndex, 'MetaRight');
  const altDown = isModifierPressedGlobal(playerIndex, 'AltLeft') || isModifierPressedGlobal(playerIndex, 'AltRight');
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
  if (handleHighLevelEditorShortcuts(keyboard)) return;
  if (handleClipboardShortcuts(keyboard)) return;
  if (handleFormattingShortcuts(keyboard)) return;
  if (handleCompletionIntegration(keyboard, deltaSeconds)) return;
  // Let the original input controller continue (hosted in ide_state.input)
  ide_state.input.handleEditorInput(keyboard, deltaSeconds);
}

// Additional stubs for future extraction (symbol/resource/line jump could move here fully later)
// Currently kept minimal to avoid breaking incremental refactor.
