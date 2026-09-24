import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { ActorRuntimeInspection } from '../../../ide/workbench/contrib/actor_lab/runtime_inspection';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
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
	await press('Enter'); await frame(); await renderer.capture!('ordinary-state-properties'); await press('Escape');
	// The inspection refactor must preserve ordinary World-bound method execution.
	await press('Home');
	await test.click(lab.actionBar.items.find(item => item.command === 'actorLab.call')!.bounds);
	test.clipboard.text = 'set_pos'; await press('ControlLeft', 'KeyV'); await press('Enter');
	check(picker.title === 'first:set_pos(...)', 'ordinary method picker selected the actor receiver');
	test.clipboard.text = '12, 34, 0'; await press('ControlLeft', 'KeyV'); await press('Enter');
	await until(() => test.tasks.ready && !runtime.completionCallPending() && !ide.debugger.plans.mutationActive,
		'actor tools: ordinary method completes at the World mutation rendezvous');
	check(guest.readStringMember(guest.global('actor_tool_first'), 'x') === 12 && guest.readStringMember(guest.global('actor_tool_first'), 'y') === 34,
		'ordinary Actor Lab reacquires its receiver after boundary execution');

	// Actual execution/rewind retire the entire semantic borrow, not merely generic value handles.
	const stop = ide.inspection.open(), actors = stop.lifetime.add(new ActorRuntimeInspection(stop));
	const first = actors.list(0, 1).actors![0], node = actors.tree(first.reference, 0, 1).nodes[0];
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined, 'actor tools: physical forward frame finishes');
	let expired = false;
	try { actors.read(node.reference); } catch (error) { expired = String(error).includes('expired'); }
	check(expired, 'actual forward execution retires actor nodes');
	const current = ide.inspection.open(), currentActors = current.lifetime.add(new ActorRuntimeInspection(current));
	const currentFirst = currentActors.list(0, 1).actors![0]; currentActors.tree(currentFirst.reference, 0, 1);
	await runPaletteCommand('Run: Previous Frame');
	await until(() => ide.frameNavigation.active === undefined, 'actor tools: physical historical frame settles');
	expired = false;
	try { currentActors.tree(currentFirst.reference, 0, 1); } catch (error) { expired = String(error).includes('expired'); }
	check(expired && lab.actorHashId === 0, 'heap restore invalidates both tool references and ordinary selected actor identity');
	const historical = ide.inspection.open(), historicalActors = historical.lifetime.add(new ActorRuntimeInspection(historical));
	const historicalList = historicalActors.list(0, 10);
	check(historicalList.total === 2, `fresh historical inspection reads restored World membership: ${JSON.stringify({ list: historicalList,
		state: historical.state, sourceDomain: ide.sources.activeCartridgeSlot, ready: guest.formatValue(guest.global('actor_tool_ready')) })}`);
	historical.dispose();
	await runPaletteCommand('Actor Lab: Open');
	check(picker.visible && picker.model.list.rows.length === 2, 'ordinary Actor picker also selects the physical restored domain');
	await press('ArrowDown'); await press('Enter'); await frame();
	check(lab.outline.rows[0].element.node.label === 'second' && lab.outline.rows.find(row => row.element.node.label === 'nest')!.element.node.active,
		'ordinary Actor Lab reads the second historical instance without resuming or repairing source activity');
	await renderer.capture!('historical-actor');
	await renderer.finish(); await ide.editor.shutdown();
	return { actors: 'pass', position, topology };
}
