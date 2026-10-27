import assert from 'node:assert/strict';
import test from 'node:test';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import { NavigationHistoryEntry, createNavigationEntry, navigationState, resetNavigationHistoryState, withNavigationCaptureSuspended } from '../../ide/navigation/navigation_history';
import { createActualSourcePanes } from '../helpers/source_panes';

test('stacked and pending navigation follow an exact retained view after its original window closes', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.first.focus(); resetNavigationHistoryState();
	f.firstInput.context.view.cursorColumn = 4;
	const stacked = createNavigationEntry()!, pending = createNavigationEntry()!;
	t.after(() => pending.dispose()); navigationState.back.push(stacked);
	assert.equal(parts.moveEditor(f.firstPart.activeGroup, f.firstInput, f.secondPart.activeGroup, f.editor.editorClose), true);
	assert.ok(stacked.owner === f.secondGroup && pending.owner === f.secondGroup);
	assert.equal(stacked.isDisposed, false); assert.equal(pending.isDisposed, false);
	assert.equal(await parts.close(f.firstPart), true);
	assert.equal(stacked.isDisposed, false); assert.equal(pending.isDisposed, false);
	withNavigationCaptureSuspended(() => f.secondGroup.activate(f.secondInput.id));
	await f.editor.navigation.goBackward();
	assert.ok(f.secondGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstInput.context.view.cursorColumn, 4);
	assert.equal(parts.documents.length, 1, 'history cannot recreate the retired source window');
});

test('coalescing retargets input-bound history before the redundant input retires', async t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts;
	f.first.focus(); resetNavigationHistoryState();
	const entry = new NavigationHistoryEntry({ kind: 'input', input: f.firstInput }, new CodeEditorNavigationSelection(f.firstInput), f.firstGroup);
	navigationState.back.push(entry);
	assert.equal(parts.moveEditor(f.firstPart.activeGroup, f.firstInput, f.secondPart.activeGroup, f.editor.editorClose), true);
	assert.equal(entry.isDisposed, false); assert.ok(entry.owner === f.secondGroup);
	assert.ok(entry.target.kind === 'input' && entry.target.input === f.secondInput);
	assert.equal(await parts.close(f.firstPart), true); assert.equal(entry.isDisposed, false);
	assert.equal(await f.secondGroup.close(f.secondInput.id), true);
	assert.equal(entry.isDisposed, true); assert.equal(navigationState.back.includes(entry), false);
});

test('a history resolution begun before transfer cannot reopen the old group or consume the retargeted entry', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.first.focus(); resetNavigationHistoryState();
	const entry = createNavigationEntry()!; navigationState.back.push(entry);
	const resolution = Promise.withResolvers<CodeEditorInput>();
	const resolve = t.mock.method(f.editor.resourceEditors, 'resolveEditorInput', () => resolution.promise);
	const navigation = f.editor.navigation.goBackward();
	assert.equal(resolve.mock.callCount(), 1);
	assert.equal(parts.moveEditor(f.firstPart.activeGroup, f.firstInput, f.secondPart.activeGroup, f.editor.editorClose), true);
	assert.equal(await parts.close(f.firstPart), true);
	const late = new CodeEditorInput(f.firstInput.workingCopy), dispose = t.mock.method(late, 'dispose');
	resolution.resolve(late); await navigation; resolve.mock.restore();
	assert.equal(dispose.mock.callCount(), 1);
	assert.ok(entry.owner === f.secondGroup); assert.equal(entry.isDisposed, false);
	assert.ok(navigationState.back.at(-1) === entry);
	assert.ok(f.secondGroup.model.activeTab === f.firstInput); assert.equal(parts.documents.length, 1);
	await f.editor.navigation.goBackward();
	assert.equal(entry.isDisposed, true); assert.ok(f.secondGroup.model.activeTab === f.firstInput);
});
