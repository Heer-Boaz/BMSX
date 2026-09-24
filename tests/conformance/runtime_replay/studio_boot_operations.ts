import { check, type StudioFixture } from './studio_fixture';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { resolveRuntimeResource } from '../../../ide/runtime/sources';
import { runtimeErrorState } from '../../../ide/editor/contrib/runtime_error/state';
import { reachNemesisTitle } from './studio_nemesis_navigation';

/** Actual commands, firmware and debugger; automated evidence, not UI-only authoring. */
export async function runStudioBootOperations(test: StudioFixture) {
	const { runtime, ide, execution, tasks, harness, frame, until, press, runMenuCommand, cycles, title } = test;
	check(execution.launchPending, 'boot: rejected startup sources retain the launch hold');
	const startup = ide.boots.latestOperation!;
	const initial = await startup.completion;
	check(initial.status === 'rejected' && initial.reset && !initial.installed && ide.editor.isActive,
		'boot: source rejection has explicit evidence and an inspectable, held machine');
	const resource = resolveRuntimeResource(ide.sources, { domain: 0, path: 'title_screen.lua' })!;
	await ide.editor.navigation.openResource(resource);
	await frame();
	await test.capture?.('startup-rejected');
	await press('ControlRight', 'ShiftRight');
	check(!ide.editor.isActive, 'boot: ordinary shortcut hides the editor after source rejection');
	const held = cycles();
	for (let count = 0; count < 5; count++) await frame();
	check(cycles() === held && !harness.isCartActive() && execution.launchPending,
		'boot: hiding the editor cannot execute packed code instead of rejected source');
	await press('ControlRight', 'ShiftRight');
	await ide.editor.navigation.openResource(resource);
	const model = harness.getActiveEditorDocument().model;
	const source = model.buffer.getText().replace('\nend end -- rejected startup source\n', '');
	check(source !== model.buffer.getText(), 'boot: startup loaded the deliberately invalid project file');
	harness.replaceActiveCodeSource(source);
	await runMenuCommand('reboot');
	check(actionPromptState.prompt?.request.action === 'reboot', 'boot: source repair enters the normal Save/Reboot prompt');
	await press('Enter');
	await until(() => ide.boots.latestOperation !== startup && ide.boots.latestOperation!.result !== null && tasks.ready,
		'boot: accepted repair completes the actual reset');
	const repaired = ide.boots.latestOperation!;
	check((await repaired.completion).status === 'reset' && !execution.launchPending && !ide.editor.isActive,
		'boot: actual reset releases startup hold and command returns to execution');
	check(model.lastSavedSource === source, 'boot: Save/Reboot saved the accepted repair');
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'boot: repaired source executes through real BIOS');
	await reachNemesisTitle(test);

	harness.openLuaSource('title_screen.lua');
	await frame();
	await runMenuCommand('pause');
	const actor = title();
	const initLine = source.split('\tfsm_library.register(')[0].split('\n').length;
	ide.debugger.breakpoints.toggle(model.resource, initLine);
	const initializer = harness.performHotResume();
	await initializer.admission;
	await until(() => ide.debugger.stopped && ide.editor.isActive, 'boot: real init breakpoint before Reboot rejection');
	const media = ide.sources.currentBlua32Media, stopped = cycles();
	harness.replaceActiveCodeSource(source + '\nend end\n');
	const rejected = harness.reboot();
	check((await rejected.completion).status === 'rejected', 'boot: compile rejection is an operation result');
	await tasks.join();
	check(ide.debugger.stopped && initializer.result === null && title() === actor && cycles() === stopped
		&& ide.sources.currentBlua32Media === media && tasks.ready && ide.editor.isActive,
		'boot: rejected Reboot preserves the actual stop, pending init, actor and installed media');
	await frame();
	await test.capture?.('reboot-rejected');

	let release!: () => void;
	void tasks.schedule(() => new Promise<void>(resolve => { release = resolve; }), error => { throw error; });
	harness.replaceActiveCodeSource(source + '\n-- superseded reboot\n');
	const first = harness.reboot();
	harness.replaceActiveCodeSource(source + '\n-- captured reboot\n');
	const captured = model.buffer.getText();
	const latest = harness.reboot();
	harness.replaceActiveCodeSource(captured + '-- later typing\n');
	const superseded = await first.completion;
	check(superseded.status === 'cancelled' && superseded.reason === 'superseded' && !superseded.reset,
		'boot: a newer request retires older queued preparation');
	await frame();
	check(latest.status === 'queued' && cycles() === stopped && editorFeedbackState.message.text === 'Reboot: pending',
		'boot: queue admission is neither reset nor a stale failure toast');
	release();
	const applied = await latest.completion;
	await tasks.join();
	check(applied.status === 'reset' && applied.installed && applied.reset && cycles() === 0 && !harness.isCartActive(),
		'boot: reset acknowledgement precedes all BIOS and cartridge execution');
	check(ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('title_screen') === captured && model.dirty,
		'boot: only the admitted revision is installed; later edits remain authored and unsaved');
	check((await initializer.completion).status === 'cancelled' && !ide.debugger.plans.mutationActive && !ide.debugger.stopped
		&& runtimeErrorState.activeOverlay === null, 'boot: accepted reset retires real init work and stale debugger/error projections');
	ide.debugger.breakpoints.toggle(model.resource, initLine);
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'boot: captured source executes after reset');
	await reachNemesisTitle(test);
	harness.openLuaSource('title_screen.lua');
	await frame();
	await runMenuCommand('pause');
	await test.capture?.('captured-reboot');

	await press('ControlRight', 'ShiftRight');
	check(!ide.editor.isActive && execution.userPaused, 'boot: hiding the editor retains requested pause');
	await press('ControlRight', 'AltRight');
	await press('ArrowUp'); // Wrap to Exit Game.
	await press('ArrowUp'); // Reboot Cart.
	await test.capture?.('quick-menu-reboot');
	await press('KeyX');
	const menuReboot = ide.boots.latestOperation!;
	check(menuReboot !== latest && (await menuReboot.completion).status === 'reset',
		'boot: actual quick-menu input uses the same operation owner');
	await tasks.join();
	check(!execution.userPaused && !ide.editor.isActive && !execution.launchPending,
		'boot: quick-menu Reboot explicitly resumes after reset, including from requested pause');
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'boot: quick-menu Reboot executes through real BIOS');
	await reachNemesisTitle(test);
	harness.openLuaSource('title_screen.lua');
	await frame();
	await runMenuCommand('pause');

	const finishReadbacks = test.presenter.backend.finishGxGpuReadbacks.bind(test.presenter.backend);
	test.presenter.backend.finishGxGpuReadbacks = async () => { throw new Error('boot readback failure'); };
	const beforeFailure = ide.sources.currentBlua32Media;
	const failed = harness.reboot();
	const failure = await failed.completion;
	await tasks.join();
	check(failure.status === 'failed' && failure.phase === 'queued' && !failure.reset && !failure.installed
		&& !tasks.ready && ide.sources.currentBlua32Media === beforeFailure,
		'boot: readback failure never reports a reset or manufactures a guest fault');
	test.presenter.backend.finishGxGpuReadbacks = finishReadbacks;
	await frame();
	await test.capture?.('readback-failed');

	void tasks.schedule(() => new Promise<void>(resolve => { release = resolve; }), error => { throw error; });
	const cancelled = harness.reboot();
	await frame();
	runtime.rebootSystem();
	const cancelledResult = await cancelled.completion;
	check(cancelledResult.status === 'cancelled' && cancelledResult.reason === 'machine-reset' && !cancelledResult.reset,
		'boot: an external physical reset cancels the queued request');
	check(ide.boots.latestOperation === null, 'boot: retired callbacks cannot present into the new machine');
	release();
	await tasks.join();
	check(ide.sources.currentBlua32Media === beforeFailure, 'boot: cancelled source never installs after external reset');

	void tasks.schedule(() => new Promise<void>(resolve => { release = resolve; }), error => { throw error; });
	const abandoned = harness.reboot();
	await frame();
	let shutdownCompleted = false;
	const shutdown = ide.editor.shutdown().then(() => { shutdownCompleted = true; });
	const abandonedResult = await abandoned.completion;
	check(abandonedResult.status === 'cancelled' && abandonedResult.reason === 'shutdown' && !shutdownCompleted,
		'boot: shutdown cancels requests immediately but joins admitted queue work');
	check(!ide.editor.commands.isEnabled('reboot'), 'boot: closed workbench no longer admits Reboot');
	check(!await ide.editor.commands.executeConfirmedAction({ action: 'reboot' }, [], false)
		&& ide.boots.latestOperation === null, 'boot: a late confirmation cannot re-admit work after shutdown');
	release();
	await shutdown;
	check(ide.sources.currentBlua32Media === beforeFailure && !ide.editor.isActive && ide.boots.latestOperation === null,
		'boot: drained requests cannot install code or reactivate the closed editor');
	return { hostFrames: test.observations.hostFrames, startup: initial.status, repair: 'executed',
		queued: superseded.status, reset: applied.status, menu: menuReboot.result!.status,
		infrastructure: failure.status, shutdown: abandonedResult.status };
}
