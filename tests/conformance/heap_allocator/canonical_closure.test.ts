import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_FUNCTION_BINDING } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_STATIC } from '../../../machine/ts/spec/blua32/image_format';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const source = `
local function use()
	local first
	for i = 1, 2 do
		local function target(n) return n + 37 end
		if i == 1 then first = target elseif first ~= target then return -1 end
	end
	return first(0)
end
halt_until_irq
local first = use()
blua32.svc(require('kernel/heap_control_ids').collect_full)
halt_until_irq
return first, use()
`;

for (const opt of [0, 3] as const) test(`firmware canonicalizes and reclaims a ROM closure without a host roster at O${opt}`, t => {
	const linked = linkManagedTestSystem(source, opt);
	const rom = writeTestBlua32Rom(linked);
	const targetIndex = linked.symbols.metadata.functionDisplayNames.indexOf('target');
	assert.notEqual(targetIndex, -1, linked.symbols.metadata.functionIds.filter(id => id.includes('main')).join(', '));
	const target = linked.layout.functions[targetIndex];
	const proto = target.address;
	assert.equal(target.upvalues.length, 0);
	// In Lua a static module export cannot escape as a Value. Program the
	// same Function-record bit over an ordinary CLOSURE that returns a Value.
	writeLE32(rom, proto + BLUA32_FUNCTION_FLAGS_OFFSET, target.flags | BLUA32_FUNCTION_STATIC);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena, luaHeap: budget } = nativeHeapReference(cpu);
	runGuestToHalt(cpu, 4_194_304);
	assert.ok(cpu.isHaltedUntilIrq());
	cpu.clearHaltUntilIrq();
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-canonical-closure-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const romPath = join(folder, 'system.rom'), trace = join(folder, 'trace');
	writeFileSync(romPath, rom);
	const checkpoint = (label: string) => {
		const path = join(folder, label);
		writeFileSync(path, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		return path;
	};
	const initial = checkpoint('initial'), nativeState = join(folder, 'cpp.partial');
	const commands: string[] = ['X'], rows: string[] = [];
	const grant = (cycles: number) => {
		const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		commands.push(`J ${cycles} 1`);
		rows.push(`${result} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${budget.usedBytes()}`);
		return result;
	};
	const seek = () => {
		assert.notEqual(grant(1), RunResult.Halted);
		for (let i = 0; i < 32768; ++i) {
			const frame = cpu.activeThread.currentFrame;
			if (cpu.fixedInterruptActive() && cpu.readCauseWord() === CPU_CAUSE_CODE_FUNCTION_BINDING
				&& frame!.argumentCount === 11 && frame!.registers.get(1) === valueInteger(proto)) return frame!;
			assert.notEqual(grant(1), RunResult.Halted);
		}
		assert.fail(`missed CLOSURE @${proto.toString(16)}: pc ${cpu.lastPc.toString(16)}, epc ${cpu.readEpcWord().toString(16)}, cause ${cpu.readCauseWord()}, depth ${cpu.getFrameDepth()}, fixed ${cpu.fixedInterruptActive()}`);
	};
	const land = (packet: ReturnType<typeof seek>) => {
		const owner = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
		const depth = cpu.readThreadFrameDepth(owner) - 1;
		const destination = valuePayload(packet.registers.get(0));
		const successor = cpu.readThreadFrameWord(owner, depth, FrameField.Pc);
		for (let i = 0; i < 4096 && cpu.fixedInterruptActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.readFramePc(depth), successor);
		const value = cpu.readFrameRegister(depth, destination), address = valuePayload(value);
		assert.equal(valueTag(value), ValueTag.Closure);
		assert.ok(memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS) & CLOSURE_CANONICAL);
		return address;
	};
	const packet = seek(), issued = checkpoint('ts.issued'), cut = commands.length, rowCut = rows.length;
	const finish = (firstPacket: typeof packet) => {
		const allocated = arena.occupiedBytes(), charged = budget.usedBytes();
		const first = land(firstPacket);
		assert.ok(arena.occupiedBytes() > allocated);
		assert.equal(budget.usedBytes() - charged, 12);
		const hit = seek(), hotBefore = [arena.occupiedBytes(), budget.usedBytes()];
		assert.equal(land(hit), first);
		assert.deepEqual([arena.occupiedBytes(), budget.usedBytes()], hotBefore, 'an identity hit does not allocate');
		for (let i = 0; i < 1024 && !cpu.isHaltedUntilIrq(); ++i) grant(4096);
		assert.ok(cpu.isHaltedUntilIrq());
		assert.equal(memory.readRamRecordByte(first), 0, 'a weak identity record dies without a language reference');
		cpu.clearHaltUntilIrq();
		commands.push('h'); // clear only the architecturally suspended halt
		const next = seek(), nextCharge = budget.usedBytes();
		land(next);
		assert.equal(budget.usedBytes() - nextCharge, 12, 'binding after sweep runs a new allocation');
		for (let i = 0; i < 1024 && cpu.getFrameDepth() !== 0; ++i) grant(4096);
		assert.deepEqual(runtime.readCompletionValues(), [valueInteger(37), valueInteger(37)]);
		commands.push('c');
		rows.push(`2 ${ValueTag.Integer} 37 ${ValueTag.Integer} 37`);
	};
	finish(packet);
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const verify = (path: string, script: string[], expected: string[]) => {
		writeFileSync(trace, script.join('\n'));
		assert.deepEqual(execFileSync(native, [romPath, trace, path], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
	};
	verify(initial, commands, rows);
	const after = rows.slice(rowCut);
	verify(issued, ['X', `x ${nativeState}`, ...commands.slice(cut)], after);
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = cut;
	rows.length = rowCut;
	finish(cpu.activeThread.currentFrame!);
	assert.deepEqual(rows.slice(rowCut), after);
});
