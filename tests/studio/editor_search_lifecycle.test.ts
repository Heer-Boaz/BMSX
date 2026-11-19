import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestCodeControl } from '../helpers/code_control';
import { EditorFont } from '../../ide/editor/ui/view/font';
import assert from 'node:assert/strict';
import test from 'node:test';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { insertValue, selectAll, getCursorOffset, selectedText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { EditorSearchController } from '../../ide/workbench/contrib/code_editor/find/search';
import { handleSearchInput } from '../../ide/input/quick_input/search/input';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { createTestCodeDocuments } from '../helpers/code_documents';
import { handleSearchNavigationKeybinding } from '../../ide/input/keyboard/edit_bindings';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { getSelectionText } from '../../ide/editor/editing/text_editing_and_selection';
import { LiteralTextMatcher } from '../../ide/common/search_text';

for (const variant of ['tiny', 'msx'] as const) test(`${variant} query Home and Shift-End retain text editing even with results`, t => {

	const source = 'local needle = 1\nreturn needle';
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'query.lua', location: { kind: 'workspace' as const, path: 'query.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'query.lua', source: { resid: 'query', type: 'lua' } }, 'lua', source);
	const code = createTestCodeControl(t, model, documents, clock, undefined, new EditorFont(variant));
	const search = new EditorSearchController(code);
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

test('local Find cancels before detach; clearing its retained field cannot access the old editor', t => {

	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'find.lua', location: { kind: 'workspace' as const, path: 'find.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'find.lua', source: { resid: 'find', type: 'lua' } }, 'lua', 'needle');
	const view = createCodeEditorViewState();
	const code = createTestCodeControl(t, model, documents, clock, view);
	const search = new EditorSearchController(code);
	t.after(() => {
		search.dispose();
		inputFocus.setTarget(null);
		code.detach();

		clearBackgroundTasks();
	});
	search.applySearchFieldText('needle', true);
	search.openSearch(false);
	assert.notEqual(search.state.job, null);
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
	assert.deepEqual(search.state.matches, []);
});

test('Find seeds from the source selection before applying query effects, including repeated opening', t => {

	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'selection.lua', location: { kind: 'workspace' as const, path: 'selection.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'selection.lua', source: { resid: 'selection', type: 'lua' } }, 'lua', 'first second');
	const view = createCodeEditorViewState();
	const code = createTestCodeControl(t, model, documents, clock, view);
	const search = new EditorSearchController(code);
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
	const search = new EditorSearchController(code);
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

test('Escape retains the local query and F3 resumes from the actual Source selection without reopening Find', t => {
	const { models, documents, clock } = createTestCodeDocuments(t), source = 'needle gap needle\nneedle';
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'resume.lua', location: { kind: 'workspace', path: 'resume.lua' },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'resume.lua', source: { resid: 'resume', type: 'lua' } }, 'lua', source);
	const code = createTestCodeControl(t, model, documents, clock), search = new EditorSearchController(code);
	t.after(() => { search.dispose(); inputFocus.setTarget(null); clearBackgroundTasks(); });
	search.applySearchFieldText('needle', true); search.openSearch(false); search.focus(); runBackgroundTasks(clock);
	search.applySearchSelection(0, { preview: true, keepSearchActive: true });
	assert.equal(code.view.cursorRow, 0); assert.equal(code.view.cursorColumn, 0);
	handleSearchInput(new KeyInputEvent('Escape', KeyModifier.none), search); code.focusTarget.focus();
	assert.equal(search.state.visible, false); assert.equal(search.state.query, 'needle');
	const next = new KeyInputEvent('F3', KeyModifier.none);
	assert.equal(handleSearchNavigationKeybinding(search, next), true);
	assert.equal(next.consumed, true); assert.equal(search.state.visible, false);
	assert.equal(code.view.cursorRow, 0); assert.equal(code.view.cursorColumn, 11);
	assert.equal(getSelectionText(code), 'needle');
	assert.equal(handleSearchNavigationKeybinding(search, new KeyInputEvent('F3', KeyModifier.shift)), true);
	assert.equal(code.view.cursorRow, 0); assert.equal(code.view.cursorColumn, 0);
	code.view.selectionAnchor = null; code.view.cursorColumn = 8;
	search.jumpToNextMatch(); assert.equal(code.view.cursorColumn, 11, 'a new caret position cannot skip the first following occurrence');
	assert.equal(model.buffer.getText(), source);
});

test('local insensitive matches retain original UTF-16 source coordinates through case folding and CRLF', t => {
	const { models, documents, clock } = createTestCodeDocuments(t), source = 'İ__NEEDLE__needle\r\n𐐀 needle';
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'unicode.lua', location: { kind: 'workspace', path: 'unicode.lua' },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'unicode.lua', source: { resid: 'unicode', type: 'lua' } }, 'lua', source);
	const code = createTestCodeControl(t, model, documents, clock), search = new EditorSearchController(code);
	const previousCase = editorRuntimeState.caseInsensitive; editorRuntimeState.caseInsensitive = true;
	t.after(() => { editorRuntimeState.caseInsensitive = previousCase; search.dispose(); inputFocus.setTarget(null); clearBackgroundTasks(); });
	search.applySearchFieldText('needle', true); search.openSearch(false); runBackgroundTasks(clock);
	assert.deepEqual(search.state.matches, [{ row: 0, start: 3, end: 9 }, { row: 0, start: 11, end: 17 }, { row: 1, start: 3, end: 9 }]);
	search.jumpToNextMatch(); assert.equal(getSelectionText(code), 'NEEDLE');
	assert.equal(code.view.cursorRow, 0); assert.equal(code.view.cursorColumn, 3);
	search.jumpToNextMatch(); assert.equal(code.view.cursorColumn, 11);
	assert.equal(model.buffer.getText(), source);
});

test('a long Source line yields through the bounded literal cursor instead of draining the whole line in one slice', t => {
	const { models, documents, clock } = createTestCodeDocuments(t), source = `${'x'.repeat(131072)}needle`;
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'long.lua', location: { kind: 'workspace', path: 'long.lua' },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'long.lua', source: { resid: 'long', type: 'lua' } }, 'lua', source);
	const code = createTestCodeControl(t, model, documents, clock), search = new EditorSearchController(code);
	t.after(() => { search.dispose(); clearBackgroundTasks(); });
	search.applySearchFieldText('needle', true); search.openSearch(false); runBackgroundTasks(clock);
	assert.ok(search.state.job !== null);
	while (search.state.job !== null) runBackgroundTasks(clock);
	assert.deepEqual(search.state.matches, [{ row: 0, start: source.length - 6, end: source.length }]);
});

test('retained local no-result navigation reuses its completed source receipt until that source changes', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'generation.lua', location: { kind: 'workspace', path: 'generation.lua' },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'generation.lua', source: { resid: 'generation', type: 'lua' } }, 'lua', 'other');
	const code = createTestCodeControl(t, model, documents, clock), search = new EditorSearchController(code);
	t.after(() => { search.dispose(); clearBackgroundTasks(); });
	search.applySearchFieldText('needle', true); search.openSearch(false); search.closeSearch(false);
	search.jumpToNextMatch();
	// This producer cache contract prevents a fresh whole-document scan per F3.
	const scans = t.mock.method(LiteralTextMatcher.prototype, 'createCursor');
	search.jumpToNextMatch(); search.jumpToPreviousMatch(); assert.equal(scans.mock.callCount(), 0);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: ' needle' }]);
	search.jumpToNextMatch(); assert.equal(scans.mock.callCount(), 1);
	assert.equal(getSelectionText(code), 'needle'); assert.equal(code.view.cursorColumn, 6);
});

