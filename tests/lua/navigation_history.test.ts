import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { resourceIdentityKey } from '../../ide/common/resource';
import { inputFocus } from '../../ide/input/focus';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	NavigationHistoryEntry, areNavigationEntriesEqual, captureNavigation, createNavigationEntry, navigationState,
	pushUniqueNavigationEntry, resetNavigationHistoryState, initializeNavigationState, beginNavigationCapture,
	completeNavigation, selectNavigationHistoryEntry, withNavigationCaptureSuspended,
} from '../../ide/navigation/navigation_history';
import { EditorPaneSelection } from '../../ide/workbench/services/editor/editor_selection';
import { EditorNavigationController } from '../../ide/workbench/contrib/resources/navigation';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import type { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import { ResourceEditorResolver } from '../../ide/workbench/services/editor/resource_editor_resolver';
import { createTestEditorGroup } from '../helpers/editor_panes';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';

test.afterEach(() => editorTextModelService.clear());

class Location extends EditorPaneSelection {
	public constructor(public readonly value: number) { super(); }
	public matches(other: Location): boolean { return this.value === other.value; }
}
function entry(owner: EditorGroupView, path: string, value: number): NavigationHistoryEntry {
	return new NavigationHistoryEntry({ kind: 'resource', resource: { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }, editorId: WORKBENCH_TEXT_EDITOR_ID }, new Location(value), owner);
}
function code(path: string) {
	const model = editorTextModelService.retain({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { resid: path, type: 'lua' } }, 'lua', 'local before = 1\nlocal target = before\nreturn target\n');
	return new CodeEditorInput(model);
}

test('Back/Forward preserve the live destination, not an earlier captured cursor', t => {
	const group = createTestEditorGroup(); t.after(() => group.dispose());
	resetNavigationHistoryState();
	const origin = entry(group, 'main.lua', 4);
	const current = entry(group, 'enemy.lua', 37);
	navigationState.back.push(origin);
	const back = selectNavigationHistoryEntry('back', current)!;
	assert.equal(back.target, origin);
	assert.deepEqual(navigationState.back, [origin]); assert.deepEqual(navigationState.forward, []);
	assert.equal(back.accept(), true);
	assert.deepEqual(navigationState.forward, [current]);
	const returned = entry(group, 'main.lua', 4), forward = selectNavigationHistoryEntry('forward', returned)!;
	assert.equal(forward.target, current); assert.equal(forward.accept(), true);
	assert.deepEqual(navigationState.back, [returned]);
	resetNavigationHistoryState();
});

test('bounded history owns disposal on duplicates, eviction, forward pruning and reset', t => {
	const group = createTestEditorGroup(); t.after(() => group.dispose());
	resetNavigationHistoryState();
	const first = entry(group, 'a.lua', 0); pushUniqueNavigationEntry(navigationState.back, first);
	const duplicate = entry(group, 'a.lua', 0); pushUniqueNavigationEntry(navigationState.back, duplicate);
	assert.equal(duplicate.selection!.isDisposed, true);
	assert.equal(first.selection!.isDisposed, false);
	for (let index = 1; index <= 64; index += 1) pushUniqueNavigationEntry(navigationState.back, entry(group, 'a.lua', index));
	assert.equal(navigationState.back.length, 64);
	assert.equal(first.selection!.isDisposed, true);
	const returned = selectNavigationHistoryEntry('back', entry(group, 'b.lua', 7))!;
	assert.equal(returned.accept(), true);
	const forward = navigationState.forward[0];
	returned.dispose(); resetNavigationHistoryState();
	assert.equal(forward.selection!.isDisposed, true);
	const unused = entry(group, 'c.lua', 2);
	assert.equal(selectNavigationHistoryEntry('back', unused), null);
	assert.equal(unused.selection!.isDisposed, true);
});

test('input close removes visual destinations from both stacks; resource destinations stay reopenable', t => {
	const group = createTestEditorGroup(); t.after(() => group.dispose());
	resetNavigationHistoryState();
	const text = code('close.lua');
	const visual = new SceneEditorInput(text.workingCopy);
	const back = new NavigationHistoryEntry({ kind: 'input', input: visual }, new Location(1), group);
	const forward = new NavigationHistoryEntry({ kind: 'input', input: visual }, new Location(2), group);
	const resource = new NavigationHistoryEntry({ kind: 'resource', ...text.toResourceEditor() }, new CodeEditorNavigationSelection(text), group);
	navigationState.back.push(resource, back); navigationState.forward.push(forward);
	assert.equal(areNavigationEntriesEqual(back, resource), false, 'resource sharing is not view identity');
	visual.dispose(); text.dispose();
	assert.deepEqual(navigationState.back, [resource]); assert.equal(navigationState.forward.length, 0);
	assert.equal(back.selection!.isDisposed, true); assert.equal(forward.selection!.isDisposed, true);
	assert.equal(resource.selection!.isDisposed, false);
	resetNavigationHistoryState();
});

test('child pane construction and disposal cannot replace the frontend navigation owner', t => {
	configureFontVariant('tiny');
	const group = createTestEditorGroup();
	t.after(initializeNavigationState(group));
	const input = code('main.lua'); group.openEditor(input);
	t.after(() => { group.dispose(); input.dispose(); });
	const retained = createNavigationEntry()!;
	navigationState.back.push(retained);

	const sibling = createTestEditorGroup();
	t.after(() => sibling.dispose());
	assert.deepEqual(navigationState.back, [retained]);
	const afterConstruction = createNavigationEntry()!;
	assert.equal(afterConstruction.owner, group);
	assert.equal(areNavigationEntriesEqual(afterConstruction, retained), true);
	afterConstruction.dispose();

	const siblingBack = entry(sibling, 'main.lua', 0), siblingForward = entry(sibling, 'other.lua', 2);
	navigationState.back.push(siblingBack); navigationState.forward.push(siblingForward);
	sibling.dispose();
	assert.deepEqual(navigationState.back, [retained]);
	assert.equal(navigationState.forward.length, 0);
	assert.equal(siblingBack.selection!.isDisposed, true);
	assert.equal(siblingForward.selection!.isDisposed, true);
	assert.equal(retained.selection!.isDisposed, false);
	const afterDisposal = createNavigationEntry()!;
	assert.equal(afterDisposal.owner, group);
	assert.equal(areNavigationEntriesEqual(afterDisposal, retained), true);
	afterDisposal.dispose();
});

test('pane retirement releases pending selections before a later completion', t => {
	configureFontVariant('tiny');
	const group = createTestEditorGroup();
	t.after(initializeNavigationState(group));
	const input = code('retiring.lua'); group.openEditor(input);
	t.after(() => { group.dispose(); input.dispose(); });
	const pending = beginNavigationCapture()!;
	const target = entry(group, 'closed.lua', 3);
	navigationState.back.push(target);
	const selected = selectNavigationHistoryEntry('back', createNavigationEntry())!;
	assert.equal(selected.target, target);
	assert.equal(pending.selection!.isDisposed, false);
	assert.equal(selected.target.selection!.isDisposed, false);

	group.dispose();
	assert.equal(pending.isDisposed, true);
	assert.equal(pending.selection!.isDisposed, true);
	assert.equal(selected.isCurrent, false);
	assert.equal(selected.target.selection!.isDisposed, true);
	assert.equal(selected.accept(), false); selected.dispose();
	assert.equal(navigationState.back.length, 0);
	assert.equal(navigationState.forward.length, 0);
	completeNavigation(pending);
	assert.equal(navigationState.back.length, 0);
});

test('matching resources and selections retain distinct capturing pane lifetimes', t => {
	const primary = createTestEditorGroup(), sibling = createTestEditorGroup();
	t.after(() => { primary.dispose(); sibling.dispose(); });
	const first = entry(primary, 'same.lua', 1), second = entry(sibling, 'same.lua', 1);
	assert.equal(areNavigationEntriesEqual(first, second), false);
	first.dispose(); second.dispose();
});

test('one explicit navigation records a departure before mutating the same retained input', t => {
	configureFontVariant('tiny');
	const group = createTestEditorGroup();
	t.after(initializeNavigationState(group));
	const input = code('same.lua'); group.openEditor(input);
	t.after(() => { group.dispose(); });
	const original = createNavigationEntry()!;
	captureNavigation(() => {
		input.context.view.cursorRow = 2;
		group.activate(input.id);
	});
	assert.equal(navigationState.back.length, 1);
	assert.equal(areNavigationEntriesEqual(navigationState.back[0], original), true);
	original.dispose();
	const current = createNavigationEntry()!;
	const selected = selectNavigationHistoryEntry('back', current)!;
	withNavigationCaptureSuspended(() => group.activate(input.id, undefined, selected.target.selection));
	assert.equal(selected.accept(), true);
	const forward = navigationState.forward[0];
	captureNavigation(() => { input.context.view.cursorRow = 1; });
	assert.equal(navigationState.forward.length, 0);
	assert.equal(forward.selection!.isDisposed, true, 'a new navigation owns disposal of the abandoned branch');
});

test('history awaits the registered resource opener and restores a closed text input after hidden edits', async t => {
	configureFontVariant('tiny');
	const group = createTestEditorGroup();
	t.after(initializeNavigationState(group));
	const origin = code('origin.lua'); group.openEditor(origin);
	const closed = code('target.lua'); closed.context.view.cursorRow = 1; closed.context.view.cursorColumn = 6;
	const selection = new CodeEditorNavigationSelection(closed);
	const target = new NavigationHistoryEntry({ kind: 'resource', ...closed.toResourceEditor() }, selection, group);
	navigationState.back.push(target); closed.dispose();
	const prefix = '-- 🐉 moved\n'; closed.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	const reopened = new CodeEditorInput(closed.workingCopy);
	const resource = reopened.workingCopy.resource;
	let finishOpen!: () => void;
	const openGate = new Promise<void>(resolve => { finishOpen = resolve; });
	const catalog = new WorkspaceSourceCatalog();
	for (const [key, value] of new Map([[resourceIdentityKey(resource), resource]])) catalog.resourceByIdentity.set(key, value);
	const navigation = new EditorNavigationController(
		catalog,
		{ focusTarget: inputFocus.createTarget(), isFocused: () => false } as ResourcePanelController,
		new ResourceEditorResolver([{
			id: WORKBENCH_TEXT_EDITOR_ID, selector: { kind: 'all' }, createEditorInput: async actual => {
				assert.equal(actual, resource); await openGate; return reopened;
			},
		}]), group,
	);
	t.after(() => { group.dispose(); });
	const version = reopened.workingCopy.version;
	const pending = navigation.goBackward();
	assert.equal(navigationState.captureSuspendDepth, 0, 'I/O must not suspend unrelated user navigation');
	assert.equal(group.model.activeTab, origin);
	finishOpen(); await pending;
	assert.equal(navigationState.captureSuspendDepth, 0);
	assert.equal(group.model.activeTab, reopened);
	assert.equal(reopened.context.view.cursorRow, 2); assert.equal(reopened.context.view.cursorColumn, 6);
	assert.equal(reopened.workingCopy.version, version);
	assert.equal(selection.isDisposed, true);
	assert.equal(navigationState.forward.length, 1);
});

test('Back activates a surviving visual preview without turning navigation into Keep Open', async t => {
	configureFontVariant('tiny');
	const group = createTestEditorGroup();
	t.after(initializeNavigationState(group));
	const origin = code('origin.lua'); group.openEditor(origin);
	const visual = new SceneEditorInput(origin.workingCopy);
	group.model.add(visual, { pinned: false });
	const target = new NavigationHistoryEntry({ kind: 'input', input: visual }, new Location(1), group);
	navigationState.back.push(target);
	const navigation = new EditorNavigationController(
		new WorkspaceSourceCatalog(), { focusTarget: inputFocus.createTarget(), isFocused: () => false } as ResourcePanelController,
		new ResourceEditorResolver([]), group,
	);
	t.after(() => { group.dispose(); });
	await navigation.goBackward();
	assert.equal(group.model.activeTab, visual);
	assert.equal(group.model.previewTab, visual);
	assert.equal(group.model.tabs.length, 2);
	assert.equal(origin.workingCopy.dirty, false);
	assert.equal(navigationState.forward.length, 1);
});

for (const route of ['resource', 'history'] as const) for (const interruption of ['new navigation', 'direct tab', 'same tab', 'teardown', 'owner disposal'] as const) {
	test(`slow ${route} resolution cannot reactivate after ${interruption}`, async t => {
		configureFontVariant('tiny');
		const group = createTestEditorGroup();
		t.after(initializeNavigationState(group));
		const origin = code('origin.lua'); group.openEditor(origin);
		const older = code('older.lua'), newer = code('newer.lua');
		let discarded = 0; older.onWillDispose(() => { discarded += 1; });
		let finishOpen!: () => void;
		const openGate = new Promise<void>(resolve => { finishOpen = resolve; });
		const catalog = new WorkspaceSourceCatalog();
		for (const [key, value] of new Map([[resourceIdentityKey(older.workingCopy.resource), older.workingCopy.resource]])) catalog.resourceByIdentity.set(key, value);
		const navigation = new EditorNavigationController(
			catalog,
			{ queuePendingSelection() {}, isVisible: () => false, focusTarget: inputFocus.createTarget(), isFocused: () => false } as unknown as ResourcePanelController,
			new ResourceEditorResolver([{
				id: WORKBENCH_TEXT_EDITOR_ID, selector: { kind: 'all' }, createEditorInput: async resource => {
					if (resource === older.workingCopy.resource) { await openGate; return older; }
					return newer;
				},
			}]), group,
		);
		t.after(() => { group.dispose(); });
		const target = new NavigationHistoryEntry({ kind: 'resource', ...older.toResourceEditor() }, new CodeEditorNavigationSelection(older), group);
		if (route === 'history') navigationState.back.push(target);
		const pending = route === 'history' ? navigation.goBackward() : navigation.openResource(older.workingCopy.resource);
		assert.equal(navigationState.captureSuspendDepth, 0);
		if (interruption === 'new navigation') await navigation.openResource(newer.workingCopy.resource);
		else if (interruption === 'direct tab') group.openEditor(newer);
		else if (interruption === 'same tab') group.activate(origin.id);
		else if (interruption === 'owner disposal') {
			group.dispose();
			if (route === 'history') assert.equal(target.selection!.isDisposed, true);
		}
		else { group.panes.clearEditor(); group.model.clear(); }
		const active = group.model.activeTab;
		const history = [...navigationState.back];
		if (interruption === 'new navigation' || interruption === 'direct tab') {
			assert.equal(active, newer);
			assert.equal(history.length, route === 'history' ? 2 : 1, 'pending I/O neither consumes its destination nor suppresses the new departure');
			assert.equal(navigationState.forward.length, 0);
		}
		finishOpen();
		assert.equal(await pending, undefined);
		assert.equal(group.model.activeTab, active, 'request order, not I/O completion order, owns navigation');
		assert.deepEqual(navigationState.back, history, 'cancelled completion does not capture another navigation');
		assert.equal(discarded, 1, 'release the unadmitted input, not the workspace text model');
		assert.equal(older.workingCopy.buffer.getText().includes('local target'), true);
		if (route === 'history') assert.equal(target.selection!.isDisposed, interruption === 'owner disposal');
		else target.dispose();
	});
}

test('cancelled resolution disposes its fresh candidate without disturbing the retained same-resource input', async t => {
	configureFontVariant('tiny');
	const group = createTestEditorGroup();
	t.after(initializeNavigationState(group));
	const input = code('retained.lua'); group.openEditor(input);
	const candidate = new CodeEditorInput(input.workingCopy);
	let retainedDisposals = 0, candidateDisposals = 0;
	input.onWillDispose(() => { retainedDisposals++; }); candidate.onWillDispose(() => { candidateDisposals++; });
	const navigation = new EditorNavigationController(
		new WorkspaceSourceCatalog(),
		{ queuePendingSelection() {}, isVisible: () => false, focusTarget: inputFocus.createTarget(), isFocused: () => false } as unknown as ResourcePanelController,
		new ResourceEditorResolver([{ id: WORKBENCH_TEXT_EDITOR_ID, selector: { kind: 'all' }, createEditorInput: () => candidate }]), group,
	);
	t.after(() => { group.dispose(); });
	const pending = navigation.openResource(input.workingCopy.resource);
	group.activate(input.id);
	assert.equal(await pending, undefined);
	assert.equal(candidateDisposals, 1);
	assert.equal(retainedDisposals, 0);
	assert.equal(group.model.activeTab, input);
});

test('a delayed resource open preserves a newer focus target in the same owning group', async t => {
	configureFontVariant('tiny');
	const group = createTestEditorGroup();
	t.after(initializeNavigationState(group));
	t.after(() => group.dispose());
	group.openEditor(code('origin.lua'));
	const candidate = code('destination.lua');
	let finish!: () => void;
	const gate = new Promise<void>(resolve => { finish = resolve; });
	const navigation = new EditorNavigationController(
		new WorkspaceSourceCatalog(),
		{} as ResourcePanelController,
		new ResourceEditorResolver([{ id: WORKBENCH_TEXT_EDITOR_ID, selector: { kind: 'all' },
			createEditorInput: async () => { await gate; return candidate; } }]),
		group,
	);
	const pending = navigation.openResource(candidate.workingCopy.resource);
	// A group-owned popup may take focus while its content resource is resolving.
	const popup = inputFocus.createTarget(group.tabFocusTarget);
	const unbind = popup.bindKeyboard(() => {}); t.after(unbind);
	popup.focus();
	assert.equal(navigationState.activeGroup, group);
	finish();
	assert.equal(await pending, group.panes.openGeneration);
	assert.equal(group.model.activeTab, candidate);
	assert.equal(group.panes.activePane!.input, candidate);
	assert.equal(inputFocus.target, popup);
});

test('async resource admission captures the departure before an in-control caret move', async t => {
	configureFontVariant('tiny');
	const group = createTestEditorGroup();
	t.after(initializeNavigationState(group));
	t.after(() => group.dispose());
	const origin = code('origin.lua');
	group.openEditor(origin);
	origin.context.view.cursorRow = 0; origin.context.view.cursorColumn = 1;
	const invocation = createNavigationEntry()!;
	const destination = code('destination.lua');
	let finish!: () => void;
	const gate = new Promise<void>(resolve => { finish = resolve; });
	const navigation = new EditorNavigationController(
		new WorkspaceSourceCatalog(),
		{ queuePendingSelection() {}, isVisible: () => false, focusTarget: inputFocus.createTarget(), isFocused: () => false } as unknown as ResourcePanelController,
		new ResourceEditorResolver([{ id: WORKBENCH_TEXT_EDITOR_ID, selector: { kind: 'all' },
			createEditorInput: async () => { await gate; return destination; } }]),
		group,
	);
	const focused = inputFocus.target;
	const pending = navigation.openResource(destination.workingCopy.resource);
	origin.context.view.cursorRow = 2; origin.context.view.cursorColumn = 3;
	const later = createNavigationEntry()!;
	t.after(() => { invocation.dispose(); later.dispose(); });
	assert.ok(inputFocus.target === focused, 'caret motion does not leave the concrete source control');
	assert.equal(areNavigationEntriesEqual(invocation, later), false);
	finish();
	assert.equal(await pending, group.panes.openGeneration);
	assert.ok(group.model.activeTab === destination);
	assert.equal(navigationState.back.length, 1);
	assert.equal(areNavigationEntriesEqual(navigationState.back[0], invocation), true);
	assert.equal(areNavigationEntriesEqual(navigationState.back[0], later), false);
});

for (const direction of ['back', 'forward'] as const) test(`invalid focused draft does not consume ${direction} navigation or leave its current view`, async t => {
	configureFontVariant('tiny');
	const group = createTestEditorGroup();
	t.after(initializeNavigationState(group));
	t.after(() => group.dispose());
	const first = code('first.lua'), second = code('second.lua');
	group.openEditor(first); group.openEditor(second);
	const catalog = new WorkspaceSourceCatalog();
	for (const [key, value] of new Map([first, second].map(input => [resourceIdentityKey(input.resource), input.workingCopy.resource]))) catalog.resourceByIdentity.set(key, value);
	const navigation = new EditorNavigationController(
		catalog,
		{ focusTarget: inputFocus.createTarget() } as ResourcePanelController,
		new ResourceEditorResolver([{ id: WORKBENCH_TEXT_EDITOR_ID, selector: { kind: 'all' },
			createEditorInput: resource => new CodeEditorInput(editorTextModelService.get(resource)!) }]), group);
	if (direction === 'forward') await navigation.goBackward();
	const current = group.model.activeTab, focus = inputFocus.target!;
	const back = [...navigationState.back], forward = [...navigationState.forward];
	let attempts = 0;
	focus.edit = { pending: true, commit() { attempts++; return false; } };
	t.after(() => { focus.edit = undefined; });
	if (direction === 'back') await navigation.goBackward(); else await navigation.goForward();
	assert.equal(attempts, 1);
	assert.ok(group.model.activeTab === current, 'failed validation preserves the admitted view');
	assert.ok(inputFocus.target === focus, 'the invalid draft keeps its actual focus');
	assert.equal(navigationState.back.length, back.length); assert.equal(navigationState.forward.length, forward.length);
	assert.ok(navigationState.back.every((entry, index) => entry === back[index]), 'Back retains its original owned destinations');
	assert.ok(navigationState.forward.every((entry, index) => entry === forward[index]), 'Forward retains its original owned destinations');
});

for (const direction of ['back', 'forward'] as const) test(`an invalid draft begun during ${direction} resolution retains the original destination for retry`, async t => {
	configureFontVariant('tiny');
	const group = createTestEditorGroup();
	t.after(initializeNavigationState(group));
	let control: ValueInput<number> | undefined;
	t.after(() => { control?.cancel(); inputFocus.setTarget(null); control?.dispose(); group.dispose(); });
	const first = code('first.lua'), second = code('second.lua');
	group.openEditor(first); group.openEditor(second);
	let blocked = false, finish!: () => void, rejectedCandidate: CodeEditorInput | undefined, retired = 0;
	const gate = new Promise<void>(resolve => { finish = resolve; });
	const catalog = new WorkspaceSourceCatalog();
	for (const [key, value] of new Map([first, second].map(input => [resourceIdentityKey(input.resource), input.workingCopy.resource]))) catalog.resourceByIdentity.set(key, value);
	const navigation = new EditorNavigationController(
		catalog,
		{ focusTarget: inputFocus.createTarget() } as ResourcePanelController,
		new ResourceEditorResolver([{ id: WORKBENCH_TEXT_EDITOR_ID, selector: { kind: 'all' },
			createEditorInput: async resource => {
				if (blocked) await gate;
				const candidate = new CodeEditorInput(editorTextModelService.get(resource)!);
				if (blocked && rejectedCandidate === undefined) {
					rejectedCandidate = candidate;
					candidate.onWillDispose(() => { retired += 1; });
				}
				return candidate;
			} }]), group);
	if (direction === 'forward') await navigation.goBackward();
	const current = direction === 'back' ? second : first, destination = direction === 'back' ? first : second;
	const back = [...navigationState.back], forward = [...navigationState.forward], target = navigationState[direction].at(-1)!;
	blocked = true;
	const pending = direction === 'back' ? navigation.goBackward() : navigation.goForward();
	let publications = 0;
	control = new ValueInput(inputFocus.target!, INTEGER_INPUT_FORMAT, value => {
		publications += 1;
		current.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: `-- value ${value}\n` }]);
	});
	control.setValue(1); control.field.focusTarget.focus(); setFieldText(control.field, '-', false);
	const focus = inputFocus.target;
	finish(); await pending;
	assert.equal(retired, 1); assert.equal(publications, 0);
	assert.ok(group.model.activeTab === current); assert.ok(group.panes.activePane?.input === current);
	assert.ok(inputFocus.target === focus); assert.equal(control.pending, true);
	assert.equal(target.isDisposed, false); assert.equal(target.selection!.isDisposed, false);
	assert.equal(navigationState.back.length, back.length); assert.equal(navigationState.forward.length, forward.length);
	assert.ok(navigationState.back.every((entry, index) => entry === back[index]));
	assert.ok(navigationState.forward.every((entry, index) => entry === forward[index]));
	setFieldText(control.field, '2', false);
	if (direction === 'back') await navigation.goBackward(); else await navigation.goForward();
	assert.equal(publications, 1); assert.equal(current.workingCopy.dirty, true);
	assert.ok(group.model.activeTab === destination); assert.ok(group.panes.activePane?.input === destination);
	assert.equal(target.isDisposed, true); assert.equal(navigationState[direction].includes(target), false);
});
