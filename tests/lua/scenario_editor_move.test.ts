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
import { RemoteInput } from '../../hosts/common/input/remote';
import type { TestInput } from '../../ide/testing/input';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { ScenarioLabInput } from '../../ide/workbench/contrib/scenario_lab/editor_input';
import { ScenarioLabEditorPane } from '../../ide/workbench/contrib/scenario_lab/editor_pane';
import { RuntimeDebuggerResumeMode as Mode } from '../../ide/runtime/source_debugger';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { scenarioLabCommandEnabled, selectScenarioLabTestRow, selectScenarioLabResultRow, toggleScenarioLabResultRow } from '../../ide/workbench/contrib/scenario_lab/navigation';
import { captureScenarioLabTestView } from '../../ide/workbench/contrib/scenario_lab/view_snapshot';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH, type ScenarioMediaFixture } from '../helpers/scenario_media';
import { createLoadedTestRuntimeSourceState, createTestRuntime, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createHostFrameFixture } from '../helpers/host_frame';
import { COROUTINE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxError } from '../../toolchain/ts/lua/errors';
import type { ScenarioLabExecutionCommand } from '../../ide/workbench/contrib/scenario_lab/controller';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';

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
	controller.open(firstPart.activeGroup); update();
	const input = firstPart.activeGroup.model.activeTab;
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

/** A real native value control publishes a source draft into the Scenario attachment's scope. */
function sourceDraft(t: TestContext, f: Awaited<ReturnType<typeof fixture>>, text: string, accepted?: () => void) {
	const pane = f.parts.findGroup(f.input)!.panes.activePane!, target = pane.commandTarget;
	const model = resolveLuaCodeEditorInput(f.sources.catalog, f.sources.catalog.resolveResource(f.module.resource)!).workingCopy;
	const source = model.buffer.getText();
	let publishes = 0;
	const control = new ValueInput(target, {
		options: { allowSpace: true }, format: (value: string) => value, invalidBlurMessage: 'Invalid source draft cancelled.',
		parse: value => {
			try { parseLuaChunk(value, model.resource.path); return { value }; }
			catch (error) { if (!(error instanceof LuaSyntaxError)) throw error; return { error: error.message }; }
		},
	}, value => {
		publishes++;
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: value }]);
		accepted?.();
	});
	control.setValue(source); control.layout({ left: 0, top: 32, right: 384, bottom: 64 });
	control.field.focusTarget.focus();
	assert.equal(control.field.replaceText(0, source.length, text), true);
	t.after(() => { control.cancel(); control.field.focusTarget.release(); control.dispose(); });
	const execute = (command: ScenarioLabExecutionCommand, application: boolean) => {
		if (application) f.editor.commands.execute(command, target);
		else inputFocus.executeCommand(command, target);
	};
	return { control, model, source, execute, publishes: () => publishes };
}

