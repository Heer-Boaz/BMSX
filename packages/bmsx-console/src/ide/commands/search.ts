import { focusRuntimeErrorOverlay } from '../runtime_error/navigation';
import { openResourceSearch } from '../workbench/contrib/resources/search';
import { openLineJump } from '../editor/contrib/find/line_jump';
import { openCreateResourcePrompt } from '../workbench/contrib/resources/create';
import { openReferenceSearchPopup } from '../editor/contrib/references/search';
import { openRenamePrompt } from '../editor/contrib/rename/prompt';
import { openGlobalSymbolSearch, openSymbolSearch } from '../editor/contrib/symbols/search';
import type { EditorCommandId, EditorSearchCommandId } from '../common/commands';
import type { Runtime } from '../../machine/runtime/runtime';

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

export function executeEditorSearchCommand(runtime: Runtime, command: EditorSearchCommandId): void {
	switch (command) {
		case 'symbolSearch':
			openSymbolSearch(runtime);
			return;
		case 'symbolSearchGlobal':
			openGlobalSymbolSearch(runtime);
			return;
		case 'resourceSearch':
			openResourceSearch(runtime);
			return;
		case 'runtimeErrorFocus':
			if (!focusRuntimeErrorOverlay()) {
				openResourceSearch(runtime);
			}
			return;
		case 'createResource':
			openCreateResourcePrompt(runtime);
			return;
		case 'findGlobal':
			runtime.editor.search.openSearch(true, 'global');
			return;
		case 'findLocal':
			runtime.editor.search.openSearch(true, 'local');
			return;
		case 'lineJump':
			openLineJump();
			return;
		case 'referenceSearch':
			openReferenceSearchPopup(runtime);
			return;
		case 'rename':
			openRenamePrompt(runtime);
			return;
	}
}
