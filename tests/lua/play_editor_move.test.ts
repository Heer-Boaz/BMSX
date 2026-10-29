import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { RemoteInput } from '../../hosts/common/input/remote';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { TestInput } from '../../ide/testing/input';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { PlayRuntimeSession } from '../../ide/workbench/play_runtime';
import type { PlayHandle } from '../../ide/workbench/services/play/service';
import { PlayEditorInput } from '../../ide/workbench/contrib/play/editor_input';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { describePlaySession } from '../../ide/workbench/contrib/play/details';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { COROUTINE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createLoadedTestRuntimeSourceState, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH as PATH } from '../helpers/scenario_media';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

const SCENE = `local game<const> = require('game')
return {kind='integration', setup=function(t) game.marker=12; t:capture('ready') end,
 teardown=function(t) game.closed=true; t:log('cleanup') end,
 tests={never=function() error('Play cannot execute this case') end}}`;

async function fixture(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-play-editor-'));
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const media = await buildScenarioMediaFixture(directory, [{ path: PATH, source: SCENE }], {
		systemSource: "module<entry>\nrequire('base')\ncoroutine=require('coroutine')\ncop0.exec=mem[0x10000028]",
		systemModules: [{ path: 'base', source: 'local raise<const> = __bmsx_error\nassert=function(value,message) if not value then raise(message) end return value end\nerror=raise\nsetmetatable=__bmsx_setmetatable' }, ...COROUTINE_FIRMWARE_MODULES],
		cartSource: `module<entry>
local game<const> = require('game')
function irq(flags) mem[0x08000064]=1; mem[0x08000004]=flags end
mem[0x08000064]=1; mem[0x08000008]=4
while true do game.updates=game.updates+1; halt_until_irq end`,
		cartModules: [{ path: 'game', source: 'return {updates=0}' }],
	});
	const tooling = await loadRomToolingMedia(media.systemRom, [media.cartRom, null]);
	const sources = createLoadedTestRuntimeSourceState(tooling.system, tooling.cartridgeSlots);
	const primary = new OffscreenMachine(media.systemRom, [media.cartRom, null], PSX_MACHINE_SPEC, new TestInput());
	const host = createHostFrameFixture(primary.runtime), sessions: PlayRuntimeSession[] = [];
	const clipboard = new HeadlessClipboard();
	const externalWork = (): never => { throw new Error('Play editor movement does not request external work.'); };
	const ide = new RuntimeIdeState(primary.runtime, host.presenter, { capture: externalWork }, externalWork,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, clipboard,
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 800, height: 320 }, sources, new Map(), externalWork, externalWork,
		(system, slots, model, channel, program) => {
			const session = new PlayRuntimeSession(new OffscreenMachine(system, slots, model, channel), program, host.audio.device, { log() {} });
			sessions.push(session); return session;
		});
	const editor = ide.editor;
	ide.boots.didReplaceMachine(); editor.interaction.setActive(true); editorRuntimeState.active = true;
	host.input.setPointerAdmissionMode('routed');
	const firstPart = editor.editorParts.createDocument(), secondPart = editor.editorParts.createDocument();
	const module = ide.scenarioRuns.collection.findModuleBySourcePath(TEST_CARTRIDGE_CONTEXT_IDS[0], PATH);
	const model = editorTextModelService.retain(sources.catalog.luaResources.find(resource => resource.path === PATH)!, 'lua', SCENE);
	const update = () => editor.update(0);
	const advance = async () => { ide.play.advance(1000 / 60); await ide.play.current?.session?.tasks.join(); await setImmediate(); update(); };
	const ready = async (handle: PlayHandle) => {
		await handle.preparation;
		for (let grant = 0; handle.state !== 'ready' && grant < 2000; grant++) await advance();
		assert.equal(handle.state, 'ready', handle.failure?.error instanceof Error ? handle.failure.error.message : undefined);
	};
	const key = (code: string, modifiers = KeyModifier.none) => {
		editor.dispatchKey(new KeyInputEvent(code, modifiers)); editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false)); update();
	};
	t.after(async () => {
		inputFocus.setTarget(null); pointerCapture.interrupt(false); editor.editorParts.clear();
		await editor.shutdown(); clearBackgroundTasks(); host.audio.dispose(); host.input.dispose(); primary.dispose();
		editorTextModelService.clear(); closeWorkspaceRecords(); await rm(directory, { recursive: true, force: true });
	});
	update();
	return { ide, editor, host, primary, sources, sessions, clipboard, firstPart, secondPart, module, model, update, advance, ready, key };
}