test('Scenario title follows the real run and source-step context without granting guest time', async t => {
	const f = await fixture(t); f.select('waits');
	const view = f.input.view, actions = view.actionBar, title = actions.menu!, origin = f.firstPart.activeGroup.panes.activePane!.commandTarget;
	const items = actions.items, entries = title.entries, visible = title.visibleItems;
	const debugAction = items.find(action => action.command === 'scenarioLab.debug')!, cancel = items.find(action => action.command === 'scenarioLab.cancel')!;
	const continueAction = items.find(action => action.command === 'scenarioLab.continue')!, inspectStop = items.find(action => action.command === 'scenarioLab.inspectStop')!;
	const pause = items.find(action => action.command === 'scenarioLab.pause')!;
	const initialRevision = title.revision;
	f.editor.commands.execute('scenarioLab.debug', origin);
	assert.equal(view.runActive, true);
	assert.ok(title.revision > initialRevision, 'asynchronous preparation publishes its running title state immediately');
	assert.equal(debugAction.visible, false);
	assert.equal(cancel.menuEntry!.visible, true);
	await f.until(() => f.runs.debugger?.stopped === true);
	const debug = f.runs.debugger!, run = f.runs.results.liveRun!, target = f.runs.session!.execution!.target;
	assert.equal(debug.reason, 'entry');
	assert.equal(continueAction.visible, true);
	assert.equal(inspectStop.visible, true);
	for (const command of ['scenarioLab.stepInto', 'scenarioLab.stepOver', 'scenarioLab.stepOut'] as const)
		assert.equal(items.find(action => action.command === command)!.visible, false, 'a runner boundary has no source stop to step');
	f.editor.commands.execute('scenarioLab.inspectStop', origin);
	const pane = f.firstPart.activeGroup.panes.activePane!;
	assert.ok(pane instanceof ScenarioLabEditorPane);
	const inspection = pane.targetInspection.model!.inspection, cycles = target.runtime.machine.scheduler.nowCycles;
	const entry = debug.sources.catalog.find(source => source.domain === 0 && source.path === 'entry.lua')!;
	assert.equal(debug.sources.setBreakpoints(entry.source, [2])[0].status, 'bound');
	f.editor.commands.execute('scenarioLab.continue', origin);
	assert.equal(debug.status, 'running');
	assert.equal(inspection.available, false, 'title command execution expires the borrowed entry stop before another CPU grant');
	assert.equal(target.runtime.machine.scheduler.nowCycles, cycles);
	assert.equal(continueAction.visible, false);
	f.update();
	assert.equal(pause.visible, true);
	await f.until(() => debug.stopped);
	assert.equal(debug.reason, 'breakpoint');
	assert.equal(debug.canResume(Mode.StepInto), true);
	for (const command of ['scenarioLab.stepInto', 'scenarioLab.stepOver', 'scenarioLab.stepOut'] as const)
		assert.equal(items.find(action => action.command === command)!.visible, true, 'a stopped source context admits the source-step action group');
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.stepInto'), debug.canResume(Mode.StepInto));
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.stepOver'), debug.canResume(Mode.StepOver));
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.stepOut'), debug.canResume(Mode.StepOut));
	const stoppedRevision = title.revision, stoppedCycles = target.runtime.machine.scheduler.nowCycles;
	for (let frame = 0; frame < 10; frame++) f.update();
	assert.equal(title.revision, stoppedRevision);
	assert.equal(target.runtime.machine.scheduler.nowCycles, stoppedCycles);
	f.runs.cancel(run);
	await f.until(() => !f.runs.active);
	assert.equal(view.runActive, false);
	assert.equal(cancel.visible, false);
	assert.equal(pause.visible, false);
	assert.equal(inspectStop.visible, false);
	assert.equal(debugAction.visible, true);
	assert.equal(actions.items, items);
	assert.equal(title.entries, entries);
	assert.equal(title.visibleItems, visible);
});

for (const foreignFocus of ['before-inspection', 'after-inspection'] as const)
	test(`a borrowed Scenario stop keeps its pointer action origin with foreign focus ${foreignFocus}`, async t => {
		const f = await fixture(t); f.select('waits'); f.key('Tab');
		const origin = inputFocus.target!, pane = f.firstPart.activeGroup.panes.activePane!;
		assert.ok(pane instanceof ScenarioLabEditorPane);
		f.editor.commands.execute('scenarioLab.debug', origin);
		await f.until(() => f.runs.debugger?.stopped === true);
		const debug = f.runs.debugger!, target = f.runs.session!.execution!.target;
		f.secondPart.activeGroup.openEditor(new GameViewInput());
		const foreign = f.secondPart.activeGroup.panes.activePane!.commandTarget;
		if (foreignFocus === 'after-inspection') origin.focus();
		f.editor.commands.execute('scenarioLab.inspectStop', origin); f.update();
		const inspection = pane.targetInspection.model!.inspection;
		f.secondPart.activeGroup.panes.activePane!.focus(); f.update();
		assert.ok(inputFocus.target === foreign);
		const cycles = target.runtime.machine.scheduler.nowCycles, authoringCycles = f.host.runtime.machine.scheduler.nowCycles;

		// Target the first actually painted stop action, without a label or fixed-coordinate assertion.
		const borders = t.mock.method(api, 'blit_rect');
		f.ide.overlayRenderer.beginFrame(f.host.presenter); api.beginFrame(f.ide.overlayRenderer);
		pane.targetInspection.draw(); f.ide.overlayRenderer.endFrame();
		const [left, top, right, bottom] = borders.mock.calls[0].arguments;
		borders.mock.restore();
		const pointer = new RemoteInput(f.host.input, f.host.clock, undefined, event => f.editor.dispatchPointer(event));
		t.after(() => pointer.release());
		pointer.apply([{ type: 'pointer', x: (left + right) / 2, y: (top + bottom) / 2 },
			{ type: 'button', button: 'primary', down: true }]);
		assert.ok(inputFocus.target === foreign, 'pointer admission keeps the foreign editor keyboard focus');
		pointer.apply([{ type: 'button', button: 'primary', down: false }]);

		assert.equal(debug.status, 'running', 'the painted Continue action resumes its borrowed debugger, not the focused group');
		assert.equal(inspection.available, false, 'resuming retires the borrowed stop before another CPU grant');
		assert.equal(pane.targetInspection.model, undefined);
		assert.ok(inputFocus.target === foreign, 'retiring another group inspection does not steal keyboard focus');
		assert.ok(f.runs.session!.execution!.target === target);
		assert.equal(target.runtime.machine.scheduler.nowCycles, cycles);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, authoringCycles);
	});

