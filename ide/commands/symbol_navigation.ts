import { gotoDefinitionAt } from '../workbench/ui/code_tab/activation';
import { executeEditorCallHierarchyAt } from '../editor/contrib/call_hierarchy/command';
import { editorDocumentState } from '../editor/editing/document_state';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { EditorCommandId, EditorSymbolNavigationCommandId } from '../common/commands';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeNativeBridge } from '../runtime/native_bridge';
import type { RuntimeFaultState } from '../runtime/fault_state';

export function isEditorSymbolNavigationCommand(command: EditorCommandId): command is EditorSymbolNavigationCommandId {
	return command === 'goToDefinition'
		|| command === 'callHierarchy';
}

export function executeEditorSymbolNavigationCommand(
	editor: CartEditor,
	sources: RuntimeSourceState,
	nativeBridge: RuntimeNativeBridge,
	fault: RuntimeFaultState,
	runtime: Runtime,
	command: EditorSymbolNavigationCommandId,
): void {
	switch (command) {
		case 'goToDefinition':
			gotoDefinitionAt(
				nativeBridge,
				fault,
				editor,
				sources,
				runtime,
				editorDocumentState.cursorRow,
				editorDocumentState.cursorColumn,
			);
			return;
		case 'callHierarchy':
			executeEditorCallHierarchyAt(
				nativeBridge,
				editor.resourcePanel,
				editorDocumentState.cursorRow,
				editorDocumentState.cursorColumn,
			);
			return;
	}
}