test('preparing Play moves its exact retained handle and survives closing its former window', async t => {
	const f = await fixture(t), play = f.editor.play, service = play.service, close = t.mock.method(service, 'close');
	play.start(f.module, f.firstPart.activeGroup);
	const input = play.input!; assert.ok(input instanceof PlayEditorInput);
	const handle = input.handle; assert.equal(handle.state, 'preparing'); assert.equal(input.interaction.transport, null);
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	assert.ok(f.secondPart.activeGroup.model.activeTab === input); assert.ok(input.handle === handle);
	assert.equal(await f.editor.editorParts.close(f.firstPart), true); assert.equal(close.mock.callCount(), 0);
	await f.ready(handle);
	assert.ok(input.handle === handle); assert.ok(input.interaction.transport === handle.session!.transport);
	assert.equal(handle.session!.execution.paused, true, 'the ready physical target inherits its retained stopped chrome intent');
	assert.ok(handle.session === f.sessions[0]); assert.ok(f.ide.runTargets.selected === handle.session, 'the moved ready Play view selects its own physical target');
	const pane = f.secondPart.activeGroup.panes.activePane!, runtime = handle.session!.target.runtime;
	f.editor.commands.execute('runtime.resume', pane.commandTarget);
	assert.equal(input.interaction.running, true); assert.equal(handle.session!.execution.paused, false);
	const cycles = runtime.machine.scheduler.nowCycles, revision = handle.session!.execution.revision;
	f.editor.editorParts.minimize(f.secondPart);
	play.revealCurrent(f.editor.editorParts.main.activeGroup);
	assert.equal(f.secondPart.window!.model.minimized, false); assert.ok(f.secondPart.activeGroup.panes.activePane === pane);
	assert.equal(input.interaction.running, true); assert.equal(runtime.machine.scheduler.nowCycles, cycles);
	assert.equal(handle.session!.execution.revision, revision); assert.equal(f.editor.editorParts.main.activeGroup.model.findById(input.id), undefined);
	await f.secondPart.activeGroup.close(input.id);
	await handle.closeOperation;
	assert.equal(close.mock.callCount(), 1); assert.equal(handle.closed, true); assert.ok(play.input === undefined, 'closing the moved Play input retires its controller membership');
});

