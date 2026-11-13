import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { valueString } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { runCpuParity } from '../helpers/cpu_execution';

for (const generic of [false, true]) for (const constant of [false, true]) {
	test(`string stores within allocated capacity retain the generated invocation (generic=${generic}, constant=${constant})`, () => {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.MOV, 8, 3, 0);
		writeInstruction(text, 1, OpCode.MOV, 2, 4, 0);
		writeInstruction(text, 2, generic ? OpCode.SETT : OpCode.SETFIELD, 0, generic ? 1 : 0, constant ? 62 : 2, constant ? 7 : 0);
		writeInstruction(text, 3, OpCode.MOV, 9, 8, 0);
		writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
		const image = linkRawTestSystemBlua32({ text, constants: ['field', false],
			functions: [{ firstWord: 0, wordCount: 5, maxStack: 10 }] });
		const cpu = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
		const frame = cpu.rootThread.frameAtDepth(0), r = frame.registers, key = cpu.stringPool.intern('field');
		r.setTable(0, cpu.createTable(0, 8)); r.setStringId(1, key); r.setNumber(4, 13);
		cpu.runUntilDepth(0, 600);
		const page = frame.decodedPage!, entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
		const block = page.compiledBlocks!.entries[entry]!;
		assert.ok(block);
		const parent = cpu.createTable(0, 1); parent.setStringKey(key, 71);
		const meta = cpu.createTable(0, 1); meta.setStringKey(cpu.stringPool.intern('__index'), parent);
		const values = [false, -0, NaN, cpu.createTable(), valueString(key), null];
		for (let n = 0; n < values.length; n++) {
			const table = cpu.createTable(0, 8); table.metatable = meta;
			for (let prior = 0; prior < n; prior++) table.setStringKey(cpu.stringPool.intern(`prior_${prior}`), prior);
			for (const value of [values[n], null, values[n]]) {
				r.setTable(0, table); r.set(3, values[n]); r.set(4, value);
				const before = table.getTrackedHeapBytes(), state = { remainingCycles: 11, registerTop: frame.top, memoryAddress: 0 };
				const exit = block.region.exits[block.region.execute(r, frame.executionImage.constScalars, page, frame, block.entry, state)];
				assert.equal(exit.exit, CompiledBlockExit.Continue, 'new keys, nil deletion and resurrection need no CPU semantic exit');
				assert.equal(table.getStringKey(key), constant ? false : value);
				assert.equal(table.getTrackedHeapBytes(), before);
				assert.equal(r.get(8), values[n]); assert.equal(r.get(9), values[n]); assert.equal(r.get(2), value);
				assert.equal(parent.getStringKey(key), 71, 'writes shadow inheritance instead of modifying its source');
				assert.equal(state.remainingCycles, 0);
			}
		}
		const empty = cpu.createTable(); r.setTable(0, empty); r.set(3, values[3]); r.set(4, values[3]); r.setNil(9);
		const state = { remainingCycles: 11, registerTop: frame.top, memoryAddress: 0 };
		const exit = block.region.exits[block.region.execute(r, frame.executionImage.constScalars, page, frame, block.entry, state)];
		assert.equal(exit.exit, generic ? CompiledBlockExit.WriteIndex : CompiledBlockExit.WriteField);
		assert.equal(empty.storedSlotCount, 0); assert.equal(empty.getStringKey(key), null);
		assert.equal(r.get(8), values[3]); assert.equal(r.get(2), values[3]); assert.equal(r.get(9), null);
	});
}

for (const generic of [false, true]) test(`growing string stores publish moved roots before collection (generic=${generic})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MOV, 7, 9, 0);
	writeInstruction(text, 1, OpCode.KNIL, 9, 0, 0);
	writeInstruction(text, 2, generic ? OpCode.SETT : OpCode.SETFIELD, 0, generic ? 1 : 0, 7);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	const image = linkRawTestSystemBlua32({ text, constants: ['field'], functions: [{ firstWord: 0, wordCount: 4, maxStack: 16 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers;
		r.setTable(0, cpu.createTable(0, 1)); r.setStringId(1, cpu.stringPool.intern('field')); r.setNumber(9, 1);
		cpu.runUntilDepth(0, 504);
	}
	const frame = js.rootThread.frameAtDepth(0), entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.ok(frame.decodedPage!.compiledBlocks!.entries[entry], 'growth is reached from adopted generated code');
	const garbage: string[] = [];
	for (const cpu of [js, ref]) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
		const frame = cpu.rootThread.frameAtDepth(0), r = frame.registers;
		const retained = cpu.createTable(0, 1); retained.setStringKey(cpu.stringPool.intern('payload'), valueString(cpu.stringPool.intern('retained')));
		r.setTable(0, cpu.createTable()); r.setTable(9, retained); frame.top = 0;
		const heap = cpu.captureRuntimeState().luaHeap, pressure = 'g'.repeat(heap.nextCollectionBytes - heap.trackedBytes - 1);
		cpu.stringPool.intern(pressure); garbage.push(pressure);
	}
	runCpuParity(js, ref, 6);
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	for (const [i, cpu] of [js, ref].entries()) {
		assert.equal(cpu.stringPool.find(garbage[i]), undefined, 'hash growth really collected unreachable pressure');
		const r = cpu.rootThread.frameAtDepth(0).registers, retained = r.getTable(7);
		assert.equal(retained.getStringKey(cpu.stringPool.find('payload')!), valueString(cpu.stringPool.find('retained')!));
		assert.equal(r.getTable(0).getStringKey(cpu.stringPool.find('field')!), retained);
	}
});
