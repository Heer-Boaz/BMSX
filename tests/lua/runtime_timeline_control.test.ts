import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HostPauseReason } from '../../hosts/common/execution_control';
import { HostFrameSession } from '../../hosts/common/frame_session';
import { executeHostUpdate } from '../../hosts/common/machine_step';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { resetRuntimeDebuggerExecution } from '../../ide/runtime/debugger_state';
import type { FrameNavigationOperation } from '../../ide/runtime/frame_navigation';
import { InputInteraction } from '../../ide/input/interaction';
import { RuntimeTransport } from '../../ide/runtime/transport';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { RuntimeTimelineControl } from '../../ide/workbench/ui/runtime_timeline_control';
import { createFrameRuntime } from '../helpers/frame_runtime';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';

async function fixture(t: TestContext) {
	const runtime = createFrameRuntime();
	const f = createRuntimeInspectionFixture(runtime, createScenarioTestSourceState([]));
	const { frameNavigation: navigation, rewind, tasks, execution, presenter, audio, presentation } = f;
	const previousFont = editorViewState.font, previousLineHeight = editorViewState.lineHeight,
		previousWidth = editorViewState.viewportWidth, previousHeight = editorViewState.viewportHeight;
	editorViewState.font = new EditorFont('tiny');
	editorViewState.lineHeight = editorViewState.font.lineHeight;
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const content = inputFocus.createTarget(); content.bindKeyboard(() => {}); content.focus();
	const transport = new RuntimeTransport(runtime, execution, rewind, navigation, () => true);
	const interaction = new InputInteraction(transport);
	const context = { target: content, interaction };
	content.scope.runtime = context; content.scope.interaction = interaction;
	content.registerCommand('runtime.pause', { isEnabled: () => transport.playbackEnabled, run: () => transport.pause() });
	content.registerCommand('runtime.playback', { isEnabled: () => transport.playbackEnabled, run: () => transport.togglePlayback() });
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const menu = new ContextMenuController(inputFocus, pointerCapture), surfaces = new WorkbenchSurfaceService();
	const workArea = { left: 0, top: 0, right: 384, bottom: 288 }, bounds = { ...workArea };
	const owner = surfaces.attach({ role: 'content', captureScope: content.scope.surfaceScope,
		isVisible: () => true, getBounds: () => workArea, getClip: () => workArea, draw() {} });
	let focusReturns = 0, layouts = 0;
	const timeline = new RuntimeTimelineControl(commands, () => { focusReturns++; content.focus(); }, content, bounds,
		() => { layouts++; bounds.top = workArea.bottom - timeline.height; });
	timeline.attach(surfaces, owner, workArea, menu);
	timeline.setContext(context);
	const session = new HostFrameSession(runtime.timing.ufpsScaled, 0, rewind, execution);
	runtime.onStateRestored = origin => {
		f.events.didRestore(origin); navigation.didRestore(origin); f.guest.invalidate('heap-replaced');
		resetRuntimeDebuggerExecution(f.debuggerState);
	};
	execution.setPauseReason(HostPauseReason.Workbench, true);
	const frame = async () => {
		navigation.beforeHostFrame(); rewind.service(true);
		if (tasks.ready && !rewind.active && !execution.executionBlocked())
			executeHostUpdate(session, runtime, presenter, audio, presentation, 30000);
		presentation.presentPausedFrame(presenter, runtime, 100, 20);
		if (runtime.history.checkpointPending && tasks.ready) rewind.service(true);
		navigation.afterHostFrame(); await tasks.join();
	};
	const settle = async (operation: FrameNavigationOperation) => {
		for (let frameIndex = 0; frameIndex < 1000 && operation.result === undefined; frameIndex++) await frame();
		assert.ok(operation.result, 'the real finite navigation owner settles through host frame progress');
		return operation.completion;
	};
	t.after(() => {
		timeline.dispose(); menu.dispose(); inputFocus.setTarget(null); pointerCapture.cancel(); surfaces.dispose();
		navigation.dispose(); presenter.dispose();
		editorViewState.font = previousFont; editorViewState.lineHeight = previousLineHeight;
		editorViewState.viewportWidth = previousWidth; editorViewState.viewportHeight = previousHeight;
	});
	await frame();
	return { ...f, navigation, transport, interaction, context, content, commands, timeline, menu, frame, settle,
		focusReturns: () => focusReturns, layouts: () => layouts };
}

