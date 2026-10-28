import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { NavigationHistoryEntry, navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import type { EditorMoveDestination } from '../../ide/workbench/services/editor/editor_parts';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import type { RectBounds } from '../../machine/ts/common/rect';
import { createActualSourcePanes } from '../helpers/source_panes';

type Fixture = ReturnType<typeof createActualSourcePanes>;
type Point = { x: number; y: number };
type MoveItem = QuickPickItem & { readonly destination: EditorMoveDestination };
const EXTRA_SOURCES = [['third.lua', 'local gamma = 3\nreturn gamma\n']] as const;

function center(bounds: Readonly<RectBounds>): Point {
	return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
}

function bodyPoint(group: EditorGroupView, edge?: 'left' | 'right' | 'up' | 'down'): Point {
	const body = group.panes.contentBounds, clip = group.clip;
	const bounds = { left: Math.max(body.left, clip.left), top: Math.max(body.top, clip.top),
		right: Math.min(body.right, clip.right), bottom: Math.min(body.bottom, clip.bottom) };
	const point = center(bounds);
	if (edge === 'left') point.x = bounds.left + 1;
	else if (edge === 'right') point.x = bounds.right - 1;
	else if (edge === 'up') point.y = bounds.top + 1;
	else if (edge === 'down') point.y = bounds.bottom - 1;
	return point;
}

function dispatch(f: Fixture, point: Point, phase: 'down' | 'move' | 'up', modifiers = KeyModifier.none): void {
	f.host.clock.advance(10);
	f.editor.dispatchPointer({ ...point, buttons: phase === 'up' ? 0 : PointerButton.Primary,
		pressedButtons: phase === 'down' ? PointerButton.Primary : 0, releasedButtons: phase === 'up' ? PointerButton.Primary : 0,
		cancelledButtons: 0, modifiers, spaceDown: false, timestamp: f.host.clock.now() });
}

/** The real blank strip produces the group payload; no direct gesture or transfer injection. */
function beginGroupDrag(f: Fixture, source: EditorGroupView): void {
	source.focus(); f.editor.update(0);
	const layout = source.tabStrip.layoutState, last = layout.items.peek(layout.items.length - 1);
	const start = center(layout.viewportBounds);
	const afterTabs = Math.max(last.bounds.right, layout.viewportBounds.left);
	assert.ok(afterTabs < layout.viewportBounds.right, 'this fixture presents an actual unoccupied strip lane');
	start.x = (afterTabs + layout.viewportBounds.right) / 2;
	dispatch(f, start, 'down');
	const gesture = source.tabStrip.drag.state;
	assert.ok(pointerCapture.active && gesture?.source.kind === 'group' && gesture.source.model === source.model);
}

function openThird(f: Fixture, group: EditorGroupView): CodeEditorInput {
	const input = resolveLuaCodeEditorInput(f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'third.lua' })!);
	const opened = group.openEditor(input, { pinned: false });
	assert.ok(opened !== undefined); assert.equal(opened.activated, true); assert.equal(opened.generation, group.panes.openGeneration);
	assert.ok(group.panes.activePane?.input === input);
	f.editor.update(0);
	return input;
}

function chooseDestination(f: Fixture, choose: (destination: EditorMoveDestination) => boolean): void {
	const picker = f.editor.quickInput;
	const index = picker.model.list.rows.findIndex(row => choose((row.item as MoveItem).destination));
	assert.ok(index >= 0, 'the chooser retains the requested actual destination');
	f.key('Home', KeyModifier.ctrl);
	for (let row = 0; row < index; row++) f.key('ArrowDown');
	assert.equal(picker.model.list.selectionIndex, index);
}

