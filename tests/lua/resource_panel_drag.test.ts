import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

const SCENES = "local scenes=require('cartlib/world/scene_library')\nscenes.register('one', {objects={}})\nscenes.register('two', {objects={}})\n";
function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny', sources: readonly (readonly [string, string])[] = []) {
	const f = createActualSourcePanes(t, false, [['folder/third.lua', 'return 3'], ['folder/other.lua', 'return 4'], ...sources],
		() => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs'))));
	f.editor.setFontVariant(font); f.first.focus(); f.editor.resourcePanel.show(); f.update();
	// Files narrows the work area; the receiving floating host must actually be uncovered.
	f.editor.surfaces.raise(f.secondPart.surface);
	assert.equal(editorViewState.font.variant, font);
	return { ...f, panel: f.editor.resourcePanel, open: t.mock.method(f.editor.editorParts, 'openAt') };
}
type Fixture = ReturnType<typeof fixture>;
type Point = { x: number; y: number };
function reveal(f: Fixture, path = 'folder/third.lua') {
	f.panel.queuePendingSelection({ contextId: f.sources.systemContextId, path }); f.panel.applyPendingSelection(); f.update();
	const node = f.panel.files.selectedNode;
	assert.ok(node !== null && node.element.kind === 'file');
	return { node, resource: node.element.resource };
}
/** Layout supplies real physical input locations, not workflow result assertions. */
function rowPoint(f: Fixture, node: WorkbenchTreeNode<FileElement>, gutter = false): Point {
	const index = f.panel.files.tree.rows.indexOf(node), metrics = f.panel.getItemMetrics(index), layout = f.panel.prepareLayout();
	assert.ok(index >= 0);
	return { x: layout.contentLeft - f.panel.hscroll + (gutter ? (metrics.markerStartWidth + metrics.markerEndWidth) / 2
		: metrics.indentWidth + editorViewState.font.advance(' ')), y: layout.contentTop + (index - f.panel.scroll + 0.5) * f.panel.lineHeight };
}
function body(group: EditorGroupView, edge = false): Point {
	const bounds = group.panes.contentBounds, clip = group.clip;
	const left = Math.max(bounds.left, clip.left), right = Math.min(bounds.right, clip.right);
	return { x: edge ? right - 1 : (left + right) / 2,
		y: (Math.max(bounds.top, clip.top) + Math.min(bounds.bottom, clip.bottom)) / 2 };
}
function pointer(f: Fixture, point: Point, phase: 'press' | 'move' | 'release', modifiers = KeyModifier.none): void {
	f.host.clock.advance(10);
	f.editor.dispatchPointer({ ...point, buttons: phase === 'release' ? 0 : PointerButton.Primary,
		pressedButtons: phase === 'press' ? PointerButton.Primary : 0, releasedButtons: phase === 'release' ? PointerButton.Primary : 0,
		cancelledButtons: 0, modifiers, spaceDown: false, timestamp: f.host.clock.now() });
}
async function drop(f: Fixture, node: WorkbenchTreeNode<FileElement>, target: Point, modifiers = KeyModifier.none) {
	f.editor.surfaces.raise(f.secondPart.surface);
	pointer(f, rowPoint(f, node), 'press'); pointer(f, target, 'move', modifiers); pointer(f, target, 'release', modifiers);
	assert.equal(f.open.mock.callCount(), 1); return f.open.mock.calls[0].result;
}

