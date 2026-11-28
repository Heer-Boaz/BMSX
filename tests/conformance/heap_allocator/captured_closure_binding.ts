import { MANAGED_CART_LAUNCH } from '../../helpers/managed_cart_launch';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CLOSURE_BINDING_FLAGS, CLOSURE_CAPTURE_WORDS, CLOSURE_LATCHED_PROTOTYPE } from '../../../machine/ts/machine/cpu/closure';
import { valueInteger, valuePayload } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { LUA_FAULT_REASON_INVALID_ARGUMENT, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_NUM_PARAMS_OFFSET, BLUA32_FUNCTION_RECORD_SIZE,
	BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, BLUA32_IMAGE_FLAGS_OFFSET,
	BLUA32_IMAGE_MAPPED_CODE_FLAG, BLUA32_UPVALUE_INDEX_MASK } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { FIRMWARE_DATA_OFFSET } from '../../helpers/firmware_heap_layout';
import { BUS_FAULT_ACCESS_READ, BUS_FAULT_ACCESS_U32, BUS_FAULT_UNMAPPED, IO_RETAINED_WORD_BASE, IO_SYS_BUS_FAULT_ACCESS, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE } from '../../../machine/ts/spec/bmsx/io';
import { MAPPED_BUS_MASTER_CPU } from '../../../machine/ts/machine/memory/bus_signals';
import { CART_ROM_BASE, MAIN_RAM_SIZE, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { rewriteResolvedABx } from '../../../toolchain/ts/rompack/blua32_linker';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { linkTestBlua32Pair, linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
// Actual compiler output, deliberately more capture entries than all pinned Value slots.
const names = Array.from({ length: 513 }, (_, index) => `c${index}`);
const expect = names.length * 2;
const source = `
local function make(value)
	local ${names.join(',')} = ${names.map(() => 'value').join(',')}
	local function keep()
		local total = 0
		${names.map(name => `total = total + ${name}`).join('\n')}
		return total
	end
	return keep
end
local closure = make(2)
return closure()
`;

const boot = MANAGED_CART_LAUNCH;

// BIOS closure_work layout; the source-map test checks its field sizes.
const captureLimit = 1024;
const newCellsOffset = 4 * captureLimit;
const missingOffset = 2 * newCellsOffset;
const workspaceBytes = missingOffset + (captureLimit >>> 5) * 4;

const folder = mkdtempSync(join('tmp', 'bmsx-captured-closure-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) for (const domain of ['system', 'cart'] as const) {
		const link = () => {
			if (domain === 'system') {
				const linked = linkTestSystemBlua32(compileHeapServiceSystem(source, optLevel));
				return { layout: linked.image, system: linked.romBytes, cart: null };
			}
			const compiled = compileLuaChunkToProgram(parseLuaChunk(source), [], { entrySource: source, optLevel });
			const pair = linkTestBlua32Pair(compileHeapServiceSystem(boot, optLevel), compiled);
			return { layout: pair.cartImage, system: pair.systemRomBytes, cart: pair.cartRomBytes };
		};
		const { layout, system, cart } = link(), { textAddress } = layout.header;
		const target = layout.functions.find(fn => fn.upvalues.length === names.length);
		assert.ok(target);
		const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const arena = nativeHeapReference(cpu).heapAllocator;
		const workspace = arena.managementOffset() + FIRMWARE_DATA_OFFSET;
		const cells = workspace + newCellsOffset, bits = workspace + missingOffset;
		const history = new RamHistory();
		history.start(memory);
		const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		function atIssue() {
			if (!cpu.getFrameDepth() || cpu.fixedInterruptActive() || cpu.activeCartridgeSlot() !== (domain === 'system' ? -1 : 0)) return false;
			const pc = cpu.readFramePc(cpu.getFrameDepth() - 1);
			const instruction = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, pc);
			return instruction.op === OpCode.CLOSURE && instruction.bx * 16 === target!.address;
		}
		for (let i = 0; i < 8192 && !atIssue(); ++i)
			assert.notEqual(slice(cpu.fixedInterruptActive() ? 193 : 1), RunResult.Halted);
		assert.ok(atIssue());
		const stem = join(folder, `O${optLevel}-${domain}`);
		const rom = stem + '.rom', seed = stem + '.seed';
		const checkpoint = stem + '.checkpoint', cpp = stem + '.cpp';
		const issueCheckpoint = stem + '.issue-checkpoint', cppIssue = stem + '.issue-cpp';
		writeFileSync(rom, system);
		const cartMedia = cart === null ? [] : [stem + '.cart'];
		if (cart !== null) writeFileSync(cartMedia[0], cart);
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const commands: string[] = [], rows: string[] = [];
		function grant(cycles: number) {
			const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;
			commands.push(`J ${cycles} 1`);
			rows.push(`${result} ${spent} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
			return spent;
		}
		const initialPages = history.capture(memory, null);
		assert.equal(grant(1), BASE_CYCLES[OpCode.CLOSURE]);
		assert.ok(cpu.fixedInterruptActive());
		for (let n = 0; n < 8192 && memory.readRamRecordWord(bits + 48) === 0; ++n) grant(127);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(memory.readRamRecordWord(bits + 48), 0xffffffff, '416 descriptors staged');
		assert.equal(memory.readRamRecordWord(bits + 64), 0, 'the final descriptor is not yet staged');
		assert.equal(memory.readRamRecordWord(cells), 0, 'reservation has not issued a Cell');
		const partialState = captureRuntimeCheckpointState(runtime);
		const partialPages = history.capture(memory, initialPages);
		const partial = captureRuntimeSaveState(runtime);
		const plan = partial.ram.slice(workspace, workspace + workspaceBytes);
		writeFileSync(checkpoint, encodeRuntimeSaveState(partial));
		const split = commands.length, logicalBeforeReservation = nativeHeapReference(cpu).luaHeap.usedBytes();
		for (let n = 0; n < 8192 && memory.readRamRecordWord(cells + 32 * 4) === 0; ++n) grant(221);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(memory.readRamRecordWord(bits + 64), 1, 'the final descriptor went into the last bitmap word');
		assert.notEqual(memory.readRamRecordWord(cells + 32 * 4), 0);
		assert.equal(memory.readRamRecordWord(cells + (names.length - 1) * 4), 0);
		const issued = captureRuntimeSaveState(runtime);
		const issuedPlan = issued.ram.slice(workspace, workspace + workspaceBytes);
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logicalBeforeReservation,
			'partial reservation has not published logical ownership');
		writeFileSync(issueCheckpoint, encodeRuntimeSaveState(issued));
		const phase = commands.length;
		function drain() {
			for (let n = 0; n < 4096 && cpu.getFrameDepth(); ++n) grant(289);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(expect)]);
			commands.push('C');
			rows.push(String(expect));
			const probe = RAM_BASE + cells + 32 * 4, savedCell = memory.readRamRecordWord(probe);
			const sequence = memory.readBusFaultSequence();
			assert.notEqual(savedCell, 0);
			assert.equal(memory.readMappedWord(probe), 0);
			memory.writeMappedWord(probe, 0);
			assert.equal(memory.readBusFaultSequence(), sequence + 2);
			assert.equal(memory.readRamRecordWord(probe), savedCell);
			commands.push(`M ${probe}`, `O ${probe} 0`);
			rows.push('0 1');
			const first = memory.ramBusEnd() - RAM_BASE, last = memory.ramData().length;
			commands.push(`H ${first} ${last}`);
			rows.push(String(hashBytes(memory.ramData(), first, last - first)));
		}
		drain();
		const tail = commands.slice(split), after = rows.slice(split);
		function nativeCheck(name: string, state: string, trace: string[], expected: string[]) {
			const file = stem + name + '.trace';
			writeFileSync(file, trace.join('\n'));
			const actual = execFileSync(native, [rom, file, state, ...cartMedia], { encoding: 'utf8' }).trimEnd().split('\n');
			const mismatch = actual.findIndex((row, i) => row !== expected[i]);
			assert.equal(mismatch, -1, `${name} row ${mismatch}: TS ${expected[mismatch]} C++ ${actual[mismatch]}`);
			assert.equal(actual.length, expected.length);
		}
		nativeCheck('cold', seed, ['X', ...commands.slice(0, split), `x ${cpp}`,
			...commands.slice(split, phase), `x ${cppIssue}`, ...commands.slice(phase)], rows);
		nativeCheck('issue', issueCheckpoint, ['X', ...commands.slice(phase)], rows.slice(phase));
		const restoredIssue = decodeRuntimeSaveState(readFileSync(cppIssue), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.deepEqual(restoredIssue.ram.subarray(workspace, workspace + workspaceBytes), issuedPlan);
		nativeCheck('restore', checkpoint, ['X', ...tail], after);
		const restored = decodeRuntimeSaveState(readFileSync(cpp), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.deepEqual(restored.ram.subarray(workspace, workspace + workspaceBytes), plan);
		nativeCheck('rewind', seed, ['X', 'l', ...commands.slice(0, split), 's', ...tail, 'u', ...tail], [...rows, ...after]);
		const endPages = history.capture(memory, partialPages);
		history.restore(memory, endPages, partialPages);
		applyRuntimeCheckpointState(runtime, partialState, RuntimeRestoreOrigin.HistorySeek);
		assert.deepEqual(memory.ramData().subarray(workspace, workspace + workspaceBytes), plan);
		commands.length = rows.length = split;
		for (let i = split; i < phase; ++i) grant(221);
		drain();
		assert.deepEqual(commands.slice(split), tail);
		assert.deepEqual(rows.slice(split), after);
		applyRuntimeSaveState(runtime, restored);
		assert.deepEqual(memory.ramData().subarray(workspace, workspace + workspaceBytes), plan);
		console.log(`CAPTURED-CLOSURE:PASS O${optLevel} ${domain} (${names.length} captures; staged and issued RAM; exact grants, portable restore and rewind)`);
	}
	const descriptorSource = `
bss descriptors: word[2]
local function make(a, b)
	return function() return a * 100 + b end
end
return make(7, 8)()
`;
	for (const optLevel of [0, 3] as const) {
		const { image, romBytes } = linkTestSystemBlua32(compileHeapServiceSystem(descriptorSource, optLevel));
		const target = image.functions.find(fn => fn.upvalues.length === 2)!;
		const originals = [readLE32(romBytes, target.upvalueTableAddress), readLE32(romBytes, target.upvalueTableAddress + 4)];
		for (const test of ['ram-sampled-once', 'mmio-sampled-once', 'invalid-before-bus-fault', 'invalid-second-stack', 'invalid-second-parent', 'bus-fault'] as const) {
			const rom = romBytes.slice();
			const mmio = test === 'mmio-sampled-once', sampled = mmio || test === 'ram-sampled-once';
			const invalidSecond = test === 'invalid-second-stack' || test === 'invalid-second-parent';
			const descriptor = invalidSecond ? target.upvalueTableAddress
				: mmio ? IO_RETAINED_WORD_BASE : sampled ? image.header.bssAddress : rom.length - 4;
			writeLE32(rom, target.address + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, descriptor);
			if (invalidSecond)
				writeLE32(rom, descriptor + 4, test === 'invalid-second-stack' ? 0xffffffff : BLUA32_UPVALUE_INDEX_MASK);
			else if (!sampled)
				writeLE32(rom, descriptor, test === 'bus-fault' ? originals[0] : 0xffffffff);
			const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine;
			const arena = nativeHeapReference(cpu).heapAllocator;
			const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const atIssue = () => {
				if (cpu.fixedInterruptActive() || cpu.getFrameDepth() === 0) return false;
				const pc = cpu.readFramePc(cpu.getFrameDepth() - 1);
				const instruction = decodeBlua32InstructionAtPc(image.textBytes, image.header.textAddress, pc);
				return instruction.op === OpCode.CLOSURE && instruction.bx * 16 === target.address;
			};
			for (let i = 0; i < 8192 && !atIssue(); ++i)
				assert.notEqual(slice(cpu.fixedInterruptActive() ? 193 : 1), RunResult.Halted);
			assert.ok(atIssue());
			const depth = cpu.getFrameDepth(), origin = cpu.readFramePc(depth - 1);
			const decode = decodeBlua32InstructionAtPc(image.textBytes, image.header.textAddress, origin);
			const frame = cpu.activeThread.currentFrame!, openHead = frame.openUpvalueHead;
			const destinationBefore = frame.registers.get(decode.a);
			if (sampled) {
				memory.writeMappedWord(descriptor, originals[0]);
				memory.writeMappedWord(descriptor + 4, originals[1]);
			}
			const stem = join(folder, `descriptor-${optLevel}-${test}`);
			const systemFile = stem + '.rom', seed = stem + '.seed', trace = stem + '.trace';
			writeFileSync(systemFile, rom);
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const reads: number[] = [], ioSignals: number[] = [];
			if (mmio) {
				for (let i = 0; i < 2; ++i) memory.mapIoRead(descriptor + 4 * i, originals[i], (initial, _, signals) => {
					ioSignals.push(signals);
					// A real device handler that changes the next observed value.
					return ioSignals.length > 2 ? 0xffffffff : initial;
				});
			}
			const readWord = memory.readMappedBusU32LE.bind(memory);
			memory.readMappedBusU32LE = (address, signals, access) => {
				if (address === descriptor || address === descriptor + 4) reads.push(address);
				return readWord(address, signals, access);
			};
			const initialSequence = memory.readBusFaultSequence();
			const commands = ['X'], rows: string[] = [];
			// MMIO fixture words are supplied on the bus after restoring the
			// CPU checkpoint; they are not part of its saved operand envelope.
			if (mmio) commands.push(`O ${descriptor} ${originals[0]}`, `O ${descriptor + 4} ${originals[1]}`);
			const grant = (cycles: number) => {
				const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;
				commands.push(`J ${cycles} 1`);
				rows.push(`${result} ${spent} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
			};
			grant(1);
			assert.ok(cpu.fixedInterruptActive());
			assert.equal(frame.pc, origin);
			if (sampled) {
				for (let i = 0; i < 2; ++i) {
					for (let n = 0; n < 512 && reads.length === i; ++n) grant(1);
					assert.equal(reads.length, i + 1);
					assert.equal(memory.readRamRecordWord(arena.managementOffset() + FIRMWARE_DATA_OFFSET + newCellsOffset),
						0, 'no allocation while sampling descriptors');
					assert.equal(frame.openUpvalueHead, openHead, 'no open-cell publication while sampling descriptors');
					memory.writeMappedWord(descriptor + 4 * i, 0xffffffff);
					commands.push(`O ${descriptor + 4 * i} 4294967295`);
				}
				for (let i = 0; i < 512 && cpu.getFrameDepth(); ++i) grant(127);
				assert.deepEqual(runtime.readCompletionValues(), [valueInteger(708)]);
				assert.deepEqual(reads, [descriptor, descriptor + 4]);
				if (mmio) assert.deepEqual(ioSignals, [MAPPED_BUS_MASTER_CPU, MAPPED_BUS_MASTER_CPU]);
				assert.equal(memory.readBusFaultSequence(), initialSequence);
				commands.push('C');
				rows.push('708');
			} else {
				for (let i = 0; i < 512 && cpu.fixedInterruptActive(); ++i) grant(127);
				assert.equal(cpu.fixedInterruptActive(), false);
				assert.equal(frame.openUpvalueHead, openHead);
				assert.equal(frame.registers.get(decode.a), destinationBefore);
				const busFault = test === 'bus-fault';
				assert.equal(memory.readBusFaultSequence(), initialSequence + +busFault);
				assert.deepEqual(reads, busFault || invalidSecond ? [descriptor, descriptor + 4] : [descriptor]);
				assert.equal(cpu.readLuaFaultReasonWord(), busFault ? 0 : LUA_FAULT_REASON_INVALID_ARGUMENT);
				if (busFault) assert.equal(frame.pc, decode.pc + INSTRUCTION_BYTES, 'hard halt keeps the CLOSURE successor');
				else assert.equal(cpu.readEpcWord(), origin, 'invalid descriptor reports the CLOSURE origin');
				assert.equal(cpu.captureRuntimeState().hardHalted, busFault);
			}
			const fault = test === 'bus-fault';
			for (const [address, expected] of [
				[IO_SYS_BUS_FAULT_CODE, fault ? BUS_FAULT_UNMAPPED : 0],
				[IO_SYS_BUS_FAULT_ADDR, fault ? descriptor + 4 : 0],
				[IO_SYS_BUS_FAULT_ACCESS, fault ? BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32 : 0],
			]) {
				assert.equal(memory.readMappedU32LE(address), expected);
				commands.push(`M ${address}`);
				rows.push(`${expected} 0`);
			}
			commands.push('Z', 'F');
			rows.push(`${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`,
				String(+cpu.captureRuntimeState().hardHalted));
			const first = memory.ramBusEnd() - RAM_BASE, last = memory.ramData().length;
			commands.push(`H ${first} ${last}`);
			rows.push(String(hashBytes(memory.ramData(), first, last - first)));
			writeFileSync(trace, commands.join('\n'));
			const actual = execFileSync(native, [systemFile, trace, seed], { encoding: 'utf8' }).trimEnd().split('\n');
			const mismatch = actual.findIndex((row, i) => row !== rows[i]);
			assert.equal(mismatch, -1, `O${optLevel} ${test}, row ${mismatch}: TS ${rows[mismatch]} C++ ${actual[mismatch]}`);
			assert.equal(actual.length, rows.length);
			console.log(`CAPTURED-DESCRIPTOR:PASS O${optLevel} ${test} (exact reads, retirement and TS/C++ RAM)`);
		}
	}
	const prototypeWordsReserved = 256;
	const mappedSource = descriptorSource.replace('bss descriptors: word[2]', `bss raw_prototype: word[${prototypeWordsReserved}]`);
	for (const optLevel of [0, 3] as const) {
		for (const test of ['system-ram', 'cart-ram', 'cart-rom', 'record-bus-fault', 'latched-size-refusal'] as const) {
			const cart = test === 'cart-ram' || test === 'cart-rom';
			const linked = cart
				? linkTestBlua32Pair(compileHeapServiceSystem(boot, optLevel),
					compileLuaChunkToProgram(parseLuaChunk(mappedSource), [], { entrySource: mappedSource, optLevel }))
				: null;
			const system = linked ? null : linkTestSystemBlua32(compileHeapServiceSystem(mappedSource, optLevel));
			const layout = linked ? linked.cartImage : system!.image;
			const cartBytes = linked?.cartRomBytes.slice() ?? null;
			const systemBytes = linked?.systemRomBytes ?? system!.romBytes.slice();
			const owningRom = cartBytes ?? systemBytes, mediaBase = cart ? CART_ROM_BASE : SYSTEM_ROM_BASE;
			const target = layout.functions.find(fn => fn.upvalues.length === 2)!;
			if (cart) writeLE32(owningRom, layout.address - mediaBase + BLUA32_IMAGE_FLAGS_OFFSET,
				BLUA32_IMAGE_MAPPED_CODE_FLAG);
			const { textAddress, bssAddress } = layout.header;
			// A relocatable CLOSURE already occupies an architectural WIDE pair.
			// Keep its span and register operands while changing only the prototype.
			let issuePc = 0;
			for (let pc = textAddress; pc < textAddress + layout.textBytes.length;) {
				const decoded = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, pc);
				if (decoded.op === OpCode.CLOSURE && decoded.bx * BLUA32_FUNCTION_ALIGNMENT === target.address) {
					assert.notEqual(decoded.pc, pc);
					issuePc = pc;
					break;
				}
				pc = decoded.pc + INSTRUCTION_BYTES;
			}
			assert.notEqual(issuePc, 0);
			const readFault = test === 'record-bus-fault', sizeFault = test === 'latched-size-refusal';
			const romPrototype = test === 'cart-rom';
			const prototypeAddress = readFault ? RAM_BASE + MAIN_RAM_SIZE : romPrototype ? target.address : bssAddress;
			const codeAddress = romPrototype ? target.codeAddress : bssAddress + BLUA32_FUNCTION_RECORD_SIZE;
			const offsets = [BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
				BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
				BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET];
			const count = sizeFault ? (MAIN_RAM_SIZE - CLOSURE_CAPTURE_WORDS) >>> 2 : target.upvalues.length;
			const prototypeWords = [codeAddress, target.numParams, target.maxStack, target.flags, target.upvalueTableAddress, count];
			const sourceInstruction = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, issuePc);
			if (!romPrototype) rewriteResolvedABx(owningRom, (sourceInstruction.pc - mediaBase) / INSTRUCTION_BYTES,
				OpCode.CLOSURE, prototypeAddress / BLUA32_FUNCTION_ALIGNMENT);

			const runtime = new Runtime({ systemRomBytes: systemBytes, cartridgeSlots: cartridgeSlots(cartBytes), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine;
			const arena = nativeHeapReference(cpu).heapAllocator, management = arena.managementOffset();
			const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const atIssue = () => !cpu.fixedInterruptActive() && cpu.getFrameDepth() !== 0
				&& cpu.activeCartridgeSlot() === (cart ? 0 : -1) && cpu.readFramePc(cpu.getFrameDepth() - 1) === issuePc;
			for (let n = 0; n < 8192 && !atIssue(); ++n)
				assert.notEqual(slice(cpu.fixedInterruptActive() ? 193 : 1), RunResult.Halted);
			assert.ok(atIssue());
			if (!romPrototype && !readFault) {
				for (let i = 0; i < offsets.length; ++i) memory.writeMappedWord(prototypeAddress + offsets[i], prototypeWords[i]);
				if (!sizeFault) {
					const end = layout.functions.find(fn => fn.codeAddress > target.codeAddress)?.codeAddress
						?? textAddress + layout.textBytes.length;
					assert.ok(end > target.codeAddress && codeAddress + end - target.codeAddress <= bssAddress + prototypeWordsReserved * INSTRUCTION_BYTES);
					for (let pc = target.codeAddress; pc < end; pc += INSTRUCTION_BYTES)
						memory.writeMappedWord(codeAddress + pc - target.codeAddress, readLE32(owningRom, pc - mediaBase));
				}
			}
			const stem = join(folder, `mapped-${optLevel}-${test}`), rom = stem + '.rom', seed = stem + '.seed';
			const media = cartBytes === null ? [] : [stem + '.cart'];
			writeFileSync(rom, systemBytes);
			if (cartBytes !== null) writeFileSync(media[0], cartBytes);
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const faultSequence = memory.readBusFaultSequence(), frame = cpu.activeThread.currentFrame!;
			const openHead = frame.openUpvalueHead;
			const commands = ['X'], rows: string[] = [];
			const grant = (cycles: number) => {
				const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;

				commands.push(`J ${cycles} 1`);
				rows.push(`${result} ${spent} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
				return spent;
			};
			let checkpoint = '', cut = 0, rowCut = 0;
			assert.equal(grant(1), BASE_CYCLES[OpCode.CLOSURE]);
			if (readFault || sizeFault) {
				assert.equal(cpu.fixedInterruptActive(), false);
				assert.equal(frame.openUpvalueHead, openHead);
				assert.equal(memory.readBusFaultSequence(), faultSequence + (readFault ? offsets.length : 0));
				assert.equal(cpu.captureRuntimeState().hardHalted, readFault);
				assert.equal(cpu.readLuaFaultReasonWord(), sizeFault ? LUA_FAULT_REASON_OUT_OF_MEMORY : 0);
				if (readFault) assert.equal(frame.pc, sourceInstruction.pc + INSTRUCTION_BYTES);
				else assert.equal(cpu.readEpcWord(), issuePc);
			} else {
				assert.ok(cpu.fixedInterruptActive());
				if (!romPrototype) {
					// Destroy the entire original mutable prototype before firmware
					// has sampled even the first descriptor. CALL must use the tail.
					for (const offset of offsets) {
						memory.writeMappedWord(prototypeAddress + offset, 0xffffffff);
						commands.push(`O ${prototypeAddress + offset} 4294967295`);
					}
				}
				let sampled = false;
				const readWord = memory.readMappedBusU32LE.bind(memory);
				memory.readMappedBusU32LE = (address, signals, access) => {
					if (address === target.upvalueTableAddress) sampled = true;
					return readWord(address, signals, access);
				};
				for (let n = 0; n < 512 && !sampled; ++n) grant(1);
				assert.ok(sampled);
				checkpoint = stem + '.checkpoint';
				writeFileSync(checkpoint, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
				cut = commands.length; rowCut = rows.length;
				for (let n = 0; n < 512 && cpu.fixedInterruptActive(); ++n) grant(127);
				assert.equal(cpu.fixedInterruptActive(), false);
				const closure = valuePayload(frame.registers.get(sourceInstruction.a));
				assert.equal((memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS) & CLOSURE_LATCHED_PROTOTYPE) !== 0, !romPrototype);
				const binding = cpu.captureClosureBinding(closure);
				assert.equal(binding.functionAddress, prototypeAddress);
				assert.deepEqual([binding.codeAddress, binding.numParams, binding.maxStack, binding.flags,
					binding.upvalueTableAddress, binding.recordUpvalueCount], prototypeWords);
				for (let n = 0; n < 512 && cpu.getFrameDepth(); ++n) grant(127);
				assert.deepEqual(runtime.readCompletionValues(), [valueInteger(708)]);
				assert.equal(memory.readBusFaultSequence(), faultSequence);
				commands.push('C'); rows.push('708');
			}
			if (readFault || sizeFault) {
				const depth = cpu.getFrameDepth();
				commands.push('P');
				rows.push(`${depth} ${cpu.readFramePc(depth - 1)}`);
			}
			commands.push('Z', 'F');
			rows.push(`${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`,
				String(+cpu.captureRuntimeState().hardHalted));
			const first = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
			commands.push(`H ${first} ${end}`);
			rows.push(String(hashBytes(memory.ramData(), first, end - first)));
			for (const state of checkpoint === '' ? [seed] : [seed, checkpoint]) {
				const trace = state + '.trace', resumed = state === checkpoint;
				writeFileSync(trace, (resumed ? ['X', ...commands.slice(cut)] : commands).join('\n'));
				const actual = execFileSync(native, [rom, trace, state, ...media], { encoding: 'utf8' }).trimEnd().split('\n');
				assert.deepEqual(actual, resumed ? rows.slice(rowCut) : rows, `O${optLevel} ${test} ${resumed ? 'restored' : 'live'}`);
			}
			console.log(`CAPTURED-PROTOTYPE:PASS O${optLevel} ${test} (exact paired grants, result and RAM)`);
		}
	}
	for (const optLevel of [0, 3] as const) {
		const linked = linkTestSystemBlua32(compileHeapServiceSystem(descriptorSource, optLevel));
		const { image, romBytes } = linked;
		const target = image.functions.find(fn => fn.upvalues.length === 2)!;
		const originals = [readLE32(romBytes, target.upvalueTableAddress), readLE32(romBytes, target.upvalueTableAddress + 4)];
		for (const test of ['fits-1024', 'valid-1025', 'invalid-1025', 'fault-1025'] as const) {
			const fits = test === 'fits-1024', fault = test === 'fault-1025', invalid = test === 'invalid-1025';
			const count = fits ? captureLimit : captureLimit + 1;
			const descriptors = romBytes.length;
			const rom = new Uint8Array(descriptors + 4 * (count - +fault));
			rom.set(romBytes);
			writeLE32(rom, target.address + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, descriptors);
			writeLE32(rom, target.address + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, count);
			for (let index = 0; index < count - +fault; ++index)
				writeLE32(rom, descriptors + 4 * index, invalid && index + 1 === count ? 0xffffffff : originals[0]);
			const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, arena = nativeHeapReference(cpu).heapAllocator;

			const workspace = arena.managementOffset() + FIRMWARE_DATA_OFFSET;
			const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const atIssue = () => {
				if (cpu.fixedInterruptActive() || !cpu.getFrameDepth()) return false;
				const pc = cpu.readFramePc(cpu.getFrameDepth() - 1);
				const instruction = decodeBlua32InstructionAtPc(image.textBytes, image.header.textAddress, pc);
				return instruction.op === OpCode.CLOSURE && instruction.bx * BLUA32_FUNCTION_ALIGNMENT === target.address;
			};
			for (let n = 0; n < 8192 && !atIssue(); ++n)
				assert.notEqual(slice(cpu.fixedInterruptActive() ? 193 : 1), RunResult.Halted);
			assert.ok(atIssue());
			const frame = cpu.activeThread.currentFrame!, origin = frame.pc;
			const instruction = decodeBlua32InstructionAtPc(image.textBytes, image.header.textAddress, origin);
			const oldLink = frame.openUpvalueHead, oldValue = frame.registers.get(instruction.a);
			const physical = arena.occupiedBytes(), logical = nativeHeapReference(cpu).luaHeap.usedBytes();
			const oldWork = memory.ramData().slice(workspace, workspace + workspaceBytes);
			const bus = memory.readBusFaultSequence();
			let sampled = 0;
			const readWord = memory.readMappedBusU32LE.bind(memory);
			memory.readMappedBusU32LE = (address, signals, access) => {
				if (address >= descriptors && address < descriptors + 4 * count)
					assert.equal(address, descriptors + 4 * sampled++, 'each descriptor is read exactly once in order');
				return readWord(address, signals, access);
			};
			const stem = join(folder, `capacity-${optLevel}-${test}`), systemFile = stem + '.rom', seed = stem + '.seed';
			writeFileSync(systemFile, rom);
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const commands = ['X'], rows: string[] = [];
			const grant = (cycles: number) => {
				const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;
				commands.push(`J ${cycles} 1`);
				rows.push(`${result} ${spent} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${nativeHeapReference(cpu).luaHeap.usedBytes()}`);
				return spent;
			};
			assert.equal(grant(1), BASE_CYCLES[OpCode.CLOSURE]);
			for (let n = 0; n < 4096 && cpu.fixedInterruptActive(); ++n) {
				if (!fits) {
					assert.equal(arena.occupiedBytes(), physical);
					assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical);
				}
				grant(4096);
			}
			assert.equal(cpu.fixedInterruptActive(), false);
			assert.equal(sampled, count);
			assert.equal(memory.readBusFaultSequence(), bus + +fault);
			assert.equal(cpu.captureRuntimeState().hardHalted, fault);
			if (fits) {
				assert.notEqual(frame.openUpvalueHead, oldLink);
				assert.equal(memory.readRamRecordWord(workspace + missingOffset + 31 * 4), 0xffffffff);
				assert.notEqual(memory.readRamRecordWord(workspace + newCellsOffset + 1023 * 4), 0);
				for (let n = 0; n < 4096 && cpu.getFrameDepth(); ++n) grant(127);
				assert.deepEqual(runtime.readCompletionValues(), [valueInteger(707)]);
				commands.push('C'); rows.push('707');
			} else {
				assert.equal(frame.openUpvalueHead, oldLink);
				assert.equal(frame.registers.get(instruction.a), oldValue);
				assert.deepEqual(memory.ramData().subarray(workspace, workspace + workspaceBytes), oldWork);
				assert.equal(cpu.readLuaFaultReasonWord(), fault ? 0 : invalid ? LUA_FAULT_REASON_INVALID_ARGUMENT : LUA_FAULT_REASON_OUT_OF_MEMORY);
				if (!fault) assert.equal(cpu.readEpcWord(), origin);
			}
			commands.push('Z', 'F');
			rows.push(`${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`,
				String(+cpu.captureRuntimeState().hardHalted));
			const first = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
			commands.push(`H ${first} ${end}`);
			rows.push(String(hashBytes(memory.ramData(), first, end - first)));
			const file = stem + '.trace';
			writeFileSync(file, commands.join('\n'));
			const actual = execFileSync(native, [systemFile, file, seed], { encoding: 'utf8' }).trimEnd().split('\n');
			const mismatch = actual.findIndex((row, i) => row !== rows[i]);
			assert.equal(mismatch, -1, `O${optLevel} ${test} row ${mismatch}: TS ${rows[mismatch]} C++ ${actual[mismatch]}`);
			assert.equal(actual.length, rows.length);
			console.log(`CAPTURE-WORKSPACE:PASS O${optLevel} ${test} (bounded RAM, exact ordered reads and paired CPU grants)`);
		}
	}

	rmSync(folder, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${folder}`);
	throw error;
}
