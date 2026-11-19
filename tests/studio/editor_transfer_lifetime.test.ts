import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import type { EditorInputOpenResult } from '../../ide/workbench/services/editor/editor_group';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import { NavigationHistoryEntry, navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { createActualSourcePanes } from '../helpers/source_panes';

for (const phase of ['source detach', 'membership publication', 'history handoff'] as const) test(`workspace clear during ${phase} revokes transfer before retired groups can acquire panes`, t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = parts.main.activeGroup;
	const input = new CodeEditorInput(f.firstInput.workingCopy); source.openEditor(input);
	const target = parts.splitGroup(source, 'right')!;
	let redirected = false, unbind = () => {};
	const redirect = () => {
		if (phase === 'membership publication' && source.model.indexOf(input) >= 0) return;
		redirected = true; unbind(); parts.clear();
	};
	unbind = phase === 'source detach' ? source.panes.onDidClearEditor(redirect)
		: phase === 'membership publication' ? source.model.onDidChange(redirect) : source.onDidMoveEditor(redirect);
	t.after(unbind);
	const attach = t.mock.method(target.panes, 'openEditor');
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: target }), false);
	assert.equal(redirected, true); assert.equal(attach.mock.callCount(), 0);
	assert.ok(parts.activePart === parts.main); assert.equal(parts.groups.length, 1); assert.equal(parts.documents.length, 0);
	assert.equal(parts.main.activeGroup.model.tabs.length, 0); assert.equal(parts.main.activeGroup.panes.activePane, null);
	assert.equal(target.panes.activePane, null); assert.equal(f.editor.editorParts.closeController.isPending(input), false);
});

test('new document publication exposes coherent membership and cannot bind after a newer workspace clear', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, count = parts.documents.length, source = f.firstGroup;
	let redirected = false, coherent = false;
	let destination: typeof source | undefined;
	const unbind = parts.onDidChange(() => {
		if (redirected || parts.documents.length <= count) return;
		redirected = true; destination = parts.documents.at(-1)!.activeGroup;
		coherent = destination.model.activeTab === f.firstInput && parts.findGroup(f.firstInput) === destination && !source.model.contains(f.firstInput);
		parts.clear();
	}); t.after(unbind);
	assert.equal(parts.moveEditor(source, f.firstInput, { kind: 'window' }), false);
	assert.equal(redirected, true); assert.equal(coherent, true); assert.ok(destination !== undefined);
	assert.equal(destination.paneSurface.retired, true); assert.equal(destination.panes.activePane, null);
	assert.equal(parts.documents.length, 0); assert.equal(parts.groups.length, 1);
	assert.ok(parts.activePart === parts.main); assert.equal(f.firstPart.retired, true);
	assert.equal(f.editor.editorParts.closeController.isPending(f.firstInput), false);
});

test('a newer same-host control focus from destination attachment is not overwritten by move completion', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, target = f.secondGroup;
	const sibling = parts.splitGroup(target, 'right')!, siblingInput = new CodeEditorInput(f.firstInput.workingCopy);
	sibling.openEditor(siblingInput); f.update();
	const siblingPane = sibling.panes.activePane!;
	f.first.focus();
	const unbind = target.panes.onWillShowEditor(() => { siblingPane.focus(); }); t.after(unbind);
	assert.equal(parts.moveEditor(f.firstGroup, f.firstInput, { kind: 'group', group: target }), true);
	assert.ok(target.panes.activePane?.input === f.firstInput);
	assert.ok(inputFocus.target === siblingPane.commandTarget, 'only the newer concrete control owns the final focus intent');
	assert.ok(parts.activePart === f.secondPart && parts.activeGroup === sibling, 'opening admission cannot erase an accepted control interaction from editor routing');
	assert.ok(sibling.panes.activePane === siblingPane && sibling.model.activeTab === siblingInput);
});

test('a successful sibling transfer retires its empty nonfinal source group after history follows the retained input', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = parts.main.activeGroup;
	const input = new CodeEditorInput(f.firstInput.workingCopy); source.openEditor(input);
	const target = parts.splitGroup(source, 'right')!;
	resetNavigationHistoryState(); t.after(resetNavigationHistoryState);
	const entry = new NavigationHistoryEntry({ kind: 'input', input }, new CodeEditorNavigationSelection(input), source);
	navigationState.back.push(entry);
	let retired = false; source.onWillDispose(() => { retired = true; });
	const text = input.workingCopy.buffer.getText(), version = input.workingCopy.version, documents = parts.documents.length;
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: target }), true);
	assert.equal(retired, true); assert.equal(source.openingAdmitted, false); assert.equal(parts.groups.includes(source), false);
	assert.equal(parts.main.groups.length, 1); assert.ok(parts.main.activeGroup === target);
	assert.ok(target.model.activeTab === input && target.panes.activePane?.input === input);
	assert.ok(entry.owner === target && entry.target.kind === 'input' && entry.target.input === input);
	assert.equal(entry.isDisposed, false); assert.equal(navigationState.back.includes(entry), true);
	assert.equal(parts.documents.length, documents); assert.equal(input.workingCopy.buffer.getText(), text); assert.equal(input.workingCopy.version, version);
});

