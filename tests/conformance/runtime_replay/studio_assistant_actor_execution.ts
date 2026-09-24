import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { ActorRuntimeInspection } from '../../../ide/workbench/contrib/actor_lab/runtime_inspection';
import { resolveActorTarget } from '../../../ide/workbench/contrib/actor_lab/target';
import { ActorRuntimeTree, findRuntimeActor } from '../../../ide/workbench/contrib/actor_lab/runtime';
import type { Table } from '../../../machine/ts/machine/cpu/table';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { ACTOR_EXECUTION_SOURCE } from '../../helpers/actor_tools_fixture';
import { check, createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { submitAssistantText } from './studio_assistant_navigation';

/** Native Codex tools, real World admission and actual guest races. Never a synthetic pane or object. */
export async function runAssistantActorExecution(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, runtime, guest, press, until, frame, cycles, harness, runPaletteCommand } = test, service = ide.actorExecution;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'Actor execution: boot authoring');
	await press('ControlRight', 'ShiftRight'); harness.openLuaSource('cart.lua');
	const source = harness.getActiveEditorDocument().model;
	source.pushEditOperations([{ offset: 0, deleteLength: source.buffer.length, text: ACTOR_EXECUTION_SOURCE }]);
	await runPaletteCommand('Run: Reboot'); await press('Enter');
	await test.tasks.join();
	await until(() => guest.global('actor_tool_ready') === true && test.tasks.ready, 'Actor execution: actual fixture constructs');
	await press('ControlRight', 'ShiftRight'); await test.runMenuCommand('pause');
	source.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- live tools must not install this dirty source\n' }]);
	const version = source.version, media = ide.sources.currentBlua32Media;
	await runPaletteCommand('Actor Lab: Open'); await press('ArrowDown'); await press('Enter'); await frame();
	const lab = getActiveTab(); if (lab.kind !== 'actor_lab') throw new Error('Actor Lab required');
	const selection = lab.actorHashId;
	check(lab.runtime.roots[0].label === 'second', 'manual Actor Lab selects a different instance from the tool request');
	await runPaletteCommand('View: Codex Assistant');
	const view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant required');
	const conversation = ide.editor.assistant;
	const probeLine = ACTOR_EXECUTION_SOURCE.split('\n').findIndex(line => line.includes('return self.id, nil')) + 1;
	ide.debugger.breakpoints.set({ domain: 0, path: 'cart.lua' }, [probeLine]);
	await submitAssistantText(test, 'Discover and execute live actor actions and a stored method. Inspect their actual results; do not install source.');
	await until(() => service.active?.status === 'paused' && ide.debugger.source.stop !== undefined, 'Actor execution: actual stored-method breakpoint');
	check(service.active!.invoked && service.active!.result === undefined, 'a breakpoint retains the actual Actor call');
	ide.debugger.breakpoints.set({ domain: 0, path: 'cart.lua' }, []);
	await until(() => conversation.state === 'ready', 'Actor execution: model continues and reads live state');
	check(guest.readStringMember(guest.global('actor_tool_first'), 'x') === 17 && guest.readStringMember(guest.global('actor_tool_second'), 'x') === 40,
		'only the actual requested actor moved');
	check(guest.readStringMember(guest.global('actor_tool_first'), 'probe_count') === 3, 'stored method receives the selected object as self');
	check(guest.readStringMember(guest.global('actor_tool_first'), 'timeline_value') === 2, 'keyed timeline scrub samples the real target');
	check(source.version === version && ide.sources.currentBlua32Media === media && test.execution.userPaused,
		'live execution neither edits nor installs dirty source, nor releases manual pause');
	const stopped = cycles(); for (let i = 0; i < 6; i++) await frame();
	check(cycles() === stopped, 'completed Actor calls do not continue ordinary gameplay');
	await runPaletteCommand('View: Codex Assistant');
	await renderer.capture!('conversation');
	await test.clickTab(lab.id); await frame();
	check(lab.actorHashId === selection && lab.runtime.roots[0].label === 'second', 'tool execution never steals the manual actor selection');
	await renderer.capture!('manual-selection');
	await runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, 'Run the bounded long actor method until I press Stop.');
	await until(() => service.active?.invoked === true && guest.global('actor_tool_progress') !== null && service.canControl,
		'Actor execution: entered bounded guest method');
	const operation = service.active!;
	await test.click(view.turnActions.items.find(item => item.command === 'assistant.stop')!.bounds);
	check(service.paused && operation.result === undefined, `visible Stop must suspend the active call: ${JSON.stringify({
		result: operation.result, state: conversation.state, progress: guest.global('actor_tool_progress'), revision: test.execution.revision, owned: operation.executionRevision })}`);
	await until(() => conversation.state === 'ready' && service.paused, 'Actor execution: visible Stop suspends the real call');
	const progress = guest.global('actor_tool_progress'), pausedAt = cycles();
	for (let i = 0; i < 6; i++) await frame();
	check(cycles() === pausedAt && guest.global('actor_tool_progress') === progress && !operation.revoked && operation.result === undefined,
		'Stop preserves performed writes and physical frames, not a completion or rollback');
	await renderer.capture!('stopped-call');
	await submitAssistantText(test, 'Read the retained Actor operation and continue it to completion.');
	await until(() => conversation.state === 'ready' && operation.result !== undefined, 'Actor execution: later prompt continues the same operation');
	check(operation.result!.status === 'completed' && guest.global('actor_tool_progress') === 10000000,
		'continuation completes the original bounded loop');
	await test.clickTab(lab.id); await frame();
	await test.click(lab.actionBar.items.find(item => item.command === 'actorLab.spawn')!.bounds); await press('Enter');
	check(ide.editor.quickInput.title === 'SPAWN OPTIONS', 'ordinary prefab picker keeps the real spawn options');
	await press('ControlLeft', 'KeyA'); test.clipboard.text = "{ id = 'manual', pos = { x = 123, y = 456 } }";
	await press('ControlLeft', 'KeyV'); await press('Enter');
	await until(() => service.active === undefined && test.tasks.ready && !ide.debugger.plans.mutationActive, 'Actor execution: ordinary spawn finishes');
	await frame();
	check(lab.runtime.roots[0].label === 'manual' && guest.readStringMember(lab.runtime.roots[0].value, 'x') === 123,
		'ordinary spawn uses the selected definition and returns the actual World member');
	await test.click(lab.actionBar.items.find(item => item.command === 'actorLab.actions')!.bounds); await press('Enter');
	await press('ControlLeft', 'KeyA'); test.clipboard.text = '124, 457, 0'; await press('ControlLeft', 'KeyV'); await press('Enter');
	await until(() => service.active === undefined && test.tasks.ready && !ide.debugger.plans.mutationActive, 'Actor execution: ordinary action returns');
	await frame();
	check(guest.readStringMember(lab.runtime.roots[0].value, 'x') === 124 && guest.readStringMember(lab.runtime.roots[0].value, 'y') === 457
		&& guest.readStringMember(guest.global('actor_tool_first'), 'x') === 17, 'ordinary action picker executes the shared catalog on its own target');
	const eventLine = ACTOR_EXECUTION_SOURCE.split('\n').findIndex(line => line.includes('on_probe = function')) + 1;
	ide.debugger.breakpoints.set({ domain: 0, path: 'cart.lua' }, [eventLine]);
	await test.click(lab.actionBar.items.find(item => item.command === 'actorLab.emit')!.bounds);
	test.clipboard.text = 'probe_event'; await press('ControlLeft', 'KeyV'); await press('Enter');
	await press('ControlLeft', 'KeyA'); test.clipboard.text = '{ value = 77 }'; await press('ControlLeft', 'KeyV'); await press('Enter');
	await until(() => service.paused && ide.debugger.source.stop !== undefined, 'Actor execution: ordinary event reaches its breakpoint');
	ide.debugger.breakpoints.set({ domain: 0, path: 'cart.lua' }, []);
	await test.runMenuCommand('debugEvaluation');
	check(ide.debugger.source.stop === undefined, 'Run > Continue Lua Call must resume an actual source stop, not just clear control suspension');
	await until(() => service.active === undefined && test.tasks.ready && !ide.debugger.plans.mutationActive, 'Actor execution: ordinary event returns');
	await test.clickTab(lab.id); await frame();
	check(guest.readStringMember(lab.runtime.roots[0].value, 'event_value') === 77
		&& guest.readStringMember(guest.global('actor_tool_first'), 'event_value') === null, 'event emission uses the selected actor port and payload');
	await renderer.capture!('manual-spawn-event');

	// The shared execution owner also has to survive races without a provider or pane retaining its borrows.
	const invocation = (actor: 'first' | 'second', kind: 'action' | 'method', method: string, args = '') => {
		const stop = ide.inspection.open(), actors = stop.lifetime.add(new ActorRuntimeInspection(stop));
		const selected = actors.list(0, 10).actors!.find(entry => entry.id.display === actor)!;
		const node = actors.tree(selected.reference, 0, 1).nodes[0];
		const request = actors.invocation(node.reference, kind, method, args); stop.dispose(); return request;
	};
	const settle = (label: string) => until(() => service.active === undefined && test.tasks.ready && !ide.debugger.plans.mutationActive, label);
	const before = guest.readStringMember(guest.global('actor_tool_first'), 'probe_count');
	const queuedLifetime = new AbortController(), queued = service.start(invocation('first', 'method', 'probe', '99'), { signal: queuedLifetime.signal });
	const queuedWait = service.waitForStop(queued, queuedLifetime.signal); queuedLifetime.abort();
	await queuedWait.then(() => { throw new Error('Cancelled queue should reject'); }, error => check(error.name === 'AbortError', 'queue cancellation'));
	await settle('Actor execution: cancellation retires queued admission');
	check(queued.result!.status === 'interrupted' && !queued.invoked && guest.readStringMember(guest.global('actor_tool_first'), 'probe_count') === before,
		'cancelled queued requests never enter the actor');

	const lifetime = new AbortController(), boundary = service.start(invocation('first', 'method', 'probe', '99'), { signal: lifetime.signal });
	await test.tasks.join();
	check(!boundary.invoked && ide.debugger.plans.workbenchControlActive, 'real admission call exists before the actor is entered');
	ide.debugger.plans.setControlSuspended(true); service.afterHostFrame();
	check((await service.waitForStop(boundary, lifetime.signal)).status === 'paused', 'pre-invocation pause settles the waiter');
	lifetime.abort();
	check(boundary.revoked, 'prompt retirement still revokes the request after its paused waiter detached');
	service.setPaused(boundary, false); await settle('Actor execution: revoked boundary drains without actor invocation');
	check(!boundary.invoked && boundary.result!.status === 'interrupted' && guest.readStringMember(guest.global('actor_tool_first'), 'probe_count') === before,
		'continuing a revoked admission call cannot revive the mutation');

	service.start(invocation('first', 'method', 'arm', "'remove'")); await settle('Actor execution: arm guest-owned removal');
	const removed = service.start(invocation('second', 'method', 'probe', '99')); await settle('Actor execution: World removes target before admission');
	check(removed.result!.status === 'rejected' && !removed.invoked && test.tasks.failure === undefined,
		'World membership expiry rejects an operation, not the runtime task queue');
	service.start(invocation('first', 'method', 'arm', "'method'")); await settle('Actor execution: arm guest-owned method replacement');
	const replaced = service.start(invocation('first', 'method', 'probe', '99')); await settle('Actor execution: stored method replaced before admission');
	check(replaced.result!.status === 'rejected' && !replaced.invoked && guest.readStringMember(guest.global('actor_tool_first'), 'probe_count') === before,
		'same-named replacement method is not silently called');

	service.start(invocation('first', 'method', 'arm', "'program'")); await settle('Actor execution: arm timeline program replacement');
	const stop = ide.inspection.open(), actors = stop.lifetime.add(new ActorRuntimeInspection(stop));
	const actor = actors.list(0, 1).actors![0], timeline = actors.tree(actor.reference, 0, 100).nodes.find(node => node.kind === 'timeline')!;
	const request = actors.invocation(timeline.reference, 'action', 'scrub_time', '0');
	if (request.kind !== 'action') throw new Error('Action request required');
	const tree = new ActorRuntimeTree(); tree.update(ide.sources, guest, 0, findRuntimeActor(ide.sources, guest, 0, request.target.actorHashId));
	const program = (guest.readStringMember(resolveActorTarget(tree.roots, request.target, guest)!.value, 'program') as Table).hashId;
	stop.dispose(); tree.dispose();
	const scrub = service.start({ kind: 'scrub', target: request.target, programHashId: program, time: 0 });
	await settle('Actor execution: stale slider program is rejected');
	check(scrub.result!.status === 'rejected' && !scrub.invoked, 'old slider samples cannot seek a replacement program');

	service.start(invocation('first', 'method', 'arm', "'world'")); await settle('Actor execution: arm World binding replacement');
	const world = service.start(invocation('first', 'action', 'set_pos', '900, 900, 0'));
	await settle('Actor execution: replaced World rejects admission');
	check(world.result!.status === 'rejected' && !world.invoked && test.tasks.failure === undefined,
		'World expiry is not a host failure or a fallback to the previous object');
	await renderer.finish(); await ide.editor.shutdown();
	return { actorExecution: 'pass', target: ide.inspection.target };
}
