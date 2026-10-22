import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { ActorRuntimeInspection } from '../../../ide/workbench/contrib/actor_lab/runtime_inspection';
import type { ActorLabEditorPane } from '../../../ide/workbench/contrib/actor_lab/editor_pane';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { ACTOR_TOOLS_SOURCE } from '../../helpers/actor_tools_fixture';
import { check, createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

/** Automated source setup; actual Save/Reboot, native Codex calls and ordinary Actor Lab controls. */
export async function runAssistantActors(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, runtime, guest, press, until, frame, cycles, harness, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'actor tools: boot authoring');
	await press('ControlRight', 'ShiftRight');
	harness.openLuaSource('cart.lua');
	const sourceTab = getActiveTab();
	const source = harness.getActiveEditorDocument().model;
	source.pushEditOperations([{ offset: 0, deleteLength: source.buffer.length, text: ACTOR_TOOLS_SOURCE }]);
	await runPaletteCommand('Run: Reboot'); await press('Enter');
	await until(() => guest.global('actor_tool_ready') === true && test.tasks.ready, 'actor tools: actual World constructs both actors and their behaviors');
	const readyTick = runtime.frameScheduler.lastTickSequence;
	await until(() => runtime.frameScheduler.lastTickSequence >= readyTick + 4 && test.tasks.ready, 'actor tools: retain post-construction history boundaries');
	await press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	source.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty source is not an installed callback location\n' }]);
	await runPaletteCommand('Actor Lab: Open');
	const picker = ide.editor.quickInput;
	check(picker.visible && picker.model.list.rows.map(row => row.item.label).join(',') === 'first,second', 'ordinary Actor Lab lists actual World membership');
	await press('Enter'); await frame();
	const lab = getActiveTab(); if (lab.kind !== 'actor_lab') throw new Error('Actor Lab required');
	check(lab.outline.rows.length > 0 && lab.outline.rows.every(row => row.element.displayLabel.length > 0),
		'opening an actor publishes measured, nonempty outline rows');
	const topology = lab.outline.rows.map(row => ({ label: row.element.node.label, kind: row.element.node.kind, active: row.element.node.active }));
	const position = cycles(), heap = runtime.machine.cpu.luaHeap.usedBytes(), media = ide.sources.currentBlua32Media, version = source.version;
	await renderer.capture!('ordinary-tree');
	await runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, 'Inspect both live actors and their FSM, BT, ActionEffect and timeline state. Expand the actual values; do not execute Lua, mutate or install source.');
	const conversation = ide.editor.assistant;
	await until(() => conversation.state === 'ready' && conversation.entries.some(entry => entry.kind === 'assistant'), 'actor tools: native model exchanges finish');
	check(cycles() === position && runtime.machine.cpu.luaHeap.usedBytes() === heap && guest.global('actor_tool_callbacks') === 0,
		'actor tools only read: unchanged guest heap, clock and callback counter');
	check(source.version === version && ide.sources.currentBlua32Media === media, 'actor tools do not conflate dirty source and installed instances');
	await renderer.capture!('conversation');
	await test.clickTab(lab.id); await frame();
	check(JSON.stringify(lab.outline.rows.map(row => ({ label: row.element.node.label, kind: row.element.node.kind, active: row.element.node.active }))) === JSON.stringify(topology),
		'conversation does not change the ordinary Actor Lab selection/tree');
	const nest = lab.outline.rows.findIndex(row => row.element.node.label === 'nest');
	for (let i = 0; i < nest; i++) await press('ArrowDown');
	await press('Enter'); await frame();
	const actorPane = ide.editor.editorPanes.activePane as ActorLabEditorPane;
	let inspector = actorPane.inspector;
	check(inspector.visible && actorPane.showsGameFrame && actorPane.detailsWindow.visible && lab.detailsWindow.open,
		'ordinary Details leave the actor outline and game preview visible');
	await press('End');
	const retainedProperty = inspector.model.rows[inspector.model.selectionIndex].element.label;
	const retainedScroll = inspector.model.viewport.scrollTop;
	await renderer.capture!('ordinary-state-properties');
	await test.clickTab(sourceTab.id);
	check(lab.detailsWindow.open && !inspector.visible, 'source authoring detaches Details without closing its retained view');
	await press('ControlLeft', 'KeyZ');
	await test.clickTab(lab.id);
	inspector = actorPane.inspector;
	check(inspector.visible && inspector.model.rows[inspector.model.selectionIndex].element.label === retainedProperty
		&& inspector.model.viewport.scrollTop === retainedScroll, 'returning from source restores the Details property and scroll position');
	await runPaletteCommand('Actor Lab: Inspect Instance');
	await press('Home');
	const callbackRow = inspector.model.rows.findIndex(row => row.element.label === 'UPDATE');
	check(callbackRow >= 0, 'state Details expose the installed update callback');
	for (let i = 0; i < callbackRow; i++) await press('ArrowDown');
	check(inspector.isEnabled('propertyInspector.source'), 'matching source can be opened from the selected callback');
	const callbackScroll = inspector.model.viewport.scrollTop;
	const callbackActor = lab.actorHashId, callbackMember = lab.selectionPath, callbackVersion = source.version;
	await press('Enter');
	check(getActiveTab() === sourceTab && lab.detailsWindow.open && !inspector.visible,
		'Details Source follows the installed callback without closing the retained Details view');
	await frame();
	check(activeCodeEditor.view.cursorRow === ACTOR_TOOLS_SOURCE.split('\n').findIndex(line => line.startsWith('local function callback')),
		'Details Source opens the installed callback location');
	await renderer.capture!('details-callback-source');
	await press('AltLeft', 'ArrowLeft'); await frame();
	inspector = actorPane.inspector;
	check(inspector.visible && inspector.model.rows[inspector.model.selectionIndex].element.label === 'UPDATE'
		&& inspector.model.viewport.scrollTop === callbackScroll && getActiveTab() === lab && lab.actorHashId === callbackActor
		&& JSON.stringify(lab.selectionPath) === JSON.stringify(callbackMember), 'Back from callback Source restores the selected actor, typed member and Details context');
	check(cycles() === position && runtime.machine.cpu.luaHeap.usedBytes() === heap && source.version === callbackVersion
		&& ide.sources.currentBlua32Media === media, 'source and Back navigation do not execute guest code or change source/installations');
	await renderer.capture!('details-source-return');
	await press('AltLeft', 'ArrowRight'); await frame();
	check(getActiveTab() === sourceTab, 'Forward restores the callback source');
	await press('AltLeft', 'ArrowLeft'); await frame();
	inspector = actorPane.inspector;
	await runPaletteCommand('Actor Lab: Inspect Instance'); await press('Escape');
	// The inspection refactor must preserve ordinary World-bound method execution.
	await press('Home');
	await press('Enter'); await press('Home');
	const positionRow = inspector.model.rows.findIndex(row => row.element.label === 'x');
	check(positionRow >= 0, 'actor Details expose the stored position');
	for (let i = 0; i < positionRow; i++) await press('ArrowDown');
	await press('ArrowDown'); await press('ArrowUp');
	const positionDetails = lab.details, positionItems = lab.details!.items;
	check(inspector.model.rows[positionRow].element.value === '4'
		&& inspector.model.rows.find(row => row.element.label === 'y')!.element.value === '8',
		'open Details display the actor position before the ordinary method call');
	await renderer.capture!('details-position-before');
	await press('Escape');
	await runPaletteCommand('Actor Lab: Call Lua Method');
	await test.clipboard.writeText('set_pos'); await press('ControlLeft', 'KeyV'); await press('Enter');
	await test.clipboard.writeText('12, 34, 0'); await press('ControlLeft', 'KeyV'); await press('Enter');
	await until(() => test.tasks.ready && !runtime.completionCallPending() && !ide.debugger.plans.mutationActive,
		'actor tools: ordinary method completes at the World mutation rendezvous');
	check(guest.readStringMember(guest.global('actor_tool_first'), 'x') === 12 && guest.readStringMember(guest.global('actor_tool_first'), 'y') === 34,
		'ordinary Actor Lab reacquires its receiver after boundary execution');
	check(inspector.visible && lab.details === positionDetails && lab.details!.items === positionItems
		&& inspector.model.rows[inspector.model.selectionIndex].element.label === 'x'
		&& inspector.model.rows.find(row => row.element.label === 'x')!.element.value === '12'
		&& inspector.model.rows.find(row => row.element.label === 'y')!.element.value === '34',
		'the same open Details document displays the changed guest position and preserves selected x');
	await renderer.capture!('details-position-after');
	await runPaletteCommand('Actor Lab: Inspect Instance'); await press('Escape');

	// Actual execution/rewind retire the entire semantic borrow, not merely generic value handles.
	await press('End'); await frame();
	const selectedActor = lab.actorHashId, selectedNode = lab.outline.rows[lab.outline.selectionIndex].element.node;
	const selectedHash = selectedNode.hashId, selectedValue = selectedNode.value;
	await press('Enter'); await press('ArrowDown');
	const details = lab.details, selectedProperty = inspector.model.rows[inspector.model.selectionIndex].element.label;
	const stop = ide.inspection.open(), actors = stop.lifetime.add(new ActorRuntimeInspection(stop));
	const first = actors.list(0, 1).actors![0], node = actors.tree(first.reference, 0, 1).nodes[0];
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined, 'actor tools: physical forward frame finishes');
	check(inspector.visible && lab.details === details
		&& inspector.model.rows[inspector.model.selectionIndex].element.label === selectedProperty,
		'forward frame refreshes the open Details without replacing its property selection');
	let expired = false;
	try { actors.read(node.reference); } catch (error) { expired = String(error).includes('expired'); }
	check(expired, 'actual forward execution retires actor nodes');
	const current = ide.inspection.open(), currentActors = current.lifetime.add(new ActorRuntimeInspection(current));
	const currentFirst = currentActors.list(0, 1).actors![0]; currentActors.tree(currentFirst.reference, 0, 1);
	await runPaletteCommand('Run: Previous Frame');
	await until(() => ide.frameNavigation.active === undefined, 'actor tools: physical historical frame settles');
	check(inspector.visible && lab.details === details
		&& inspector.model.rows[inspector.model.selectionIndex].element.label === selectedProperty,
		'rewind refreshes the same open Details and selected property');
	expired = false;
	try { currentActors.tree(currentFirst.reference, 0, 1); } catch (error) { expired = String(error).includes('expired'); }
	check(expired, 'heap restore retires tool references even when ordinary selection survives');
	check(lab.actorHashId === selectedActor && lab.outline.rows[lab.outline.selectionIndex].element.node.hashId === selectedHash,
		'history navigation retains the ordinary actor and child selection');
	check(lab.outline.rows[lab.outline.selectionIndex].element.node.value !== selectedValue,
		'ordinary selection borrows the restored heap, not the pre-rewind object');
	await frame(); await renderer.capture!('historical-selection-properties');
	await runPaletteCommand('Actor Lab: Inspect Instance'); await press('Escape');
	const historical = ide.inspection.open(), historicalActors = historical.lifetime.add(new ActorRuntimeInspection(historical));
	const historicalList = historicalActors.list(0, 10);
	check(historicalList.total === 2, `fresh historical inspection reads restored World membership: ${JSON.stringify({ list: historicalList,
		state: historical.state, sourceDomain: ide.sources.activeCartridgeSlot, ready: guest.formatValue(guest.global('actor_tool_ready')) })}`);
	historical.dispose();
	await runPaletteCommand('Actor Lab: Open');
	check(!picker.visible, 'opening a selected historical actor needs no replacement selection');
	await runPaletteCommand('Actor Lab: Select Running Actor');
	check(picker.visible && picker.model.list.rows.length === 2, 'ordinary Actor picker also selects the physical restored domain');
	await press('ArrowDown'); await press('Enter'); await frame();
	check(lab.outline.rows[0].element.node.label === 'second' && lab.outline.rows.find(row => row.element.node.label === 'nest')!.element.node.active,
		'ordinary Actor Lab reads the second historical instance without resuming or repairing source activity');
	await renderer.capture!('historical-actor');
	await renderer.finish(); await ide.editor.shutdown();
	return { actors: 'pass', position, topology };
}
