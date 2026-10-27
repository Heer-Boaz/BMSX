import assert from 'node:assert/strict';
import test from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import type { EditorInputSerializers, SerializedEditorGroup } from '../../ide/workbench/services/editor/editor_serialization';
import type { SerializedEditorGroupLayout, SerializedEditorParts } from '../../ide/workbench/services/editor/editor_parts_serialization';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { createTestEditorParts } from '../helpers/editor_panes';
import { createActualSourcePanes } from '../helpers/source_panes';
import { findEditorGroup } from '../../ide/workbench/services/editor/editor_group';

const group: SerializedEditorGroup = { inputs: [{ kind: 'home', value: 'first' }], active: 0, preview: null };

/** A complete registry fixture isolates Home admission; resolving another contribution is a test failure. */
function homeSerializers(deserialize: (value: string) => HomeInput | Promise<HomeInput>): EditorInputSerializers {
	const unused = { serialize: (): never => assert.fail('unexpected input serialization'), deserialize: (): never => assert.fail('unexpected input reconstruction') };
	return { home: { serialize: () => '', deserialize },
		animation: unused, aem_editor: unused, cart_map: unused, lua_program: unused, actor_lab: unused, game_view: unused,
		event_viewer: unused, terminal: unused, code_editor: unused, behavior_lens: unused, scene_editor: unused,
		resource_view: unused, scenario_lab: unused };
}

function snapshot(layout: SerializedEditorGroupLayout = { kind: 'group', group }): SerializedEditorParts {
	return { main: { layout, active: 0, mru: [0], scrollX: 0, scrollY: 0 }, documents: [], active: 0, mru: [0] };
}

test('a newer model intent from clear publication revokes staged restore admission', t => {
	const model = new EditorTabGroupModel(), newer = new HomeInput(null);
	t.after(() => model.clear());
	let redirected = false, resolutions = 0, candidateRetired = false;
	model.onDidChange(() => {
		if (redirected) return;
		redirected = true; model.initialize(newer);
	});
	const serializers = homeSerializers(() => { resolutions++; const input = new HomeInput(null); input.onWillDispose(() => { candidateRetired = true; }); return input; });
	return model.deserialize(group, serializers).then(restored => {
		assert.equal(restored, false); assert.equal(resolutions, 1); assert.equal(candidateRetired, true);
		assert.ok(model.activeTab === newer); assert.equal(model.tabs.length, 1);
	});
});

test('a candidate resolving after a newer model opening is retired instead of replacing that opening', async t => {
	const model = new EditorTabGroupModel(); t.after(() => model.clear());
	let resolve!: (input: HomeInput) => void;
	const waiting = new Promise<HomeInput>(done => { resolve = done; });
	const serializers = homeSerializers(() => waiting);
	const restoration = model.deserialize(group, serializers);
	const newer = new HomeInput(null); model.initialize(newer);
	const late = new HomeInput(null); let retired = false; late.onWillDispose(() => { retired = true; });
	resolve(late);
	assert.equal(await restoration, false); assert.equal(retired, true);
	assert.ok(model.activeTab === newer); assert.equal(model.tabs.length, 1);
});

test('a newer restore request supersedes an unresolved request without changing the published model revision', async t => {
	const model = new EditorTabGroupModel(); t.after(() => model.clear());
	let resolveOld!: (input: HomeInput) => void, resolveNew!: (input: HomeInput) => void;
	const oldCandidate = new Promise<HomeInput>(done => { resolveOld = done; }), newCandidate = new Promise<HomeInput>(done => { resolveNew = done; });
	const serializers = homeSerializers(value => value === 'old' ? oldCandidate : newCandidate);
	const old = model.deserialize({ inputs: [{ kind: 'home', value: 'old' }], active: 0, preview: null }, serializers);
	const newer = model.deserialize(group, serializers);
	const late = new HomeInput(null); let retired = false; late.onWillDispose(() => { retired = true; }); resolveOld(late);
	assert.equal(await old, false); assert.equal(retired, true);
	assert.equal(model.tabs.length, 0);
	const wanted = new HomeInput(null); resolveNew(wanted); assert.equal(await newer, true);
	assert.ok(model.activeTab === wanted); assert.equal(model.tabs.length, 1);
});

