import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_FAULT, SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH } from '../../machine/ts/spec/bmsx/io';
import { runToSupervisorFault } from '../helpers/supervisor_fault';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { handleSupervisorFault } from '../../ide/workbench/runtime_errors';
import {
	registerLuaSourceRecord,
	type LuaSourceRegistry,
} from '../../ide/runtime/source_registry';
import { Closure } from '../../machine/ts/machine/cpu/closure';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
	BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET,
	BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
	BLUA32_FUNCTION_STATIC,
	BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
	BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
} from '../../machine/ts/spec/blua32/image_format';
import {
	INSTRUCTION_BYTES,
	writeInstruction,
} from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode, encodeFixedCallArgCount } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { readBlua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';
import {
	createTestRuntime,
	createTestSystemImageRuntimeSourceState,
} from '../helpers/runtime_sources';

test('fault snapshots retain mapped runtime functions as instruction frames', () => {
	const sourcePath = 'runtime_fault_state.lua';
	const source = 'halt_until_irq()';
	const sourceRange = {
		path: 'runtime_fault_state',
		start: { line: 1, column: 1 },
		end: { line: 1, column: source.length + 1 },
	};
	const linkedCode = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(linkedCode, 0, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(linkedCode, 1, OpCode.CALL, 0, encodeFixedCallArgCount(0), 0, 0);
	writeInstruction(linkedCode, 2, OpCode.LOADK, 1, 0, 0, 0);
	writeInstruction(linkedCode, 3, OpCode.LOADK, 2, 0, 1, 0);
	writeInstruction(linkedCode, 4, OpCode.STORE_MEM_D, 2, 1, MemoryAccessKind.Word, 0);
	writeInstruction(linkedCode, 5, OpCode.HALT, 0, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text: linkedCode,
		functions: [
			{ firstWord: 0, wordCount: 1, maxStack: 1 },
			{ firstWord: 1, wordCount: 1, maxStack: 1 },
			{ firstWord: 2, wordCount: 4, maxStack: 3, numParams: 1 },
		],
		constants: [IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_FAULT | SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH],
		functionIds: ['startup', 'source_target', 'exception'],
		debugRanges: [sourceRange, sourceRange, null, null, null, null],
		startupFunctionIndex: 0,
		irqFunctionIndex: 2,
		exceptionFunctionIndex: 2,
	});
	const runtime = createTestRuntime(image.romBytes);
	const cpu = runtime.machine.cpu;
	cpu.reset();
	cpu.abortCompletionCall(0);

	const functionAddress = DYNAMIC_RAM_BASE + 0x1000;
	const codeAddress = functionAddress + 0x100;
	const codeByteCountAddress = functionAddress + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET;
	const numParamsAddress = functionAddress + BLUA32_FUNCTION_NUM_PARAMS_OFFSET;
	const memory = runtime.machine.memory;
	memory.writeMappedU32LE(functionAddress + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, codeAddress);
	memory.writeMappedU32LE(codeByteCountAddress, INSTRUCTION_BYTES);
	memory.writeMappedU32LE(numParamsAddress, 0);
	memory.writeMappedU32LE(functionAddress + BLUA32_FUNCTION_MAX_STACK_OFFSET, 1);
	memory.writeMappedU32LE(functionAddress + BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_STATIC);
	memory.writeMappedU32LE(functionAddress + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, 0);
	memory.writeMappedU32LE(functionAddress + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, 0);
	const mappedCode = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(mappedCode, 0, OpCode.CALL, 0, encodeFixedCallArgCount(0), 0, 0);
	memory.writeBytes(codeAddress, mappedCode);
	cpu.beginCompletionCall(new Closure(functionAddress, [], 0));
	runToSupervisorFault(runtime);

	const luaSources: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entrySourcePath: sourcePath,
		projectRootPath: '',
		can_boot_from_source: true,
		revision: 0,
	};
	registerLuaSourceRecord(luaSources, {
		resid: sourcePath,
		type: 'lua',
		src: source,
		base_src: source,
		source_path: sourcePath,
		normalized_source_path: `workspace/${sourcePath}`,
		module_path: 'runtime_fault_state',
		update_timestamp: 0,
		base_update_timestamp: 0,
		generated: false,
		sourceKind: 'project', program_module: true,
	});
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, luaSources);
	// The hand-written instruction fixture supplies its own exact source proof;
	// the ROM deliberately has no packed source directory.
	sources.currentBlua32Media = { ...sources.currentBlua32Media,
		system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports,
			new Map([[sourceRange.path, { displayPath: sourcePath, content: { kind: 'text', text: source } }]]), TEST_SYSTEM_CONTEXT_ID) };
	const fault = createRuntimeFaultState();
	const messages: string[] = [];
	const logOutput = {
		log: (_level: number, message: string) => {
			messages.push(message);
		},
	};
	handleSupervisorFault(
		logOutput,
		fault,
		sources,
		runtime,
		new SuspendedGuestSession(runtime),
	);

	assert.equal(fault.lastCpuFaultSnapshot.length, 1);
	assert.equal(fault.lastCpuFaultSnapshot[0].functionIndex, -1);
	assert.equal(fault.lastCpuFaultSnapshot[0].codeAddress, codeAddress);
	assert.equal(fault.lastLuaCallStack[0].functionName, `function@${functionAddress.toString(16)}`);
	assert.equal(fault.lastLuaCallStack[0].kind, 'instruction');
	assert.equal(fault.lastLuaCallStack[0].instructionAddress, codeAddress);
	assert.equal(fault.faultSnapshot.resource, undefined, 'unmapped RAM instructions do not fabricate an authored entry source');
	assert.match(messages.join('\n'), /op=CALL/);

	cpu.reset();
	cpu.abortCompletionCall(0);
	memory.writeMappedU32LE(codeByteCountAddress, 2 * INSTRUCTION_BYTES);
	memory.writeMappedU32LE(numParamsAddress, 1);
	const mappedCallerCode = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(
		mappedCallerCode,
		0,
		OpCode.CALL,
		0,
		encodeFixedCallArgCount(0),
		0,
		0,
	);
	writeInstruction(mappedCallerCode, 1, OpCode.RET, 0, 0, 0, 0);
	memory.writeBytes(codeAddress, mappedCallerCode);
	cpu.beginCompletionCall(
		new Closure(functionAddress, [], 0),
		[new Closure(image.symbols.functionAddresses[1], [], 0)],
	);
	runToSupervisorFault(runtime);

	const mixedFault = createRuntimeFaultState();
	handleSupervisorFault(
		logOutput,
		mixedFault,
		sources,
		runtime,
		new SuspendedGuestSession(runtime),
	);
	assert.equal(mixedFault.lastCpuFaultSnapshot.length, 2);
	const sourceFrame = mixedFault.lastLuaCallStack[0];
	assert.equal(sourceFrame.functionName, 'source_target');
	assert.ok(sourceFrame.kind === 'source');
	assert.deepEqual(sourceFrame.resource, { contextId: TEST_SYSTEM_CONTEXT_ID, path: sourcePath });
	assert.equal(readBlua32CompiledSource(mixedFault.faultSnapshot.details.sources.get(sourceFrame)!), source);
	assert.equal(mixedFault.lastLuaCallStack[1].functionName, `function@${functionAddress.toString(16)}`);
	assert.equal(mixedFault.lastLuaCallStack[1].kind, 'instruction');
	assert.equal(mixedFault.lastLuaCallStack[1].instructionAddress, codeAddress);
	assert.deepEqual(mixedFault.faultSnapshot.resource, { contextId: TEST_SYSTEM_CONTEXT_ID, path: sourcePath });

});
