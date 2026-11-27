import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { registerWindowBucket } from '../../../machine/ts/machine/cpu/call_state';
import { CLOSURE_PROTOTYPE_ADDRESS, captureAddress } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../../machine/ts/machine/cpu/upvalue';
import { valueFloatBits, valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { encodeFixedValueCount, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkRawTestSystemBlua32, seedTestCapturedClosure, seedTestRomClosure } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { admitTestHeapServiceCpu } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

test('frame redirection uses backed slots without occupying a suspended child window or replacing its captures', t => {
	const text = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 1, OpCode.RET, 0, encodeFixedValueCount(0), 0);
	writeInstruction(text, 2, OpCode.GETUP, 0, 0, 0);
	writeInstruction(text, 3, OpCode.RET, 0, encodeFixedValueCount(1), 0);
	writeInstruction(text, 4, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 5, OpCode.HALT, 0, 0, 0);
	const captures = [{ inStack: true, index: 0 }];
	const system = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 1, maxStack: 4, staticClosure: false, upvalueDescs: captures },
		{ firstWord: 1, wordCount: 1, maxStack: 4, numParams: 4, isVararg: true },
		{ firstWord: 2, wordCount: 2, maxStack: 8, staticClosure: false, upvalueDescs: captures },
		{ firstWord: 4, wordCount: 1, maxStack: 9, staticClosure: false, upvalueDescs: captures },
		{ firstWord: 5, wordCount: 1, maxStack: 128, numParams: 4, isVararg: true },
	] });
	const [original, variadic, wider, overlap, tooWide] = system.image.functions;
	const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, executionAddressSpace, memory, scheduler } = runtime.machine;
	admitTestHeapServiceCpu(cpu, executionAddressSpace);
	const root = cpu.rootThread, parent = root.currentFrame!;
	root.reserveFrame(32);
	const cells = new Uint32Array(1), closure = seedTestCapturedClosure(cpu, original.address, cells);
	const cell = cells[0], captured = valueFloatBits(0xffa12345), extra = valueFloatBits(0x80000000);
	memory.writeRamRecordWord(cell + UPVALUE_VALUE_WORD, valuePayload(captured));
	memory.writeRamRecordByte(cell + UPVALUE_VALUE_TAG, valueTag(captured));
	parent.closureAddress = closure;
	const argumentValues = [...Array.from({ length: 11 }, (_, i) => valueInteger(i + 17)), extra];
	cpu.beginCompletionCall(seedTestRomClosure(cpu, variadic.address), argumentValues);
	const child = root.currentFrame!;
	assert.equal(child.previous, parent);
	assert.equal(parent.stackBase + wider.maxStack, child.varargBase, 'the backed expansion ends at the child suffix');
	assert.equal(parent.stackBase + registerWindowBucket(overlap.maxStack), child.stackBase,
		'the overlapping tail reaches the variadic arguments, not the child register window');
	assert.equal(child.varargCount, 8);
	assert.equal(root.stackRegisters.get(child.stackBase - 1), extra);
	assert.ok(child.stackBase + tooWide.maxStack > root.stackRegisters.capacity());
	const seed = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	const commands = ['X'], rows: string[] = [];
	const ram = memory.ramData(), used = cpu.luaHeap.usedBytes(), occupied = cpu.heapAllocator.occupiedBytes();
	function hash() {
		const digest = hashBytes(ram, 0, ram.length);
		commands.push(`H 0 ${ram.length}`);
		rows.push(String(digest));
		return digest;
	}
	function redirect(index: number, target: typeof original, refusal?: 'window' | 'capture') {
		const budget = cpu.instructionBudgetRemaining, cycle = scheduler.nowCycles;
		const write = () => cpu.writeFrameExecution(index, SYSTEM_EXECUTION_DOMAIN_ID, target.address, target.codeAddress);
		if (refusal === undefined) write();
		else assert.throws(write, { message: refusal === 'window' ? 'Frame execution exceeds the admitted register window.'
			: 'Frame execution does not preserve its capture binding.' });
		assert.equal(cpu.instructionBudgetRemaining, budget);
		assert.equal(scheduler.nowCycles, cycle);
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied);
		assert.equal(cpu.luaHeap.usedBytes(), used);
		commands.push(`G ${index} ${SYSTEM_EXECUTION_DOMAIN_ID} ${target.address} ${target.codeAddress}`);
		rows.push(`${refusal === 'window' ? 0 : refusal === 'capture' ? 2 : 1} 0 0 ${occupied} ${used}`);
	}
	function refuse(index: number, target: typeof original, kind: 'window' | 'capture') {
		const before = cpu.captureRuntimeState(), digest = hash();
		redirect(index, target, kind);
		assert.deepEqual(cpu.captureRuntimeState(), before);
		assert.equal(hash(), digest);
	}
	function publishBinding(address: number) {
		const word = closure + CLOSURE_PROTOTYPE_ADDRESS;
		memory.writeRamRecordWord(word, address);
		commands.push(`W ${word} ${address}`);
	}
	refuse(0, wider, 'capture');
	publishBinding(overlap.address);
	refuse(0, overlap, 'window');
	refuse(1, tooWide, 'window');

	publishBinding(wider.address);
	redirect(0, wider);
	assert.equal(parent.stackCapacity, wider.maxStack);
	assert.equal(parent.closureAddress, closure);
	assert.equal(memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS), wider.address);
	assert.equal(captureAddress(memory, closure, 0), cell);
	assert.equal(parent.functionAddress, wider.address);
	assert.equal(parent.pc, wider.codeAddress);
	assert.equal(child.functionAddress, variadic.address);
	assert.equal(root.stackRegisters.get(child.stackBase - 1), extra);
	hash();
	for (const depth of [1, 0]) {
		const result = scheduler.runCpuSlice(depth, 128, root.address, CpuRunKind.Scheduled);
		assert.equal(result, RunResult.Halted);
		assert.equal(root.frameDepth, depth);
		commands.push(`g 128 ${depth}`);
		rows.push(`${result} ${128 - cpu.instructionBudgetRemaining} ${occupied} ${used}`);
	}
	assert.deepEqual(runtime.readCompletionValues(), [captured]);
	commands.push('c');
	rows.push(`1 ${valueTag(captured)} ${valuePayload(captured)}`);

	const dir = mkdtempSync(join(tmpdir(), 'bmsx-frame-execution-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const rom = join(dir, 'system.rom'), trace = join(dir, 'trace'), checkpoint = join(dir, 'initial.state');
	writeFileSync(rom, system.romBytes);
	writeFileSync(trace, commands.join('\n'));
	writeFileSync(checkpoint, seed);
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	assert.deepEqual(execFileSync(native, [rom, trace, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});
