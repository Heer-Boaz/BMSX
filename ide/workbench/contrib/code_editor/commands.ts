import type { EditorCommandId } from '../../../common/commands';
import type { FocusCommand } from '../../../input/focus';
import { undo, redo } from '../../../editor/editing/undo_controller';
import { toggleWordWrap } from '../../../editor/ui/view/view';
import { executeEditorSymbolNavigationCommand } from '../../../commands/symbol_navigation';
import { openReferenceSearch } from './references/quick_access';
import { openSymbolSearch } from './symbols/quick_access';
import { openCodeContextMenuAtCursor } from './context_menu';
import type { CodeEditorPane } from './editor_pane';

/** Source actions bind the concrete control and its known inline fields, never focus ancestry. */
export function bindSourceCommands(pane: CodeEditorPane): () => void {
	const code = pane.code;
	const attached = () => code.model !== null;
	const lua = () => code.model !== null && code.model.mode === 'lua';
	const editableLua = () => code.model !== null && code.model.mode === 'lua' && !code.model.readOnly;
	const commands: readonly (readonly [EditorCommandId, FocusCommand])[] = [
		['findLocal', { isEnabled: attached, run: () => pane.openFind('local') }],
		['findGlobal', { isEnabled: attached, run: () => pane.openFind('global') }],
		['lineJump', { isEnabled: attached, run: () => pane.openLineJump() }],
		['rename', { isEnabled: editableLua, run: () => pane.openRename(false) }],
		['renamePreview', { isEnabled: editableLua, run: () => pane.openRename(true) }],
		['symbolSearch', { isEnabled: lua, run: () => openSymbolSearch(pane, 'file') }],
		['symbolSearchGlobal', { isEnabled: lua, run: () => openSymbolSearch(pane, 'workspace') }],
		['referenceSearch', { isEnabled: lua, run: () => openReferenceSearch(pane) }],
		['goToDefinition', { isEnabled: lua, run: () => executeEditorSymbolNavigationCommand(pane, 'goToDefinition') }],
		['callHierarchy', { isEnabled: lua, run: () => executeEditorSymbolNavigationCommand(pane, 'callHierarchy') }],
		['wrap', { isEnabled: attached, isChecked: () => attached() && code.view.wordWrapEnabled, run: () => toggleWordWrap(code) }],
	];
	const targets = [code.focusTarget, pane.find.state.field.focusTarget, pane.lineJump.state.field.focusTarget,
		pane.rename.getField().focusTarget];
	for (const target of targets) {
		for (const [id, command] of commands) target.registerCommand(id, command);
	}
	code.focusTarget.registerCommand('contextMenu', { isEnabled: attached, run: () => openCodeContextMenuAtCursor(pane) });
	code.focusTarget.registerCommand('undo', {
		isEnabled: () => code.model !== null && !code.model.readOnly && code.model.canUndo,
		run: () => undo(code),
	});
	code.focusTarget.registerCommand('redo', {
		isEnabled: () => code.model !== null && !code.model.readOnly && code.model.canRedo,
		run: () => redo(code),
	});
	return () => {
		for (const target of targets) for (const [id] of commands) target.unregisterCommand(id);
		code.focusTarget.unregisterCommand('contextMenu');
		code.focusTarget.unregisterCommand('undo');
		code.focusTarget.unregisterCommand('redo');
	};
}