test('Play chrome intent moves independently of guest input and Reset replaces only its captured physical handle', async t => {
	const f = await fixture(t), play = f.editor.play;
	play.start(f.module, f.firstPart.activeGroup); const input = play.input!, first = input.handle;
	await f.ready(first); f.update();
	const original = f.firstPart.activeGroup.panes.activePane!;
	f.key('Tab'); const guest = inputFocus.target!;
	assert.equal(guest.guestInput!.recipient, first.session!.input.physical);
	original.commandTarget.focus(); f.editor.commands.execute('runtime.resume', original.commandTarget);
	const cycles = first.session!.target.runtime.machine.scheduler.nowCycles, revision = first.session!.execution.revision;
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	const destination = f.secondPart.activeGroup.panes.activePane!;
	assert.equal(guest.guestInput, undefined); assert.equal(f.editor.guestInputRecipient, null);
	assert.equal(original.commandTarget.scope.runtime, undefined); assert.equal(input.interaction.running, true);
	assert.equal(first.session!.execution.paused, false); assert.equal(first.session!.execution.revision, revision);
	assert.equal(first.session!.target.runtime.machine.scheduler.nowCycles, cycles);
	assert.equal(original.commandTarget.getCommand('play.stop')!.isEnabled(), false);
	f.model.pushEditOperations([{ offset: SCENE.indexOf('12'), deleteLength: 2, text: '34' }]);
	const native = new RemoteInput(f.host.input, f.host.clock, undefined,
		event => f.editor.dispatchPointer(event), event => f.editor.dispatchWheel(event));
	const stop = input.actionBar.items.find(item => item.command === 'play.stop')!.bounds;
	native.apply([{ type: 'pointer', x: (stop.left + stop.right) / 2, y: (stop.top + stop.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]);
	assert.equal(input.actionBar.pressedCommand, 'play.stop');
	f.editor.commands.execute('play.reset', destination.commandTarget);
	const next = input.handle;
	assert.equal(input.actionBar.pressedCommand, null, 'replacing the physical handle retires an old held Stop before its release');
	native.apply([{ type: 'button', button: 'primary', down: false }]); assert.equal(next.closing, false);
	assert.notEqual(next, first); assert.equal(play.input, input); assert.equal(input.interaction.transport, null);
	await f.ready(next);
	assert.equal(first.closed, true); assert.equal(first.session!.state, 'closed');
	assert.notEqual(next.session!.target.runtime, first.session!.target.runtime);
	assert.equal(input.interaction.transport, next.session!.transport); assert.equal(input.interaction.running, false);
	assert.equal(next.session!.execution.paused, true);
	assert.equal(f.secondPart.activeGroup.model.activeTab, input); assert.equal(f.firstPart.activeGroup.model.findById(input.id), undefined);
	const game = next.session!.guest.global(buildModuleExportSlotName('game', []));
	assert.equal(next.session!.guest.readStringMember(game, 'marker'), 34);
	f.editor.commands.execute('editor.source', f.secondPart.activeGroup.panes.activePane!.commandTarget); await setImmediate(); f.update();
	const source = f.secondPart.activeGroup.panes.activePane;
	assert.ok(source instanceof CodeEditorPane && source.input.workingCopy === f.model);
	assert.equal(next.closed, false); assert.equal(f.ide.runTargets.selected, next.session);
	play.revealCurrent(f.firstPart.activeGroup);
	f.editor.commands.execute('play.stop', f.secondPart.activeGroup.panes.activePane!.commandTarget);
	for (let grant = 0; next.state !== 'stopped' && grant < 2000; grant++) await f.advance();
	assert.equal(next.state, 'stopped'); assert.equal(next.closed, false); assert.equal(input.interaction.running, false);
	assert.equal(next.session!.evidence.logs.at(-1).text, 'cleanup');
	await f.secondPart.activeGroup.close(input.id); await next.closeOperation; assert.equal(next.closed, true);
});

test('Play More belongs to its invoking toolbar while another Part retains keyboard focus', async t => {
	const f = await fixture(t), play = f.editor.play;
	f.firstPart.window!.model.setRequestedBounds({ left: 0, top: 32, right: 384, bottom: 290 });
	f.secondPart.window!.model.setRequestedBounds({ left: 400, top: 32, right: 800, bottom: 290 });
	play.start(f.module, f.firstPart.activeGroup); const input = play.input!, handle = input.handle; await f.ready(handle);
	const pane = f.firstPart.activeGroup.panes.activePane!;
	f.secondPart.activeGroup.openEditor(new GameViewInput()); f.update();
	const foreign = inputFocus.target!, menu = f.editor.contextMenu;
	assert.ok(foreign === f.secondPart.activeGroup.panes.activePane!.commandTarget);
	const cycles = handle.session!.target.runtime.machine.scheduler.nowCycles;
	const pointer = new RemoteInput(f.host.input, f.host.clock, undefined, event => f.editor.dispatchPointer(event));
	t.after(() => pointer.release());
	const more = input.actionBar.items.find(item => item.command === 'play.more')!.bounds;
	pointer.apply([{ type: 'pointer', x: (more.left + more.right) / 2, y: (more.top + more.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]);
	assert.ok(inputFocus.target === foreign, 'toolbar admission does not replace another Part keyboard focus');
	pointer.apply([{ type: 'button', button: 'primary', down: false }]);
	assert.equal(menu.visible, true);
	assert.ok(menu.returnFocus === foreign, 'invocation ownership does not replace the original keyboard focus return');
	const popup = f.editor.surfaces.findByScope(menu.pointerScope)!;

	f.editor.editorParts.minimize(f.secondPart); f.update();
	assert.equal(menu.visible, true, 'minimizing an unrelated keyboard-focus owner cannot retire the Play popup');
	assert.equal(popup.retired, false);
	assert.ok(menu.invocationOrigin!.commandContext === pane.commandTarget);
	assert.ok(popup.lifetimeOwner === f.firstPart.activeGroup.paneSurface, 'the popup belongs to the toolbar pane, not the foreign focused pane');
	f.editor.editorParts.minimize(f.firstPart); f.update();
	assert.equal(menu.visible, false, 'withholding the invoking toolbar retires its physical popup');
	assert.equal(popup.retired, true);
	assert.equal(handle.session!.target.runtime.machine.scheduler.nowCycles, cycles);
	assert.equal(handle.closed, false);
});

test('late Play preparation failure stays on its captured view and never activates an unrelated window', async t => {
	const f = await fixture(t), play = f.editor.play;
	const at = SCENE.indexOf("require('game')");
	f.model.pushEditOperations([{ offset: at, deleteLength: "require('game')".length, text: "require('missing_play_dependency')" }]);
	f.ide.scenarioRuns.refreshSources(); play.start(f.module, f.firstPart.activeGroup);
	const input = play.input!, handle = input.handle;
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, { kind: 'window' }), true);
	const destination = f.editor.editorParts.activePart;
	f.secondPart.activeGroup.openEditor(new GameViewInput()); const focus = inputFocus.target;
	await handle.preparation; f.update();
	assert.equal(handle.state, 'failed'); assert.ok(handle.failure); assert.equal(inputFocus.target, focus);
	assert.equal(f.editor.editorParts.activePart, f.secondPart); assert.equal(destination.activeGroup.model.activeTab, input);
	assert.equal(destination.activeGroup.model.findById('host-error'), undefined); assert.equal(f.editor.editorParts.main.activeGroup.model.findById('host-error'), undefined);
	assert.equal(handle.session, undefined);
	const error = handle.failure.error; assert.ok(error instanceof Error);
	const properties = describePlaySession(handle), message = properties.findIndex(property => property.warning && property.value === error.message);
	const stack = properties.findIndex(property => property.warning && property.value === error.stack);
	assert.ok(message >= 0 && stack >= 0);
	play.revealCurrent(f.secondPart.activeGroup);
	const pane = destination.activeGroup.panes.activePane!;
	f.editor.commands.execute('play.details', pane.commandTarget); f.update();
	assert.notEqual(inputFocus.target, pane.commandTarget); assert.equal(destination.activeGroup.model.activeTab, input);
	f.key('Home'); for (let row = 0; row < message; row++) f.key('ArrowDown');
	f.key('KeyC', KeyModifier.ctrl); assert.equal(await f.clipboard.readText(), error.message);
	f.key('Home'); for (let row = 0; row < stack; row++) f.key('ArrowDown');
	f.key('KeyC', KeyModifier.ctrl); assert.equal(await f.clipboard.readText(), error.stack);
});

test('Play physical Reset and Stop retire their exact moved Actor view without orphaned group membership', async t => {
	const f = await fixture(t), play = f.editor.play;
	play.start(f.module, f.firstPart.activeGroup); const input = play.input!, first = input.handle; await f.ready(first);
	f.editor.commands.execute('play.actors', f.firstPart.activeGroup.panes.activePane!.commandTarget); f.update();
	const actors = f.firstPart.activeGroup.model.activeTab; assert.ok(actors?.kind === 'actor_lab');
	assert.equal(actors.controller.viewport.transport, first.session!.transport); assert.equal(f.firstPart.quickInput.visible, true);
	let retired = 0; actors.onWillDispose(() => { retired++; });
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, actors, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	assert.equal(f.firstPart.quickInput.visible, false); assert.equal(f.secondPart.activeGroup.model.activeTab, actors);
	const reset = play.captureCommand('play.reset', input)!;
	assert.equal(play.isCommandInvocationEnabled(reset), true);
	play.executeCommand(reset, f.firstPart.activeGroup, f.firstPart.quickInput, () => input.isBindingCurrent(reset.handle, reset.binding));
	assert.equal(retired, 1); assert.equal(f.secondPart.activeGroup.model.findById(actors.id), undefined);
	const next = input.handle; await f.ready(next);
	f.editor.commands.execute('play.actors', f.firstPart.activeGroup.panes.activePane!.commandTarget); f.update();
	const nextActors = f.firstPart.activeGroup.model.activeTab; assert.ok(nextActors?.kind === 'actor_lab');
	assert.notEqual(nextActors, actors); assert.equal(nextActors.controller.viewport.transport, next.session!.transport);
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, nextActors, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	const stop = play.captureCommand('play.stop', input)!;
	assert.equal(play.isCommandInvocationEnabled(stop), true);
	play.executeCommand(stop, f.firstPart.activeGroup, f.firstPart.quickInput, () => input.isBindingCurrent(stop.handle, stop.binding));
	for (let grant = 0; next.state !== 'stopped' && grant < 2000; grant++) await f.advance();
	assert.equal(next.state, 'stopped'); assert.equal(f.secondPart.activeGroup.model.findById(nextActors.id), undefined);
	assert.equal(f.firstPart.activeGroup.model.findById(input.id), input); assert.equal(next.closed, false);
});

test('focused Play failures open their diagnostic only in the moved input owner', async t => {
	const f = await fixture(t), play = f.editor.play, at = SCENE.indexOf("require('game')");
	f.model.pushEditOperations([{ offset: at, deleteLength: "require('game')".length, text: "require('missing_play_dependency')" }]);
	f.ide.scenarioRuns.refreshSources(); play.start(f.module, f.firstPart.activeGroup);
	const input = play.input!, handle = input.handle;
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, { kind: 'group', group: f.secondPart.activeGroup }), true);
	await handle.preparation; f.update();
	assert.equal(handle.state, 'failed'); assert.equal(f.secondPart.activeGroup.model.activeTab?.kind, 'host_error');
	assert.equal(f.secondPart.activeGroup.model.findById(input.id), input);
	assert.equal(f.firstPart.activeGroup.model.findById('host-error'), undefined); assert.equal(f.editor.editorParts.main.activeGroup.model.findById('host-error'), undefined);
});