for (const variant of ['tiny', 'msx'] as const) test(`Scenario ${variant} focus order includes only the actual resizable sash in both directions`, async t => {
	const f = await fixture(t); f.editor.setFontVariant(variant);
	f.firstPart.window!.model.setRequestedBounds({ left: 0, top: 32, right: 760, bottom: 290 });
	f.select('passes');
	const pane = f.firstPart.activeGroup.panes.activePane!, view = f.input.view, tests = pane.commandTarget;
	const selected = view.testPane.selection.nodeId;
	assert.equal(view.split.resizable, true);
	f.key('Tab'); const results = inputFocus.admittedTarget!;
	assert.ok(results !== tests); assert.equal(view.focus, 'results');
	f.key('Tab'); const sash = inputFocus.admittedTarget!;
	assert.ok(sash !== tests && sash !== results && !view.actionBar.hasFocus);
	const ratio = view.split.ratio; f.key('ArrowRight'); assert.ok(view.split.ratio > ratio);
	f.key('Tab'); assert.equal(view.actionBar.hasFocus, true);
	f.key('Tab'); assert.ok(inputFocus.admittedTarget === tests);
	f.key('Tab', KeyModifier.shift); assert.equal(view.actionBar.hasFocus, true);
	f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === sash);
	f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === results);
	f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === tests);
	const requestedRatio = view.split.ratio;
	f.firstPart.window!.model.setRequestedBounds({ left: 0, top: 32, right: 240, bottom: 290 }); f.update();
	assert.equal(view.split.resizable, false);
	f.key('Tab'); assert.ok(inputFocus.admittedTarget === results);
	f.key('Tab'); assert.equal(view.actionBar.hasFocus, true, 'an unavailable sash cannot redirect forward traversal to its parent list');
	f.key('Tab'); assert.ok(inputFocus.admittedTarget === tests);
	f.key('Tab', KeyModifier.shift); assert.equal(view.actionBar.hasFocus, true);
	f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === results, 'reverse traversal also omits the unavailable sash');
	f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === tests);
	f.firstPart.window!.model.setRequestedBounds({ left: 0, top: 32, right: 760, bottom: 290 }); f.update();
	assert.equal(view.split.resizable, true);
	f.key('Tab'); assert.ok(inputFocus.admittedTarget === results);
	f.key('Tab'); assert.ok(inputFocus.admittedTarget === sash);
	assert.ok(pane.input === f.input && f.controller.resolveInput() === f.input);
	assert.equal(view.testPane.selection.nodeId, selected); assert.equal(view.split.ratio, requestedRatio);
});

for (const variant of ['tiny', 'msx'] as const) test(`Scenario ${variant} withholding a focused captured sash retires its gesture and returns to results`, async t => {
	const f = await fixture(t); f.editor.setFontVariant(variant);
	f.firstPart.window!.model.setRequestedBounds({ left: 0, top: 32, right: 760, bottom: 290 }); f.select('passes');
	const pane = f.firstPart.activeGroup.panes.activePane!, view = f.input.view, selected = view.testPane.selection.nodeId;
	assert.equal(view.split.resizable, true);
	f.key('Tab'); const results = inputFocus.admittedTarget!;
	f.key('Tab'); const sash = inputFocus.admittedTarget!;
	const x = view.split.position, y = (view.split.bounds.top + view.split.bounds.bottom) / 2, ratio = view.split.ratio;
	const control = new RemoteInput(f.host.input, f.host.clock, undefined, event => f.editor.dispatchPointer(event));
	t.after(() => control.release());
	control.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]);
	assert.equal(pointerCapture.active, true); assert.ok(inputFocus.admittedTarget === sash);
	f.firstPart.window!.model.setRequestedBounds({ left: 0, top: 32, right: 240, bottom: 290 }); f.update();
	assert.equal(view.split.resizable, false);
	assert.equal(pointerCapture.active, false, 'the unavailable sash no longer owns the physical hold');
	assert.ok(inputFocus.admittedTarget === results, 'withholding the focused sash returns to its result client');
	assert.equal(pointerCapture.draining, true);
	control.apply([{ type: 'button', button: 'primary', down: false }]);
	assert.equal(pointerCapture.draining, false);
	f.key('Tab'); assert.equal(view.actionBar.hasFocus, true);
	assert.ok(pane.input === f.input); assert.equal(view.testPane.selection.nodeId, selected); assert.equal(view.split.ratio, ratio);
});