test('replacement admission does not erase a newer opening from the previous input retirement', async t => {
	const model = new EditorTabGroupModel(), original = new HomeInput(null), newer = new GameViewInput();
	model.initialize(original); t.after(() => model.clear());
	original.onWillDispose(() => { model.add(newer); model.activate(newer); });
	const candidate = new HomeInput(null); let candidateRetired = false; candidate.onWillDispose(() => { candidateRetired = true; });
	assert.equal(await model.deserialize(group, homeSerializers(() => candidate)), false);
	assert.ok(model.activeTab === newer); assert.equal(model.tabs.length, 1); assert.equal(candidateRetired, true);
});

test('disposing the frontend during a provisional leaf restore retires all constructed owners and rejects later leaves', async t => {
	configureFontVariant('tiny');
	const parts = createTestEditorParts(t);
	let resolve!: (input: HomeInput) => void, started!: () => void;
	const waiting = new Promise<HomeInput>(done => { resolve = done; }), entered = new Promise<void>(done => { started = done; });
	const first = new HomeInput(null); let firstRetired = false; first.onWillDispose(() => { firstRetired = true; });
	const resolved: string[] = [];
	const serializers = homeSerializers(value => {
		resolved.push(value);
		if (value === 'wait') { started(); return waiting; }
		return first;
	});
	const leaf = (value: string): SerializedEditorGroupLayout => ({ kind: 'group', group: { inputs: [{ kind: 'home', value }], active: 0, preview: null } });
	const state = snapshot({ kind: 'split', orientation: 'horizontal', ratio: 0.5, first: leaf('first'),
		second: { kind: 'split', orientation: 'vertical', ratio: 0.5, first: leaf('wait'), second: leaf('never') } });
	const restoration = parts.restore(state, serializers);
	await entered; parts.dispose();
	const late = new HomeInput(null); let retired = false; late.onWillDispose(() => { retired = true; }); resolve(late);
	assert.equal(await restoration, false); assert.equal(retired, true); assert.equal(firstRetired, true);
	assert.deepEqual(resolved, ['first', 'wait']); assert.equal(parts.groups.length, 0);
	assert.equal(parts.main.activeGroup.model.tabs.length, 0); assert.equal(parts.main.retired, true);
});

test('a cleared workspace can restore a new request while a superseded serializer still resolves', async t => {
	configureFontVariant('tiny');
	const parts = createTestEditorParts(t);
	let resolve!: (input: HomeInput) => void;
	const waiting = new Promise<HomeInput>(done => { resolve = done; });
	const serializers = homeSerializers(value => value === 'old' ? waiting : new HomeInput(null));
	const first = parts.restore(snapshot({ kind: 'group', group: { inputs: [{ kind: 'home', value: 'old' }], active: 0, preview: null } }), serializers);
	parts.clear();
	assert.equal(await parts.restore(snapshot(), serializers), true);
	const wanted = parts.main.activeGroup.model.activeTab;
	const late = new HomeInput(null); let retired = false; late.onWillDispose(() => { retired = true; }); resolve(late);
	assert.equal(await first, false); assert.equal(retired, true);
	assert.ok(parts.main.activeGroup.model.activeTab === wanted); assert.equal(parts.groups.length, 1);
});

test('closing admission revokes a pending part restore before its candidate writes into the retained model', async t => {
	configureFontVariant('tiny');
	const parts = createTestEditorParts(t), part = parts.createDocument();
	let resolve!: (input: HomeInput) => void;
	const waiting = new Promise<HomeInput>(done => { resolve = done; });
	const serializers = homeSerializers(() => waiting);
	const restoration = part.restore(snapshot().main, serializers);
	part.setOperation('close');
	const late = new HomeInput(null); let retired = false; late.onWillDispose(() => { retired = true; }); resolve(late);
	assert.equal(await restoration, false); assert.equal(retired, true);
	assert.equal(part.activeGroup.model.tabs.length, 0); assert.equal(part.operation, 'close');
});

