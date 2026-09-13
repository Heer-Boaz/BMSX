import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import type { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import type { BehaviorQuickPickItem } from '../../../ide/workbench/contrib/behavior_lens/quick_access';
import { inspectBehaviorTreeInstance, readBehaviorTreeInstances } from '../../../ide/workbench/contrib/behavior_lens/behavior_tree_runtime';
import { medianMilliseconds } from '../../helpers/performance';
import { check, type StudioFixture } from './studio_fixture';

/** Open the unexecuted same-id registration: its wait node is not the running program. */
export async function openRuntimeTreePicker(test: StudioFixture, expectedCount = 4): Promise<void> {
	await test.runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	const picker = test.ide.editor.quickInput;
	const model = editorTextModelService.get({ domain: 0, path: 'inspection_trees.lua' })!;
	const index = picker.model.list.rows.findIndex(row => {
		const item = row.item as BehaviorQuickPickItem;
		return item.registration.resource.path === model.resource.path
			&& model.buffer.getLineContent(item.registration.occurrenceRange.start.line - 1).includes('999');
	});
	check(index >= 0, 'runtime BT: unexecuted same-id registration remains independently authored');
	for (let n = 0; n < index; n += 1) await test.press('ArrowDown');
	await test.press('Enter');
	const input = getActiveTab();
	if (input.kind !== 'behavior_lens' || input.view.presentation.kind !== 'graph') throw new Error('runtime BT: source graph required');
	await test.click(input.view.presentation.actionBar.items.find(item => item.command === 'behaviorLens.inspectRuntimeTree')!.bounds);
	check(picker.visible && picker.title === 'BT INSTANCES', 'runtime BT: graph Live opens the shared instance picker');
	check(readBehaviorTreeInstances(test.ide.sources, test.guest, 0).available, 'runtime BT: an initialized type index with no components is available, not a missing module');
	check(picker.model.list.rows.length === expectedCount, 'runtime BT: component index, not registration count');
	if (expectedCount !== 0) check(picker.model.list.rows.filter(row => row.item.label === 'rover').length === 2
		&& !picker.model.list.rows.some(row => row.item.label === 'unused'), 'runtime BT: equal tree ids retain distinct actual owners; unused programs are not instances');
}

export async function openRuntimeTreeInspector(test: StudioFixture, component: 'first' | 'second' | 'bare' | 'empty') {
	const { runtime, guest, cycles, press, frame } = test;
	const position = cycles(), heap = runtime.machine.cpu.luaHeap.usedBytes(), calls = guest.global('inspection_bt_callback_count');
	const model = editorTextModelService.get({ domain: 0, path: 'inspection_trees.lua' })!, version = model.version;
	await openRuntimeTreePicker(test);
	test.clipboard.text = `inspection.bt.${component}`;
	await press('ControlLeft', 'KeyV');
	check(test.ide.editor.quickInput.model.list.rows.length === 1, 'runtime BT: component choice disambiguates the shared tree id');
	await press('Enter');
	const inspector = (test.ide.editor.editorPanes.activePane as BehaviorLensEditorPane).inspector;
	check(inspector.visible && !test.ide.editor.quickInput.visible, 'runtime BT: chosen component opens the same property inspector');
	check(inspector.model.rows[0].element.label === `COMPONENT inspection.bt.${component}`, 'runtime BT: actual component identity');
	const first = inspector.model.rows[0], wrapped = first.value;
	for (let n = 0; n < 10; n += 1) await frame();
	check(inspector.model.rows[0] === first && first.value === wrapped, 'runtime BT: paint retains projection and measured text');
	check(cycles() === position && runtime.machine.cpu.luaHeap.usedBytes() === heap && guest.global('inspection_bt_callback_count') === calls
		&& model.version === version, 'runtime BT: no guest execution, allocation, source edit or callback call during inspection');
	return inspector;
}

export async function inspectRuntimeTreeBlackboard(test: StudioFixture, component: 'first' | 'second', revision: number) {
	const inspector = await openRuntimeTreeInspector(test, component);
	const rows = inspector.model.rows;
	const count = rows.find(row => row.element.label === 'BLACKBOARD / count')!.element;
	check(count.value === (component === 'first' ? '111' : '222') && count.description === `STORED SLOT ${revision === 1 ? 1 : 2}\nLOADED DEFAULT: ${revision * 10}`,
		'runtime BT: values belong to the chosen instance layout, including semantic-key rebind and changed defaults');
	check(rows.find(row => row.element.label === 'BLACKBOARD / vacant')!.element.value === 'nil'
		&& rows.find(row => row.element.label === 'BLACKBOARD / ready')!.element.value === 'false', 'runtime BT: named nil and false slots are not omitted or replaced by defaults');
	check(rows.find(row => row.element.label === 'BLACKBOARD / callback')!.element.source?.resource.path === 'inspection_callbacks.lua',
		'runtime BT: a real blackboard closure has its actual call target');
	check(rows.find(row => row.element.label === 'EXECUTION MEMORY')!.element.description === 'COMPILER-OWNED SLOTS, NOT AUTHORED NODE IDS.',
		'runtime BT: raw memory is not attributed to source nodes');
	return inspector;
}

export async function testRuntimeTreeSource(test: StudioFixture): Promise<void> {
	const { guest, press } = test;
	const inspector = await inspectRuntimeTreeBlackboard(test, 'first', 1);
	await test.capture?.('bt-blackboard');
	const rows = inspector.model.rows;
	const scalar = rows.findIndex(row => row.element.label === 'BLACKBOARD / count');
	for (let i = 0; i < scalar; i += 1) await press('ArrowDown');
	check(!inspector.isEnabled('propertyInspector.source'), 'runtime BT: loaded numbers have no inferred write/source target');
	const callback = rows.findIndex(row => row.element.label === 'BLACKBOARD / callback');
	for (let i = scalar; i < callback; i += 1) await press('ArrowDown');
	const model = editorTextModelService.get({ domain: 0, path: 'inspection_callbacks.lua' })!;
	const version = model.version, source = model.buffer.getText();
	check(inspector.isEnabled('propertyInspector.source'), 'runtime BT: blackboard callback Source enabled');
	await test.click(inspector.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.model === model && activeCodeEditor.view.cursorRow === source.split('\n').findIndex(line => line.startsWith('function callbacks.tree_tick')),
		'runtime BT: Source opens the actual callback module, not the written wait node');
	check(model.version === version, 'runtime BT: held Source does not edit text');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- pending BT callback\n' }]);
	const changed = await inspectRuntimeTreeBlackboard(test, 'second', 1);
	for (let i = 0; i < callback; i += 1) await press('ArrowDown');
	check(!changed.isEnabled('propertyInspector.source'), 'runtime BT: pending callback bytes do not admit a stale source location');
	model.undo(); await test.frame();
	check(changed.isEnabled('propertyInspector.source'), 'runtime BT: exact Undo restores the callback source link');
	const bare = await openRuntimeTreeInspector(test, 'bare');
	check(bare.model.rows.find(row => row.element.label === 'BLACKBOARD')!.element.value === 'nil'
		&& bare.model.rows.find(row => row.element.label === 'EXECUTION MEMORY')!.element.value === 'nil', 'runtime BT: a stateless program needs neither blackboard nor execution memory');
	check(bare.model.rows.find(row => row.element.label === 'EVALUATOR')!.element.source?.resource.path === 'inspection_callbacks.lua',
		'runtime BT: single-child collapse exposes the actual task call target, not an invented composite');
	const empty = await openRuntimeTreeInspector(test, 'empty');
	check(empty.model.rows.find(row => row.element.label === 'BLACKBOARD')!.element.value === '{}', 'runtime BT: declared empty blackboard is different from absence');
	await press('Escape');
	await test.runPaletteCommand('Behavior Tree: Inspect Runtime Instance');
	check(test.ide.editor.quickInput.title === 'BT INSTANCES', 'runtime BT: palette uses the graph focus route');
	await press('Escape');
	await press('ContextMenu');
	const menu = test.ide.editor.contextMenu;
	const index = menu.model.rows.findIndex(row => row.command === 'behaviorLens.inspectRuntimeTree');
	check(menu.visible && index >= 0 && menu.model.rows[index].enabled, 'runtime BT: node context has the same Live admission');
	for (let n = 0; n < index; n += 1) await press('ArrowDown');
	await press('Enter');
	check(test.ide.editor.quickInput.title === 'BT INSTANCES' && !menu.visible, 'runtime BT: context command enters actual instance scope');
	await press('Escape');
	const instances = readBehaviorTreeInstances(test.ide.sources, guest, 0);
	const first = instances.items.find(item => item.description === 'COMPONENT inspection.bt.first')!;
	const second = instances.items.find(item => item.description === 'COMPONENT inspection.bt.second')!;
	check(guest.readStringMember(first.component, 'evaluate') === guest.readStringMember(second.component, 'evaluate')
		&& guest.readStringMember(first.component, '_execution_state') !== guest.readStringMember(second.component, '_execution_state'),
		'runtime BT: same compiled evaluator, separate instance memory; no debug tree copy');
	console.info(`STUDIO: BT read projection medians (ms) ${JSON.stringify({
		instances: medianMilliseconds(() => { readBehaviorTreeInstances(test.ide.sources, guest, 0); }),
		properties: medianMilliseconds(() => { inspectBehaviorTreeInstance(test.ide.sources, guest, first); }),
		instanceCount: instances.items.length,
	})}`);
}
