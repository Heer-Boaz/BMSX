import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { captureInstalledLuaSources } from '../../ide/runtime/source_registry';
import assert from 'node:assert/strict';
import test, { afterEach, type TestContext } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { createBuiltinFunction, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { ActorLabInput } from '../../ide/workbench/contrib/actor_lab/editor_input';
import { ActorLabController } from '../../ide/workbench/contrib/actor_lab/controller';
import { layoutActorLab, measureActorLab } from '../../ide/workbench/contrib/actor_lab/layout';
import { WORKBENCH_SPLIT_SIZE } from '../../ide/workbench/ui/split_view';
import { RuntimeTransport } from '../../ide/runtime/transport';
import { captureActorDetailsSelection } from '../../ide/workbench/contrib/actor_lab/details';
import { ActorProjection, readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { createActorMemberChoices } from '../../ide/workbench/contrib/actor_lab/member_choices';
import { ActorRuntimeInspection } from '../../ide/workbench/contrib/actor_lab/runtime_inspection';
import { captureActorTarget, resolveActorPath, resolveActorTarget } from '../../ide/workbench/contrib/actor_lab/target';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { decodeActorToolRequest } from '../../ide/workbench/services/assistant/actor_tool_protocol';
import { parseLuaChunk, runCompletionClosure } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { ActorStateGraph } from '../../ide/workbench/contrib/actor_lab/state_graph';
import { ActorRuntimeTree, runtimeWorld } from '../../ide/workbench/contrib/actor_lab/runtime';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { InputFocusScope, inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { editorViewState } from '../../ide/editor/ui/view/state';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { RuntimeTimelineControl } from '../../ide/workbench/ui/runtime_timeline_control';
import { updateFullWidthWorkbenchLayout } from '../../ide/workbench/common/layout';
import { IDENTITY_HOST_OVERLAY_TRANSFORM, type HostOverlayTransform } from '../../machine/ts/render/host_overlay/transform';
import { createTestGroupPresentation, createTestEditorPaneContributions, createTestEditorCloseDependencies } from '../helpers/editor_panes';
import { EditorParts } from '../../ide/workbench/services/editor/editor_parts';
import { MainWorkspace } from '../../ide/workbench/main_workspace';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';

/** Compiled guest representations, not JS table mocks. Actual cartlib construction is tested in the browser workflow. */
const WORLD_SOURCE = `local fsm<const> = require('cartlib/fsm/fsm_component')
local state<const> = { definition = { on = {} }, states = {}, state_ids = {}, data = { answer = 42 } }
local concurrent<const> = { definition = { on = {}, is_concurrent = true }, states = {}, state_ids = {} }
local machine<const> = { localdef_id = 'same', definition = { on = {} }, states = { idle = state, concurrent = concurrent }, state_ids = { 'idle', 'concurrent' }, current_id = 'idle' }
local component<const> = { id = 'states', enabled = true, _owner_component_index = 1, _started = true, _machines = { machine }, _machines_by_id = { same = machine } }
local impostor<const> = { id = 'FSM states', enabled = true, _owner_component_index = 2, _machines_by_id = {} }
local actor<const> = { id = 1, definition_id = 'same', active = true, _components = { component, impostor }, _components_by_class = { [fsm] = { component } } }
local second<const> = { id = '1', definition_id = 'same', active = false, _components = {}, _components_by_class = {} }
component.owner = actor
actor.self = actor
return { _objects = { actor, second } }`;
const ENTRY = `local world<const> = require('cartlib/world/world')
probe = world._objects[1]
function rename() probe.id = 'renamed' end
function remove() probe._components[2] = nil end
return world`;

const controllerFixtures: { readonly controller: ActorLabController; readonly parts: EditorParts; readonly surfaces: WorkbenchSurfaceService; readonly contextMenu: ContextMenuController }[] = [];
afterEach(() => {
	for (const { controller, parts, surfaces, contextMenu } of controllerFixtures) { controller.dispose(); parts.dispose(); contextMenu.dispose(); surfaces.dispose(); }
	controllerFixtures.length = 0;
});

function fixture(t: TestContext, entry = ENTRY, run = true, worldSource = WORLD_SOURCE, extraModules: readonly { path: string; source: string }[] = []) {
	const modules = [{ path: 'cartlib/world/world', source: worldSource }, { path: 'cartlib/fsm/fsm_component', source: 'return {}' },
		{ path: 'cartlib/timeline/timeline_component', source: 'return {}' }, { path: 'cartlib/actioneffects/actioneffect_component', source: 'return {}' }, ...extraModules]
		.map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`) }));
	const chunk = parseLuaChunk(entry, 'entry.lua');
	const compiled = compileLuaChunkToProgram(chunk, selectLuaProgramModules(chunk, modules, []), { entrySource: entry, programDomain: 'system', optLevel: 0 });
	const image = linkTestSystemBlua32(compiled), runtime = createTestRuntime(image.romBytes);
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports, captureInstalledLuaSources(registry, image.symbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID), cartridgeSlots: [null, null] };
	runtime.machine.cpu.reset();
	if (run) runtime.machine.cpu.runUntilDepth(0, 100_000);
	const f = createRuntimeInspectionFixture(runtime, sources);
	f.inspection.pause();
	const inspection = f.inspection.open(), actors = inspection.lifetime.add(new ActorRuntimeInspection(inspection));
	const transport = new RuntimeTransport(runtime, f.execution, f.rewind, f.frameNavigation, () => f.actorExecution.canExecute);
	const presentation = createTestGroupPresentation(), surfaces = presentation.surfaces;
	const contextMenu = new ContextMenuController(inputFocus, pointerCapture, presentation.workArea);
	const commands = { isEnabled: () => false, execute() {} };
	function layoutMain(): void {
		const part = parts.main, bounds = presentation.workArea;
		part.prepareLayout();
		const minimum = part.minimumClientWidth(bounds.bottom - bounds.top);
		main.layout(bounds, minimum, part.minimumClientHeight);
		const finalMinimum = part.minimumClientWidth(main.regionLayout.viewport.bottom - main.regionLayout.viewport.top);
		if (finalMinimum !== minimum) main.layout(bounds, finalMinimum, part.minimumClientHeight);
		part.layoutPrepared(main.documentBounds); main.layoutClients();
	}
	const main = new MainWorkspace(surfaces, presentation.owner, presentation.focusScope, commands,
		layoutMain, () => parts.activate(parts.main, main),
		focus => { if (focus) parts.main.focus(); else parts.activate(parts.main); }, () => parts.main.activeGroup, contextMenu, presentation.workArea);
	const parts = new EditorParts({ surfaces, owner: presentation.owner, scope: presentation.focusScope, workArea: presentation.workArea,
		mainPresentation: main,
		commands, contextMenu, renderContext: presentation.renderContext,
		contributions: createTestEditorPaneContributions(commands, contextMenu), focusReturn: inputFocus.createTarget(null, presentation.focusScope),
		...createTestEditorCloseDependencies(t, presentation),
		layoutMain });
	layoutMain();
	const group = parts.main.activeGroup;
	const controller = new ActorLabController(sources, f.guest, runtime.machine.cpu,
		parts, undefined!, f.actorExecution, f.rewind, sources,
		{ kind: 'direct', presenter: f.presenter, recipient: f.input, transport });
	controllerFixtures.push({ controller, parts, surfaces, contextMenu });
	return { ...f, stop: inspection, actors, controller, group };
}

for (const action of ['open', 'audition'] as const) test(`Actor Lab ${action} stops at rejected focused draft admission`, t => {
	configureFontVariant('tiny');
	const menuArea = { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight };
	const contextMenu = new ContextMenuController(inputFocus, pointerCapture, menuArea), quickInput = new QuickInputController(contextMenu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: menuArea, kind: 'workspace' });
	const f = fixture(t, ENTRY, true, WORLD_SOURCE, []);
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'draft.lua', contextId: TEST_SYSTEM_CONTEXT_ID, path: 'draft.lua', location: { kind: 'workspace', path: 'draft.lua' },
		source: { type: 'lua', resid: 'draft' } }, 'lua', 'return 1');
	const current = new CodeEditorInput(model);
	f.group.openEditor(current);
	const control = new ValueInput(inputFocus.target!, INTEGER_INPUT_FORMAT, () => assert.fail('invalid draft cannot publish'));
	control.setValue(1); control.field.focusTarget.focus(); setFieldText(control.field, '-', false);
	t.after(() => {
		control.cancel(); inputFocus.setTarget(null); control.dispose(); quickInput.dispose(); contextMenu.dispose();
		f.group.clear(); model.dispose(); f.stop.dispose();
	});
	const offered = f.controller.resolveInput();
	let retired = 0; offered.onWillDispose(() => { retired++; });
	if (action === 'open') f.controller.open(f.group); else f.controller.auditionEvent(f.group, -1, 'event');
	assert.equal(retired, 1, 'the unadmitted Actor Lab candidate releases its resources');
	assert.ok(f.group.model.activeTab === current); assert.ok(f.group.panes.activePane?.input === current);
	assert.ok(inputFocus.target === control.field.focusTarget);
	assert.equal(control.pending, true); assert.equal(control.field.text, '-');
	assert.equal(quickInput.visible, false, 'a rejected editor cannot open a follow-on actor chooser');
	assert.equal(model.buffer.getText(), 'return 1'); assert.equal(model.dirty, false);
});

test('viewport picking follows render order and cropped negative scale, using cached typed guest identities', t => {
	const f = fixture(t, `local world<const> = require('cartlib/world/world')
function rename_pick() world._objects[1].id = 'renamed' end
function hide_pick() world._render_visuals[2].visible = false end`, true, `
local sprite<const> = require('cartlib/component/sprite_component')
local front<const> = { id = 1, definition_id = 'front', visible = true, x = 20, y = 10 }
local back<const> = { id = '1', visible = 0, x = 0, y = 0 }
local background<const> = { owner = back, draw = sprite.draw_visual, visible = true,
 offset_x = 0, offset_y = 0, draw_offset_x = 0, draw_offset_y = 0,
 source_width = 32, source_height = 24, scale_x = 1, scale_y = 1, draw_scale_x = 1, draw_scale_y = 1 }
local foreground<const> = { owner = front, draw = sprite.draw_region_visual, visible = true,
 offset_x = -4, offset_y = -2, draw_offset_x = 0, draw_offset_y = 0,
 source_width = 99, source_height = 99, region_width = 6, region_height = 8,
 scale_x = -2, scale_y = 0.75, draw_scale_x = 1, draw_scale_y = 0.5 }
local custom<const> = { owner = front, draw = sprite.custom, visible = true }
return { _objects = { front, back }, _render_visuals = { background, foreground, custom }, _render_visual_count = 3 }`, [{
		path: 'cartlib/component/sprite_component', source: `local sprite<const> = {}
function sprite.draw_visual() end
function sprite.draw_region_visual() end
function sprite.custom() end
return sprite`,
	}]);
	t.after(() => f.stop.dispose());
	const controller = f.controller;
	const picker = controller.viewportPicker, cpu = f.runtime.machine.cpu;
	const world = runtimeWorld(f.sources, f.guest, -1)!, objects = f.guest.readStringMember(world, '_objects') as Table;
	const front = (objects.getInteger(1) as Table).hashId, back = (objects.getInteger(2) as Table).hashId;
	const before = [f.runtime.machine.scheduler.currentNowCycles(), cpu.luaHeap.usedBytes()];
	const hit = picker.pick(-1, 8, 9)!;
	assert.equal(hit.hashId, front);
	assert.deepEqual([hit.left, hit.top, hit.right, hit.bottom], [4, 8, 16, 11]);
	const read = t.mock.method(f.guest, 'readStringMember'), format = t.mock.method(f.guest, 'formatValue');
	for (let frame = 0; frame < 1000; frame++) assert.equal(picker.pick(-1, 8, 9), hit);
	assert.equal(read.mock.callCount(), 0);
	assert.equal(picker.pick(-1, 128, 128), undefined);
	assert.equal(picker.pick(-1, 8, 9)!.hashId, front);
	assert.equal(format.mock.callCount(), 0, 'crossing empty space does not allocate the same label again');
	assert.equal(picker.pick(-1, 0, 9)!.hashId, back, 'cropping, not full-source extent; numeric zero remains guest-truthy');
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), cpu.luaHeap.usedBytes()], before);
	const original = picker.pick(-1, 8, 9)!.label;
	f.guest.invalidate(); runCompletionClosure(cpu, f.guest.global('rename_pick') as Closure, []);
	assert.notEqual(picker.pick(-1, 8, 9)!.label, original, 'renaming retains identity but refreshes presentation');
	f.guest.invalidate(); runCompletionClosure(cpu, f.guest.global('hide_pick') as Closure, []);
	assert.equal(picker.pick(-1, 8, 9)!.hashId, back);
});

test('Actor Lab history restores the typed member and Details after choosing another actor without guest execution', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const controller = f.controller;
	const input = controller.resolveInput(); t.after(() => input.dispose());
	const choices = readActorChoices(f.sources, f.guest, -1), font = new Font({ variant: 'tiny' });
	input.domain = -1; input.actorHashId = choices[0].hashId; controller.refresh(input);
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state');
	input.rememberSelection(); input.detailsWindow.open = true;
	controller.refreshDetails(input);
	const selectedProperty = captureActorDetailsSelection(input.details!.items.find(item => item.identity !== undefined)!);
	input.detailsSelection = selectedProperty; input.detailsScroll = 37;
	// This unattached history input has requested intent, not an interactive sash.
	input.split.ratio = 0.55;
	const saved = controller.captureSelection(input), heap = f.runtime.machine.cpu.luaHeap.usedBytes();
	input.actorHashId = choices[1].hashId; input.selectionPath = undefined; input.dirty = true; controller.refresh(input);
	const second = controller.captureSelection(input);
	assert.equal(saved.matches(second), false, 'equal displayed actor IDs do not substitute for physical typed membership');
	input.detailsSelection = undefined; input.detailsScroll = 0; input.detailsWindow.open = false;
	controller.restoreSelection(input, saved, font);
	assert.equal(input.actorHashId, choices[0].hashId);
	assert.deepEqual(input.selectionPath, saved.target!.path);
	assert.equal(controller.selected(input)!.kind, 'state');
	assert.equal(input.detailsWindow.open, true); assert.deepEqual(input.detailsSelection, selectedProperty); assert.equal(input.detailsScroll, 37);
	assert.equal(input.split.ratio, 0.55);
	assert.equal(f.runtime.machine.cpu.luaHeap.usedBytes(), heap);
	assert.equal(input.interaction.running, false);
	saved.dispose(); second.dispose();
});

for (const variant of ['tiny', 'msx'] as const) test(`Actor ${variant} history restores both split intents through stacked and withheld previews`, t => {
	configureFontVariant(variant);
	const f = fixture(t); t.after(() => f.stop.dispose());
	const controller = f.controller, input = controller.resolveInput(); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	controller.refresh(input);
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
	const font = editorViewState.font, measured = measureActorLab(font);
	const bounds = { left: 23, top: 31, right: 923, bottom: 431 };
	const arrange = (width: number, height = 400) => {
		bounds.right = bounds.left + width; bounds.bottom = bounds.top + height;
		updateFullWidthWorkbenchLayout(input.layout, bounds); layoutActorLab(input);
	};
	arrange(900); input.split.resize(0.55); layoutActorLab(input);
	assert.ok(input.layout.split === input.split);
	const selected = controller.selected(input);
	const narrow = measured.outlineMinimumWidth + WORKBENCH_SPLIT_SIZE + measured.previewMinimumWidth - 1;
	arrange(narrow); assert.ok(input.layout.previewVisible && input.layout.split === input.rowSplit);
	input.rowSplit.resize(0.45); layoutActorLab(input);
	const saved = controller.captureSelection(input); t.after(() => saved.dispose());
	const cycles = f.runtime.machine.scheduler.nowCycles, heap = f.runtime.machine.cpu.luaHeap.usedBytes();
	arrange(900); input.split.resize(0.7);
	arrange(narrow); input.rowSplit.resize(0.6);
	arrange(narrow, measured.previewMinimumHeight);
	assert.ok(!input.layout.previewVisible && input.layout.split === undefined);
	controller.restoreSelection(input, saved, font.renderFont());
	assert.equal(input.split.ratio, 0.55, 'restoring view intent must not apply current interactive sash limits');
	assert.equal(input.rowSplit.ratio, 0.45);
	assert.ok(controller.selected(input) === selected);
	const roundTrip = controller.captureSelection(input); t.after(() => roundTrip.dispose());
	arrange(900); input.split.resize(0.7); layoutActorLab(input);
	arrange(narrow); input.rowSplit.resize(0.6); layoutActorLab(input);
	arrange(narrow, measured.previewMinimumHeight);
	controller.restoreSelection(input, roundTrip, font.renderFont());
	assert.equal(input.split.ratio, 0.55, 'a history round-trip while withheld retains the same requested placement');
	assert.equal(input.rowSplit.ratio, 0.45);
	arrange(narrow);
	assert.ok(input.layout.previewVisible && input.layout.split === input.rowSplit);
	assert.equal(input.rowSplit.ratio, 0.45);
	arrange(900);
	assert.ok(input.layout.previewVisible && input.layout.split === input.split);
	assert.equal(input.split.ratio, 0.55);
	assert.equal(f.runtime.machine.scheduler.nowCycles, cycles); assert.equal(f.runtime.machine.cpu.luaHeap.usedBytes(), heap);
});

test('Actor Lab pin action enablement uses retained membership without guest reads or identity capture churn', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const controller = f.controller;
	const input = controller.resolveInput(); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	controller.refresh(input); input.outline.selectionIndex = 0; input.rememberSelection(); controller.refreshDetails(input);
	const pinned = input.details!.items.find(item => item.label === 'ID')!, unpinned = input.details!.items.find(item => item.label === 'Active')!;
	controller.pinProperty(input, pinned); controller.refreshDetails(input);
	const pin = input.details!.watches.pins[0];
	const displayOnly = { ...unpinned, watchIdentity: undefined };
	const read = t.mock.method(f.guest, 'readStringMember'), globals = t.mock.method(f.guest, 'global'), systemGlobals = t.mock.method(f.guest, 'systemGlobal');
	const entries = t.mock.method(f.guest, 'visitTableEntries'), identities = t.mock.method(f.guest, 'identity');
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	for (let frame = 0; frame < 1000; frame++) {
		assert.equal(controller.canPinProperty(input, displayOnly), false);
		assert.equal(controller.canUnpinProperty(input, displayOnly), false);
		assert.equal(controller.canPinProperty(input, pinned), false);
		assert.equal(controller.canUnpinProperty(input, pinned), true);
		assert.equal(controller.canPinProperty(input, unpinned), true);
		assert.equal(controller.canUnpinProperty(input, unpinned), false);
		assert.equal(controller.canPinProperty(input, pin.item), false);
		assert.equal(controller.canUnpinProperty(input, pin.item), true);
		assert.equal(controller.canRevealPinnedProperty(input, pin.item), true);
	}
	assert.equal(read.mock.callCount(), 0); assert.equal(globals.mock.callCount(), 0); assert.equal(systemGlobals.mock.callCount(), 0);
	assert.equal(entries.mock.callCount(), 0); assert.equal(identities.mock.callCount(), 0);
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
});

test('Actor Lab capture admission publishes guest invalidation without an attached pane', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const input = f.controller.resolveInput(), transport = f.controller.viewport.transport;
	input.interaction.setRuntime(transport);
	const changes: boolean[] = [];
	t.after(input.interaction.onDidChange(() => changes.push(input.interaction.running)));
	input.interaction.running = true;
	f.guest.invalidate('execution');
	assert.equal(input.interaction.running, true, 'ordinary execution retains explicitly admitted capture');
	f.guest.invalidate('history-restored');
	assert.equal(input.interaction.running, false);
	assert.deepEqual(changes, [true, false], 'history invalidation publishes exactly one capture retirement');
	assert.strictEqual(input.interaction.transport, transport, 'history does not substitute the physical target');
});

test('Actor Lab pin and reveal commands keep watch selection separate and return to the exact cross-actor member', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const controller = f.controller;
	const input = controller.resolveInput(); t.after(() => input.dispose());
	const choices = readActorChoices(f.sources, f.guest, -1);
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	input.domain = -1; input.actorHashId = choices[0].hashId; controller.refresh(input);
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.name === 'idle'); input.rememberSelection();
	controller.refreshDetails(input);
	const property = input.details!.items.find(item => item.label === 'INSTANCE DATA')!;
	assert.equal(controller.canPinProperty(input, property), true);
	controller.pinProperty(input, property);
	const pin = input.details!.watches.pins[0];
	assert.deepEqual(input.detailsSelection, { kind: 'watch', id: pin.id });
	controller.refreshDetails(input);
	input.actorHashId = choices[1].hashId; input.selectionPath = undefined; input.dirty = true;
	controller.refresh(input); input.outline.selectionIndex = 0; input.rememberSelection(); controller.refreshDetails(input);
	assert.equal(controller.selected(input)!.hashId, choices[1].hashId);
	assert.equal(pin.available, true); assert.equal(controller.canRevealPinnedProperty(input, pin.item), true);
	const captureChanges: boolean[] = [];
	t.after(input.interaction.onDidChange(() => captureChanges.push(input.interaction.running)));
	input.interaction.running = true;
	controller.revealPinnedProperty(input, pin.item); controller.refreshDetails(input);
	assert.deepEqual(captureChanges, [true, false], 'controller navigation publishes capture admission without polling the pane');
	assert.equal(input.interaction.running, false); assert.equal(input.presentation, 'outline'); assert.equal(input.actorHashId, choices[0].hashId);
	assert.strictEqual(controller.selected(input), resolveActorTarget(input.runtime.roots, pin.target, f.guest));
	assert.deepEqual(input.selectionPath, pin.target.path);
	assert.deepEqual(input.detailsSelection, { kind: 'property', identity: pin.property });
	const revealed = input.details!.items.find(item => item.watch === undefined && item.label === 'INSTANCE DATA')!;
	assert.equal(controller.canPinProperty(input, revealed), false); assert.equal(controller.canUnpinProperty(input, revealed), true);
	controller.unpinProperty(input, revealed); controller.refreshDetails(input);
	assert.equal(input.details!.watches.pins.length, 0); assert.equal(controller.canPinProperty(input, revealed), true);
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
});

test('locked Details property commands target its subject rather than a newly selected actor', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const controller = f.controller, input = controller.resolveInput(); t.after(() => input.dispose());
	const choices = readActorChoices(f.sources, f.guest, -1);
	input.domain = -1; input.actorHashId = choices[0].hashId; controller.refresh(input);
	input.outline.selectionIndex = 0; input.rememberSelection(); controller.refreshDetails(input);
	const subject = input.details!.subject!, path = input.details!.subjectPath;
	controller.setDetailsLocked(input, true);
	input.actorHashId = choices[1].hashId; input.selectionPath = undefined; input.dirty = true;
	controller.refresh(input); input.outline.selectionIndex = 0; input.rememberSelection(); controller.refreshDetails(input);
	assert.equal(controller.selected(input)!.hashId, choices[1].hashId);
	assert.equal(input.details!.subject, subject); assert.equal(input.details!.locked, true);
	const property = input.details!.items.find(item => item.label === 'Active')!;
	assert.equal(property.value, 'true', 'Details still projects the first actor, not the tree-selected inactive actor');
	assert.equal(controller.canPinProperty(input, property), true);
	controller.pinProperty(input, property); controller.refreshDetails(input);
	const pin = input.details!.watches.pins[0];
	assert.equal(pin.target, subject); assert.ok(pin.item.description.includes(path));
	assert.equal(controller.canPinProperty(input, property), false); assert.equal(controller.canUnpinProperty(input, property), true);
	controller.setDetailsLocked(input, false);
	assert.equal(input.details!.subject!.actorHashId, choices[1].hashId, 'unlock immediately adopts the current tree selection');
	controller.refreshDetails(input);
	const second = input.details!.items.find(item => item.watch === undefined && item.label === 'Active')!;
	assert.equal(second.value, 'false');
	assert.equal(controller.canPinProperty(input, second), true, 'the same semantic field on a different subject is not already pinned');
	assert.equal(controller.canUnpinProperty(input, second), false);
});

test('navigation retains the independent Details lock and subject, but never restores them across a retired generation', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const controller = f.controller, input = controller.resolveInput(); t.after(() => input.dispose());
	const choices = readActorChoices(f.sources, f.guest, -1), font = new Font({ variant: 'tiny' });
	input.domain = -1; input.actorHashId = choices[0].hashId; controller.refresh(input);
	input.outline.selectionIndex = 0; input.rememberSelection(); controller.refreshDetails(input); controller.setDetailsLocked(input, true);
	const subject = input.details!.subject!;
	input.actorHashId = choices[1].hashId; input.selectionPath = undefined; input.dirty = true;
	controller.refresh(input); input.outline.selectionIndex = 0; input.rememberSelection(); controller.refreshDetails(input);
	const saved = controller.captureSelection(input); t.after(() => saved.dispose());
	assert.equal(saved.detailsSubject, subject); assert.equal(saved.target!.actorHashId, choices[1].hashId);
	controller.setDetailsLocked(input, false);
	const unlocked = controller.captureSelection(input); t.after(() => unlocked.dispose());
	assert.equal(saved.matches(unlocked), false, 'a lock/subject change is a distinct navigation selection');
	controller.restoreSelection(input, saved, font); controller.refreshDetails(input);
	assert.equal(input.details!.locked, true); assert.equal(input.details!.subject, subject);
	assert.equal(controller.selected(input)!.hashId, choices[1].hashId);
	f.guest.invalidate('heap-replaced');
	controller.restoreSelection(input, saved, font); controller.refreshDetails(input);
	assert.equal(input.details!.subject, undefined); assert.equal(input.details!.locked, false);
	assert.equal(input.details!.subjectName, ''); assert.equal(input.details!.caption, 'Details');
});

test('the actual floating pane retains locked pins while closed or detached without formatting the hidden client', t => {
	const menuArea = { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight };
	const contextMenu = new ContextMenuController(inputFocus, pointerCapture, menuArea), quickInput = new QuickInputController(contextMenu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: menuArea, kind: 'workspace' });
	t.after(() => { quickInput.dispose(); contextMenu.hide(); });
	const f = fixture(t, ENTRY.replace('return world', `function remove_subject() world._objects = { world._objects[2] } end
function replace_subject() world._objects[2] = { id = 1, definition_id = 'same', active = false, _components = {}, _components_by_class = {} } end
return world`), true, WORLD_SOURCE, []);
	t.after(() => f.stop.dispose());
	const controller = f.controller, input = controller.resolveInput();
	const bounds = { left: 0, top: 20, right: 384, bottom: 270 };
	const surfaces = new WorkbenchSurfaceService();
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('actor pane'), isVisible: () => true,
		getBounds: () => bounds, getClip: () => bounds, draw() {} });
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const previousFont = editorViewState.font, previousLineHeight = editorViewState.lineHeight,
		previousAdvance = editorViewState.charAdvance;
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const pane = new ActorLabEditorPane(commands, contextMenu, surfaces, owner, bounds, f.group, quickInput, inputFocus.workbenchScope);
	t.after(() => {
		inputFocus.setTarget(null); pane.dispose(); surfaces.dispose(); input.dispose();
		editorViewState.font = previousFont; editorViewState.lineHeight = previousLineHeight;
		editorViewState.charAdvance = previousAdvance;
	});
	const choices = readActorChoices(f.sources, f.guest, -1);
	input.domain = -1;
	pane.setInput(input, bounds); pane.update(); pane.focus();
	assert.strictEqual(pane.inputScope.interaction, input.interaction);
	assert.ok(pane.inputScope.runtime?.interaction === input.interaction);
	assert.ok(pane.inputScope.runtime?.target === pane.commandTarget, 'runtime commands retain the logical reading client');
	assert.strictEqual(input.interaction.transport, controller.viewport.transport);
	assert.equal(input.interaction.running, false);
	const contentFocus = inputFocus.target;
	const timelineBounds = { ...bounds };
	const transport = new RuntimeTimelineControl(commands, () => pane.focus(), pane.commandTarget, timelineBounds,
		() => { timelineBounds.top = bounds.bottom - transport.height; });
	t.after(() => transport.dispose());
	transport.attach(surfaces, owner, bounds, contextMenu);
	transport.setContext(pane.commandTarget.scope.runtimeOwner!.runtime); transport.update();
	assert.equal(transport.available, true); assert.equal(transport.visible, false, 'pause alone does not request transport chrome');
	transport.focus();
	assert.equal(transport.visible, true);
	assert.ok(inputFocus.target!.scope === transport.focusScope, 'the Workbench focus command can enter transport without a pointer');
	inputFocus.moveFocus(false);
	assert.ok(inputFocus.target === contentFocus, 'Tab returns through the pane focus owner to its actual reading client');
	transport.focus(); inputFocus.moveFocus(true);
	assert.equal(inputFocus.target, contentFocus, 'Shift+Tab returns to the actual reading client, not its command context');
	transport.setContext(undefined); assert.equal(transport.visible, false);
	assert.equal(controller.selected(input), undefined);
	assert.equal(input.details!.subject, undefined);
	assert.equal(commands.isEnabled('actorLab.details'), false, 'a brand-new empty Details inspection is not admitted');
	input.actorHashId = choices[0].hashId; input.dirty = true;
	pane.update(); input.outline.selectionIndex = 0; input.rememberSelection();
	const originalTree = { ...input.outline.layout }, originalPreview = { ...input.previewBounds };
	const selectedRow = input.outline.rows[input.outline.selectionIndex];
	bounds.left += 115; bounds.right += 115; pane.layout(bounds); pane.update();
	assert.equal(input.outline.layout.contentLeft, originalTree.contentLeft + 115, 'the Actor outline consumes its actual translated client');
	assert.equal(input.outline.layout.contentRight, originalTree.contentRight + 115);
	assert.equal(input.previewBounds.left, originalPreview.left + 115);
	assert.equal(input.previewBounds.right, originalPreview.right + 115);
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], selectedRow);
	bounds.left -= 115; bounds.right -= 115; pane.layout(bounds); pane.update();
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
	controller.openStateGraph(input, editorViewState.font.renderFont()); pane.update();
	const graph = input.stateGraph!, graphModel = graph.viewport.model, graphSelection = graph.viewport.selection;
	const graphCanvas = { ...graph.viewport.canvas };
	const overlay = createHostOverlayFixture(512, 288);
	for (const retired of [false, true]) {
		if (retired) { graph.retire('heap-replaced'); pane.update(); }
		const draws: { x: number; y: number; text: string }[][] = [];
		for (const offset of [0, 115]) {
			bounds.left = offset; bounds.right = 384 + offset; pane.layout(bounds); pane.update();
			assert.equal(graph.viewport.canvas.left, graphCanvas.left + offset);
			assert.equal(graph.viewport.canvas.right, graphCanvas.right + offset);
			if (!retired) {
				assert.strictEqual(graph.viewport.model, graphModel, 'client translation does not rebuild the physical FSM projection');
				assert.strictEqual(graph.viewport.selection, graphSelection);
			}
			overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); pane.draw(); overlay.renderer.endFrame();
			const frame = overlay.queue.consumeOverlayFrame(), glyphs: { x: number; y: number; text: string }[] = [];
			let transform = IDENTITY_HOST_OVERLAY_TRANSFORM;
			for (let index = 0; index < frame.commandCount; index++) {
				if (frame.commandKinds[index] === Host2DKind.Transform) transform = frame.commandRefs[index] as HostOverlayTransform;
				else if (frame.commandKinds[index] === Host2DKind.Glyphs) {
					const run = frame.commandRefs[index] as GlyphRenderSubmission;
					glyphs.push({ x: run.x * transform.scale + transform.offsetX, y: run.y * transform.scale + transform.offsetY,
						text: (run.items as string).slice(run.item_start, run.item_end) });
				}
			}
			draws.push(glyphs);
		}
		assert.ok(draws[0].length > 0);
		assert.deepEqual(draws[1], draws[0].map(run => ({ ...run, x: run.x + 115 })),
			'the graph header, content and retired-state feedback share the actual canvas origin');
	}
	controller.openOutline(input); input.outline.selectionIndex = 0; input.rememberSelection();
	bounds.left = 0; bounds.right = 384; pane.layout(bounds); pane.update();
	assert.equal(input.split.bounds.top, bounds.top + 2, 'preview geometry no longer reserves duplicate playback and GAME FRAME headers');
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); pane.draw(); overlay.renderer.endFrame();
	const frame = overlay.queue.consumeOverlayFrame(), chromeText: string[] = [];
	for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
		const run = frame.commandRefs[index] as GlyphRenderSubmission;
		chromeText.push((run.items as string).slice(run.item_start, run.item_end));
	}
	assert.ok(!chromeText.includes('PAUSED') && !chromeText.includes('GAME FRAME'));
	assert.ok(!chromeText.includes('+') && !chromeText.includes('-'), 'tree disclosures render shared chevrons, not text font symbols');
	pane.focus(); commands.execute('actorLab.details');
	const details = input.details!, subject = details.subject!, path = details.subjectPath;
	controller.pinProperty(input, details.items.find(item => item.label === 'Active')!); pane.update();
	const pin = details.watches.pins[0], preview = { ...input.previewBounds };
	commands.execute('actorLab.lockDetails', pane.inspector.focusTarget);
	assert.equal(pane.inspector.visible, true); assert.equal(input.detailsWindow.open, true);
	assert.deepEqual(input.previewBounds, preview, 'floating Details never reserve a preview split');
	const defaultBounds = { ...input.detailsWindow.requestedBounds }, retainedSubject = input.details!.subject;
	assert.ok(input.windowPlacements[0] === input.detailsWindow); assert.equal(input.windowPlacements.length, 1);
	input.detailsWindow.setRequestedBounds({ left: 10, top: 30, right: 210, bottom: 150 });
	pane.detailsWindow.resetPlacement(); pane.update();
	assert.equal(input.detailsWindow.placementInitialized, true); assert.deepEqual(input.detailsWindow.requestedBounds, defaultBounds);
	assert.ok(input.details!.subject === retainedSubject); assert.equal(input.details!.locked, true);
	pane.detailsWindow.hide(); for (const placement of input.windowPlacements) placement.requestDefaultPlacement();
	pane.update(); assert.equal(input.detailsWindow.placementInitialized, false); assert.equal(input.detailsWindow.open, false);
	input.detailsWindow.open = true; pane.update();
	assert.equal(input.detailsWindow.placementInitialized, true); assert.deepEqual(input.detailsWindow.requestedBounds, defaultBounds);
	assert.ok(input.details!.subject === retainedSubject); assert.equal(input.details!.locked, true);
	for (const target of [pane.detailsWindow.focusTarget, pane.inspector.focusTarget]) {
		assert.equal(commands.isEnabled('actorLab.select', target), true);
		assert.equal(commands.isEnabled('actorLab.find', target), true);
		assert.equal(inputFocus.getCommand('actorLab.actions', target), undefined, 'subject mutation cannot accidentally use tree selection');
		assert.equal(inputFocus.getCommand('actorLab.call', target), undefined);
	}
	pane.detailsWindow.focusTarget.focus(); commands.execute('actorLab.select');
	assert.equal(quickInput.visible, true, 'the real running-actor picker is available from the Details scope');
	inputFocus.handleKeyboard(new KeyInputEvent('ArrowDown', KeyModifier.none));
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none)); pane.update();
	assert.equal(quickInput.visible, false); assert.equal(input.actorHashId, choices[1].hashId);
	pane.detailsWindow.hide();
	const formatting = t.mock.method(f.guest, 'formatStoredEntries');
	const valueFormatting = t.mock.method(f.guest, 'formatValue');
	const projectPins = t.mock.method(details.watches, 'refresh');
	for (let frame = 0; frame < 1000; frame++) pane.update();
	assert.equal(formatting.mock.callCount(), 0); assert.equal(projectPins.mock.callCount(), 0);
	assert.equal(valueFormatting.mock.callCount(), 0);
	assert.equal(details.subject, subject); assert.equal(details.subjectPath, path); assert.equal(pin.target, subject);
	assert.equal(controller.selected(input)!.hashId, choices[1].hashId);
	const presentHistory = f.runtime.machine.cpu.captureRuntimeState();
	pane.detailsWindow.show(false); pane.update();
	f.guest.invalidate('history-restored');
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('remove_subject') as Closure, []);
	pane.update();
	assert.equal(details.subject, subject); assert.equal(details.locked, true);
	assert.equal(details.available, false); assert.equal(details.retired, false, 'historical absence does not retire the locked identity');
	assert.equal(input.detailsWindow.title, details.caption, 'window chrome consumes the compact caption, not the full subject path');
	assert.match(input.detailsWindow.title, /Unavailable$/, 'the visible window reports actual historical availability');
	f.guest.invalidate('history-restored');
	f.runtime.machine.cpu.restoreRuntimeState(presentHistory);
	pane.update();
	assert.equal(details.subject, subject); assert.equal(details.locked, true);
	assert.equal(details.available, true); assert.equal(details.retired, false);
	assert.doesNotMatch(input.detailsWindow.title, /Unavailable$/, 'the same historical identity becomes available again');
	pane.detailsWindow.hide();
	const resolveSubject = t.mock.method(details, 'resolveSubject');
	const projectDetails = t.mock.method(details, 'refresh');
	const layoutDetails = t.mock.method(pane.inspector, 'layout');
	const hiddenFormats = formatting.mock.callCount(), hiddenPins = projectPins.mock.callCount();
	f.guest.invalidate('history-restored');
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('remove_subject') as Closure, []);
	pane.update();
	for (let frame = 0; frame < 1000; frame++) pane.update();
	assert.equal(resolveSubject.mock.callCount(), 0, 'hidden Details add no identity reads at dirty or clean observations');
	assert.equal(projectDetails.mock.callCount(), 0); assert.equal(projectPins.mock.callCount(), hiddenPins);
	assert.equal(layoutDetails.mock.callCount(), 0); assert.equal(formatting.mock.callCount(), hiddenFormats);
	f.guest.invalidate('history-restored');
	f.runtime.machine.cpu.restoreRuntimeState(presentHistory);
	pane.detailsWindow.show(false); pane.update();
	assert.equal(details.subject, subject); assert.equal(details.available, true);
	resolveSubject.mock.restore(); projectDetails.mock.restore(); layoutDetails.mock.restore();
	assert.equal(pane.inspector.visible, true); assert.equal(pin.item.value, 'true');
	assert.equal(details.subject, subject); assert.deepEqual(input.previewBounds, preview);
	const popupScope = new InputFocusScope(Symbol('Details property popup'));
	const popup = surfaces.attach({ role: 'transient', outsidePress: 'consume', captureScope: popupScope.surfaceScope,
		lifetimeOwner: pane.detailsWindow.clientSurface!, isVisible: () => true,
		getBounds: () => input.detailsWindow.client, getClip: () => bounds, draw() {} });
	const popupFocus = inputFocus.createTarget(pane.inspector.focusTarget, popupScope);
	popupFocus.bindKeyboard(() => {});
	popupFocus.focus();
	pane.updateStatus();
	assert.equal(pane.statusItems[0].text, details.title,
		'a promoted property popup keeps the locked Details subject, not the independently selected tree subject');
	pane.focus();
	pane.updateStatus();
	assert.notEqual(pane.statusItems[0].text, details.title,
		'unrelated focus cannot keep the Details status active');
	popup.dispose();
	pane.detailsWindow.hide();
	const saved = pane.getSelection(); t.after(() => saved.dispose());
	const beforeNavigation = formatting.mock.callCount();
	pane.setOptions(undefined, saved); pane.update();
	assert.equal(input.detailsWindow.open, false); assert.equal(details.available, true);
	assert.equal(details.subject, subject); assert.equal(pin.target, subject);
	assert.equal(formatting.mock.callCount(), beforeNavigation, 'navigation with closed Details resolves the subject without projecting properties');
	input.interaction.running = true;
	pane.clearInput();
	assert.equal(input.interaction.running, false);
	assert.equal(input.interaction.transport, null);
	assert.equal(pane.inputScope.interaction, undefined);
	assert.equal(pane.inputScope.runtime, undefined);
	assert.equal(input.detailsWindow.open, false);
	f.guest.invalidate('history-restored');
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('remove_subject') as Closure, []);
	const before = formatting.mock.callCount();
	f.guest.willEndHistoryReview();
	assert.equal(details.retired, true); assert.equal(pin.retired, true);
	assert.equal(formatting.mock.callCount(), before, 'hidden branch admission resolves identity, not property presentation');
	pane.setInput(input, bounds); pane.update();
	assert.strictEqual(input.interaction.transport, controller.viewport.transport);
	assert.equal(input.interaction.running, false, 'reattachment cannot restore capture authority');
	assert.equal(pane.inspector.visible, false); assert.equal(details.subject, subject); assert.equal(details.available, false);
	assert.match(details.title, /UNAVAILABLE$/);
	f.guest.invalidate(); runCompletionClosure(f.runtime.machine.cpu, f.guest.global('replace_subject') as Closure, []); pane.update();
	const world = runtimeWorld(f.sources, f.guest, -1)!, replacement = (f.guest.readStringMember(world, '_objects') as Table).getInteger(2) as Table;
	assert.equal(f.guest.readStringMember(replacement, 'id'), 1);
	assert.notEqual(replacement.hashId, subject.actorHashId, 'the replacement really is another instance with the original name');
	pane.focus(); commands.execute('actorLab.details'); pane.update();
	assert.equal(details.subject, subject); assert.equal(details.available, false); assert.equal(pin.retired, true);
	assert.ok(pane.inspector.model.rows.some(row => row.element.label === 'INSTANCE UNAVAILABLE'));
	pane.detailsWindow.hide();
	f.guest.invalidate('heap-replaced'); pane.update();
	assert.equal(details.retired, true); assert.equal(details.subject, subject); assert.equal(pin.retired, true);
	assert.equal(controller.selected(input), undefined);
	pane.focus();
	const treeFocus = inputFocus.target;
	assert.equal(commands.isEnabled('actorLab.details'), true, 'retained unavailable Details remain keyboard-activatable');
	const beforeActivation = formatting.mock.callCount();
	commands.execute('actorLab.details');
	assert.ok(inputFocus.target === pane.inspector.focusTarget);
	assert.equal(input.detailsWindow.open, true);
	assert.equal(details.subject, subject); assert.equal(details.locked, true); assert.equal(details.available, false);
	commands.execute('window.hide');
	assert.equal(input.detailsWindow.open, false);
	assert.equal(inputFocus.target, treeFocus);
	assert.equal(commands.isEnabled('actorLab.details'), true, 'a retained locked subject admits reopening without a current tree target');
	commands.execute('actorLab.details');
	assert.ok(inputFocus.target === pane.inspector.focusTarget);
	assert.equal(input.detailsWindow.open, true);
	assert.equal(details.subject, subject); assert.equal(details.locked, true); assert.equal(details.available, false);
	assert.equal(formatting.mock.callCount(), beforeActivation, 'an unavailable historical subject cannot format guest properties when reopened');
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Actor timeline layout translates with its client and invalidates an inset-only change`, t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const input = f.controller.resolveInput(); t.after(() => input.dispose());
	const previousFont = editorViewState.font, previousHeight = editorViewState.lineHeight, previousAdvance = editorViewState.charAdvance;
	configureFontVariant(variant);
	t.after(() => { editorViewState.font = previousFont; editorViewState.lineHeight = previousHeight; editorViewState.charAdvance = previousAdvance; });
	const bounds = { left: 0, top: 20, right: 384, bottom: 270 };
	updateFullWidthWorkbenchLayout(input.layout, bounds);
	input.timeline.positionLabel = '0 MS'; input.timeline.durationLabel = '1000 MS';
	input.timelineLayout.update(input.timeline, input.layout);
	const original = { ...input.timeline.slider.bounds }, duration = input.timelineLayout.durationLeft;
	const measure = t.mock.method(editorViewState.font, 'advance');
	bounds.left += 115; bounds.right += 115;
	updateFullWidthWorkbenchLayout(input.layout, bounds); input.timelineLayout.update(input.timeline, input.layout);
	assert.equal(input.timeline.slider.bounds.left, original.left + 115);
	assert.equal(input.timeline.slider.bounds.right, original.right + 115);
	assert.equal(input.timelineLayout.durationLeft, duration + 115);
	bounds.left += 20;
	updateFullWidthWorkbenchLayout(input.layout, bounds); input.timelineLayout.update(input.timeline, input.layout);
	assert.equal(input.timeline.slider.bounds.left, original.left + 135, 'left-only changes invalidate retained timeline geometry');
	for (let frame = 0; frame < 1000; frame++) input.timelineLayout.update(input.timeline, input.layout);
	assert.equal(measure.mock.callCount(), 0, 'translation and idle timeline geometry retain measured labels');
});

test('Actor Lab navigation keeps graph edge identity and retires bookmarks at heap replacement or history resume', t => {
	for (const retirement of ['heap-replaced', 'history-resume'] as const) {
		const f = fixture(t); t.after(() => f.stop.dispose());
		const controller = f.controller;
		const input = controller.resolveInput(); t.after(() => input.dispose());
		const font = new Font({ variant: 'tiny' });
		input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId; controller.refresh(input);
		input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
		controller.openStateGraph(input, font);
		const graph = input.stateGraph!, target = graph.selectedTarget!;
		graph.selectTarget(target, 'edge'); graph.viewport.layout(0, 0, 120, 100);
		graph.viewport.setZoom(2); graph.viewport.pan(15, 20);
		const saved = controller.captureSelection(input), scroll = [graph.viewport.scrollX, graph.viewport.scrollY];
		controller.openOutline(input);
		controller.restoreSelection(input, saved, font); saved.restoreViewport(input);
		assert.equal(input.stateGraph, graph, 'common Source and Back reuses the same graph and its layout');
		assert.equal(graph.viewport.selection!.kind, 'edge'); assert.deepEqual(graph.selectedTarget, target);
		assert.deepEqual([graph.viewport.scrollX, graph.viewport.scrollY], scroll); assert.equal(graph.viewport.zoom, 2);
		if (retirement === 'heap-replaced') f.guest.invalidate('heap-replaced'); else f.guest.willEndHistoryReview();
		controller.restoreSelection(input, saved, font);
		assert.equal(input.actorHashId, 0); assert.equal(controller.selected(input), undefined);
		assert.equal(input.stateGraph, undefined); assert.equal(input.follow.target, undefined);
		saved.dispose();
	}
});

test('Actor Lab navigation retains an absent member without selecting a different receiver', t => {
	for (const presentation of ['outline', 'graph'] as const) {
		const f = fixture(t, ENTRY.replace('return world', "function remove_state() probe._components[1]._machines[1].state_ids = { 'concurrent' } end\nreturn world"));
		t.after(() => f.stop.dispose());
		const controller = f.controller;
		const input = controller.resolveInput(); t.after(() => input.dispose());
		const font = new Font({ variant: 'tiny' }), cpu = f.runtime.machine.cpu;
		input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId; controller.refresh(input);
		input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.name === 'idle'); input.rememberSelection();
		if (presentation === 'graph') controller.openStateGraph(input, font);
		const saved = controller.captureSelection(input), alive = cpu.captureRuntimeState();
		f.guest.invalidate(); runCompletionClosure(cpu, f.guest.global('remove_state') as Closure, []);
		controller.restoreSelection(input, saved, font);
		assert.equal(controller.selected(input), undefined);
		assert.deepEqual(presentation === 'outline' ? input.selectionPath : input.stateGraph!.selectionBookmark!.path, saved.target!.path);
		const absent = controller.captureSelection(input);
		assert.deepEqual(absent.target!.path, saved.target!.path, 'capturing an unavailable view keeps the requested typed membership');
		f.guest.invalidate('history-restored'); cpu.restoreRuntimeState(alive); controller.refresh(input); input.stateGraph?.layout(font);
		assert.equal(controller.selected(input)!.name, 'idle', 'the original historical member becomes actionable only after reacquisition');
		saved.dispose(); absent.dispose();
	}
});

test('FSM graph consumes actual activity and typed membership, retains geometry through restore, and retires renamed instances', t => {
	const f = fixture(t, ENTRY.replace('return world', `function move() probe._components[1]._machines_by_id.same.current_id = nil end
function disable() probe._components[1].enabled = false end
function rename_machine()
	local machines = probe._components[1]._machines_by_id
	machines.renamed = machines.same
	machines.renamed.localdef_id = 'renamed'
	machines.same = nil
end
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true), choice = readActorChoices(f.sources, f.guest, -1)[0];
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const machine = input.runtime.roots[0].children[0].children[0], font = new Font({ variant: 'tiny' });
	const target = captureActorTarget(-1, runtimeWorld(f.sources, f.guest, -1)!.hashId, input.runtime.roots, machine, f.guest);
	const graph = input.stateGraph = new ActorStateGraph(target, font);
	const cpu = f.runtime.machine.cpu, heap = cpu.luaHeap.usedBytes(), alive = cpu.captureRuntimeState();
	graph.refresh(input.runtime.roots, f.guest); graph.layout(font);
	const model = graph.viewport.model, nodes = model.nodes, active = nodes.map(node => node.active);
	assert.equal(nodes.length, 3); assert.equal(model.edges.length, 2);
	assert.ok(nodes.every(node => node.active), 'main and concurrent child follow their active ancestor');
	graph.viewport.selection = nodes[1]; graph.viewport.pan(25, 30);
	let measurements = 0;
	t.mock.method(font, 'measure', () => { measurements++; return 1; });
	graph.layout(font); assert.equal(measurements, 0);
	input.invalidate(); f.guest.invalidate();
	runCompletionClosure(cpu, f.guest.global('move') as Closure, []); projection.update(); graph.layout(font);
	assert.strictEqual(graph.viewport.model, model); assert.equal(measurements, 0);
	assert.strictEqual(graph.viewport.selection, nodes[1]);
	assert.equal(nodes.find(node => node.name === 'idle')!.active, false); assert.equal(nodes.find(node => node.name === 'concurrent')!.active, true);
	const scroll = [graph.viewport.scrollX, graph.viewport.scrollY];
	input.invalidate(); f.guest.invalidate();
	runCompletionClosure(cpu, f.guest.global('disable') as Closure, []); projection.update(); graph.layout(font);
	assert.ok(nodes.every(node => !node.active), 'disabled owner masks retained child selections');
	input.invalidate('history-restored'); cpu.restoreRuntimeState(alive); projection.update(); graph.layout(font);
	assert.deepEqual(nodes.map(node => node.active), active); assert.strictEqual(graph.viewport.model, model);
	assert.deepEqual([graph.viewport.scrollX, graph.viewport.scrollY], scroll);
	assert.equal(cpu.luaHeap.usedBytes(), heap, 'graph projection allocates no guest values');
	graph.viewport.selection = model.edges[0];
	graph.layout(new Font({ variant: 'msx' }));
	assert.equal(graph.viewport.selection!.kind, 'edge');
	assert.equal(resolveActorTarget(input.runtime.roots, graph.selectedTarget!, f.guest)!.hashId, nodes[1].hashId,
		'font relayout preserves the selected physical relationship');
	input.invalidate(); f.guest.invalidate();
	runCompletionClosure(cpu, f.guest.global('rename_machine') as Closure, []); projection.update(); graph.layout(font);
	assert.equal(graph.status, 'missing'); assert.equal(graph.selectedTarget, undefined);
	assert.equal(graph.viewport.model.nodes.length, 3, 'missing membership retains only display geometry');
	assert.ok(graph.viewport.model.nodes.every(node => !node.active), 'missing membership cannot retain live activity');
	input.invalidate('history-restored'); cpu.restoreRuntimeState(alive); projection.update(); graph.layout(font);
	assert.equal(graph.status, 'available', 'history restores the original typed membership');
	graph.retire('missing'); graph.layout(font);
	input.invalidate('history-restored'); cpu.restoreRuntimeState(alive); projection.update(); graph.layout(font);
	assert.equal(graph.status, 'missing', 'a retired live-branch membership needs an explicit new selection');
	input.dispose();
});

test('FSM graph selection distinguishes two memberships of the same physical state table', t => {
	const f = fixture(t, ENTRY.replace('return world', `local machine = probe._components[1]._machines_by_id.same
machine.states.alias = machine.states.idle
machine.state_ids[3] = 'alias'
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true), choice = readActorChoices(f.sources, f.guest, -1)[0];
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const machine = input.runtime.roots[0].children[0].children[0], font = new Font({ variant: 'tiny' });
	const target = captureActorTarget(-1, runtimeWorld(f.sources, f.guest, -1)!.hashId, input.runtime.roots, machine, f.guest);
	const graph = input.stateGraph = new ActorStateGraph(target, font);
	graph.refresh(input.runtime.roots, f.guest); graph.layout(font);
	const nodes = graph.viewport.model.nodes;
	const idle = nodes.find(node => node.name === 'idle')!, alias = nodes.find(node => node.name === 'alias')!;
	assert.equal(idle.hashId, alias.hashId);
	assert.equal(idle.active, true); assert.equal(alias.active, false);
	graph.viewport.selection = alias;
	const selected = graph.selectedTarget!;
	assert.strictEqual(resolveActorTarget(input.runtime.roots, selected, f.guest), machine.children.find(node => node.name === 'alias'));
	graph.layout(new Font({ variant: 'msx' }));
	assert.strictEqual(graph.selectedTarget, selected);
	input.dispose();
});

test('outline selection follows typed membership across graph return, topology changes and history gaps', t => {
	const f = fixture(t, ENTRY.replace('return world', `local machine = probe._components[1]._machines[1]
machine.states.alias = machine.states.idle
machine.state_ids[3] = 'alias'
function add_alias() machine.states.earlier = machine.states.idle; machine.state_ids[4] = 'earlier' end
function remove_idle() machine.states.idle = nil; machine.state_ids = { 'concurrent', 'alias' } end
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const machine = input.runtime.roots[0].children[0].children[0], cpu = f.runtime.machine.cpu;
	const target = captureActorTarget(-1, runtimeWorld(f.sources, f.guest, -1)!.hashId, input.runtime.roots, machine, f.guest);
	const graph = input.stateGraph = new ActorStateGraph(target, new Font({ variant: 'tiny' }));
	graph.refresh(input.runtime.roots, f.guest); graph.layout(new Font({ variant: 'tiny' }));
	graph.viewport.selection = graph.viewport.model.nodes.find(node => node.name === 'idle')!;
	const selected = resolveActorTarget(input.runtime.roots, graph.selectedTarget!, f.guest)!;
	assert.equal(machine.children.filter(node => node.hashId === selected.hashId).length, 2);
	projection.reveal(selected);
	const row = input.outline.rows[input.outline.selectionIndex];
	assert.strictEqual(row.element.node, selected, 'return from graph selects the actual membership, not its first table alias');
	input.invalidate(); runCompletionClosure(cpu, f.guest.global('add_alias') as Closure, []); projection.update();
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], row);
	const alive = cpu.captureRuntimeState();
	input.invalidate('history-restored'); runCompletionClosure(cpu, f.guest.global('remove_idle') as Closure, []); projection.update();
	assert.equal(input.outline.selectionIndex, -1, 'a surviving alias is not a replacement selection');
	assert.notEqual(input.selectionPath, undefined);
	input.invalidate('history-restored'); cpu.restoreRuntimeState(alive); projection.update();
	assert.equal(input.outline.rows[input.outline.selectionIndex].element.node.path, selected.path);
});

test('Actor Lab topology anchoring retains fractional progress through small wheel occurrences', t => {
	const f = fixture(t, ENTRY.replace('return world', `local machine = probe._components[1]._machines[1]
function add_earlier() machine.states.earlier = machine.states.idle; machine.state_ids[3] = 'earlier' end
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest), outline = input.outline;
	projection.update(); outline.updateLayout(0, 0, 160, 10, 10, 8); projection.layout();
	const anchor = outline.rows.find(row => row.element.node.name === 'idle')!;
	const originalIndex = outline.rows.indexOf(anchor);
	outline.scroll = originalIndex + 0.25;
	input.invalidate(); runCompletionClosure(f.runtime.machine.cpu, f.guest.global('add_earlier') as Closure, []);
	assert.equal(projection.update(), true);
	outline.updateLayout(0, 0, 160, 10, 10, 8); projection.layout();
	const shiftedIndex = outline.rows.indexOf(anchor);
	assert.equal(shiftedIndex, originalIndex + 1);
	assert.equal(outline.scroll, shiftedIndex + 0.25);
	for (let step = 2; step <= 4; step++) {
		outline.scroll += 0.25;
		input.invalidate(); f.guest.invalidate('execution'); projection.update();
		outline.updateLayout(0, 0, 160, 10, 10, 8); projection.layout();
		assert.equal(outline.scroll, shiftedIndex + step * 0.25);
	}
});

test('World pages retain typed identities; Actor Lab and tool trees consume real class indices, not names', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	const first = f.actors.list(0, 1), second = f.actors.list(1, 1);
	assert.equal(first.status, 'available'); assert.equal(first.total, 2);
	assert.equal(first.actors![0].id.kind, 'number'); assert.equal(second.actors![0].id.kind, 'string');
	assert.notEqual(first.actors![0].reference, second.actors![0].reference);
	assert.deepEqual(f.actors.list(5, 1).actors, []);
	const scope = f.stop.scopes[0];
	const probe = f.stop.read(scope.reference!, 0, scope.count!).entries.find(entry => entry.key.display === 'probe')!.value;
	assert.equal(probe.reference, first.actors![0].object.reference, 'domain roots share aliases with globals');
	assert.equal(f.stop.read(probe.reference!, 0, 100).entries.find(entry => entry.key.display === 'self')!.value.reference, probe.reference);
	const tree = f.actors.tree(first.actors![0].reference, 0, 100);
	assert.deepEqual(tree.nodes.map(node => node.kind), ['actor', 'component', 'machine', 'state', 'state', 'component']);
	assert.equal(tree.nodes.at(-1)!.children, 0, 'a class-shaped/named table is still a generic component');
	assert.equal(tree.nodes.find(node => node.label === 'concurrent')!.activity.value, true);
	const choices = readActorChoices(f.sources, f.guest, f.stop.state.activeCartridge), input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true);
	input.domain = choices[0].domain; input.actorHashId = choices[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	assert.equal(projection.update(), true);
	assert.deepEqual(input.outline.rows.map(row => row.element.node.kind), tree.nodes.map(node => node.kind));
	assert.deepEqual(input.outline.rows.map(row => f.stop.values.describe(row.element.node.value).reference), tree.nodes.map(node => node.object.reference));
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
	input.dispose();
});

test('tree paging and repeated detail reads do not repeat semantic traversal or formatting', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const actor = f.actors.list(0, 1).actors![0].reference;
	let visits = 0;
	const original = f.guest.visitTableEntries.bind(f.guest);
	t.mock.method(f.guest, 'visitTableEntries', (...args: Parameters<typeof original>) => { visits++; return original(...args); });
	const first = f.actors.tree(actor, 0, 3), visited = visits, rest = f.actors.tree(actor, 3, 10);
	assert.equal(visits, visited); assert.equal(first.total, first.nodes.length + rest.nodes.length);
	assert.equal(first.nodes[2].parent, first.nodes[1].reference);
	const state = f.actors.read(rest.nodes.find(node => node.label === 'idle')!.reference), detailed = visits;
	assert.strictEqual(f.actors.read(state.reference).properties, state.properties);
	assert.equal(visits, detailed);
	const fields = f.stop.read(state.object.reference!, 0, 100).entries;
	const data = fields.find(entry => entry.key.display === 'data')!.value.reference!;
	assert.equal(f.stop.read(data, 0, 100).entries[0].value.display, '42', 'human property summaries do not replace expandable values');
});

test('operation identities preserve guest tags and typed membership without retaining borrowed nodes', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const cpu = f.runtime.machine.cpu, guest = f.guest;
	const candidates: Value[] = [null, false, true, 1, valueString(cpu.stringPool.intern('1')),
		guest.global('probe'), guest.global('rename'), cpu.activeThread, createBuiltinFunction(BuiltinFunctionId.Type)];
	const heap = cpu.luaHeap.usedBytes(), identities = candidates.map(value => guest.identity(value));
	for (let i = 0; i < candidates.length; i++) for (let j = 0; j < candidates.length; j++) {
		assert.equal(guest.matchesIdentity(candidates[i], identities[j]), i === j);
	}
	const choices = readActorChoices(f.sources, guest, -1), input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true);
	input.domain = -1; input.actorHashId = choices[0].hashId;
	const projection = new ActorProjection(input, f.sources, guest); projection.update();
	const selected = input.runtime.roots[0].children[0].children[0].children[0];
	const target = captureActorTarget(-1, 123, input.runtime.roots, selected, guest);
	const original = JSON.stringify(target);
	assert.equal(resolveActorTarget(input.runtime.roots, target, guest), selected);
	input.runtime.roots[0].children.reverse();
	assert.equal(resolveActorTarget(input.runtime.roots, target, guest), selected, 'membership is independent of sibling order');
	selected.key = 1;
	assert.equal(resolveActorTarget(input.runtime.roots, target, guest), undefined, 'another typed key cannot retarget a retained request');
	input.invalidate(); guest.invalidate();
	assert.equal(JSON.stringify(target), original, 'clearing borrowed nodes cannot alter the scalar operation target');
	projection.update();
	assert.equal(resolveActorTarget(input.runtime.roots, target, guest)!.hashId, selected.hashId);
	runCompletionClosure(cpu, guest.global('rename') as Closure, []);
	projection.update();
	assert.equal(resolveActorTarget(input.runtime.roots, target, guest), undefined, 'renamed membership must be selected again');
	assert.equal(cpu.luaHeap.usedBytes(), heap, 'identity capture and discovery allocate no guest values');
	input.dispose();
});