test('moved Play Details discloses the original quarantined host error and stack only after explicit inspection', async t => {
	const f = await fixture(t), play = f.editor.play;
	play.start(f.module, f.firstPart.activeGroup); const input = play.input!, handle = input.handle; await f.ready(handle);
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, { kind: 'window' }), true); f.update();
	const destination = f.editor.editorParts.activePart, session = handle.session!, error = new Error('Play backend failure');
	f.secondPart.activeGroup.openEditor(new GameViewInput()); const focus = inputFocus.target;
	await session.tasks.schedule(() => { throw error; }, () => {}); await f.advance();
	assert.equal(handle.state, 'faulted'); assert.equal(session.failure?.kind, 'host');
	assert.ok(session.failure?.kind === 'host' && session.failure.error === error);
	assert.equal(inputFocus.target, focus); assert.equal(destination.activeGroup.model.activeTab, input);
	const properties = describePlaySession(handle), message = properties.findIndex(property => property.warning && property.value === error.message);
	const stack = properties.findIndex(property => property.warning && property.value === error.stack);
	assert.ok(message >= 0 && stack >= 0);
	play.revealCurrent(f.secondPart.activeGroup);
	const pane = destination.activeGroup.panes.activePane!;
	f.editor.commands.execute('play.details', pane.commandTarget); f.update(); assert.notEqual(inputFocus.target, pane.commandTarget);
	f.key('Home'); for (let row = 0; row < message; row++) f.key('ArrowDown');
	f.key('KeyC', KeyModifier.ctrl); assert.equal(await f.clipboard.readText(), error.message);
	f.key('Home'); for (let row = 0; row < stack; row++) f.key('ArrowDown');
	f.key('KeyC', KeyModifier.ctrl); assert.equal(await f.clipboard.readText(), error.stack);
});

