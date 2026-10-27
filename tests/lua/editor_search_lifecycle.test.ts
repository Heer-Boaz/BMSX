import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestCodeControl } from '../helpers/code_control';
import { EditorFont } from '../../ide/editor/ui/view/font';
import assert from 'node:assert/strict';
import test from 'node:test';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { insertValue, selectAll, getCursorOffset, selectedText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { EditorSearchController } from '../../ide/workbench/contrib/code_editor/find/search';
import { handleSearchInput } from '../../ide/input/quick_input/search/input';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { createTestCodeDocuments } from '../helpers/code_documents';

for (const variant of ['tiny', 'msx'] as const) test(`${variant} query Home and Shift-End retain text editing even with results`, t => {
	const catalog = new WorkspaceSourceCatalog();

	const source = 'local needle = 1\nreturn needle';
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'query.lua', location: { kind: 'workspace' as const, path: 'query.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'query.lua', source: { resid: 'query', type: 'lua' } }, 'lua', source);
	const code = createTestCodeControl(t, model, documents, clock, undefined, new EditorFont(variant));
	const search = new EditorSearchController(code, catalog);
	t.after(() => { search.dispose(); inputFocus.setTarget(null); code.detach();  clearBackgroundTasks(); });
	search.applySearchFieldText('needle', true); search.openSearch(false); runBackgroundTasks(clock);
	assert.equal(search.state.matches.length, 2);
	const field = search.state.field;
	const index = search.state.currentIndex;
	handleSearchInput(new KeyInputEvent('Home', KeyModifier.none), search);
	assert.equal(getCursorOffset(field), 0);
	assert.equal(search.state.currentIndex, index);
	handleSearchInput(new KeyInputEvent('End', KeyModifier.shift), search);
	assert.equal(getCursorOffset(field), field.text.length); assert.equal(selectedText(field), 'needle');
	assert.equal(search.state.currentIndex, index); assert.equal(model.buffer.getText(), source);
});

for (const scope of ['local', 'global'] as const) {
	test(`${scope} Find cancels before detach; clearing its retained field cannot access the old editor`, t => {

		const { models, documents, clock } = createTestCodeDocuments(t);
		const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'find.lua', location: { kind: 'workspace' as const, path: 'find.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'find.lua', source: { resid: 'find', type: 'lua' } }, 'lua', 'needle');
		const view = createCodeEditorViewState();
		const code = createTestCodeControl(t, model, documents, clock, view);
		const search = new EditorSearchController(code, new WorkspaceSourceCatalog());
		t.after(() => {
			search.dispose();
			inputFocus.setTarget(null);
			code.detach();

			clearBackgroundTasks();
		});
		search.applySearchFieldText('needle', true);
		search.openSearch(false, scope);
		assert.notEqual(scope === 'local' ? search.state.job : search.state.globalJob, null);
		view.selectionAnchor = { row: 0, column: 1 };
		search.closeSearch(false);
		assert.deepEqual(view.selectionAnchor, { row: 0, column: 1 }, 'closing Find preserves source selection');
		assert.equal(search.state.query, 'needle');
		code.detach();

		// Source from a diagram clears the retained field with no code pane attached.
		search.closeSearch(true);
		search.applySearchFieldText('another query', true);
		runBackgroundTasks(clock);
		assert.equal(search.state.visible, false);
		assert.equal(search.state.job, null);
		assert.equal(search.state.globalJob, null);
		assert.deepEqual(search.state.matches, []);
		assert.deepEqual(search.state.globalMatches, []);
	});
}

test('Find seeds from the source selection before applying query effects, including repeated opening', t => {

	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'selection.lua', location: { kind: 'workspace' as const, path: 'selection.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'selection.lua', source: { resid: 'selection', type: 'lua' } }, 'lua', 'first second');
	const view = createCodeEditorViewState();
	const code = createTestCodeControl(t, model, documents, clock, view);
	const search = new EditorSearchController(code, new WorkspaceSourceCatalog());
	t.after(() => {
		search.dispose();
		inputFocus.setTarget(null);
		code.detach();

		clearBackgroundTasks();
	});
	search.applySearchFieldText('old query', true);
	for (const [from, to, query] of [[0, 5, 'first'], [6, 12, 'second']] as const) {
		view.selectionAnchor = { row: 0, column: from };
		view.cursorColumn = to;
		search.openSearch(true);
		assert.equal(search.state.field.text, query);
		assert.equal(search.state.query, query);
		assert.equal(search.state.job!.query, query);
		assert.equal(view.cursorColumn, from);
	}
});

test('Find field edits and Undo rebind on opening; leaving an empty Find ends the session', t => {

	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'edits.lua', location: { kind: 'workspace' as const, path: 'edits.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'edits.lua', source: { resid: 'edits', type: 'lua' } }, 'lua', 'first second');
	const code = createTestCodeControl(t, model, documents, clock);
	const search = new EditorSearchController(code, new WorkspaceSourceCatalog());
	t.after(() => {
		search.dispose();
		inputFocus.setTarget(null);
		code.detach();

		clearBackgroundTasks();
	});
	const field = search.state.field;
	for (const query of ['first', 'second']) {
		search.openSearch(false);
		selectAll(field);
		insertValue(field, query);
		assert.equal(search.state.query, query);
		assert.equal(search.state.job!.query, query);
		field.undo();
		assert.equal(search.state.query, '');
		assert.equal(search.state.job, null);
		field.redo();
		assert.equal(search.state.job!.query, query);
		field.undo();
		search.focusEditorFromSearch();
		assert.equal(search.state.visible, false);
		code.detach();
		search.closeSearch(true);
		code.attach(model, createCodeEditorViewState(), documents.get(model));
	}
	assert.equal(model.version, 1);
});
