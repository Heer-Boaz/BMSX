import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { navigationState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import { createActualSourcePanes } from '../helpers/source_panes';

for (const phase of ['source detach', 'destination detach', 'history handoff', 'model publication', 'destination attachment'] as const)
	test(`whole-group ${phase} preserves a newer concrete sibling control and its routing owner`, t => {
		const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup, target = f.secondGroup;
		const sibling = parts.splitGroup(target, 'right')!, siblingInput = new CodeEditorInput(f.firstInput.workingCopy);
		sibling.openEditor(siblingInput); f.update(); source.focus();
		const pane = sibling.panes.activePane!;
		let interacted = false, unbind = () => {};
		const interact = () => { unbind(); interacted = true; pane.focus(); };
		unbind = phase === 'source detach' ? source.panes.onDidClearEditor(interact)
			: phase === 'destination detach' ? target.panes.onDidClearEditor(interact)
			: phase === 'history handoff' ? source.onDidMoveEditor(interact)
			: phase === 'model publication' ? target.model.onDidChange(interact) : target.panes.onWillShowEditor(interact);
		t.after(unbind);
		assert.equal(parts.moveGroup(source, { kind: 'group', group: target }), true);
		assert.equal(interacted, true); assert.ok(target.model.activeTab === f.firstInput && target.panes.activePane?.input === f.firstInput);
		assert.ok(inputFocus.target === pane.commandTarget && parts.activePart === f.secondPart && parts.activeGroup === sibling);
		assert.ok(navigationState.activeGroup === sibling && sibling.panes.activePane === pane && sibling.model.activeTab === siblingInput);
	});

for (const phase of ['source detach', 'destination detach', 'history handoff', 'model publication', 'source retirement'] as const)
	test(`workspace clear during whole-group ${phase} owns the final membership and cannot acquire a stale pane`, t => {
		const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup, target = f.secondGroup;
		let cleared = false, unbind = () => {};
		const clear = () => { unbind(); cleared = true; parts.clear(); };
		unbind = phase === 'source detach' ? source.panes.onDidClearEditor(clear)
			: phase === 'destination detach' ? target.panes.onDidClearEditor(clear)
			: phase === 'history handoff' ? source.onDidMoveEditor(clear)
			: phase === 'model publication' ? target.model.onDidChange(clear) : source.onWillDispose(clear);
		t.after(unbind);
		assert.equal(parts.moveGroup(source, { kind: 'group', group: target }), false);
		assert.equal(cleared, true); assert.equal(parts.documents.length, 0); assert.equal(parts.groups.length, 1);
		assert.ok(parts.activePart === parts.main && parts.activeGroup === parts.main.activeGroup);
		assert.equal(parts.activeGroup.model.tabs.length, 0); assert.equal(parts.activeGroup.panes.activePane, null);
		assert.equal(source.surface.retired, true); assert.equal(target.surface.retired, true);
		assert.equal(source.panes.activePane, null); assert.equal(target.panes.activePane, null);
		assert.equal(parts.closeController.isPending(f.firstInput), false);
	});

test('whole-group handoff rejects a detached destination while the live source still projects every retained member', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup, target = f.secondGroup;
	const unbind = source.panes.onDidClearEditor(() => { unbind(); f.secondPart.window!.detach(); }); t.after(unbind);
	const attach = t.mock.method(target.panes, 'openEditor');
	assert.equal(parts.moveGroup(source, { kind: 'group', group: target }), false);
	assert.equal(target.surface.retired, true); assert.equal(attach.mock.callCount(), 0);
	assert.ok(source.model.tabs.length === 1 && source.model.activeTab === f.firstInput && source.panes.activePane?.input === f.firstInput);
	assert.ok(target.model.activeTab === f.secondInput); assert.equal(f.firstPart.retired, false);
});

test('an inactive nonportable editor vetoes the entire group before any target construction or source detachment', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	const diagnostic = new HostErrorInput('fixture diagnostic'); source.openEditor(diagnostic); source.activate(f.firstInput.id);
	const sourceGeneration = source.panes.openGeneration, documents = parts.documents.length, groups = parts.groups.length;
	assert.equal(parts.canMoveGroup(source, { kind: 'window' }), false);
	assert.equal(parts.moveGroup(source, { kind: 'window' }), false);
	assert.equal(parts.documents.length, documents); assert.equal(parts.groups.length, groups);
	assert.equal(source.panes.openGeneration, sourceGeneration);
	assert.ok(source.model.tabs[0] === f.firstInput && source.model.tabs[1] === diagnostic && source.panes.activePane?.input === f.firstInput);
});