test('Play Reset presentation reads retained membership without refreshing authored source', async t => {
	const f = await fixture(t); f.editor.play.start(f.module, f.firstPart.activeGroup);
	const pane = f.firstPart.activeGroup.panes.activePane!, refresh = t.mock.method(f.ide.scenarioRuns, 'refreshSources');
	assert.equal(pane.commandTarget.getCommand('play.reset')!.isEnabled(), true);
	assert.equal(f.editor.commands.isEnabled('play.reset', pane.commandTarget), true);
	assert.equal(refresh.mock.callCount(), 0);
});

for (const route of ['native', 'application'] as const) {
	test(`${route} Reset captures its existing fixture membership before a draft reparses it`, async t => {
		const f = await fixture(t); f.editor.play.start(f.module, f.firstPart.activeGroup);
		const input = f.editor.play.input!, old = input.handle, pane = f.firstPart.activeGroup.panes.activePane!;
		const field = inputFocus.createTarget(pane.commandTarget, new InputFocusScope(pane.commandTarget.scope.surfaceScope, pane.commandTarget.scope));
		let pending = true;
		field.edit = { get pending() { return pending; }, cancel() { pending = false; }, commit() {
			pending = false; f.model.pushEditOperations([{ offset: SCENE.indexOf('12'), deleteLength: 2, text: '34' }]); return true;
		} };
		field.focus();
		if (route === 'native') inputFocus.executeCommand('play.reset', pane.commandTarget);
		else f.editor.commands.execute('play.reset', pane.commandTarget);
		assert.equal(pending, false);
		assert.notEqual(input.handle, old);
		assert.equal(input.handle.source, SCENE.replace('12', '34'));
		await f.ready(input.handle);
		assert.equal(old.closed, true);
	});

	for (const revocation of ['binding', 'attachment'] as const) test(`${route} Reset rejects a returned ${revocation} after draft acceptance`, async t => {
		const f = await fixture(t); f.editor.play.start(f.module, f.firstPart.activeGroup);
		const input = f.editor.play.input!, handle = input.handle, pane = f.firstPart.activeGroup.panes.activePane!;
		const reset = t.mock.method(f.editor.play.service, 'reset');
		const field = inputFocus.createTarget(pane.commandTarget, new InputFocusScope(pane.commandTarget.scope.surfaceScope, pane.commandTarget.scope));
		let pending = true;
		field.edit = { get pending() { return pending; }, cancel() { pending = false; }, commit() {
			pending = false;
			if (revocation === 'binding') input.replaceHandle(handle);
			else {
				f.firstPart.activeGroup.openEditor(new GameViewInput());
				f.firstPart.activeGroup.activate(input.id);
			}
			return true;
		} };
		field.focus();
		if (route === 'native') inputFocus.executeCommand('play.reset', pane.commandTarget);
		else f.editor.commands.execute('play.reset', pane.commandTarget);
		assert.equal(pending, false);
		assert.equal(reset.mock.callCount(), 0);
		assert.equal(input.handle, handle);
	});

	test(`${route} Stop cannot target a replacement admitted by its interaction publication`, async t => {
		const f = await fixture(t), play = f.editor.play;
		play.start(f.module, f.firstPart.activeGroup); const input = play.input!, old = input.handle;
		await f.ready(old);
		input.interaction.running = true;
		const stop = t.mock.method(play.service, 'stop');
		const unbind = input.interaction.onDidChange(() => {
			unbind();
			void play.service.close(old); play.start(f.module, f.secondPart.activeGroup);
		});
		t.after(unbind);
		const target = f.firstPart.activeGroup.panes.activePane!.commandTarget;
		if (route === 'native') inputFocus.executeCommand('play.stop', target);
		else f.editor.commands.execute('play.stop', target);
		const newer = play.input!.handle;
		assert.notEqual(newer, old);
		assert.equal(stop.mock.callCount(), 0);
		assert.equal(newer.closing, false);
		await f.ready(newer);
	});
}

