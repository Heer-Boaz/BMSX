import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';

function sourceInput(path: string): CodeEditorInput {
	return new CodeEditorInput(new EditorTextModel({ contextId: TEST_SYSTEM_CONTEXT_ID, contextLabel: 'Fixture', path,
		sourceFilePath: path, location: { kind: 'workspace', path }, source: { type: 'lua', resid: path } }, 'lua', 'return 1'));
}

test('whole-group transfer publishes complete ordered selection and preview state once for both models', t => {
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel();
	const before = sourceInput('before.lua'), preview = sourceInput('preview.lua'), active = sourceInput('active.lua');
	const inputs = [before, preview, active];
	t.after(() => { source.clear(); target.clear(); for (const input of inputs) input.workingCopy.dispose(); });
	source.add(before); source.add(preview, { pinned: false }); source.add(active); source.activate(active);
	const plan = source.planTransferTo(target), sourceRevision = source.revision, targetRevision = target.revision;
	assert.ok(plan.entries.every((entry, index) => entry.input === inputs[index] && entry.receiver === inputs[index]));
	let sourceChanges = 0, targetChanges = 0, coherent = true, retired = 0;
	for (const input of inputs) input.onWillDispose(() => { retired++; });
	const verify = () => {
		coherent = coherent && source.tabs.length === 0 && source.activeTab === null && source.previewTab === null
			&& target.tabs.length === inputs.length && inputs.every((input, index) => target.tabs[index] === input)
			&& target.activeTab === active && target.previewTab === preview;
	};
	const unbindSource = source.onDidChange(() => { sourceChanges++; verify(); });
	const unbindTarget = target.onDidChange(() => { targetChanges++; verify(); });
	const transfer = source.transferGroupTo(target, plan);
	assert.equal(sourceChanges, 0); assert.equal(targetChanges, 0); verify();
	assert.ok(transfer.active === active && transfer.preview === preview && transfer.entries === plan.entries);
	assert.equal(source.revision, sourceRevision + 1); assert.equal(target.revision, targetRevision + 1);
	transfer.publish(); unbindSource(); unbindTarget();
	assert.equal(sourceChanges, 1); assert.equal(targetChanges, 1); assert.equal(coherent, true); assert.equal(retired, 0);
});

test('whole-group merge keeps matching receiver affinity and inserts only new inputs in source order at the raw gap', t => {
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel();
	const first = sourceInput('first.lua'), shared = sourceInput('shared.lua'), last = sourceInput('last.lua');
	const left = sourceInput('left.lua'), retained = shared.createView(), right = sourceInput('right.lua');
	t.after(() => {
		source.clear(); target.clear(); shared.dispose();
		for (const input of [first, shared, last, left, right]) input.workingCopy.dispose();
	});
	source.add(first); source.add(shared); source.add(last, { pinned: false }); source.activate(shared);
	target.add(left); target.add(retained); target.add(right, { pinned: false }); target.activate(left);
	const plan = source.planTransferTo(target);
	assert.ok(plan.entries[0].receiver === first && plan.entries[1].receiver === retained && plan.entries[2].receiver === last);
	let retired = 0; shared.onWillDispose(() => { retired++; });
	const transfer = source.transferGroupTo(target, plan, 1);
	assert.ok([left, first, last, retained, right].every((input, index) => target.tabs[index] === input));
	assert.ok(transfer.active === retained && target.activeTab === retained);
	assert.ok(transfer.preview === right && target.previewTab === right, 'the destination preview owns a merge conflict');
	assert.equal(source.tabs.length, 0); assert.equal(retired, 0);
	transfer.publish(); assert.equal(retired, 0);
	assert.ok(retained.workingCopy === shared.workingCopy);
});

test('an available destination preview slot retains a newly transferred preview even when it is not active', t => {
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel();
	const preview = sourceInput('preview.lua'), active = sourceInput('active.lua'), existing = sourceInput('existing.lua');
	t.after(() => { source.clear(); target.clear(); for (const input of [preview, active, existing]) input.workingCopy.dispose(); });
	source.add(preview, { pinned: false }); source.add(active); source.activate(active);
	target.add(existing); target.activate(existing);
	const transfer = source.transferGroupTo(target, source.planTransferTo(target)); transfer.publish();
	assert.ok(target.previewTab === preview && target.activeTab === active);
	assert.ok([existing, preview, active].every((input, index) => target.tabs[index] === input));
});