test('a blank-strip group drag merges every retained Source into the released receiver and retires the old window', t => {
	const f = createActualSourcePanes(t, false, EXTRA_SOURCES), parts = f.editor.editorParts, source = f.firstGroup, receiver = f.secondGroup;
	const third = openThird(f, source), text = f.firstInput.workingCopy.buffer.getText();
	let disposed = 0; f.firstInput.onWillDispose(() => { disposed++; }); third.onWillDispose(() => { disposed++; });
	beginGroupDrag(f, source);
	const destination = bodyPoint(receiver);
	dispatch(f, destination, 'move');
	assert.ok(source.model.tabs[0] === f.firstInput && source.model.tabs[1] === third);
	assert.ok(source.model.previewTab === third && receiver.model.activeTab === f.secondInput);
	dispatch(f, destination, 'up');
	assert.ok(receiver.model.tabs[0] === f.secondInput && receiver.model.tabs[1] === f.firstInput && receiver.model.tabs[2] === third);
	assert.ok(receiver.model.activeTab === third && receiver.model.previewTab === third && receiver.panes.activePane?.input === third);
	assert.equal(disposed, 0); assert.equal(f.firstPart.retired, true); assert.equal(source.surface.retired, true);
	assert.equal(source.focus(), false); assert.equal(parts.documents.length, 1);
	assert.equal(f.editor.surfaces.findByScope(source.captureScope), undefined);
	assert.equal(f.firstInput.workingCopy.buffer.getText(), text);
	assert.ok(parts.activeGroup === receiver && inputFocus.target === receiver.panes.activePane!.commandTarget);
});

test('same-part group docking retains the exact controls and scopes and does not supersede an awaiting Source opening', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main, source = main.activeGroup;
	const retained = new CodeEditorInput(f.firstInput.workingCopy); source.openEditor(retained);
	const reference = parts.splitGroup(source, 'right'); assert.ok(reference);
	reference.openEditor(new CodeEditorInput(f.secondInput.workingCopy)); main.focus(); f.editor.update(0);
	const resolution = Promise.withResolvers<CodeEditorInput>(), candidate = new CodeEditorInput(f.secondInput.workingCopy);
	const pending = source.openResolvedEditor(() => resolution.promise), generation = source.panes.openGeneration;
	const scope = source.focusScope, tabScope = source.tabScope, surface = source.surface, pane = source.panes.activePane;
	beginGroupDrag(f, source);
	const destination = bodyPoint(reference, 'down'); dispatch(f, destination, 'move'); dispatch(f, destination, 'up');
	assert.equal(main.groups.length, 2); assert.ok(parts.partForGroup(source) === main && main.groups.includes(source));
	assert.ok(source.focusScope === scope && source.tabScope === tabScope && source.surface === surface && source.panes.activePane === pane);
	assert.equal(source.panes.openGeneration, generation); assert.equal(source.surface.retired, false);
	resolution.resolve(candidate);
	assert.ok(await pending); assert.ok(source.model.activeTab === candidate && source.panes.activePane?.input === candidate);
	assert.ok(source.model.contains(retained)); assert.equal(parts.documents.length, 2);
});

test('cross-part group split retains all input and view identities while replacing the old control authority', t => {
	const f = createActualSourcePanes(t, false, EXTRA_SOURCES), parts = f.editor.editorParts, source = f.firstGroup;
	const third = openThird(f, source);
	third.context.view.cursorRow = 1; third.context.view.cursorColumn = 5; third.context.view.selectionAnchor = { row: 1, column: 1 };
	const reading = captureCodeEditorView(third), oldScope = source.focusScope;
	let retired = false; const unbind = oldScope.onDidRetireContext(() => { retired = true; }); t.after(unbind);
	beginGroupDrag(f, source);
	const destination = bodyPoint(f.secondGroup, 'right'); dispatch(f, destination, 'move'); dispatch(f, destination, 'up');
	const receiver = parts.findGroup(third);
	assert.ok(receiver !== undefined && receiver !== source && receiver !== f.secondGroup);
	assert.ok(parts.partForGroup(receiver) === f.secondPart);
	assert.ok(receiver.model.tabs[0] === f.firstInput && receiver.model.tabs[1] === third);
	assert.ok(receiver.model.activeTab === third && receiver.model.previewTab === third && receiver.panes.activePane?.input === third);
	assert.ok(receiver.focusScope !== oldScope); assert.equal(retired, true); assert.equal(source.surface.retired, true); assert.equal(f.firstPart.retired, true);
	assert.equal(f.secondPart.groups.length, 2); assert.equal(parts.documents.length, 1);
	assert.deepEqual(captureCodeEditorView(third), reading);
});