for (const font of ['tiny', 'msx'] as const) test(`${font} Files body press selects its exact row but opens only its matching physical release`, async t => {
	const f = fixture(t, font), chosen = reveal(f); reveal(f, 'folder/other.lua');
	const point = rowPoint(f, chosen.node), open = t.mock.method(f.editor.navigation, 'openResource');
	pointer(f, point, 'press');
	assert.ok(f.panel.files.selectedNode === chosen.node && f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(open.mock.callCount(), 0); assert.equal(pointerCapture.active, true);
	pointer(f, point, 'release');
	assert.ok(f.panel.files.selectedNode === chosen.node); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	assert.ok(f.firstGroup.model.activeTab instanceof CodeEditorInput && f.firstGroup.model.activeTab.resource === chosen.resource);
	assert.equal(pointerCapture.active, false); assert.equal(f.open.mock.callCount(), 0);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} an unopened Files resource previews placement without resolving or creating a view until release`, async t => {
	const f = fixture(t, font), { node, resource } = reveal(f), target = body(f.secondGroup);
	const produce = t.mock.method(f.editor.resourceEditors, 'resolveEditorInput');
	const source = f.firstInput.workingCopy.buffer.getText(), version = f.firstInput.workingCopy.version, cycles = f.host.runtime.machine.scheduler.nowCycles;
	pointer(f, rowPoint(f, node), 'press'); pointer(f, target, 'move'); f.update(20); f.update(20);
	assert.equal(produce.mock.callCount(), 0); assert.ok(editorTextModelService.get(resource) === undefined);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.open.mock.callCount(), 0); assert.equal(f.editor.editorParts.documents.length, 2);
	pointer(f, target, 'release'); assert.equal(f.open.mock.callCount(), 1); const input = await f.open.mock.calls[0].result;
	assert.ok(input instanceof CodeEditorInput && input.resource === resource && f.secondGroup.model.activeTab === input);
	assert.ok(f.secondGroup.panes.activePane?.input === input && f.secondGroup.model.contains(f.secondInput));
	assert.equal(input.isDirty(), false); assert.equal(f.firstInput.workingCopy.buffer.getText(), source); assert.equal(f.firstInput.workingCopy.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} a file body drop uses its explicit group rather than the foreign existing-view affinity`, async t => {
	const f = fixture(t, font), { node, resource } = reveal(f);
	await f.editor.navigation.openResource(f.firstGroup, resource); const original = f.firstGroup.model.activeTab;
	f.panel.setFocused(true); f.update(); const input = await drop(f, node, body(f.secondGroup));
	assert.ok(input instanceof CodeEditorInput && original instanceof CodeEditorInput && input !== original && input.workingCopy === original.workingCopy);
	assert.ok(f.secondGroup.model.activeTab === input && f.firstGroup.model.activeTab === original);
	assert.equal(f.firstPart.groups.length, 1); assert.equal(f.secondPart.groups.length, 1);
});

for (const placement of ['split', 'window'] as const) for (const font of ['tiny', 'msx'] as const)
	test(`${font} an unopened resource creates its explicit ${placement} receiver only after release`, async t => {
		const f = fixture(t, font), { node, resource } = reveal(f), target = body(f.secondGroup, true);
		pointer(f, rowPoint(f, node), 'press'); pointer(f, target, 'move', placement === 'window' ? KeyModifier.alt : KeyModifier.none);
		assert.equal(f.secondPart.groups.length, 1); assert.equal(f.editor.editorParts.documents.length, 2);
		pointer(f, target, 'release', placement === 'window' ? KeyModifier.alt : KeyModifier.none);
		assert.equal(f.open.mock.callCount(), 1); const input = await f.open.mock.calls[0].result, group = input === undefined ? undefined : f.editor.editorParts.findGroup(input);
		assert.ok(input instanceof CodeEditorInput && input.resource === resource && group !== undefined && group !== f.secondGroup);
		assert.ok(group.panes.activePane?.input === input && f.secondGroup.model.activeTab === f.secondInput);
		if (placement === 'split') { assert.ok(f.editor.editorParts.partForGroup(group) === f.secondPart); assert.equal(f.secondPart.groups.length, 2); }
		else { assert.ok(f.editor.editorParts.partForGroup(group) !== f.secondPart); assert.equal(f.editor.editorParts.documents.length, 3); }
	});

for (const font of ['tiny', 'msx'] as const) test(`${font} tab-strip insertion opens at the released gap without reordering a matching existing receiver`, async t => {
	const f = fixture(t, font), { node, resource } = reveal(f), item = f.secondGroup.tabStrip.layoutState.items.peek(0);
	const point = { x: item.bounds.left + 1, y: (item.bounds.top + item.bounds.bottom) / 2 };
	const input = await drop(f, node, point);
	assert.ok(input instanceof CodeEditorInput && f.secondGroup.model.tabs[0] === input && f.secondGroup.model.tabs[1] === f.secondInput);
	f.panel.setFocused(true); pointer(f, rowPoint(f, node), 'press');
	const bounds = f.secondGroup.tabStrip.layoutState.viewportBounds, last = { x: bounds.right - 1, y: (bounds.top + bounds.bottom) / 2 };
	pointer(f, last, 'move'); pointer(f, last, 'release'); assert.equal(f.open.mock.callCount(), 2);
	assert.ok(await f.open.mock.calls[1].result === input);
	assert.ok(f.secondGroup.model.tabs[0] === input && f.secondGroup.model.tabs[1] === f.secondInput && input.resource === resource);
});

for (const cancel of ['escape', 'hide', 'filter', 'recovery'] as const) test(`${cancel} retires a held resource gesture without a click, drop or later release reopening`, t => {
	const f = fixture(t), { node } = reveal(f), target = body(f.secondGroup), ordinary = t.mock.method(f.editor.navigation, 'openResource');
	pointer(f, rowPoint(f, node), 'press'); pointer(f, target, 'move');
	if (cancel === 'escape') f.key('Escape');
	else if (cancel === 'hide') f.panel.hide();
	else if (cancel === 'filter') f.panel.toggleFilterMode();
	else {
		const recovery = f.panel.beginRestore();
		try { assert.equal(recovery.prepare(), true); }
		finally { recovery.dispose(); }
	}
	pointer(f, target, 'release');
	assert.equal(f.open.mock.callCount(), 0); assert.equal(ordinary.mock.callCount(), 0); assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, false);
	assert.equal(f.editor.editorParts.documents.length, 2); assert.equal(f.secondPart.groups.length, 1);
});

