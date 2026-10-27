import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { willExecuteRuntimeDebuggerPlan, didExecuteRuntimeDebuggerPlan } from '../../ide/runtime/debugger_state';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { RemoteInput } from '../../hosts/common/input/remote';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { registerLuaSourceRecord, captureInstalledLuaSources } from '../../ide/runtime/source_registry';
import { createBlua32SourceImage } from '../../ide/runtime/sources';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';
import { createHostFrameFixture } from '../helpers/host_frame';

const WORLD = `local actor<const> = { id = 'actor', definition_id = 'fixture', active = true, _components = {}, _components_by_class = {} }
function actor:mark_for_disposal() self.active = false end
function actor:rename(name) self.id = name end
actor.data = actor.rename
return { _objects = { actor }, request_mutation_boundary = function() return { reached = true } end }`;
const ENTRY = "return require('cartlib/world/world')";
const images = createCartlibProgramHarness(ENTRY, { optLevel: 0,
	modules: [{ path: 'cartlib/world/world', source: WORLD }] }).images;

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	const { runtime, sources, cpu } = eventHistoryRuntime(images), host = createHostFrameFixture(runtime);
	const image = sources.currentBlua32Media.cartridgeSlots[0]!, registry = sources.catalog.getContext(image.sourceContextId).luaSources;
	for (const [module, text] of [['entry', ENTRY], ['cartlib/world/world', WORLD]]) registerLuaSourceRecord(registry, {
		resid: module, type: 'lua', src: text, base_src: text, source_path: `${module}.lua`, normalized_source_path: `${module}.lua`,
		module_path: module, update_timestamp: 0, base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	sources.currentBlua32Media = { ...sources.currentBlua32Media, cartridgeSlots: [createBlua32SourceImage(images.cartImage, images.cartSymbols,
		captureInstalledLuaSources(registry, images.cartSymbols!.metadata.compiledModulePaths), image.sourceContextId), null] };
	const externalWork = (): never => { throw new Error('Actor movement does not request external work.'); };
	const ide = new RuntimeIdeState(runtime, host.presenter, { capture: externalWork }, externalWork,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 800, height: 360 }, sources, new Map(), externalWork, externalWork, externalWork);
	const editor = ide.editor, parts = editor.editorParts, controller = editor.actorLab;
	ide.boots.didReplaceMachine(); editor.interaction.setActive(true);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	t.after(async () => {
		inputFocus.setTarget(null); pointerCapture.interrupt(false);
		await editor.shutdown(); clearBackgroundTasks(); host.audio.dispose(); host.input.dispose();
	});
	editorRuntimeState.active = true; host.input.setPointerAdmissionMode('routed');
	const origin = parts.createDocument({ requestedBounds: { left: 0, top: 24, right: 800, bottom: 340 } });
	const destination = parts.createDocument({ requestedBounds: { left: 0, top: 24, right: 800, bottom: 340 } });
	const input = controller.resolveInput(), choice = readActorChoices(sources, ide.guest, 0)[0];
	controller.inspectActor(input, 0, choice.hashId);
	origin.activeGroup.openEditor(input); editor.update(0);
	const pane = origin.activeGroup.panes.activePane!;
	assert.ok(pane instanceof ActorLabEditorPane);
	const key = (code: string) => {
		editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none)); editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none, false, false));
		editor.update(0);
	};
	const native = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event), event => editor.dispatchWheel(event));
	return { ide, editor, host, parts, controller, input, pane, origin, destination, key, cpu, native };
}

test('Actor move retains its physical domain and open Details, revokes its old picker and guest input, and reveals the moved singleton', async t => {
	const f = fixture(t), input = f.input, details = input.details!, runtime = input.runtime;
	f.editor.commands.execute('actorLab.details', f.pane.commandTarget); f.editor.update(0);
	assert.equal(f.pane.inspector.visible, true);
	f.controller.setDetailsLocked(input, true);
	const subject = details.subject, requested = { ...input.detailsWindow.requestedBounds };
	f.editor.commands.execute('actorLab.find', f.pane.commandTarget);
	assert.equal(f.origin.quickInput.visible, true);
	const oldTarget = f.pane.commandTarget, transport = input.interaction.transport;
	const cycles = f.host.runtime.machine.scheduler.nowCycles, execution = f.host.execution.revision;
	let disposed = 0; input.onWillDispose(() => { disposed++; });
	assert.equal(f.parts.moveEditor(f.origin.activeGroup, input, { kind: 'group', group: f.destination.activeGroup }), true); f.editor.update(0);
	const moved = f.destination.activeGroup.panes.activePane!;
	assert.ok(moved instanceof ActorLabEditorPane && moved !== f.pane);
	assert.ok(moved.input === input && input.runtime === runtime && input.details === details);
	assert.equal(details.subject, subject); assert.equal(details.locked, true);
	assert.equal(input.detailsWindow.open, true); assert.equal(moved.inspector.visible, true);
	assert.deepEqual(input.detailsWindow.requestedBounds, requested);
	assert.equal(f.origin.quickInput.visible, false); assert.equal(oldTarget.getCommand('actorLab.find')!.isEnabled(), false);
	assert.equal(oldTarget.scope.runtime, undefined); assert.equal(f.editor.guestInputRecipient, null);
	assert.equal(input.interaction.transport, transport); assert.equal(disposed, 0);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles); assert.equal(f.host.execution.revision, execution);
	assert.equal(await f.parts.close(f.origin), true);
	f.parts.minimize(f.destination); assert.equal(f.destination.window!.model.minimized, true);
	f.controller.open(f.parts.main.activeGroup);
	assert.equal(f.destination.window!.model.minimized, false);
	assert.equal(f.parts.findGroup(input), f.destination.activeGroup); assert.equal(f.controller.resolveInput(), input);
	assert.equal(f.parts.main.activeGroup.model.findById(input.id), undefined);
	f.editor.commands.execute('actorLab.find', moved.commandTarget);
	assert.equal(f.destination.quickInput.visible, true); assert.equal(f.editor.quickInput.visible, false);
	f.key('Escape');
	f.controller.dispose();
	assert.equal(f.destination.activeGroup.model.findById(input.id), undefined); assert.equal(disposed, 1);
});

