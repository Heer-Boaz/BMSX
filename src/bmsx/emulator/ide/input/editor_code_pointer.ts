import { $ } from '../../../core/engine_core';
import { ide_state } from '../ide_state';
import type { CodeTabContext, PointerSnapshot } from '../types';
import { setCursorPosition } from '../caret';
import { ensureSingleCursorSelectionAnchor, setSingleCursorSelectionAnchor } from '../cursor_state';
import { isCodeTabActive } from '../editor_tabs';
import { toggleBreakpointForEditorRow } from '../ide_debugger';
import { clearHoverTooltip, updateHoverTooltip, clearGotoHoverHighlight, clearReferenceHighlights, refreshGotoHoverHighlight } from '../intellisense';
import * as TextEditing from '../text_editing_and_selection';
import { openEditorContextMenuFromPointer } from './editor_context_menu_input';
import { getCodeAreaBounds, resetPointerClickTracking, resolvePointerRow, resolvePointerColumn, handlePointerAutoScroll } from '../editor_view';
import { focusEditorFromSearch } from '../editor_search';
import { focusEditorFromLineJump, focusEditorFromResourceSearch, focusEditorFromSymbolSearch } from '../search_bars';
import { isAltDown } from './key_input';
import { processRuntimeErrorOverlayPointer } from './runtime_error_overlay_input';
import { executeEditorGoToDefinitionAt } from './editor_symbol_navigation_commands';
import * as constants from '../constants';

export function handleCodeAreaPointerInput(
	snapshot: PointerSnapshot,
	justPressed: boolean,
	gotoModifierActive: boolean,
	activeContext: CodeTabContext,
	pointerSecondaryJustPressed: boolean,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): void {
	const bounds = getCodeAreaBounds();
	if (processRuntimeErrorOverlayPointer(snapshot, justPressed, bounds.codeTop, bounds.codeRight, bounds.textLeft)) {
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
	if (pointerSecondaryJustPressed) {
		if (insideCodeArea && !inGutter && openEditorContextMenuFromPointer(snapshot, playerInput)) {
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			return;
		}
	}
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
		if (gotoModifierActive && executeEditorGoToDefinitionAt(targetRow, targetColumn)) {
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			return;
		}
		const doubleClick = registerPointerClick(targetRow, targetColumn);
		if (doubleClick) {
			TextEditing.selectWordAtPosition(targetRow, targetColumn);
			ide_state.pointerSelecting = false;
		} else {
			setSingleCursorSelectionAnchor(ide_state, targetRow, targetColumn);
			setCursorPosition(targetRow, targetColumn);
			ide_state.pointerSelecting = true;
		}
	}
	if (ide_state.pointerSelecting && snapshot.primaryPressed) {
		clearGotoHoverHighlight();
		handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY);
		const targetRow = resolvePointerRow(snapshot.viewportY);
		const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
		ensureSingleCursorSelectionAnchor(ide_state, targetRow, targetColumn);
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
