import { machineManager } from '../../core/machine_manager';
import { EMPTY_CALL_ARGS, type Program, type ProgramMetadata, type ProgramRuntimeSymbols, type Value } from '../../machine/cpu/cpu';
import { INSTRUCTION_BYTES } from '../../machine/cpu/instruction_format';
import { appendLuaChunkToProgram } from '../../lua/compiler';
import { callClosureIntoWithScheduler } from './closure_executor';
import { resolveRuntimeProgramRelocations, resolveRuntimeProgramValueRelocations } from '../../machine/program/linker';
import type { Runtime } from '../../machine/runtime/runtime';
import { buildMarshalContext, extendMarshalContext, toNativeValue, toRuntimeValue } from './native_bridge';

let hostEvalMetadata: ProgramMetadata | null = null;

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

export function clearHostEvalMetadata(): void {
	hostEvalMetadata = null;
}


export function installNativeGlobal(runtime: Runtime, name: string, value: unknown): void {
	runtime.machine.cpu.setGlobalByKey(runtime.internString(name), toRuntimeValue(machineManager.ideState.nativeBridge, value));
	const metadata = runtime.programMetadata ?? hostEvalMetadata;
	if (metadata && !metadata.globalNames.includes(name)) {
		metadata.globalNames.push(name);
	}
}

export function runHostEvalChunk(runtime: Runtime, source: string): Value[] {
	const chunk = machineManager.ideState.nativeBridge.luaInterpreter.compileChunk(source, 'host_eval');
	const currentProgram = runtime.machine.cpu.program;
	if (!currentProgram) {
		throw new Error('host-eval execution requires active program.');
	}
	let baseMetadata = runtime.programMetadata;
	if (!baseMetadata) {
		baseMetadata = hostEvalMetadata;
	}
	if (!baseMetadata) {
		baseMetadata = buildHostEvalMetadata(currentProgram, runtime.programRuntimeSymbols);
	}
	const compiled = appendLuaChunkToProgram(currentProgram, baseMetadata, chunk, {
		optLevel: machineManager.sourceState.realtimeCompileOptLevel,
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
	runtime.machine.cpu.setProgram(
		compiled.program,
		compiled.metadata,
		compiled.metadata,
		runtime.systemVectors.irqProtoIndex,
		runtime.cartVectors.irqProtoIndex,
		runtime.systemVectors.exceptionProtoIndex,
	);
	runtime.programRuntimeSymbols = compiled.metadata;
	if (runtime.programMetadata) {
		runtime.programMetadata = compiled.metadata;
	} else {
		hostEvalMetadata = compiled.metadata;
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
	const bridge = machineManager.ideState.nativeBridge;
	const baseCtx = buildMarshalContext();
	const output: unknown[] = [];
	for (let i = 0; i < results.length; i += 1) {
		output.push(toNativeValue(bridge, results[i], extendMarshalContext(baseCtx, `ret${i}`), new WeakMap()));
	}
	return output;
}
