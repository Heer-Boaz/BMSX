import assert from 'node:assert/strict';
import test from 'node:test';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { findEditorGroup } from '../../ide/workbench/services/editor/editor_group';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

test('reserving document recovery retains its published groups, controls and inputs until explicit preparation', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	parts.main.activeGroup.openEditor(new HomeInput(null));
	const main = parts.main.activeGroup, inputs = [...main.model.tabs], documents = [...parts.documents];
	let changes = 0, retirements = 0;
	const unbind = parts.onDidChange(() => { changes++; }); t.after(unbind);
	for (const input of inputs) input.onWillDispose(() => { retirements++; });
	const request = parts.beginRestore(); t.after(() => request.dispose());
	assert.equal(request.isCurrent(), true);
	assert.ok(parts.main.activeGroup === main && parts.main.activeGroup.panes.activePane?.input === inputs[0]);
	assert.deepEqual(parts.documents, documents);
	assert.equal(changes, 0); assert.equal(retirements, 0);
});

test('document preparation publishes a fresh routing group and retires only its captured groups before old input callbacks', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const previous = parts.main.activeGroup;
	previous.openEditor(new HomeInput(null));
	const state = parts.serialize(f.editor.editorInputSerializers), departing = [...parts.groups];
	const request = parts.beginRestore(); t.after(() => request.dispose());
	let incoming: HomeInput | undefined;
	previous.model.activeTab!.onWillDispose(() => {
		assert.ok(parts.main.activeGroup !== previous);
		assert.equal(parts.documents.length, 0);
		assert.equal(parts.groups.length, 1);
		assert.equal(parts.partForGroup(parts.main.activeGroup), parts.main);
		assert.ok(departing.every(group => parts.partForGroup(group) === undefined));
		incoming = new HomeInput(null);
		parts.main.activeGroup.openEditor(incoming);
	});
	assert.equal(request.prepare(), true); request.retire();
	assert.ok(incoming !== undefined && parts.main.activeGroup.model.activeTab === incoming);
	assert.ok(departing.every(group => group.surface.retired));
	assert.equal(await request.restore(state, f.editor.editorInputSerializers), false);
	assert.ok(parts.main.activeGroup.model.activeTab === incoming);
});

test('a Home opening from initial document-topology publication supersedes only older document recovery', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	parts.main.activeGroup.openEditor(new HomeInput(null));
	const state = parts.serialize(f.editor.editorInputSerializers), request = parts.beginRestore();
	t.after(() => request.dispose());
	let incoming: HomeInput | undefined;
	const unbind = parts.onDidChange(() => {
		if (parts.documents.length !== 0 || parts.main.activeGroup.model.activeTab !== null) return;
		unbind(); incoming = new HomeInput(null); parts.main.activeGroup.openEditor(incoming);
	});
	t.after(unbind);
	assert.equal(request.prepare(), true); request.retire();
	assert.equal(await request.restore(state, f.editor.editorInputSerializers), false);
	assert.ok(incoming !== undefined && parts.main.activeGroup.model.activeTab === incoming);
	assert.equal(parts.documents.length, 0);
});

test('a floating editor created by a departing input survives the older initial retirement', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const state = parts.serialize(f.editor.editorInputSerializers), departing = [...parts.documents];
	const request = parts.beginRestore(); t.after(() => request.dispose());
	let incoming: HomeInput | undefined;
	f.firstInput.onWillDispose(() => {
		assert.equal(parts.documents.length, 0);
		const part = parts.createDocument(); incoming = new HomeInput(null); part.activeGroup.openEditor(incoming);
	});
	assert.equal(request.prepare(), true); request.retire();
	assert.ok(departing.every(part => part.retired));
	assert.equal(parts.documents.length, 1);
	const part = parts.documents[0];
	assert.ok(part.activeGroup.model.activeTab === incoming && !part.retired && !part.surface.retired);
	assert.equal(parts.partForGroup(part.activeGroup), part);
	assert.equal(await request.restore(state, f.editor.editorInputSerializers), false);
	assert.ok(parts.documents.length === 1 && parts.documents[0] === part);
});

