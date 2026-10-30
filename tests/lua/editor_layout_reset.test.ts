import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { RomInspectorInput } from '../../ide/workbench/contrib/rom_inspector/editor_input';
import { workbenchWindowForSurface } from '../../ide/workbench/ui/window/control';
import type { SerializedEditorGroupLayout, SerializedEditorParts } from '../../ide/workbench/services/editor/editor_parts_serialization';
import { createRomInspectorImageSnapshot } from '../fixtures/studio/rom_inspector';
import { createActualSourcePanes } from '../helpers/source_panes';

test('editor layout reset retains exact part topology, duplicate views, nonportable inputs and dirty canonical history', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const duplicate = new CodeEditorInput(f.firstInput.workingCopy), diagnostic = new HostErrorInput('retained diagnostic');
	parts.main.activeGroup.openEditor(duplicate);
	f.firstGroup.openEditor(diagnostic); f.firstGroup.activate(f.firstInput.id);
	const split = parts.splitGroup(f.firstGroup, 'right')!;
	split.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
	parts.splitGroup(split, 'down')!.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	f.first.focus();
	f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained source edit\n' }]);
	const documentParts = [...parts.documents], groupList = [...parts.groups], mru = [...parts.mostRecentlyActive];
	const owners = [parts.main, ...documentParts].map(part => ({ part, root: part.arrangement.root,
		topology: part.arrangement.topologyRevision, groups: [...part.groups], active: part.activeGroup,
		tabs: part.groups.map(group => [...group.model.tabs]), inputs: part.groups.map(group => group.model.activeTab),
		panes: part.groups.map(group => group.panes.activePane), generations: part.groups.map(group => group.panes.openGeneration) }));
	const active = parts.activePart, focused = inputFocus.admittedTarget, source = f.firstInput.workingCopy.buffer.getText();
	for (const { part } of owners) {
		for (const branch of part.arrangement.splits) branch.split.ratio = 0.8;
		part.arrangement.toggleMaximize(part.activeGroup);
		part.window?.resetPlacement();
	}
	assert.equal(parts.captureLayoutReset().reset(), true);
	assert.ok(parts.activePart === active && inputFocus.admittedTarget === focused);
	assert.ok(parts.documents.length === documentParts.length && documentParts.every((part, index) => parts.documents[index] === part));
	assert.ok(parts.groups.length === groupList.length && groupList.every((group, index) => parts.groups[index] === group));
	assert.ok(mru.every((part, index) => parts.mostRecentlyActive[index] === part));
	for (const owner of owners) {
		const part = owner.part;
		assert.ok(part.arrangement.root === owner.root && part.activeGroup === owner.active);
		assert.equal(part.arrangement.topologyRevision, owner.topology); assert.equal(part.arrangement.maximized, undefined);
		assert.ok(part.groups.length === owner.groups.length && owner.groups.every((group, index) => part.groups[index] === group));
		for (let index = 0; index < part.groups.length; index++) {
			const group = part.groups[index];
			assert.ok(group.model.tabs.length === owner.tabs[index].length && owner.tabs[index].every((input, tab) => group.model.tabs[tab] === input));
			assert.ok(group.model.activeTab === owner.inputs[index] && group.panes.activePane === owner.panes[index]);
			assert.equal(group.panes.openGeneration, owner.generations[index]);
		}
		if (part.window !== undefined) {
			assert.equal(part.window.model.placementInitialized, true); assert.equal(part.window.model.placement, 'normal');
			assert.equal(part.window.model.minimized, false);
		}
	}
	assert.equal(f.firstInput.workingCopy.buffer.getText(), source); assert.equal(f.firstInput.workingCopy.dirty, true);
	assert.equal(f.firstInput.workingCopy.canUndo, true); f.firstInput.workingCopy.undo();
	assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source);
});

test('editor reset preserves newer native focus published by document default placement without aborting the other geometry', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.first.focus();
	for (const part of parts.documents) part.window!.resetPlacement();
	let published = false;
	const release = f.firstPart.window!.model.onDidChangePlacement(() => { release(); published = true; f.second.focus(); });
	t.after(release);
	assert.equal(parts.captureLayoutReset().reset(), true);
	assert.equal(published, true); assert.ok(inputFocus.admittedTarget === f.second.code.focusTarget && parts.activePart === f.secondPart);
	assert.equal(f.firstPart.window!.model.placementInitialized, true); assert.equal(f.secondPart.window!.model.placementInitialized, true);
});

