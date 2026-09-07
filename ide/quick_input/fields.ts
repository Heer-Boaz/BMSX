import { resetBlink } from '../editor/render/caret';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { CartEditor } from '../cart_editor';
import type { Clipboard } from '../common/clipboard';
import type { HostClock } from '../../hosts/common/clock';
import type { MicrotaskQueue } from '../common/microtask_queue';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import type { RuntimeSourceState } from '../runtime/sources';
import { editorSearchState, lineJumpState } from '../workbench/contrib/code_editor/find/widget_state';
import { symbolSearchState } from '../workbench/contrib/code_editor/symbols/search/state';
import { updateSymbolSearchMatches } from '../workbench/contrib/code_editor/symbols/search/catalog';
import { updateResourceSearchMatches } from '../workbench/contrib/resources/search/catalog';
import { createResourceState, resourceSearchState } from '../workbench/contrib/resources/widget_state';
import { renameController } from '../workbench/contrib/code_editor/rename/controller';
import { handleCreateResourceInput } from '../input/quick_input/create_resource/input';
import { handleLineJumpInput } from '../input/quick_input/line_jump/input';
import { handleResourceSearchInput } from '../input/quick_input/resource_search/input';
import { handleSearchInput } from '../input/quick_input/search/input';
import { handleSymbolSearchInput } from '../input/quick_input/symbol_search/input';

/** Typing and history changes publish through the same control-content event. */
export function bindQuickInputFields(
	editor: CartEditor,
	sources: RuntimeSourceState,
	tooling: RuntimeLuaTooling,
	clipboard: Clipboard,
	microtasks: MicrotaskQueue,
	storage: KeyValueStorage,
	clock: HostClock,
): () => void {
	const subscriptions = [
		editorSearchState.field.focusTarget.bindKeyboard(
			input => handleSearchInput(input, clipboard, editor, sources),
		),
		symbolSearchState.field.focusTarget.bindKeyboard(
			input => handleSymbolSearchInput(input, clipboard, microtasks, editor),
		),
		resourceSearchState.field.focusTarget.bindKeyboard(
			input => handleResourceSearchInput(input, clipboard, microtasks, editor, tooling, renameController),
		),
		lineJumpState.field.focusTarget.bindKeyboard(input => handleLineJumpInput(input, clipboard)),
		createResourceState.field.focusTarget.bindKeyboard(
			input => handleCreateResourceInput(input, clipboard, storage, clock, editor, sources),
		),
		renameController.getField().focusTarget.bindKeyboard(
			input => renameController.handleInput(input, clipboard, editor.crossFileRename),
		),
		editorSearchState.field.onDidChangeText(() => {
			editorSearchState.query = editorSearchState.field.text;
			editor.search.onSearchQueryChanged();
			resetBlink();
		}),
		symbolSearchState.field.onDidChangeText(() => {
			symbolSearchState.query = symbolSearchState.field.text;
			updateSymbolSearchMatches(tooling);
			resetBlink();
		}),
		resourceSearchState.field.onDidChangeText(() => {
			resourceSearchState.query = resourceSearchState.field.text;
			updateResourceSearchMatches();
			resetBlink();
		}),
		lineJumpState.field.onDidChangeText(() => {
			lineJumpState.value = lineJumpState.field.text;
			resetBlink();
		}),
		createResourceState.field.onDidChangeText(() => {
			createResourceState.path = createResourceState.field.text;
			createResourceState.error = null;
			resetBlink();
		}),
	];
	return () => {
		for (const unsubscribe of subscriptions) unsubscribe();
	};
}