test('floating recovery publishes its complete native owner before callbacks admit a newer document opening', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const state = parts.serialize(f.editor.editorInputSerializers);
	parts.clear();
	const existing = new Set(f.editor.surfaces.windowSurfaces), request = parts.beginRestore();
	t.after(() => request.dispose());
	let incoming: HomeInput | undefined, observed = false, complete = false;
	const unbind = inputFocus.onDidChangeTarget(() => {
		const surface = f.editor.surfaces.windowSurfaces.find(candidate => !existing.has(candidate));
		if (surface === undefined) return;
		unbind(); observed = true;
		const part = parts.documents.find(candidate => candidate.surface === surface);
		complete = part !== undefined && !part.retired && part.activeGroup !== undefined
			&& parts.partForGroup(part.activeGroup) === part && part.window!.clientSurface === part.clientSurface
			&& part.activeGroup.surface.published;
		incoming = new HomeInput(null); parts.main.activeGroup.openEditor(incoming);
	});
	t.after(unbind);
	assert.equal(await request.restore(state, f.editor.editorInputSerializers), false);
	assert.equal(observed, true);
	assert.equal(complete, true, 'native discovery and focus callbacks cannot observe a half-constructed floating editor');
	assert.ok(incoming !== undefined && parts.main.activeGroup.model.activeTab === incoming);
	assert.equal(parts.documents.length, 1, 'newer document intent prevents publication of the remaining recovered windows');
	assert.equal(parts.documents[0].activeGroup.model.tabs.length, 0, 'a superseded recovery cannot hydrate the published receiver afterward');
});

test('a split admitted during initial group retirement supersedes older document topology', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const state = parts.serialize(f.editor.editorInputSerializers), request = parts.beginRestore();
	t.after(() => request.dispose());
	let split = false;
	f.firstGroup.onWillDispose(() => {
		const group = parts.main.activeGroup;
		assert.ok(parts.splitGroup(group, 'right') !== undefined); split = true;
	});
	assert.equal(request.prepare(), true); request.retire();
	assert.equal(split, true); assert.equal(parts.main.groups.length, 2);
	assert.equal(await request.restore(state, f.editor.editorInputSerializers), false);
	assert.equal(parts.main.groups.length, 2);
	assert.ok(parts.main.groups.every(group => parts.partForGroup(group) === parts.main));
});

test('initial preparation itself retains recovery admission and cannot repeat after newer work', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const state = parts.serialize(f.editor.editorInputSerializers), previous = parts.main.activeGroup;
	const request = parts.beginRestore(); t.after(() => request.dispose());
	assert.equal(request.prepare(), true);
	assert.equal(request.isCurrent(), true);
	assert.ok(parts.main.activeGroup !== previous && !previous.surface.retired);
	assert.equal(parts.groups.length, 1); assert.equal(parts.documents.length, 0);
	const incoming = new HomeInput(null); parts.main.activeGroup.openEditor(incoming);
	assert.equal(request.prepare(), false);
	request.retire();
	assert.equal(previous.surface.retired, true);
	assert.equal(await request.restore(state, f.editor.editorInputSerializers), false);
	assert.ok(parts.main.activeGroup.model.activeTab === incoming);
});

test('an unsuperseded initial preparation restores independent document views over their canonical source owners', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	parts.main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const state = parts.serialize(f.editor.editorInputSerializers), copies = [f.firstInput.workingCopy, f.secondInput.workingCopy];
	const request = parts.beginRestore(); t.after(() => request.dispose());
	assert.equal(request.prepare(), true);
	request.retire();
	assert.equal(await request.restore(state, f.editor.editorInputSerializers), true);
	assert.equal(parts.documents.length, state.documents.length);
	const main = parts.main.activeGroup.model.activeTab, first = parts.documents[0].activeGroup.model.activeTab;
	assert.ok(main?.kind === 'code_editor' && first?.kind === 'code_editor');
	assert.ok(main !== first && main.workingCopy === first.workingCopy && main.workingCopy === copies[0]);
	const second = parts.documents[1].activeGroup.model.activeTab;
	assert.ok(second?.kind === 'code_editor' && second.workingCopy === copies[1]);
});

