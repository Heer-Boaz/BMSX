import assert from 'node:assert/strict';
import test, { after, before, afterEach, beforeEach, type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { TestInput } from '../../ide/testing/input';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { ScenarioLabInput } from '../../ide/workbench/contrib/scenario_lab/editor_input';
import { ScenarioLabEditorPane } from '../../ide/workbench/contrib/scenario_lab/editor_pane';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { selectScenarioLabTestRow, selectScenarioLabResultRow, toggleScenarioLabResultRow } from '../../ide/workbench/contrib/scenario_lab/navigation';
import { captureScenarioLabTestView } from '../../ide/workbench/contrib/scenario_lab/view_snapshot';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH, type ScenarioMediaFixture } from '../helpers/scenario_media';
import { createLoadedTestRuntimeSourceState, createTestRuntime, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createHostFrameFixture } from '../helpers/host_frame';
import { COROUTINE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

let directory: string;
let media: ScenarioMediaFixture;
before(async () => {
	directory = await mkdtemp(join(tmpdir(), 'bmsx-scenario-move-'));
	media = await buildScenarioMediaFixture(directory, [{ path: SCENARIO_FIXTURE_TEST_SOURCE_PATH, source: `return { kind = 'integration', tests = {
 passes = function(t) for index = 1, 32 do t:log('retained result evidence') end end,
 fails = function() error('retained source failure') end,
 waits = function(t) t:log('entered wait'); t:wait_ticks(2990) end,
} }` }, ...Array.from({ length: 16 }, (_, index) => ({ path: `tests/extra_${index}_assert.lua`,
		source: 'return { kind = "unit", tests = { extra = function() end } }' }))], {
		systemSource: "module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]",
		systemModules: [{ path: 'base', source: 'local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = raise\nsetmetatable = __bmsx_setmetatable' }, ...COROUTINE_FIRMWARE_MODULES],
		cartSource: 'module<entry>\nwhile true do halt_until_irq end',
	});
});
after(() => rm(directory, { recursive: true, force: true }));
beforeEach(() => openWorkspaceRecords(new MemoryWorkspaceFiles()));
afterEach(() => closeWorkspaceRecords());

async function fixture(t: TestContext) {
	const loaded = await loadRomToolingMedia(media.systemRom, [media.cartRom, null]);
	const sources = createLoadedTestRuntimeSourceState(loaded.system, loaded.cartridgeSlots);
	const host = createHostFrameFixture(createTestRuntime(media.systemRom)); host.runtime.boot();
	const targets: OffscreenMachine<TestInput>[] = [];
	const externalWork = (): never => { throw new Error('Scenario movement must not request unrelated host work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: externalWork }, externalWork,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 800, height: 320 }, sources, new Map(), externalWork,
		(bios, cartridges, model, input) => { const target = new OffscreenMachine(bios, cartridges, model, input); targets.push(target); return target; }, externalWork);
	const editor = ide.editor, parts = editor.editorParts, controller = editor.scenarioLab, runs = controller.runs;
	t.after(async () => {
		inputFocus.setTarget(null); pointerCapture.interrupt(false);
		await editor.shutdown(); clearBackgroundTasks(); host.audio.dispose(); host.input.dispose();
	});
	ide.boots.didReplaceMachine(); editorRuntimeState.active = true; editor.interaction.setActive(true);
	host.input.setPointerAdmissionMode('routed');
	const firstPart = parts.createDocument({ requestedBounds: { left: 0, top: 32, right: 384, bottom: 290 } });
	const secondPart = parts.createDocument({ requestedBounds: { left: 400, top: 32, right: 800, bottom: 290 } });
	const update = () => editor.update(0);
	const key = (code: string, modifiers = KeyModifier.none) => {
		editor.dispatchKey(new KeyInputEvent(code, modifiers)); editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false)); update();
	};
	controller.open(firstPart.group); update();
	const input = firstPart.group.model.activeTab;
	assert.ok(input instanceof ScenarioLabInput);
	const module = runs.collection.findModuleBySourcePath(TEST_CARTRIDGE_CONTEXT_IDS[0], SCENARIO_FIXTURE_TEST_SOURCE_PATH)!;
	const select = (name: string) => {
		const item = module.children.find(item => item.caseName === name)!;
		selectScenarioLabTestRow(input.view, input.view.testPane.rows.findIndex(row => row.id === item.id));
		parts.findGroup(input)!.panes.activePane!.focus(); update(); return item;
	};
	const until = async (predicate: () => boolean) => {
		for (let grant = 0; !predicate() && grant < 10000; grant++) { runs.advance(); await setImmediate(); update(); }
		assert.ok(predicate(), 'the real isolated run reaches its requested boundary');
	};
	return { ide, editor, parts, controller, runs, host, sources, targets, firstPart, secondPart, input, module, update, key, select, until };
}