test('a document admitted during reset placement retains its explicit request and supersedes the older reset target set', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	for (const part of parts.documents) part.window!.resetPlacement();
	const bounds = { left: 40, top: 50, right: 240, bottom: 180 };
	let newer: ReturnType<typeof parts.createDocument> | undefined;
	const release = f.firstPart.window!.model.onDidChangePlacement(() => { release(); newer = parts.createDocument({ requestedBounds: bounds }); });
	t.after(release);
	assert.equal(parts.captureLayoutReset().reset(), false); assert.ok(newer !== undefined && parts.documents.includes(newer));
	// Requested placement is this owner algorithm's output, not a screenshot coordinate assertion.
	assert.deepEqual(newer.window!.model.requestedBounds, bounds);
	assert.equal(f.secondPart.window!.model.placementInitialized, false);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

test('a prepared layout reset cannot acquire a document admitted before its execution', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = parts.captureLayoutReset();
	const first = { ...f.firstPart.window!.model.requestedBounds };
	const newer = parts.createDocument({ placement: 'maximized', requestedBounds: { left: 40, top: 50, right: 240, bottom: 180 } });
	assert.equal(request.isCurrent(), false); assert.equal(request.reset(), false);
	assert.equal(newer.window!.model.placement, 'maximized');
	assert.deepEqual(f.firstPart.window!.model.requestedBounds, first);
});

test('a newer later-document placement published by an earlier reset target is not overwritten', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = parts.captureLayoutReset();
	const bounds = { left: 40, top: 50, right: 240, bottom: 180 };
	const release = f.firstPart.window!.model.onDidChangePlacement(() => {
		release(); f.secondPart.window!.model.setState({ requestedBounds: bounds, placement: 'maximized', minimized: false });
	}); t.after(release);
	assert.equal(request.reset(), false);
	assert.equal(f.secondPart.window!.model.placement, 'maximized');
	assert.deepEqual(f.secondPart.window!.model.requestedBounds, bounds);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

test('a newer same-document placement callback keeps its own request instead of becoming the reset receipt', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = parts.captureLayoutReset();
	const bounds = { left: 40, top: 50, right: 240, bottom: 180 };
	const release = f.firstPart.window!.model.onDidChangePlacement(() => {
		release(); f.firstPart.window!.model.setState({ requestedBounds: bounds, placement: 'maximized', minimized: false });
	}); t.after(release);
	assert.equal(request.reset(), false);
	assert.equal(f.firstPart.window!.model.placement, 'maximized');
	assert.deepEqual(f.firstPart.window!.model.requestedBounds, bounds);
});

test('a prepared editor reset cannot overwrite a newer later-part ratio published by an earlier window owner', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	parts.splitGroup(f.secondGroup, 'right')!.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const branch = f.secondPart.arrangement.splits[0], request = parts.captureLayoutReset();
	const release = f.firstPart.window!.model.onDidChangePlacement(() => { release(); branch.split.ratio = 0.7; }); t.after(release);
	assert.equal(request.reset(), false); assert.equal(branch.split.ratio, 0.7);
	assert.ok(f.secondPart.arrangement.splits[0] === branch && f.secondGroup.model.activeTab === f.secondInput);
});