test('operation discovery is read-only and rejects absent actions, methods and executable arguments', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const actor = f.actors.list(0, 1).actors![0].reference, nodes = f.actors.tree(actor, 0, 100).nodes;
	const root = nodes[0], state = nodes.find(node => node.kind === 'state')!;
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	assert.equal(f.actors.operations(root.reference).actions[0].name, 'set_pos');
	assert.equal(f.actors.operations(state.reference).actions[0].name, 'transition_to');
	assert.equal(f.actors.invocation(root.reference, 'action', 'set_pos', '1, 2, 3').kind, 'action');
	assert.throws(() => f.actors.invocation(root.reference, 'action', 'transition_to', ''), /not available/);
	assert.throws(() => f.actors.invocation(root.reference, 'method', 'absent', ''), /not a stored/);
	assert.throws(() => f.actors.invocation(root.reference, 'action', 'set_pos', 'os.exit()'));
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
	f.guest.invalidate();
	assert.throws(() => f.actors.operations(root.reference), /expired/);
	assert.throws(() => f.actors.invocation(root.reference, 'action', 'set_pos', '1, 2, 3'), /expired/);
});

test('unloaded, uninitialized and actually empty World are distinct observations', t => {
	for (const [entry, run, status] of [['return 0', true, 'not_loaded'], [ENTRY, false, 'uninitialized'],
		[`${ENTRY.replace('return world', 'world._objects = {} return world')}`, true, 'available']] as const) {
		const f = fixture(t, entry, run), result = f.actors.list(0, 10);
		assert.equal(result.status, status);
		if (status === 'available') { assert.equal(result.total, 0); assert.deepEqual(result.actors, []); }
		else assert.equal(result.total, undefined);
		f.stop.dispose();
	}
});

