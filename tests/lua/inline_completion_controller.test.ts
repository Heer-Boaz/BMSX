import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorTextInput } from '../../ide/workbench/contrib/code_editor/native_text_input';
import { EditorCompletionController } from '../../ide/workbench/contrib/code_editor/suggest/completion_controller';
import { buildCodeTabId } from '../../ide/workbench/ui/code_tab/contexts';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, source: string, columnOffset = source.length) {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const record = createScenarioTestSourceRecord('inline.lua', 1, source);
	const sources = createScenarioTestSourceState([record]);
	const model = editorTextModelService.retain({ domain: 0, path: record.normalized_source_path, source: record }, 'lua', source);
	const view = createCodeEditorViewState(), position = { row: 0, column: 0 };
	model.buffer.positionAt(columnOffset, position); view.cursorRow = position.row; view.cursorColumn = position.column;
	const input = new CodeEditorInput({ id: buildCodeTabId(model.resource), title: 'inline.lua', model, view,
		runtimeErrorOverlay: null, executionStopRow: null });
	editorTabGroup.add(input); editorTabGroup.activate(input); activeCodeEditor.attach(model, view);
	activeCodeEditor.focusTarget.focus();
	const controller = new EditorCompletionController(sources, null, null, null), native = new CodeEditorTextInput();
	editorRuntimeState.currentTimeMs = 1000;
	t.after(() => {
		controller.dispose(); inputFocus.setTarget(null); editorTabGroup.clear(); activeCodeEditor.detach();
		resetSemanticProjects(editorTextModelService); editorTextModelService.clear();
	});
	const type = (text: string) => {
		const at = model.buffer.offsetAt(view.cursorRow, view.cursorColumn);
		editorRuntimeState.currentTimeMs += 10;
		assert.equal(native.replaceText(at, at, text), true);
	};
	const settle = () => { editorRuntimeState.currentTimeMs += 200; controller.processPending(0.2); };
	return { model, view, controller, type, settle };
}

test('real native typing produces a cached inline suffix; draw queries do not read candidates or source', t => {
	const f = fixture(t, 'retu'); f.type('r'); f.settle();
	const preview = f.controller.getInlineCompletionPreview();
	assert.deepEqual(preview, { row: 0, column: 5, suffix: 'n' });
	assert.equal(f.model.buffer.getText(), 'retur');
	const item = f.controller.session!.filteredItems[f.controller.session!.selectionIndex], insertText = item.insertText;
	let candidateReads = 0;
	Object.defineProperty(item, 'insertText', { configurable: true, get() { candidateReads++; return insertText; } });
	t.after(() => Object.defineProperty(item, 'insertText', { configurable: true, writable: true, value: insertText }));
	const read = f.model.buffer.getLineContent.bind(f.model.buffer);
	const sourceReads = t.mock.method(f.model.buffer, 'getLineContent', read);
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.controller.getInlineCompletionPreview(), preview);
	assert.equal(candidateReads, 0); assert.equal(sourceReads.mock.callCount(), 0);
	f.controller.closeSession(); assert.equal(f.controller.getInlineCompletionPreview(), null);
});

test('a mid-identifier suffix retains the actual Tab replacement and one source Undo', t => {
	const before = 'local sprite_direction = 1\nsprite_directi_tail';
	const f = fixture(t, before, before.indexOf('_tail'));
	f.type('o'); f.settle();
	assert.deepEqual(f.controller.getInlineCompletionPreview(), { row: 1, column: 'sprite_directio'.length, suffix: 'n' });
	const typed = f.model.buffer.getText(), tab = new KeyInputEvent('Tab', KeyModifier.none);
	assert.equal(f.controller.handleKeybindings(tab), true); assert.equal(tab.consumed, true);
	assert.equal(f.model.buffer.getLineContent(1), 'sprite_direction');
	assert.equal(f.controller.getInlineCompletionPreview(), null);
	f.model.undo(); assert.equal(f.model.buffer.getText(), typed);
});

