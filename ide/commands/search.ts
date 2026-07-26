import { focusRuntimeErrorOverlay } from '../runtime_error/navigation';
import { openResourceSearch } from '../workbench/contrib/resources/search/index';
import { openLineJump } from '../editor/contrib/find/line_jump';
import { openCreateResourcePrompt } from '../workbench/contrib/resources/create/index';
import { openReferenceSearchPopup } from '../editor/contrib/references/search/index';
import { openRenamePrompt } from '../editor/contrib/rename/prompt';
import { openGlobalSymbolSearch, openSymbolSearch } from '../editor/contrib/symbols/search/index';
import type { EditorCommandId, EditorSearchCommandId } from '../common/commands';
import type { RenameController } from '../editor/contrib/rename/controller';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeNativeBridge } from '../runtime/native_bridge';

export function isEditorSearchCommand(command: EditorCommandId): command is EditorSearchCommandId {
	switch (command) {
		case 'symbolSearch':
		case 'symbolSearchGlobal':
		case 'resourceSearch':
		case 'runtimeErrorFocus':
		case 'createResource':
		case 'findGlobal':
		case 'findLocal':
		case 'lineJump':
		case 'referenceSearch':
		case 'rename':
			return true;
		default:
			return false;
	}
}

export function executeEditorSearchCommand(
	editor: CartEditor,
	sources: RuntimeSourceState,
	nativeBridge: RuntimeNativeBridge,
	rename: RenameController,
	command: EditorSearchCommandId,
): void {
	switch (command) {
		case 'symbolSearch':
			openSymbolSearch(nativeBridge, rename);
			return;
		case 'symbolSearchGlobal':
			openGlobalSymbolSearch(nativeBridge, rename);
			return;
		case 'resourceSearch':
			openResourceSearch(sources);
			return;
		case 'runtimeErrorFocus':
			if (!focusRuntimeErrorOverlay(editor.resourcePanel)) {
				openResourceSearch(sources);
			}
			return;
		case 'createResource':
			openCreateResourcePrompt(sources, editor.resourcePanel);
			return;
		case 'findGlobal':
			editor.search.openSearch(true, 'global');
			return;
		case 'findLocal':
			editor.search.openSearch(true, 'local');
			return;
		case 'lineJump':
			openLineJump();
			return;
		case 'referenceSearch':
			openReferenceSearchPopup(nativeBridge, rename);
			return;
		case 'rename':
			openRenamePrompt(nativeBridge, rename);
			return;
	}
}
