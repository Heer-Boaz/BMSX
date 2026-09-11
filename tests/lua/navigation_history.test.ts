import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NavigationHistoryEntry, areNavigationEntriesEqual, captureNavigation, createNavigationEntry, navigationState, pushUniqueNavigationEntry, resetNavigationHistoryState, takeBackwardNavigationEntry, takeForwardNavigationEntry } from '../../ide/navigation/navigation_history';
import { EditorPaneSelection } from '../../ide/workbench/services/editor/editor_selection';
import { EditorNavigationController } from '../../ide/workbench/contrib/resources/navigation';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import { setActiveTab } from '../../ide/workbench/ui/tabs';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import type { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import { ResourceEditorResolver } from '../../ide/workbench/services/editor/resource_editor_resolver';
import { createTestEditorPanes } from '../helpers/editor_panes';

class Location extends EditorPaneSelection {
	public constructor(public readonly value: number) { super(); }
	public matches(other: Location): boolean { return this.value === other.value; }
}
function entry(path: string, value: number): NavigationHistoryEntry {
	return new NavigationHistoryEntry({ kind: 'resource', resource: { domain: 0, path }, editorId: WORKBENCH_TEXT_EDITOR_ID }, new Location(value));
}
function code(path: string) {
	const model = new EditorTextModel({ domain: 0, path, source: { resid: path, type: 'lua' } }, 'lua', 'local before = 1\nlocal target = before\nreturn target\n');
	return new CodeEditorInput({ id: `code:0\0${path}`, title: path, model, view: createCodeEditorViewState(), runtimeErrorOverlay: null, executionStopRow: null });
}

test('Back/Forward preserve the live destination, not an earlier captured cursor', () => {
	resetNavigationHistoryState();
	const origin = entry('main.lua', 4);
	const current = entry('enemy.lua', 37);
	navigationState.back.push(origin);
	assert.equal(takeBackwardNavigationEntry(current), origin);
	assert.deepEqual(navigationState.forward, [current]);
	assert.equal(takeForwardNavigationEntry(origin), current);
	assert.deepEqual(navigationState.back, [origin]);
	current.dispose(); resetNavigationHistoryState();
});

test('bounded history owns disposal on duplicates, eviction, forward pruning and reset', () => {
	resetNavigationHistoryState();
	const first = entry('a.lua', 0); pushUniqueNavigationEntry(navigationState.back, first);
	const duplicate = entry('a.lua', 0); pushUniqueNavigationEntry(navigationState.back, duplicate);
	assert.equal(duplicate.selection!.isDisposed, true);
	assert.equal(first.selection!.isDisposed, false);
	for (let index = 1; index <= 64; index += 1) pushUniqueNavigationEntry(navigationState.back, entry('a.lua', index));
	assert.equal(navigationState.back.length, 64);
	assert.equal(first.selection!.isDisposed, true);
	const returned = takeBackwardNavigationEntry(entry('b.lua', 7))!;
	const forward = navigationState.forward[0];
	returned.dispose(); resetNavigationHistoryState();
	assert.equal(forward.selection!.isDisposed, true);
	const unused = entry('c.lua', 2);
	assert.equal(takeBackwardNavigationEntry(unused), null);
	assert.equal(unused.selection!.isDisposed, true);
});

test('input close removes visual destinations from both stacks; resource destinations stay reopenable', () => {
	resetNavigationHistoryState();
	const text = code('close.lua');
	const visual = new SceneEditorInput(text.workingCopy);
	const back = new NavigationHistoryEntry({ kind: 'input', input: visual }, new Location(1));
	const forward = new NavigationHistoryEntry({ kind: 'input', input: visual }, new Location(2));
	const resource = new NavigationHistoryEntry({ kind: 'resource', ...text.toResourceEditor() }, new CodeEditorNavigationSelection(text));
	navigationState.back.push(resource, back); navigationState.forward.push(forward);
	assert.equal(areNavigationEntriesEqual(back, resource), false, 'resource sharing is not view identity');
	visual.dispose(); text.dispose();
	assert.deepEqual(navigationState.back, [resource]); assert.equal(navigationState.forward.length, 0);
	assert.equal(back.selection!.isDisposed, true); assert.equal(forward.selection!.isDisposed, true);
	assert.equal(resource.selection!.isDisposed, false);
	resetNavigationHistoryState();
});

test('one explicit navigation records a departure before mutating the same retained input', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const panes = createTestEditorPanes();
	const input = code('same.lua'); editorTabGroup.initialize(input); panes.openEditor(input);
	t.after(() => { panes.dispose(); editorTabGroup.clear(); });
	const original = createNavigationEntry()!;
	captureNavigation(() => {
		input.context.view.cursorRow = 2;
		setActiveTab(panes, input.id);
	});
	assert.equal(navigationState.back.length, 1);
	assert.equal(areNavigationEntriesEqual(navigationState.back[0], original), true);
	original.dispose();
	const current = createNavigationEntry()!;
	const target = takeBackwardNavigationEntry(current)!;
	panes.openEditor(input, undefined, target.selection); target.dispose();
	const forward = navigationState.forward[0];
	captureNavigation(() => { input.context.view.cursorRow = 1; });
	assert.equal(navigationState.forward.length, 0);
	assert.equal(forward.selection!.isDisposed, true, 'a new navigation owns disposal of the abandoned branch');
});

