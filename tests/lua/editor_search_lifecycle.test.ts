import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { insertValue, selectAll, getCursorOffset, selectedText } from '../../ide/editor/ui/inline/text_field';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { inputFocus } from '../../ide/input/focus';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import { applySearchFieldText, EditorSearchController } from '../../ide/workbench/contrib/code_editor/find/search';
import { editorSearchState } from '../../ide/workbench/contrib/code_editor/find/widget_state';
import { RenameController } from '../../ide/workbench/contrib/code_editor/rename/controller';
import { handleSearchInput } from '../../ide/input/quick_input/search/input';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { CartEditor } from '../../ide/cart_editor';

const clock = new VirtualHeadlessClock();

for (const variant of ['tiny', 'msx'] as const) test(`${variant} query Home and Shift-End retain text editing even with results`, t => {
	const sources = {} as RuntimeSourceState;
	const search = new EditorSearchController(sources, new RenameController());
	const source = 'local needle = 1\nreturn needle';
	const model = new EditorTextModel({ location: { kind: 'workspace' as const, path: 'query.lua' }, domain: 0, path: 'query.lua', source: { resid: 'query', type: 'lua' } }, 'lua', source);
	activeCodeEditor.attach(model, createCodeEditorViewState());
	configureFontVariant(clock, variant, 'lua');
	t.after(() => { search.closeSearch(true); inputFocus.setTarget(null); activeCodeEditor.detach(); model.dispose(); clearBackgroundTasks(); });
	applySearchFieldText('needle', true); search.openSearch(false); runBackgroundTasks(clock);
	assert.equal(editorSearchState.matches.length, 2);
	const editor = { search } as CartEditor, field = editorSearchState.field;
	const index = editorSearchState.currentIndex;
	handleSearchInput(new KeyInputEvent('Home', KeyModifier.none), editor, sources);
	assert.equal(getCursorOffset(field), 0);
	assert.equal(editorSearchState.currentIndex, index);
	handleSearchInput(new KeyInputEvent('End', KeyModifier.shift), editor, sources);
	assert.equal(getCursorOffset(field), field.text.length); assert.equal(selectedText(field), 'needle');
	assert.equal(editorSearchState.currentIndex, index); assert.equal(model.buffer.getText(), source);
});

for (const scope of ['local', 'global'] as const) {
	test(`${scope} Find cancels before detach; clearing its retained field cannot access the old editor`, t => {
		const search = new EditorSearchController({ luaResources: [] } as unknown as RuntimeSourceState, new RenameController());
		const model = new EditorTextModel({ location: { kind: 'workspace' as const, path: 'find.lua' }, domain: 0, path: 'find.lua', source: { resid: 'find', type: 'lua' } }, 'lua', 'needle');
		const view = createCodeEditorViewState();
		activeCodeEditor.attach(model, view);
		configureFontVariant(clock, 'tiny', 'lua');
		t.after(() => {
			search.closeSearch(true);
			inputFocus.setTarget(null);
			activeCodeEditor.detach();
			model.dispose();
			clearBackgroundTasks();
		});
		applySearchFieldText('needle', true);
		search.openSearch(false, scope);
		assert.notEqual(scope === 'local' ? editorSearchState.job : editorSearchState.globalJob, null);
		view.selectionAnchor = { row: 0, column: 1 };
		search.closeSearch(false);
		assert.deepEqual(view.selectionAnchor, { row: 0, column: 1 }, 'closing Find preserves source selection');
		assert.equal(editorSearchState.query, 'needle');
		activeCodeEditor.detach();

		// Source from a diagram clears the retained field with no code pane attached.
		search.closeSearch(true);
		applySearchFieldText('another query', true);
		runBackgroundTasks(clock);
		assert.equal(editorSearchState.visible, false);
		assert.equal(editorSearchState.job, null);
		assert.equal(editorSearchState.globalJob, null);
		assert.deepEqual(editorSearchState.matches, []);
		assert.deepEqual(editorSearchState.globalMatches, []);
	});
}

test('Find seeds from the source selection before applying query effects, including repeated opening', t => {
	const search = new EditorSearchController({} as RuntimeSourceState, new RenameController());
	const model = new EditorTextModel({ location: { kind: 'workspace' as const, path: 'selection.lua' }, domain: 0, path: 'selection.lua', source: { resid: 'selection', type: 'lua' } }, 'lua', 'first second');
	const view = createCodeEditorViewState();
	activeCodeEditor.attach(model, view);
	configureFontVariant(clock, 'tiny', 'lua');
	t.after(() => {
		search.closeSearch(true);
		inputFocus.setTarget(null);
		activeCodeEditor.detach();
		model.dispose();
		clearBackgroundTasks();
	});
	applySearchFieldText('old query', true);
	for (const [from, to, query] of [[0, 5, 'first'], [6, 12, 'second']] as const) {
		view.selectionAnchor = { row: 0, column: from };
		view.cursorColumn = to;
		search.openSearch(true);
		assert.equal(editorSearchState.field.text, query);
		assert.equal(editorSearchState.query, query);
		assert.equal(editorSearchState.job!.query, query);
		assert.equal(view.cursorColumn, from);
	}
});

test('Find field edits and Undo rebind on opening; leaving an empty Find ends the session', t => {
	const search = new EditorSearchController({} as RuntimeSourceState, new RenameController());
	const model = new EditorTextModel({ location: { kind: 'workspace' as const, path: 'edits.lua' }, domain: 0, path: 'edits.lua', source: { resid: 'edits', type: 'lua' } }, 'lua', 'first second');
	activeCodeEditor.attach(model, createCodeEditorViewState());
	configureFontVariant(clock, 'tiny', 'lua');
	t.after(() => {
		search.closeSearch(true);
		inputFocus.setTarget(null);
		activeCodeEditor.detach();
		model.dispose();
		clearBackgroundTasks();
	});
	const field = editorSearchState.field;
	for (const query of ['first', 'second']) {
		search.openSearch(false);
		selectAll(field);
		insertValue(field, query);
		assert.equal(editorSearchState.query, query);
		assert.equal(editorSearchState.job!.query, query);
		field.undo();
		assert.equal(editorSearchState.query, '');
		assert.equal(editorSearchState.job, null);
		field.redo();
		assert.equal(editorSearchState.job!.query, query);
		field.undo();
		search.focusEditorFromSearch();
		assert.equal(editorSearchState.visible, false);
		activeCodeEditor.detach();
		search.closeSearch(true);
		activeCodeEditor.attach(model, createCodeEditorViewState());
	}
	assert.equal(model.version, 1);
});
