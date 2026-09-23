import { runtimeErrorState } from '../../../ide/editor/contrib/runtime_error/state';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../../machine/ts/spec/bmsx/io';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { HistoryMode } from '../../../machine/ts/machine/runtime/history/history';
import { check, type StudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { testCapturedSourceApply } from './studio_source_workflows';

/** Real workbench/model/BIOS lifecycle evidence; not a UI-only authoring test. */
export async function runStudioExecutionOperations(test: StudioFixture) {
	const { runtime, ide, execution, tasks, history, harness, observations,
		frame, until, press, runMenuCommand, cycles, title } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'operations: boot real cartridge');
	await reachNemesisTitle(test);
	harness.openLuaSource('title_screen.lua');
	await frame();
	await runMenuCommand('pause');
	const model = harness.getActiveEditorDocument().model;
	const source = model.buffer.getText();
	const actor = title(), media = ide.sources.currentBlua32Media, position = cycles();
	harness.replaceActiveCodeSource(source + '\nend end\n');
	const rejected = harness.performHotResume();
	check((await rejected.admission).status === 'not-admitted', 'operations: failed build is not admitted');
	const rejection = await rejected.completion;
	check(rejection.status === 'rejected' && rejection.phase === 'build' && !rejection.applied,
		'operations: authored compile rejection has an explicit unapplied outcome');
	await frame();
	check(tasks.ready && cycles() === position && ide.sources.currentBlua32Media === media
		&& ide.fault.lastLuaCallStack.length === 0 && execution.userPaused && ide.editor.isActive,
		'operations: compile rejection preserves installed execution and editor, not a guest fault');
	await test.capture?.('build-rejected');

	const initLine = source.split('\tfsm_library.register(')[0].split('\n').length;
	harness.toggleLuaBreakpoint('title_screen.lua', initLine);
	harness.replaceActiveCodeSource(source + '\n-- first admitted init\n');
	const first = harness.performHotResume();
	check((await first.admission).status === 'accepted', 'operations: first init admitted');
	await until(() => ide.debugger.stopped && first.applied && ide.editor.isActive, 'operations: actual init breakpoint');
	check(first.status === 'initializing' && first.result === null && runtime.completionCallPending()
		&& history.mode === HistoryMode.Disabled && title() === actor, 'operations: breakpoint is pending, not completion');
	await until(() => harness.getActiveCodeContext()!.executionStopRow === initLine - 1, 'operations: breakpoint navigation finishes');
	await frame();
	check(editorFeedbackState.message.text !== 'Hot Resume: code applied', 'pending init cannot display stale success');
	await test.capture?.('init-pending');
	harness.replaceActiveCodeSource(source + '\n-- nested admitted init\n');
	const nested = harness.performHotResume();
	await nested.admission;
	await until(() => ide.debugger.stopped && nested.applied && ide.editor.isActive, 'operations: nested init breakpoint');
	check(first.result === null && nested.result === null, 'operations: both init requests remain independently pending');
	harness.toggleLuaBreakpoint('title_screen.lua', initLine);
	await press('F5');
	await until(() => first.result !== null && nested.result !== null, 'operations: both physical init batches return');
	check((await first.completion).status === 'completed' && (await nested.completion).status === 'completed'
		&& !ide.debugger.plans.mutationActive && title() === actor, 'operations: nested completion does not reboot the actor');

	harness.openLuaSource('title_screen.lua');
	await frame();
	await runMenuCommand('pause');
	const faultSource = source.replace('local define_fsm<const> = function()',
		"local define_fsm<const> = function()\n\tif fsm_library ~= nil then error('operation init fault') end");
	check(faultSource !== source, 'operations: real init edit point');
	harness.replaceActiveCodeSource(faultSource);
	observations.expectedFaultSequence = 1;
	const faulted = harness.performHotResume();
	await faulted.admission;
	await until(() => runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === 1
		&& faulted.result !== null && ide.fault.lastLuaCallStack.length !== 0, 'operations: physical init fault');
	const faultResult = await faulted.completion;
	if (faultResult.status !== 'faulted') throw new Error(`Expected physical fault, got ${faultResult.status}`);
	check(faultResult.applied && faultResult.sequence === 1,
		'operations: installed code plus guest failure, never a success toast');
	check(runtime.completionCallPending() && ide.debugger.plans.mutationActive, 'operations: fault retains real recovery roots');
	check(editorFeedbackState.message.text === 'Hot Resume: guest fault', 'guest failure replaces prior success feedback');
	await press('ControlRight', 'ShiftRight');
	await until(() => runtimeErrorState.activeOverlay !== null, 'operations: physical fault navigation finishes');
	await frame();
	check(editorFeedbackState.message.text !== 'Hot Resume: code applied', 'physical fault presentation cannot retain stale success');
	await test.capture?.('init-faulted');
	harness.replaceActiveCodeSource(source);
	const replaced = harness.performHotResume();
	const deferred = await replaced.admission;
	check(deferred.status === 'accepted' && deferred.mode === 'deferred'
		&& replaced.status === 'waiting-for-user' && !replaced.applied && replaced.result === null,
		'operations: queued BIOS return is not installed code');
	const repaired = harness.performHotResume();
	await repaired.admission;
	const discarded = await replaced.completion;
	check(discarded.status === 'cancelled' && discarded.reason === 'plan-discarded' && !discarded.applied,
		'operations: replaced supervisor plan retires its original request');
	await until(() => repaired.result !== null && tasks.ready, 'operations: supervisor return, install and init all finish');
	check((await repaired.completion).status === 'completed' && repaired.applied && title() === actor,
		'operations: actual recovery reports completion without replacing the actor');
	check(faulted.result === faultResult && ide.fault.lastLuaCallStack.length === 0,
		'operations: recovery clears inspection but cannot rewrite the older failed outcome');
	check(editorFeedbackState.message.text === 'Hot Resume: code applied', 'operations: completion drives ordinary UI feedback');
	harness.openLuaSource('title_screen.lua');
	await frame();
	await runMenuCommand('pause');
	await testCapturedSourceApply(test);
	await frame();
	await test.capture?.('captured-source-applied');

	// Fail the second exclusive task, after actual firmware has returned, rather
	// than just failing the initial source-build admission's readback fence.
	harness.replaceActiveCodeSource(faultSource);
	observations.expectedFaultSequence = 2;
	const secondFault = harness.performHotResume();
	await secondFault.admission;
	await until(() => secondFault.result !== null && runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === 2,
		'operations: second physical fault for deferred-install lifetime');
	harness.openLuaSource('title_screen.lua');
	harness.replaceActiveCodeSource(source);
	const failingInstall = harness.performHotResume();
	const installAdmission = await failingInstall.admission;
	check(installAdmission.status === 'accepted' && installAdmission.mode === 'deferred', 'operations: installation really deferred');
	const faultMedia = ide.sources.currentBlua32Media;
	// The queue owner already provides the fence; access its actual presenter
	// through the fixture so no substitute scheduler or backend is introduced.
	const finishReadbacks = test.presenter.backend.finishGxGpuReadbacks.bind(test.presenter.backend);
	test.presenter.backend.finishGxGpuReadbacks = async () => { throw new Error('deferred installation readback failure'); };
	await until(() => failingInstall.result !== null, 'operations: deferred installation failure settles original request');
	test.presenter.backend.finishGxGpuReadbacks = finishReadbacks;
	const failed = await failingInstall.completion;
	check(failed.status === 'failed' && !failed.applied && !tasks.ready && ide.sources.currentBlua32Media === faultMedia,
		'operations: runtime failure after admission is not installed code or success');

	// The physical reset callback cancels queued work, including when a former
	// runtime failure holds ordinary execution. No second reset API is invented.
	const cancelled = harness.performHotResume();
	runtime.rebootSystem();
	observations.expectedFaultSequence = 0;
	const cancellation = await cancelled.completion;
	check(cancellation.status === 'cancelled' && cancellation.reason === 'machine-reset' && !cancellation.applied,
		'operations: real machine reset retires queued source installation');
	check((await cancelled.admission).status === 'not-admitted', 'operations: retired request cannot publish into reset machine');
	await frame();
	return { hostFrames: observations.hostFrames, nested: 'completed', faultSequence: faultResult.sequence,
		deferred: 'completed', deferredFailure: failed.status, reset: cancellation.status };
}