test('F3 on a long Source yields and the latest navigation direction owns completion', t => {
	const { models, documents, clock } = createTestCodeDocuments(t), source = `needle ${'x'.repeat(131072)} needle`;
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'pending.lua', location: { kind: 'workspace', path: 'pending.lua' },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'pending.lua', source: { resid: 'pending', type: 'lua' } }, 'lua', source);
	const code = createTestCodeControl(t, model, documents, clock), search = new EditorSearchController(code);
	t.after(() => { search.dispose(); clearBackgroundTasks(); });
	search.applySearchFieldText('needle', true); search.openSearch(false); search.closeSearch(false);
	code.view.cursorColumn = source.length;
	search.jumpToNextMatch(); assert.ok(search.state.job !== null);
	assert.equal(code.view.cursorColumn, source.length, 'one F3 cannot synchronously drain the remaining source');
	search.jumpToPreviousMatch(); assert.ok(search.state.job !== null);
	while (search.state.job !== null) runBackgroundTasks(clock);
	assert.equal(code.view.cursorColumn, source.length - 6); assert.equal(getSelectionText(code), 'needle');
	assert.equal(search.state.visible, false); assert.equal(model.buffer.getText(), source);
});

test('a pending local navigation cannot select a newer model with the same version', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const resource = (path: string) => ({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { resid: path, type: 'lua' as const } });
	const first = models.retain(resource('old.lua'), 'lua', `${'x'.repeat(131072)} needle`);
	const second = models.retain(resource('new.lua'), 'lua', 'second needle');
	const code = createTestCodeControl(t, first, documents, clock), search = new EditorSearchController(code);
	t.after(() => { search.dispose(); clearBackgroundTasks(); });
	search.applySearchFieldText('needle', true); search.openSearch(false); search.closeSearch(false); search.jumpToNextMatch();
	assert.ok(search.state.job !== null); assert.equal(first.version, second.version);
	code.attach(second, createCodeEditorViewState(), documents.get(second)); runBackgroundTasks(clock);
	assert.equal(search.state.job, null); assert.deepEqual(search.state.matches, []);
	assert.equal(code.view.cursorColumn, 0); assert.equal(code.view.selectionAnchor, null);
	search.jumpToNextMatch(); assert.equal(code.view.cursorColumn, 7); assert.equal(getSelectionText(code), 'needle');
});

