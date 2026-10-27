import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { RuntimeGpuHistory } from '../../ide/runtime/gpu_history';
import { RuntimeGteHistory } from '../../ide/runtime/gte_history';
import { GpuDebuggerInput, openGpuDebugger } from '../../ide/workbench/contrib/gpu_debugger/editor_input';
import { GteDebuggerInput, openGteDebugger } from '../../ide/workbench/contrib/gte_debugger/editor_input';
import { EventViewerInput, openEventViewer } from '../../ide/workbench/contrib/events/editor_input';
import { RomInspectorInput } from '../../ide/workbench/contrib/rom_inspector/editor_input';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { createActualSourcePanes } from '../helpers/source_panes';
import { compileEventHistoryFixture, eventHistoryRuntime } from '../helpers/event_history';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';

function inspectorWorkbench(t: TestContext, images: ReturnType<typeof compileEventHistoryFixture>) {
	const { runtime, sources, cpu } = eventHistoryRuntime(images), host = createHostFrameFixture(runtime);
	const externalWork = (): never => { throw new Error('Inspector movement does not request external work.'); };
	const ide = new RuntimeIdeState(runtime, host.presenter, { capture: externalWork }, externalWork,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 800, height: 320 }, sources, new Map(), externalWork, externalWork, externalWork);
	const editor = ide.editor;
	ide.boots.didReplaceMachine(); editor.interaction.setActive(true);
	t.after(async () => {
		inputFocus.setTarget(null); pointerCapture.interrupt(false);
		await editor.shutdown(); clearBackgroundTasks(); host.audio.dispose(); host.input.dispose();
	});
	editorRuntimeState.active = true; host.input.setPointerAdmissionMode('routed');
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const firstPart = editor.editorParts.createDocument({ requestedBounds: { left: 0, top: 32, right: 384, bottom: 290 } });
	const secondPart = editor.editorParts.createDocument({ requestedBounds: { left: 400, top: 32, right: 800, bottom: 290 } });
	const update = () => editor.update(0);
	const key = (code: string) => {
		editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none)); editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none, false, false)); update();
	};
	return { editor, host, sources, cpu, firstPart, secondPart, firstGroup: firstPart.activeGroup, secondGroup: secondPart.activeGroup, update, key };
}