test('Scenario move retains actual results, selection and reading state after the former Part closes', async t => {
	const f = await fixture(t); f.select('passes');
	f.editor.commands.execute('scenarioLab.run', f.firstPart.activeGroup.panes.activePane!.commandTarget);
	const run = f.runs.results.liveRun!;
	await f.until(() => !f.runs.active);
	assert.equal(run.state, 'passed', JSON.stringify(run.items[0].failures)); assert.equal(run.items[0].logs.length, 32);
	const view = f.input.view;
	toggleScenarioLabResultRow(view, view.resultPane.rows.findIndex(row => row.kind === 'result'));
	selectScenarioLabResultRow(view, view.resultPane.rows.findIndex(row => row.kind === 'log'));
	view.testPane.scroll = 2.25; view.resultPane.scroll = 3.5; view.split.resize(0.6);
	f.firstPart.activeGroup.panes.activePane!.focus(); f.update();
	const tests = captureScenarioLabTestView(view), selected = view.resultPane.rows[view.resultPane.selectionIndex];
	const resultScroll = view.resultPane.scroll, split = view.split.ratio, cycles = f.host.runtime.machine.scheduler.nowCycles;
	let disposed = 0; f.input.onWillDispose(() => { disposed++; });
	assert.equal(f.parts.moveEditor(f.firstPart.activeGroup, f.input, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	assert.ok(f.secondPart.activeGroup.model.activeTab === f.input && f.secondPart.activeGroup.panes.activePane!.input === f.input);
	assert.ok(f.parts.findGroup(f.input) === f.secondPart.activeGroup && f.controller.resolveInput() === f.input);
	assert.deepEqual(captureScenarioLabTestView(view), tests);
	assert.equal(view.resultPane.rows[view.resultPane.selectionIndex], selected);
	assert.equal(view.resultPane.scroll, resultScroll); assert.equal(view.split.ratio, split);
	assert.equal(view.resultService.runs[0], run); assert.equal(view.resultService.runs[0].items[0], run.items[0]);
	assert.equal(await f.parts.close(f.firstPart), true);
	assert.equal(disposed, 0); assert.ok(f.parts.findGroup(f.input) === f.secondPart.activeGroup);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('Scenario reveal from Main restores its minimized actual owner without rebinding an admitted pane or restoring a second singleton', async t => {
	const f = await fixture(t); f.select('passes');
	f.editor.commands.execute('scenarioLab.run', f.firstPart.activeGroup.panes.activePane!.commandTarget);
	const run = f.runs.results.liveRun!; await f.until(() => !f.runs.active);
	assert.equal(f.parts.moveEditor(f.firstPart.activeGroup, f.input, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	const pane = f.secondPart.activeGroup.panes.activePane!, generation = f.secondPart.activeGroup.panes.openGeneration;
	f.parts.minimize(f.secondPart); f.parts.main.focus();
	f.controller.revealRun(run, f.parts.main.activeGroup); f.update();
	assert.equal(f.secondPart.window!.model.minimized, false);
	assert.ok(f.parts.activePart === f.secondPart && f.parts.findGroup(f.input) === f.secondPart.activeGroup);
	assert.ok(f.secondPart.activeGroup.panes.activePane === pane); assert.equal(f.secondPart.activeGroup.panes.openGeneration, generation);
	assert.equal(f.parts.main.activeGroup.model.findById(f.input.id), undefined);
	f.select('passes');
	f.editor.commands.execute('scenarioLab.runWithCompanion', pane.commandTarget);
	assert.equal(f.secondPart.quickInput.visible, true);
	f.parts.main.focus(); f.controller.open(f.parts.main.activeGroup);
	assert.equal(f.secondPart.quickInput.visible, true, 'revealing an already attached input retains its admitted local dialog');
	assert.ok(inputFocus.target === f.secondPart.quickInput.field.focusTarget);
	assert.equal(f.secondPart.activeGroup.panes.openGeneration, generation);
	f.key('Escape');
	const state = f.parts.serialize(f.editor.editorInputSerializers);
	const restored = await fixture(t); restored.parts.clear();
	await restored.parts.restore(state, restored.editor.editorInputSerializers);
	const singleton = restored.controller.resolveInput(), owner = restored.parts.findGroup(singleton)!;
	assert.notEqual(owner, restored.parts.main.activeGroup);
	assert.equal(restored.parts.groups.filter(group => group.model.tabs.includes(singleton)).length, 1);
	assert.ok(owner.model.activeTab === singleton && owner.panes.activePane instanceof ScenarioLabEditorPane);
	assert.equal(restored.parts.main.activeGroup.model.findById(singleton.id), undefined);
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
	assert.equal(f.parts.moveEditor(f.firstPart.activeGroup, f.input, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	assert.equal(f.firstPart.quickInput.visible, false);
	f.editor.dispatchPointer({ ...press, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary, timestamp: 1 });
	assert.equal(f.runs.results.runs.length, 0); assert.equal(f.runs.active, false);
	assert.equal(f.editor.commands.isEnabled('scenarioLab.runWithCompanion', origin), false);
	assert.equal(f.editor.commands.isEnabled('scenarioLab.inspectTarget', origin), false);
	assert.equal(f.editor.commands.isEnabled('scenarioLab.details', origin), false);
	f.editor.commands.execute('scenarioLab.runWithCompanion', origin);
	assert.equal(f.firstPart.quickInput.visible, false); assert.equal(f.secondPart.quickInput.visible, false);
	const pane = f.secondPart.activeGroup.panes.activePane!;
	f.editor.commands.execute('scenarioLab.runWithCompanion', pane.commandTarget);
	assert.equal(f.secondPart.quickInput.visible, true); assert.equal(f.firstPart.quickInput.visible, false);
	f.key('Escape');
	f.editor.commands.execute('scenarioLab.run', pane.commandTarget);
	const run = f.runs.results.liveRun!; await f.until(() => !f.runs.active);
	assert.equal(run.state, 'failed'); assert.equal(run.items[0].test, item);
	f.controller.open(f.parts.main.activeGroup); f.select('fails');
	f.key('Enter'); await setImmediate(); f.update();
	const source = f.secondPart.activeGroup.model.activeTab;
	assert.ok(source?.kind === 'code_editor'); assert.deepEqual(source.workingCopy.resource, f.sources.catalog.resolveResource(item.resource)!);
	assert.ok(f.parts.activePart === f.secondPart && f.parts.findGroup(f.input) === f.secondPart.activeGroup);
	assert.equal(f.parts.main.activeGroup.model.findById(f.input.id), undefined);
});

test('an isolated running Scenario target survives pane transfer and former-window retirement unchanged', async t => {
	const f = await fixture(t); f.select('waits');
	f.editor.commands.execute('scenarioLab.run', f.firstPart.activeGroup.panes.activePane!.commandTarget);
	const run = f.runs.results.liveRun!;
	await f.until(() => run.items[0].logs.length !== 0);
	const session = f.runs.session!, execution = session.execution!, target = execution.target;
	assert.ok(target.runtime !== f.host.runtime && execution.active);
	assert.equal(f.targets.length, 1); assert.ok(f.targets[0] === target);
	const targetCycles = target.runtime.machine.scheduler.nowCycles, authoringCycles = f.host.runtime.machine.scheduler.nowCycles;
	assert.equal(f.parts.moveEditor(f.firstPart.activeGroup, f.input, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	assert.equal(await f.parts.close(f.firstPart), true);
	assert.ok(f.runs.session === session && session.execution === execution && execution.target === target);
	assert.equal(f.targets.length, 1, 'transfer does not construct a replacement test machine');
	assert.equal(f.runs.active, true); assert.equal(run.state, 'running');
	assert.equal(target.runtime.machine.scheduler.nowCycles, targetCycles);
	f.runs.advance();
	assert.ok(target.runtime.machine.scheduler.nowCycles > targetCycles, 'only the same isolated execution advances after transfer');
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, authoringCycles);
	f.editor.commands.execute('scenarioLab.cancel', f.secondPart.activeGroup.panes.activePane!.commandTarget);
	await f.until(() => !f.runs.active); assert.equal(run.state, 'cancelled');
});

test('Scenario reveal cannot override an unrelated editor activation published while its pane is opening', async t => {
	const f = await fixture(t), replacement = new GameViewInput();
	f.firstPart.activeGroup.openEditor(new GameViewInput());
	const unbind = f.firstPart.activeGroup.panes.onWillShowEditor(() => {
		unbind(); f.secondPart.activeGroup.openEditor(replacement);
	});
	t.after(unbind);
	f.controller.open(f.parts.main.activeGroup);
	assert.ok(f.firstPart.activeGroup.model.activeTab === f.input, 'the requested input was attached before its owner published the newer activation');
	assert.ok(f.secondPart.activeGroup.model.activeTab === replacement);
	assert.ok(f.parts.activePart === f.secondPart, 'the superseded reveal cannot reactivate its former Part');
	assert.ok(inputFocus.target === f.secondPart.activeGroup.panes.activePane!.commandTarget);
});

test('Scenario reveal finishes only the attachment that survived its owning pane opening callbacks', async t => {
	const f = await fixture(t);
	f.firstPart.activeGroup.openEditor(new GameViewInput());
	const unbind = f.firstPart.activeGroup.panes.onWillShowEditor(() => {
		unbind(); assert.equal(f.parts.moveEditor(f.firstPart.activeGroup, f.input, { kind: 'group', group: f.secondPart.activeGroup }), true);
	});
	t.after(unbind);
	assert.doesNotThrow(() => f.controller.open(f.parts.main.activeGroup));
	assert.ok(f.parts.findGroup(f.input) === f.secondPart.activeGroup);
	assert.ok(f.parts.activePart === f.secondPart && f.secondPart.activeGroup.panes.activePane!.input === f.input);
	assert.ok(inputFocus.target === f.secondPart.activeGroup.panes.activePane!.commandTarget);
});

test('Scenario reveal cannot overwrite a newer model selection before attaching its pane', async t => {
	const f = await fixture(t), replacement = new GameViewInput();
	f.firstPart.activeGroup.openEditor(replacement);
	const unbind = f.firstPart.activeGroup.model.onDidChange(() => {
		if (f.firstPart.activeGroup.model.activeTab !== f.input) return;
		unbind(); f.firstPart.activeGroup.activate(replacement.id); f.secondPart.focus();
	});
	t.after(unbind);
	assert.doesNotThrow(() => f.controller.open(f.parts.main.activeGroup));
	assert.ok(f.firstPart.activeGroup.model.activeTab === replacement);
	assert.ok(f.firstPart.activeGroup.panes.activePane!.input === replacement, 'the newer model selection owns the actual pane too');
	assert.ok(f.parts.findGroup(f.input) === f.firstPart.activeGroup, 'superseding a reveal does not retire its retained input');
	assert.ok(f.parts.activePart === f.secondPart && inputFocus.target === f.secondPart.activeGroup.focusTarget);
});

for (const application of [false, true]) for (const valid of [false, true])
	for (const command of ['scenarioLab.run', 'scenarioLab.debug', 'scenarioLab.rerun', 'scenarioLab.play'] as const)
		test(`${command} ${application ? 'application' : 'native'} consumes only its captured accepted source (${valid ? 'valid' : 'invalid'} draft)`, async t => {
			const f = await fixture(t), item = f.select('passes');
			if (command === 'scenarioLab.rerun') {
				const previous = f.runs.results.beginRun(item.id, [{ test: item, source: f.module.source, sourceRevision: f.module.sourceTimestamp }], 'debug');
				f.runs.results.cancelRun(previous); f.select('fails');
			}
			const source = f.module.source, accepted = `-- accepted source generation\n${source}`;
			const draft = sourceDraft(t, f, valid ? accepted : '('), before = f.runs.results.runs.length;
			draft.execute(command, application);
			assert.equal(draft.publishes(), valid ? 1 : 0);
			assert.equal(draft.control.pending, !valid, 'an immediate source consumer vetoes an invalid draft without cancelling it');
			assert.equal(draft.model.buffer.getText(), valid ? accepted : source);
			if (command === 'scenarioLab.play') {
				const handle = f.editor.play.service.current;
				assert.equal(handle !== undefined, valid);
				if (handle !== undefined) {
					assert.equal(handle.source, accepted); assert.equal(handle.sourceRevision, draft.model.version);
					assert.deepEqual(handle.module, f.module.resource);
				}
			} else {
				assert.equal(f.runs.results.runs.length, before + (valid ? 1 : 0));
				if (valid) {
					const run = f.runs.results.runs[0];
					assert.equal(run.scopeId, item.id); assert.equal(run.mode, command === 'scenarioLab.run' ? 'run' : 'debug');
					assert.equal(run.items[0].source, accepted); assert.equal(run.items[0].sourceRevision, draft.model.version);
					assert.equal(run.items[0].test, f.runs.collection.getNode(item.id));
					assert.notEqual(run.items[0].test, item, 'source refresh replaces projection objects, not semantic test intent');
				}
			}
		});

for (const application of [false, true]) for (const command of ['scenarioLab.run', 'scenarioLab.debug', 'scenarioLab.play'] as const)
	test(`${command} ${application ? 'application' : 'native'} cannot revive a selection changed away and back during acceptance`, async t => {
		const f = await fixture(t); f.select('passes');
		const draft = sourceDraft(t, f, `-- accepted\n${f.module.source}`, () => { f.select('fails'); f.select('passes'); });
		draft.execute(command, application);
		assert.equal(draft.publishes(), 1); assert.equal(draft.control.pending, false);
		assert.equal(f.runs.results.runs.length, 0); assert.equal(f.editor.play.service.current, undefined);
	});

for (const application of [false, true]) test(`Scenario ${application ? 'application' : 'native'} source execution rejects same-input reattachment during acceptance`, async t => {
	const f = await fixture(t); f.select('passes');
	const draft = sourceDraft(t, f, `-- accepted\n${f.module.source}`, () => {
		f.firstPart.activeGroup.openEditor(new GameViewInput()); f.firstPart.activeGroup.activate(f.input.id);
	});
	draft.execute('scenarioLab.run', application);
	assert.equal(draft.publishes(), 1); assert.equal(f.runs.results.runs.length, 0);
	assert.equal(f.firstPart.activeGroup.panes.activePane!.input, f.input);
});

for (const application of [false, true]) test(`Scenario ${application ? 'application' : 'native'} source refresh permanently retires a missing test intent`, async t => {
	const f = await fixture(t), item = f.select('passes'), source = f.module.source;
	const draft = sourceDraft(t, f, `-- accepted\n${source}`, () => {
		const model = editorTextModelService.get(f.module.resource)!;
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: "return {kind='integration',tests={other=function() end}}" }]);
		f.controller.updateView(f.input.view);
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
		f.controller.updateView(f.input.view); f.select(item.caseName);
	});
	draft.execute('scenarioLab.run', application);
	assert.equal(draft.publishes(), 1); assert.equal(f.input.view.testPane.selection.nodeId, item.id);
	assert.equal(f.runs.results.runs.length, 0);
});

for (const application of [false, true]) test(`Scenario ${application ? 'application' : 'native'} rerun retains the previous request captured before acceptance`, async t => {
	const f = await fixture(t), first = f.select('passes');
	const previous = f.runs.results.beginRun(first.id, [{ test: first, source: f.module.source, sourceRevision: f.module.sourceTimestamp }], 'debug');
	f.runs.results.cancelRun(previous);
	const draft = sourceDraft(t, f, `-- accepted\n${f.module.source}`, () => {
		const second = f.select('fails');
		const newer = f.runs.results.beginRun(second.id, [{ test: second, source: f.module.source, sourceRevision: f.module.sourceTimestamp }]);
		f.runs.results.cancelRun(newer);
	});
	draft.execute('scenarioLab.rerun', application);
	assert.equal(f.runs.results.runs.length, 3); assert.equal(f.runs.results.runs[0].scopeId, first.id);
	assert.equal(f.runs.results.runs[0].mode, previous.mode); assert.equal(f.runs.results.runs[0].items[0].source, draft.model.buffer.getText());
});

for (const application of [false, true]) for (const valid of [false, true])
	for (const command of ['scenarioLab.runWithCompanion', 'scenarioLab.debugWithCompanion', 'scenarioLab.playWithCompanion'] as const)
		test(`${command} ${application ? 'application' : 'native'} chooses identity after normal ${valid ? 'valid' : 'invalid'} blur and consumes source only at acceptance`, async t => {
			const f = await fixture(t), item = f.select('passes'), source = f.module.source;
			const draft = sourceDraft(t, f, valid ? `-- accepted draft\n${source}` : '(');
			draft.execute(command, application);
			assert.equal(draft.publishes(), valid ? 1 : 0); assert.equal(draft.control.pending, false);
			assert.equal(f.firstPart.quickInput.visible, true); assert.equal(f.runs.results.runs.length, 0);
			assert.equal(f.editor.play.service.current, undefined);
			const accepted = `-- source edited while choosing fixture\n${draft.model.buffer.getText()}`;
			draft.model.pushEditOperations([{ offset: 0, deleteLength: draft.model.buffer.length, text: accepted }]);
			f.key('Enter');
			assert.equal(f.firstPart.quickInput.visible, false);
			if (command === 'scenarioLab.playWithCompanion') {
				const handle = f.editor.play.service.current!;
				assert.equal(handle.source, accepted); assert.equal(handle.sourceRevision, draft.model.version);
				assert.equal(handle.companionContextId, null);
			} else {
				const run = f.runs.results.runs[0];
				assert.equal(run.scopeId, item.id); assert.equal(run.items[0].source, accepted);
				assert.equal(run.items[0].sourceRevision, draft.model.version); assert.equal(run.companionContextId, null);
				assert.equal(run.mode, command === 'scenarioLab.debugWithCompanion' ? 'debug' : 'run');
			}
		});

for (const application of [false, true]) for (const phase of ['blur', 'picker'] as const)
	test(`Scenario ${application ? 'application' : 'native'} companion intent cannot retarget during ${phase}`, async t => {
		const f = await fixture(t); f.select('passes');
		const replace = () => { f.select('fails'); f.select('passes'); };
		const draft = sourceDraft(t, f, `-- accepted\n${f.module.source}`, phase === 'blur' ? replace : undefined);
		draft.execute('scenarioLab.runWithCompanion', application);
		if (phase === 'picker') { assert.equal(f.firstPart.quickInput.visible, true); replace(); f.key('Enter'); }
		assert.equal(f.firstPart.quickInput.visible, false); assert.equal(f.runs.results.runs.length, 0);
	});

for (const application of [false, true]) for (const kind of ['module', 'root'] as const)
	test(`Scenario ${application ? 'application' : 'native'} run preserves corresponding ${kind} intent across accepted discovery`, async t => {
		const f = await fixture(t), pane = f.input.view.testPane;
		const index = pane.rows.findIndex(row => row.kind === kind && (row.kind !== 'module' || row.module === f.module));
		selectScenarioLabTestRow(f.input.view, index); const scopeId = pane.selection.nodeId, revision = pane.selection.revision;
		const draft = sourceDraft(t, f, `-- accepted discovery\n${f.module.source}`);
		draft.execute('scenarioLab.run', application);
		const run = f.runs.results.runs[0];
		assert.equal(run.scopeId, scopeId); assert.equal(pane.selection.revision, revision);
		assert.equal(run.items.find(item => item.test.parentId === f.module.id)!.source, draft.model.buffer.getText());
	});

for (const application of [false, true]) test(`Scenario ${application ? 'application' : 'native'} companion blur cannot retire a newer picker`, async t => {
	const f = await fixture(t); f.select('passes');
	const choice = { label: 'new request', description: '', detail: '' }; let accepted = false;
	const draft = sourceDraft(t, f, `-- accepted\n${f.module.source}`, () => {
		f.select('fails');
		f.firstPart.quickInput.pick('NEW REQUEST', '', () => new TextQuickPickProvider([choice]), item => { accepted = item === choice; });
	});
	draft.execute('scenarioLab.runWithCompanion', application);
	assert.equal(f.firstPart.quickInput.visible, true); assert.equal(f.firstPart.quickInput.model.items[0], choice);
	f.key('Enter'); assert.equal(accepted, true); assert.equal(f.runs.results.runs.length, 0);
});

for (const application of [false, true]) test(`Scenario ${application ? 'application' : 'native'} source execution does not accept another attachment's draft`, async t => {
	const f = await fixture(t); f.select('passes');
	const target = f.firstPart.activeGroup.panes.activePane!.commandTarget;
	f.secondPart.activeGroup.openEditor(new GameViewInput());
	let publishes = 0;
	const foreign = new ValueInput(f.secondPart.activeGroup.panes.activePane!.commandTarget, {
		options: { allowSpace: true }, format: (value: string) => value,
		invalidBlurMessage: 'invalid', parse: value => ({ value }),
	}, () => { publishes++; });
	t.after(() => { foreign.cancel(); foreign.field.focusTarget.release(); foreign.dispose(); });
	foreign.setValue('before'); foreign.layout({ left: 400, top: 32, right: 800, bottom: 64 });
	foreign.field.focusTarget.focus(); foreign.field.replaceText(0, 6, 'pending');
	let consumed = false;
	t.after(f.runs.onDidChangeRun(event => {
		if (event.type !== 'started') return;
		consumed = true; assert.equal(foreign.pending, true); assert.equal(publishes, 0);
	}));
	if (application) f.editor.commands.execute('scenarioLab.run', target); else inputFocus.executeCommand('scenarioLab.run', target);
	assert.equal(f.runs.results.runs.length, 1); assert.equal(consumed, true);
});

for (const application of [false, true]) test(`Scenario ${application ? 'application' : 'native'} execution rejects membership removed and re-admitted by independent discovery`, async t => {
	const f = await fixture(t), item = f.select('passes'), source = f.module.source;
	const draft = sourceDraft(t, f, `-- accepted\n${source}`, () => {
		const model = editorTextModelService.get(f.module.resource)!;
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: "return {kind='integration',tests={other=function() end}}" }]);
		f.runs.refreshSources();
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
		f.runs.refreshSources();
	});
	const revision = f.input.view.testPane.selection.revision;
	draft.execute('scenarioLab.run', application);
	assert.equal(f.input.view.testPane.selection.revision, revision, 'this discovery happened independently of the retained pane projection');
	assert.equal(f.input.view.testPane.selection.nodeId, item.id);
	assert.notEqual(f.runs.collection.getNode(item.id), item); assert.equal(f.runs.results.runs.length, 0);
});
