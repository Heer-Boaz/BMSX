import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { createActualSourcePanes } from '../helpers/source_panes';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';

function sourceInput(path: string): CodeEditorInput {
	return new CodeEditorInput(new EditorTextModel({ contextId: TEST_SYSTEM_CONTEXT_ID, contextLabel: 'Fixture', path,
		sourceFilePath: path, location: { kind: 'workspace', path }, source: { type: 'lua', resid: path } }, 'lua', 'return 1'));
}

test('model handoff publishes both final memberships, selections, metadata and revisions without disposing the retained input', t => {
	const source = new EditorTabGroupModel(), destination = new EditorTabGroupModel();
	const before = sourceInput('before.lua'), moving = sourceInput('moving.lua'), after = sourceInput('after.lua');
	const target = sourceInput('target.lua');
	t.after(() => { source.clear(); destination.clear(); for (const input of [before, moving, after, target]) input.workingCopy.dispose(); });
	source.add(before); source.add(moving, { pinned: false }); source.add(after); source.activate(moving);
	destination.add(target, { pinned: false }); destination.activate(target);
	const sourceRevision = source.revision, targetRevision = destination.revision;
	let sourceChanges = 0, targetChanges = 0, retired = 0;
	moving.onWillDispose(() => retired++);
	const verify = () => {
		assert.deepEqual(source.tabs, [before, after]); assert.deepEqual(destination.tabs, [target, moving]);
		assert.strictEqual(source.activeTab, before); assert.strictEqual(destination.activeTab, moving);
		assert.equal(source.previewTab, null); assert.strictEqual(destination.previewTab, target);
		assert.equal(source.revision, sourceRevision + 1); assert.equal(destination.revision, targetRevision + 1);
		assert.equal(source.getLabel(before), before.title); assert.equal(destination.getLabel(moving), moving.title);
		assert.equal(retired, 0);
	};
	const unbindSource = source.onDidChange(() => { sourceChanges++; verify(); });
	const unbindTarget = destination.onDidChange(() => { targetChanges++; verify(); });
	const transfer = source.transferTo(destination, moving);
	assert.ok(transfer.input === moving); assert.equal(sourceChanges, 0); assert.equal(targetChanges, 0); transfer.publish();
	assert.equal(sourceChanges, 1); assert.equal(targetChanges, 1);
	unbindSource(); unbindTarget();
	const sourceAfter = source.revision, targetAfter = destination.revision;
	moving.title = 'Updated source metadata';
	assert.equal(source.revision, sourceAfter); assert.equal(destination.revision, targetAfter + 1);
	moving.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	assert.equal(source.revision, sourceAfter); assert.equal(destination.revision, targetAfter + 2);
	assert.equal(moving.workingCopy.canUndo, true); assert.equal(retired, 0);
});

test('moving an inactive model member retains its source selection and pins only the admitted destination member', t => {
	const source = new EditorTabGroupModel(), destination = new EditorTabGroupModel();
	const active = sourceInput('active.lua'), moving = sourceInput('moving.lua');
	t.after(() => { source.clear(); destination.clear(); active.workingCopy.dispose(); moving.workingCopy.dispose(); });
	source.add(active, { pinned: false }); source.add(moving); source.activate(active);
	source.transferTo(destination, moving).publish();
	assert.strictEqual(source.activeTab, active); assert.strictEqual(source.previewTab, active);
	assert.strictEqual(destination.activeTab, moving); assert.equal(destination.previewTab, null);
	assert.deepEqual(source.tabs, [active]); assert.deepEqual(destination.tabs, [moving]);
});

test('model coalescence retains the exact destination view and leaves source retirement to the handoff owner', t => {
	const source = new EditorTabGroupModel(), destination = new EditorTabGroupModel();
	const moving = sourceInput('shared.lua'), retained = moving.createView();
	t.after(() => { source.clear(); destination.clear(); moving.dispose(); moving.workingCopy.dispose(); });
	source.add(moving); source.activate(moving);
	destination.add(retained, { pinned: false }); destination.activate(retained);
	let retired = 0; moving.onWillDispose(() => retired++);
	const transfer = source.transferTo(destination, moving, retained);
	assert.ok(transfer.input === retained); transfer.publish();
	assert.deepEqual(source.tabs, []); assert.equal(source.activeTab, null);
	assert.deepEqual(destination.tabs, [retained]); assert.strictEqual(destination.activeTab, retained);
	assert.equal(destination.previewTab, null); assert.equal(retired, 0);
	assert.strictEqual(retained.workingCopy, moving.workingCopy);
});