test('a newer Source caret intention vetoes the cursor effect of an older pending Find command', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'caret.lua', location: { kind: 'workspace', path: 'caret.lua' },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'caret.lua', source: { resid: 'caret', type: 'lua' } }, 'lua', `${'x'.repeat(131072)} needle`);
	const code = createTestCodeControl(t, model, documents, clock), search = new EditorSearchController(code);
	t.after(() => { search.dispose(); clearBackgroundTasks(); });
	search.applySearchFieldText('needle', true); search.openSearch(false); search.closeSearch(false); search.jumpToNextMatch();
	assert.ok(search.state.job !== null);
	code.view.cursorColumn = 17; code.emitCursorMoved();
	while (search.state.job !== null) runBackgroundTasks(clock);
	assert.equal(code.view.cursorColumn, 17); assert.equal(code.view.selectionAnchor, null);
	assert.equal(search.state.matches.length, 1, 'the result cache can complete without acquiring newer cursor authority');
});

test('Find selection seeding cannot publish into a replacement Source attachment from its cursor observer', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const resource = (path: string) => ({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { resid: path, type: 'lua' as const } });
	const first = models.retain(resource('seed.lua'), 'lua', 'needle'), second = models.retain(resource('replacement.lua'), 'lua', 'second');
	const code = createTestCodeControl(t, first, documents, clock), search = new EditorSearchController(code);
	code.view.selectionAnchor = { row: 0, column: 0 }; code.view.cursorColumn = 6;
	const release = code.onDidMoveCursor(() => {
		release(); search.clearInput(); code.detach(); code.attach(second, createCodeEditorViewState(), documents.get(second));
	});
	t.after(() => { release(); search.dispose(); clearBackgroundTasks(); });
	search.openSearch(true); runBackgroundTasks(clock);
	assert.ok(code.model === second); assert.equal(search.state.visible, false); assert.equal(search.state.job, null);
	assert.equal(code.view.cursorColumn, 0); assert.equal(code.view.selectionAnchor, null);
});

test('Find publishes completed result selection before layout observers can replace Source and choose a newer caret', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const resource = (path: string) => ({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { resid: path, type: 'lua' as const } });
	const first = models.retain(resource('result.lua'), 'lua', 'needle gap needle'), second = models.retain(resource('newer.lua'), 'lua', 'newer caret');
	const code = createTestCodeControl(t, first, documents, clock), search = new EditorSearchController(code), firstView = code.view;
	search.applySearchFieldText('needle', true); search.openSearch(false); runBackgroundTasks(clock);
	const release = search.onDidChangeLayout(() => {
		release();
		assert.equal(firstView.cursorColumn, 11); assert.deepEqual(firstView.selectionAnchor, { row: 0, column: 17 });
		search.clearInput(); code.detach(); code.attach(second, createCodeEditorViewState(), documents.get(second));
		code.view.cursorColumn = 5; code.emitCursorMoved();
	});
	t.after(() => { release(); search.dispose(); clearBackgroundTasks(); });
	search.applySearchSelection(1, { preview: true });
	assert.ok(code.model === second); assert.equal(code.view.cursorColumn, 5); assert.equal(code.view.selectionAnchor, null);
	assert.equal(search.state.visible, false); assert.equal(search.state.currentIndex, -1); assert.equal(search.state.job, null);
});