test('coalesced group merge retargets every history entry before retiring duplicate inputs and the source host', async t => {
	const f = createActualSourcePanes(t, true, EXTRA_SOURCES), source = f.firstGroup, receiver = f.secondGroup;
	const shared = f.secondInput.workingCopy; assert.equal(await receiver.close(f.secondInput.id), true);
	const existing = new CodeEditorInput(shared); receiver.openEditor(existing, { pinned: false });
	const third = openThird(f, source);
	resetNavigationHistoryState(); t.after(resetNavigationHistoryState);
	const firstEntry = new NavigationHistoryEntry({ kind: 'input', input: f.firstInput }, new CodeEditorNavigationSelection(f.firstInput), source);
	const thirdEntry = new NavigationHistoryEntry({ kind: 'input', input: third }, new CodeEditorNavigationSelection(third), source);
	navigationState.back.push(firstEntry, thirdEntry);
	let duplicateDisposed = 0; f.firstInput.onWillDispose(() => { duplicateDisposed++; });
	beginGroupDrag(f, source);
	const destination = bodyPoint(receiver); dispatch(f, destination, 'move'); dispatch(f, destination, 'up');
	assert.equal(duplicateDisposed, 1); assert.equal(f.firstPart.retired, true);
	assert.ok(receiver.model.tabs[0] === existing && receiver.model.tabs[1] === third);
	assert.ok(receiver.model.activeTab === third && receiver.model.previewTab === existing, 'the existing receiver preview owns the conflict');
	assert.ok(firstEntry.owner === receiver && firstEntry.target.kind === 'input' && firstEntry.target.input === existing);
	assert.ok(thirdEntry.owner === receiver && thirdEntry.target.kind === 'input' && thirdEntry.target.input === third);
	assert.equal(firstEntry.isDisposed, false); assert.equal(thirdEntry.isDisposed, false);
	assert.ok(navigationState.back.includes(firstEntry) && navigationState.back.includes(thirdEntry));
});

test('Move Group chooser retains its invoking group and cancellation changes no membership or focus authority', t => {
	const f = createActualSourcePanes(t, false, EXTRA_SOURCES), parts = f.editor.editorParts, source = f.firstGroup;
	const third = openThird(f, source), origin = source.panes.activePane!.commandTarget;
	source.focus(); const windows = [...parts.documents], groups = [...parts.groups], generation = source.panes.openGeneration;
	f.editor.commands.execute('group.move', origin);
	const picker = f.editor.quickInput; assert.equal(picker.visible, true); assert.ok(picker.invocationOrigin === origin);
	for (const direction of ['left', 'right', 'up', 'down'] as const) assert.ok(picker.model.list.rows.some(row => {
		const destination = (row.item as MoveItem).destination;
		return destination.kind === 'split' && destination.group === f.secondGroup && destination.direction === direction;
	}));
	chooseDestination(f, destination => destination.kind === 'window'); f.key('Escape');
	assert.equal(picker.visible, false); assert.ok(inputFocus.target === origin);
	assert.equal(parts.documents.length, windows.length); assert.ok(parts.documents.every((part, index) => part === windows[index]));
	assert.ok(parts.groups.every((group, index) => group === groups[index])); assert.equal(source.panes.openGeneration, generation);
	assert.ok(source.model.tabs[0] === f.firstInput && source.model.tabs[1] === third && source.model.activeTab === third && source.model.previewTab === third);
});