test('model cache retirement preserves an unopened resource gesture and its independent Files context', async t => {
	const f = fixture(t), { node, resource } = reveal(f), target = body(f.secondGroup);
	const scope = f.panel.focusTarget.scope, generation = scope.contextGeneration;
	assert.equal(editorTextModelService.get(resource), undefined);
	pointer(f, rowPoint(f, node), 'press'); pointer(f, target, 'move');
	editorTextModelService.clear();
	assert.ok(f.panel.focusTarget.scope === scope && scope.contextGeneration === generation);
	assert.ok(f.panel.files.selectedNode === node);
	assert.equal(pointerCapture.active, true); assert.equal(f.open.mock.callCount(), 0);
	assert.equal(editorTextModelService.get(resource), undefined);
	pointer(f, target, 'release');
	assert.equal(f.open.mock.callCount(), 1);
	const input = await f.open.mock.calls[0].result;
	assert.ok(input instanceof CodeEditorInput && input.resource === resource && f.secondGroup.model.activeTab === input);
	assert.ok(input.workingCopy === editorTextModelService.get(resource));
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, false);
});

test('an admitted body press cannot become a click on a later selected Files subject', t => {
	const f = fixture(t), chosen = reveal(f), point = rowPoint(f, chosen.node), ordinary = t.mock.method(f.editor.navigation, 'openResource');
	pointer(f, point, 'press'); reveal(f, 'folder/other.lua'); f.key('Escape'); pointer(f, point, 'release');
	assert.equal(ordinary.mock.callCount(), 0); assert.equal(f.open.mock.callCount(), 0); assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('replacing the exact catalog resource during a hold cancels it rather than opening a same-path replacement', t => {
	const f = fixture(t), { node, resource } = reveal(f), target = body(f.secondGroup);
	pointer(f, rowPoint(f, node), 'press'); pointer(f, target, 'move');
	const registry = f.sources.catalog.getContext(resource.contextId).luaSources, record = registry.path2lua[resource.path];
	registry.records.splice(registry.records.indexOf(record), 1); delete registry.path2lua[resource.path]; delete registry.module2lua[record.module_path];
	f.sources.catalog.rebuildResources(); registerLuaSourceRecord(registry, { ...record, src: 'return 30', base_src: 'return 30' }); f.update();
	pointer(f, target, 'release'); assert.equal(f.open.mock.callCount(), 0); assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} registered YAML defaults remain visual editors when a resource is dropped`, async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles()); const f = fixture(t, font), path = 'res/data/castle_map.yaml';
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'data', resid: 'map', source_path: path,
		sourcemeta: { text: '1: {map: [".."], objects: []}\n' } }]); f.panel.toggleFilterMode();
	const { node, resource } = reveal(f, path), input = await drop(f, node, body(f.secondGroup));
	assert.ok(input instanceof CartMapInput && input.resource === resource && f.secondGroup.model.activeTab === input);
	assert.ok(input.workingCopy === editorTextModelService.get(resource)); assert.equal(input.isDirty(), false);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} Scene activation retains its exact occurrence through a held prefix edit and opens visual Main, not a document`, async t => {
	const f = fixture(t, font, [['cartlib/world/scene_library.lua', 'return {}'], ['definitions.lua', SCENES]]), { node: file } = reveal(f, 'definitions.lua');
	f.panel.toggleFileDisclosure(file); f.update(); const node = file.children[1];
	assert.ok(node !== undefined && node.element.kind === 'definition'); const entry = node.element.content;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, entry.ownerResource), point = rowPoint(f, node);
	const open = t.mock.method(f.editor, 'openSceneInMain');
	pointer(f, point, 'press');
	assert.equal(open.mock.callCount(), 0); assert.equal(pointerCapture.active, true);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- tracked prefix\n' }]); f.update();
	const text = model.buffer.getText(), version = model.version;
	pointer(f, rowPoint(f, node), 'release'); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	f.update(); const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	assert.ok(entry.kind === 'scene' && client.consumer.subject === entry.definition && client.consumer.workingCopy === model);
	assert.equal(client.viewport.attached, true); assert.equal(f.open.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version); assert.equal(model.canUndo, true);
});

test('Scene subjects do not advertise a document drop or turn a dragged hold into activation', t => {
	const f = fixture(t, 'tiny', [['cartlib/world/scene_library.lua', 'return {}'], ['definitions.lua', SCENES]]), { node: file } = reveal(f, 'definitions.lua');
	f.panel.toggleFileDisclosure(file); f.update(); const node = file.children[0];
	const open = t.mock.method(f.editor, 'openSceneInMain'), target = body(f.secondGroup);
	pointer(f, rowPoint(f, node), 'press'); pointer(f, target, 'move'); pointer(f, target, 'release');
	assert.equal(open.mock.callCount(), 0); assert.equal(f.open.mock.callCount(), 0);
	assert.equal(f.editor.mainWorkspace.primary, undefined); assert.equal(f.editor.editorParts.documents.length, 2);
});

test('deleting and equally recreating an authored declaration during a hold cannot redirect it to the replacement', t => {
	const f = fixture(t, 'tiny', [['cartlib/world/scene_library.lua', 'return {}'], ['definitions.lua', SCENES]]), { node: file } = reveal(f, 'definitions.lua');
	f.panel.toggleFileDisclosure(file); f.update(); const node = file.children[0];
	assert.ok(node !== undefined && node.element.kind === 'definition'); const entry = node.element.content;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, entry.ownerResource), target = body(f.secondGroup), text = model.buffer.getText();
	pointer(f, rowPoint(f, node), 'press'); pointer(f, target, 'move');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: '' }]); f.update();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text }]); f.update(); pointer(f, target, 'release');
	assert.equal(f.open.mock.callCount(), 0); assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

