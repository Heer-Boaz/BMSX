import { $ } from '../../core/game';
import type { KeyboardInput } from '../../input/keyboardinput';
import { isKeyJustPressed as isKeyJustPressedGlobal, isModifierPressed as isModifierPressedGlobal, isKeyTyped as isKeyTypedGlobal, consumeKey as consumeKeyboardKey, getKeyboardButtonState, shouldAcceptKeyPress as shouldAcceptKeyPressGlobal, clearKeyPressRecord } from './input_helpers';
import * as constants from './constants';
import { CHARACTER_CODES, CHARACTER_MAP } from './character_map';

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
  const ctrlDown = isModifierPressedGlobal(idx, 'ControlLeft') || isModifierPressedGlobal(idx, 'ControlRight');
  const shiftDown = isModifierPressedGlobal(idx, 'ShiftLeft') || isModifierPressedGlobal(idx, 'ShiftRight');
  const metaDown = isModifierPressedGlobal(idx, 'MetaLeft') || isModifierPressedGlobal(idx, 'MetaRight');
  const altDown = isModifierPressedGlobal(idx, 'AltLeft') || isModifierPressedGlobal(idx, 'AltRight');

    // Navigation
    this.handleNavigationKeys(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown);
    // Editing
    this.handleEditingKeys(keyboard, deltaSeconds, shiftDown, ctrlDown);
    if (ctrlDown || metaDown || altDown) return;
    // Characters
    this.handleCharacterInput(keyboard, shiftDown);
  if (isKeyJustPressedGlobal(idx, 'Space')) {
      this.host.insertText(' ');
      consumeKeyboardKey(keyboard, 'Space');
    }
  }

  private handleNavigationKeys(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, altDown: boolean): void {
    // Alt+Arrow: move selection lines up/down
    if (altDown) {
      let movedAlt = false;
      if (this.shouldRepeat('ArrowUp', deltaSeconds)) {
        consumeKeyboardKey(keyboard, 'ArrowUp');
        this.host.moveSelectionLines(-1);
        movedAlt = true;
      }
      if (this.shouldRepeat('ArrowDown', deltaSeconds)) {
        consumeKeyboardKey(keyboard, 'ArrowDown');
        this.host.moveSelectionLines(1);
        movedAlt = true;
      }
      if (movedAlt) return;
      // If user holds Alt+Up/Down, ignore further vertical movement handling
      if (isModifierPressedGlobal(this.host.getPlayerIndex(), 'AltLeft') || isModifierPressedGlobal(this.host.getPlayerIndex(), 'AltRight')) {
        // fall through only for horizontal/home/end/page keys
      }
    }
    // Arrow keys
    if (this.shouldRepeat('ArrowLeft', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'ArrowLeft');
      this.host.moveCursorLeft(ctrlDown || altDown, shiftDown);
      return;
    }
    if (this.shouldRepeat('ArrowRight', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'ArrowRight');
      this.host.moveCursorRight(ctrlDown || altDown, shiftDown);
      return;
    }
    if (this.shouldRepeat('ArrowUp', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'ArrowUp');
      this.host.moveCursorUp(shiftDown);
      return;
    }
    if (this.shouldRepeat('ArrowDown', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'ArrowDown');
      this.host.moveCursorDown(shiftDown);
      return;
    }
    // Home/End
    if (this.shouldRepeat('Home', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'Home');
      this.host.moveCursorHome(shiftDown);
      return;
    }
    if (this.shouldRepeat('End', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'End');
      this.host.moveCursorEnd(shiftDown);
      return;
    }
    // PageUp/PageDown
    if (this.shouldRepeat('PageDown', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'PageDown');
      this.host.pageDown(shiftDown);
      return;
    }
    if (this.shouldRepeat('PageUp', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'PageUp');
      this.host.pageUp(shiftDown);
      return;
    }
  }

  private handleEditingKeys(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean): void {
    // Tab / Shift+Tab
    if (isKeyJustPressedGlobal(this.host.getPlayerIndex(), 'Tab')) {
      consumeKeyboardKey(keyboard, 'Tab');
      if (shiftDown) this.host.unindentSelectionOrLine(); else this.host.insertText('\t');
      return;
    }
    // Backspace/Delete
    if (this.shouldRepeat('Backspace', deltaSeconds)) {
      consumeKeyboardKey(keyboard, 'Backspace');
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
      consumeKeyboardKey(keyboard, 'Delete');
      if (shiftDown && !ctrlDown) {
        this.host.deleteActiveLines();
      } else if (this.host.getSelection()) {
        this.host.deleteSelection();
      } else {
        this.host.deleteCharRight();
      }
      return;
    }
    // Enter
    if (isKeyJustPressedGlobal(this.host.getPlayerIndex(), 'Enter') || isKeyJustPressedGlobal(this.host.getPlayerIndex(), 'NumpadEnter')) {
      consumeKeyboardKey(keyboard, 'Enter');
      this.host.insertNewline();
      return;
    }
  }

  private handleCharacterInput(keyboard: KeyboardInput, shiftDown: boolean): void {
    const idx = this.host.getPlayerIndex();
    for (let i = 0; i < CHARACTER_CODES.length; i++) {
      const code = CHARACTER_CODES[i];
      if (!isKeyTypedGlobal(idx, code)) continue;
      const entry = CHARACTER_MAP[code];
      const value = shiftDown ? entry.shift : entry.normal;
      if (value && value.length > 0) {
        this.host.insertText(value);
      }
      consumeKeyboardKey(keyboard, code);
    }
  }

  // Repeat helper bridged to editor's repeat system via shouldAccept logic
  private shouldRepeat(code: string, deltaSeconds: number): boolean {
    const state = getKeyboardButtonState(this.host.getPlayerIndex(), code);
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

  // Apply input overrides (debug hotkeys + keyboard capture)
  public applyOverrides(active: boolean, captureKeys: readonly string[]): void {
    const input = $.input;
    input.setDebugHotkeysPaused(active);
    for (let i = 0; i < captureKeys.length; i++) {
      input.setKeyboardCapture(captureKeys[i], active);
    }
  }
}