for (const reason of ['execution', 'history-restored', 'heap-replaced'] as const) test(`${reason} retires actor handles, typed roots and domain borrows together`, t => {
	const f = fixture(t), actor = f.actors.list(0, 1).actors![0], node = f.actors.tree(actor.reference, 0, 1).nodes[0];
	f.guest.invalidate(reason);
	assert.throws(() => f.actors.list(0, 1), /expired/);
	assert.throws(() => f.actors.tree(actor.reference, 0, 1), /expired/);
	assert.throws(() => f.actors.read(node.reference), /expired/);
	assert.throws(() => f.stop.read(actor.object.reference!, 0, 1), /expired/);
	const next = f.inspection.open(), actors = next.lifetime.add(new ActorRuntimeInspection(next));
	assert.throws(() => actors.tree(actor.reference, 0, 1), /does not belong/);
	assert.throws(() => actors.read(node.reference), /does not belong/);
	next.dispose();
});

test('Actor Lab separates compact semantic labels from actual component identities and owner-qualified names', t => {
	const source = `local fsm<const> = require('cartlib/fsm/fsm_component')
local timelines<const> = require('cartlib/timeline/timeline_component')
local left<const> = { localdef_id = 'demo.actor.left.same', states = {}, state_ids = {}, current_id = nil }
local right<const> = { localdef_id = 'demo.actor.right.same', states = {}, state_ids = {}, current_id = nil }
local alias<const> = { localdef_id = 'left.same', states = {}, state_ids = {}, current_id = nil }
local timeline<const> = { id = 1, enabled = true, _owner_component_index = 1, _entries_by_id = { ['demo.actor.blank'] = { playing = true } } }
local first<const> = { id = 2, enabled = true, _owner_component_index = 2, _started = true, _machines = { left, right, alias } }
local second<const> = { id = 3, enabled = true, _owner_component_index = 3, _started = true, _machines = { right } }
local actor<const> = { id = 'demo.actor', definition_id = 'demo.actor', active = true,
 _components = { timeline, first, second }, _components_by_class = { [fsm] = { first, second }, [timelines] = { timeline } } }
first.owner = actor; second.owner = actor; timeline.owner = actor
return { _objects = { actor } }`;
	const f = fixture(t, `local world<const> = require('cartlib/world/world')
local fsm<const> = require('cartlib/fsm/fsm_component')
function remove_component() world._objects[1]._components[3] = nil; world._objects[1]._components_by_class[fsm][2] = nil end
return world`, true, source);
	const choice = readActorChoices(f.sources, f.guest, -1)[0], input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true);
	input.domain = -1; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const root = input.outline.roots[0], [timeline, first, second] = root.children;
	assert.equal(timeline.element.label, 'Timelines');
	assert.equal(timeline.element.node.label, 'TIMELINES 1', 'full runtime label still identifies the real component ID');
	assert.equal(first.element.label, 'State machines #2'); assert.equal(second.element.label, 'State machines #3');
	assert.equal(timeline.children[0].element.label, 'blank');
	assert.equal(first.children[0].element.label, 'demo.actor.left.same', 'a qualified name keeps its distinction from an actual unqualified sibling');
	assert.equal(first.children[1].element.label, 'right.same'); assert.equal(first.children[2].element.label, 'left.same');
	assert.equal(second.children[0].element.label, 'right.same');
	assert.equal(first.children[0].element.node.name, 'demo.actor.left.same');
	assert.equal(second.children[0].element.node.name, 'demo.actor.right.same', 'suffix collisions never discard distinct owner paths');
	input.invalidate(); f.guest.invalidate('execution');
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('remove_component') as Closure, []);
	projection.update();
	assert.equal(root.children[1], first); assert.equal(first.element.label, 'State machines');
	input.dispose(); f.stop.dispose();
});