test('a receiving focused draft acquired during the hold vetoes production and empty split publication', async t => {
	const f = fixture(t), { node } = reveal(f), produce = t.mock.method(f.editor.resourceEditors, 'resolveEditorInput');
	const draft = { pending: true, commit: () => false, cancel() { this.pending = false; } };
	f.second.commandTarget.edit = draft;
	const target = body(f.secondGroup, true); pointer(f, rowPoint(f, node), 'press'); pointer(f, target, 'move');
	f.second.focus(); pointer(f, target, 'release'); assert.equal(f.open.mock.callCount(), 1);
	const input = await f.open.mock.calls[0].result; assert.ok(input === undefined && f.secondGroup.model.activeTab === f.secondInput);
	assert.equal(produce.mock.callCount(), 0); assert.equal(f.secondPart.groups.length, 1); assert.equal(f.editor.editorParts.documents.length, 2);
	f.second.commandTarget.edit = undefined;
});

test('accepted model admission cannot steal a newer real foreground from another pane', async t => {
	const f = fixture(t), { node, resource } = reveal(f); let redirected = false;
	const unbind = editorTextModelService.onDidAddModel(model => { if (model.resource === resource) { redirected = true; f.first.focus(); } }); t.after(unbind);
	const input = await drop(f, node, body(f.secondGroup));
	assert.equal(redirected, true); assert.ok(input instanceof CodeEditorInput && f.secondGroup.model.activeTab === input);
	assert.ok(inputFocus.target === f.first.commandTarget && f.editor.editorParts.activeGroup === f.firstGroup);
});

