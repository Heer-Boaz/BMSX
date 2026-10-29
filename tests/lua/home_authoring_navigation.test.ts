import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import type { BehaviorKind } from '../../ide/workbench/contrib/behavior_lens/model';
import type { BehaviorQuickPickItem } from '../../ide/workbench/contrib/behavior_lens/quick_access';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { HomeEditorPane } from '../../ide/workbench/contrib/home/editor_pane';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local trees=require('cartlib/behaviour_tree/library')
local machines=require('cartlib/fsm/library')
local effects=require('cartlib/actioneffects')
trees.register('tree',{root={type='wait',duration_ticks=2}})
machines.register('machine',{initial='idle',states={idle={},active={}}})
effects.register_effect('effect',{cooldown_ms=10})
`;
const SCENE_SOURCE = `local scenes=require('cartlib/world/scene_library')
scenes.register('room',{objects={{member_id='unit',definition_id='actor'}}})
`;
const BEHAVIOR_COMMANDS: readonly (readonly [EditorCommandId, BehaviorKind])[] = [
	['behaviorLens.stateMachines', 'state_machine'], ['behaviorLens.behaviorTrees', 'behavior_tree'],
	['behaviorLens.actionEffects', 'action_effect'],
];

function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	const f = createActualSourcePanes(t, false, [['behaviors.lua', SOURCE], ['scene.lua', SCENE_SOURCE],
		['cartlib/behaviour_tree/library.lua', 'return {}'], ['cartlib/fsm/library.lua', 'return {}'],
		['cartlib/actioneffects.lua', 'return {}'], ['cartlib/world/scene_library.lua', 'return {}']],
	() => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs'))));
	f.editor.setFontVariant(font);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'behaviors.lua' })!;
	const sceneResource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const home = new HomeInput(f.sources.catalog.getContext(resource.contextId).admission);
	f.firstGroup.openEditor(home, { pinned: true }); f.update();
	const pane = f.firstGroup.panes.activePane;
	assert.ok(pane instanceof HomeEditorPane); pane.focus();
	assert.equal(editorViewState.font.variant, font);
	return { ...f, home, pane, resource, sceneResource, picker: f.firstPart.quickInput };
}
type Fixture = ReturnType<typeof fixture>;

/** Card geometry locates real pointer input; assertions concern command and document ownership. */
function invoke(f: Fixture, command: EditorCommandId): void {
	const section = f.home.sections.find(section => section.actions.items.some(item => item.command === command));
	assert.ok(section !== undefined);
	f.home.viewport.scrollbar.setScroll(section.bounds.top); f.update();
	const action = section.actions.items.find(item => item.command === command)!;
	assert.equal(action.visible, true);
	const x = (action.bounds.left + action.bounds.right) / 2, y = (action.bounds.top + action.bounds.bottom) / 2;
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
		pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(f.picker.visible, true);
}

test('Home exposes the actual authored kind entrypoints rather than a generic Behavior Lens substitute', t => {
	const f = fixture(t);
	const commands = f.home.sections.flatMap(section => section.actions.items.map(item => item.command));
	for (const command of ['sceneEditor', 'cartMap', 'animation', 'aem', 'behaviorLens.stateMachines',
		'behaviorLens.behaviorTrees', 'behaviorLens.actionEffects', 'progression', 'inputBindings'] as const)
		assert.equal(commands.filter(actual => actual === command).length, 1);
	assert.equal(commands.includes('behaviorLens'), false);
});

for (const font of ['tiny', 'msx'] as const) for (const [command, kind] of BEHAVIOR_COMMANDS)
	test(`${font} Home ${kind} action selects an exact canonical declaration in its invoking group`, t => {
		const f = fixture(t, font), parts = f.editor.editorParts, cycles = f.host.runtime.machine.scheduler.nowCycles;
		invoke(f, command);
		const rows = f.picker.model.list.rows;
		assert.equal(rows.length, 1);
		const choice = rows[0].item as BehaviorQuickPickItem;
		assert.equal(choice.registration.behaviorKind, kind);
		assert.equal(choice.registration.resource.contextId, f.resource.contextId);
		assert.equal(choice.registration.resource.path, f.resource.path);
		parts.activate(f.secondPart);
		f.key('Enter');
		const input = f.firstGroup.model.activeTab;
		assert.ok(input instanceof BehaviorLensInput && input.workingCopy === editorTextModelService.get(f.resource));
		assert.ok(input.resource === f.resource && f.firstGroup.model.contains(f.home) && parts.activeGroup === f.firstGroup);
		assert.equal(input.view.source.nodesByRowKey.get(input.view.selectionState.definitionRowKey!)!.behaviorKind, kind);
		assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane === f.second);
		assert.equal(input.workingCopy.dirty, false); assert.equal(input.workingCopy.canUndo, false);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});

test('cancelling a Home authoring choice preserves documents, topology and the concrete return control', t => {
	const f = fixture(t), parts = f.editor.editorParts, documents = parts.documents.length, groups = parts.groups.length;
	invoke(f, 'behaviorLens.stateMachines'); const origin = f.picker.invocationOrigin;
	f.key('Escape');
	assert.equal(f.picker.visible, false); assert.ok(inputFocus.target === origin);
	assert.equal(parts.documents.length, documents); assert.equal(parts.groups.length, groups);
	assert.ok(f.firstGroup.model.activeTab === f.home && f.secondGroup.model.activeTab === f.secondInput);
});

test('deleting a chosen behavior and recreating equal bytes cannot revive its open chooser', t => {
	const f = fixture(t), model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource);
	const open = t.mock.method(f.editor.behaviorLens, 'openDefinition');
	invoke(f, 'behaviorLens.behaviorTrees');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'return {}\n' }]);
	assert.equal(f.picker.visible, false);
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: SOURCE }]);
	assert.equal(f.picker.visible, false); assert.equal(open.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === f.home);
});

test('a same-path catalog resource replacement retires the Home behavior chooser', t => {
	const f = fixture(t), open = t.mock.method(f.editor.behaviorLens, 'openDefinition');
	invoke(f, 'behaviorLens.actionEffects');
	const registry = f.sources.catalog.getContext(f.resource.contextId).luaSources, record = registry.path2lua[f.resource.path];
	registry.records.splice(registry.records.indexOf(record), 1); delete registry.path2lua[f.resource.path]; delete registry.module2lua[record.module_path];
	f.sources.catalog.rebuildResources();
	registerLuaSourceRecord(registry, { ...record, update_timestamp: record.update_timestamp + 1 });
	assert.ok(f.sources.catalog.resolveResource(f.resource) !== f.resource);
	assert.equal(f.picker.visible, false); assert.equal(open.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === f.home);
});

test('a source replacement during chooser focus return revokes the accepted behavior instead of selecting a namesake', t => {
	const f = fixture(t), model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource);
	const open = t.mock.method(f.editor.behaviorLens, 'openDefinition');
	invoke(f, 'behaviorLens.stateMachines');
	const origin = f.picker.invocationOrigin;
	t.after(f.picker.field.focusTarget.onDidBlur(next => {
		if (next === origin) model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: SOURCE.replace('idle={},active={}', 'other={},newer={}') }]);
	}));
	f.key('Enter');
	assert.equal(f.picker.visible, false); assert.equal(open.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === f.home && f.secondGroup.model.activeTab === f.secondInput);
});

test('Home behavior acceptance opens in its captured group without stealing newer focus from popup return', t => {
	const f = fixture(t);
	invoke(f, 'behaviorLens.behaviorTrees');
	const origin = f.picker.invocationOrigin;
	let moved = false;
	t.after(f.picker.field.focusTarget.onDidBlur(next => {
		if (next === origin) { moved = true; f.second.focus(); }
	}));
	f.key('Enter');
	assert.equal(moved, true);
	assert.ok(f.firstGroup.model.activeTab instanceof BehaviorLensInput);
	assert.ok(f.firstGroup.model.activeTab.workingCopy === editorTextModelService.get(f.resource));
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane === f.second);
	assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
});

test('clearing canonical working copies retires a Home behavior catalog even while Home survives', t => {
	const f = fixture(t), open = t.mock.method(f.editor.behaviorLens, 'openDefinition');
	invoke(f, 'behaviorLens.behaviorTrees');
	editorTextModelService.clear();
	assert.equal(f.picker.visible, false); assert.equal(open.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === f.home);
});

test('retiring the invoking group closes its Home behavior chooser without opening in another part', async t => {
	const f = fixture(t), open = t.mock.method(f.editor.behaviorLens, 'openDefinition');
	invoke(f, 'behaviorLens.stateMachines');
	assert.equal(await f.editor.editorParts.close(f.firstPart), true);
	assert.equal(f.picker.visible, false); assert.equal(open.mock.callCount(), 0);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane === f.second);
});

for (const replacement of ['return {}\n', SOURCE]) test(`working-copy admission rejects a ${replacement === SOURCE ? 'byte-identical replacement' : 'removed producer'} after a source edit callback`, t => {
	const f = fixture(t);
	invoke(f, 'behaviorLens.behaviorTrees');
	assert.ok(editorTextModelService.get(f.resource) === undefined);
	let edited = false;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource === f.resource) {
			edited = true; model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: replacement }]);
		}
	}));
	f.key('Enter');
	assert.equal(edited, true);
	assert.ok(f.firstGroup.model.activeTab === f.home && f.secondGroup.model.activeTab === f.secondInput);
});

for (const interaction of ['newerEditor', 'foreignFocus'] as const)
	test(`Home behavior production respects ${interaction} from canonical model admission`, t => {
		const f = fixture(t), newer = new HostErrorInput('newer attachment');
		invoke(f, 'behaviorLens.behaviorTrees');
		t.after(editorTextModelService.onDidAddModel(model => {
			if (model.resource !== f.resource) return;
			if (interaction === 'newerEditor') f.firstGroup.openEditor(newer);
			else f.second.focus();
		}));
		f.key('Enter');
		if (interaction === 'newerEditor') assert.ok(f.firstGroup.model.activeTab === newer && f.firstGroup.panes.activePane?.input === newer);
		else {
			newer.dispose();
			assert.ok(f.firstGroup.model.activeTab instanceof BehaviorLensInput);
			assert.ok(f.firstGroup.model.activeTab.workingCopy === editorTextModelService.get(f.resource));
			assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
		}
		assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane === f.second);
	});

test('Home Scene acceptance retains newer popup-return focus while opening its captured canonical group', t => {
	const f = fixture(t);
	invoke(f, 'sceneEditor');
	const origin = f.picker.invocationOrigin;
	let moved = false;
	t.after(f.picker.field.focusTarget.onDidBlur(next => {
		if (next === origin) { moved = true; f.second.focus(); }
	}));
	f.key('Enter');
	assert.equal(moved, true);
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof SceneEditorInput && input.workingCopy === editorTextModelService.get(f.sceneResource));
	assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane === f.second);
});

for (const interaction of ['newerEditor', 'foreignFocus'] as const)
	test(`Home Scene production respects ${interaction} from canonical model admission`, t => {
		const f = fixture(t);
		let newer: HostErrorInput | undefined;
		invoke(f, 'sceneEditor');
		t.after(editorTextModelService.onDidAddModel(model => {
			if (model.resource !== f.sceneResource) return;
			if (interaction === 'newerEditor') {
				newer = new HostErrorInput('newer attachment'); f.firstGroup.openEditor(newer);
			} else f.second.focus();
		}));
		f.key('Enter');
		if (interaction === 'newerEditor') assert.ok(newer !== undefined && f.firstGroup.model.activeTab === newer && f.firstGroup.panes.activePane?.input === newer);
		else {
			const input = f.firstGroup.model.activeTab;
			assert.ok(input instanceof SceneEditorInput && input.workingCopy === editorTextModelService.get(f.sceneResource));
			assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
		}
		assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane === f.second);
	});

test('Home Scene filtering observes source published by the actual outgoing control blur', t => {
	const f = fixture(t), model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.sceneResource);
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'return {}\n' }]);
	const origin = inputFocus.target!;
	t.after(origin.onDidBlur(next => {
		if (next === f.picker.field.focusTarget) model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: SCENE_SOURCE }]);
	}));
	invoke(f, 'sceneEditor');
	assert.equal(f.picker.model.list.rows.length, 1);
	f.key('Enter');
	assert.ok(f.firstGroup.model.activeTab instanceof SceneEditorInput && f.firstGroup.model.activeTab.workingCopy === model);
});

test('a changed canonical Scene source retires its fixed Home document chooser', t => {
	const f = fixture(t), model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.sceneResource);
	invoke(f, 'sceneEditor');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'return {}\n' }]);
	assert.equal(f.picker.visible, false); assert.ok(f.firstGroup.model.activeTab === f.home);
});

for (const replacement of ['return {}\n', SCENE_SOURCE])
	test(`Home Scene rejects an accepted ${replacement === SCENE_SOURCE ? 'byte-identical source replacement' : 'removed declaration'} during model admission`, t => {
		const f = fixture(t);
		invoke(f, 'sceneEditor');
		let changed = false;
		t.after(editorTextModelService.onDidAddModel(model => {
			if (model.resource === f.sceneResource) {
				changed = true; model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: replacement }]);
			}
		}));
		f.key('Enter');
		assert.equal(changed, true); assert.ok(f.firstGroup.model.activeTab === f.home);
		assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane === f.second);
	});