test('a superseded reservation cannot prepare over an already admitted newer document', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const request = parts.beginRestore(); t.after(() => request.dispose());
	const previous = parts.main.activeGroup, documents = [...parts.documents], incoming = new HomeInput(null);
	previous.openEditor(incoming);
	assert.equal(request.prepare(), false);
	assert.ok(parts.main.activeGroup === previous && previous.model.activeTab === incoming);
	assert.deepEqual(parts.documents, documents);
});

test('initial retirement revokes an old pending opening without granting its late candidate a new routing group', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	let admit!: () => void;
	const pending = new Promise<void>(resolve => { admit = resolve; }), previous = parts.main.activeGroup;
	const incoming = new HomeInput(null); let retired = false;
	incoming.onWillDispose(() => { retired = true; });
	const opening = previous.openResolvedEditor(async () => { await pending; return incoming; });
	const request = parts.beginRestore(); t.after(() => request.dispose());
	assert.equal(request.prepare(), true);
	const current = parts.main.activeGroup;
	admit(); assert.equal(await opening, undefined);
	assert.equal(retired, true); assert.equal(request.isCurrent(), true);
	assert.ok(parts.main.activeGroup === current && current.model.tabs.length === 0);
	request.retire();
	assert.equal(previous.surface.retired, true);
});

test('pure document preparation withdraws old routing without invoking opening, retirement or topology observers', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const departing = [...parts.groups], inputs = departing.flatMap(group => [...group.model.tabs]);
	const request = parts.beginRestore(); t.after(() => request.dispose());
	let openings = 0, retirements = 0, changes = 0;
	const subscriptions = [parts.onDidChange(() => { changes++; }),
		...departing.map(group => group.panes.onDidBeginOpen(() => { openings++; })),
		...inputs.map(input => input.onWillDispose(() => { retirements++; }))];
	t.after(() => { for (const release of subscriptions) release(); });
	assert.equal(request.prepare(), true);
	assert.equal(changes, 0); assert.equal(openings, 0); assert.equal(retirements, 0);
	for (const group of departing) {
		assert.equal(group.openingAdmitted, false); assert.equal(group.presented, false);
		assert.equal(findEditorGroup(group.focusTarget), null);
		assert.equal(group.surface.retired, false);
	}
	request.retire();
	assert.equal(retirements, inputs.length);
	assert.ok(departing.every(group => group.surface.retired));
});

test('a real source-clear publication opens Home in prepared routing without stranding captured floating editors', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	parts.main.activeGroup.openEditor(new HomeInput(null));
	const state = parts.serialize(f.editor.editorInputSerializers), departing = [...parts.documents], previous = parts.main.activeGroup;
	let incoming: HomeInput | undefined;
	const unbind = editorTextModelService.onWillClear(() => {
		unbind(); assert.ok(parts.main.activeGroup !== previous);
		assert.equal(previous.openingAdmitted, false);
		assert.equal(findEditorGroup(previous.focusTarget), null);
		incoming = new HomeInput(null); parts.main.activeGroup.openEditor(incoming);
	});
	t.after(unbind);
	const request = parts.beginRestore(); t.after(() => request.dispose());
	const replacement = editorTextModelService.replace([]);
	try {
		assert.equal(request.prepare(), true);
		assert.equal(replacement.publish(), true);
		assert.equal(request.isCurrent(), false);
		request.retire();
		assert.ok(departing.every(part => part.retired && part.surface.retired));
		assert.ok(incoming !== undefined && parts.main.activeGroup.model.activeTab === incoming);
		assert.equal(await request.restore(state, f.editor.editorInputSerializers), false);
		assert.equal(parts.documents.length, 0);
	} finally { replacement.dispose(); }
});