test('GPU move keeps expired owned words and both observation views, with destination-local controls', t => {
	const f = createActualSourcePanes(t), history = new RuntimeGpuHistory(f.host.runtime, 2, 16);
	f.ide.boots.didReplaceMachine(); f.editor.interaction.setActive(true);
	const source = new GpuDebuggerInput(history), receiver = new GpuDebuggerInput(history);
	t.after(() => history.dispose());
	const issue = (color: number) => {
		f.host.runtime.machine.scheduler.setNowCycles(f.host.runtime.machine.scheduler.nowCycles + 10000);
		for (const word of [0x20000000 | color, 0x00100010, 0x00100020, 0x00200010]) f.host.runtime.machine.gxGpu.writeGp0(word);
	};
	f.firstGroup.openEditor(source); issue(0x123456); source.update(); source.select(0);
	f.secondGroup.openEditor(receiver); issue(0xabcdef); receiver.update(); receiver.select(1); issue(3);
	f.firstGroup.activate(source.id); f.update();
	assert.ok(source.selected.sequence < history.firstSequence);
	const words = source.selected.words, evidence = Array.from(words.subarray(0, source.selected.wordCount));
	const receiverWords = Array.from(receiver.selected.words.subarray(0, receiver.selected.wordCount));
	const origin = f.firstGroup.panes.activePane!.commandTarget, interaction = source.interaction;
	f.editor.commands.execute('runtime.resume', origin); assert.equal(f.host.execution.paused, false);
	f.editor.commands.execute('gpu.filter', origin);
	assert.equal(f.firstPart.quickInput.visible, true);
	const generation = history.generation, revision = history.revision, cycles = f.host.runtime.machine.scheduler.nowCycles;
	const executionRevision = f.host.execution.revision;
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, source, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	assert.equal(f.secondGroup.model.activeTab, source); assert.equal(f.secondGroup.model.findById(receiver.id), receiver);
	assert.notEqual(f.secondGroup.model.getLabel(source), f.secondGroup.model.getLabel(receiver));
	assert.equal(source.selected.words, words); assert.deepEqual(Array.from(words.subarray(0, source.selected.wordCount)), evidence);
	assert.deepEqual(Array.from(receiver.selected.words.subarray(0, receiver.selected.wordCount)), receiverWords);
	assert.equal(history.observing, true); assert.equal(history.generation, generation); assert.equal(history.revision, revision);
	assert.equal(source.interaction, interaction); assert.equal(interaction.transport, f.editor.commands.transport); assert.equal(interaction.running, true);
	assert.equal(f.host.execution.paused, false); assert.equal(f.host.execution.revision, executionRevision);
	assert.equal(origin.scope.runtime, undefined); assert.equal(origin.getCommand('gpu.follow')!.isEnabled(), false);
	assert.equal(f.firstPart.quickInput.visible, false);
	const destination = f.secondGroup.panes.activePane!.commandTarget;
	f.editor.commands.execute('gpu.filter', destination);
	assert.equal(f.secondPart.quickInput.visible, true); assert.equal(inputFocus.target, f.secondPart.quickInput.field.focusTarget);
	f.key('Escape'); openGpuDebugger(f.secondGroup, history); assert.equal(f.secondGroup.model.activeTab, source);
	f.secondGroup.activate(receiver.id); assert.equal(source.interaction.running, false); assert.equal(f.host.execution.paused, true);
	f.secondGroup.removeEditor(source); assert.equal(history.observing, true);
	f.secondGroup.removeEditor(receiver); assert.equal(history.observing, false);
	assert.equal(f.host.execution.paused, true);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('GTE move retains an expired raw command, observation lease and independent destination view', t => {
	const program = `local data<const>: *word = 0x08010244
local command<const>: *word = 0x08010344
function issue(word) data[0] = word; *command = 6 end
return true`;
	const f = inspectorWorkbench(t, createCartlibProgramHarness(program).images);
	const history = new RuntimeGteHistory(f.host.runtime, f.sources, 2);
	const source = new GteDebuggerInput(history), receiver = new GteDebuggerInput(history);
	t.after(() => history.dispose());
	const issueFunction = f.cpu.getGlobalByKey(f.cpu.stringPool.find('issue')!) as Closure;
	const issue = (word: number) => {
		f.cpu.beginCompletionCall(issueFunction, [word]);
		assert.equal(f.host.runtime.machine.scheduler.runCpuSlice(0, 10_000_000), RunResult.Halted);
	};
	f.firstGroup.openEditor(source); issue(17); source.update(); source.select(0);
	f.secondGroup.openEditor(receiver); issue(29); receiver.update(); receiver.select(1); issue(41);
	f.firstGroup.activate(source.id); f.update();
	assert.ok(source.selected.sequence < history.firstSequence);
	const before = source.selected.beforeData, evidence = Array.from(before), image = source.selected.image;
	assert.equal(image, f.sources.currentBlua32Media.cartridgeSlots[0]); assert.notEqual(image, null);
	const origin = f.firstGroup.panes.activePane!.commandTarget, revision = history.revision, generation = history.generation;
	f.editor.commands.execute('runtime.resume', origin); assert.equal(f.host.execution.paused, false);
	const cycles = f.host.runtime.machine.scheduler.nowCycles, executionRevision = f.host.execution.revision;
	f.editor.commands.execute('gte.view', origin); assert.equal(f.firstPart.quickInput.visible, true);
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, source, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	assert.equal(f.secondGroup.model.activeTab, source); assert.equal(f.secondGroup.model.findById(receiver.id), receiver);
	assert.notEqual(f.secondGroup.model.getLabel(source), f.secondGroup.model.getLabel(receiver));
	assert.equal(source.selected.beforeData, before); assert.deepEqual(Array.from(before), evidence); assert.equal(source.selected.image, image);
	assert.equal(receiver.selected.beforeData[0], 29); assert.equal(history.generation, generation); assert.equal(history.revision, revision);
	assert.equal(source.interaction.running, true); assert.equal(source.interaction.transport, f.editor.commands.transport);
	assert.equal(f.host.execution.paused, false); assert.equal(f.host.execution.revision, executionRevision);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	assert.equal(origin.scope.runtime, undefined); assert.equal(origin.getCommand('gte.follow')!.isEnabled(), false);
	assert.equal(f.firstPart.quickInput.visible, false);
	f.editor.commands.execute('gte.filter', f.secondGroup.panes.activePane!.commandTarget);
	assert.equal(f.secondPart.quickInput.visible, true); f.key('Escape');
	openGteDebugger(f.secondGroup, history); assert.equal(f.secondGroup.model.activeTab, source);
	f.secondGroup.activate(receiver.id); assert.equal(source.interaction.running, false); assert.equal(f.host.execution.paused, true);
	f.secondGroup.removeEditor(source); assert.equal(history.observing, true);
	f.secondGroup.removeEditor(receiver); assert.equal(history.observing, false);
	assert.equal(f.host.execution.paused, true);
});

test('Events move retains actual selected evidence and reading position in a fresh pane until history clears', t => {
	const f = inspectorWorkbench(t, compileEventHistoryFixture()), history = f.editor.events;
	const emit = f.cpu.getGlobalByKey(f.cpu.stringPool.find('emit_for_viewer')!) as Closure;
	f.cpu.beginCompletionCall(emit, [80]); assert.equal(f.cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const source = new EventViewerInput(history), receiver = new EventViewerInput(history);
	f.firstGroup.openEditor(source); f.secondGroup.openEditor(receiver); f.firstGroup.activate(source.id); f.update();
	source.filter = 'probe'; f.update(); source.selected = 20;
	source.viewport.scrollbar.setScroll(8.5 * source.layout.rowHeight);
	const selected = source.projection.rows[source.selected]; assert.equal(history.count, 80);
	const origin = f.firstGroup.panes.activePane!.commandTarget;
	f.editor.commands.execute('runtime.resume', origin); assert.equal(f.host.execution.paused, false);
	const cycles = f.host.runtime.machine.scheduler.nowCycles, revision = f.host.execution.revision;
	f.editor.commands.execute('events.filter', origin); assert.equal(f.firstPart.quickInput.visible, true);
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, source, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	assert.equal(f.secondGroup.model.activeTab, source); assert.equal(f.secondGroup.model.findById(receiver.id), receiver);
	assert.notEqual(f.secondGroup.model.getLabel(source), f.secondGroup.model.getLabel(receiver));
	assert.equal(source.history, history); assert.equal(source.filter, 'probe'); assert.equal(receiver.filter, '');
	assert.equal(source.projection.rows[source.selected], selected); assert.equal(source.viewport.scrollTop / source.layout.rowHeight, 8.5);
	assert.equal(source.interaction.running, true); assert.equal(origin.scope.runtime, undefined); assert.equal(f.firstPart.quickInput.visible, false);
	assert.equal(f.host.execution.paused, false); assert.equal(f.host.execution.revision, revision);
	f.editor.commands.execute('events.filter', f.secondGroup.panes.activePane!.commandTarget);
	assert.equal(f.secondPart.quickInput.visible, true); f.key('Escape');
	openEventViewer(f.secondGroup, history); assert.equal(f.secondGroup.model.activeTab, source);
	assert.equal(f.editor.editorParts.moveEditor(f.secondPart.activeGroup, source, { kind: 'window' }), true); f.update();
	const destination = f.editor.editorParts.activePart;
	assert.notEqual(destination, f.secondPart); assert.equal(destination.activeGroup.model.activeTab, source);
	assert.equal(source.projection.rows[source.selected], selected); assert.equal(source.viewport.scrollTop / source.layout.rowHeight, 8.5);
	assert.equal(f.host.execution.paused, false); assert.equal(f.host.execution.revision, revision);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	history.clear(); f.update(); assert.equal(source.selected, -1); assert.equal(source.projection.rows.length, 0);
	destination.activeGroup.openEditor(new EventViewerInput(history));
	assert.equal(source.interaction.running, false); assert.equal(f.host.execution.paused, true);
});

test('ROM move retains its exact snapshot and held reader document with destination-owned windows', t => {
	const f = createActualSourcePanes(t), rom = f.sources.systemRom;
	const input = new RomInspectorInput({ domain: -1, sourceContextId: f.sources.systemContextId,
		label: 'System', rom: rom.bytes, header: rom.header, assets: rom.index.entries });
	f.firstGroup.openEditor(input); input.model.setMode('structure'); input.model.select(0); f.update();
	f.editor.commands.execute('romInspector.inspect', f.firstGroup.panes.activePane!.commandTarget); f.update();
	input.readerHeld = true; input.reader.view = 'bytes'; f.update();
	const reader = input.reader, subject = reader.subject, snapshot = input.snapshot;
	input.readerWindow.setPlacement('maximized'); f.update();
	const requested = { ...input.readerWindow.requestedBounds };
	assert.equal(f.editor.editorParts.moveEditor(f.firstPart.activeGroup, input, { kind: 'group', group: f.secondPart.activeGroup }), true); f.update();
	assert.equal(f.secondGroup.model.activeTab, input); assert.equal(input.reader, reader); assert.equal(reader.subject, subject);
	assert.equal(input.snapshot, snapshot); assert.equal(input.snapshot.rom, rom.bytes); assert.equal(input.readerHeld, true);
	assert.equal(reader.view, 'bytes'); assert.equal(input.readerWindow.open, true); assert.equal(input.readerWindow.placement, 'maximized');
	assert.deepEqual(input.readerWindow.requestedBounds, requested);
	f.editor.commands.execute('romInspector.assets', f.secondGroup.panes.activePane!.commandTarget);
	f.editor.commands.execute('romInspector.sort', f.secondGroup.panes.activePane!.commandTarget);
	assert.equal(f.secondPart.quickInput.visible, true); assert.equal(f.firstPart.quickInput.visible, false);
});