test('empty source-group retirement cannot revive a destination cleared by a newer workspace callback', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = parts.main.activeGroup;
	const input = new CodeEditorInput(f.firstInput.workingCopy); source.openEditor(input);
	const target = parts.splitGroup(source, 'right')!;
	let retired = false; source.onWillDispose(() => { retired = true; parts.clear(); });
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: target }), false);
	assert.equal(retired, true); assert.equal(parts.groups.length, 1); assert.equal(parts.documents.length, 0);
	assert.ok(parts.activePart === parts.main); assert.equal(parts.main.activeGroup.model.tabs.length, 0);
	assert.equal(parts.main.activeGroup.panes.activePane, null); assert.equal(f.editor.editorParts.closeController.isPending(input), false);
});

for (const publication of ['label', 'dirty', 'pin'] as const) test(`${publication} publication during transfer does not revoke unchanged editor membership`, t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = parts.main.activeGroup;
	const input = new CodeEditorInput(f.firstInput.workingCopy); source.openEditor(input, { pinned: false });
	const target = parts.splitGroup(source, 'right')!, before = input.workingCopy.buffer.getText();
	let published = false, unbind = () => {};
	const publish = () => {
		published = true; unbind();
		if (publication === 'label') input.title = 'changed source label';
		else if (publication === 'dirty') input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edited during transfer\n' }]);
		else source.model.pin(input);
	};
	unbind = publication === 'dirty' ? source.onDidMoveEditor(publish) : source.panes.onDidClearEditor(publish);
	t.after(unbind);
	assert.equal(parts.moveEditor(source, input, { kind: 'group', group: target }), true);
	assert.equal(published, true); assert.ok(target.model.activeTab === input && target.panes.activePane?.input === input);
	assert.equal(target.model.previewTab, null); assert.equal(f.editor.editorParts.closeController.isPending(input), false);
	assert.equal(input.workingCopy.buffer.getText(), publication === 'dirty' ? `-- edited during transfer\n${before}` : before);
});

test('destination attachment retirement rejects transfer while the live source continues projecting its retained input', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup, target = f.secondGroup;
	const unbind = source.panes.onDidClearEditor(() => { unbind(); f.secondPart.window!.detach(); }); t.after(unbind);
	const bind = t.mock.method(target.panes, 'openEditor');
	assert.equal(parts.moveEditor(source, f.firstInput, { kind: 'group', group: target }), false);
	assert.equal(target.paneSurface.retired, true); assert.equal(bind.mock.callCount(), 0);
	assert.ok(source.model.activeTab === f.firstInput && source.panes.activePane?.input === f.firstInput);
	assert.ok(target.model.activeTab === f.secondInput); assert.equal(f.editor.editorParts.closeController.isPending(f.firstInput), false);
});

for (const origin of ['source', 'destination'] as const) for (const coalesced of [false, true])
	test(`inadmitted ${origin} resolution cannot interrupt ${coalesced ? 'coalesced' : 'retained'} transfer history or start input production`, async t => {
		const f = createActualSourcePanes(t, coalesced), parts = f.editor.editorParts, source = f.firstGroup, target = f.secondGroup;
		const group = origin === 'source' ? source : target, input = f.firstInput, receiver = coalesced ? f.secondInput : input;
		resetNavigationHistoryState(); t.after(resetNavigationHistoryState);
		const entry = new NavigationHistoryEntry({ kind: 'input', input }, new CodeEditorNavigationSelection(input), source);
		navigationState.back.push(entry);
		let resolved = false;
		let pending: Promise<EditorInputOpenResult | undefined> | undefined, receiptUnchanged = false;
		const unbind = source.model.onDidChange(() => {
			if (source.model.indexOf(input) >= 0 || pending !== undefined) return;
			const receipt = group.panes.openGeneration;
			pending = group.openResolvedEditor(() => { resolved = true; return new HomeInput(null); });
			receiptUnchanged = group.panes.openGeneration === receipt;
		}); t.after(unbind);
		const moved = parts.moveEditor(source, input, { kind: 'group', group: target });
		assert.equal(group.openingAdmitted, true, 'the host operation has reopened admission before the candidate settles');
		assert.equal(await pending, undefined);
		assert.equal(moved, true); assert.equal(receiptUnchanged, true); assert.equal(resolved, false);
		assert.ok(target.model.activeTab === receiver && target.panes.activePane?.input === receiver);
		assert.ok(entry.owner === target && entry.target.kind === 'input' && entry.target.input === receiver);
		assert.equal(entry.isDisposed, false); assert.equal(navigationState.back.includes(entry), true);
	});