test('retained inactive inspector inputs mark every model pending while preserving closed/open intent and subjects', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const input = new RomInspectorInput(createRomInspectorImageSnapshot(-1, f.sources.systemContextId));
	f.firstGroup.model.add(input);
	input.keyWindow.setRequestedBounds({ left: 0, top: 0, right: 100, bottom: 100 });
	input.readerWindow.setRequestedBounds({ left: 20, top: 20, right: 120, bottom: 120 });
	input.readerWindow.open = true; input.readerHeld = true;
	const snapshot = input.snapshot, reader = input.reader;
	assert.equal(parts.captureLayoutReset().reset(), true);
	assert.equal(input.keyWindow.placementInitialized, false); assert.equal(input.readerWindow.placementInitialized, false);
	assert.equal(input.keyWindow.open, false); assert.equal(input.readerWindow.open, true); assert.equal(input.readerHeld, true);
	assert.ok(input.snapshot === snapshot && input.reader === reader && f.firstGroup.model.contains(input));
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('retained attached utility windows reset through their actual native controller and drain only their chrome gesture', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const input = new RomInspectorInput(createRomInspectorImageSnapshot(-1, f.sources.systemContextId));
	f.firstGroup.openEditor(input); input.keyWindow.open = true; f.editor.update(0);
	const window = [...f.editor.surfaces.windowSurfaces].map(workbenchWindowForSurface).find(window => window?.model === input.keyWindow)!;
	assert.ok(window !== undefined); window.show(); f.editor.update(0);
	const pane = f.firstGroup.panes.activePane, snapshot = input.snapshot;
	const reset = t.mock.method(window, 'resetPlacement');
	const header = input.keyWindow.header, x = header.left + 8, y = (header.top + header.bottom) / 2;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(pointerCapture.active, true);
	assert.equal(parts.captureLayoutReset().reset(), true); assert.equal(reset.mock.callCount(), 1);
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	assert.equal(input.keyWindow.placementInitialized, false); assert.equal(input.keyWindow.open, true);
	assert.ok(input.snapshot === snapshot && f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
	f.editor.dispatchPointer({ x: x + 100, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(pointerCapture.draining, false); assert.equal(input.keyWindow.placementInitialized, false);
});

test('resetting retained editor sashes drains an active physical resize without reopening or refocusing source panes', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.editor.updateViewport({ width: 1400, height: 800 });
	f.firstPart.window!.model.setRequestedBounds({ left: 0, top: 32, right: 1100, bottom: 700 });
	const split = parts.splitGroup(f.firstGroup, 'right')!; split.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
	f.firstPart.raise(); f.editor.update(0); f.first.focus();
	const branch = f.firstPart.arrangement.splits[0], pane = f.firstGroup.panes.activePane, target = inputFocus.admittedTarget;
	assert.equal(branch.resizable, true); branch.split.ratio = 0.7; f.editor.update(0);
	const bounds = branch.sashBounds, x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(pointerCapture.active, true);
	assert.equal(parts.captureLayoutReset().reset(), true);
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	assert.equal(branch.split.ratio, branch.split.defaultRatio);
	assert.ok(inputFocus.admittedTarget === target && f.firstGroup.panes.activePane === pane);
	f.editor.dispatchPointer({ x: x + 100, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(pointerCapture.draining, false); assert.equal(branch.split.ratio, branch.split.defaultRatio);
});

test('a newer editor split request from sash return-focus supersedes the reset that canceled its keyboard interaction', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.editor.updateViewport({ width: 1400, height: 800 });
	f.firstPart.window!.model.setRequestedBounds({ left: 0, top: 32, right: 1100, bottom: 700 });
	const split = parts.splitGroup(f.firstGroup, 'right')!; split.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
	f.firstPart.raise(); f.editor.update(0); f.first.focus();
	const branch = f.firstPart.arrangement.splits[0], control = f.firstPart.resizeControlForGroup(f.firstGroup, 'width')!;
	assert.equal(control.focusForResize(f.first.code.focusTarget), true);
	branch.split.ratio = 0.8;
	const request = parts.captureLayoutReset(); let returned = false;
	const release = inputFocus.onDidChangeTarget(() => {
		if (inputFocus.admittedTarget !== f.first.code.focusTarget) return;
		release(); returned = true; branch.split.ratio = 0.7;
	}); t.after(release);
	assert.equal(request.reset(), false); assert.equal(returned, true);
	assert.equal(branch.split.ratio, 0.7); assert.equal(control.interactionActive, false);
	assert.ok(inputFocus.admittedTarget === f.first.code.focusTarget);
});

test('repeated document default materialization is deterministic without changing retained input or pane ownership', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	for (const part of parts.documents) part.window!.resetPlacement();
	assert.equal(parts.captureLayoutReset().reset(), true);
	const placements = parts.documents.map(part => ({ ...part.window!.model.requestedBounds }));
	const first = f.firstGroup.panes.activePane, second = f.secondGroup.panes.activePane;
	for (const part of parts.documents) part.window!.resetPlacement();
	assert.equal(parts.captureLayoutReset().reset(), true);
	// Exact repeated placement is the shared document-default producer's deterministic contract.
	assert.deepEqual(parts.documents.map(part => part.window!.model.requestedBounds), placements);
	assert.ok(f.firstGroup.panes.activePane === first && f.secondGroup.panes.activePane === second);
});

test('pure document layout reset does not revoke an independently pending input admission', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, ready = Promise.withResolvers<HostErrorInput>();
	const group = f.firstGroup, pending = group.openResolvedEditor(() => ready.promise, { preserveFocus: true });
	const generation = group.panes.openGeneration;
	assert.equal(parts.captureLayoutReset().reset(), true); assert.equal(group.panes.openGeneration, generation);
	const input = new HostErrorInput('asynchronously admitted diagnostic'); ready.resolve(input);
	assert.ok(await pending !== undefined); assert.ok(group.model.activeTab === input && group.panes.activePane?.input === input);
	assert.ok(parts.documents.includes(f.firstPart));
});

test('an older asynchronous document recovery restores its inputs without reapplying geometry superseded by Reset Layout', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, ready = Promise.withResolvers<HomeInput>(), entered = Promise.withResolvers<void>();
	const first = new HomeInput(null), second = new HomeInput(null), document = new HomeInput(null);
	const serializers = { ...f.editor.editorInputSerializers,
		home: { serialize: () => '', deserialize: (value: string) => {
			if (value === 'wait') { entered.resolve(); return ready.promise; }
			return value === 'first' ? first : document;
		} } };
	const leaf = (value: string): SerializedEditorGroupLayout => ({ kind: 'group', group: { inputs: [{ kind: 'home', value }], active: 0, preview: null } });
	const state: SerializedEditorParts = {
		main: { layout: { kind: 'split', orientation: 'horizontal', ratio: 0.8, first: leaf('first'), second: leaf('wait') },
			active: 0, mru: [0, 1], scrollX: 40, scrollY: 20, maximized: { group: 0, scrollX: 30, scrollY: 10 } },
		documents: [{ layout: leaf('document'), active: 0, mru: [0], scrollX: 0, scrollY: 0,
			requestedBounds: { left: 15, top: 25, right: 315, bottom: 225 }, placement: 'left', minimized: true }],
		active: 0, mru: [0, 1],
	};
	const request = parts.beginRestore(); assert.equal(request.prepare(), true);
	const restoring = request.restore(state, serializers, { preserveFocus: true });
	await entered.promise;
	try {
		assert.equal(parts.captureLayoutReset().reset(), true); ready.resolve(second);
		assert.equal(await restoring, true);
		assert.ok(parts.main.groups.length === 2 && parts.main.groups[0].model.activeTab === first && parts.main.groups[1].model.activeTab === second);
		assert.ok(parts.documents.length === 1 && parts.documents[0].activeGroup.model.activeTab === document);
		assert.equal(parts.main.arrangement.splits[0].split.ratio, 0.5); assert.equal(parts.main.arrangement.maximized, undefined);
		assert.equal(parts.main.arrangement.scrollX, 0); assert.equal(parts.main.arrangement.scrollY, 0);
		const window = parts.documents[0].window!;
		assert.equal(window.model.placement, 'normal'); assert.equal(window.model.minimized, false); assert.equal(window.model.placementInitialized, true);
	} finally { ready.resolve(second); request.dispose(); }
});

