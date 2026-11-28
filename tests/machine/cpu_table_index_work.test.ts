import { integerConstant } from '../../toolchain/ts/lua/number';
import { readStockGlobalValue } from '../../toolchain/ts/firmware/stock_global_bank';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { reserveThreadFrameReference } from '../helpers/thread_allocation_reference';
import { runGuestToHalt, captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { RunResult, type CPU } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';

import { hashCanonicalTableKey, ValueTag, valueBool, valueFloat, valueInteger, valueNil, valueTable, valueString, type Value, valuePayload } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE, MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { COP0_STRING_INDEX_TABLE, LUA_FAULT_REASON_METATABLE_LOOP } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { compileCoroutineTest } from '../helpers/coroutine';
import { materializeCpuCompletionValues } from '../helpers/cpu_test_harness';

const forms = [[OpCode.GETFIELD, 'string'], [OpCode.SELF, 'string'], [OpCode.GETT, 'string'],
	[OpCode.GETI, 'number'], [OpCode.GETT, 'number'], [OpCode.GETT, 'boolean']] as const;

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`function __index calls retain the WIDE frontier, detached arguments and one-result placement (${backend})`, () => {
		for (const op of [OpCode.GETT, OpCode.GETI, OpCode.GETFIELD, OpCode.SELF]) {
			const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
			writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, 1, OpCode.LOADK, 10, 0, 1);
			writeInstruction(text, 2, OpCode.MOV, 6, 0, 0);
			writeInstruction(text, 3, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, 4, op, 6, 6, op === OpCode.GETT || op === OpCode.GETI ? 1 : 0);
			writeInstruction(text, 5, OpCode.MOV, 8, 6, 0);
			writeInstruction(text, 6, OpCode.JMP, 0, 63, 59, 255);
			writeInstruction(text, 7, OpCode.RET, 1, 2, 0);
			const image = linkRawTestSystemBlua32({ text, verifiedControlFlow: true, constants: ['field', integerConstant(0)], functions: [
				{ firstWord: 0, wordCount: 7, maxStack: 16 },
				{ firstWord: 7, wordCount: 1, numParams: 2, maxStack: 8 },
			], constValueRelocs: [{ constIndex: 1, kind: 'code_function', target: { kind: 'proto', protoIndex: 1 } }] });
			const { cpu } = createTestSystemCpu(image, backend);
			reserveThreadFrameReference(cpu, cpu.rootThread, 24); // Measure the call once its Value and frame space is available.
			let frame = cpu.rootThread.currentFrame!;
			const base = frame.pc, loop = base + 2 * INSTRUCTION_BYTES, read = base + 3 * INSTRUCTION_BYTES;
			const indexKey = nativeHeapReference(cpu).stringPool.intern('__index');
			const key = op === OpCode.GETT ? valueFloat(1) : op === OpCode.GETI ? valueInteger(1) : valueString(nativeHeapReference(cpu).stringPool.intern('field'));
			const table = createReferenceTable(cpu), forwarded = createReferenceTable(cpu);
			const meta = createReferenceTable(cpu, 0, 1), forwardedMeta = createReferenceTable(cpu, 0, 1);
			nativeHeapReference(cpu).gc.tables.set(table, key, valueBool(false));
			frame.registers.setTable(0, table); frame.registers.set(1, key);
			frame.registers.setInteger(12, 91); frame.top = 13;
			const readCycles = BASE_CYCLES[op];
			cpu.runUntilDepth(0, BASE_CYCLES[OpCode.LOADK]);
			cpu.runUntilDepth(0, (readCycles + 6) * 68);
			if (backend === CpuExecutionBackend.JavaScript)
				assert.ok(frame.decodedPage!.compiledBlocks!.entries[(loop & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
			nativeHeapReference(cpu).gc.tables.setStringKey(meta, indexKey, valueTable(forwarded));
			nativeHeapReference(cpu).gc.tables.setStringKey(forwardedMeta, indexKey, frame.registers.get(10));
			nativeHeapReference(cpu).gc.tables.setMetatableAddress(table, meta); nativeHeapReference(cpu).gc.tables.setMetatableAddress(forwarded, forwardedMeta);
			nativeHeapReference(cpu).gc.tables.set(table, key, valueNil());
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], loop);
			frame.registers.setInteger(8, 57);
			assert.equal(cpu.runUntilDepth(0, 3), RunResult.Yielded);
			assert.equal(3 - cpu.instructionBudgetRemaining, 2 + readCycles + 8 + 2);
			const callback = cpu.rootThread.currentFrame!;
			assert.equal(cpu.rootThread.frameDepth, 2);
			assert.equal(callback.callSitePc, read);
			assert.equal(callback.registers.get(0), valueTable(forwarded));
			assert.equal(callback.registers.get(1), key, 'callback gets the original key, not the normalized table key');
			assert.equal(frame.registers.get(6), valueTable(table), 'aliased destination has not received its result yet');
			assert.equal(frame.registers.getInteger(8), 57);
			if (op === OpCode.SELF) assert.equal(frame.registers.get(7), valueTable(table));
			const checkpoint = captureCpuCheckpoint(cpu);
			for (let replay = 0; replay < 2; ++replay) {
				assert.equal(cpu.runUntilDepth(1, 1), RunResult.Halted);
				assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.RET] + 1);
				frame = cpu.rootThread.currentFrame!;
				assert.equal(frame.registers.get(6), key);
				assert.equal(frame.registers.getInteger(12), 91);
				assert.equal(frame.top, 13);
				assert.equal(frame.pc, base + 5 * INSTRUCTION_BYTES);
				if (replay === 0) restoreCpuCheckpoint(cpu, checkpoint);
			}
		}
	});

	test(`a yielding __index function survives coroutine checkpoint and preserves outer results (${backend})`, () => {
		const image = compileCoroutineTest(`
local receiver = setmetatable({}, { __index = coroutine.yield })
local task = coroutine.create(function(a, b)
  local result = receiver.name
  return result, a, b
end)
local ok, actual_receiver, key = coroutine.resume(task, 41, 42)
assert(ok, actual_receiver)
assert(actual_receiver == receiver, 'wrong receiver')
assert(key == 'name', 'wrong key')
waiting_to_resume = true
halt_until_irq
local completed, result, a, b = coroutine.resume(task, 73, 99)
assert(completed and result == 73 and a == 41 and b == 42)
local nested = setmetatable({}, { __index = xpcall })
local handler = pcall
local function read(case, held)
  local v = case[handler]
  return v, held
end
local v, held = read(nested, 91)
assert(v == false and held == 91)
return true`, 0);
		const { cpu } = createTestSystemCpu(image, backend);
		runGuestToHalt(cpu, 1_000_000);
		assert.ok(cpu.isHaltedUntilIrq());
		assert.equal(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('waiting_to_resume')!), valueBool(true));
		const saved = captureCpuCheckpoint(cpu);
		let expected: ReturnType<typeof captureCpuCheckpoint>;
		for (let replay = 0; replay < 2; ++replay) {
			cpu.clearHaltUntilIrq();
			runGuestToHalt(cpu, 100_000);
			assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
			const completed = captureCpuCheckpoint(cpu);
			if (replay === 0) {
				expected = completed;
				restoreCpuCheckpoint(cpu, saved);
			} else assert.deepEqual(completed, expected!);
		}
	});
}