test('aborting a two-input reconstruction preserves the coherent published model and retires all staged candidates', async t => {
	const model = new EditorTabGroupModel(), original = new HomeInput(null); model.initialize(original); t.after(() => model.clear());
	let originalRetired = false; original.onWillDispose(() => { originalRetired = true; });
	let resolve!: (input: GameViewInput) => void, started!: () => void;
	const waiting = new Promise<GameViewInput>(done => { resolve = done; }), entered = new Promise<void>(done => { started = done; });
	const first = new HomeInput(null); let firstRetired = false; first.onWillDispose(() => { firstRetired = true; });
	const serializers: EditorInputSerializers = { ...homeSerializers(() => first),
		game_view: { serialize: () => '', deserialize: () => { started(); return waiting; } } };
	const lifetime = new AbortController();
	const restoration = model.deserialize({ inputs: [{ kind: 'home', value: 'first' }, { kind: 'game_view', value: 'wait' }], active: 1, preview: null }, serializers, lifetime.signal);
	await entered;
	const during = { originalActive: model.activeTab === original, onlyOriginal: model.tabs.length === 1 && model.tabs[0] === original, originalRetired };
	lifetime.abort();
	const late = new GameViewInput(); let lateRetired = false; late.onWillDispose(() => { lateRetired = true; }); resolve(late);
	assert.equal(await restoration, false);
	assert.equal(during.originalActive, true); assert.equal(during.onlyOriginal, true); assert.equal(during.originalRetired, false);
	assert.ok(model.activeTab === original); assert.equal(model.tabs.length, 1); assert.equal(originalRetired, false);
	assert.equal(firstRetired, true); assert.equal(lateRetired, true);
});

test('a pending multi-leaf part reconstruction leaves its published input and pane bound until complete admission', async t => {
	configureFontVariant('tiny'); const parts = createTestEditorParts(t), part = parts.main;
	const original = new HomeInput(null); part.activeGroup.openEditor(original);
	const originalGroup = part.activeGroup, pane = originalGroup.panes.activePane!;
	let originalRetired = false; original.onWillDispose(() => { originalRetired = true; });
	let resolve!: (input: HomeInput) => void, started!: () => void;
	const waiting = new Promise<HomeInput>(done => { resolve = done; }), entered = new Promise<void>(done => { started = done; });
	const first = new HomeInput(null); let firstRetired = false; first.onWillDispose(() => { firstRetired = true; });
	const serializers = homeSerializers(value => { if (value === 'wait') { started(); return waiting; } return first; });
	const leaf = (value: string): SerializedEditorGroupLayout => ({ kind: 'group', group: { inputs: [{ kind: 'home', value }], active: 0, preview: null } });
	const restoration = part.restore(snapshot({ kind: 'split', orientation: 'horizontal', ratio: 0.5, first: leaf('first'), second: leaf('wait') }).main, serializers);
	await entered;
	const during = { sameGroup: part.activeGroup === originalGroup, modelInput: originalGroup.model.activeTab === original,
		paneInput: pane.input === original, originalRetired, groupCount: parts.groups.length };
	part.setOperation('close');
	const late = new HomeInput(null); let lateRetired = false; late.onWillDispose(() => { lateRetired = true; }); resolve(late);
	assert.equal(await restoration, false);
	assert.equal(during.sameGroup, true); assert.equal(during.modelInput, true); assert.equal(during.paneInput, true);
	assert.equal(during.originalRetired, false); assert.equal(during.groupCount, 1);
	assert.ok(part.activeGroup === originalGroup); assert.ok(originalGroup.model.activeTab === original);
	assert.equal(originalRetired, false); assert.equal(firstRetired, true); assert.equal(lateRetired, true);
});

test('a newer opening in a published group revokes reconstruction rather than mixing group generations', async t => {
	configureFontVariant('tiny'); const parts = createTestEditorParts(t), part = parts.main, originalGroup = part.activeGroup;
	originalGroup.openEditor(new HomeInput(null));
	let resolve!: (input: HomeInput) => void, started!: () => void;
	const waiting = new Promise<HomeInput>(done => { resolve = done; }), entered = new Promise<void>(done => { started = done; });
	const first = new HomeInput(null); let firstRetired = false; first.onWillDispose(() => { firstRetired = true; });
	const serializers = homeSerializers(value => { if (value === 'wait') { started(); return waiting; } return first; });
	const leaf = (value: string): SerializedEditorGroupLayout => ({ kind: 'group', group: { inputs: [{ kind: 'home', value }], active: 0, preview: null } });
	const restoration = part.restore(snapshot({ kind: 'split', orientation: 'horizontal', ratio: 0.5, first: leaf('first'), second: leaf('wait') }).main, serializers);
	await entered;
	const newer = new GameViewInput(); originalGroup.openEditor(newer);
	const late = new HomeInput(null); let lateRetired = false; late.onWillDispose(() => { lateRetired = true; }); resolve(late);
	assert.equal(await restoration, false); assert.ok(part.activeGroup === originalGroup);
	assert.ok(originalGroup.model.activeTab === newer); assert.ok(originalGroup.panes.activePane?.input === newer);
	assert.equal(parts.groups.length, 1); assert.equal(firstRetired, true); assert.equal(lateRetired, true);
});