test('empty-suffix tail removal needs an explicit popup, never invisible automatic Tab admission', t => {
	const before = 'local sprite = 1\nsprit_tail', f = fixture(t, before, before.indexOf('_tail'));
	f.type('e'); f.settle();
	assert.equal(f.controller.getInlineCompletionPreview(), null); assert.equal(f.controller.session, null);
	const tab = new KeyInputEvent('Tab', KeyModifier.none);
	assert.equal(f.controller.handleKeybindings(tab), false); assert.equal(tab.consumed, false);
	assert.equal(f.model.buffer.getLineContent(1), 'sprite_tail');
	f.controller.handleKeybindings(new KeyInputEvent('Space', KeyModifier.ctrl));
	assert.equal(f.controller.session!.filteredItems[f.controller.session!.selectionIndex].insertText, 'sprite');
	assert.equal(f.controller.getInlineCompletionPreview(), null);
	assert.equal(f.controller.handleKeybindings(new KeyInputEvent('Tab', KeyModifier.none)), true);
	assert.equal(f.model.buffer.getLineContent(1), 'sprite');
});

test('automatic substring-only matches never capture Tab; explicit completion still exposes them', t => {
	const f = fixture(t, 'local prefix_zzmatch_tail = 1\nzzmatc'); f.type('h'); f.settle();
	assert.equal(f.controller.session, null); assert.equal(f.controller.getInlineCompletionPreview(), null);
	const tab = new KeyInputEvent('Tab', KeyModifier.none);
	assert.equal(f.controller.handleKeybindings(tab), false); assert.equal(tab.consumed, false);
	assert.ok(f.controller.listCompletionCandidates()!.filteredItems.some(item => item.label === 'prefix_zzmatch_tail'));
	f.controller.handleKeybindings(new KeyInputEvent('Space', KeyModifier.ctrl));
	assert.ok(f.controller.session!.filteredItems.some(item => item.label === 'prefix_zzmatch_tail'));
	assert.equal(f.controller.getInlineCompletionPreview(), null, 'manual candidates belong to the explicit popup');
});

test('automatic candidate navigation refreshes the cached suffix without writing source', t => {
	const f = fixture(t, 'local alpha_one = 1\nlocal alpha_two = 2\nalp'); f.type('h'); f.settle();
	assert.equal(f.controller.getInlineCompletionPreview()!.suffix, 'a_one');
	const source = f.model.buffer.getText(), version = f.model.version;
	f.controller.handleKeybindings(new KeyInputEvent('Tab', KeyModifier.shift));
	assert.equal(f.controller.getInlineCompletionPreview()!.suffix, 'a_two');
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
});

test('input retirement clears the published completion before another source attaches', t => {
	const f = fixture(t, 'retu'); f.type('r'); f.settle();
	assert.notEqual(f.controller.getInlineCompletionPreview(), null);
	f.controller.clearInput();
	assert.equal(f.controller.session, null); assert.equal(f.controller.getInlineCompletionPreview(), null);
	const other = editorTextModelService.retain({ domain: 0, path: 'other.lua', source: { type: 'lua', resid: 'other' } }, 'lua', 'local other = 1');
	activeCodeEditor.attach(other, createCodeEditorViewState()); f.settle();
	assert.equal(f.controller.session, null); assert.equal(f.controller.getInlineCompletionPreview(), null);
	const tab = new KeyInputEvent('Tab', KeyModifier.none);
	assert.equal(f.controller.handleKeybindings(tab), false); assert.equal(tab.consumed, false);
	assert.equal(other.buffer.getText(), 'local other = 1');
});

test('retiring an admitted but unpublished typing request prevents it from appearing on the next update', t => {
	const f = fixture(t, 'retu'); f.type('r');
	assert.equal(f.controller.session, null);
	f.controller.clearInput(); f.settle();
	assert.equal(f.controller.session, null); assert.equal(f.controller.getInlineCompletionPreview(), null);
	assert.equal(f.model.buffer.getText(), 'retur');
});

test('input retirement owns signature-hint lifetime, while closing suggestions alone preserves it', t => {
	const f = fixture(t, 'local function paint(value)\nend\npaint'); f.type('(');
	assert.notEqual(f.controller.hint, null);
	const hint = f.controller.hint;
	f.controller.closeSession(); assert.equal(f.controller.hint, hint);
	f.controller.clearInput(); assert.equal(f.controller.hint, null); assert.equal(f.controller.popupBounds, null);
	assert.equal(f.controller.session, null); assert.equal(f.controller.getInlineCompletionPreview(), null);
});
