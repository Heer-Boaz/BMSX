import { Runtime } from '../../runtime';
import * as constants from '../constants';
import { ide_state } from '../ide_state';
import { getActiveCodeTabContext } from '../editor_tabs';
import { tryGotoDefinitionAt, extractHoverExpression } from '../intellisense';
import { buildIncomingCallHierarchyView } from '../reference_navigation';
import { prepareSemanticWorkspaceForEditorBuffer } from '../semantic_workspace_sync';
import { createLuaSemanticFrontendFromSnapshot } from '../semantic_workspace';
import { getTextSnapshot, splitText } from '../text/source_text';
import { listResources } from '../../workspace';
import type { EditorCommandId } from './editor_commands';
import { closeSymbolSearch } from '../search_bars';

export type EditorSymbolNavigationCommandId =
	| 'goToDefinition'
	| 'callHierarchy';

export function isEditorSymbolNavigationCommand(command: EditorCommandId): command is EditorSymbolNavigationCommandId {
	return command === 'goToDefinition'
		|| command === 'callHierarchy';
}

export function executeEditorSymbolNavigationCommand(command: EditorSymbolNavigationCommandId): void {
	switch (command) {
		case 'goToDefinition':
			executeEditorGoToDefinitionAt(ide_state.cursorRow, ide_state.cursorColumn);
			return;
		case 'callHierarchy':
			executeEditorCallHierarchyAt(ide_state.cursorRow, ide_state.cursorColumn);
			return;
	}
}

export function executeEditorGoToDefinitionAt(row: number, column: number): boolean {
	return tryGotoDefinitionAt(row, column);
}

export function executeEditorCallHierarchyAt(row: number, column: number): void {
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
	const resolution = frontend.findReferencesByPosition(path, row + 1, column + 1);
	const expression = extractHoverExpression(row, column)?.expression;
	if (!resolution || !expression) {
		ide_state.showMessage('Definition not found at cursor', constants.COLOR_STATUS_WARNING, 1.8);
		return;
	}
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
		if ((descriptor.readOnly === true) === rootReadOnly) {
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
		ide_state.showMessage(`No calls found for ${expression}`, constants.COLOR_STATUS_WARNING, 1.8);
		return;
	}
	closeSymbolSearch(false);
	ide_state.resourcePanel.showCallHierarchy(view);
	const panelState = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanelFocused = panelState.focused;
	ide_state.resourceBrowserSelectionIndex = panelState.selectionIndex;
	ide_state.resourcePanelVisible = panelState.visible;
	ide_state.showMessage(view.title, constants.COLOR_STATUS_SUCCESS, 1.6);
}
