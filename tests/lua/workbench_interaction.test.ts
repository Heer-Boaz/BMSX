import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HostExecutionIntent, HostPauseReason } from '../../hosts/common/execution_control';
import { InputFocusScope, InputFocusService } from '../../ide/input/focus';
import { InputInteraction } from '../../ide/input/interaction';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { RuntimeTransport } from '../../ide/runtime/transport';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchInteraction } from '../../ide/workbench/services/execution/interaction';
import { createFrameRuntime } from '../helpers/frame_runtime';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext) {
	const physical = () => {
		const runtime = createFrameRuntime();
		const state = createRuntimeInspectionFixture(runtime, createScenarioTestSourceState([]));
		const transport = new RuntimeTransport(runtime, state.execution, state.rewind, state.frameNavigation, () => state.tasks.ready);
		return { ...state, transport };
	};
	const primary = physical(), secondary = physical(), focus = new InputFocusService();
	const owner = new WorkbenchInteraction(focus, primary.transport);
	const client = (interaction: InputInteraction | null) => {
		const scope = new InputFocusScope(Symbol('client'), focus.workbenchScope);
		scope.interaction = interaction;
		const target = focus.createTarget(null, scope);
		if (interaction !== null && interaction.transport !== null) scope.runtime = { target, interaction };
		return target;
	};
	t.after(() => {
		owner.dispose(); focus.setTarget(null);
		for (const state of [primary, secondary]) {
			state.transport.retire(); state.debuggerExecution.dispose(); state.frameNavigation.dispose(); state.presenter.dispose();
		}
	});
	return { owner, focus, primary, secondary, client };
}

test('authoring holds the primary and mode events update its hold synchronously without another activation or paint', t => {
	const f = fixture(t), interaction = new InputInteraction(), authoring = f.client(interaction);
	f.owner.setActive(true); authoring.focus();
	assert.equal(f.primary.execution.paused, true);
	assert.equal(f.primary.execution.userPaused, false);
	assert.equal(f.secondary.execution.paused, false);
	const activation = f.focus.interactionRevision, revision = f.primary.execution.revision;
	interaction.setRuntime(f.primary.transport);
	assert.equal(f.primary.execution.paused, true, 'attaching a target does not restore follow intent');
	interaction.running = true;
	assert.equal(f.primary.execution.paused, false);
	interaction.running = false;
	assert.equal(f.primary.execution.paused, true);
	interaction.running = true;
	interaction.setRuntime(null);
	assert.equal(f.primary.execution.paused, true);
	assert.ok(f.focus.target === authoring);
	assert.equal(f.focus.interactionRevision, activation);
	assert.equal(f.primary.execution.revision, revision, 'automatic holds are not explicit execution requests');
});

test('secondary live follow never releases the primary and a stopped inspector holds exactly its own target too', t => {
	const f = fixture(t), interaction = new InputInteraction(f.secondary.transport, true), inspector = f.client(interaction);
	f.owner.setActive(true); inspector.focus();
	assert.equal(f.primary.execution.paused, true);
	assert.equal(f.secondary.execution.paused, false);
	interaction.running = false;
	assert.equal(f.primary.execution.paused, true);
	assert.equal(f.secondary.execution.paused, true);
	assert.equal(f.secondary.execution.executionBlocked(HostExecutionIntent.Workbench), false);
	interaction.running = true;
	assert.equal(f.primary.execution.paused, true);
	assert.equal(f.secondary.execution.paused, false);
});

test('deactivation releases only automatic holds and preserves explicit and external pause reasons', t => {
	const f = fixture(t), interaction = new InputInteraction(f.secondary.transport), inspector = f.client(interaction);
	f.owner.setActive(true); inspector.focus();
	const reasons = [HostPauseReason.Requested, HostPauseReason.HostSuspended, HostPauseReason.Fullscreen,
		HostPauseReason.AwaitingLaunch, HostPauseReason.VibrationInitialization];
	for (const state of [f.primary, f.secondary]) for (const reason of reasons) state.execution.setPauseReason(reason, true);
	const revisions = [f.primary.execution.revision, f.secondary.execution.revision];
	f.owner.setActive(false);
	for (const state of [f.primary, f.secondary]) {
		assert.equal(state.execution.paused, true);
		assert.equal(state.execution.userPaused, true);
		assert.equal(state.execution.launchPending, true);
		assert.equal(state.execution.vibrationInitializationActive, true);
		assert.equal(state.execution.frameStepBlocked, true);
	}
	assert.deepEqual([f.primary.execution.revision, f.secondary.execution.revision], revisions);
	interaction.running = true; inspector.activate();
	for (const state of [f.primary, f.secondary]) {
		for (const reason of reasons) state.execution.setPauseReason(reason, false);
		assert.equal(state.execution.paused, false, 'neither target retains the automatic hold after closing the workbench');
	}
});

