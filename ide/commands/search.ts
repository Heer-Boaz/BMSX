import { showCommandPalette } from '../workbench/contrib/commands/quick_access';
import { focusRuntimeErrorOverlay } from '../runtime_error/navigation';
import { buildResourceQuickPickItems } from '../workbench/contrib/resources/quick_access';
import { TextQuickPickProvider } from '../workbench/services/quick_input/text_provider';
import { openLineJump } from '../workbench/contrib/code_editor/find/line_jump';
import { openCreateResourcePrompt } from '../workbench/contrib/resources/create/index';
import { openReferenceSearch } from '../workbench/contrib/code_editor/references/quick_access';
import { openRenamePrompt } from '../workbench/contrib/code_editor/rename/prompt';
import { openSymbolSearch } from '../workbench/contrib/code_editor/symbols/quick_access';
import type { EditorCommandId, EditorSearchCommandId } from '../common/commands';
import type { RenameController } from '../workbench/contrib/code_editor/rename/controller';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';

export function isEditorSearchCommand(command: EditorCommandId): command is EditorSearchCommandId {
	switch (command) {
		case 'commandPalette':
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
	luaTooling: RuntimeLuaTooling,
	rename: RenameController,
	command: EditorSearchCommandId,
): void {
	switch (command) {
		case 'commandPalette':
			showCommandPalette(editor.quickInput, editor.commands);
			return;
		case 'symbolSearch':
			openSymbolSearch(editor, luaTooling, 'file');
			return;
		case 'symbolSearchGlobal':
			openSymbolSearch(editor, luaTooling, 'workspace');
			return;
		case 'resourceSearch':
			editor.quickInput.pick('GO TO FILE', 'Type to filter files', () => new TextQuickPickProvider(buildResourceQuickPickItems(sources.activeResources)),
				item => { void editor.navigation.openResource(item.resource); });
			return;
		case 'runtimeErrorFocus':
			focusRuntimeErrorOverlay(editor.editorPanes);
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
			openReferenceSearch(editor, luaTooling);
			return;
		case 'rename':
			openRenamePrompt(luaTooling, rename);
			return;
	}
}