for (const retainedPreview of [false, true]) test(`coalescence preserves the destination's ${retainedPreview ? 'preview' : 'pinned'} state instead of importing the source's conflicting state`, t => {
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel(), moving = sourceInput('shared.lua'), retained = moving.createView();
	t.after(() => { source.clear(); target.clear(); moving.dispose(); moving.workingCopy.dispose(); });
	source.add(moving, { pinned: retainedPreview }); source.activate(moving);
	target.add(retained, { pinned: !retainedPreview }); target.activate(retained);
	const transfer = source.transferGroupTo(target, source.planTransferTo(target)); transfer.publish();
	assert.ok(target.tabs.length === 1 && target.tabs[0] === retained && target.activeTab === retained);
	assert.ok(target.previewTab === (retainedPreview ? retained : null));
});

test('the batch consumes active and preview state after admission without vetoing label, dirty or pin publications', t => {
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel();
	const first = sourceInput('first.lua'), second = sourceInput('second.lua');
	t.after(() => { source.clear(); target.clear(); first.workingCopy.dispose(); second.workingCopy.dispose(); });
	source.add(first); source.add(second, { pinned: false }); source.activate(first);
	const plan = source.planTransferTo(target);
	source.activate(second); source.pin(second); first.title = 'changed metadata';
	second.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed during admission\n' }]);
	const transfer = source.transferGroupTo(target, plan); transfer.publish();
	assert.ok(transfer.active === second && target.activeTab === second); assert.equal(target.previewTab, null);
	assert.ok(target.tabs[0] === first && target.tabs[1] === second); assert.equal(second.workingCopy.dirty, true);
});

test('a representable null source selection remains null instead of choosing a destination or first input', t => {
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel(), incoming = sourceInput('incoming.lua'), existing = sourceInput('existing.lua');
	t.after(() => { source.clear(); target.clear(); incoming.workingCopy.dispose(); existing.workingCopy.dispose(); });
	source.add(incoming, { pinned: false }); target.add(existing); target.activate(existing);
	const transfer = source.transferGroupTo(target, source.planTransferTo(target)); transfer.publish();
	assert.equal(transfer.active, null); assert.equal(target.activeTab, null); assert.ok(target.previewTab === incoming);
	assert.ok(target.tabs[0] === existing && target.tabs[1] === incoming);
});

test('an empty source group contributes no selection and leaves an occupied receiver active and preview unchanged', t => {
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel(), existing = sourceInput('existing.lua');
	t.after(() => { source.clear(); target.clear(); existing.workingCopy.dispose(); });
	target.add(existing, { pinned: false }); target.activate(existing);
	const transfer = source.transferGroupTo(target, source.planTransferTo(target)); transfer.publish();
	assert.ok(transfer.active === existing && transfer.preview === existing);
	assert.ok(target.activeTab === existing && target.previewTab === existing && target.tabs.length === 1);
	assert.equal(source.activeTab, null); assert.equal(source.tabs.length, 0);
});

test('transferred input metadata and dirty subscriptions belong only to the final receiving model', t => {
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel(), input = sourceInput('source.lua');
	t.after(() => { source.clear(); target.clear(); input.workingCopy.dispose(); });
	source.add(input, { pinned: false }); source.activate(input);
	let sourceChanges = 0, targetChanges = 0;
	const unbindSource = source.onDidChange(() => { sourceChanges++; }), unbindTarget = target.onDidChange(() => { targetChanges++; });
	source.transferGroupTo(target, source.planTransferTo(target)).publish();
	input.title = 'new metadata'; input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	assert.equal(sourceChanges, 1); assert.equal(targetChanges, 3); assert.equal(target.previewTab, null);
	unbindSource(); unbindTarget();
});
