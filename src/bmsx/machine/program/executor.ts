import type { LuaFunctionValue, LuaValue } from '../../lua/value';
import { isLuaCallSignal } from '../../lua/value';
import { Closure, RunResult, type Program, type ProgramMetadata, type Value } from '../cpu/cpu';
import { INSTRUCTION_BYTES } from '../cpu/instruction_format';
import { buildMarshalContext, extendMarshalContext, toNativeValue, toRuntimeValue } from '../firmware/js_bridge';
import { advanceRuntimeTime, runDueRuntimeTimers } from '../runtime/cpu_executor';
import type { Runtime } from '../runtime/runtime';
import { appendLuaChunkToProgram } from './compiler';

export function callLuaFunction(runtime: Runtime, fn: LuaFunctionValue, args: unknown[]): unknown[] {
	const luaArgs = runtime.luaScratch.acquireValue() as unknown as LuaValue[];
	try {
		for (let index = 0; index < args.length; index += 1) {
			luaArgs.push(runtime.luaJsBridge.toLua(args[index]));
		}
		return callLuaFunctionPrepared(runtime, fn, luaArgs);
	} finally {
		runtime.luaScratch.releaseValue(luaArgs as unknown as Value[]);
	}
}

function callLuaFunctionPrepared(runtime: Runtime, fn: LuaFunctionValue, luaArgs: ReadonlyArray<LuaValue>): unknown[] {
	const results = fn.call(luaArgs);
	if (isLuaCallSignal(results)) {
		return [];
	}
	const output: unknown[] = [];
	const baseCtx = buildMarshalContext(runtime);
	for (let i = 0; i < results.length; i += 1) {
		output.push(runtime.luaJsBridge.convertFromLua(results[i], extendMarshalContext(baseCtx, `ret${i}`)));
	}
	return output;
}

export function buildConsoleMetadata(baseProgram: Program): ProgramMetadata {
	const instructionCount = Math.floor(baseProgram.code.length / INSTRUCTION_BYTES);
	const debugRanges: Array<ProgramMetadata['debugRanges'][number]> = new Array(instructionCount);
	for (let index = 0; index < debugRanges.length; index += 1) {
		debugRanges[index] = null;
	}
	const protoIds = new Array<string>(baseProgram.protos.length);
	const localSlotsByProto: Array<NonNullable<ProgramMetadata['localSlotsByProto']>[number]> = new Array(baseProgram.protos.length);
	for (let index = 0; index < protoIds.length; index += 1) {
		protoIds[index] = `proto:${index}`;
		localSlotsByProto[index] = [];
	}
	return { debugRanges, protoIds, localSlotsByProto, globalNames: [], systemGlobalNames: [] };
}

export function runConsoleChunk(runtime: Runtime, source: string): Value[] {
	const chunk = runtime.interpreter.compileChunk(source, 'console');
	const currentProgram = runtime.machine.cpu.getProgram();
	if (!currentProgram) {
		throw new Error('console execution requires active program.');
	}
	const baseMetadata = runtime.programMetadata ?? runtime.consoleMetadata ?? buildConsoleMetadata(currentProgram);
	const compiled = appendLuaChunkToProgram(currentProgram, baseMetadata, chunk, {
		optLevel: runtime.realtimeCompileOptLevel,
		entrySource: source,
	});
	runtime.machine.cpu.setProgram(compiled.program, compiled.metadata);
	if (runtime.programMetadata) {
		runtime.programMetadata = compiled.metadata;
	} else {
		runtime.consoleMetadata = compiled.metadata;
	}
	const results = runtime.luaScratch.acquireValue();
	try {
		callClosureIntoWithScheduler(runtime, { protoIndex: compiled.entryProtoIndex, upvalues: [] }, [], results);
		return results.slice();
	} finally {
		runtime.luaScratch.releaseValue(results);
	}
}

export function runConsoleChunkToNative(runtime: Runtime, source: string): unknown[] {
	const results = runConsoleChunk(runtime, source);
	const baseCtx = buildMarshalContext(runtime);
	const output: unknown[] = [];
	for (let i = 0; i < results.length; i += 1) {
		output.push(toNativeValue(runtime, results[i], extendMarshalContext(baseCtx, `ret${i}`), new WeakMap()));
	}
	return output;
}

export function installNativeGlobal(runtime: Runtime, name: string, value: unknown): void {
	runtime.machine.cpu.setGlobalByKey(runtime.luaKey(name), toRuntimeValue(runtime, value));
	const metadata = runtime.programMetadata ?? runtime.consoleMetadata;
	if (metadata && !metadata.globalNames.includes(name)) {
		metadata.globalNames.push(name);
	}
}