test('deactivation leaves the real source debugger stop and pending frame-step ownership intact', t => {
	const f = fixture(t), authoring = f.client(new InputInteraction()), source = f.primary.debuggerState.source;
	const cpu = f.primary.runtime.machine.cpu, pc = cpu.readFramePc(cpu.getFrameDepth() - 1);
	source.install(f.primary.sources.currentBlua32Media, [new Map([[pc, 0]]), new Map(), new Map()]);
	assert.equal(source.shouldStop(-1, pc), true);
	const stop = source.stop;
	f.secondary.execution.requestFrameStep();
	f.owner.setActive(true); authoring.focus();
	f.owner.setActive(false);
	assert.ok(source.stop === stop);
	assert.equal(f.secondary.execution.frameStepPending, true);
	assert.equal(f.secondary.execution.userPaused, true);
	assert.equal(f.primary.execution.paused, false, 'the debugger retains its own stop rather than a synthetic pause reason');
});

test('retiring an attachment removes its target hold and old mode listeners without falling back to the workspace runtime', t => {
	const f = fixture(t), interaction = new InputInteraction(f.secondary.transport), inspector = f.client(interaction);
	f.focus.workbenchScope.runtime = f.client(new InputInteraction(f.primary.transport, true)).scope.runtime;
	f.owner.setActive(true); inspector.focus();
	assert.equal(f.secondary.execution.paused, true);
	inspector.scope.retireContext();
	inspector.scope.interaction = undefined; inspector.scope.runtime = undefined;
	assert.equal(f.secondary.execution.paused, false);
	assert.equal(f.primary.execution.paused, true);
	interaction.setRuntime(f.primary.transport, true);
	assert.equal(f.primary.execution.paused, true, 'retired attachment events cannot select or release the workspace target');
});

test('retiring a physical target revokes its context without redirecting local runtime actions to the primary', t => {
	const f = fixture(t), interaction = new InputInteraction(f.secondary.transport), inspector = f.client(interaction);
	f.focus.workbenchScope.runtime = f.client(new InputInteraction(f.primary.transport, true)).scope.runtime;
	f.owner.setActive(true); inspector.focus();
	const revision = f.primary.execution.revision;
	f.secondary.transport.retire();
	assert.equal(f.secondary.transport.available, false);
	assert.equal(f.primary.execution.paused, true);
	interaction.running = true;
	f.owner.activateRuntime(inspector);
	assert.equal(f.primary.execution.paused, true);
	assert.ok(inspector.scope.runtime!.interaction === interaction);
	assert.ok(interaction.transport === f.secondary.transport);
	assert.equal(f.primary.execution.revision, revision);
	// A rejected action cannot subscribe the retired binding for a later target change.
	interaction.setRuntime(f.primary.transport, true);
	assert.equal(f.primary.execution.paused, true);
	// Retired execution is closed by its physical owner, not modified by UI policy.
});

test('chrome retains the activated client but does not retain that client after its attachment retires', t => {
	const f = fixture(t), interaction = new InputInteraction(f.primary.transport, true), runtime = f.client(interaction), chrome = f.client(null);
	f.owner.setActive(true); runtime.focus();
	assert.equal(f.primary.execution.paused, false);
	chrome.focus();
	assert.equal(f.primary.execution.paused, false);
	interaction.running = false;
	assert.equal(f.primary.execution.paused, true);
	interaction.running = true;
	assert.equal(f.primary.execution.paused, false);
	runtime.scope.retireContext(); runtime.scope.interaction = undefined; runtime.scope.runtime = undefined;
	assert.equal(f.primary.execution.paused, true);
	interaction.running = false; interaction.running = true;
	assert.equal(f.primary.execution.paused, true);
	assert.ok(f.focus.target === chrome);
});

