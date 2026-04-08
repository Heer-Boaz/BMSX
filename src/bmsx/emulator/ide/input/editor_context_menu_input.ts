import { $ } from '../../../core/engine_core';
import { writeClipboard } from '../text_editing_and_selection';
import { resetBlink } from '../render/render_caret';
import { focusEditorFromSearch } from '../editor_search';
import { ide_state } from '../ide_state';
import type { EditorContextMenuAction, EditorContextToken, PointerSnapshot } from '../types';
import { setCursorPosition } from '../caret';
import { isEditableCodeTab } from '../editor_tabs';
import { getCodeAreaBounds, resolvePointerColumn, resolvePointerRow } from '../editor_view';
import { clearReferenceHighlights, resolveContextMenuToken } from '../intellisense';
import { buildEditorContextMenuEntries } from '../reference_navigation';
import { closeEditorContextMenu, findEditorContextMenuEntryAt, layoutEditorContextMenu, openEditorContextMenu, updateEditorContextMenuHover } from '../render/render_context_menu';
import { setSingleCursorSelectionAnchor } from '../cursor_state';
import { focusEditorFromLineJump, focusEditorFromResourceSearch, focusEditorFromSymbolSearch } from '../search_bars';
import { executeEditorCommand } from './editor_commands';

export function handleEditorContextMenuPointer(
	snapshot: PointerSnapshot,
	justPressed: boolean,
	secondaryJustPressed: boolean,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	const menu = ide_state.contextMenu;
	if (!menu.visible) {
		return false;
	}
	layoutEditorContextMenu(getCodeAreaBounds());
	if (!snapshot.valid || !snapshot.insideViewport) {
		menu.hoverIndex = -1;
		return false;
	}
	updateEditorContextMenuHover(snapshot.viewportX, snapshot.viewportY);
	const clickTriggered = justPressed || secondaryJustPressed;
	if (!clickTriggered) {
		return false;
	}
	const hitIndex = findEditorContextMenuEntryAt(snapshot.viewportX, snapshot.viewportY);
	if (hitIndex < 0) {
		closeEditorContextMenu();
		return false;
	}
	const entry = menu.entries[hitIndex];
	const token = menu.token!;
	closeEditorContextMenu();
	if (secondaryJustPressed) {
		playerInput.consumeAction('pointer_secondary');
		return true;
	}
	if (!entry.enabled) {
		return true;
	}
	executeEditorContextMenuAction(entry.action, token);
	playerInput.consumeAction('pointer_primary');
	return true;
}

export function openEditorContextMenuFromPointer(snapshot: PointerSnapshot, playerInput: ReturnType<typeof $.input.getPlayerInput>): boolean {
	const targetRow = resolvePointerRow(snapshot.viewportY);
	const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
	const token = resolveContextMenuToken(targetRow, targetColumn);
	if (!token) {
		return false;
	}
	const entries = buildEditorContextMenuEntries(token, isEditableCodeTab());
	if (entries.length === 0) {
		return false;
	}
	openEditorContextMenu(
		snapshot.viewportX,
		snapshot.viewportY,
		token,
		entries,
		getCodeAreaBounds()
	);
	updateEditorContextMenuHover(snapshot.viewportX, snapshot.viewportY);
	playerInput.consumeAction('pointer_secondary');
	return true;
}

function executeEditorContextMenuAction(action: EditorContextMenuAction, token: EditorContextToken): void {
	switch (action) {
		case 'goToDefinition':
		case 'referenceSearch':
		case 'callHierarchy':
		case 'rename':
			focusEditorAtContextToken(token.row, token.startColumn);
			executeEditorCommand(action);
			return;
		case 'copy_token':
			void writeClipboard(token.expression ?? token.text, 'Copied token to clipboard');
			return;
	}
}

function focusEditorAtContextToken(row: number, column: number): void {
	clearReferenceHighlights();
	ide_state.resourcePanelFocused = false;
	focusEditorFromLineJump();
	focusEditorFromSearch();
	focusEditorFromResourceSearch();
	focusEditorFromSymbolSearch();
	ide_state.completion.closeSession();
	setSingleCursorSelectionAnchor(ide_state, row, column);
	setCursorPosition(row, column);
	resetBlink();
}