test('an imported animation declaration keeps the authored table owner and its consumer when floated from Files', async t => {
	const f = fixture(t, 'tiny', [
		['cartlib/component/sprite_animation_component.lua', 'return {}'], ['frames.lua', "return {frames={'idle.1'},frame_run=2}"],
		['caller.lua', "local sprite=require('cartlib/component/sprite_animation_component'); sprite.factory(require('frames'))"],
	]), { node: file } = reveal(f, 'caller.lua');
	f.panel.toggleFileDisclosure(file); f.update(); const node = file.children[0];
	assert.ok(node !== undefined && node.element.kind === 'definition' && node.element.content.kind === 'animation');
	const entry = node.element.content; assert.ok(entry.browserResource !== entry.ownerResource);
	const input = await drop(f, node, body(f.secondGroup), KeyModifier.alt);
	assert.ok(input?.kind === 'animation' && input.workingCopy.resource === entry.ownerResource && input.projectContextId === entry.projectContextId);
	assert.equal(input.consumerPath, entry.definition.consumer?.file);
	assert.ok(input.definitionRange?.start === entry.range.start && input.definitionRange.end === entry.range.end);
	assert.equal(f.editor.editorParts.documents.length, 3); assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

const CONTENT_MODULES = ['cartlib/behaviour_tree/library', 'cartlib/fsm/library', 'cartlib/actioneffects',
	'cartlib/progression', 'cartlib/input/actioneffect/actioneffect_component', 'cartlib/timeline/program'];
const CONTENT = `local trees=require('cartlib/behaviour_tree/library')
local machines=require('cartlib/fsm/library')
local effects=require('cartlib/actioneffects')
local progression=require('cartlib/progression')
local input=require('cartlib/input/actioneffect/actioneffect_component')
local timeline=require('cartlib/timeline/program')
trees.register('tree',{root={type='wait',duration_ticks=2}})
machines.register('machine',{initial='idle',states={idle={}}})
effects.register_effect('effect',{cooldown_ms=10})
progression.compile_program({initial='start',states={start={}}})
input.factory({program={bindings={}}})
timeline.compile({duration_frames=4})
`;
for (const kind of ['behavior_tree', 'state_machine', 'action_effect', 'progression', 'input', 'animation'] as const)
	test(`Files ${kind} declarations use their real semantic producer at the explicit receiver`, async t => {
		const f = fixture(t, 'tiny', [...CONTENT_MODULES.map(module => [`${module}.lua`, 'return {}'] as const), ['content.lua', CONTENT]]);
		const { node: file } = reveal(f, 'content.lua'); f.panel.toggleFileDisclosure(file); f.update();
		const node = file.children.find(child => child.element.kind === 'definition' && child.element.content.kind === kind);
		assert.ok(node !== undefined && node.element.kind === 'definition'); const entry = node.element.content;
		const input = await drop(f, node, body(f.secondGroup));
		assert.ok(input !== undefined && (input.kind === 'behavior_lens' || input.kind === 'lua_program' || input.kind === 'animation'));
		assert.ok(f.secondGroup.model.activeTab === input && input.workingCopy === editorTextModelService.get(entry.ownerResource));
		if (input.kind === 'behavior_lens') {
			const range = input.view.source.ranges.get(input.view.selectionState.definitionRowKey!)!;
			assert.ok(range.start === entry.range.start && range.end === entry.range.end);
		} else if (input.kind === 'lua_program') assert.ok(input.occurrenceRange.start === entry.range.start && input.occurrenceRange.end === entry.range.end);
		else assert.ok(input.kind === 'animation' && input.definitionRange?.start === entry.range.start && input.definitionRange.end === entry.range.end);
		assert.ok(f.firstGroup.model.activeTab === f.firstInput); assert.equal(input.isDirty(), false);
	});

test('source retirement while its accepted resolver is pending rejects and disposes the unpublished candidate', async t => {
	const f = fixture(t), { node, resource } = reveal(f), resolve = f.editor.resourceEditors.resolveEditorInput.bind(f.editor.resourceEditors);
	let complete!: (input: Awaited<ReturnType<typeof resolve>>) => void;
	const pending = new Promise<Awaited<ReturnType<typeof resolve>>>(accept => { complete = accept; });
	let candidate: Awaited<ReturnType<typeof resolve>> | undefined;
	t.mock.method(f.editor.resourceEditors, 'resolveEditorInput', actual => { candidate = resolve(actual) as CodeEditorInput; return pending; });
	pointer(f, rowPoint(f, node), 'press'); const target = body(f.secondGroup); pointer(f, target, 'move'); pointer(f, target, 'release');
	assert.equal(f.open.mock.callCount(), 1); assert.ok(candidate instanceof CodeEditorInput && candidate.resource === resource);
	let retired = false; candidate.onWillDispose(() => { retired = true; }); f.panel.toggleFilterMode(); complete(candidate);
	assert.ok(await f.open.mock.calls[0].result === undefined); assert.equal(retired, true);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane?.input === f.secondInput);
});

test('a pending Files click cannot borrow a newer foreign foreground and destination on release', t => {
	const f = fixture(t), { node } = reveal(f), point = rowPoint(f, node), open = t.mock.method(f.editor.navigation, 'openResource');
	pointer(f, point, 'press'); f.second.focus(); pointer(f, point, 'release');
	assert.equal(open.mock.callCount(), 0); assert.equal(f.open.mock.callCount(), 0);
	assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

test('an ordinary release retains the press invoking group even when workspace routing changes behind Files', async t => {
	const f = fixture(t), { node, resource } = reveal(f), point = rowPoint(f, node), open = t.mock.method(f.editor.navigation, 'openResource');
	pointer(f, point, 'press'); f.editor.editorParts.activate(f.secondPart); pointer(f, point, 'release');
	assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	assert.ok(open.mock.calls[0].arguments[0] === f.firstGroup && f.firstGroup.model.activeTab instanceof CodeEditorInput
		&& f.firstGroup.model.activeTab.resource === resource && f.secondGroup.model.activeTab === f.secondInput);
});
