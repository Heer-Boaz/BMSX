import type { Closure } from '../../../machine/ts/machine/cpu/closure';
import { valueString, type Value } from '../../../machine/ts/machine/cpu/value';
import { scheduleRuntimeGuestCall } from '../../../ide/runtime/guest_call';
import { readRuntimeLuaModuleExport } from '../../../ide/runtime/lua_inspection';
import { resolveRuntimeLuaSource } from '../../../ide/runtime/sources';
import { check, type StudioFixture } from './studio_fixture';

/** Admission-core proof only: no public Terminal frame context or test-only evaluator. */
export async function testStudioPinnedFrameEvaluation(test: StudioFixture): Promise<void> {
	const { ide, runtime, guest, until, frame, cycles } = test;
	const resource = { domain: 0 as const, path: 'cartlib/irq.lua' };
	const source = resolveRuntimeLuaSource(ide.sources, resource)!.record.src;
	const line = source.split('\n').findIndex(text => text.includes('local pending = flags')) + 1;
	check(line > 0, 'frame admission: installed cartridge IRQ source exists');
	ide.debugger.breakpoints.toggle(resource, line);
	check(ide.debugger.breakpoints.bindings.pcs[1].size !== 0, 'frame admission: breakpoint bound to installed cartridge');
	const continued = ide.debuggerExecution.resume('continue', 'workbench');
	await until(() => continued.result !== undefined, 'frame admission: real cartridge IRQ source stop');
	check(ide.debugger.source.stopped, `frame admission: Continue reached source stop: ${JSON.stringify(continued.result)}`);
	const cpu = runtime.machine.cpu, depth = cpu.getFrameDepth(), exceptionDepth = cpu.readExceptionReturnFrameDepth();
	check(exceptionDepth >= 0, 'frame admission: evaluation must not drain the active interrupt');
	const pcs = cpu.activeThread.frames.map(entry => entry.pc);
	const stopPc = ide.debugger.source.stopPc, stopInlineDepth = ide.debugger.source.stopInlineDepth;
	const media = ide.sources.currentBlua32Media;
	for (const target of ['irq', 'cart'] as const) {
		const executionRevision = ide.debugger.executionRevision;
		const inspection = ide.inspection.open(), frames = inspection.readStack(0, 100).frames;
		const selected = target === 'irq' ? frames[0] : frames.find(entry => entry.domain === 0 && entry.physicalFrameIndex < exceptionDepth)!;
		check(selected.kind === 'source', 'frame admission: select an actual installed source frame');
		const scopes = inspection.frameScopes(selected.reference).scopes;
		const scope = scopes.find(scope => scope.kind === (target === 'irq' ? 'locals' : 'statics'))!;
		const name = target === 'irq' ? 'flags' : 'cartlib_render_commands';
		const binding = inspection.read(scope.reference!, 0, scope.count!).entries.find(entry => entry.key.display === name)!;
		check(binding.value.kind === (target === 'irq' ? 'number' : 'address'), 'frame admission: shared inspection exposes the selected binding');
		const expected = binding.value.display;
		const expression = target === 'irq' ? 'flags = flags; return flags, nil, false' : 'return cartlib_render_commands, nil, false';
		let completed: boolean | undefined;
		const values: Value[] = [];
		await scheduleRuntimeGuestCall(runtime, guest, ide.debugger, test.tasks, {
			admission: 'at-stop', honorUserStops: true,
			isCurrent: () => ide.debugger.source.stopped && ide.debugger.executionRevision === executionRevision,
			prepare: () => {
				const repl = readRuntimeLuaModuleExport(ide.sources, guest, -1, 'shell/repl');
				if (repl.kind !== 'value') throw new Error('Installed BIOS REPL required');
				return { domain: -1, closure: guest.readStringMember(repl.value, 'evaluate_frame') as Closure,
					args: () => [valueString(cpu.stringPool.intern(expression)), valueString(cpu.stringPool.intern('=pinned-stop')),
						selected.physicalFrameIndex, selected.inlineDepth] };
			},
		}, () => test.execution.requestExecution(false), result => {
			completed = result; if (result) cpu.readCompletionValues(values);
		}, error => { throw error; });
		await until(() => completed !== undefined && test.tasks.ready, `frame admission: ${target} named evaluation returns`);
		check(completed === true && values[0] === true && values[2] === null && values[3] === false,
			`frame admission: exact protected tuple ${values.map(value => guest.formatValue(value)).join(',')}`);
		check(target === 'irq' ? guest.formatValue(values[1]) === expected
			: binding.value.kind === 'address' && values[1] === binding.value.address,
			'frame admission: firmware and ordinary inspection agree without host-built names');
		check(cpu.getFrameDepth() === depth && cpu.readExceptionReturnFrameDepth() === exceptionDepth
			&& cpu.activeThread.frames.every((entry, index) => entry.pc === pcs[index]),
			'frame admission: every retained ancestor and the active IRQ keep their exact PCs');
		check(ide.debugger.source.stopped && ide.debugger.source.stopPc === stopPc && ide.debugger.source.stopInlineDepth === stopInlineDepth
			&& !ide.debugger.plans.controlActive && ide.sources.currentBlua32Media === media && inspection.lifetime.isDisposed,
			'frame admission: same source stop, new inspection lifetime, no source install');
	}
	const held = cycles();
	await frame(); await frame();
	check(cycles() === held, 'frame admission: completion does not continue the IRQ or game');
	await test.capture?.('pinned-irq-stop');
	ide.debugger.breakpoints.toggle(resource, line);
	const resumed = ide.debuggerExecution.resume('continue', 'workbench');
	await frame();
	ide.debuggerExecution.cancel(resumed);
	await until(() => resumed.result !== undefined, 'frame admission: explicit Continue releases the retained stop');
}
