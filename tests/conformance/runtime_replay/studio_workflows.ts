import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getCodeTabContexts } from '../../../ide/workbench/ui/code_tab/contexts';
import { runtimeErrorState } from '../../../ide/editor/contrib/runtime_error/state';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { TOP_BAR_MENUS } from '../../../ide/workbench/ui/top_bar/menu';
import { hoverState } from '../../../ide/editor/contrib/hover/state';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { HistoryMode } from '../../../machine/ts/machine/runtime/history/history';
import { IO_INP_KEYS, IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { HostPauseReason } from '../../../hosts/common/execution_control';
import { hidKeyUsageForCode } from '../../../hosts/common/input/hid_keys';
import { check, type StudioFixture } from './studio_fixture';

/** The same developer loop runs on every renderer, without backend-specific tests. */
export async function runStudioWorkflows(test: StudioFixture) {
	const { runtime, ide, execution, rewind, tasks, history, harness, guest, clock, input, observations,
		frame, until, setKey, press, click, runMenuCommand, settle, cycles, title } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13 && !rewind.seeking, 'boot into real cart');
	await press('Space');
	await press('Space');
	await until(() => guest.readStringMember(title(), 'visible') === true, 'title visible');
	for (const key of ['F5', 'F6']) {
		const usage = hidKeyUsageForCode(key);
		const address = IO_INP_KEYS + (usage >>> 5) * IO_WORD_SIZE;
		const mask = 1 << (usage & 31);
		check(!input.shouldCaptureKey(key), `${key} is not reserved by Studio during gameplay`);
		setKey(key, true);
		await frame();
		check(!execution.userPaused && !ide.editor.isActive, `${key} must not invoke host execution commands`);
		check(!input.getPlayerInput(1).inputHandlers.keyboard.getKeyState(key).consumed, `${key} is not consumed by Studio`);
		await until(() => (runtime.machine.memory.readIoU32(address) & mask) !== 0, `${key} reaches the real cart's ICU keyboard register`);
		for (let index = 0; index < 4; index += 1) await frame();
		check(!execution.userPaused && !ide.editor.isActive, `holding ${key} does not toggle host execution`);
		setKey(key, false);
		await until(() => (runtime.machine.memory.readIoU32(address) & mask) === 0, `${key} release reaches the real ICU`);
	}
	await until(() => cycles() > runtime.timing.cpuHz * 22 && tasks.ready, 'continuous history wraps');
	await press('ControlRight', 'AltRight');
	for (let index = 0; index < 3; index += 1) await press('ArrowUp');
	await press('KeyX');
	await press('ShiftLeft');
	await settle();
	check(history.mode === HistoryMode.Reviewing, 'real timeline selects history');
	const seekPosition = cycles();
	const recordedEnd = history.latestCycles;
	await press('KeyX');
	check(rewind.playing, 'A starts recorded playback inside the timeline');
	for (let index = 0; index < 7; index += 1) await frame();
	await press('KeyX');
	let selected = cycles();
	check(!rewind.playing && selected > seekPosition && selected < recordedEnd,
		'A pauses at the actual playback position, without takeover');
	check(history.latestCycles === recordedEnd, 'watching history retains its future');
	await press('KeyX');
	await frame();
	await press('ControlRight', 'ShiftRight');
	selected = cycles();
	check(ide.editor.isActive && !rewind.playing, 'W02: IDE opening pauses an actively playing timeline at its current position');
	await runMenuCommand('pause');
	check(execution.paused, 'W02: host pause must retain the selected position independently of rewind');
	for (let index = 0; index < 5; index += 1) await frame();
	check(cycles() === selected, 'opening IDE must not replay or return to the present');
	check(observations.suspended, 'paused Studio suppresses audio transport');
	// Source-only typing preserves both machine state and rewind history.
	harness.openLuaSource('title_screen.lua');
	const model = harness.getActiveEditorDocument().model;
	const source = model.buffer.getText();
	const originalRule = "pattern = 'up[jp] || down[jp] || left[jp] || right[jp]'";
	check(source.includes(originalRule), 'actual title FSM input rule');
	const actorBefore = title();
	const countBefore = guest.readStringMember(actorBefore, 'selected_player_count');
	const newRule = "pattern = 'right[jp]'";
	harness.replaceActiveCodeSource(source.replace(originalRule, newRule));
	check(cycles() === selected && history.mode === HistoryMode.Reviewing, 'typing does not mutate runtime');
	const oldMedia = ide.sources.currentBlua32Media;
	await press('ControlLeft', 'ShiftLeft', 'KeyS');
	check(actionPromptState.prompt?.action === 'hot-resume', 'real command opens dirty-source prompt');
	await press('Enter');
	await until(() => tasks.ready && ide.sources.currentBlua32Media !== oldMedia && !ide.debugger.plans.controlActive,
		'Hot Resume installs edited source through product commands');
	await until(() => !runtime.completionCallPending() && !rewind.active && history.checkpointCount !== 0 && tasks.ready, 'init completes on retained continuation');
	check(!execution.userPaused && !ide.editor.isActive, 'explicit Hot Resume releases only user pause and editor focus');
	check(title() === actorBefore, 'Hot Resume retains actor identity, not a cold-boot replacement');
	check(guest.readStringMember(title(), 'selected_player_count') === countBefore, 'init rebind keeps live FSM state');
	check(history.earliestCycles >= selected && history.latestCycles < selected + runtime.timing.cpuHz,
		'new history begins at retained execution, without returning to old present');
	await press('ArrowDown');
	for (let index = 0; index < 5; index += 1) await frame();
	check(guest.readStringMember(title(), 'selected_player_count') === countBefore, 'old FSM input rule no longer fires');
	await press('ArrowRight');
	await until(() => guest.readStringMember(title(), 'selected_player_count') !== countBefore,
		'edited FSM rule fires on the retained actor');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	const pausedAt = cycles();
	const pausedAudio = observations.audioFrames;
	for (let index = 0; index < 5; index += 1) await frame();
	await press('ControlRight', 'ShiftRight');
	for (let index = 0; index < 5; index += 1) await frame();
	check(cycles() === pausedAt && observations.audioFrames === pausedAudio && !ide.editor.isActive,
		'W01: hiding IDE is not Continue; explicit pause works without active rewind');
	await press('F5');
	await press('F6');
	check(execution.userPaused && cycles() === pausedAt && !ide.editor.isActive,
		'F5/F6 in the game view cannot release host pause or open the IDE');
	check(!input.shouldCaptureKey('F5') && !input.shouldCaptureKey('F6'), 'closing the IDE releases its keyboard capture');
	execution.setPauseReason(HostPauseReason.Fullscreen, true);
	execution.setPauseReason(HostPauseReason.VibrationInitialization, true);
	execution.setPauseReason(HostPauseReason.Fullscreen, false);
	execution.setPauseReason(HostPauseReason.VibrationInitialization, false);
	await frame();
	check(execution.userPaused && cycles() === pausedAt && observations.suspended, 'ending other pause reasons cannot release user pause');
	execution.setPauseReason(HostPauseReason.Fullscreen, true);
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	check(!execution.userPaused && execution.paused && cycles() === pausedAt && observations.suspended,
		'pause toggle releases only its own reason, not a pending fullscreen operation');
	execution.setPauseReason(HostPauseReason.Fullscreen, false);
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	clock.advance(600_000);
	await runMenuCommand('pause');
	check(cycles() - pausedAt <= runtime.timing.cycleBudgetPerFrame * 2, 'Continue does not charge paused wall time');
	await until(() => cycles() > pausedAt, 'Continue resumes without a rewind-specific action');
	// A second edit starts from the first iteration's retained state/history.
	await until(() => cycles() > pausedAt + runtime.timing.cpuHz * 2 && tasks.ready, 'record new execution');
	await press('ControlRight', 'AltRight');
	for (let index = 0; index < 3; index += 1) await press('ArrowUp');
	await press('KeyX');
	await press('ShiftLeft');
	await settle();
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	const secondAt = cycles();
	const secondActor = title();
	harness.openLuaSource('title_screen.lua');
	harness.replaceActiveCodeSource(source.replace(originalRule, "pattern = 'left[jp]'"));
	await press('ControlLeft', 'ShiftLeft', 'KeyS');
	await press('Enter');
	await until(() => tasks.ready && !ide.debugger.plans.controlActive && !runtime.completionCallPending()
		&& !ide.editor.isActive && !rewind.active && history.checkpointCount !== 0, 'second Hot Resume finishes');
	check(title() === secondActor && history.earliestCycles >= secondAt, 'second iteration keeps selected actor and forks history');
	const countAtSecond = guest.readStringMember(title(), 'selected_player_count');
	await press('ArrowRight');
	for (let index = 0; index < 5; index += 1) await frame();
	check(guest.readStringMember(title(), 'selected_player_count') === countAtSecond, 'superseded rule no longer fires');
	await press('ArrowLeft');
	await until(() => guest.readStringMember(title(), 'selected_player_count') !== countAtSecond, 'second rule fires');

	// Breakpoint -> inspection -> explicit step while the independent pause stays set.
	const breakpointLine = source.split('\tif self.selected_player_count == 1 then')[0].split('\n').length;
	harness.toggleLuaBreakpoint('title_screen.lua', breakpointLine);
	await press('ArrowLeft');
	await until(() => ide.debugger.stopped && ide.editor.isActive, 'W03: source breakpoint opens the real editor');
	const stopPc = ide.debugger.stopPc;
	const inspected = harness.getHover(breakpointLine - 1, 12);
	check(inspected !== null, 'current debugger stop can be inspected');
	await runMenuCommand('pause');
	check(execution.userPaused, 'pause command is available in debugger view');
	const stoppedAt = cycles();
	await runMenuCommand('pause');
	check(!execution.userPaused && ide.debugger.stopped && ide.editor.isActive && cycles() === stoppedAt,
		'releasing host pause neither continues a debugger stop nor hides its inspector');
	await runMenuCommand('pause');
	await press('F10');
	await until(() => ide.debugger.stopped && ide.debugger.stopPc !== stopPc && ide.editor.isActive,
		'explicit source step executes while host-paused');
	check(execution.userPaused, 'step completion retains independent user pause');
	const steppedAt = cycles();
	for (let index = 0; index < 5; index += 1) await frame();
	check(cycles() === steppedAt, 'no ordinary cycles after step');

	// Rewind replaces the debugger stop, not its breakpoints or source documents.
	await press('ControlRight', 'ShiftRight');
	await press('ControlRight', 'AltRight');
	for (let index = 0; index < 3; index += 1) await press('ArrowUp');
	await press('KeyX');
	const oldActor = title();
	rewind.seekTo(history.earliestCycles);
	await settle();
	check(!ide.debugger.stopped && !ide.debugger.stopPresentationPending, 'restore invalidates the old stop');
	check(hoverState.tooltip === null, 'restore invalidates cached inspection');
	check(title() !== oldActor, 'inspection reacquires objects from restored heap');
	check(execution.userPaused, 'explicit rewind is allowed without lifting user pause');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	await until(() => !rewind.active && tasks.ready, 'Continue takes over reviewed state');
	setKey('ArrowLeft', true);
	for (let index = 0; index < 10; index += 1) await frame();
	setKey('ArrowLeft', false);
	await frame();
	await until(() => ide.debugger.stopped && ide.editor.isActive, 'breakpoint remains installed after rewind');
	harness.toggleLuaBreakpoint('title_screen.lua', breakpointLine);
	await press('F5');
	await until(() => !ide.debugger.stopped && !ide.editor.isActive, 'continue from restored stop');
	// Compile rejection is not a runtime mutation or a successful Continue.
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	harness.openLuaSource('title_screen.lua');
	const beforeRejected = cycles();
	const rejectedMedia = ide.sources.currentBlua32Media;
	const checkpointsBeforeRejected = history.checkpointCount;
	const earliestBeforeRejected = history.earliestCycles;
	harness.replaceActiveCodeSource(source + '\nend end\n');
	await harness.performHotResume();
	for (let index = 0; index < 5; index += 1) await frame();
	check(cycles() === beforeRejected && execution.userPaused && ide.editor.isActive,
		'compile error keeps the selected execution and visible editor');
	check(ide.sources.currentBlua32Media === rejectedMedia && history.checkpointCount === checkpointsBeforeRejected
		&& history.earliestCycles === earliestBeforeRejected, 'compile rejection preserves installed code and history');
	check(harness.getActiveEditorDocument().model === model && ide.fault.lastLuaCallStack.length === 0,
		'compile diagnostic does not masquerade as a guest fault or select an unrelated stack frame');
	check(tasks.ready && ide.editor.commands.isEnabled('pause'), 'rejected build does not disable resuming installed code');
	check(!ide.editor.commands.isEnabled('debugContinue'), 'host pause is not a debugger stop');

	// Repair via a third ordinary Hot Resume, including a breakpoint inside <init>.
	const initLine = source.split('\tfsm_library.register(')[0].split('\n').length;
	harness.toggleLuaBreakpoint('title_screen.lua', initLine);
	harness.replaceActiveCodeSource(source.replace(originalRule, "pattern = 'down[jp]'"));
	const thirdActor = title();
	await harness.performHotResume();
	await until(() => ide.debugger.stopped && ide.editor.isActive, 'breakpoint inside init is visible');
	check(runtime.completionCallPending() && title() === thirdActor, 'init stop retains real completion call and actor');
	check(history.mode === HistoryMode.Disabled, 'host-controlled init is not recorded as ordinary replay input');
	await runMenuCommand('pause');
	const initStopPc = ide.debugger.stopPc;
	await press('F10');
	await until(() => ide.debugger.stopped && ide.debugger.stopPc !== initStopPc, 'source step inside init completes');
	check(execution.userPaused, 'source step inside init retains host pause');
	harness.toggleLuaBreakpoint('title_screen.lua', initLine);
	await press('F5');
	await until(() => !runtime.completionCallPending() && !ide.debugger.plans.mutationActive && tasks.ready
		&& history.checkpointCount !== 0, 'third init completes and history resumes');
	check(title() === thirdActor, 'third Hot Resume is not reboot');

	// A guest init fault is an execution stop, not a compile rejection or silent success.
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	harness.openLuaSource('title_screen.lua');
	const faultSource = source.replace(originalRule, "pattern = 'up[jp]'")
		.replace('local define_fsm<const> = function()', "local define_fsm<const> = function()\n\tif fsm_library ~= nil then error('studio init fault') end");
	check(faultSource.includes("error('studio init fault')"), 'real init edit point');
	harness.replaceActiveCodeSource(faultSource);
	observations.expectedFaultSequence = 1;
	await harness.performHotResume();
	await until(() => runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === observations.expectedFaultSequence
		&& ide.fault.lastLuaCallStack.length !== 0, 'guest init fault exposes actual stack');
	check(runtime.completionCallPending() && history.mode === HistoryMode.Disabled, 'failed init retains completion ownership');
	const faultActor = title();
	harness.openLuaSource('title_screen.lua');
	harness.replaceActiveCodeSource(source.replace(originalRule, "pattern = 'up[jp]'"));
	await harness.performHotResume();
	await until(() => tasks.ready && !runtime.completionCallPending() && !ide.debugger.plans.mutationActive
		&& history.checkpointCount !== 0, 'fault repair follows existing supervisor return and init route');
	check(title() === faultActor, 'fault repair keeps the retained actor');
	check(ide.fault.lastLuaCallStack.length === 0 && ide.fault.faultSnapshot === null, 'repair clears obsolete fault inspection');
	check(runtimeErrorState.activeOverlay === null, 'repair removes the active error adornment');
	for (const context of getCodeTabContexts()) {
		check(context.runtimeErrorOverlay === null, 'repair removes error adornments from all retained code views');
	}
	check(editorFeedbackState.message.text === 'Hot Resume: code applied', 'status reports the new applied code, not the old fault');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	await click(editorChromeState.menuEntryBounds.run);
	check(editorChromeState.openMenuId === 'run', 'Run menu opens through its visible pointer hit target');
	const pauseItem = TOP_BAR_MENUS.run.items[0];
	const continueItem = TOP_BAR_MENUS.run.items[1];
	if (pauseItem.type !== 'command' || continueItem.type !== 'command') throw new Error('Run menu must start with Pause and Continue commands');
	check(pauseItem.active && !pauseItem.disabled, 'checked Pause remains enabled as a toggle');
	check(continueItem.disabled, 'debugger Continue is not a second host-pause button');
	await click(pauseItem.bounds, 8);
	check(!execution.userPaused && !ide.editor.isActive, 'one held pointer press resumes without repeatedly toggling');
	await press('ControlRight', 'ShiftRight');
	await click(editorChromeState.menuEntryBounds.run);
	await click(pauseItem.bounds, 8);
	check(execution.userPaused && ide.editor.isActive, 'pointer Pause does not close or replace the IDE');
	await click(editorChromeState.menuEntryBounds.run);
	return { hostFrames: observations.hostFrames, selected, pausedAt, secondAt, steppedAt, beforeRejected,
		audioFrames: observations.audioFrames, expectedFaultSequence: observations.expectedFaultSequence, inspected: inspected.contentLines };
}