test('ordinary pane retains stable rows, refreshes changed labels, releases detached branches and clears identities after machine replacement', t => {
	const f = fixture(t), choice = readActorChoices(f.sources, f.guest, f.stop.state.activeCartridge)[0], input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true);
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	assert.equal(input.outline.roots[0].children[0].element.label, 'State machines: states', 'named components retain their authored name');
	const rows = input.outline.rows.slice();
	assert.equal(projection.update(), false);
	assert.ok(rows.every((row, index) => row === input.outline.rows[index]));
	input.outline.roots[0].collapsed = true;
	input.invalidate(); f.guest.invalidate('execution');
	assert.ok(rows.every(row => row.element.node.value === null && row.element.node.key === null));
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('rename') as Closure, []);
	assert.equal(projection.update(), true);
	assert.equal(input.outline.roots[0].element.node.label, 'renamed');
	assert.strictEqual(input.outline.roots[0], rows[0]); assert.equal(input.outline.roots[0].collapsed, true);
	const removed = input.runtime.roots[0].children[1];
	input.invalidate(); f.guest.invalidate('execution');
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('remove') as Closure, []);
	projection.update();
	assert.equal(removed.value, null); assert.equal(removed.receiver, null);
	const root = input.runtime.roots[0];
	input.invalidate('heap-replaced');
	assert.equal(root.value, null); assert.equal(input.actorHashId, 0);
	assert.equal(input.runtime.roots.length, 0); assert.equal(input.outline.rows.length, 0);
	input.dispose(); f.stop.dispose();
});