// start repeated-sequence-acceptable -- External closure calls keep frame/budget restore code direct instead of routing through callback plumbing.
export function callClosureInto(runtime: Runtime, fn: Closure, args: Value[], out: Value[]): void {
	const cpu = runtime.machine.cpu;
	const depth = cpu.getFrameDepth();
	const previousBudget = cpu.instructionBudgetRemaining;
	const budgetSentinel = Number.MAX_SAFE_INTEGER;
	const previousSink = cpu.swapExternalReturnSink(out);
	out.length = 0;
	try {
		cpu.callExternal(fn, args);
		cpu.runUntilDepth(depth, budgetSentinel);
	} catch (error) {
		cpu.unwindToDepth(depth);
		throw error;
	} finally {
		cpu.swapExternalReturnSink(previousSink);
		const remaining = cpu.instructionBudgetRemaining;
		cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
	}
}

export function callClosureIntoWithScheduler(runtime: Runtime, fn: Closure, args: Value[], out: Value[]): void {
	const cpu = runtime.machine.cpu;
	const scheduler = runtime.machine.scheduler;
	const depth = cpu.getFrameDepth();
	const previousBudget = cpu.instructionBudgetRemaining;
	const budgetSentinel = Number.MAX_SAFE_INTEGER;
	const previousSink = cpu.swapExternalReturnSink(out);
	out.length = 0;
	try {
		cpu.callExternal(fn, args);
		let remaining = budgetSentinel;
		runDueRuntimeTimers(runtime);
		while (cpu.getFrameDepth() > depth) {
			let sliceBudget = remaining;
			const nextDeadline = scheduler.nextDeadline();
			if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
				const deadlineBudget = nextDeadline - scheduler.nowCycles;
				if (deadlineBudget <= 0) {
					runDueRuntimeTimers(runtime);
					continue;
				}
				if (deadlineBudget < sliceBudget) {
					sliceBudget = deadlineBudget;
				}
			}
			scheduler.beginCpuSlice(sliceBudget);
			const result = cpu.runUntilDepth(depth, sliceBudget);
			scheduler.endCpuSlice();
			const consumed = sliceBudget - cpu.instructionBudgetRemaining;
			if (consumed > 0) {
				remaining -= consumed;
				advanceRuntimeTime(runtime, consumed);
			}
			if (cpu.getFrameDepth() <= depth) {
				break;
			}
			if (result === RunResult.Halted) {
				break;
			}
			if (consumed <= 0) {
				runDueRuntimeTimers(runtime);
			}
		}
	} catch (error) {
		cpu.unwindToDepth(depth);
		throw error;
	} finally {
		cpu.swapExternalReturnSink(previousSink);
		const remaining = cpu.instructionBudgetRemaining;
		cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
	}
}
// end repeated-sequence-acceptable

export function callClosure(runtime: Runtime, fn: Closure, args: Value[]): Value[] {
	callClosureInto(runtime, fn, args, runtime.machine.cpu.lastReturnValues);
	return runtime.machine.cpu.lastReturnValues;
}

export function invokeClosureHandler(runtime: Runtime, fn: Closure, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
	const callArgs = runtime.luaScratch.acquireValue();
	const results = runtime.luaScratch.acquireValue();
	try {
		if (thisArg !== undefined) {
			callArgs.push(toRuntimeValue(runtime, thisArg));
		}
		for (let index = 0; index < args.length; index += 1) {
			callArgs.push(toRuntimeValue(runtime, args[index]));
		}
		callClosureInto(runtime, fn, callArgs, results);
		if (results.length === 0) {
			return undefined;
		}
		const ctx = buildMarshalContext(runtime);
		return toNativeValue(runtime, results[0], ctx, new WeakMap());
	} finally {
		runtime.luaScratch.releaseValue(results);
		runtime.luaScratch.releaseValue(callArgs);
	}
}

export function invokeLuaHandler(runtime: Runtime, fn: LuaFunctionValue, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
	const luaArgs = runtime.luaScratch.acquireValue() as unknown as LuaValue[];
	try {
		if (thisArg !== undefined) {
			luaArgs.push(runtime.luaJsBridge.toLua(thisArg));
		}
		for (let index = 0; index < args.length; index += 1) {
			luaArgs.push(runtime.luaJsBridge.toLua(args[index]));
		}
		const results = callLuaFunctionPrepared(runtime, fn, luaArgs);
		return results.length > 0 ? results[0] : undefined;
	} finally {
		runtime.luaScratch.releaseValue(luaArgs as unknown as Value[]);
	}
}
