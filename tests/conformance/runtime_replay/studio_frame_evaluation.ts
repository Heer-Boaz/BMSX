import { check, type StudioFixture } from './studio_fixture';

/** Shared BIOS evaluator at a real retained IRQ stop, without a second terminal. */
export async function testStudioPinnedFrameEvaluation(test: StudioFixture, whileStopped?: () => Promise<void>): Promise<void> {
	const { ide, runtime, until, frame, cycles } = test;
	const resource = { contextId: test.ide.sources.currentBlua32Media.cartridgeSlots[0]!.sourceContextId, path: 'cartlib/irq.lua' };
	const source = ide.sources.catalog.resolveLuaSource(resource)!.record.src;
	const line = source.split('\n').findIndex(text => text.includes('local pending = flags')) + 1;
	check(line > 0, 'frame admission: installed cartridge IRQ source exists');
	ide.debugger.breakpoints.toggle(resource, line);
	check(ide.debugger.breakpoints.bindings.pcs[1].size !== 0, 'frame admission: breakpoint bound to installed cartridge');
	const continued = ide.debuggerExecution.resume('continue', 'workbench');
	await until(() => continued.result !== undefined, 'frame admission: real cartridge IRQ source stop');
	check(ide.debugger.source.stop !== undefined, `frame admission: Continue reached source stop: ${JSON.stringify(continued.result)}`);
	const cpu = runtime.machine.cpu, depth = cpu.getFrameDepth(), exceptionDepth = cpu.readExceptionReturnFrameDepth();
	check(exceptionDepth >= 0, 'frame admission: evaluation must not drain the active interrupt');
	const pcs = cpu.activeThread.frames.map(entry => entry.pc);
	const stopPc = ide.debugger.source.stop!.pc, stopInlineDepth = ide.debugger.source.stop!.inlineDepth;
	const media = ide.sources.currentBlua32Media;
	let selectedContext: import('../../../ide/runtime/lua_evaluation').LuaFrameContext;
	for (const target of ['irq', 'cart'] as const) {
		const stop = ide.debugger.source.stop;
		const inspection = ide.inspection.open(), frames = inspection.readStack(0, 100).frames;
		const selected = target === 'irq' ? frames[0] : frames.find(entry => entry.domain === 0 && entry.physicalFrameIndex < exceptionDepth)!;
		check(selected.kind === 'source', 'frame admission: select an actual installed source frame');
		const scopes = inspection.frameScopes(selected.reference).scopes;
		const scope = scopes.find(scope => scope.kind === (target === 'irq' ? 'locals' : 'statics'))!;
		const name = target === 'irq' ? 'flags' : 'cartlib_render_commands';
		const binding = inspection.read(scope.reference!, 0, scope.count!).entries.find(entry => entry.key.display === name)!;
		check(binding.value.kind === (target === 'irq' ? 'number' : 'address'), 'frame admission: shared inspection exposes the selected binding');
		const expected = target === 'irq' ? binding.value.display : 'true';
		const expression = binding.value.kind === 'address' ? `return cartlib_render_commands == ${binding.value.address}, nil, false`
			: 'flags = flags; return flags, nil, false';
		selectedContext = ide.luaEvaluation.frameContext(selected);
		ide.luaEvaluation.evaluate(expression, selectedContext);
		await until(() => ide.luaEvaluation.active === undefined && test.tasks.ready, `frame admission: ${target} named evaluation returns`);
		const result = ide.luaEvaluation.lastResult!.result!;
		check(result.status === 'completed' && result.values[0] === expected && result.values[1] === 'nil' && result.values[2] === 'false',
			`frame admission: firmware and inspection agree: ${JSON.stringify(result)}`);
		check(ide.debugger.source.stop === stop && ide.luaEvaluation.contextAvailable(selectedContext!),
			'frame completion republishes the same owned stop, preserving the manual selection');
		check(cpu.getFrameDepth() === depth && cpu.readExceptionReturnFrameDepth() === exceptionDepth
			&& cpu.activeThread.frames.every((entry, index) => entry.pc === pcs[index]),
			'frame admission: every retained ancestor and the active IRQ keep their exact PCs');
		check(ide.debugger.source.stop !== undefined && ide.debugger.source.stop!.pc === stopPc && ide.debugger.source.stop!.inlineDepth === stopInlineDepth
			&& !ide.debugger.plans.controlActive && ide.sources.currentBlua32Media === media && inspection.lifetime.isDisposed,
			'frame admission: same source stop, new inspection lifetime, no source install');
	}
	await whileStopped?.();
	const held = cycles();
	await frame(); await frame();
	check(cycles() === held, 'frame admission: completion does not continue the IRQ or game');
	await test.capture?.('pinned-irq-stop');
	ide.debugger.breakpoints.toggle(resource, line);
	const resumed = ide.debuggerExecution.resume('continue', 'workbench');
	await frame();
	ide.debuggerExecution.cancel(resumed);
	await until(() => resumed.result !== undefined, 'frame admission: explicit Continue releases the retained stop');
	check(!ide.luaEvaluation.contextAvailable(selectedContext!), 'Continue expires a manual frame selection instead of rebinding its physical index');
}
