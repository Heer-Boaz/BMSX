import type { Table } from '../../../machine/ts/machine/cpu/table';
import { applyRuntimeSaveState, captureRuntimeSaveState, type RuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../../machine/ts/spec/bmsx/io';
import { readRuntimeLuaModuleExport } from '../../../ide/runtime/lua_inspection';
import { resolveRuntimeLuaSource } from '../../../ide/runtime/sources';
import { check, type StudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';

/** Public execution owners over a real cart. Internal reads assert firmware lifetime;
 * this is an automated recovery workflow, not UI-only or live-model evidence. */
export async function runStudioFrameRecovery(test: StudioFixture) {
	const { ide, runtime, tasks, guest, harness, frame, until, cycles } = test;
	const terminal = ide.terminal, cpu = runtime.machine.cpu;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'frame recovery: boot real cartridge');
	await reachNemesisTitle(test);
	harness.openLuaSource('title_screen.lua'); await frame();
	await test.runMenuCommand('pause');
	const resource = { domain: 0 as const, path: 'cartlib/gx/vblank.lua' };
	const source = resolveRuntimeLuaSource(ide.sources, resource)!.record.src;
	const line = source.split('\n').findIndex(text => text.includes('halt_until_irq')) + 1;
	check(line > 0, 'frame recovery: installed user-mode wait point');
	ide.debugger.breakpoints.toggle(resource, line);
	const stopAtWait = async () => {
		ide.inspection.pause();
		const continued = ide.debuggerExecution.resume('continue', 'workbench');
		await until(() => continued.result !== undefined && tasks.ready, 'frame recovery: installed wait breakpoint');
		check(ide.debugger.source.stop !== undefined && cpu.isUserMode(),
			`frame recovery: selected stop is in user execution: ${JSON.stringify(continued.result)}`);
		const inspection = ide.inspection.open();
		const context = terminal.frameContext(inspection.readStack(0, 100).frames[0]);
		terminal.inputContext = context;
		return { inspection, context, stop: ide.debugger.source.stop! };
	};
	const scopes = (): Table[] => {
		const module = readRuntimeLuaModuleExport(ide.sources, guest, -1, 'debug/frame_scopes');
		if (module.kind !== 'value') throw new Error('Missing real firmware scope registry');
		const active = guest.readStringMember(module.value, 'active') as Table;
		const result: Table[] = [];
		active.forEachStoredEntry((_tag, _word, scope) => result.push(scope as Table));
		return result;
	};
	const first = await stopAtWait();
	const original = terminal.evaluate('setglobal("frame_recovery_reader", function() return current end); '
		+ 'setglobal("frame_recovery_value", current); local sum = 0; for i = 1, 2000000 do sum = sum + 1 end; return current, sum', first.context);
	await until(() => guest.global('frame_recovery_reader') !== null && cpu.isUserMode(), 'frame recovery: live accessor in a running evaluation');
	terminal.setPaused(original, true);
	check(original.result === undefined && terminal.paused && first.inspection.lifetime.isDisposed,
		'frame recovery: pause retains the call but expires prior inspection');
	const borrowed = scopes();
	check(borrowed.length === 1 && guest.readStringMember(borrowed[0], 'thread') === cpu.activeThread,
		'frame recovery: scope borrows the physical suspended thread');
	const held = cycles(); await frame(); await frame();
	check(cycles() === held, 'frame recovery: a paused frame evaluation does not run gameplay');
	await test.runPaletteCommand('View: Lua Terminal');
	await test.capture?.('evaluation-paused');
	let saved!: RuntimeSaveState;
	await tasks.schedule(async () => {
		await test.presenter.backend.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
		saved = captureRuntimeSaveState(runtime);
	}, error => { throw error; });
	terminal.setPaused(original, false);
	await frame(); await frame();
	terminal.setPaused(original, true);
	check(cycles() > held && original.result === undefined, 'frame recovery: advance the same physical call before restore');
	await tasks.schedule(() => { applyRuntimeSaveState(runtime, saved); }, error => { throw error; });
	check(original.result?.status === 'interrupted' && terminal.active === undefined && cycles() === held,
		'frame recovery: restore retires the old operation, not the restored physical call');
	check(!terminal.contextAvailable(first.context) && ide.debugger.source.stop === undefined,
		'frame recovery: restore cannot revive a selected stop or its handles');
	const restored = scopes();
	check(restored.length === 1 && restored[0] !== borrowed[0]
		&& guest.readStringMember(restored[0], 'thread') === cpu.activeThread,
		'frame recovery: saved firmware scope follows the restored heap and remains live');
	const second = await stopAtWait();
	check(second.stop.id !== first.stop.id && scopes().length === 0 && original.result?.status === 'interrupted',
		'frame recovery: ordinary return closes the restored scope without rewriting the old receipt');
	const readback = terminal.evaluate('return current, pcall(getglobal("frame_recovery_reader"))', second.context);
	await until(() => readback.result !== undefined && tasks.ready, 'frame recovery: reevaluate at the restored source stop');
	check(readback.result!.status === 'completed' && readback.result!.values[1] === 'false'
		&& readback.result!.values[2] === 'Selected frame evaluation has ended.',
		`frame recovery: restored accessor expires on actual return: ${JSON.stringify(readback.result)}`);
	await test.runPaletteCommand('View: Lua Terminal');
	await test.capture?.('restored-reevaluation');

	// Install canonical source while a user-mode call still borrows its frame.
	const beforeInstall = ide.sources.currentBlua32Media;
	const changing = terminal.evaluate('setglobal("frame_install_reader", function() return current end); '
		+ 'local sum = 0; for i = 1, 2000000 do sum = sum + 1 end; return current, sum', second.context);
	await until(() => guest.global('frame_install_reader') !== null && cpu.isUserMode(), 'frame recovery: pending accessor before source install');
	terminal.setPaused(changing, true);
	const installedScopes = scopes();
	check(installedScopes.length === 1, 'frame recovery: source install has a live scope to retire');
	harness.openLuaSource('title_screen.lua'); await frame();
	const titleSource = harness.getActiveEditorDocument().model.buffer.getText();
	harness.replaceActiveCodeSource(titleSource + '\n-- frame evaluation source lifetime\n');
	const hotResume = harness.performHotResume();
	const admission = await hotResume.admission;
	check(admission.status === 'accepted' && admission.mode === 'applied' && hotResume.applied,
		`frame recovery: install without returning from the evaluation: ${JSON.stringify(admission)}`);
	check(ide.sources.currentBlua32Media !== beforeInstall && scopes().length === 0
		&& guest.readStringMember(installedScopes[0], 'thread') === null && !terminal.contextAvailable(second.context),
		'frame recovery: installation retires firmware borrows and the old source selection');
	check(!ide.debugger.plans.controlSuspended, 'frame recovery: accepted Hot Resume releases the evaluation pause');
	await until(() => hotResume.result !== null && changing.result !== undefined && tasks.ready,
		'frame recovery: init and the invalidated evaluation both settle');
	check((await hotResume.completion).status === 'completed' && changing.result!.status === 'lua-error'
		&& changing.result!.values[0] === 'Selected frame evaluation has ended.' && ide.debugger.source.stop !== second.stop,
		`frame recovery: no stale locations or resurrected stop: ${JSON.stringify(changing.result)}`);

	const third = await stopAtWait();
	// A bus fault is physical, unlike Lua error() which the REPL protects.
	test.observations.expectedFaultSequence = 1;
	const faulted = terminal.evaluate('setglobal("frame_fault_reader", function() return current end); '
		+ 'setglobal("frame_fault_write", 73); return cartlib__bin.read_metadata_prop_names(0x06000000)', third.context);
	await until(() => faulted.result !== undefined && tasks.ready,
		'frame recovery: physical bus fault during frame evaluation');
	check(runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === 1,
		`frame recovery: actual supervisor fault, not a protected Lua error: ${JSON.stringify(faulted.result)}`);
	check(faulted.result!.status === 'interrupted' && ide.debugger.plans.mutationActive && guest.global('frame_fault_write') === 73,
		'frame recovery: fault suspends real roots and preserves earlier writes');
	const faultScopes = scopes();
	check(faultScopes.length === 1, 'frame recovery: physical fault retains the scope until unwind');
	await test.capture?.('physical-fault');
	const recovered = harness.performHotResume();
	check((await recovered.admission).status === 'accepted', 'frame recovery: supervisor recovery admitted');
	await until(() => recovered.result !== null && tasks.ready, 'frame recovery: BIOS return and failed completion unwind');
	check((await recovered.completion).status === 'completed' && scopes().length === 0
		&& guest.readStringMember(faultScopes[0], 'thread') === null && guest.global('frame_fault_write') === 73,
		'frame recovery: unwind closes the scope without rolling back the guest write');
	const fourth = await stopAtWait();
	const afterFault = terminal.evaluate('return current, getglobal("frame_fault_write"), pcall(getglobal("frame_fault_reader"))', fourth.context);
	await until(() => afterFault.result !== undefined && tasks.ready, 'frame recovery: fresh frame evaluation after recovery');
	check(afterFault.result!.status === 'completed' && afterFault.result!.values[1] === '73'
		&& afterFault.result!.values[2] === 'false' && afterFault.result!.values[3] === 'Selected frame evaluation has ended.',
		`frame recovery: fresh scopes work; failed-call accessors do not: ${JSON.stringify(afterFault.result)}`);
	await test.runPaletteCommand('View: Lua Terminal');
	await test.capture?.('fault-recovered');
	ide.debugger.breakpoints.toggle(resource, line);

	// Evaluation is not input history. Record ordinary gameplay after the call
	// returns, then use the same retained-history navigation as conversation tools.
	const startTick = runtime.frameScheduler.lastTickSequence;
	const gameplay = ide.debuggerExecution.resume('continue', 'workbench');
	await until(() => runtime.frameScheduler.lastTickSequence >= startTick + 12 && test.history.checkpointCount !== 0,
		'frame recovery: ordinary gameplay produces retained history');
	ide.debuggerExecution.cancel(gameplay);
	await until(() => gameplay.result !== undefined && tasks.ready, 'frame recovery: stop before history review');
	const present = ide.inspection.open();
	const seek = ide.frameNavigation.seek(test.history.earliestCycles);
	await until(() => seek.result !== undefined && tasks.ready, 'frame recovery: seek actual retained state');
	check(seek.result!.status === 'completed' && present.lifetime.isDisposed
		&& !terminal.contextAvailable(fourth.context) && !terminal.canEvaluate,
		'frame recovery: history replaces inspection; evaluation requires leaving read-only review');
	const historical = ide.inspection.open();
	check(historical.readStack(0, 100).frames.length !== 0 && guest.global('frame_fault_write') === 73,
		'frame recovery: historical stack and the completed write belong to the restored target');
	const step = ide.frameNavigation.step(1, 1);
	await until(() => step.result !== undefined && tasks.ready, 'frame recovery: one recorded video frame');
	check(step.result!.status === 'completed' && step.result!.completedFrames === 1 && historical.lifetime.isDisposed,
		'frame recovery: real frame step retires historical inspection');
	await test.capture?.('history-reviewed');
	test.rewind.resumeHere();
	await until(() => !test.rewind.active && tasks.ready, 'frame recovery: explicitly branch from reviewed history');
	ide.debugger.breakpoints.toggle(resource, line);
	const fifth = await stopAtWait();
	const afterHistory = terminal.evaluate('return current, getglobal("frame_fault_write")', fifth.context);
	await until(() => afterHistory.result !== undefined && tasks.ready, 'frame recovery: fresh evaluation after history branch');
	check(afterHistory.result!.status === 'completed' && afterHistory.result!.values[1] === '73',
		`frame recovery: current frame and retained writes after rewind: ${JSON.stringify(afterHistory.result)}`);
	await test.runPaletteCommand('View: Lua Terminal');
	await test.capture?.('history-reevaluated');
	ide.debugger.breakpoints.toggle(resource, line);
	return { frameRecovery: true, restored: original.result!.status, installed: changing.result!.status,
		faultSequence: runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), calls: terminal.history.length,
		rewind: seek.result!.status, recordedFrames: step.result!.completedFrames };
}