test('hidden Actor Lab releases borrows once, without revisiting an already released retained tree', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const choice = readActorChoices(f.sources, f.guest, -1)[0], input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true);
	t.after(() => input.dispose());
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	const root = input.runtime.roots[0];
	let value = root.value, releases = 0;
	Object.defineProperty(root, 'value', { get: () => value, set: next => { value = next; if (next === null) releases++; } });
	input.invalidate();
	assert.equal(value, null);
	assert.equal(releases, 1);
	for (let update = 0; update < 1000; update++) input.invalidate();
	assert.equal(releases, 1);
	projection.update();
	assert.notEqual(value, null);
	input.invalidate();
	assert.equal(releases, 2, 'reacquisition owns a new borrow lifetime');
});

test('explicit Actor Lab navigation reveals a retained child through collapsed ancestors', t => {
	const f = fixture(t); t.after(() => f.stop.dispose());
	const choice = readActorChoices(f.sources, f.guest, -1)[0], input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true);
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	const root = input.outline.roots[0], selected = root.children[0].children[0].children[0];
	root.collapsed = true; root.children[0].collapsed = true;
	assert.equal(projection.update(), false, 'changing selection is independent of guest topology');
	assert.equal(projection.reveal(selected.element.node), true);
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], selected);
	assert.equal(root.collapsed, false); assert.equal(root.children[0].collapsed, false);
	assert.strictEqual(resolveActorPath(input.runtime.roots, input.selectionPath!, f.guest), selected.element.node);
	input.invalidate(); f.guest.invalidate('execution'); projection.update();
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], selected);
	input.dispose();
});

