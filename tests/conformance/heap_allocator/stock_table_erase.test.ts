import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { TableHeader, TableRecords } from '../../../machine/ts/machine/cpu/table';
import { ValueTag, valueInteger, valueNil, valuePayload, valueString, valueTable } from '../../../machine/ts/machine/cpu/value';
import { advanceRuntimeTime } from '../../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_STORAGE_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `bss command: word
local target = {}
local function forward(_, key, value) target[key] = value end
table_owner = { __newindex = forward, other = 26, proved = 31,
	${Array.from({ length: 66 }, (_, i) => `[${-i - 1}] = 1`).join(', ')} }
local child = setmetatable({}, table_owner)
child.before = 19
function erase_other(t, key) t[key] = nil end
function erase_missing(t) t.missing = nil end
function erase_method(t) t.__newindex = nil end
function erase_proved(t) t.proved = nil end
mem[${IO_IRQ_MASK}] = 0
local warm = {}
while *command < 1 do halt_until_irq end
for i = 1, 128 do
	erase_other(warm, 'other')
	erase_missing(warm)
	erase_method(warm)
	erase_proved(warm)
end
while *command < 2 do halt_until_irq end
erase_other(table_owner, 'other')
erase_missing(table_owner)
erase_method(table_owner)
erase_proved(table_owner)
child.after = 67
return rawget(child, 'before') == nil and target.before == 19 and child.after or 0
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

