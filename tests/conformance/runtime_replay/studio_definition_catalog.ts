import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import type { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import { readBehaviorDefinitions } from '../../../ide/workbench/contrib/behavior_lens/runtime_definitions';
import { readActionEffectInstances } from '../../../ide/workbench/contrib/behavior_lens/action_effect_runtime';
import { readStateMachineInstances } from '../../../ide/workbench/contrib/behavior_lens/state_machine_runtime';
import { medianMilliseconds } from '../../helpers/performance';
import { openRuntimeEffectLens } from './studio_actioneffect_runtime';
import { openRuntimeStateMachineLens } from './studio_fsm_runtime';
import { check, type StudioFixture } from './studio_fixture';

/** Same unexecuted source lenses; the catalog must not use their rows as runtime candidates. */
export async function openRegisteredDefinitionPicker(test: StudioFixture, kind: 'effect' | 'fsm',
	expected = kind === 'effect' ? 'empty,pulse,shared_alias,ungranted' : 'companion,empty,unattached,walker'): Promise<void> {
	if (kind === 'effect') await openRuntimeEffectLens(test); else await openRuntimeStateMachineLens(test);
	await test.runPaletteCommand('Behavior Lens: Inspect Registered Definitions');
	const picker = test.ide.editor.quickInput;
	check(picker.visible && picker.title === (kind === 'effect' ? 'REGISTERED ACTIONEFFECTS' : 'REGISTERED FSMS'), 'catalog: actual palette opens the registered scope');
	const labels = picker.model.list.rows.map(row => row.item.label).sort();
	check(labels.join(',') === expected,
		'catalog: every published id appears once, including actorless/empty definitions and shared aliases, not the unexecuted registration');
}

export async function testEmptyDefinitionCatalog(test: StudioFixture): Promise<void> {
	for (const [kind, modulePath] of [['effect', 'cartlib/actioneffects/actioneffect_component'], ['fsm', 'cartlib/fsm/fsm_component']] as const) {
		const before = test.cycles(), heap = test.runtime.machine.cpu.luaHeap.usedBytes();
		const registry = readBehaviorDefinitions(test.ide.sources, test.guest, 0, modulePath);
		check(registry.available && registry.items.length === 0, 'catalog: initialized empty registry is available before the first registration');
		await openRegisteredDefinitionPicker(test, kind, '');
		await test.press('Escape');
		check(test.cycles() === before && test.runtime.machine.cpu.luaHeap.usedBytes() === heap, 'catalog: empty inspection neither registers nor allocates guest state');
	}
}

export async function openRegisteredDefinition(test: StudioFixture, kind: 'effect' | 'fsm', id: string, stateId = id) {
	const { guest, runtime, cycles, press } = test;
	const time = cycles(), heap = runtime.machine.cpu.luaHeap.usedBytes(), callbacks = guest.global('inspection_fsm_callback_count');
	const model = editorTextModelService.get({ domain: 0, path: 'cart.lua' })!, version = model.version;
	await openRegisteredDefinitionPicker(test, kind);
	const picker = test.ide.editor.quickInput;
	let index = picker.model.list.rows.findIndex(row => row.item.label === id);
	check(index >= 0, `catalog: published ${id} is selectable`);
	for (let n = 0; n < index; n += 1) await press('ArrowDown');
	await press('Enter');
	if (kind === 'fsm') {
		check(picker.visible && picker.title === `LOADED STATES / ${id}` && picker.model.list.rows.every(row => row.item.description === ''),
			'catalog: definition hierarchy does not invent a current actor state');
		index = picker.model.list.rows.findIndex(row => row.item.label === stateId);
		check(index >= 0, `catalog: loaded child ${stateId} is present`);
		for (let n = 0; n < index; n += 1) await press('ArrowDown');
		await press('Enter');
	}
	const inspector = (test.ide.editor.editorPanes.activePane as BehaviorLensEditorPane).inspector;
	check(inspector.visible && !picker.visible, 'catalog: concrete definition opens the existing property inspector');
	check(inspector.model.rows[0].element.label === 'LOADED DEFINITION'
		&& !inspector.model.rows.some(row => row.element.label.includes('INSTANCE') || row.element.label === 'CURRENT CHILD'),
		'catalog: no invented instance fields');
	const row = inspector.model.rows[0], measured = row.value;
	for (let n = 0; n < 10; n += 1) await test.frame();
	check(inspector.model.rows[0] === row && row.value === measured, 'catalog: rows and wrapping are retained on idle frames');
	check(cycles() === time && runtime.machine.cpu.luaHeap.usedBytes() === heap && model.version === version
		&& guest.global('inspection_fsm_callback_count') === callbacks, 'catalog: inspection does not execute setters, callbacks, time or source edits');
	return inspector;
}

export async function testActorlessDefinitionCatalog(test: StudioFixture): Promise<void> {
	const { ide, guest, press } = test;
	check(readActionEffectInstances(ide.sources, guest, 0).items.length === 0 && readStateMachineInstances(ide.sources, guest, 0).items.length === 0,
		'catalog: this stop is before any component/actor was created');
	const empty = await openRegisteredDefinition(test, 'effect', 'empty');
	check(empty.model.rows.length === 1, 'catalog: a registered empty definition is real, not unavailable');
	const unused = await openRegisteredDefinition(test, 'effect', 'ungranted');
	check(unused.model.rows.find(row => row.element.label === 'PERIOD')!.element.value === '777', 'catalog: loaded unused scalar');
	await test.capture?.('registered-actioneffect');
	const handler = unused.model.rows.findIndex(row => row.element.label === 'HANDLER');
	for (let n = 0; n < handler; n += 1) await press('ArrowDown');
	check(unused.isEnabled('propertyInspector.source'), 'catalog: retained callback has Source without an instance');
	await test.click(unused.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.model.resource.path === 'inspection_callbacks.lua' && activeCodeEditor.view.cursorRow === 1,
		'catalog: unused callback opens its actual imported source');
	const registry = readBehaviorDefinitions(ide.sources, guest, 0, 'cartlib/actioneffects/actioneffect_component');
	check(registry.items.find(item => item.label === 'ungranted')!.definition === registry.items.find(item => item.label === 'shared_alias')!.definition,
		'catalog: two published keys retain the same guest table, not per-entry copies');
	const emptyFsm = await openRegisteredDefinition(test, 'fsm', 'empty');
	check(emptyFsm.model.rows.find(row => row.element.label === 'LOADED CHILDREN')!.element.value === '{}', 'catalog: an empty FSM has no invented state');
	await openRegisteredDefinition(test, 'fsm', 'unattached', 'unattached:/hidden');
	const nested = await openRegisteredDefinition(test, 'fsm', 'walker', 'walker:/nest');
	check(nested.model.rows.find(row => row.element.label === 'LOADED DEFAULTS')!.element.value === 'revision: 10', 'catalog: nested loaded defaults without any actor');
	await test.capture?.('registered-fsm');
	await press('Escape');
	await press('ContextMenu');
	const menu = ide.editor.contextMenu;
	const index = menu.model.rows.findIndex(row => row.command === 'behaviorLens.inspectRegisteredDefinitions');
	check(menu.visible && index >= 0 && menu.model.rows[index].enabled, 'catalog: state context shares command admission');
	for (let n = 0; n < index; n += 1) await press('ArrowDown');
	await press('Enter');
	check(ide.editor.quickInput.title === 'REGISTERED FSMS', 'catalog: context command selects the same scope');
	await press('Escape');
	console.info(`STUDIO: registered catalog medians (ms) ${JSON.stringify({
		effect: medianMilliseconds(() => { readBehaviorDefinitions(ide.sources, guest, 0, 'cartlib/actioneffects/actioneffect_component'); }),
		fsm: medianMilliseconds(() => { readBehaviorDefinitions(ide.sources, guest, 0, 'cartlib/fsm/fsm_component'); }),
		definitionsPerRegistry: 4,
	})}`);
}
