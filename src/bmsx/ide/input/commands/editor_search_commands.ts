import { focusRuntimeErrorOverlay } from '../../contrib/runtime_error/runtime_error_navigation';
import { openSearch } from '../../contrib/find/editor_search';
import { openResourceSearch } from '../../contrib/resources/resource_search';
import { openLineJump } from '../../contrib/find/line_jump';
import { openCreateResourcePrompt } from '../../contrib/resources/create_resource';
import { openReferenceSearchPopup } from '../../contrib/references/reference_search';
import { openRenamePrompt } from '../../contrib/rename/rename_prompt';
import { openGlobalSymbolSearch, openSymbolSearch } from '../../contrib/symbols/symbol_search';
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
