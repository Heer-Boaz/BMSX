import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { editorFeedbackState } from '../../ide/common/feedback_state';
import { applyDocumentFormatting } from '../../ide/editor/editing/document_formatting';
import { getSelectionText } from '../../ide/editor/editing/text_editing_and_selection';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { captureCodeEditorSelectionSnapshot } from '../../ide/editor/ui/code_editor_state';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { createActualSourcePanes } from '../helpers/source_panes';

const PREFIX = 'do\n  local name = "🦊"   \n  use(name)  \nend\n';
const FORMATTED_PREFIX = 'do\n\tlocal name = "🦊"\n\tuse(name)\nend\n';
const MODIFIERS = KeyModifier.shift | KeyModifier.alt;

function fixture(t: TestContext, sameModel = false) {
	const f = createActualSourcePanes(t, sameModel), model = f.firstInput.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: PREFIX }]);
	f.update(); f.first.focus();
	return { ...f, model, original: PREFIX + f.source, formatted: FORMATTED_PREFIX + f.source };
}

for (const font of ['tiny', 'msx'] as const) for (const backward of [false, true])
	test(`${font} Format Document retains ${backward ? 'backward' : 'forward'} selection and token markers in both shared views as one Undo`, t => {
		const f = fixture(t, true), code = f.first.code, sibling = f.second.code;
		f.editor.preferences.fontVariant = font; f.update();
		const start = f.original.indexOf('name'), end = start + 4;
		code.nativeText.setSelection(backward ? end : start, backward ? start : end);
		sibling.nativeText.setSelection(f.original.indexOf('use(') + 4, f.original.indexOf('use(') + 8);
		const before = captureCodeEditorSelectionSnapshot(code.view), selection = getSelectionText(sibling);
		const marker = { start, end };
		t.after(f.model.trackRanges(new Map([['identifier', marker]])));
		const cycles = f.host.runtime.machine.scheduler.nowCycles, version = f.model.version;
		let changes = 0; t.after(f.model.onDidChangeContent(() => { changes++; }));
		const press = new KeyInputEvent('KeyF', MODIFIERS);
		assert.equal(f.editor.dispatchKey(press), true); assert.equal(press.consumed, true); f.update();
		assert.equal(f.model.buffer.getText(), f.formatted); assert.equal(f.model.version, version + 1);
		assert.equal(changes, 1); assert.equal(getSelectionText(code), 'name');
		assert.equal(getSelectionText(sibling), selection);
		assert.equal(f.model.buffer.getTextRange(marker.start, marker.end), 'name');
		assert.equal(code.view.cursorColumn < code.view.selectionAnchor!.column, backward, 'formatting retains the selection direction');
		const after = captureCodeEditorSelectionSnapshot(code.view);
		f.editor.dispatchKey(new KeyInputEvent('KeyF', MODIFIERS, true));
		f.editor.dispatchKey(new KeyInputEvent('KeyF', MODIFIERS, false, false));
		assert.equal(f.model.version, version + 1, 'held shortcut does not repeat formatting');
		f.key('KeyF', MODIFIERS);
		assert.equal(f.model.version, version + 1); assert.deepEqual(captureCodeEditorSelectionSnapshot(code.view), after);
		f.key('KeyZ', KeyModifier.ctrl);
		assert.equal(f.model.buffer.getText(), f.original); assert.deepEqual(captureCodeEditorSelectionSnapshot(code.view), before);
		f.key('KeyY', KeyModifier.ctrl);
		assert.equal(f.model.buffer.getText(), f.formatted); assert.deepEqual(captureCodeEditorSelectionSnapshot(code.view), after);
		f.key('KeyZ', KeyModifier.ctrl); f.key('KeyZ', KeyModifier.ctrl);
		assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.dirty, false); assert.equal(f.model.canUndo, false);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});

for (const surface of ['menu', 'palette'] as const)
	test(`the actual ${surface} executes Format Document on its captured Source, never another open working copy`, t => {
		const f = fixture(t), otherVersion = f.secondInput.workingCopy.version;
		if (surface === 'menu') {
			f.key('F10'); f.key('ArrowRight');
			assert.equal(f.editor.menubar.activeMenu, 'edit');
			const popup = f.editor.contextMenu;
			const row = popup.model.rows.findIndex(row => row.command === 'formatDocument');
			assert.ok(row >= 0 && popup.model.rows[row].enabled);
			for (let count = 0; count < popup.model.rows.length && popup.model.selectedIndex !== row; count++) f.key('ArrowDown');
			assert.equal(popup.model.selectedIndex, row);
		} else {
			f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
			const picker = f.editor.quickInput;
			const row = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === 'formatDocument');
			assert.ok(row >= 0);
			for (let count = 0; count < picker.model.list.rows.length && picker.model.list.selectionIndex !== row; count++) f.key('ArrowDown');
			assert.equal(picker.model.list.selectionIndex, row);
		}
		f.key('Enter');
		assert.equal(f.model.buffer.getText(), f.formatted);
		assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
		assert.equal(f.secondInput.workingCopy.version, otherVersion);
		assert.ok(inputFocus.target === f.first.commandTarget);
		f.key('KeyZ', KeyModifier.ctrl); assert.equal(f.model.buffer.getText(), f.original);
	});

