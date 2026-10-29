import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['folder/third.lua', 'return 3']]);
	f.first.focus(); const panel = f.editor.resourcePanel;
	panel.show(); panel.queuePendingSelection({ contextId: f.sources.systemContextId, path: 'folder/third.lua' }); panel.applyPendingSelection(); f.update();
	const node = panel.files.selectedNode; assert.ok(node !== null && node.element.kind === 'file');
	return { ...f, panel, node, resource: node.element.resource };
}
type Fixture = ReturnType<typeof fixture>;

function row(f: Fixture, command: EditorCommandId): number {
	return f.editor.quickInput.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === command);
}

function palette(f: Fixture): void {
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift); assert.equal(f.editor.quickInput.visible, true);
}

/** Choose semantic commands through the real Palette; no incidental command wording or row coordinates. */
function accept(f: Fixture, command: EditorCommandId): void {
	const index = row(f, command); assert.ok(index >= 0);
	f.key('Home', KeyModifier.ctrl); for (let count = 0; count < index; count++) f.key('ArrowDown'); f.key('Enter');
}

test('Files Palette exposes its actual Open to Side capability and executes beside the invoking host', async t => {
	const f = fixture(t), open = t.mock.method(f.editor.navigation, 'openResource'); f.panel.setFocused(true); palette(f);
	assert.ok(f.editor.quickInput.invocationOrigin === f.panel.focusTarget); assert.ok(row(f, 'resources.openToSide') >= 0);
	accept(f, 'resources.openToSide'); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const destination = open.mock.calls[0].arguments[0], input = destination.model.activeTab;
	assert.ok(destination !== f.firstGroup && f.editor.editorParts.partForGroup(destination) === f.firstPart);
	assert.ok(input instanceof CodeEditorInput && input.resource === f.resource && destination.panes.activePane?.input === input);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

test('a disabled actual Files local command does not borrow the captured Source editor capability', t => {
	const f = fixture(t), model = f.firstInput.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- canonical Undo belongs to Source\n' }]);
	const source = model.buffer.getText(), version = model.version; assert.equal(model.canUndo, true);
	f.panel.focusTarget.registerCommand('undo', { isEnabled: () => false, run: () => { throw new Error('A disabled Files command cannot execute.'); } });
	t.after(() => f.panel.focusTarget.unregisterCommand('undo'));
	f.panel.setFocused(true); palette(f);
	assert.equal(row(f, 'undo'), -1); assert.ok(row(f, 'resources.openToSide') >= 0);
	f.key('Escape'); assert.ok(inputFocus.admittedTarget === f.panel.focusTarget);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.canUndo, true);
});

test('folder-disabled Open to Side remains unavailable in Palette rather than borrowing an editor action', t => {
	const f = fixture(t); f.panel.setSelectionIndex(f.panel.files.tree.rows.indexOf(f.node.parent!)); f.panel.setFocused(true); palette(f);
	assert.ok(f.editor.quickInput.invocationOrigin === f.panel.focusTarget); assert.equal(row(f, 'resources.openToSide'), -1);
	assert.ok(row(f, 'group.splitRight') >= 0); f.key('Escape');
	assert.equal(f.firstPart.groups.length, 1); assert.ok(inputFocus.admittedTarget === f.panel.focusTarget);
});

test('an actual Files clipboard binding without Copy cannot borrow the captured diagnostic body Copy', t => {
	const f = fixture(t);
	f.firstGroup.openEditor(new HostErrorInput('exact attached diagnostic'));
	const body = f.firstGroup.panes.activePane!.commandTarget;
	assert.equal(f.editor.commands.isEnabled('copy', body), true);
	t.after(f.panel.focusTarget.bindClipboard({ paste() {} }));
	f.panel.setFocused(true); palette(f);
	assert.equal(row(f, 'copy'), -1); f.key('Escape');
	assert.ok(inputFocus.admittedTarget === f.panel.focusTarget);
});

test('readonly Files clipboard owns Copy bytes and suppresses the editable Source clipboard operations', async t => {
	const f = fixture(t);
	assert.equal(f.editor.commands.isEnabled('paste', f.first.commandTarget), true);
	t.after(f.panel.focusTarget.bindClipboard({ readOnly: true, copy: () => f.resource.path }));
	f.panel.setFocused(true); palette(f);
	assert.equal(row(f, 'cut'), -1); assert.equal(row(f, 'paste'), -1);
	accept(f, 'copy'); await setImmediate();
	// Exact clipboard payload is a focused-control data-integrity contract, not UI wording.
	assert.equal((await f.editor.clipboard.read()).text, f.resource.path);
	assert.equal(f.firstInput.workingCopy.dirty, false);
});

test('editor actions invoked from Files retain the captured editor group when workspace activation changes behind Palette', t => {
	const f = fixture(t); f.panel.setFocused(true); palette(f);
	assert.ok(row(f, 'group.splitRight') >= 0); f.editor.editorParts.activate(f.secondPart);
	accept(f, 'group.splitRight');
	assert.equal(f.firstPart.groups.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

for (const retirement of ['rebind', 'detach'] as const) test(`Files survives secondary editor ${retirement} during Palette focus return without granting the stale command to its replacement`, t => {
	const f = fixture(t), newer = new HostErrorInput('newer captured editor attachment'); f.panel.setFocused(true); palette(f);
	assert.ok(row(f, 'group.splitRight') >= 0); let retired = false;
	const unbind = f.panel.focusTarget.onDidFocus(() => {
		unbind(); retired = true;
		if (retirement === 'rebind') f.firstGroup.openEditor(newer);
		else f.firstPart.window!.detach();
	}); t.after(unbind);
	accept(f, 'group.splitRight');
	assert.equal(retired, true); assert.equal(f.firstPart.groups.length, 1); assert.equal(f.secondPart.groups.length, 1);
	if (retirement === 'rebind') assert.ok(f.firstGroup.model.activeTab === newer && f.firstGroup.panes.activePane?.input === newer);
	else assert.equal(f.firstPart.surface.retired, true);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

test('closing the secondary editor host revokes the fixed Palette catalog even while Files remains live', async t => {
	const f = fixture(t); f.panel.setFocused(true); palette(f); assert.ok(row(f, 'group.splitRight') >= 0);
	assert.equal(await f.editor.editorParts.close(f.firstPart), true);
	assert.equal(f.editor.quickInput.visible, false); assert.equal(f.firstPart.retired, true); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && inputFocus.admittedTarget !== f.editor.quickInput.field.focusTarget);
	assert.ok(f.panel.isVisible() && f.panel.focusTarget.getCommand('resources.openToSide')!.isEnabled());
});

for (const origin of ['Files', 'Source'] as const) test(`replacing Go to File with Palette preserves its prepared ${origin} origin rather than the shared picker field`, async t => {
	const f = fixture(t); if (origin === 'Files') f.panel.setFocused(true); else f.first.focus();
	const prepared = inputFocus.admittedTarget; assert.ok(prepared !== null);
	f.key('Comma', KeyModifier.ctrl); assert.equal(f.editor.quickInput.visible, true);
	assert.ok(f.editor.quickInput.invocationOrigin === prepared && inputFocus.admittedTarget === f.editor.quickInput.field.focusTarget);
	palette(f); assert.ok(f.editor.quickInput.invocationOrigin === prepared);
	assert.ok(f.editor.quickInput.invocationOrigin !== f.editor.quickInput.field.focusTarget);
	if (origin === 'Files') {
		assert.ok(row(f, 'resources.openToSide') >= 0); accept(f, 'resources.openToSide'); await setImmediate();
		const side = f.firstPart.groups.find(group => group !== f.firstGroup)!;
		assert.ok(side !== undefined && side.model.activeTab instanceof CodeEditorInput && side.model.activeTab.resource === f.resource);
	} else {
		assert.equal(row(f, 'resources.openToSide'), -1); accept(f, 'group.splitRight'); assert.equal(f.firstPart.groups.length, 2);
	}
	assert.equal(f.secondPart.groups.length, 1); assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

test('Files Palette side placement retains its invoking editor context despite later workspace activation', async t => {
	const f = fixture(t), open = t.mock.method(f.editor.navigation, 'openResource'); f.panel.setFocused(true); palette(f);
	const focused = inputFocus.admittedTarget; f.editor.editorParts.activate(f.secondPart);
	assert.ok(f.editor.quickInput.visible && inputFocus.admittedTarget === focused);
	accept(f, 'resources.openToSide'); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const target = open.mock.calls[0].arguments[0];
	assert.ok(f.editor.editorParts.partForGroup(target) === f.firstPart && open.mock.calls[0].arguments[1] === f.resource);
	assert.equal(f.firstPart.groups.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

test('Files Palette uses its accepting current selection but retains the separately captured editor destination', async t => {
	const f = fixture(t), open = t.mock.method(f.editor.navigation, 'openResource'); f.panel.setFocused(true); palette(f);
	const focused = inputFocus.admittedTarget, selected = f.secondInput.workingCopy.resource;
	f.panel.queuePendingSelection(selected); f.panel.applyPendingSelection(); f.update(); f.editor.editorParts.activate(f.secondPart);
	assert.ok(f.editor.quickInput.visible && inputFocus.admittedTarget === focused);
	accept(f, 'resources.openToSide'); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const target = open.mock.calls[0].arguments[0], input = target.model.activeTab;
	assert.ok(f.editor.editorParts.partForGroup(target) === f.firstPart && open.mock.calls[0].arguments[1] === selected);
	assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.secondInput.workingCopy && input !== f.secondInput);
	assert.equal(f.firstPart.groups.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

test('an explicit absent editor context cannot borrow the active editor for a local Files action', t => {
	const f = fixture(t), open = t.mock.method(f.editor.navigation, 'openResource'); f.panel.setFocused(true);
	f.editor.commands.execute('resources.openToSide', f.panel.focusTarget, undefined, null);
	assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 1); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(inputFocus.admittedTarget === f.panel.focusTarget);
});

test('Source draft acceptance retires the captured editor context independently of its live Files command target', t => {
	const f = fixture(t), generation = f.firstGroup.panes.openGeneration, filesContext = f.panel.focusTarget.scope.contextGeneration;
	let accepted = false, executed = false;
	f.panel.focusTarget.registerCommand('save', { editScope: f.firstGroup.focusScope,
		isEnabled: () => true, run: () => { executed = true; } });
	t.after(() => f.panel.focusTarget.unregisterCommand('save'));
	const field = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => {
		accepted = true; f.firstPart.suspend(); inputFocus.setTarget(null);
	}); t.after(() => field.dispose());
	field.setValue(1); field.layout(f.firstGroup.panes.contentBounds); field.field.focusTarget.focus(); setFieldText(field.field, '2', true);
	f.editor.commands.execute('save', f.panel.focusTarget, undefined, f.first.commandTarget);
	assert.equal(accepted, true); assert.equal(executed, false); assert.equal(field.pending, false);
	assert.equal(f.firstGroup.panes.openGeneration, generation); assert.equal(f.panel.focusTarget.scope.contextGeneration, filesContext);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.model.contains(f.firstInput));
});

test('Files Palette navigation does not borrow a newer real pane focused during its return to Files', async t => {
	const f = fixture(t), open = t.mock.method(f.editor.navigation, 'openResource'); f.panel.setFocused(true); palette(f);
	let redirected = false;
	const unbind = f.editor.quickInput.field.focusTarget.onDidBlur(next => {
		if (next !== f.panel.focusTarget) return;
		unbind(); redirected = true; f.second.focus();
	}); t.after(unbind);
	accept(f, 'resources.openToSide'); await setImmediate();
	assert.equal(redirected, true); assert.equal(open.mock.callCount(), 0);
	assert.equal(f.firstPart.groups.length, 1); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});
