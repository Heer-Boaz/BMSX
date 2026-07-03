import type { LuaFunctionValue, LuaValue } from '../../lua/value';
import { isLuaCallSignal } from '../../lua/value';
import { AcceptedInterruptKind, EMPTY_CALL_ARGS, Closure, RunResult, type Program, type ProgramMetadata, type ProgramRuntimeSymbols, type Value } from '../cpu/cpu';
import { INSTRUCTION_BYTES } from '../cpu/instruction_format';
import { buildMarshalContext, extendMarshalContext, toNativeValue, toRuntimeValue } from '../runtime/host/native_bridge';
import { advanceRuntimeTime, runDueRuntimeTimers } from '../runtime/cpu_executor';
import type { Runtime } from '../runtime/runtime';
import { appendLuaChunkToProgram } from './compiler';
import { resolveRuntimeProgramRelocations, resolveRuntimeProgramValueRelocations } from './linker';

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

function buildHostEvalMetadata(baseProgram: Program, runtimeSymbols: ProgramRuntimeSymbols): ProgramMetadata {
	const instructionCount = baseProgram.code.length / INSTRUCTION_BYTES;
	const debugRanges: Array<ProgramMetadata['debugRanges'][number]> = new Array(instructionCount);
	for (let index = 0; index < debugRanges.length; index += 1) {
		debugRanges[index] = null;
	}
	const protoCount = baseProgram.protos.length;
	const localSlotsByProto: Array<ProgramMetadata['localSlotsByProto'][number]> = new Array(protoCount);
	const upvalueNamesByProto: Array<ProgramMetadata['upvalueNamesByProto'][number]> = new Array(protoCount);
	for (let index = 0; index < protoCount; index += 1) {
		localSlotsByProto[index] = [];
		upvalueNamesByProto[index] = [];
	}
	return {
		debugRanges,
		protoIds: runtimeSymbols.protoIds,
		localSlotsByProto,
		upvalueNamesByProto,
		globalNames: runtimeSymbols.globalNames,
		systemGlobalNames: runtimeSymbols.systemGlobalNames,
		exportProtoIdBySlot: runtimeSymbols.exportProtoIdBySlot,
	};
}

export function runHostEvalChunk(runtime: Runtime, source: string): Value[] {
	const chunk = runtime.interpreter.compileChunk(source, 'host_eval');
	const currentProgram = runtime.machine.cpu.program;
	if (!currentProgram) {
		throw new Error('host-eval execution requires active program.');
	}
	const baseMetadata = runtime.programMetadata ?? runtime.hostEvalMetadata ?? buildHostEvalMetadata(currentProgram, runtime.programRuntimeSymbols);
	const compiled = appendLuaChunkToProgram(currentProgram, baseMetadata, chunk, {
		optLevel: runtime.realtimeCompileOptLevel,
		entrySource: source,
	});
	resolveRuntimeProgramValueRelocations(
		compiled.program,
		compiled.constValueRelocs,
		compiled.data.symbols,
		compiled.data.bytes.byteLength,
		runtime.programDataBaseAddress,
		compiled.bss.symbols,
		compiled.bss.byteCount,
		runtime.programBssBaseAddress,
		compiled.rodataSymbols,
		compiled.rodataBytes.byteLength,
	);
	resolveRuntimeProgramRelocations(compiled.program, compiled.metadata, compiled.constRelocs);
	runtime.machine.cpu.setProgram(compiled.program, compiled.metadata, compiled.metadata);
	runtime.programRuntimeSymbols = compiled.metadata;
	if (runtime.programMetadata) {
		runtime.programMetadata = compiled.metadata;
	} else {
		runtime.hostEvalMetadata = compiled.metadata;
	}
	const results = runtime.luaScratch.values.acquire();
	const restoreHalt = runtime.machine.cpu.isHaltedUntilIrq();
	if (restoreHalt) {
		runtime.machine.cpu.clearHaltUntilIrq();
	}
	try {
		callClosureIntoWithScheduler(runtime, runtime.machine.cpu.rootClosure(compiled.entryProtoIndex), EMPTY_CALL_ARGS, results);
		return results.slice();
	} finally {
		if (restoreHalt) {
			runtime.machine.cpu.haltUntilIrq();
		}
		runtime.luaScratch.values.release(results);
	}
}

export function runHostEvalChunkToNative(runtime: Runtime, source: string): unknown[] {
	const results = runHostEvalChunk(runtime, source);
	const baseCtx = buildMarshalContext(runtime);
	const output: unknown[] = [];
	for (let i = 0; i < results.length; i += 1) {
		output.push(toNativeValue(runtime, results[i], extendMarshalContext(baseCtx, `ret${i}`), new WeakMap()));
	}
	return output;
}

export function installNativeGlobal(runtime: Runtime, name: string, value: unknown): void {
	runtime.machine.cpu.setGlobalByKey(runtime.internString(name), toRuntimeValue(runtime, value));
	const metadata = runtime.programMetadata ?? runtime.hostEvalMetadata;
	if (metadata && !metadata.globalNames.includes(name)) {
		metadata.globalNames.push(name);
	}
}