test('disposing superseded recovery consumes its departure before reentrant cleanup and retains newer windows', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, departing = [...parts.documents];
	const request = parts.beginRestore(); t.after(() => request.dispose());
	let retired = 0, incoming: HomeInput | undefined;
	f.firstInput.onWillDispose(() => {
		retired++; request.dispose();
		const part = parts.createDocument(); incoming = new HomeInput(null); part.activeGroup.openEditor(incoming);
	});
	assert.equal(request.prepare(), true);
	parts.main.activeGroup.openEditor(new HomeInput(null));
	assert.equal(request.isCurrent(), false);
	request.dispose(); request.retire();
	assert.equal(retired, 1);
	assert.ok(departing.every(part => part.retired));
	assert.ok(parts.documents.length === 1 && parts.documents[0].activeGroup.model.activeTab === incoming);
});

test('fresh routing construction cannot retire a Main gesture before every pure preparation is published', async t => {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const parts = f.editor.editorParts, main = f.editor.mainWorkspace;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }),
		inputFocus.target), true); f.update();
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	const surface = f.editor.surfaces.findByScope(primary.hierarchy.scope.surfaceScope)!;
	assert.equal(f.editor.surfaces.isAdmitted(surface), true);
	let cancelled = 0, incoming: HomeInput | undefined;
	const gesture = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() {
		cancelled++; incoming = new HomeInput(null); parts.main.activeGroup.openEditor(incoming);
	} };
	pointerCapture.beginRoute(surface.captureScope, { valid: true, insideViewport: true, viewportX: 10, viewportY: 100,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	pointerCapture.capture(gesture);
	const primaryRequest = main.beginRestore(), documents = parts.beginRestore();
	t.after(() => { primaryRequest.dispose(); documents.dispose(); });
	assert.equal(primaryRequest.prepare(), true);
	assert.equal(documents.prepare(), true);
	assert.equal(cancelled, 0);
	primaryRequest.retire(); documents.retire();
	assert.equal(cancelled, 1);
	assert.ok(incoming !== undefined && parts.main.activeGroup.model.activeTab === incoming);
	assert.equal(parts.documents.length, 0);
});

test('a document opening admitted during source hydration supersedes an older workspace restore request', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const state = parts.serialize(f.editor.editorInputSerializers);
	parts.clear();
	const request = parts.beginRestore(); t.after(() => request.dispose());
	const incoming = new CodeEditorInput(f.firstInput.workingCopy);
	parts.main.activeGroup.openEditor(incoming);
	assert.equal(request.isCurrent(), false);
	assert.equal(await request.restore(state, f.editor.editorInputSerializers), false);
	assert.ok(parts.main.activeGroup.model.activeTab === incoming);
	assert.equal(parts.documents.length, 0);
});

test('an unresolved newer document opening prevents older restored candidates from replacing its group', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	parts.main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const state = parts.serialize(f.editor.editorInputSerializers);
	parts.clear();
	let admitRecovered!: () => void, admitOpening!: () => void;
	const recoveredReady = new Promise<void>(resolve => { admitRecovered = resolve; });
	const openingReady = new Promise<void>(resolve => { admitOpening = resolve; });
	const serializer = f.editor.editorInputSerializers.code_editor;
	const serializers = { ...f.editor.editorInputSerializers, code_editor: {
		serialize: serializer.serialize.bind(serializer),
		async deserialize(value: string) { await recoveredReady; return serializer.deserialize(value); },
	} };
	const group = parts.main.activeGroup, request = parts.beginRestore();
	t.after(() => request.dispose());
	const recovery = request.restore(state, serializers);
	const incoming = new CodeEditorInput(f.firstInput.workingCopy);
	const opening = group.openResolvedEditor(async () => { await openingReady; return incoming; });
	assert.equal(request.isCurrent(), false);
	admitRecovered(); assert.equal(await recovery, false);
	assert.ok(parts.main.activeGroup === group);
	assert.equal(parts.documents.length, 0);
	admitOpening(); assert.ok(await opening !== undefined);
	assert.ok(group.model.activeTab === incoming);
	assert.equal(group.model.tabs.length, 1);
	assert.ok(inputFocus.admittedTarget === group.panes.activePane!.commandTarget);
});
