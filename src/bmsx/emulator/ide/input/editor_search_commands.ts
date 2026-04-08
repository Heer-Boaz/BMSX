import { focusRuntimeErrorOverlay } from '../runtime_error_navigation';
import { openSearch } from '../editor_search';
import { openGlobalSymbolSearch, openLineJump, openReferenceSearchPopup, openResourceSearch, openSymbolSearch, openRenamePrompt } from '../search_bars';
import { openCreateResourcePrompt } from '../create_resource';
import type { EditorCommandId } from './editor_commands';

export type EditorSearchCommandId =
	| 'symbolSearch'
	| 'symbolSearchGlobal'
	| 'resourceSearch'
	| 'runtimeErrorFocus'
	| 'createResource'
	| 'findGlobal'
	| 'findLocal'
	| 'lineJump'
	| 'referenceSearch'
	| 'rename';

export function isEditorSearchCommand(command: EditorCommandId): command is EditorSearchCommandId {
	return command === 'symbolSearch'
		|| command === 'symbolSearchGlobal'
		|| command === 'resourceSearch'
		|| command === 'runtimeErrorFocus'
		|| command === 'createResource'
		|| command === 'findGlobal'
		|| command === 'findLocal'
		|| command === 'lineJump'
		|| command === 'referenceSearch'
		|| command === 'rename';
}

export function executeEditorSearchCommand(command: EditorSearchCommandId): void {
	switch (command) {
		case 'symbolSearch':
			openSymbolSearch();
			return;
		case 'symbolSearchGlobal':
			openGlobalSymbolSearch();
			return;
		case 'resourceSearch':
			openResourceSearch();
			return;
		case 'runtimeErrorFocus':
			if (!focusRuntimeErrorOverlay()) {
				openResourceSearch();
			}
			return;
		case 'createResource':
			openCreateResourcePrompt();
			return;
		case 'findGlobal':
			openSearch(true, 'global');
			return;
		case 'findLocal':
			openSearch(true, 'local');
			return;
		case 'lineJump':
			openLineJump();
			return;
		case 'referenceSearch':
			openReferenceSearchPopup();
			return;
		case 'rename':
			openRenamePrompt();
			return;
	}
}
