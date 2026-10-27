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
import { inputFocus } from '../../ide/input/focus';
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
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, f.secondPart.activeGroup, f.editor.editorClose), true); f.update();
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
	play.execute('play.reveal', input, f.editor.editorParts.main.activeGroup, f.editor.editorParts.main.quickInput);
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
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, f.secondPart.activeGroup, f.editor.editorClose), true); f.update();
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
	f.editor.commands.execute('play.source', f.secondPart.activeGroup.panes.activePane!.commandTarget); await setImmediate(); f.update();
	const source = f.secondPart.activeGroup.panes.activePane;
	assert.ok(source instanceof CodeEditorPane && source.input.workingCopy === f.model);
	assert.equal(next.closed, false); assert.equal(f.ide.runTargets.selected, next.session);
	play.execute('play.reveal', input, f.firstPart.activeGroup, f.firstPart.quickInput);
	f.editor.commands.execute('play.stop', f.secondPart.activeGroup.panes.activePane!.commandTarget);
	for (let grant = 0; next.state !== 'stopped' && grant < 2000; grant++) await f.advance();
	assert.equal(next.state, 'stopped'); assert.equal(next.closed, false); assert.equal(input.interaction.running, false);
	assert.equal(next.session!.evidence.logs.at(-1).text, 'cleanup');
	await f.secondPart.activeGroup.close(input.id); await next.closeOperation; assert.equal(next.closed, true);
});

test('late Play preparation failure stays on its captured view and never activates an unrelated window', async t => {
	const f = await fixture(t), play = f.editor.play;
	const at = SCENE.indexOf("require('game')");
	f.model.pushEditOperations([{ offset: at, deleteLength: "require('game')".length, text: "require('missing_play_dependency')" }]);
	f.ide.scenarioRuns.refreshSources(); play.start(f.module, f.firstPart.activeGroup);
	const input = play.input!, handle = input.handle;
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, 'new', f.editor.editorClose), true);
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
	play.execute('play.reveal', input, f.secondPart.activeGroup, f.secondPart.quickInput);
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
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, actors, f.secondPart.activeGroup, f.editor.editorClose), true); f.update();
	assert.equal(f.firstPart.quickInput.visible, false); assert.equal(f.secondPart.activeGroup.model.activeTab, actors);
	play.execute('play.reset', input, f.firstPart.activeGroup, f.firstPart.quickInput);
	assert.equal(retired, 1); assert.equal(f.secondPart.activeGroup.model.findById(actors.id), undefined);
	const next = input.handle; await f.ready(next);
	f.editor.commands.execute('play.actors', f.firstPart.activeGroup.panes.activePane!.commandTarget); f.update();
	const nextActors = f.firstPart.activeGroup.model.activeTab; assert.ok(nextActors?.kind === 'actor_lab');
	assert.notEqual(nextActors, actors); assert.equal(nextActors.controller.viewport.transport, next.session!.transport);
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, nextActors, f.secondPart.activeGroup, f.editor.editorClose), true); f.update();
	play.execute('play.stop', input, f.firstPart.activeGroup, f.firstPart.quickInput);
	for (let grant = 0; next.state !== 'stopped' && grant < 2000; grant++) await f.advance();
	assert.equal(next.state, 'stopped'); assert.equal(f.secondPart.activeGroup.model.findById(nextActors.id), undefined);
	assert.equal(f.firstPart.activeGroup.model.findById(input.id), input); assert.equal(next.closed, false);
});

test('focused Play failures open their diagnostic only in the moved input owner', async t => {
	const f = await fixture(t), play = f.editor.play, at = SCENE.indexOf("require('game')");
	f.model.pushEditOperations([{ offset: at, deleteLength: "require('game')".length, text: "require('missing_play_dependency')" }]);
	f.ide.scenarioRuns.refreshSources(); play.start(f.module, f.firstPart.activeGroup);
	const input = play.input!, handle = input.handle;
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, f.secondPart.activeGroup, f.editor.editorClose), true);
	await handle.preparation; f.update();
	assert.equal(handle.state, 'failed'); assert.equal(f.secondPart.activeGroup.model.activeTab?.kind, 'host_error');
	assert.equal(f.secondPart.activeGroup.model.findById(input.id), input);
	assert.equal(f.firstPart.activeGroup.model.findById('host-error'), undefined); assert.equal(f.editor.editorParts.main.activeGroup.model.findById('host-error'), undefined);
});

test('moved Play Details discloses the original quarantined host error and stack only after explicit inspection', async t => {
	const f = await fixture(t), play = f.editor.play;
	play.start(f.module, f.firstPart.activeGroup); const input = play.input!, handle = input.handle; await f.ready(handle);
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, 'new', f.editor.editorClose), true); f.update();
	const destination = f.editor.editorParts.activePart, session = handle.session!, error = new Error('Play backend failure');
	f.secondPart.activeGroup.openEditor(new GameViewInput()); const focus = inputFocus.target;
	await session.tasks.schedule(() => { throw error; }, () => {}); await f.advance();
	assert.equal(handle.state, 'faulted'); assert.equal(session.failure?.kind, 'host');
	assert.ok(session.failure?.kind === 'host' && session.failure.error === error);
	assert.equal(inputFocus.target, focus); assert.equal(destination.activeGroup.model.activeTab, input);
	const properties = describePlaySession(handle), message = properties.findIndex(property => property.warning && property.value === error.message);
	const stack = properties.findIndex(property => property.warning && property.value === error.stack);
	assert.ok(message >= 0 && stack >= 0);
	play.execute('play.reveal', input, f.secondPart.activeGroup, f.secondPart.quickInput);
	const pane = destination.activeGroup.panes.activePane!;
	f.editor.commands.execute('play.details', pane.commandTarget); f.update(); assert.notEqual(inputFocus.target, pane.commandTarget);
	f.key('Home'); for (let row = 0; row < message; row++) f.key('ArrowDown');
	f.key('KeyC', KeyModifier.ctrl); assert.equal(await f.clipboard.readText(), error.message);
	f.key('Home'); for (let row = 0; row < stack; row++) f.key('ArrowDown');
	f.key('KeyC', KeyModifier.ctrl); assert.equal(await f.clipboard.readText(), error.stack);
});