test('an unrelated editor has no implicit Play session command but explicit Reveal retains the real Play owner', async t => {
	const f = await fixture(t), play = f.editor.play;
	play.start(f.module, f.firstPart.activeGroup); const input = play.input!, handle = input.handle;
	f.secondPart.activeGroup.openEditor(new GameViewInput());
	const foreign = f.secondPart.activeGroup.panes.activePane!.commandTarget;
	for (const command of ['play.stop', 'play.reset', 'play.actors', 'play.breakpoints', 'play.continue'] as const) {
		assert.equal(f.editor.commands.isEnabled(command, foreign), false);
		f.editor.commands.execute(command, foreign);
	}
	assert.equal(input.handle, handle); assert.equal(handle.closing, false);
	f.editor.commands.execute('play.reveal', foreign);
	assert.equal(f.firstPart.activeGroup.model.activeTab, input);
	assert.equal(f.secondPart.activeGroup.model.contains(input), false);
});

test('Play Source captures its handle passively and resolves the canonical current text, not captured fixture bytes', async t => {
	const f = await fixture(t); f.editor.play.start(f.module, f.firstPart.activeGroup);
	const input = f.editor.play.input!, pane = f.firstPart.activeGroup.panes.activePane!;
	const retain = t.mock.method(editorTextModelService, 'retain');
	const request = pane.captureSourceLocation()!;
	assert.equal(retain.mock.callCount(), 0);
	f.model.pushEditOperations([{ offset: SCENE.indexOf('12'), deleteLength: 2, text: '34' }]);
	const location = await request.readLocation();
	assert.equal(location!.model, f.model); assert.equal(location!.modelVersion, f.model.version);
	assert.equal(input.handle.source, SCENE);
	input.replaceHandle(input.handle);
	assert.equal(request.isCurrent!(), false);
	assert.equal(await request.readLocation(), undefined);
});