test('available paused transport does not request Timeline; explicit reveal, hide and unavailable attachment retain their own intent', async t => {
	const f = await fixture(t), { timeline, content, context } = f;
	assert.equal(f.execution.paused, true);
	assert.equal(timeline.available, true); assert.equal(timeline.requested, false);
	assert.equal(timeline.visible, false); assert.equal(timeline.height, 0); assert.equal(timeline.canHide, false);
	const measure = t.mock.method(editorViewState.font.renderFont(), 'measure');
	for (let frameIndex = 0; frameIndex < 1000; frameIndex++) {
		timeline.setContext(context); timeline.update();
	}
	assert.equal(measure.mock.callCount(), 0, 'hidden capability does not measure or arrange a transport row');
	assert.equal(f.layouts(), 0);
	timeline.focus();
	assert.equal(timeline.requested, true); assert.equal(timeline.visible, true);
	assert.equal(timeline.canHide, true); assert.ok(timeline.height > 0);
	assert.equal(f.layouts(), 1, 'reveal publishes its size to the owning layout before focus admission');
	assert.equal(inputFocus.target!.scope, timeline.focusScope);
	inputFocus.moveFocus(false);
	assert.ok(inputFocus.target === content, 'reveal immediately publishes the noninteractive range focus route');
	timeline.focus();
	timeline.hide();
	assert.equal(timeline.visible, false); assert.equal(timeline.height, 0);
	assert.equal(inputFocus.target, content); assert.equal(f.focusReturns(), 2, 'Tab and then Hide each use the pane-owned focus return');
	timeline.focus();
	const sibling = inputFocus.createTarget(); sibling.bindKeyboard(() => {}); sibling.focus();
	timeline.hide(); assert.equal(inputFocus.target, sibling, 'hiding an unfocused part cannot steal another client');
	timeline.focus(); timeline.setContext(undefined);
	assert.equal(timeline.available, false); assert.equal(timeline.requested, true); assert.equal(timeline.visible, false);
	assert.equal(timeline.canHide, true, 'unavailable presentation does not revoke the retained view command');
	timeline.setContext(context);
	assert.equal(timeline.visible, true, 'part availability does not erase retained explicit view intent');
	timeline.setContext(undefined); timeline.hide(); timeline.setContext(context);
	assert.equal(timeline.requested, false); assert.equal(timeline.visible, false);
});

test('recorded review never overrides Timeline visibility intent, and Present does not close an explicitly requested view', async t => {
	const f = await fixture(t), { timeline, context, navigation } = f;
	await f.settle(navigation.step(1, 8));
	assert.equal(timeline.visible, false, 'paused live execution still does not request chrome');
	await f.settle(navigation.step(-1, 2));
	timeline.setContext(context); timeline.update();
	assert.equal(f.rewind.active, true);
	assert.equal(timeline.visible, false); assert.equal(timeline.requested, false); assert.equal(timeline.height, 0);
	timeline.focus();
	assert.equal(timeline.canHide, true);
	const position = f.rewind.positionCycles, cycles = f.runtime.machine.scheduler.nowCycles;
	timeline.hide();
	assert.equal(timeline.requested, false); assert.equal(timeline.visible, false); assert.equal(timeline.height, 0);
	const measure = t.mock.method(editorViewState.font.renderFont(), 'measure');
	for (let frameIndex = 0; frameIndex < 1000; frameIndex++) { timeline.setContext(context); timeline.update(); }
	assert.equal(measure.mock.callCount(), 0, 'hidden history review does not arrange a transport row');
	assert.equal(f.rewind.active, true); assert.equal(f.rewind.positionCycles, position);
	assert.equal(f.runtime.machine.scheduler.nowCycles, cycles);
	timeline.focus();
	await f.settle(navigation.finishReview('present'));
	timeline.setContext(context);
	assert.equal(timeline.requested, true); assert.equal(timeline.visible, true);
	timeline.hide();
	assert.equal(timeline.visible, false); assert.equal(timeline.height, 0);
	assert.equal(f.execution.paused, true, 'ending review does not imply resuming gameplay');
});