test('group move detaches the old Source control before either membership publishes or the destination attaches', t => {
	const f = createActualSourcePanes(t), source = f.firstGroup, destination = f.secondGroup, input = f.firstInput;
	input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained draft\n' }]);
	const view = captureCodeEditorView(input), text = input.workingCopy.buffer.getText(), version = input.workingCopy.version;
	const sourceGeneration = source.panes.beginOpen(), targetGeneration = destination.panes.beginOpen();
	let published = 0, retired = 0, attached = 0;
	const unbindDispose = input.onWillDispose(() => retired++);
	t.after(unbindDispose);
	const assertDetached = () => {
		published++;
		assert.equal(f.first.code.model, null); assert.equal(f.second.code.model, null);
	};
	const unbindSource = source.model.onDidChange(assertDetached), unbindTarget = destination.model.onDidChange(assertDetached);
	source.detachEditorForMove(input); destination.panes.clearEditor();
	assert.ok(source.panes.openGeneration > sourceGeneration && destination.panes.openGeneration > targetGeneration);
	const transfer = source.model.transferTo(destination.model, input);
	assert.ok(transfer.input === input); transfer.publish();
	unbindSource(); unbindTarget();
	const attach = f.second.code.attach.bind(f.second.code);
	t.mock.method(f.second.code, 'attach', (model, state, document) => {
		assert.equal(f.first.code.model, null); attached++;
		attach(model, state, document);
	});
	destination.attachTransferredEditor(input, undefined, true);
	assert.equal(published, 2); assert.equal(attached, 1); assert.equal(retired, 0);
	assert.equal(source.panes.activePane, null); assert.strictEqual(destination.panes.activePane, f.second);
	assert.strictEqual(destination.model.activeTab, input); assert.strictEqual(f.second.code.model, input.workingCopy);
	assert.deepEqual(captureCodeEditorView(input), view);
	assert.equal(input.workingCopy.buffer.getText(), text); assert.equal(input.workingCopy.version, version);
	assert.equal(input.workingCopy.canUndo, true);
});

test('a group publishes the exact replacement owner before coalesced source input disposal', t => {
	const f = createActualSourcePanes(t, true), source = f.firstGroup, destination = f.secondGroup;
	const input = f.firstInput, retained = f.secondInput, selection = f.first.getSelection();
	let moved = false;
	const unbind = source.onDidMoveEditor(event => {
		assert.strictEqual(event.input, input); assert.strictEqual(event.destination, destination); assert.strictEqual(event.replacement, retained);
		assert.equal(source.model.tabs.length, 0); assert.strictEqual(destination.model.activeTab, retained);
		moved = true;
	});
	t.after(unbind);
	input.onWillDispose(() => assert.equal(moved, true));
	source.detachEditorForMove(input); destination.panes.clearEditor();
	source.model.transferTo(destination.model, input, retained).publish();
	source.publishMovedEditor(input, destination, retained);
	destination.attachTransferredEditor(retained, selection, true);
	input.dispose(); selection.dispose();
	assert.equal(moved, true); assert.strictEqual(destination.panes.activePane!.input, retained);
});

test('group move admission commits only its own actual focused field and rejects an invalid draft', t => {
	const f = createActualSourcePanes(t);
	let accepted = 7;
	const field = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, value => { accepted = value; });
	t.after(() => field.dispose());
	field.setValue(accepted); field.layout(f.firstGroup.panes.contentBounds); field.field.focusTarget.focus(); setFieldText(field.field, '-', true);
	assert.equal(field.pending, true); assert.equal(f.firstGroup.commitPendingEdit(), false);
	assert.equal(field.pending, true); assert.equal(accepted, 7); assert.strictEqual(inputFocus.target, field.field.focusTarget);
	assert.equal(f.secondGroup.commitPendingEdit(), true);
	assert.strictEqual(f.firstGroup.model.activeTab, f.firstInput); assert.strictEqual(f.firstGroup.panes.activePane, f.first);
});