test('Actor moving a pending argument submission cannot admit a late call or steal destination focus', async t => {
	const f = fixture(t);
	f.editor.commands.execute('actorLab.call', f.pane.commandTarget);
	assert.equal(f.origin.quickInput.visible, true);
	// The provider retains compiled method identity; choose its actual catalog entry.
	const picker = f.origin.quickInput;
	const method = picker.model.list.rows.findIndex(row => row.item.label === 'rename');
	assert.ok(method >= 0); picker.model.list.selectionIndex = method;
	f.key('Enter'); assert.equal(picker.inputBox, true);
	setFieldText(picker.field, "'late'", true);
	f.key('Enter');
	assert.equal(picker.field.readOnly, true);
	assert.equal(f.parts.moveEditor(f.origin.activeGroup, f.input, { kind: 'group', group: f.destination.activeGroup }), true);
	const target = f.destination.activeGroup.panes.activePane!.commandTarget;
	await f.host.tasks.join(); await Promise.resolve();
	assert.equal(picker.visible, false); assert.equal(f.ide.actorExecution.active, undefined);
	assert.ok(inputFocus.target === target); assert.equal(f.input.runtime.roots[0].name, 'actor');
});

test('Actor queued mutation belongs to the invoking attachment, while a move preserves logical runtime intent', async t => {
	const f = fixture(t);
	f.editor.commands.execute('actorLab.actions', f.pane.commandTarget);
	const picker = f.origin.quickInput;
	const action = picker.model.list.rows.findIndex(row => 'method' in row.item && row.item.method === 'mark_for_disposal');
	assert.ok(action >= 0); picker.model.list.selectionIndex = action;
	f.key('Enter');
	const operation = f.ide.actorExecution.active!;
	assert.equal(operation.invoked, false);
	f.input.interaction.running = true;
	assert.equal(f.host.execution.paused, false);
	assert.equal(f.parts.moveEditor(f.origin.activeGroup, f.input, { kind: 'group', group: f.destination.activeGroup }), true);
	const target = f.destination.activeGroup.panes.activePane!.commandTarget;
	assert.equal(f.input.interaction.running, true); assert.equal(f.host.execution.paused, false);
	assert.equal(f.editor.guestInputRecipient, null);
	await f.host.tasks.join();
	assert.equal((await operation.completion).status, 'interrupted');
	assert.equal(operation.invoked, false); assert.ok(inputFocus.target === target);
	f.editor.update(0); assert.equal(f.input.runtime.roots[0].active, true);
	f.destination.activeGroup.openEditor(new GameViewInput());
	assert.equal(f.input.interaction.running, false, 'ordinary deactivation still stops the logical client');
});