test('history selection borrows restored objects and retires unavailable bookmarks before branching', t => {
	const f = fixture(t, ENTRY.replace('return world', `function add()
	probe._components[3] = { id = 'late', enabled = true, _owner_component_index = 3 }
end
return world`), false), cpu = f.runtime.machine.cpu;
	const beforeBirth = cpu.captureRuntimeState();
	cpu.runUntilDepth(0, 100_000);
	const input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true), choice = readActorChoices(f.sources, f.guest, -1)[0];
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	input.outline.selectionIndex = 3; input.rememberSelection();
	const selected = input.outline.rows[3], original = selected.element.node.value;
	const alive = cpu.captureRuntimeState();
	input.invalidate('history-restored');
	assert.equal(selected.element.node.value, null);
	cpu.restoreRuntimeState(alive);
	projection.update();
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], selected);
	assert.notStrictEqual(selected.element.node.value, original);
	assert.equal(selected.element.node.value!.hashId, selected.element.node.hashId);
	input.invalidate();
	runCompletionClosure(cpu, f.guest.global('add') as Closure, []);
	projection.update();
	input.outline.selectionIndex = input.outline.rows.length - 1; input.rememberSelection();
	const futureHash = input.outline.rows[input.outline.selectionIndex].element.node.hashId;
	input.invalidate('history-restored');
	cpu.restoreRuntimeState(alive);
	projection.update();
	assert.equal(input.actorHashId, choice.hashId);
	assert.equal(input.outline.selectionIndex, -1, 'the actor survives, but its missing child has no replacement selection');
	projection.resumeHistory();
	input.invalidate();
	runCompletionClosure(cpu, f.guest.global('add') as Closure, []);
	projection.update();
	assert.equal(input.outline.rows.at(-1)!.element.node.hashId, futureHash, 'the new branch actually reuses the discarded allocation identity');
	assert.equal(input.outline.selectionIndex, -1);
	input.invalidate('history-restored');
	cpu.restoreRuntimeState(beforeBirth);
	projection.update();
	assert.equal(input.actorPresent, false);
	assert.equal(input.actorHashId, choice.hashId, 'history retains the pinned identity, not actionable stale data');
	projection.resumeHistory();
	assert.equal(input.actorHashId, 0);
	assert.equal(input.outline.rows.length, 0);
	cpu.runUntilDepth(0, 100_000);
	projection.update();
	assert.equal(input.outline.rows.length, 0, 'a later allocation cannot take over the missing selection');
	input.dispose(); f.stop.dispose();
});