test('merging an empty Main group replaces its route without blanking an occupied receiver selection', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = parts.main.activeGroup, target = f.secondGroup;
	assert.equal(source.model.tabs.length, 0);
	assert.equal(parts.moveGroup(source, { kind: 'group', group: target }), true);
	assert.ok(target.model.activeTab === f.secondInput && target.panes.activePane?.input === f.secondInput);
	assert.equal(source.surface.retired, true); assert.ok(parts.main.activeGroup !== source);
	assert.equal(parts.main.activeGroup.model.tabs.length, 0);
});

test('a newer Main clear during local relocation retires the removed group without revealing its missing leaf', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main, source = main.activeGroup;
	source.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const reference = parts.splitGroup(source, 'right')!;
	reference.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
	let cleared = false;
	const unbind = main.onDidChangeGroups(() => { unbind(); cleared = true; parts.clear(); }); t.after(unbind);
	assert.equal(parts.moveGroup(source, { kind: 'split', group: reference, direction: 'down' }), false);
	assert.equal(cleared, true); assert.equal(main.retired, false); assert.equal(source.surface.retired, true);
	assert.equal(parts.groups.length, 1); assert.ok(parts.activeGroup === reference);
	assert.equal(reference.model.tabs.length, 0); assert.equal(reference.panes.activePane, null);
});

test('new-window group publication exposes final topology and every retained input before a newer workspace clear', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	const additional = new CodeEditorInput(f.secondInput.workingCopy); source.openEditor(additional, { pinned: false });
	const windows = [...parts.documents];
	let coherent = false, redirected = false, receiver: EditorGroupView | undefined;
	const unbind = parts.onDidChange(() => {
		if (redirected) return;
		const window = parts.documents.find(part => !windows.includes(part));
		if (window === undefined) return;
		redirected = true; receiver = window.activeGroup;
		coherent = receiver.model.tabs.length === 2 && receiver.model.tabs[0] === f.firstInput && receiver.model.tabs[1] === additional
			&& receiver.model.activeTab === additional && receiver.model.previewTab === additional
			&& parts.findGroup(f.firstInput) === receiver && parts.findGroup(additional) === receiver && !parts.groups.includes(source)
			&& !parts.documents.includes(f.firstPart) && parts.groupForModel(source.model) === undefined;
		parts.clear();
	}); t.after(unbind);
	assert.equal(parts.moveGroup(source, { kind: 'window' }), false);
	assert.equal(redirected, true); assert.equal(coherent, true); assert.ok(receiver !== undefined);
	assert.equal(receiver.surface.retired, true); assert.equal(receiver.panes.activePane, null);
	assert.equal(parts.documents.length, 0); assert.equal(parts.groups.length, 1);
	assert.equal(parts.activeGroup.model.tabs.length, 0); assert.equal(parts.activeGroup.panes.activePane, null);
});

test('a cross-part split reveals its new leaf independently of a newer unrelated focus intent', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup, main = parts.main.activeGroup;
	main.openEditor(new CodeEditorInput(f.secondInput.workingCopy)); f.update();
	f.secondPart.arrangement.toggleMaximize(f.secondGroup); f.update(); source.focus();
	const pane = main.panes.activePane!;
	const unbind = source.panes.onDidClearEditor(() => { unbind(); pane.focus(); }); t.after(unbind);
	assert.equal(parts.moveGroup(source, { kind: 'split', group: f.secondGroup, direction: 'right' }), true);
	const receiver = parts.findGroup(f.firstInput);
	assert.ok(receiver !== undefined && receiver !== f.secondGroup && parts.partForGroup(receiver) === f.secondPart);
	assert.ok(f.secondPart.arrangement.maximized === undefined);
	assert.equal(f.secondPart.arrangement.leaves.find(leaf => leaf.group === receiver)!.visible, true);
	assert.ok(inputFocus.target === pane.commandTarget && parts.activeGroup === main);
});