test('hiding explicit intent preserves a pending and owned slider seek until the real navigation owner settles', async t => {
	const f = await fixture(t), { timeline, navigation, content, context } = f;
	await f.settle(navigation.step(1, 8));
	timeline.focus(); timeline.update(); inputFocus.moveFocus(false);
	assert.equal(inputFocus.target!.parent!.scope, timeline.focusScope, 'Tab entered the actual range control');
	inputFocus.handleKeyboard(new KeyInputEvent('Home', KeyModifier.none));
	assert.equal(timeline.canHide, true, 'physical navigation does not own view visibility');
	const cancel = t.mock.method(navigation, 'cancel');
	timeline.hide();
	assert.equal(timeline.requested, false); assert.equal(timeline.visible, false); assert.equal(timeline.height, 0);
	timeline.update();
	const operation = navigation.active!;
	assert.equal(operation.request.kind, 'seek'); assert.equal(timeline.canHide, false);
	timeline.hide(); assert.equal(cancel.mock.callCount(), 0, 'presentation changes never cancel an owned seek');
	assert.equal((await f.settle(operation)).status, 'completed');
	timeline.update(); assert.equal(timeline.visible, false, 'selected recorded history cannot reopen a hidden view');
	await f.settle(navigation.finishReview('present'));
	timeline.setContext(context);
	assert.equal(timeline.visible, false); assert.equal(inputFocus.target, content);
	assert.equal(cancel.mock.callCount(), 0);
});

test('hiding Timeline retires only an invoking control popup and returns focus through the owning pane', async t => {
	const f = await fixture(t), { timeline, navigation, menu, content, context, commands } = f;
	await f.settle(navigation.step(1, 8)); await f.settle(navigation.step(-1, 2));
	timeline.setContext(context); timeline.focus(); timeline.update();
	const actions = inputFocus.target!;
	menu.show(0, 0, [{ type: 'command', command: 'pause' }], commands,
		{ invocationOrigin: actions, returnFocus: actions, commandTarget: content, selectFirst: true });
	assert.equal(menu.visible, true);
	timeline.hide();
	assert.equal(menu.visible, false); assert.equal(timeline.visible, false); assert.equal(inputFocus.target, content);
	assert.equal(f.focusReturns(), 1);
	assert.equal(f.rewind.active, true, 'hiding chrome does not accept or abandon the selected history');
	await f.settle(navigation.finishReview('present')); timeline.setContext(context);

	timeline.focus(); timeline.update();
	const sibling = inputFocus.createTarget(null, timeline.focusScope); sibling.bindKeyboard(() => {}); sibling.focus();
	menu.show(0, 0, [{ type: 'command', command: 'pause' }], commands,
		{ invocationOrigin: sibling, returnFocus: sibling, commandTarget: content, selectFirst: true });
	timeline.hide();
	assert.equal(menu.visible, true, 'sharing workbench chrome membership does not confer Timeline popup ownership');
	assert.equal(inputFocus.target, menu.focusTarget); menu.hide(); assert.equal(inputFocus.target, sibling);
});

test('physical context replacement, unlike presentation hide, cancels the old attached target seek', async t => {
	const f = await fixture(t), { timeline, navigation } = f;
	await f.settle(navigation.step(1, 8));
	timeline.focus(); timeline.update(); inputFocus.moveFocus(false);
	inputFocus.handleKeyboard(new KeyInputEvent('Home', KeyModifier.none)); timeline.update();
	const operation = navigation.active!, cancel = t.mock.method(navigation, 'cancel');
	timeline.setContext(undefined);
	assert.equal(cancel.mock.callCount(), 1); assert.equal(cancel.mock.calls[0].arguments[0], operation);
	assert.equal(timeline.available, false); assert.equal(timeline.visible, false); assert.equal(timeline.requested, true);
	assert.equal((await f.settle(operation)).status, 'interrupted');
});

