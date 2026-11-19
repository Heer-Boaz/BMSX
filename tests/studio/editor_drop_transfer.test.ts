import assert from 'node:assert/strict';
import test from 'node:test';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { serializeEditorPart } from '../../ide/workbench/services/editor/editor_part_serialization';
import { createActualSourcePanes } from '../helpers/source_panes';

test('same-group raw gaps reorder and pin without replacing the retained pane or its attachment', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, group = f.firstGroup, input = f.firstInput;
	const other = new CodeEditorInput(f.secondInput.workingCopy), home = new HomeInput(null);
	group.openEditor(other); group.openEditor(home); group.activate(input.id);
	const pane = group.panes.activePane, generation = group.panes.openGeneration;
	assert.equal(parts.moveEditor(group, input, { kind: 'group', group, index: 3 }), true);
	assert.ok([other, home, input].every((item, index) => group.model.tabs[index] === item));
	assert.ok(group.panes.activePane === pane); assert.equal(group.panes.openGeneration, generation);
	assert.equal(parts.moveEditor(group, input, { kind: 'group', group, index: 0 }), true);
	assert.ok([input, other, home].every((item, index) => group.model.tabs[index] === item));
	const revision = group.model.revision;
	for (const index of [0, 1]) assert.equal(parts.moveEditor(group, input, { kind: 'group', group, index }), true);
	assert.equal(group.model.revision, revision); assert.equal(group.panes.openGeneration, generation);
});

test('receiver insertion is final before either group publishes its membership', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup, target = f.secondGroup, input = f.firstInput;
	const home = new HomeInput(null); target.openEditor(home);
	let observed = 0, coherent = true;
	const observe = () => {
		observed++;
		coherent = coherent && !source.model.contains(input) && target.model.tabs[0] === f.secondInput && target.model.tabs[1] === input && target.model.tabs[2] === home;
	};
	t.after(source.model.onDidChange(observe)); t.after(target.model.onDidChange(observe));
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: target, index: 1 }), true);
	assert.equal(observed, 2); assert.equal(coherent, true); assert.ok(target.panes.activePane?.input === input);
});

test('an explicit coalesced gap reorders the retained receiver identity before publication', t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts, target = f.secondGroup, retained = f.secondInput;
	const home = new HomeInput(null); target.openEditor(home);
	let retired = 0; f.firstInput.onWillDispose(() => { retired++; });
	assert.equal(parts.moveEditor(f.firstGroup, f.firstInput, { kind: 'group', group: target, index: 2 }), true);
	assert.ok(target.model.tabs[0] === home && target.model.tabs[1] === retained);
	assert.ok(target.model.activeTab === retained && target.panes.activePane?.input === retained); assert.equal(retired, 1);
});

for (const kind of ['split', 'window'] as const) test(`${kind} adoption publishes incoming membership, never an empty drop destination`, t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup, input = f.firstInput;
	const groups = f.secondPart.groups.length, documents = parts.documents.length;
	let observed = false, coherent = true;
	const observe = () => {
		if (kind === 'split' ? f.secondPart.groups.length === groups : parts.documents.length === documents) return;
		observed = true;
		const target = parts.findGroup(input);
		coherent = coherent && target !== undefined && target !== source && target.model.activeTab === input && !source.model.contains(input);
	};
	t.after(parts.onDidChange(observe));
	t.after(source.model.onDidChange(observe));
	const destination = kind === 'split' ? { kind, group: f.secondGroup, direction: 'right' as const }
		: { kind, requestedBounds: { left: 12, top: 23, right: 230, bottom: 210 } };
	assert.equal(parts.moveEditor(source, input, destination), true);
	assert.equal(observed, true); assert.equal(coherent, true);
	const target = parts.findGroup(input)!; assert.ok(target.panes.activePane?.input === input);
	if (kind === 'split') { assert.equal(f.secondPart.groups.length, groups + 1); assert.equal(parts.documents.length, documents); }
	else {
		assert.equal(parts.documents.length, documents + 1);
		// Requested placement is persisted intent, not a screenshot-position contract.
		assert.deepEqual(parts.partForGroup(target).window!.model.requestedBounds, destination.requestedBounds);
	}
});

test('destination draft veto precedes split construction and preserves both live views', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const field = new ValueInput(f.second.commandTarget, INTEGER_INPUT_FORMAT, () => {}); t.after(() => field.dispose());
	field.setValue(1); field.layout(f.secondGroup.panes.contentBounds); field.field.focusTarget.focus(); setFieldText(field.field, '-', true);
	assert.equal(parts.moveEditor(f.firstGroup, f.firstInput, { kind: 'split', group: f.secondGroup, direction: 'right' }), false);
	assert.equal(f.secondPart.groups.length, 1); assert.equal(parts.documents.length, 2); assert.equal(field.pending, true);
	assert.ok(f.firstGroup.panes.activePane?.input === f.firstInput && f.secondGroup.panes.activePane?.input === f.secondInput);
});

test('restore requested by a moving source rejects before constructing candidates or retiring its retained host', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	const saved = serializeEditorPart(f.firstPart, f.editor.editorInputSerializers);
	const deserialize = t.mock.method(f.editor.editorInputSerializers.code_editor, 'deserialize');
	let restoration: Promise<boolean> | undefined;
	const unbind = source.model.onDidChange(() => {
		if (!source.model.contains(f.firstInput) && restoration === undefined) restoration = f.firstPart.restore(saved, f.editor.editorInputSerializers);
	}); t.after(unbind);
	assert.equal(parts.moveEditor(source, f.firstInput, { kind: 'group', group: f.secondGroup }), true);
	assert.equal(await restoration, false); assert.equal(deserialize.mock.callCount(), 0);
	assert.equal(f.firstPart.retired, false); assert.equal(source.openingAdmitted, true); assert.equal(f.firstPart.operation, 'none');
	assert.ok(f.firstPart.activeGroup === source); assert.ok(f.secondGroup.model.activeTab === f.firstInput && f.secondGroup.panes.activePane?.input === f.firstInput);
});

test('a detached floating attachment cannot construct restored groups under its retired surface tree', async t => {
	const f = createActualSourcePanes(t), part = f.firstPart;
	const saved = serializeEditorPart(part, f.editor.editorInputSerializers), group = part.activeGroup;
	const deserialize = t.mock.method(f.editor.editorInputSerializers.code_editor, 'deserialize');
	part.window!.detach();
	assert.equal(part.retired, false); assert.equal(part.surface.retired, true);
	assert.equal(await part.restore(saved, f.editor.editorInputSerializers), false);
	assert.equal(deserialize.mock.callCount(), 0); assert.ok(part.activeGroup === group);
	assert.ok(group.model.activeTab === f.firstInput); assert.equal(group.paneSurface.retired, true);
});