function runHaltedClosureUntilInterrupt(runtime: Runtime): void {
	const cpu = runtime.machine.cpu;
	const scheduler = runtime.machine.scheduler;
	while (cpu.isHaltedUntilIrq()) {
		if (cpu.peekPendingInterrupt(runtime.machine.irqController) !== AcceptedInterruptKind.None) {
			cpu.clearHaltUntilIrq();
			return;
		}
		if (scheduler.hasDueTimer()) {
			runDueRuntimeTimers(runtime);
			continue;
		}
		const nextDeadline = scheduler.nextDeadline();
		if (nextDeadline === Number.MAX_SAFE_INTEGER) {
			// Halted with no pending interrupt and nothing scheduled to wake it:
			// fail fast instead of spinning the host forever.
			throw new Error('CPU halted with no scheduled interrupt');
		}
		const cyclesToDeadline = nextDeadline - scheduler.nowCycles;
		if (cyclesToDeadline <= 0) {
			continue;
		}
		advanceRuntimeTime(runtime, cyclesToDeadline);
	}
}

// start repeated-sequence-acceptable -- External closure calls keep frame/budget restore code direct instead of routing through callback plumbing.
export function callClosureInto(runtime: Runtime, fn: Closure, args: ReadonlyArray<Value>, out: Value[]): void {
	const cpu = runtime.machine.cpu;
	const depth = cpu.getFrameDepth();
	const previousBudget = cpu.instructionBudgetRemaining;
	const budgetSentinel = Number.MAX_SAFE_INTEGER;
	const previousSink = cpu.swapExternalReturnSink(out);
	let spentBudget = 0;
	let activeBudget = 0;
	out.length = 0;
	cpu.enterHostExternalCall();
	try {
		cpu.callExternal(fn, args);
		while (cpu.getFrameDepth() > depth) {
			activeBudget = budgetSentinel;
			const result = cpu.runUntilDepth(depth, budgetSentinel);
			spentBudget += activeBudget - cpu.instructionBudgetRemaining;
			activeBudget = 0;
			if (cpu.getFrameDepth() > depth && result === RunResult.Halted) {
				runHaltedClosureUntilInterrupt(runtime);
			}
		}
	} catch (error) {
		cpu.unwindToDepth(depth);
		throw error;
	} finally {
		if (activeBudget > 0) {
			spentBudget += activeBudget - cpu.instructionBudgetRemaining;
		}
		cpu.swapExternalReturnSink(previousSink);
		cpu.instructionBudgetRemaining = previousBudget - spentBudget;
		cpu.leaveHostExternalCall();
	}
}

export function callClosureIntoWithScheduler(runtime: Runtime, fn: Closure, args: ReadonlyArray<Value>, out: Value[]): void {
	const cpu = runtime.machine.cpu;
	const scheduler = runtime.machine.scheduler;
	const depth = cpu.getFrameDepth();
	const previousBudget = cpu.instructionBudgetRemaining;
	const budgetSentinel = Number.MAX_SAFE_INTEGER;
	const previousSink = cpu.swapExternalReturnSink(out);
	let spentBudget = 0;
	out.length = 0;
	cpu.enterHostExternalCall();
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
			let result = RunResult.Yielded;
			let consumed = 0;
			try {
				result = cpu.runUntilDepth(depth, sliceBudget);
			} finally {
				scheduler.endCpuSlice();
				consumed = sliceBudget - cpu.instructionBudgetRemaining;
				if (consumed > 0) {
					remaining -= consumed;
					spentBudget += consumed;
					advanceRuntimeTime(runtime, consumed);
				}
			}
			if (cpu.getFrameDepth() <= depth) {
				break;
			}
			if (result === RunResult.Halted) {
				runHaltedClosureUntilInterrupt(runtime);
				continue;
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
		cpu.instructionBudgetRemaining = previousBudget - spentBudget;
		cpu.leaveHostExternalCall();
	}
}
// end repeated-sequence-acceptable

export function callClosureIntoSuspended(runtime: Runtime, fn: Closure, args: ReadonlyArray<Value>, out: Value[]): void {
	const cpu = runtime.machine.cpu;
	const restoreHalt = cpu.isHaltedUntilIrq();
	if (restoreHalt) {
		cpu.clearHaltUntilIrq();
	}
	try {
		callClosureInto(runtime, fn, args, out);
	} finally {
		if (restoreHalt) {
			cpu.haltUntilIrq();
		}
	}
}

export function callClosure(runtime: Runtime, fn: Closure, args: ReadonlyArray<Value>): Value[] {
	callClosureInto(runtime, fn, args, runtime.machine.cpu.lastReturnValues);
	return runtime.machine.cpu.lastReturnValues;
}

export function invokeClosureHandler(runtime: Runtime, fn: Closure, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
	const callArgs = runtime.luaScratch.values.acquire();
	const results = runtime.luaScratch.values.acquire();
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
		runtime.luaScratch.values.release(results);
		runtime.luaScratch.values.release(callArgs);
	}
}

export function invokeLuaHandler(runtime: Runtime, fn: LuaFunctionValue, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
	const luaArgs = runtime.luaScratch.values.acquire() as unknown as LuaValue[];
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
		runtime.luaScratch.values.release(luaArgs as unknown as Value[]);
	}
}