test('concrete client context changes on the same physical transport retain queued and owned range navigation', async t => {
	const f = await fixture(t), { timeline, navigation, interaction, context, content } = f;
	await f.settle(navigation.step(1, 8));
	timeline.focus(); timeline.update(); inputFocus.moveFocus(false);
	inputFocus.handleKeyboard(new KeyInputEvent('Home', KeyModifier.none));
	const alternate = inputFocus.createTarget(); alternate.bindKeyboard(() => {});
	const alternateContext = { target: alternate, interaction }; alternate.scope.runtime = alternateContext;
	alternate.registerCommand('runtime.pause', content.getCommand('runtime.pause')!);
	alternate.registerCommand('runtime.playback', content.getCommand('runtime.playback')!);
	const cancel = t.mock.method(navigation, 'cancel');
	timeline.setContext(alternateContext); timeline.update();
	const operation = navigation.active!;
	assert.ok(operation, 'the queued range request still reaches its physical navigation owner');
	assert.equal(operation.request.kind, 'seek', 'changing the reading client does not erase its queued physical range request');
	timeline.setContext(context);
	assert.equal(navigation.active, operation); assert.equal(cancel.mock.callCount(), 0);
	assert.equal((await f.settle(operation)).status, 'completed');
	timeline.update(); assert.equal(timeline.visible, true); assert.equal(timeline.canHide, true);
});

test('Timeline retires an unavailable target and its owned seek without selecting another transport', async t => {
	const f = await fixture(t), { timeline, navigation, interaction } = f;
	await f.settle(navigation.step(1, 8));
	timeline.focus(); timeline.update(); inputFocus.moveFocus(false);
	inputFocus.handleKeyboard(new KeyInputEvent('Home', KeyModifier.none)); timeline.update();
	const operation = navigation.active!;
	interaction.setRuntime(null);
	assert.equal(timeline.available, false); assert.equal(timeline.visible, false);
	assert.equal(timeline.requested, true);
	assert.equal((await f.settle(operation)).status, 'interrupted');
	interaction.setRuntime(f.transport);
	assert.equal(timeline.available, true); assert.equal(timeline.visible, true);
	f.transport.retire();
	assert.equal(timeline.available, false); assert.equal(timeline.visible, false);
	assert.equal(timeline.requested, true);
});

test('Timeline attachment ends with its invoking control rather than a same-target replacement', async t => {
	const f = await fixture(t), { timeline, content } = f;
	timeline.focus();
	content.scope.runtime = undefined; content.scope.interaction = undefined;
	content.scope.retireContext();
	assert.equal(timeline.available, false); assert.equal(timeline.visible, false);
	assert.equal(timeline.requested, true);
	assert.equal(inputFocus.target, content);
});

for (const retirement of ['attachment', 'transport'] as const) test(`Timeline commits ${retirement} retirement before focus return activates another client`, async t => {
	const f = await fixture(t), { timeline, content, transport, interaction } = f;
	const next = inputFocus.createTarget(); next.bindKeyboard(() => {});
	const replacement = { target: next, interaction: new InputInteraction(transport) };
	next.scope.runtime = replacement;
	const unbind = content.onDidFocus(() => timeline.setContext(replacement));
	t.after(unbind);
	timeline.focus();
	if (retirement === 'attachment') timeline.setContext(undefined);
	else interaction.setRuntime(null);
	assert.equal(timeline.available, true); assert.equal(timeline.visible, true);
	assert.ok(timeline.focusScope.runtime === replacement, 'the activated client owns the final attachment after focus callbacks return');
	interaction.running = true;
	assert.ok(timeline.focusScope.runtime === replacement, 'retired client notifications cannot rewrite the new attachment');
});