test('Scenario move retains actual results, selection and reading state after the former Part closes', async t => {
	const f = await fixture(t); f.select('passes');
	f.editor.commands.execute('scenarioLab.run', f.firstPart.group.panes.activePane!.commandTarget);
	const run = f.runs.results.liveRun!;
	await f.until(() => !f.runs.active);
	assert.equal(run.state, 'passed', JSON.stringify(run.items[0].failures)); assert.equal(run.items[0].logs.length, 32);
	const view = f.input.view;
	toggleScenarioLabResultRow(view, view.resultPane.rows.findIndex(row => row.kind === 'result'));
	selectScenarioLabResultRow(view, view.resultPane.rows.findIndex(row => row.kind === 'log'));
	view.testPane.scroll = 2.25; view.resultPane.scroll = 3.5; view.split.resize(0.6);
	f.firstPart.group.panes.activePane!.focus(); f.update();
	const tests = captureScenarioLabTestView(view), selected = view.resultPane.rows[view.resultPane.selectionIndex];
	const resultScroll = view.resultPane.scroll, split = view.split.ratio, cycles = f.host.runtime.machine.scheduler.nowCycles;
	let disposed = 0; f.input.onWillDispose(() => { disposed++; });
	assert.equal(f.parts.moveEditor(f.firstPart, f.input, f.secondPart, f.editor.editorClose), true); f.update();
	assert.ok(f.secondPart.group.model.activeTab === f.input && f.secondPart.group.panes.activePane!.input === f.input);
	assert.ok(f.parts.findGroup(f.input) === f.secondPart.group && f.controller.resolveInput() === f.input);
	assert.deepEqual(captureScenarioLabTestView(view), tests);
	assert.equal(view.resultPane.rows[view.resultPane.selectionIndex], selected);
	assert.equal(view.resultPane.scroll, resultScroll); assert.equal(view.split.ratio, split);
	assert.equal(view.resultService.runs[0], run); assert.equal(view.resultService.runs[0].items[0], run.items[0]);
	assert.equal(await f.parts.close(f.firstPart), true);
	assert.equal(disposed, 0); assert.ok(f.parts.findGroup(f.input) === f.secondPart.group);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('Scenario reveal from Main restores its minimized actual owner without rebinding an admitted pane or restoring a second singleton', async t => {
	const f = await fixture(t); f.select('passes');
	f.editor.commands.execute('scenarioLab.run', f.firstPart.group.panes.activePane!.commandTarget);
	const run = f.runs.results.liveRun!; await f.until(() => !f.runs.active);
	assert.equal(f.parts.moveEditor(f.firstPart, f.input, f.secondPart, f.editor.editorClose), true); f.update();
	const pane = f.secondPart.group.panes.activePane!, generation = f.secondPart.group.panes.openGeneration;
	f.parts.minimize(f.secondPart); f.parts.main.focus();
	f.controller.revealRun(run, f.parts.main.group); f.update();
	assert.equal(f.secondPart.window!.model.minimized, false);
	assert.ok(f.parts.activePart === f.secondPart && f.parts.findGroup(f.input) === f.secondPart.group);
	assert.ok(f.secondPart.group.panes.activePane === pane); assert.equal(f.secondPart.group.panes.openGeneration, generation);
	assert.equal(f.parts.main.group.model.findById(f.input.id), undefined);
	f.select('passes');
	f.editor.commands.execute('scenarioLab.runWithCompanion', pane.commandTarget);
	assert.equal(f.secondPart.quickInput.visible, true);
	f.parts.main.focus(); f.controller.open(f.parts.main.group);
	assert.equal(f.secondPart.quickInput.visible, true, 'revealing an already attached input retains its admitted local dialog');
	assert.ok(inputFocus.target === f.secondPart.quickInput.field.focusTarget);
	assert.equal(f.secondPart.group.panes.openGeneration, generation);
	f.key('Escape');
	const state = f.parts.serialize(f.editor.editorInputSerializers);
	const restored = await fixture(t); restored.parts.clear();
	await restored.parts.restore(state, restored.editor.editorInputSerializers);
	const singleton = restored.controller.resolveInput(), owner = restored.parts.findGroup(singleton)!;
	assert.notEqual(owner, restored.parts.main.group);
	assert.equal(restored.parts.groups.filter(group => group.model.tabs.includes(singleton)).length, 1);
	assert.ok(owner.model.activeTab === singleton && owner.panes.activePane instanceof ScenarioLabEditorPane);
	assert.equal(restored.parts.main.group.model.findById(singleton.id), undefined);
});

test('Scenario companion attempts retire with the old attachment and Source and new actions belong to the destination', async t => {
	const f = await fixture(t), item = f.select('fails'); f.key('Tab');
	const origin = inputFocus.target!;
	f.editor.commands.execute('scenarioLab.runWithCompanion', origin);
	assert.equal(f.firstPart.quickInput.visible, true);
	const picker = f.firstPart.quickInput.model;
	const press = { x: picker.viewport.bounds.left + 8, y: picker.rowTop(0) + picker.rowHeight / 2,
		buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary, releasedButtons: 0, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 };
	f.editor.dispatchPointer(press);
	assert.equal(f.parts.moveEditor(f.firstPart, f.input, f.secondPart, f.editor.editorClose), true); f.update();
	assert.equal(f.firstPart.quickInput.visible, false);
	f.editor.dispatchPointer({ ...press, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary, timestamp: 1 });
	assert.equal(f.runs.results.runs.length, 0); assert.equal(f.runs.active, false);
	assert.equal(f.editor.commands.isEnabled('scenarioLab.runWithCompanion', origin), false);
	assert.equal(f.editor.commands.isEnabled('scenarioLab.inspectTarget', origin), false);
	assert.equal(f.editor.commands.isEnabled('scenarioLab.details', origin), false);
	f.editor.commands.execute('scenarioLab.runWithCompanion', origin);
	assert.equal(f.firstPart.quickInput.visible, false); assert.equal(f.secondPart.quickInput.visible, false);
	const pane = f.secondPart.group.panes.activePane!;
	f.editor.commands.execute('scenarioLab.runWithCompanion', pane.commandTarget);
	assert.equal(f.secondPart.quickInput.visible, true); assert.equal(f.firstPart.quickInput.visible, false);
	f.key('Escape');
	f.editor.commands.execute('scenarioLab.run', pane.commandTarget);
	const run = f.runs.results.liveRun!; await f.until(() => !f.runs.active);
	assert.equal(run.state, 'failed'); assert.equal(run.items[0].test, item);
	f.controller.open(f.parts.main.group); f.select('fails');
	f.key('Enter'); await setImmediate(); f.update();
	const source = f.secondPart.group.model.activeTab;
	assert.ok(source?.kind === 'code_editor'); assert.deepEqual(source.workingCopy.resource, f.sources.catalog.resolveResource(item.resource)!);
	assert.ok(f.parts.activePart === f.secondPart && f.parts.findGroup(f.input) === f.secondPart.group);
	assert.equal(f.parts.main.group.model.findById(f.input.id), undefined);
});

test('an isolated running Scenario target survives pane transfer and former-window retirement unchanged', async t => {
	const f = await fixture(t); f.select('waits');
	f.editor.commands.execute('scenarioLab.run', f.firstPart.group.panes.activePane!.commandTarget);
	const run = f.runs.results.liveRun!;
	await f.until(() => run.items[0].logs.length !== 0);
	const session = f.runs.session!, execution = session.execution!, target = execution.target;
	assert.ok(target.runtime !== f.host.runtime && execution.active);
	assert.equal(f.targets.length, 1); assert.ok(f.targets[0] === target);
	const targetCycles = target.runtime.machine.scheduler.nowCycles, authoringCycles = f.host.runtime.machine.scheduler.nowCycles;
	assert.equal(f.parts.moveEditor(f.firstPart, f.input, f.secondPart, f.editor.editorClose), true); f.update();
	assert.equal(await f.parts.close(f.firstPart), true);
	assert.ok(f.runs.session === session && session.execution === execution && execution.target === target);
	assert.equal(f.targets.length, 1, 'transfer does not construct a replacement test machine');
	assert.equal(f.runs.active, true); assert.equal(run.state, 'running');
	assert.equal(target.runtime.machine.scheduler.nowCycles, targetCycles);
	f.runs.advance();
	assert.ok(target.runtime.machine.scheduler.nowCycles > targetCycles, 'only the same isolated execution advances after transfer');
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, authoringCycles);
	f.editor.commands.execute('scenarioLab.cancel', f.secondPart.group.panes.activePane!.commandTarget);
	await f.until(() => !f.runs.active); assert.equal(run.state, 'cancelled');
});

test('Scenario reveal cannot override an unrelated editor activation published while its pane is opening', async t => {
	const f = await fixture(t), replacement = new GameViewInput();
	f.firstPart.group.openEditor(new GameViewInput());
	const unbind = f.firstPart.group.panes.onWillShowEditor(() => {
		unbind(); f.secondPart.group.openEditor(replacement);
	});
	t.after(unbind);
	f.controller.open(f.parts.main.group);
	assert.ok(f.firstPart.group.model.activeTab === f.input, 'the requested input was attached before its owner published the newer activation');
	assert.ok(f.secondPart.group.model.activeTab === replacement);
	assert.ok(f.parts.activePart === f.secondPart, 'the superseded reveal cannot reactivate its former Part');
	assert.ok(inputFocus.target === f.secondPart.group.panes.activePane!.commandTarget);
});

test('Scenario reveal finishes only the attachment that survived its owning pane opening callbacks', async t => {
	const f = await fixture(t);
	f.firstPart.group.openEditor(new GameViewInput());
	const unbind = f.firstPart.group.panes.onWillShowEditor(() => {
		unbind(); assert.equal(f.parts.moveEditor(f.firstPart, f.input, f.secondPart, f.editor.editorClose), true);
	});
	t.after(unbind);
	assert.doesNotThrow(() => f.controller.open(f.parts.main.group));
	assert.ok(f.parts.findGroup(f.input) === f.secondPart.group);
	assert.ok(f.parts.activePart === f.secondPart && f.secondPart.group.panes.activePane!.input === f.input);
	assert.ok(inputFocus.target === f.secondPart.group.panes.activePane!.commandTarget);
});

test('Scenario reveal cannot overwrite a newer model selection before attaching its pane', async t => {
	const f = await fixture(t), replacement = new GameViewInput();
	f.firstPart.group.openEditor(replacement);
	const unbind = f.firstPart.group.model.onDidChange(() => {
		if (f.firstPart.group.model.activeTab !== f.input) return;
		unbind(); f.firstPart.group.activate(replacement.id); f.secondPart.focus();
	});
	t.after(unbind);
	assert.doesNotThrow(() => f.controller.open(f.parts.main.group));
	assert.ok(f.firstPart.group.model.activeTab === replacement);
	assert.ok(f.firstPart.group.panes.activePane!.input === replacement, 'the newer model selection owns the actual pane too');
	assert.ok(f.parts.findGroup(f.input) === f.firstPart.group, 'superseding a reveal does not retire its retained input');
	assert.ok(f.parts.activePart === f.secondPart && inputFocus.target === f.secondPart.focusTarget);
});