test('conversation admission binds all actor handles to its own stop and prompt lifetime', async t => {
	const f = fixture(t), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.luaEvaluation, f.debuggerExecution, f.actorExecution, f.boots, f.hotResumes, f.events, f.gteHistory, f.gpuHistory, lifetime.signal);
	assert.throws(() => tools.execute('studio_list_actors', { inspection: 'foreign', start: 0, count: 1 }), /current suspended/);
	const opened = await tools.execute('studio_inspect_runtime', { target: f.inspection.target });
	assert.ok('inspection' in opened.data);
	const result = await tools.execute('studio_list_actors', { inspection: opened.data.inspection, start: 0, count: 1 });
	assert.ok('actors' in result.data && result.data.actors);
	const actor = result.data.actors[0].reference;
	await tools.execute('studio_inspect_runtime', { target: f.inspection.target });
	assert.throws(() => tools.execute('studio_read_actor_tree', { actor, start: 0, count: 1 }), /does not belong/);
	lifetime.abort();
	assert.throws(() => tools.execute('studio_read_actor_tree', { actor, start: 0, count: 1 }), /disposed/);
	assert.equal(f.execution.userPaused, true);
	for (const count of [0, -1, 1.5, '1']) assert.throws(() => decodeActorToolRequest('studio_list_actors', { inspection: 'x', start: 0, count }));
	assert.throws(() => decodeActorToolRequest('studio_read_actor_node', { node: 'x', target: 'foreign' }), /declared fields/);
	f.stop.dispose();
});

test('physical target domain, not delayed source activity, selects World after restore', t => {
	const f = fixture(t);
	f.sources.activeCartridgeSlot = 0;
	assert.equal(f.stop.state.activeCartridge, -1);
	assert.equal(f.actors.list(0, 10).total, 2);
	assert.equal(readActorChoices(f.sources, f.guest, f.runtime.machine.cpu.activeCartridgeSlot()).length, 2);
	assert.equal(f.sources.activeCartridgeSlot, 0, 'inspection does not repair or mutate unrelated source activity');
	f.stop.dispose();
});

test('activity predicates consume guest truthiness, including zero and empty string, without Boolean-only normalization', t => {
	const f = fixture(t, ENTRY.replace('return world', `probe.active = 0
probe._components[1].enabled = ''
probe._components[1]._machines_by_id.same.states.concurrent.definition.is_concurrent = 0
return world`));
	const actor = f.actors.list(0, 1).actors![0], tree = f.actors.tree(actor.reference, 0, 100);
	assert.equal(actor.active, true); assert.equal(tree.nodes[1].activity.value, true);
	assert.equal(tree.nodes.find(node => node.label === 'concurrent')!.activity.value, true);
	const actorFields = f.stop.read(actor.object.reference!, 0, 100).entries;
	assert.deepEqual(actorFields.find(entry => entry.key.display === 'active')!.value, { kind: 'number', display: '0' });
	f.stop.dispose();
});

test('Find in Actor preserves and distinguishes same-value aliases under table and function keys', t => {
	const source = WORLD_SOURCE.replace('local fsm<const>', `local effects<const> = require('cartlib/actioneffects/actioneffect_component')
local fsm<const>`).replace('actor.self = actor', `actor.self = actor
local effect<const> = { active_count = 0 }
local first_key<const>, second_key<const> = {}, {}
local first_fn<const>, second_fn<const> = function() return 1 end, function() return 2 end
local component<const> = { id = 'effects', enabled = true, _owner_component_index = 3,
	effects = { [first_key] = effect, [second_key] = effect, [first_fn] = effect, [second_fn] = effect } }
actor._components[3] = component
actor._components_by_class[effects] = { component }`);
	const f = fixture(t, ENTRY, true, source); t.after(() => f.stop.dispose());
	const tree = new ActorRuntimeTree(); t.after(() => tree.dispose());
	tree.update(f.sources, f.guest, -1, f.guest.global('probe') as Table);
	const aliases = tree.roots[0].children[2].children;
	assert.equal(aliases.length, 4);
	assert.equal(new Set(aliases.map(node => node.hashId)).size, 1);
	const selected = aliases[1], provider = createActorMemberChoices(tree.roots, selected);
	const initial = provider.getPicks('');
	assert.equal(provider.items[initial.matches[initial.selectionIndex].itemIndex].node, selected);
	const choices = provider.items.filter(item => item.node.kind === 'effect');
	assert.deepEqual(choices.map(item => item.node), aliases);
	assert.equal(new Set(choices.map(item => item.description)).size, 4, 'aliases are distinguishable without prescribing presentation text');
	assert.equal(new Set(choices.map(item => item.detail)).size, 4, 'each membership has its own visible breadcrumb');
});

