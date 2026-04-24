import { focusRuntimeErrorOverlay } from '../../../workbench/error/navigation';
import { openSearch } from '../../contrib/find/search';
import { openResourceSearch } from '../../../workbench/contrib/resources/search';
import { openLineJump } from '../../contrib/find/line_jump';
import { openCreateResourcePrompt } from '../../../workbench/contrib/resources/create';
import { openReferenceSearchPopup } from '../../contrib/references/search';
import { openRenamePrompt } from '../../contrib/rename/prompt';
import { openGlobalSymbolSearch, openSymbolSearch } from '../../contrib/symbols/search';
import type { EditorCommandId } from './dispatcher';

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