test('restored topology is fully registered before observers see the replacement and prior group retirement', async t => {
	configureFontVariant('tiny'); const parts = createTestEditorParts(t), part = parts.main, original = part.activeGroup;
	original.openEditor(new HomeInput(null));
	let observed = false, coherent = true;
	const unbind = parts.onDidChange(() => {
		if (part.activeGroup === original) return;
		observed = true;
		coherent = coherent && parts.groups.length === part.groups.length && part.groups.every(group => parts.groups.includes(group) && parts.partForGroup(group) === part)
			&& !parts.groups.includes(original);
	}); t.after(unbind);
	let retiredCoherent = false;
	original.onWillDispose(() => { retiredCoherent = !parts.groups.includes(original) && part.groups.every(group => parts.groups.includes(group)); });
	assert.equal(await part.restore(snapshot({ kind: 'split', orientation: 'horizontal', ratio: 0.5,
		first: { kind: 'group', group }, second: { kind: 'group', group } }).main, homeSerializers(() => new HomeInput(null))), true);
	assert.equal(observed, true); assert.equal(coherent, true); assert.equal(retiredCoherent, true);
	assert.equal(parts.groups.length, 2);
});

test('an opening from prior group retirement revokes the restore completion receipt without losing the newer pane', async t => {
	configureFontVariant('tiny'); const parts = createTestEditorParts(t), part = parts.main, original = new HomeInput(null);
	part.activeGroup.openEditor(original);
	const newer = new GameViewInput();
	original.onWillDispose(() => { part.activeGroup.openEditor(newer); });
	assert.equal(await part.restore(snapshot().main, homeSerializers(() => new HomeInput(null))), false);
	assert.ok(part.activeGroup.model.activeTab === newer); assert.ok(part.activeGroup.panes.activePane?.input === newer);
});

test('restore observers can invoke a retired source command target only after its real group scope has retired', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, part = f.firstPart;
	const priorGroup = part.activeGroup, priorTarget = f.first.commandTarget;
	const saved = parts.serialize(f.editor.editorInputSerializers).documents[0];
	let observed = false, retired = false;
	const unbind = parts.onDidChange(() => {
		if (part.activeGroup === priorGroup) return;
		observed = true; retired = findEditorGroup(priorTarget) === null;
		const active = part.activeGroup, count = parts.groups.length;
		f.editor.commands.execute('group.focusNext', priorTarget);
		assert.ok(part.activeGroup === active); assert.equal(parts.groups.length, count);
	}); t.after(unbind);
	assert.equal(await part.restore(saved, f.editor.editorInputSerializers), true);
	assert.equal(observed, true); assert.equal(retired, true);
});

for (const retire of ['clear', 'dispose'] as const) test(`workspace ${retire} from restored pane activation revokes the outer workspace receipt before active-part publication`, async t => {
	configureFontVariant('tiny'); const parts = createTestEditorParts(t), serializers = homeSerializers(() => new HomeInput(null));
	parts.main.activeGroup.openEditor(new HomeInput(null)); parts.createDocument().activeGroup.openEditor(new HomeInput(null));
	const saved = parts.serialize(serializers); parts.clear();
	const before = parts.main.activeGroup;
	let subscribed = false, redirected = false;
	const unbind = parts.onDidChange(() => {
		if (subscribed || parts.main.activeGroup === before) return;
		subscribed = true;
		parts.main.activeGroup.panes.onWillShowEditor(() => { redirected = true; parts[retire](); });
	}); t.after(unbind);
	assert.equal(await parts.restore({ ...saved, active: 1, mru: [1, 0] }, serializers), false);
	assert.equal(redirected, true); assert.equal(parts.documents.length, 0);
	assert.equal(parts.main.activeGroup.model.tabs.length, 0); assert.equal(parts.main.activeGroup.panes.activePane, null);
	if (retire === 'clear') { assert.ok(parts.activePart === parts.main); assert.equal(parts.groups.length, 1); }
	else { assert.equal(parts.main.retired, true); assert.equal(parts.groups.length, 0); }
});
