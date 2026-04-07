import { $ } from '../../../core/engine_core';
import { writeClipboard } from '../text_editing_and_selection';
import { resetBlink } from '../render/render_caret';
import { focusEditorFromSearch } from '../editor_search';
import { ide_state } from '../ide_state';
import type { EditorContextMenuAction, EditorContextToken, PointerSnapshot } from '../types';
import { setCursorPosition } from '../caret';
import { isEditableCodeTab, getActiveCodeTabContext } from '../editor_tabs';
import { getCodeAreaBounds, resolvePointerColumn, resolvePointerRow } from '../editor_view';
import { clearReferenceHighlights, tryGotoDefinitionAt, resolveContextMenuToken, extractHoverExpression } from '../intellisense';
import * as constants from '../constants';
import { buildEditorContextMenuEntries, buildIncomingCallHierarchyView } from '../reference_navigation';
import { closeEditorContextMenu, findEditorContextMenuEntryAt, layoutEditorContextMenu, openEditorContextMenu, updateEditorContextMenuHover } from '../render/render_context_menu';
import { listResources } from '../../workspace';
import { Runtime } from '../../runtime';
import { prepareSemanticWorkspaceForEditorBuffer } from '../semantic_workspace_sync';
import { createLuaSemanticFrontendFromSnapshot } from '../semantic_workspace';
import { getTextSnapshot, splitText } from '../text/source_text';
import { setSingleCursorSelectionAnchor } from '../cursor_state';
import { closeSymbolSearch, focusEditorFromLineJump, focusEditorFromResourceSearch, focusEditorFromSymbolSearch, openReferenceSearchPopup, openRenamePrompt } from '../search_bars';

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
		case 'go_to_definition':
			focusEditorAtContextToken(token.row, token.startColumn);
			tryGotoDefinitionAt(token.row, token.startColumn);
			return;
		case 'go_to_references':
			focusEditorAtContextToken(token.row, token.startColumn);
			openReferenceSearchPopup();
			return;
		case 'call_hierarchy': {
			focusEditorAtContextToken(token.row, token.startColumn);
			const context = getActiveCodeTabContext();
			if (!context) {
				return;
			}
			const path = context.descriptor.path;
			const source = getTextSnapshot(ide_state.buffer);
			const snapshot = prepareSemanticWorkspaceForEditorBuffer({
				path,
				source,
				lines: splitText(source),
				version: ide_state.textVersion,
			});
			const frontend = createLuaSemanticFrontendFromSnapshot(snapshot, {
				extraGlobalNames: Array.from(Runtime.instance.interpreter.globalEnvironment.keys()),
			});
			const resolution = frontend.findReferencesByPosition(path, token.row + 1, token.startColumn + 1);
			if (!resolution) {
				ide_state.showMessage(`Definition not found for ${token.expression ?? token.text}`, constants.COLOR_STATUS_WARNING, 1.8);
				return;
			}
			const expression = extractHoverExpression(token.row, token.startColumn)?.expression ?? token.expression ?? token.text;
			const descriptors = listResources();
			let rootReadOnly = false;
			for (let index = 0; index < descriptors.length; index += 1) {
				const descriptor = descriptors[index];
				if (descriptor.path === path) {
					rootReadOnly = descriptor.readOnly === true;
					break;
				}
			}
			const allowedPaths = new Set<string>();
			for (let index = 0; index < descriptors.length; index += 1) {
				const descriptor = descriptors[index];
				const descriptorReadOnly = descriptor.readOnly === true;
				if (descriptorReadOnly === rootReadOnly) {
					allowedPaths.add(descriptor.path);
				}
			}
			allowedPaths.add(path);
			const view = buildIncomingCallHierarchyView({
				snapshot,
				rootSymbolId: resolution.id,
				rootExpression: expression,
				allowedPaths,
			});
			if (!view) {
				ide_state.showMessage(`No calls found for ${token.expression ?? token.text}`, constants.COLOR_STATUS_WARNING, 1.8);
				return;
			}
			closeSymbolSearch(false);
			ide_state.resourcePanel.showCallHierarchy(view);
			const panelState = ide_state.resourcePanel.getStateForRender();
			ide_state.resourcePanelFocused = panelState.focused;
			ide_state.resourceBrowserSelectionIndex = panelState.selectionIndex;
			ide_state.resourcePanelVisible = panelState.visible;
			ide_state.showMessage(view.title, constants.COLOR_STATUS_SUCCESS, 1.6);
			return;
		}
		case 'rename_symbol':
			focusEditorAtContextToken(token.row, token.startColumn);
			openRenamePrompt();
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
