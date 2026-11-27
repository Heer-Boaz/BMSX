import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { storeUpvalueReference } from '../helpers/upvalue_store_reference';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { seedTestCapturedClosure } from '../helpers/blua32';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { cartridgeSlots } from '../helpers/cartridge';
import * as v from '../../machine/ts/machine/cpu/value';
import { allocateThreadRecordReference, resizeThreadStackReference } from '../helpers/thread_allocation_reference';
const runner = process.env.BMSX_CPU32_RUNNER;

type Scenario = 'chain' | 'table' | 'memory' | 'upvalue' | 'words' | 'control' | 'loop';
function machine(rom: Uint8Array, backend: CpuExecutionBackend) {
	const memory = new Memory({ systemRom: rom, cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory), backend);
	cpu.reset();
	const firstFrame = cpu.activeThread.currentFrame!, owner = firstFrame.executionImage;
	const cells = new Uint32Array(1);
	const closure = seedTestCapturedClosure(cpu, firstFrame.functionAddress, cells);
	firstFrame.closureAddress = closure;
	const table = createReferenceTable(cpu, 1, 1), field = cpu.stringPool.find('field')!;
	const upvalue = cells[0];
	const other = cpu.bindThread(allocateThreadRecordReference(cpu, 0));
	resizeThreadStackReference(cpu, other, 24);
	function setup(scenario: Scenario, value = v.valueInteger(3), source = 'closed') {
		const frame = cpu.activeThread.currentFrame!, r = frame.registers;
		for (let i = 0; i < r.capacity(); ++i) r.setInteger(i, 900 + i);
		r.set(0, value);r.setInteger(1, source==='zero-divisor'?0:2);r.setInteger(4, 1);r.setInteger(5, 7);
		if (scenario === 'words') {
			r.setInteger(0,DYNAMIC_RAM_BASE+0x200);r.set(1,value);r.set(2,source==='partial'?v.valueBool(true):v.valueInteger(-1));r.setFloat(3,-2.5);
			memory.writeMappedU32LE(DYNAMIC_RAM_BASE+0x200,0);memory.writeMappedU32LE(DYNAMIC_RAM_BASE+0x204,0);
		}
		if (scenario === 'control') { r.setInteger(0,-2147483648);r.set(1,value); }
		if (scenario === 'loop') { r.setInteger(0,3);r.setInteger(1,1);r.setInteger(2,0);r.setInteger(3,0); }
		if (scenario === 'table') {
			cpu.gc.tables.setInteger(table, 1, v.valueInteger(9));cpu.gc.tables.setStringKey(table, field, v.valueInteger(9));
			r.setTable(0, table);r.set(1, value);r.setFloat(7, 1);
		}
		if (scenario === 'memory') {
			r.setInteger(0, DYNAMIC_RAM_BASE + 0x100);r.setInteger(1, DYNAMIC_RAM_BASE + 0x200);
			memory.writeMappedF64LE(DYNAMIC_RAM_BASE + 0x100, 16777217);
			memory.writeMappedF64LE(DYNAMIC_RAM_BASE + 0x200, 0);
		}
		if (scenario === 'upvalue') {
			if (source === 'closed') {
				if (Upvalue.isOpen(memory, upvalue)) Upvalue.close(cpu.gc, upvalue);
			} else {
				Upvalue.bindOpen(memory, upvalue, source === 'own' ? frame.thread.address : other.address, source === 'own' ? frame.stackBase + 8 : 8, 0);
			}
			storeUpvalueReference(cpu, upvalue, v.valueTag(value), v.valuePayload(value)); other.stackRegisters.set(8, value);
			r.set(0, value);r.set(1, v.valueFloatBits(0xffa54321));
		}
	}
	return { cpu, closure, owner, upvalue, other, setup };
}

for (const scenario of ['chain', 'table', 'memory', 'upvalue', 'words', 'control', 'loop'] as const) {
	test(`compact generated ${scenario}: every cycle boundary agrees with the interpreter`, { skip: !runner }, () => {
		const rom = new Uint8Array(execFileSync(runner!, ['--rom-region', scenario]));
		const machines = [machine(rom, CpuExecutionBackend.Interpreter), machine(rom, CpuExecutionBackend.JavaScript)];
		for (const m of machines) {
			for (let i = 0; i < 12; ++i) {
				if (i !== 0) m.cpu.beginCompletionCall(m.closure);
				m.setup(scenario,scenario==='control'?v.valueInteger(0):v.valueInteger(3));m.cpu.runUntilDepth(0, 1000);
			}
		}
		const js = machines[1], page = js.owner.compiledCodeLookup!.find(js.cpu.captureClosureBinding(js.closure).codeAddress, 0)!;
		assert.ok(page.compiledBlocks, 'real CPU execution must install a generated region');
		const regions = new Set(page.compiledBlocks.entries.filter(block => block !== null).map(block => block.region));
		let generatedRuns = 0;
		for (const region of regions) {
			const execute = region.execute;
			Object.defineProperty(region, 'execute', { value: (...args: Parameters<typeof execute>) => { ++generatedRuns;return execute(...args); } });
		}
		const values = scenario === 'chain' ? [v.valueInteger(3),v.valueInteger(-2147483648),v.valueFloat(-2.5),v.valueBool(true)]
			: [v.valueInteger(-2147483648),v.valueFloatBits(0xffa12345),v.valueFromTag(v.ValueTag.True,37)];
		for (const source of scenario === 'upvalue' ? ['own','other','closed'] : scenario==='chain'?['closed','zero-divisor']:scenario==='words'?['closed','partial']:['closed']) for (const value of values) {
			for (let grant = 1; grant <= 100; ++grant) {
				const results = machines.map(m => {
					m.cpu.beginCompletionCall(m.closure);m.setup(scenario,value,source);
					const frame = m.cpu.activeThread.currentFrame!;
					const result = m.cpu.runUntilDepth(0,grant);
					const completion:v.Value[]=[];m.cpu.readCompletionValues(completion);
					return { result, remaining:m.cpu.instructionBudgetRemaining, pc:frame.pc, top:frame.top,
						registers:Array.from({ length:24 },(_,i)=>frame.registers.get(i)), completion,
						epc:m.cpu.readEpcWord(),fault:m.cpu.readLuaFaultReasonWord(),upvalue:Upvalue.load(m.cpu.memory, m.upvalue),
						other:m.other.stackRegisters.get(8),saved:m.cpu.getGlobalByKey(m.cpu.stringPool.find('saved')!),
						memory:[m.cpu.memory.readMappedU32LE(DYNAMIC_RAM_BASE+0x200),m.cpu.memory.readMappedU32LE(DYNAMIC_RAM_BASE+0x204)] };
				});
				assert.deepEqual(results[1],results[0],`${scenario} ${source}, value ${v.valueTag(value)}:${v.valuePayload(value)}, grant ${grant}`);
			}
		}
		assert.ok(generatedRuns>0,'parity must include actual generated execution, not admission fallback alone');
	});
}