test('a real popup borrows its actual invocation interaction rather than its unrelated command context or guest input', t => {
	const f = fixture(t), interaction = new InputInteraction(f.primary.transport, true), invokingViewport = f.client(interaction), authoring = f.client(new InputInteraction());
	invokingViewport.guestInput = { bounds: { left: 0, top: 0, right: 4, bottom: 3 }, recipient: f.primary.input,
		presentation: { kind: 'direct', presenter: f.primary.presenter } };
	const menu = new ContextMenuController(f.focus, new PointerCaptureService(), { left: 0, top: 0, right: 384, bottom: 288 });
	t.after(() => menu.dispose());
	f.owner.setActive(true); authoring.focus();
	assert.equal(f.primary.execution.paused, true);
	menu.show(0, 0, [{ type: 'command', command: 'undo' }], { isEnabled: () => true, execute() {} }, {
		invocationOrigin: invokingViewport, commandTarget: authoring, returnFocus: authoring,
	});
	assert.ok(f.focus.target === menu.focusTarget);
	assert.ok(menu.focusTarget.commandContext === authoring);
	assert.ok(menu.focusTarget.scope.interactionOrigin === invokingViewport.scope);
	assert.equal(menu.focusTarget.guestInput, undefined);
	assert.equal(f.primary.execution.paused, false);
	interaction.running = false;
	assert.equal(f.primary.execution.paused, true);
	interaction.running = true;
	assert.equal(f.primary.execution.paused, false);
	menu.hide();
	assert.ok(f.focus.target === authoring);
	assert.equal(f.primary.execution.paused, true);
});

test('a newer client activation supersedes old context, scope and transport subscriptions', t => {
	const f = fixture(t), previous = new InputInteraction(f.secondary.transport), previousClient = f.client(previous);
	const current = new InputInteraction(f.primary.transport, true), currentClient = f.client(current);
	f.owner.setActive(true); previousClient.focus();
	assert.equal(f.secondary.execution.paused, true);
	currentClient.focus();
	assert.equal(f.secondary.execution.paused, false);
	assert.equal(f.primary.execution.paused, false);
	previous.running = true; previous.running = false;
	previousClient.scope.retireContext();
	f.secondary.transport.retire();
	assert.equal(f.primary.execution.paused, false);
	assert.ok(f.focus.target === currentClient);
	current.running = false;
	assert.equal(f.primary.execution.paused, true);
});

test('explicit runtime actions activate their local subject without stealing an authored field keyboard focus', t => {
	const f = fixture(t), authoring = f.client(new InputInteraction()), toolbar = f.client(null);
	const interaction = new InputInteraction(f.secondary.transport);
	toolbar.scope.runtime = { target: toolbar, interaction };
	f.owner.setActive(true); authoring.focus();
	assert.equal(f.secondary.execution.paused, false);
	f.owner.activateRuntime(toolbar);
	assert.ok(f.focus.target === authoring);
	assert.equal(f.primary.execution.paused, true);
	assert.equal(f.secondary.execution.paused, true);
	interaction.running = true;
	assert.equal(f.secondary.execution.paused, false);
	assert.ok(f.focus.target === authoring);
});

test('repeated authoring activation and unchanged follow intent publish no redundant host hold writes', t => {
	const f = fixture(t), interaction = new InputInteraction(), authoring = f.client(interaction);
	const writes = t.mock.method(f.primary.execution, 'setPauseReason');
	f.owner.setActive(true); authoring.focus();
	for (let activation = 0; activation < 1000; activation++) {
		authoring.activate(); interaction.running = false; f.owner.setActive(true);
	}
	assert.deepEqual(writes.mock.calls.map(call => call.arguments), [[HostPauseReason.Workbench, true]]);
	interaction.setRuntime(f.primary.transport);
	interaction.running = true;
	for (let activation = 0; activation < 1000; activation++) {
		authoring.activate(); interaction.running = true;
	}
	assert.deepEqual(writes.mock.calls.map(call => call.arguments), [
		[HostPauseReason.Workbench, true], [HostPauseReason.Workbench, false],
	]);
	assert.equal(f.primary.execution.paused, false);
});