test('late recovered input utility models lose old geometry authority without opening or replacing their subject', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, ready = Promise.withResolvers<HomeInput>(), entered = Promise.withResolvers<void>();
	const actor = f.editor.actorLab.resolveInput(), home = new HomeInput(null);
	actor.detailsWindow.setState({ requestedBounds: { left: 15, top: 25, right: 315, bottom: 225 }, placement: 'right', minimized: true });
	const serializers = { ...f.editor.editorInputSerializers, home: { serialize: () => '', deserialize: () => { entered.resolve(); return ready.promise; } },
		actor_lab: { serialize: () => '', deserialize: () => actor } };
	const state: SerializedEditorParts = {
		main: { layout: { kind: 'group', group: { inputs: [{ kind: 'home', value: '' }], active: 0, preview: null } }, active: 0, mru: [0], scrollX: 0, scrollY: 0 },
		documents: [{ layout: { kind: 'group', group: { inputs: [{ kind: 'actor_lab', value: '' }], active: 0, preview: null } },
			active: 0, mru: [0], scrollX: 0, scrollY: 0, requestedBounds: { left: 15, top: 25, right: 315, bottom: 225 }, placement: 'normal', minimized: false }],
		active: 0, mru: [0, 1],
	};
	const request = parts.beginRestore(); assert.equal(request.prepare(), true);
	const restoring = request.restore(state, serializers, { preserveFocus: true }); await entered.promise;
	try {
		assert.equal(parts.captureLayoutReset().reset(), true); ready.resolve(home); assert.equal(await restoring, true);
		assert.ok(parts.documents[0].activeGroup.model.activeTab === actor);
		assert.equal(actor.detailsWindow.placement, 'normal'); assert.equal(actor.detailsWindow.minimized, false);
		assert.equal(actor.detailsWindow.placementInitialized, false); assert.equal(actor.detailsWindow.open, false);
	} finally { ready.resolve(home); request.dispose(); }
});