test('a newer Play request during Reset close publication owns the retained input instead of the old Reset', async t => {
	const f = await fixture(t), play = f.editor.play;
	play.start(f.module, f.firstPart.activeGroup); const input = play.input!, old = input.handle;
	let newer: PlayHandle | undefined;
	t.after(play.service.onDidChange(event => {
		if (event.handle !== old || !old.closing || newer !== undefined) return;
		play.start(f.module, f.secondPart.activeGroup); newer = play.input!.handle;
	}));
	inputFocus.executeCommand('play.reset', f.firstPart.activeGroup.panes.activePane!.commandTarget);
	assert.ok(newer !== undefined); assert.equal(input.handle, newer); assert.equal(play.service.current, newer);
	await f.ready(newer);
	assert.equal(old.closed, true); assert.equal(newer.closing, false);
});

for (const change of ['dispose', 'claim'] as const) test(`a Reset replacement ${change} during will-change publication is not overwritten or wrongly closed`, async t => {
	const f = await fixture(t), play = f.editor.play;
	play.start(f.module, f.firstPart.activeGroup); const input = play.input!, old = input.handle;
	let candidate: PlayHandle | undefined;
	const unbind = input.onWillChangeHandle(() => {
		unbind(); candidate = play.service.current!;
		if (change === 'dispose') f.firstPart.activeGroup.removeEditor(input);
		else input.replaceHandle(candidate);
	});
	t.after(unbind);
	inputFocus.executeCommand('play.reset', f.firstPart.activeGroup.panes.activePane!.commandTarget);
	assert.ok(candidate !== undefined); assert.notEqual(candidate, old);
	if (change === 'dispose') {
		assert.equal(play.input, undefined); assert.equal(play.service.current, undefined);
		await candidate.closeOperation; assert.equal(candidate.closed, true);
	} else {
		assert.equal(play.input, input); assert.equal(input.handle, candidate); assert.equal(play.service.current, candidate);
		assert.equal(candidate.closing, false); await f.ready(candidate);
	}
});

test('input runtime publication rejects an outer replacement without reviving an older binding receipt', async t => {
	const f = await fixture(t), play = f.editor.play;
	play.start(f.module, f.firstPart.activeGroup); const input = play.input!, handle = input.handle;
	await f.ready(handle);
	const before = input.bindingRevision;
	const unbind = input.interaction.onDidChange(() => { unbind(); input.replaceHandle(handle); });
	t.after(unbind);
	assert.equal(input.replaceHandle(handle), undefined);
	assert.equal(input.handle, handle); assert.equal(input.isBindingCurrent(handle, before), false);
	assert.equal(input.isBindingCurrent(handle, input.bindingRevision), true);
	assert.equal(input.interaction.transport, handle.session!.transport);
});