test('actor runtime retains source membership separately from stable human-facing order', t => {
	const source = WORLD_SOURCE.replace('local fsm<const>', `local timelines<const> = require('cartlib/timeline/timeline_component')
local effects<const> = require('cartlib/actioneffects/actioneffect_component')
local fsm<const>`).replace('actor.self = actor', `actor.self = actor
local other<const> = { localdef_id = 'alpha', definition = { on = {} }, states = {}, state_ids = {} }
machine.localdef_id = 'zulu'
component._machines = { machine, other }
component._machines_by_id = { zulu = machine, alpha = other }
local timeline<const> = { id = 'times', enabled = true, _owner_component_index = 3, _entries_by_id = {
	zulu = { playing = false }, alpha = { playing = true }, [1] = { playing = false }, ['1'] = { playing = false },
} }
local effect<const> = { id = 'effects', enabled = true, _owner_component_index = 4, effects = {
	zulu = { active_count = 0 }, alpha = { active_count = 1 },
} }
actor._components[3] = timeline
actor._components[4] = effect
actor._components_by_class[timelines] = { timeline }
actor._components_by_class[effects] = { effect }`);
	const entry = ENTRY.replace('return world', `function activity()
	probe._components[1]._machines[1].current_id = nil
	probe._components[3]._entries_by_id.zulu.playing = true
end
function reorder()
	local component = probe._components[1]
	component._machines[1], component._machines[2] = component._machines[2], component._machines[1]
	local machine = component._machines[2]
	machine.state_ids[1], machine.state_ids[2] = machine.state_ids[2], machine.state_ids[1]
end
function insert()
	probe._components[3]._entries_by_id.earlier = { playing = false }
end
function remove_timeline()
	probe._components[3]._entries_by_id.earlier = nil
end
function change_key_type()
	local entries = probe._components[3]._entries_by_id
	entries[1], entries['1'] = entries['1'], entries[1]
end
return world`);
	const f = fixture(t, entry, true, source); t.after(() => f.stop.dispose());
	const tree = new ActorRuntimeTree(); t.after(() => tree.dispose());
	const update = () => tree.update(f.sources, f.guest, -1, f.guest.global('probe') as Table);
	const call = (name: string) => {
		tree.release(); f.guest.invalidate();
		runCompletionClosure(f.runtime.machine.cpu, f.guest.global(name) as Closure, []);
		return update();
	};
	assert.equal(update(), true);
	const root = tree.roots[0], component = root.children[0], machine = component.children[0], timeline = root.children[2], effects = root.children[3];
	assert.deepEqual(component.children.map(node => node.name), ['zulu', 'alpha'], 'machine contributions own machine order');
	assert.deepEqual(machine.children.map(node => node.name), ['concurrent', 'idle']);
	const ids = f.guest.readStringMember(machine.value, 'state_ids') as Table;
	assert.deepEqual([ids.getInteger(1), ids.getInteger(2)].map(value => f.guest.formatValue(value)), ['idle', 'concurrent'], 'display order does not rewrite runtime traversal');
	assert.deepEqual(timeline.children.map(node => node.name), ['1', '1', 'alpha', 'zulu']);
	assert.notDeepEqual(timeline.children[0].keyIdentity, timeline.children[1].keyIdentity, 'equal labels retain distinct guest keys');
	assert.deepEqual(effects.children.map(node => node.name), ['alpha', 'zulu']);
	const stateNodes = machine.children.slice(), timelineNodes = timeline.children.slice(), revisions = [tree.topologyRevision, tree.activityRevision];
	let sorts = 0;
	const originalSort = machine.children.sort, format = t.mock.method(f.guest, 'formatValue');
	Object.defineProperty(machine.children, 'sort', { configurable: true, value: (compare: Parameters<typeof originalSort>[0]) => {
		sorts++; return originalSort.call(machine.children, compare);
	} });
	t.after(() => Reflect.deleteProperty(machine.children, 'sort'));
	assert.equal(update(), false);
	assert.equal(call('activity'), false);
	assert.equal(tree.topologyRevision, revisions[0]); assert.equal(tree.activityRevision, revisions[1] + 1);
	assert.equal(sorts, 0); assert.equal(format.mock.callCount(), 0, 'activity-only refresh does not reformat keys');
	assert.equal(call('reorder'), true);
	assert.strictEqual(component.children[1], machine);
	assert.ok(stateNodes.every((node, index) => node === machine.children[index]), 'runtime ordering changes retain physical nodes');
	assert.equal(call('insert'), true);
	assert.deepEqual(timeline.children.map(node => node.name), ['1', '1', 'alpha', 'earlier', 'zulu']);
	assert.ok(timelineNodes.every(node => timeline.children.includes(node)), 'inserting a sibling cannot replace retained instances');
	const removed = timeline.children[3];
	assert.equal(call('remove_timeline'), true);
	assert.equal(removed.value, null); assert.equal(removed.key, null);
	assert.ok(timelineNodes.every((node, index) => node === timeline.children[index]));
	assert.equal(call('change_key_type'), true);
	assert.ok(!timeline.children.includes(timelineNodes[0]) && !timeline.children.includes(timelineNodes[1]), 'typed membership changes retire nodes even when labels match');
	assert.ok(timeline.children.includes(timelineNodes[2]) && timeline.children.includes(timelineNodes[3]));
});


test('active reveal expands all parallel paths without replacing inspection selection or rebuilding unchanged activity', t => {
	const f = fixture(t, ENTRY.replace('return world', `function move() probe._components[1]._machines[1].current_id = nil end
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	const outline = input.outline;
	outline.updateLayout(0, 0, 160, 30, 10, 8);
	const machine = input.runtime.roots[0].children[0].children[0];
	const inspected = outline.rows.find(row => row.element.node.kind === 'component' && row.element.node.prefix === 'COMPONENT')!;
	outline.selectionIndex = outline.rows.indexOf(inspected);
	input.rememberSelection();
	const machineRow = outline.rows.find(row => row.element.node === machine)!;
	machineRow.collapsed = true;
	const target = captureActorTarget(-1, runtimeWorld(f.sources, f.guest, -1)!.hashId, input.runtime.roots, machine, f.guest);
	input.follow.start(target);
	projection.update();
	assert.equal(projection.revealActive(machine), true);
	outline.updateLayout(0, 0, 160, 30, 10, 8); projection.layout();
	assert.equal(machineRow.collapsed, false);
	assert.strictEqual(outline.rows[outline.selectionIndex], inspected);
	const active = outline.rows.filter(row => row.element.node.kind === 'state' && row.element.node.active);
	assert.equal(active.length, 2);
	assert.ok(active.every(row => outline.rows.indexOf(row) >= outline.scroll && outline.rows.indexOf(row) < outline.scroll + outline.layout.visibleRowCount));
	const rows = outline.rows.slice(); input.follow.pending = undefined;
	projection.update();
	assert.equal(input.follow.pending, undefined);
	assert.ok(rows.every((row, index) => row === outline.rows[index]));
	input.invalidate();
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('move') as Closure, []);
	assert.equal(projection.update(), false, 'activity alone does not rebuild topology');
	assert.strictEqual(input.follow.pending, target);
	assert.strictEqual(outline.rows[outline.selectionIndex], inspected);
	input.follow.stop(); projection.update();
	assert.equal(input.follow.target, undefined); assert.equal(input.follow.pending, undefined);
});

test('parallel tree follow reveals an active row rather than the inactive gap between them', t => {
	const f = fixture(t, ENTRY.replace('return world', `local machine = probe._components[1]._machines[1]
local first = machine.states.concurrent
local last = machine.states.idle
machine.states = { aaa = first, zzz = last }; machine.state_ids = { 'aaa', 'zzz' }; machine.current_id = 'zzz'
for i = 1, 20 do
	local key = 'middle_' .. i
	machine.states[key] = { definition = {}, states = {}, state_ids = {} }
	machine.state_ids[i + 2] = key
end
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const outline = input.outline;
	outline.updateLayout(0, 0, 160, 30, 10, 8); projection.layout();
	projection.reveal(input.runtime.roots[0]); projection.layout();
	outline.scroll = 8;
	const selected = outline.rows[outline.selectionIndex];
	assert.ok(outline.rows.slice(outline.scroll, outline.scroll + 3).every(row => !row.element.node.active));
	projection.revealActive(input.runtime.roots[0].children[0].children[0]); projection.layout();
	assert.ok(outline.rows.slice(outline.scroll, outline.scroll + 3).some(row => row.element.node.active));
	const scroll = outline.scroll;
	projection.revealActive(input.runtime.roots[0].children[0].children[0]); projection.layout();
	assert.equal(outline.scroll, scroll); assert.strictEqual(outline.rows[outline.selectionIndex], selected);
});

test('historical actor absence keeps collapse and follow bookmarks but heap replacement retires them', t => {
	const f = fixture(t, ENTRY, false), cpu = f.runtime.machine.cpu;
	t.after(() => f.stop.dispose());
	const beforeBirth = cpu.captureRuntimeState(); cpu.runUntilDepth(0, 100_000);
	const input = new ActorLabInput(f.controller, 'actor-lab', 'ACTOR LAB', true); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const machine = input.runtime.roots[0].children[0].children[0];
	const row = input.outline.rows.find(row => row.element.node === machine)!;
	row.collapsed = true;
	input.outline.selectionIndex = input.outline.rows.indexOf(row); input.rememberSelection();
	const target = captureActorTarget(-1, runtimeWorld(f.sources, f.guest, -1)!.hashId, input.runtime.roots, machine, f.guest);
	input.follow.start(target);
	const alive = cpu.captureRuntimeState();
	input.invalidate('history-restored'); cpu.restoreRuntimeState(beforeBirth); projection.update();
	assert.equal(input.actorPresent, false); assert.strictEqual(input.follow.target, target);
	assert.equal(row.element.node.value, null);
	input.invalidate('history-restored'); cpu.restoreRuntimeState(alive); projection.update();
	assert.equal(input.actorPresent, true); assert.equal(row.collapsed, true);
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], row);
	assert.strictEqual(input.follow.pending, target);
	input.invalidate('heap-replaced');
	assert.equal(input.follow.target, undefined); assert.equal(input.actorHashId, 0);
});

test('expanded stored values are inspectable selections but never fabricate logical pin commands', t => {
	const worldSource = WORLD_SOURCE.replace('active = true, _components', 'active = true, data = { answer = 42 }, _components');
	const f = fixture(t, ENTRY, true, worldSource); t.after(() => f.stop.dispose());
	const input = f.controller.resolveInput(); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	f.controller.refresh(input); input.outline.selectionIndex = 0; input.rememberSelection(); f.controller.refreshDetails(input);
	const data = input.details!.items.find(item => item.identity?.section === 'instance' && item.identity.field === 'data')!;
	data.expansion!.setExpanded(true); f.controller.refreshDetails(input);
	const stored = input.details!.items.find(item => item.label === 'answer')!;
	assert.equal(stored.value, '42'); assert.ok(stored.identity?.parent);
	assert.equal(stored.watchIdentity, undefined);
	assert.equal(f.controller.canPinProperty(input, stored), false);
	assert.equal(f.controller.canUnpinProperty(input, stored), false);
	assert.equal(f.controller.canRevealPinnedProperty(input, stored), false);
});

for (const historical of [true, false]) test(`navigation restores the original compact Details name when actor A is ${historical ? 'historically unavailable' : 'retired'} after inspecting B`, t => {
	const worldSource = WORLD_SOURCE.replace('id = 1, definition_id', "id = 'actor_a', definition_id")
		.replace("id = '1', definition_id", "id = 'actor_b', definition_id");
	const entry = ENTRY.replace('return world', 'function remove_a() world._objects = { world._objects[2] } end\nreturn world');
	const f = fixture(t, entry, true, worldSource); t.after(() => f.stop.dispose());
	const controller = f.controller, input = controller.resolveInput(); t.after(() => input.dispose());
	const choices = readActorChoices(f.sources, f.guest, -1), font = new Font({ variant: 'tiny' });
	controller.inspectActor(input, -1, choices.find(choice => choice.label === 'actor_a')!.hashId);
	input.outline.selectionIndex = 0; input.rememberSelection(); controller.refreshDetails(input); controller.setDetailsLocked(input, true);
	const subject = input.details!.subject!, saved = controller.captureSelection(input); t.after(() => saved.dispose());
	assert.equal(input.details!.caption, 'actor_a'); assert.equal(saved.detailsSubjectName, 'actor_a');
	controller.setDetailsLocked(input, false);
	controller.inspectActor(input, -1, choices.find(choice => choice.label === 'actor_b')!.hashId);
	input.outline.selectionIndex = 0; input.rememberSelection(); controller.refreshDetails(input);
	assert.equal(input.details!.caption, 'actor_b');
	f.guest.invalidate(historical ? 'history-restored' : 'execution');
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('remove_a') as Closure, []);
	controller.restoreSelection(input, saved, font); controller.refreshDetails(input);
	assert.equal(input.details!.subject, subject); assert.equal(input.details!.locked, true); assert.equal(input.details!.available, false);
	assert.equal(input.details!.retired, !historical);
	assert.match(input.details!.title, /actor_a.*UNAVAILABLE$/); assert.ok(!input.details!.title.includes('actor_b'));
	assert.equal(input.details!.caption, 'actor_a — Unavailable', 'the unavailable caption belongs to the restored identity, never the last inspected actor');
});