test('stock hash erasure gives only unresolved String method proofs to firmware', async t => {
	const directory = mkdtempSync(join(tmpdir(), 'bmsx-table-erase-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
		'--mode', 'bios', '-respath', 'machine/bios/res', '--debug', '-O3', '--output-dir', directory,
		'--store-dir', join(directory, 'store')], { encoding: 'utf8' });
	const systemPath = join(directory, 'system', 'bmsx-bios.debug.rom'), system = readFileSync(systemPath);
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join(directory, 'native') });
	for (const optLevel of [0, 3] as const) await t.test(`O${optLevel}`, () => {
		const program = compileLuaChunkToProgram(parseLuaChunk(source, 'table-erase.lua'), [], { entrySource: source, optLevel });
		const linked = linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
			CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
		const cart = writeTestBlua32Rom(linked), cartPath = join(directory, `O${optLevel}.rom`);
		writeFileSync(cartPath, cart);
		const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, gxGpu, scheduler } = runtime.machine, { heapAllocator: arena, tables } = cpu;
		for (let i = 0; i < 1024 && !(cpu.activeCartridgeSlot() === 0 && cpu.isHaltedUntilIrq()); ++i) {
			if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
			runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
		}
		assert.equal(cpu.activeCartridgeSlot(), 0);
		assert.ok(cpu.isHaltedUntilIrq());
		const receiver = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('table_owner')!));
		assert.equal(tables.metatableAddress(receiver), 0, 'the receiver itself is used as a metatable but has no metatable');
		const hash = tables.hashSize(receiver), backing = tables.hashAddress(receiver);
		assert.equal(hash, 128, 'exercise the large hash live-count lane');
		const bytes = TableRecords.hashStorageBytes(hash), liveWord = backing + bytes - 4;
		const readProof = () => memory.readRamRecordByte(receiver + TableHeader.NewIndexAbsent);
		assert.equal(readProof(), 0);

		const seed = join(directory, `O${optLevel}.state`), trace = join(directory, `O${optLevel}.trace`);
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const command = linked.layout.header.bssAddress;
		memory.writeRamRecordWord(command, 1);
		cpu.clearHaltUntilIrq();
		const commands = ['X', `W ${command} 1`, 'h'], rows: string[] = [];
		const observe = (cmd: string, value: string | number) => { commands.push(cmd); rows.push(String(value)); };
		const grant = (cycles: number) => {
			const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			observe(`E ${cycles}`, [result, paid, memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
			if (paid > 0) {
				advanceRuntimeTime(runtime, paid);
				observe(`v ${paid}`, scheduler.nowCycles);
			}
			return result;
		};
		const digest = () => hashBytes(memory.ramData(), backing - RAM_BASE, bytes);
		const observeErase = () => {
			observe(`H ${backing - RAM_BASE} ${backing - RAM_BASE + bytes}`, digest());
			const first = receiver - RAM_BASE;
			observe(`H ${first} ${first + TableRecords.HEADER_BYTES}`, hashBytes(memory.ramData(), first, TableRecords.HEADER_BYTES));
		};
		const stages = [
			{ fn: 'erase_other', key: 'other', op: OpCode.SETT, firmware: true, missing: false, proof: 0 },
			{ fn: 'erase_missing', key: 'missing', op: OpCode.SETFIELD, firmware: false, missing: true, proof: 0 },
			{ fn: 'erase_method', key: '__newindex', op: OpCode.SETFIELD, firmware: true, missing: false, proof: 1 },
			{ fn: 'erase_proved', key: 'proved', op: OpCode.SETFIELD, firmware: false, missing: false, proof: 1 },
		];
		// Both cores execute the real warm-up before attempting each erase.
		for (let i = 0; i < 64 && !cpu.isHaltedUntilIrq(); ++i) grant(4096);
		assert.ok(cpu.isHaltedUntilIrq());
		memory.writeRamRecordWord(command, 2);
		cpu.clearHaltUntilIrq();
		commands.push(`W ${command} 2`, 'h');
		for (const stage of stages) {
			const index = linked.symbols.metadata.functionIds.findIndex(id => id.endsWith(`/decl:${stage.fn}`));
			assert.ok(index >= 0);
			const fn = linked.layout.functions[index].address;
			const atStore = () => {
				const frame = cpu.activeThread.currentFrame!;
				return frame.functionAddress === fn && decodeBlua32InstructionAtPc(cart, CART_ROM_BASE, frame.pc).op === stage.op;
			};
			for (let i = 0; i < 4096 && !atStore(); ++i) assert.equal(grant(1), RunResult.Yielded);
			assert.ok(atStore(), stage.fn);
			const frame = cpu.activeThread.currentFrame!, pc = frame.pc, depth = cpu.getFrameDepth();
			const next = decodeBlua32InstructionAtPc(cart, CART_ROM_BASE, pc).pc + INSTRUCTION_BYTES;
			const keyId = cpu.stringPool.find(stage.key)!;
			const old = tables.getStringKey(receiver, keyId);
			assert.equal(old === valueNil(), stage.missing);
			const before = digest(), oldProof = readProof(), oldLive = memory.readRamRecordWord(liveWord);
			const occupied = arena.occupiedBytes(), charged = cpu.luaHeap.usedBytes();

			assert.equal(grant(1), RunResult.Yielded);
			assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[stage.op]);
			assert.equal(cpu.fixedInterruptActive(), stage.firmware);
			if (stage.firmware) {
				assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_STORAGE_WINDOW);
				assert.equal(cpu.readEpcWord(), pc);
				assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), frame.thread.address);
				assert.equal(cpu.readThreadFrameDepth(frame.thread.address), depth);
				assert.equal(decodeBlua32InstructionAtPc(cart, CART_ROM_BASE, pc).op, stage.op);
				assert.equal(digest(), before, 'entry changed no hash lane or occupancy');
				assert.equal(readProof(), oldProof, 'entry did not publish a proof');
				const packet = cpu.activeThread.currentFrame!;
				assert.equal(packet.argumentCount, 6);
				assert.deepEqual([0, 1, 2].map(i => packet.registers.get(i)), [valueTable(receiver), valueString(keyId), valueNil()]);
				const slot = Array.from({ length: hash }, (_, i) => i).find(i =>
					memory.readRamRecordByte(backing + 8 * hash + i) === ValueTag.String
					&& memory.readRamRecordWord(backing + 4 * i) === keyId)!;
				assert.equal(packet.registers.get(5), valueInteger(slot));
				observe('Z', `${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`);
				observeErase();
				for (let i = 0; i < 4096 && cpu.fixedInterruptActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
				assert.equal(cpu.fixedInterruptActive(), false);
			}
			assert.equal(cpu.readFramePc(depth - 1), next);
			assert.equal(tables.getStringKey(receiver, keyId), valueNil());
			assert.equal(readProof(), stage.proof);
			assert.equal(memory.readRamRecordWord(liveWord), oldLive - +!stage.missing);
			assert.equal(arena.occupiedBytes(), occupied, 'an erasure never grows or rebuilds the hash');
			assert.equal(cpu.luaHeap.usedBytes(), charged);
			assert.equal(tables.hashAddress(receiver), backing);
			if (stage.missing) assert.equal(digest(), before);
			observeErase();
		}
		for (let i = 0, result = RunResult.Yielded; i < 1024 && result === RunResult.Yielded; ++i) result = grant(4096);
		assert.deepEqual(runtime.readCompletionValues(), [valueInteger(67)], 'deleting the method changes the next ordinary assignment');
		observe('c', `1 ${ValueTag.Integer} 67`);
		writeFileSync(trace, commands.join('\n'));
		assert.deepEqual(execFileSync(native, [systemPath, trace, seed, cartPath], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
	});
});