test('history awaits the registered resource opener and restores a closed text input after hidden edits', async t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const panes = createTestEditorPanes();
	const origin = code('origin.lua'); editorTabGroup.initialize(origin); panes.openEditor(origin);
	const closed = code('target.lua'); closed.context.view.cursorRow = 1; closed.context.view.cursorColumn = 6;
	const selection = new CodeEditorNavigationSelection(closed);
	const target = new NavigationHistoryEntry({ kind: 'resource', ...closed.toResourceEditor() }, selection);
	navigationState.back.push(target); closed.dispose();
	const prefix = '-- 🐉 moved\n'; closed.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	const reopened = new CodeEditorInput({ ...closed.context, view: createCodeEditorViewState() });
	const resource = reopened.workingCopy.resource;
	let finishOpen!: () => void;
	const openGate = new Promise<void>(resolve => { finishOpen = resolve; });
	const navigation = new EditorNavigationController(
		{ resourceByIdentity: new Map([[`0\0${resource.path}`, resource]]) } as RuntimeSourceState,
		{ isFocused: () => false } as ResourcePanelController,
		new ResourceEditorResolver([{
			id: WORKBENCH_TEXT_EDITOR_ID, selector: { kind: 'all' }, createEditorInput: async actual => {
				assert.equal(actual, resource); await openGate; return reopened;
			},
		}]), panes,
	);
	t.after(() => { panes.dispose(); editorTabGroup.clear(); });
	const version = reopened.workingCopy.version;
	const pending = navigation.goBackward();
	assert.equal(navigationState.captureSuspendDepth, 1);
	assert.equal(editorTabGroup.activeTab, origin);
	finishOpen(); await pending;
	assert.equal(navigationState.captureSuspendDepth, 0);
	assert.equal(editorTabGroup.activeTab, reopened);
	assert.equal(reopened.context.view.cursorRow, 2); assert.equal(reopened.context.view.cursorColumn, 6);
	assert.equal(reopened.workingCopy.version, version);
	assert.equal(selection.isDisposed, true);
	assert.equal(navigationState.forward.length, 1);
});

test('Back activates a surviving visual preview without turning navigation into Keep Open', async t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const panes = createTestEditorPanes();
	const origin = code('origin.lua'); editorTabGroup.initialize(origin); panes.openEditor(origin);
	const visual = new SceneEditorInput(origin.workingCopy);
	editorTabGroup.add(visual, { pinned: false });
	const target = new NavigationHistoryEntry({ kind: 'input', input: visual }, new Location(1));
	navigationState.back.push(target);
	const navigation = new EditorNavigationController(
		{} as RuntimeSourceState, { isFocused: () => false } as ResourcePanelController,
		new ResourceEditorResolver([]), panes,
	);
	t.after(() => { panes.dispose(); editorTabGroup.clear(); origin.workingCopy.dispose(); });
	await navigation.goBackward();
	assert.equal(editorTabGroup.activeTab, visual);
	assert.equal(editorTabGroup.previewTab, visual);
	assert.equal(editorTabGroup.tabs.length, 2);
	assert.equal(origin.workingCopy.dirty, false);
	assert.equal(navigationState.forward.length, 1);
});
