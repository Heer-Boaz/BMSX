import { OPCODE_NAMES } from '../../toolchain/ts/lua/opcode_metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { OpCode, BASE_CYCLES } from '../../machine/ts/spec/blua32/opcode';
import { LUA_FAULT_REASON_INVALID_ARGUMENT, CPU_CAUSE_CODE_RESERVED_INSTRUCTION } from '../../machine/ts/spec/blua32/cop0';
import { cartridgeSlots } from '../helpers/cartridge';
import * as v from '../../machine/ts/machine/cpu/value';
import * as n from '../../machine/ts/machine/cpu/value_arithmetic';
import { luaShiftLeft, luaShiftRight } from '../../machine/ts/spec/blua32/numeric';
const runner = process.env.BMSX_CPU32_RUNNER;
function createMachine(op: OpCode, kind: number | undefined, backend: CpuExecutionBackend): CPU {
	// The same public program records are loaded by both real CPU owners.
	// This bypasses neither runtime nor instruction decoding; only the frontend
	// compiler, whose literal typing is a separate cutover gate.
	const rom = new Uint8Array(execFileSync(runner!, kind === undefined ? ['--rom', String(op)] : ['--rom', String(op), String(kind)]));
	const memory = new Memory({ systemRom: rom, cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory), backend);
	cpu.reset(); return cpu;
}
const operations: [OpCode, (a: v.Value, b: v.Value) => v.Value][] = [
	[OpCode.ADD,n.valueAdd],[OpCode.SUB,n.valueSubtract],[OpCode.MUL,n.valueMultiply],[OpCode.DIV,n.valueDivide],
	[OpCode.MOD,n.valueModulo],[OpCode.FLOORDIV,n.valueFloorDivide],[OpCode.POW,n.valuePower],
	[OpCode.BAND,(a,b)=>v.valueInteger(n.integerOperand(a)&n.integerOperand(b))],
	[OpCode.BOR,(a,b)=>v.valueInteger(n.integerOperand(a)|n.integerOperand(b))],
	[OpCode.BXOR,(a,b)=>v.valueInteger(n.integerOperand(a)^n.integerOperand(b))],
	[OpCode.SHL,(a,b)=>v.valueInteger(luaShiftLeft(n.integerOperand(a),n.integerOperand(b)))],
	[OpCode.SHR,(a,b)=>v.valueInteger(luaShiftRight(n.integerOperand(a),n.integerOperand(b)))],
];
for (const backend of [CpuExecutionBackend.Interpreter]) {
const machine=(op: OpCode,kind?: MemoryAccessKind)=>createMachine(op,kind,backend);
test(`${backend}: real scalar CPU opcodes transport Integer/Float words through calls and returns`, { skip: !runner }, () => {
	const values = [v.valueInteger(0),v.valueInteger(1),v.valueInteger(-1),v.valueInteger(-2147483648),v.valueInteger(2147483647),v.valueInteger(16777217),v.valueFloat(16777216),v.valueFloat(-2.5),v.valueFloatBits(1),v.valueFloatBits(0x80000000),v.valueFloatBits(0x7f800000),v.valueFloatBits(0xff800000),v.valueFloatBits(0x7fa12345)];
	for (const [op,calculate] of operations) {
		const cpu = machine(op), closure = cpu.activeThread.currentFrame!.closure, owner = cpu.activeThread.currentFrame!.executionImage; let first = true;
		for (const a of values) for (const b of values) {
			let expected: v.Value; try { expected=calculate(a,b); } catch { continue; }
			if (!first) cpu.beginCompletionCall(closure); first = false;
			const regs=cpu.activeThread.currentFrame!.registers;
			regs.set(0,a); regs.set(1,b); regs.setInteger(2,917);
			assert.equal(cpu.runUntilDepth(0,1000),RunResult.Halted);
			const result: v.Value[]=[]; cpu.readCompletionValues(result);
			assert.deepEqual(result,[expected],`${OPCODE_NAMES[op]} ${v.valueTag(a)}:${v.valuePayload(a)} ${v.valueTag(b)}:${v.valuePayload(b)}`);
		}
		if(backend===CpuExecutionBackend.JavaScript) assert.ok(owner.compiledCodeLookup?.find(cpu.captureClosureBinding(closure).codeAddress,0), 'numeric cases must exercise installed generated regions');
	}
});
test(`${backend}: operand faults retain their charge and do not publish a destination`, { skip: !runner }, () => {
	for (const bad of [v.valueNil(),v.valueBool(true),v.valueString(0)]) {
		const cpu=machine(OpCode.ADD), regs=cpu.activeThread.currentFrame!.registers;
		regs.set(0,bad); regs.setInteger(1,1); regs.setInteger(2,917);
		cpu.runUntilDepth(0,BASE_CYCLES[OpCode.ADD]);
		assert.equal(cpu.readLuaFaultReasonWord(),LUA_FAULT_REASON_INVALID_ARGUMENT);
		assert.equal(cpu.readFrameRegister(0,2),v.valueInteger(917));
	}
});

test(`${backend}: numeric MOV kinds preserve payloads and reject reserved selectors`, { skip: !runner }, () => {
	for (const kind of [1,2,3,255,256,257,258,511,512,16384,32767]) {
		const cpu = createMachine(OpCode.MOV, kind, backend);
		const regs = cpu.activeThread.currentFrame!.registers;
		regs.set(0, kind === 1 ? v.valueFloatBits(0xffa12345) : v.valueInteger(0xffa12345));
		regs.setInteger(2,917);
		cpu.runUntilDepth(0,1);
		assert.equal(cpu.instructionBudgetRemaining,-1);
		if (kind > 2) {
			assert.equal(cpu.readCauseWord(),CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
			assert.equal(cpu.readFrameRegister(0,2),v.valueInteger(917));
		} else assert.equal(cpu.readFrameRegister(0,2),kind===1?v.valueInteger(0xffa12345):v.valueFloatBits(0xffa12345));
	}
});

test(`${backend}: unary Float payloads and exact mixed comparisons survive real skip/jump paths`, { skip: !runner }, () => {
	for (const value of [v.valueInteger(-2147483648),v.valueInteger(1),v.valueFloatBits(0x7fa12345),v.valueFloatBits(0xffc00000),v.valueFloatBits(0x80000000)]) {
		const cpu=machine(OpCode.UNM);cpu.activeThread.currentFrame!.registers.set(0,value);cpu.runUntilDepth(0,100);
		const results:v.Value[]=[];cpu.readCompletionValues(results);assert.equal(results[0],n.valueNegate(value));
	}
	const values=[v.valueInteger(16777217),v.valueFloat(16777216),v.valueInteger(2147483647),v.valueFloatBits(0x4f000000),v.valueFloatBits(0x7fa12345),v.valueFloatBits(0x80000000),v.valueInteger(0),v.valueFromTag(v.ValueTag.True,1),v.valueFromTag(v.ValueTag.True,2),v.valueNil()];
	for (const op of [OpCode.EQ,OpCode.LT,OpCode.LE]) {
		const cpu=machine(op), closure=cpu.activeThread.currentFrame!.closure;let first=true;
		for(const a of values)for(const b of values) {
			if(!first)cpu.beginCompletionCall(closure);first=false;
			const regs=cpu.activeThread.currentFrame!.registers;regs.set(0,a);regs.set(1,b);cpu.runUntilDepth(0,100);
			const both=v.valueIsNumber(a)&&v.valueIsNumber(b),order=both?v.compareNumbers(a,b):2;
			const expected=op===OpCode.EQ?v.valuesEqual(a,b):both&&(op===OpCode.LT?order===-1:order<=0);
			const results:v.Value[]=[];cpu.readCompletionValues(results);assert.equal(results[0],v.valueBool(expected));
		}
	}
});
test(`${backend}: scalar memory loads/stores retain raw words and charge the external F64 transfer`, { skip: !runner }, () => {
	for(const kind of [MemoryAccessKind.Word,MemoryAccessKind.U32LE,MemoryAccessKind.F32LE,MemoryAccessKind.F64LE]) {
		const cpu=machine(OpCode.LOAD_MEM,kind),address=DYNAMIC_RAM_BASE+0x200;
		cpu.memory.writeMappedU32LE(address,kind===MemoryAccessKind.F32LE?0xffa12345:0xffffffff);
		if(kind===MemoryAccessKind.F64LE)cpu.memory.writeMappedF64LE(address,16777217);
		cpu.activeThread.currentFrame!.registers.setInteger(0,address);cpu.runUntilDepth(0,1);
		const expected=kind===MemoryAccessKind.F32LE?v.valueFloatBits(0xffa12345):kind===MemoryAccessKind.F64LE?v.valueFloat(16777216):v.valueInteger(-1);
		assert.equal(cpu.readFrameRegister(0,2),expected);
		assert.equal(cpu.instructionBudgetRemaining,1-BASE_CYCLES[OpCode.LOAD_MEM]-(kind===MemoryAccessKind.F64LE?2:0));
	}
	for(const kind of [MemoryAccessKind.Word,MemoryAccessKind.F32LE,MemoryAccessKind.F64LE]) {
		const cpu=machine(OpCode.STORE_MEM,kind),address=DYNAMIC_RAM_BASE+0x300,regs=cpu.activeThread.currentFrame!.registers;
		regs.setInteger(0,address);regs.set(2,kind===MemoryAccessKind.F32LE?v.valueFloatBits(0xffa12345):v.valueInteger(-1));cpu.runUntilDepth(0,1);
		if(kind===MemoryAccessKind.F64LE)assert.equal(cpu.memory.readMappedF64LE(address),-1);
		else assert.equal(cpu.memory.readMappedU32LE(address),kind===MemoryAccessKind.F32LE?0xffa12345:0xffffffff);
	}
	for(const op of [OpCode.LOAD_MEM,OpCode.STORE_MEM]) {
		const cpu=machine(op,MemoryAccessKind.F64LE);cpu.activeThread.currentFrame!.registers.setInteger(0,DYNAMIC_RAM_BASE+1);cpu.runUntilDepth(0,1);
		assert.equal(cpu.instructionBudgetRemaining,-4);
	}
});
test(`${backend}: started F64 transfers retain the format charge when address conversion faults`, { skip: !runner }, () => {
	for (const op of [OpCode.LOAD_MEM, OpCode.LOAD_MEM_D, OpCode.STORE_MEM, OpCode.STORE_MEM_D]) {
		for (const bad of [v.valueNil(), v.valueBool(true), v.valueFloatBits(0x7fc00000), v.valueFloatBits(0x7f800000)]) {
			const cpu = machine(op, MemoryAccessKind.F64LE), closure = cpu.activeThread.currentFrame!.closure;
			const owner = cpu.activeThread.currentFrame!.executionImage;
			for (let i = 0; i < 12; ++i) {
				if (i !== 0) cpu.beginCompletionCall(closure);
				const r = cpu.activeThread.currentFrame!.registers;
				r.setInteger(0, DYNAMIC_RAM_BASE + 0x300); r.setInteger(2, 917);
				assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
			}
			let generated = 0;
			if (backend === CpuExecutionBackend.JavaScript) {
				const page = owner.compiledCodeLookup!.find(cpu.captureClosureBinding(closure).codeAddress, 0)!;
				assert.ok(page.compiledBlocks);
				for (const region of new Set(page.compiledBlocks.entries.filter(block => block !== null).map(block => block.region))) {
					const execute = region.execute;
					Object.defineProperty(region, 'execute', { value: (...args: Parameters<typeof execute>) => { ++generated; return execute(...args); } });
				}
			}
			cpu.beginCompletionCall(closure);
			const r = cpu.activeThread.currentFrame!.registers;
			r.set(0, bad); r.setInteger(2, 917);
			const grant = 32;
			cpu.runUntilDepth(0, grant);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
			assert.equal(cpu.instructionBudgetRemaining, grant - 5 - BASE_CYCLES[OpCode.HALT], 'started transfer plus the real exception handler HALT');
			assert.equal(r.get(2), v.valueInteger(917));
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(generated > 0, 'the fault must occur in generated execution');
		}
	}
});

test(`${backend}: CPU snapshot rebuilds compact globals, raw Float registers and cyclic heap references`, { skip: !runner }, () => {
	const rom=new Uint8Array(execFileSync(runner!,['--rom-constants']));
	const memory=new Memory({systemRom:rom,cartridgeSlots:cartridgeSlots()},PSX_MACHINE_SPEC.ramBytes);
	const cpu=new CPU(memory,new IrqController(memory),new ExecutionAddressSpace(memory),backend);cpu.reset();
	const saved=cpu.stringPool.find('saved')!, system=cpu.stringPool.find('system')!, graphKey=cpu.stringPool.find('graph')!;
	cpu.setGlobalByKey(saved,v.valueFloatBits(0xffa54321));cpu.setSystemGlobalByKey(system,v.valueInteger(-2147483648));
	const table=cpu.createTable(), child=cpu.createTable();const self=cpu.stringPool.intern('self'),childKey=cpu.stringPool.intern('child');
	cpu.gc.tables.setStringKey(table, self,v.valueTable(table));cpu.gc.tables.setStringKey(table, childKey,v.valueTable(child));
	cpu.gc.tables.setMetatableAddress(child, table);cpu.setGlobalByKey(graphKey,v.valueTable(table));
	cpu.runUntilDepth(0,1);assert.equal(cpu.readFrameRegister(0,2),v.valueFloatBits(0xffa12345));
	const ram=memory.captureSaveState(), state=cpu.captureRuntimeState();const hash=table, childHash=child;
	cpu.activeThread.currentFrame!.registers.setInteger(2,8);cpu.setGlobalByKey(saved,v.valueInteger(7));
	for(let i=0;i<10;++i)cpu.createTable();
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	assert.equal(cpu.readFrameRegister(0,2),v.valueFloatBits(0xffa12345));
	assert.equal(cpu.getGlobalByKey(saved),v.valueFloatBits(0xffa54321));assert.equal(cpu.getSystemGlobalByKey(system),v.valueInteger(-2147483648));
	const restored=v.valuePayload(cpu.getGlobalByKey(graphKey)),restoredChild=v.valuePayload(cpu.gc.tables.getStringKey(restored, childKey));
	assert.equal(restored,hash);assert.equal(restoredChild,childHash);
	assert.equal(v.valuePayload(cpu.gc.tables.getStringKey(restored, self)),restored);assert.equal(cpu.gc.tables.metatableAddress(restoredChild),restored);
	assert.deepEqual(cpu.captureRuntimeState(),state);
	cpu.runUntilDepth(0,100);const result:v.Value[]=[];cpu.readCompletionValues(result);assert.equal(result[0],v.valueFloatBits(0xffa12345));
	cpu.gc.collect();assert.equal(v.valuePayload(cpu.getGlobalByKey(graphKey)),restored);
});

}