test('Actor transfer drains a physical guest hold and requires fresh destination input admission', t => {
	const f = fixture(t), bounds = f.input.previewBounds;
	assert.equal(f.input.layout.previewVisible, true);
	f.native.apply([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]);
	const guest = inputFocus.target!, binding = guest.guestInput!, interaction = guest.scope.interaction!;
	assert.ok(binding.recipient === f.host.input && pointerCapture.guestBinding === binding);
	assert.equal(f.parts.moveEditor(f.origin.activeGroup, f.input, { kind: 'group', group: f.destination.activeGroup }), true); f.editor.update(0);
	const moved = f.destination.activeGroup.panes.activePane!;
	assert.equal(guest.guestInput, undefined); assert.equal(interaction.running, false);
	assert.equal(pointerCapture.guestBinding, undefined); assert.equal(pointerCapture.draining, true);
	assert.equal(f.editor.guestInputRecipient, null); assert.ok(inputFocus.target === moved.commandTarget);
	f.native.apply([{ type: 'button', button: 'primary', down: false }]);
	assert.equal(pointerCapture.draining, false);
	const nextBounds = f.input.previewBounds;
	f.native.apply([{ type: 'pointer', x: (nextBounds.left + nextBounds.right) / 2, y: (nextBounds.top + nextBounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]);
	const fresh = inputFocus.target!.guestInput!;
	assert.notEqual(fresh, binding); assert.ok(fresh.recipient === f.host.input);
	assert.ok(f.editor.guestInputRecipient === f.host.input && pointerCapture.guestBinding === fresh);
});

test('Actor same-input reopening preserves queued admission, and an entered call survives view movement without late presentation', async t => {
	const f = fixture(t);
	f.editor.commands.execute('actorLab.actions', f.pane.commandTarget);
	const picker = f.origin.quickInput;
	const action = picker.model.list.rows.findIndex(row => 'method' in row.item && row.item.method === 'mark_for_disposal');
	assert.ok(action >= 0); picker.model.list.selectionIndex = action;
	f.key('Enter');
	const operation = f.ide.actorExecution.active!;
	assert.equal(operation.invoked, false);
	f.origin.activeGroup.openEditor(f.input);
	assert.ok(f.origin.activeGroup.panes.activePane === f.pane);
	await f.host.tasks.join();
	assert.equal(operation.result, undefined, 'a normal same-input open is not an attachment retirement');
	// Execute the real guest-owned mutation-boundary request and its reached receipt.
	for (const phase of ['request', 'rendezvous']) {
		assert.equal(f.ide.debugger.plans.controlActive, true, phase);
		willExecuteRuntimeDebuggerPlan(f.ide.debugger);
		f.host.runtime.machine.scheduler.runCpuSlice(0, 1_000_000);
		didExecuteRuntimeDebuggerPlan(f.ide.debugger);
		await f.host.tasks.join();
	}
	assert.equal(operation.invoked, true); assert.equal(operation.result, undefined);
	assert.equal(f.parts.moveEditor(f.origin.activeGroup, f.input, { kind: 'group', group: f.destination.activeGroup }), true);
	const target = f.destination.activeGroup.panes.activePane!.commandTarget;
	willExecuteRuntimeDebuggerPlan(f.ide.debugger);
	f.host.runtime.machine.scheduler.runCpuSlice(0, 1_000_000);
	didExecuteRuntimeDebuggerPlan(f.ide.debugger);
	await f.host.tasks.join(); f.ide.actorExecution.afterHostFrame();
	assert.equal((await operation.completion).status, 'completed');
	f.editor.update(0);
	assert.equal(f.input.runtime.roots[0].active, false, 'the physical mutation is retained after view detachment');
	assert.ok(inputFocus.target === target);
});

test('Actor reveal cannot start a picker after focus callbacks replace its requested input', t => {
	const f = fixture(t), replacement = new GameViewInput();
	f.destination.focus();
	const unbind = f.pane.commandTarget.onDidFocus(() => f.origin.activeGroup.openEditor(replacement));
	t.after(unbind);
	f.input.actorHashId = 0; f.input.dirty = true;
	assert.doesNotThrow(() => f.controller.open(f.parts.main.activeGroup));
	assert.equal(f.origin.activeGroup.model.activeTab, replacement);
	assert.equal(f.origin.quickInput.visible, false);
	assert.equal(f.parts.findGroup(f.input), f.origin.activeGroup, 'the hidden retained subject is not disposed or moved by focus');
});

test('Actor Details source navigation belongs to the moved concrete pane', async t => {
	const f = fixture(t);
	f.editor.commands.execute('actorLab.details', f.pane.commandTarget); f.editor.update(0);
	assert.equal(f.parts.moveEditor(f.origin.activeGroup, f.input, { kind: 'group', group: f.destination.activeGroup }), true); f.editor.update(0);
	const moved = f.destination.activeGroup.panes.activePane!;
	assert.ok(moved instanceof ActorLabEditorPane);
	const index = moved.inspector.model.rows.findIndex(row => row.element.source?.resource.path === 'cartlib/world/world.lua');
	assert.ok(index >= 0, 'the runtime function property retains its installed source identity');
	moved.inspector.model.selectionIndex = index;
	f.editor.commands.execute('propertyInspector.source', moved.inspector.focusTarget);
	await new Promise<void>(resolve => setImmediate(resolve)); f.editor.update(0);
	const source = f.destination.activeGroup.model.activeTab!;
	assert.ok(source.kind === 'code_editor');
	assert.equal(source.resource.contextId, f.input.controller.sources.currentBlua32Media.cartridgeSlots[0]!.sourceContextId);
	assert.equal(source.resource.path, 'cartlib/world/world.lua');
	assert.equal(source.workingCopy.buffer.getText(), WORLD);
	assert.equal(f.origin.activeGroup.model.tabs.length, 0); assert.equal(f.parts.main.activeGroup.model.findById(source.id), undefined);
	assert.equal(f.parts.findGroup(f.input), f.destination.activeGroup);
});