test('formatting an unchanged document retains saved identity, selection and the existing Redo branch', t => {
	const f = createActualSourcePanes(t), model = f.firstInput.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: ' ' }]); model.undo();
	f.first.focus(); f.first.code.nativeText.setSelection(6, 11);
	const before = captureCodeEditorSelectionSnapshot(f.first.code.view), version = model.version;
	f.key('KeyF', MODIFIERS);
	assert.equal(model.version, version); assert.equal(model.buffer.getText(), f.source); assert.equal(model.dirty, false);
	assert.equal(model.canUndo, false); assert.equal(model.canRedo, true);
	assert.deepEqual(captureCodeEditorSelectionSnapshot(f.first.code.view), before);
	assert.ok(model.redo() !== null); assert.equal(model.buffer.getText(), ' ' + f.source);
});

test('read-only Source exposes no formatting action and cannot mutate through the shortcut or direct edit owner', t => {
	const f = fixture(t), code = f.first.code;
	f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
	const version = f.model.version, before = captureCodeEditorSelectionSnapshot(code.view);
	assert.equal(f.editor.commands.isEnabled('formatDocument', f.first.commandTarget), false);
	f.key('KeyF', MODIFIERS); applyDocumentFormatting(code);
	assert.equal(f.model.buffer.getText(), f.original); assert.equal(f.model.version, version);
	assert.deepEqual(captureCodeEditorSelectionSnapshot(code.view), before);
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(f.editor.quickInput.model.list.rows.some(row => (row.item as CommandQuickPickItem).command === 'formatDocument'), false);
});

test('a lexer failure reports the error without applying partial edits, moving selections or clearing Redo', t => {
	const f = fixture(t), code = f.first.code;
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'local unfinished = "\n' }]);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- temporary\n' }]); f.model.undo();
	code.nativeText.setSelection(6, 16);
	const source = f.model.buffer.getText(), version = f.model.version, before = captureCodeEditorSelectionSnapshot(code.view);
	f.key('KeyF', MODIFIERS);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
	assert.equal(f.model.canRedo, true);
	assert.deepEqual(captureCodeEditorSelectionSnapshot(code.view), before);
	assert.equal(editorFeedbackState.message.visible, true);
	assert.equal(editorFeedbackState.message.kind, 'error');
	f.key('KeyZ', KeyModifier.ctrl); assert.equal(f.model.buffer.getText(), f.original);
});

for (const type of ['data', 'aem'] as const) test(`${type} YAML does not acquire a formatter that rewrites authored data`, t => {
	const f = createActualSourcePanes(t), path = 'res/source.yaml', source = '# authored\r\nvalue: "01"\r\n';
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type, resid: 'source', source_path: path }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	const model = editorTextModelService.retain(resource, type === 'data' ? 'yaml' : 'aem', source);
	f.firstGroup.openEditor(new CodeEditorInput(model)); f.update(); f.first.focus();
	assert.equal(f.editor.commands.isEnabled('formatDocument', f.first.commandTarget), false);
	f.key('KeyF', MODIFIERS);
	assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false); assert.equal(model.dirty, false);
});

test('AEM JSON uses the same command, one undo element and a no-op on the formatted document', t => {
	const f = createActualSourcePanes(t), path = 'res/source.aem.json', source = '{"events":{}}\n';
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'aem', resid: 'source', source_path: path }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	const model = editorTextModelService.retain(resource, 'aem', source);
	f.firstGroup.openEditor(new CodeEditorInput(model)); f.update(); f.first.focus();
	assert.equal(f.editor.commands.isEnabled('formatDocument', f.first.commandTarget), true);
	f.key('KeyF', MODIFIERS); assert.equal(model.buffer.getText(), '{\n  "events": {}\n}\n');
	const version = model.version; f.key('KeyF', MODIFIERS); assert.equal(model.version, version);
	f.key('KeyZ', KeyModifier.ctrl); assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, false);
});

test('Format Document keyboard routing cannot borrow Source authority through QuickInput or Files', t => {
	const f = fixture(t);
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	const picker = f.editor.quickInput;
	assert.equal(picker.field.focusTarget.getCommand('formatDocument'), undefined);
	const press = new KeyInputEvent('KeyF', MODIFIERS); f.editor.dispatchKey(press);
	assert.equal(press.consumed, false); assert.equal(f.model.buffer.getText(), f.original);
	f.key('Escape'); f.key('KeyE', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(f.editor.resourcePanel.isFocused(), true);
	const filePress = new KeyInputEvent('KeyF', MODIFIERS); f.editor.dispatchKey(filePress);
	assert.equal(filePress.consumed, false); assert.equal(f.model.buffer.getText(), f.original);
});

test('Format Document remains ordinary input at the real Game viewport rather than globally capturing gameplay keys', t => {
	const f = fixture(t);
	f.ide.boots.didReplaceMachine(); f.editor.interaction.setActive(true);
	f.editor.editorParts.main.activeGroup.openEditor(f.editor.actorLab.resolveInput()); f.update();
	const chrome = inputFocus.target;
	for (let count = 0; count < 20 && inputFocus.target?.guestInput === undefined; count++) {
		f.key('Tab'); assert.ok(inputFocus.target !== chrome, 'the runtime view exposes a guest tab stop');
	}
	const guest = inputFocus.target!;
	assert.ok(guest.guestInput !== undefined && guest.guestInput.recipient === f.host.input);
	for (const event of [new KeyInputEvent('AltLeft', KeyModifier.alt), new KeyInputEvent('ShiftLeft', MODIFIERS),
		new KeyInputEvent('KeyF', MODIFIERS), new KeyInputEvent('KeyF', MODIFIERS, false, false),
		new KeyInputEvent('ShiftLeft', KeyModifier.alt, false, false), new KeyInputEvent('AltLeft', KeyModifier.none, false, false)]) {
		assert.equal(f.editor.dispatchKey(event), false); assert.equal(event.consumed, false);
		assert.ok(inputFocus.target === guest);
	}
	assert.equal(f.model.buffer.getText(), f.original);
});