function readProgram(op: OpCode, wide: boolean, collisionKeys: readonly string[] = []) {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE), starts: number[] = [];
	let word = 0;
	for (const [code, a, b, c] of [[OpCode.MOV, 6, 0, 0], [op, 6, 6, op === OpCode.GETFIELD || op === OpCode.SELF ? 0 : 1],
		[OpCode.MOV, 8, 6, 0]]) {
		starts.push(word); if (wide) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, word++, code, a, b, c);
	}
	starts.push(word);
	writeInstruction(text, word, OpCode.JMP, 0, 63, (starts[0] - word - 1) & 63, 255);
	writeInstruction(text, 64, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, constants: ['field', ...collisionKeys], functions: [
		{ firstWord: 0, wordCount: word + 1, maxStack: 24 }, { firstWord: 64, wordCount: 1 }], exceptionFunctionIndex: 1 });
	return { image, starts };
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`direct __index probes consume the instruction grant for every indexed-read form (${backend})`, () => {
		for (const [op, kind] of forms) for (const inherited of [false, true]) {
			const { image } = readProgram(op, false), { cpu } = createTestSystemCpu(image, backend);
			const frame = cpu.rootThread.currentFrame!, start = frame.pc;
			const root = createReferenceTable(cpu), meta = createReferenceTable(cpu, 0, 128), parent = createReferenceTable(cpu, 2, 1);
			const key = kind === 'string' ? valueString(nativeHeapReference(cpu).stringPool.intern('field')) : kind === 'number' ? valueInteger(1) : valueBool(false);
			const method = valueString(nativeHeapReference(cpu).stringPool.intern('__index'));
			frame.registers.setTable(0, root); frame.registers.set(1, key);
			nativeHeapReference(cpu).gc.tables.setMetatableAddress(root, meta); nativeHeapReference(cpu).gc.tables.set(parent, key, valueBool(false));
			for (let i = 0, n = 0; i < 96; ++i) {
				if (inherited && i === 1) nativeHeapReference(cpu).gc.tables.set(meta, method, valueTable(parent));
				else {
					let other: Value;
					do other = valueInteger(n++); while (((hashCanonicalTableKey(other) ^ hashCanonicalTableKey(method)) & 127) !== 0);
					nativeHeapReference(cpu).gc.tables.set(meta, other, valueInteger(i));
				}
			}
			const total = 2 + BASE_CYCLES[op] + (inherited ? 32 + 8 : 95);
			cpu.runUntilDepth(0, (total + 4) * 68);
			for (const grant of [3, total, total + 1]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
				frame.registers.setInteger(8, 91);
				assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
				const marker = grant > total, expected = inherited ? valueBool(false) : valueNil();
				assert.equal(cpu.instructionBudgetRemaining, grant - total - (marker ? 2 : 0));
				assert.equal(frame.registers.get(6), expected);
				assert.equal(frame.registers.get(8), marker ? expected : valueInteger(91));
			}
			if (inherited) {
				nativeHeapReference(cpu).gc.tables.set(meta, method, valueTable(root));
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
				cpu.runUntilDepth(0, 3);
				assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_METATABLE_LOOP);
				assert.equal(3 - cpu.instructionBudgetRemaining, 2 + BASE_CYCLES[op] + 32 * 32 + 31 * 8);
			}
		}
	});

	test(`a trained String slot pays for its current chain depth, including after restore (${backend})`, () => {
		for (const op of [OpCode.GETFIELD, OpCode.GETT, OpCode.SELF]) {
			const { image } = readProgram(op, false), { cpu } = createTestSystemCpu(image, backend);
			let frame = cpu.rootThread.currentFrame!;
			const start = frame.pc, root = createReferenceTable(cpu, 0, 128), key = valueString(nativeHeapReference(cpu).stringPool.intern('field'));
			frame.registers.setTable(0, root); frame.registers.set(1, key);
			let n = 0, placed = 0;
			for (const depth of [64, 65, 96]) {
				while (placed < depth) {
					if (placed === 1) nativeHeapReference(cpu).gc.tables.set(root, key, valueInteger(73));
					else {
						let other: Value;
						do other = valueInteger(n++); while (((hashCanonicalTableKey(other) ^ hashCanonicalTableKey(key)) & 127) !== 0);
						nativeHeapReference(cpu).gc.tables.set(root, other, valueBool(false));
					}
					++placed;
				}
				const charge = 2 + BASE_CYCLES[op] + depth - 64;
				cpu.runUntilDepth(0, (charge + 4) * 68);
				if (backend === CpuExecutionBackend.JavaScript)
					assert.ok(frame.decodedPage!.compiledBlocks!.entries[(start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
				const saved = captureCpuCheckpoint(cpu);
				for (const grant of [3, charge, charge + 1]) {
					frame.registers.setInteger(8, 91);
					assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
					const marker = grant > charge;
					assert.equal(cpu.instructionBudgetRemaining, grant - charge - (marker ? 2 : 0));
					assert.equal(frame.registers.get(6), valueInteger(73));
					assert.equal(frame.registers.getInteger(8), marker ? 73 : 91);
					restoreCpuCheckpoint(cpu, saved);
					frame = cpu.rootThread.currentFrame!;
				}
			}
			nativeHeapReference(cpu).gc.tables.set(root, key, valueNil());
			chain(cpu, root, 2, key, valueBool(false));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
			cpu.runUntilDepth(0, 3);
			assert.equal(3 - cpu.instructionBudgetRemaining, 2 + BASE_CYCLES[op] + 32 + 8);
			assert.equal(frame.registers.get(6), valueBool(false));
		}
	});

	test(`an exhausted eight-node String chain charges seven cycles before its successor (${backend})`, () => {
		// Equal-sized ROM String records walk all eight homes, independently
		// of the heap geometry or collector progress of this VM.
		const names = Array.from({ length: 72 }, (_, index) => `chain${String(index).padStart(3, '0')}`);
		for (const op of [OpCode.GETFIELD, OpCode.GETT, OpCode.SELF]) {
		const { image } = readProgram(op, false, names), { cpu } = createTestSystemCpu(image, backend);
			const frame = cpu.rootThread.currentFrame!, start = frame.pc;
			const key = valueString(nativeHeapReference(cpu).stringPool.intern('field')), root = createReferenceTable(cpu, 0, 8);
			frame.registers.setTable(0, root); frame.registers.set(1, key); frame.top = 2;
			const collisions = names.map(name => valueString(nativeHeapReference(cpu).stringPool.intern(name)))
				.filter(candidate => ((hashCanonicalTableKey(candidate) ^ hashCanonicalTableKey(key)) & 7) === 0);
			assert.ok(collisions.length >= 8);
			for (let i = 0; i < 8; ++i) nativeHeapReference(cpu).gc.tables.set(root, collisions[i], valueInteger(i + 1));
			const total = 2 + BASE_CYCLES[op] + 7;
			cpu.runUntilDepth(0, (total + 4) * 68);
			if (backend === CpuExecutionBackend.JavaScript)
				assert.ok(frame.decodedPage!.compiledBlocks!.entries[(start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
			for (const grant of [3, total - 1, total, total + 1]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
				frame.registers.setInteger(8, 91);
				assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
				const marker = grant > total;
				assert.equal(cpu.instructionBudgetRemaining, grant - total - (marker ? 2 : 0));
				assert.equal(frame.registers.get(6), valueNil());
				assert.equal(frame.registers.get(8), marker ? valueNil() : valueInteger(91));
			}
			const meta = createReferenceTable(cpu, 0, 1);
			nativeHeapReference(cpu).gc.tables.setStringKey(meta, nativeHeapReference(cpu).stringPool.intern('__index'), valueTable(root));
			nativeHeapReference(cpu).gc.tables.setMetatableAddress(root, meta);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
			cpu.runUntilDepth(0, 3);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_METATABLE_LOOP);
			assert.equal(3 - cpu.instructionBudgetRemaining, total + 31 * (8 + 7));
		}
	});
}

function chain(cpu: CPU, root: number, depth: number, key: Value, value: Value): number {
	let current = root;
	for (let i = 1; i < depth; ++i) {
		const next = createReferenceTable(cpu, 2, 2), meta = createReferenceTable(cpu, 0, 1);
		nativeHeapReference(cpu).gc.tables.setStringKey(meta, nativeHeapReference(cpu).stringPool.intern('__index'), valueTable(next)); nativeHeapReference(cpu).gc.tables.setMetatableAddress(current, meta); current = next;
	}
	nativeHeapReference(cpu).gc.tables.set(current, key, value);
	return current;
}

for (const backend of [CpuExecutionBackend.Interpreter]) for (const wide of [false, true]) {
	test(`semantic inherited visits retain every grant frontier and aliased read (${backend}, WIDE=${wide})`, () => {
		for (const [op, kind] of forms) for (const depth of [1, 2, 3, 5, 32]) {
			const { image, starts } = readProgram(op, wide), { cpu } = createTestSystemCpu(image, backend);
			let frame = cpu.rootThread.currentFrame!;
			const base = frame.pc, loop = base + starts[0] * INSTRUCTION_BYTES;
			const key = kind === 'string' ? valueString(nativeHeapReference(cpu).stringPool.intern('field')) : kind === 'number' ? valueInteger(1) : valueBool(false);
			const root = createReferenceTable(cpu, 2, 2); nativeHeapReference(cpu).gc.tables.set(root, key, valueBool(false));
			frame.registers.setTable(0, root); frame.registers.set(1, key);
			const ownLoop = 2 + (op === OpCode.SELF ? 17 : op === OpCode.GETI ? 8 : 16) + 2 + 2;
			cpu.runUntilDepth(0, ownLoop * 64);
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(loop & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
			nativeHeapReference(cpu).gc.tables.set(root, key, valueNil()); chain(cpu, root, depth, key, valueBool(false));
			if (depth === 1) {
				const meta = createReferenceTable(cpu, 0, 1); nativeHeapReference(cpu).gc.tables.setStringKey(meta, nativeHeapReference(cpu).stringPool.intern('__index'), valueTable(root)); nativeHeapReference(cpu).gc.tables.setMetatableAddress(root, meta);
			}
			const lookup = (op === OpCode.SELF ? 17 : op === OpCode.GETI ? 8 : 16) + 8 * (depth - 1);
			const charges = [2, lookup, 2, 2], total = charges.reduce((a, b) => a + b, 0);
			const heap = nativeHeapReference(cpu).luaHeap.usedBytes();
			for (let grant = 0; grant <= total; ++grant) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], loop);
				frame.registers.setInteger(6, 91); frame.registers.setNil(7); frame.registers.setInteger(8, 57);
				frame.top = 2;
				assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
				let remaining = grant, completed = 0;
				while (remaining > 0) remaining -= charges[completed++];
				assert.equal(cpu.instructionBudgetRemaining, remaining, `${op}/${kind}/${depth}/${grant}: complete semantic debt`);
				assert.equal(frame.pc, base + starts[completed === 4 ? 0 : completed] * INSTRUCTION_BYTES);
				const top = completed >= 3 ? 9 : completed === 2 && op === OpCode.SELF ? 8 : completed !== 0 ? 7 : 2;
				assert.equal(frame.top, top, 'the exhausted grant publishes only results written by admitted instructions');
				if (completed === 2) {
					const readPc = base + starts[1] * INSTRUCTION_BYTES;
					assert.equal(cpu.readCurrentInstructionPc(), readPc);
					assert.equal(cpu.lastPc, readPc + (wide ? INSTRUCTION_BYTES : 0), 'the final admitted WIDE body owns lastPc');
				}
				assert.equal(frame.registers.get(6), completed >= 2 ? valueBool(false) : completed === 1 ? valueTable(root) : valueInteger(91));
				assert.equal(frame.registers.get(8), completed >= 3 ? valueBool(false) : valueInteger(57), 'following marker obeys the inherited-read frontier');
				assert.equal(frame.registers.get(7), op === OpCode.SELF && completed >= 2 ? valueTable(root) : valueNil());
			}
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), heap, 'warm/cold hints and repeated reads allocate no guest storage');
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], loop);
			const memory = cpu.memory.captureSaveState(), saved = cpu.captureRuntimeState();
			cpu.runUntilDepth(0, 3); const debt = cpu.instructionBudgetRemaining, after = cpu.captureRuntimeState();
			cpu.memory.restoreSaveState(memory); cpu.restoreRuntimeState(saved); cpu.runUntilDepth(0, 3);
			frame = cpu.rootThread.currentFrame!;
			assert.equal(cpu.instructionBudgetRemaining, debt);
			assert.ok(isDeepStrictEqual(cpu.captureRuntimeState(), after), 'restore reproduces depth/work without derived slot-cache state');
		}
	});

	test(`attempted32 visits fault once without destination or following-instruction commit (${backend}, WIDE=${wide})`, () => {
		for (const [op, kind] of forms) for (const cyclic of [false, true]) {
			const { image, starts } = readProgram(op, wide), { cpu } = createTestSystemCpu(image, backend);
			const frame = cpu.rootThread.currentFrame!, base = frame.pc;
			const key = kind === 'string' ? valueString(nativeHeapReference(cpu).stringPool.intern('field')) : kind === 'number' ? valueInteger(1) : valueBool(false);
			const root = createReferenceTable(cpu, 2, 2); nativeHeapReference(cpu).gc.tables.set(root, key, valueInteger(73));
			frame.registers.setTable(0, root); frame.registers.set(1, key);
			cpu.runUntilDepth(0, (2 + (op === OpCode.SELF ? 17 : op === OpCode.GETI ? 8 : 16) + 2 + 2) * 64);
			nativeHeapReference(cpu).gc.tables.set(root, key, valueNil());
			if (cyclic) {
				const meta = createReferenceTable(cpu, 0, 1); nativeHeapReference(cpu).gc.tables.setStringKey(meta, nativeHeapReference(cpu).stringPool.intern('__index'), valueTable(root)); nativeHeapReference(cpu).gc.tables.setMetatableAddress(root, meta);
			} else chain(cpu, root, 33, key, valueInteger(73));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
			frame.registers.setInteger(8, 57);
			cpu.runUntilDepth(0, 3);
			assert.equal(3 - cpu.instructionBudgetRemaining, 2 + (op === OpCode.SELF ? 17 : op === OpCode.GETI ? 8 : 16) + 248);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_METATABLE_LOOP);
			assert.equal(cpu.readEpcWord(), base + starts[1] * INSTRUCTION_BYTES, 'WIDE fault belongs to prefix start');
			assert.equal(frame.registers.get(6), valueTable(root), 'failed inherited read retains original aliased destination');
			assert.equal(frame.registers.getInteger(8), 57);
			if (op === OpCode.SELF) assert.equal(frame.registers.get(7), valueTable(root), 'SELF retains its preceding receiver publication');
		}
	});

	test(`String receiver starts at installed index Table and follows live prototype replacement (${backend}, WIDE=${wide})`, () => {
		const { image, starts } = readProgram(OpCode.GETFIELD, wide), { cpu } = createTestSystemCpu(image, backend);
		const frame = cpu.rootThread.currentFrame!, base = frame.pc, key = valueString(nativeHeapReference(cpu).stringPool.intern('field'));
		const installed = createReferenceTable(cpu, 0, 2); nativeHeapReference(cpu).gc.tables.set(installed, key, valueInteger(19));
		cpu['cop0Words'][COP0_STRING_INDEX_TABLE] = installed;
		frame.registers.set(0, valueString(nativeHeapReference(cpu).stringPool.intern('receiver')));
		cpu.runUntilDepth(0, 22 * 64);
		nativeHeapReference(cpu).gc.tables.set(installed, key, valueNil()); chain(cpu, installed, 3, key, valueInteger(73));
		const loop = base + starts[0] * INSTRUCTION_BYTES;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], loop);
		frame.registers.setInteger(8, 57); cpu.runUntilDepth(0, 3);
		assert.equal(cpu.instructionBudgetRemaining, 3 - 2 - 32);
		assert.equal(frame.registers.getInteger(6), 73); assert.equal(frame.registers.getInteger(8), 57);
		nativeHeapReference(cpu).gc.tables.setStringKey(cpu.tables.metatableAddress(installed), nativeHeapReference(cpu).stringPool.intern('__index'), valueTable(createReferenceTable(cpu)));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], loop);
		cpu.runUntilDepth(0, 3);
		assert.equal(cpu.instructionBudgetRemaining, 3 - 2 - 24);
		assert.equal(frame.registers.get(6), valueNil(), 'missing terminal mapping is resolved nil, not a fault');
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
}
