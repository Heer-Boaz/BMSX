import { editorTabGroup } from '../../../ide/workbench/ui/tab/group_model';
import { IO_SYS_STATUS, SYS_STATUS_SUPERVISOR_ACTIVE, SYS_STATUS_SUPERVISOR_RESUMABLE } from '../../../machine/ts/spec/bmsx/io';
import { check, type StudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { testStudioPinnedFrameEvaluation } from './studio_frame_evaluation';

/** Physical BIOS shell, real HID input and the ordinary scheduler on all renderers. */
export async function runStudioTerminal(test: StudioFixture) {
	const { ide, runtime, frame, until, cycles } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'BIOS terminal: boot real cartridge');
	await reachNemesisTitle(test);
	test.harness.openLuaSource('title_screen.lua'); await frame();
	await test.runMenuCommand('pause');
	const media = ide.sources.currentBlua32Media;
	await test.runPaletteCommand('View: BIOS Terminal');
	const terminal = editorTabGroup.activeTab;
	check(terminal.kind === 'terminal', 'registered view opens the BIOS terminal');
	await until(() => (runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_RESUMABLE) !== 0,
		'BIOS terminal: physical supervisor entry');
	for (let index = 0; index < 20; index++) await frame();
	const command = async (text: string) => {
		// Hold both edges across guest samples, just like the native HID conformance runner.
		for (const char of text) {
			const code = char === ' ' ? 'Space' : char === '=' ? 'Equal' : char === '_' ? 'Minus'
				: /[0-9]/.test(char) ? `Digit${char}` : `Key${char.toUpperCase()}`;
			if (char === '_') test.setKey('ShiftLeft', true);
			test.setKey(code, true); await frame(); await frame();
			test.setKey(code, false); test.setKey('ShiftLeft', false); await frame(); await frame();
		}
		test.setKey('Enter', true); await frame(); await frame();
		test.setKey('Enter', false);
		for (let index = 0; index < 20; index++) await frame();
	};
	await command('help'); await test.capture?.('bios-help');
	await command('q');
	await command('regs'); await test.capture?.('bios-registers');
	await command('q');
	await command('lua bios_terminal_probe=42');
	check(ide.guest.global('bios_terminal_probe') === 42, 'physical LUA command writes the live cartridge registerfile');
	check(ide.sources.currentBlua32Media === media && ide.luaEvaluation.active === undefined && ide.luaEvaluation.lastResult === undefined,
		'BIOS commands install no source and create no host evaluation or transcript');
	await test.capture?.('bios-lua');
	await test.press('ShiftLeft', 'F1');
	await test.runPaletteCommand('View: Game');
	const suspended = cycles();
	for (let index = 0; index < 6; index++) await frame();
	check(cycles() === suspended && (runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE) !== 0,
		'leaving the terminal suspends, rather than unwinds, the physical shell');
	await test.clickTab(terminal.id);
	for (let index = 0; index < 5; index++) await frame();
	await command('lua bios_terminal_probe'); await test.capture?.('bios-reopened');
	await command('cont');
	await until(() => !ide.editor.terminal.active && test.tasks.ready, 'BIOS terminal: CONT returns to held cartridge');
	check((runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE) === 0
		&& !runtime.machine.cpu.activeThread.frames.some(frame => frame.isNonMaskableExceptionFrame)
		&& !ide.debugger.plans.controlActive && test.execution.userPaused,
		'CONT leaves the physical supervisor without clearing independent host pause (the caller may still be an IRQ)');
	const held = cycles();
	for (let index = 0; index < 6; index++) await frame();
	check(cycles() === held, 'the terminal does not leak execution into gameplay after CONT');
	await test.runPaletteCommand('View: Game');
	await testStudioPinnedFrameEvaluation(test, async () => {
		const stop = ide.debugger.source.stop!, cpu = runtime.machine.cpu;
		const oldContext = ide.luaEvaluation.frameContext(ide.inspection.open().readStack(0, 100).frames[0]);
		await test.runPaletteCommand('View: BIOS Terminal');
		await until(() => (runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_RESUMABLE) !== 0,
			'BIOS terminal: supervisor entry from a source stop');
		for (let index = 0; index < 20; index++) await frame();
		const nmi = cpu.activeThread.frames.findIndex((_frame, index) => cpu.isNonMaskableExceptionFrame(index));
		check(nmi > 0 && ide.debugger.source.stop === undefined && !ide.luaEvaluation.contextAvailable(oldContext),
			'physical admission retires the old source/frame context, rather than promising pinned evaluation semantics');
		const pcs = cpu.activeThread.frames.slice(0, nmi).map(frame => frame.pc);
		await command('cont');
		await until(() => !ide.editor.terminal.active && test.tasks.ready, 'BIOS terminal: hold the physical NMI return');
		check(cpu.getFrameDepth() === nmi && cpu.activeThread.frames.every((frame, index) => frame.pc === pcs[index])
			&& ide.debugger.source.stop !== stop && !ide.luaEvaluation.contextAvailable(oldContext),
			`CONT holds the real NMI caller before execution, without resurrecting the retired breakpoint: expected=${JSON.stringify(pcs)}, actual=${JSON.stringify(cpu.activeThread.frames.map(frame => frame.pc))}, depth=${nmi}/${cpu.getFrameDepth()}`);
	});
	return { renderer: 'shared', terminal: true };
}
