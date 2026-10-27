import assert from 'node:assert/strict';
import test from 'node:test';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { createActualSourcePanes } from '../helpers/source_panes';

test('invalid actual source field vetoes transfer before creating an empty destination', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, input = f.firstInput;
	const field = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => {}); t.after(() => field.dispose());
	field.setValue(7); field.layout(f.firstGroup.panes.contentBounds); field.field.focusTarget.focus(); setFieldText(field.field, '-', true);
	const count = parts.documents.length;
	assert.equal(parts.moveEditor(f.firstPart, input, 'new', f.editor.editorClose), false);
	assert.equal(parts.documents.length, count); assert.equal(field.pending, true);
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === f.first);
	assert.equal(f.firstPart.operation, 'none');
});

test('pending tab-close admission blocks move even though its containing window is not closing', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, input = f.firstInput;
	f.first.focus(); input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	const closing = f.firstGroup.close(input.id), count = parts.documents.length;
	assert.equal(f.firstPart.closing, false); assert.equal(f.firstPart.actionPrompt.visible, true);
	assert.equal(parts.moveEditor(f.firstPart, input, 'new', f.editor.editorClose), false);
	assert.equal(parts.documents.length, count); assert.ok(f.firstGroup.model.activeTab === input);
	f.firstPart.actionPrompt.close('cancel'); assert.equal(await closing, false); assert.equal(input.workingCopy.dirty, true);
});

test('reentrant close of an empty admitted destination cannot retire the incoming retained input', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, destination = parts.createDocument();
	let close: Promise<boolean> | undefined;
	const unbind = f.firstGroup.panes.onDidClearEditor(() => { unbind(); close = parts.close(destination); }); t.after(unbind);
	assert.equal(parts.moveEditor(f.firstPart, f.firstInput, destination, f.editor.editorClose), true);
	assert.equal(await close, false); assert.equal(destination.retired, false);
	assert.ok(destination.group.model.activeTab === f.firstInput && destination.group.panes.activePane!.input === f.firstInput);
	assert.equal(destination.operation, 'none'); assert.equal(f.firstPart.operation, 'none');
});

test('new destination is born with move admission before membership observers can request close', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, count = parts.documents.length;
	let close: Promise<boolean> | undefined;
	const unbind = parts.onDidChange(() => {
		if (parts.documents.length === count) return;
		unbind(); const destination = parts.documents.at(-1)!;
		assert.equal(destination.operation, 'move'); close = parts.close(destination);
	}); t.after(unbind);
	assert.equal(parts.moveEditor(f.firstPart, f.firstInput, 'new', f.editor.editorClose), true);
	assert.equal(await close, false); assert.equal(parts.documents.length, count + 1);
	const destination = parts.documents.at(-1)!;
	assert.equal(destination.retired, false); assert.ok(destination.group.model.activeTab === f.firstInput);
	assert.equal(destination.operation, 'none'); assert.equal(f.firstPart.operation, 'none');
});

test('a later destination focus callback may close the transferred input after admission releases', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	let close: Promise<boolean> | undefined;
	const unbind = f.second.commandTarget.onDidFocus(() => { unbind(); close = parts.close(f.secondPart); }); t.after(unbind);
	f.first.focus();
	assert.equal(parts.moveEditor(f.firstPart, f.firstInput, f.secondPart, f.editor.editorClose), true);
	assert.equal(await close, true); assert.equal(f.secondPart.retired, true);
	assert.equal(f.firstGroup.model.tabs.length, 0); assert.equal(f.firstPart.operation, 'none');
});