test('Move Group to a new window retains the complete Main group selection and preview and creates one fresh Main route', t => {
	const f = createActualSourcePanes(t, false, EXTRA_SOURCES), parts = f.editor.editorParts, source = parts.main.activeGroup;
	const first = new CodeEditorInput(f.firstInput.workingCopy); source.openEditor(first);
	const third = openThird(f, source); source.focus();
	const windows = parts.documents.length, origin = source.panes.activePane!.commandTarget;
	f.editor.commands.execute('group.move', origin); chooseDestination(f, destination => destination.kind === 'window'); f.key('Enter');
	const receiver = parts.findGroup(third);
	assert.ok(receiver !== undefined && receiver !== source && parts.partForGroup(receiver).kind === 'document');
	assert.ok(receiver.model.tabs[0] === first && receiver.model.tabs[1] === third && receiver.model.activeTab === third && receiver.model.previewTab === third);
	assert.equal(source.surface.retired, true); assert.equal(parts.main.retired, false); assert.equal(parts.main.groups.length, 1);
	assert.ok(parts.main.activeGroup !== source); assert.equal(parts.main.activeGroup.model.tabs.length, 0);
	assert.equal(parts.documents.length, windows + 1); assert.ok(parts.activeGroup === receiver);
});

test('Move Group chooser performs a same-part directional relocation rather than moving only its active tab', t => {
	const f = createActualSourcePanes(t, false, EXTRA_SOURCES), parts = f.editor.editorParts, source = parts.main.activeGroup;
	const first = new CodeEditorInput(f.firstInput.workingCopy); source.openEditor(first); const third = openThird(f, source);
	const reference = parts.splitGroup(source, 'right'); assert.ok(reference); reference.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
	source.focus(); const scope = source.focusScope, generation = source.panes.openGeneration;
	f.editor.commands.execute('group.move', source.panes.activePane!.commandTarget);
	chooseDestination(f, destination => destination.kind === 'split' && destination.group === reference && destination.direction === 'down'); f.key('Enter');
	assert.equal(parts.main.groups.length, 2); assert.ok(parts.partForGroup(source) === parts.main && source.focusScope === scope);
	assert.ok(source.model.tabs[0] === first && source.model.tabs[1] === third && source.model.previewTab === third);
	assert.equal(source.panes.openGeneration, generation); assert.equal(source.surface.retired, false); assert.equal(parts.documents.length, 2);
});

test('release-time Alt floats the whole captured group instead of accepting the preceding merge feedback', t => {
	const f = createActualSourcePanes(t, false, EXTRA_SOURCES), parts = f.editor.editorParts, source = f.firstGroup;
	const third = openThird(f, source); beginGroupDrag(f, source);
	const destination = bodyPoint(f.secondGroup); dispatch(f, destination, 'move'); dispatch(f, destination, 'up', KeyModifier.alt);
	const receiver = parts.findGroup(third);
	assert.ok(receiver !== undefined && receiver !== source && receiver !== f.secondGroup);
	assert.ok(parts.partForGroup(receiver) !== f.firstPart && parts.partForGroup(receiver) !== f.secondPart);
	assert.ok(receiver.model.tabs[0] === f.firstInput && receiver.model.tabs[1] === third && receiver.model.previewTab === third);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput); assert.equal(f.secondGroup.model.tabs.length, 1);
	assert.equal(f.firstPart.retired, true); assert.equal(parts.documents.length, 2);
});

test('cancelling a captured group gesture preserves every source identity, preview and topology', t => {
	const f = createActualSourcePanes(t, false, EXTRA_SOURCES), parts = f.editor.editorParts, source = f.firstGroup;
	const third = openThird(f, source), groups = [...parts.groups], documents = [...parts.documents]; beginGroupDrag(f, source);
	const destination = bodyPoint(f.secondGroup, 'down'); dispatch(f, destination, 'move');
	f.editor.cancelPointerInput(); dispatch(f, destination, 'up');
	assert.equal(pointerCapture.active, false); assert.equal(source.tabStrip.drag.state, null);
	assert.ok(parts.groups.every((group, index) => group === groups[index]) && parts.groups.length === groups.length);
	assert.ok(parts.documents.every((part, index) => part === documents[index]) && parts.documents.length === documents.length);
	assert.ok(source.model.tabs[0] === f.firstInput && source.model.tabs[1] === third && source.model.activeTab === third && source.model.previewTab === third);
	assert.equal(f.firstPart.retired, false); assert.equal(f.secondPart.groups.length, 1);
});
