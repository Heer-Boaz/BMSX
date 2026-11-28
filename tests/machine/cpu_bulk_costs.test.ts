import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';

import { valueBool, valueInteger, valueFloat, valueNil, valueString, valueTable, type Value, valueBuiltinFunction } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { runGuestToHalt } from '../helpers/cpu_test_harness';
import { compileTableIterationTest } from '../helpers/table_iteration';

for (const backend of [CpuExecutionBackend.Interpreter]) {
 test(`NEXT ignores physical scan slots and completes an exhausted primitive (${backend})`, () => {
  const text = new Uint8Array(3 * INSTRUCTION_BYTES);
  writeInstruction(text, 0, OpCode.CALL, 0, 3, 0);
  writeInstruction(text, 1, OpCode.K1, 7, 0, 0);
  writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
  const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 8 }] });
  const { cpu } = createTestHeapServiceCpu(image, backend);
  const next = valueBuiltinFunction(BuiltinFunctionId.Next);
  const frame = cpu.rootThread.currentFrame!;
  const entry = image.image.functions[0].codeAddress;
  const grant = BASE_CYCLES[OpCode.CALL] + 1;
  const runNext = (table: number, after: Value, expected: Value[]) => {
   cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
   frame.registers.set(0, next);
   frame.registers.setTable(1, table);
   frame.registers.set(2, after);
   frame.registers.setInteger(7, 91);
   assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
   assert.equal(cpu.instructionBudgetRemaining, -expected.length,
    'NEXT charges only the primitive and the receiving range');
   assert.equal(frame.top, expected.length, 'success returns two values; exhaustion returns one nil');
   assert.deepEqual(Array.from({ length: frame.top }, (_, index) => frame.registers.get(index)), expected);
   assert.equal(frame.pc, entry + INSTRUCTION_BYTES);
   assert.equal(frame.registers.getInteger(7), 91, 'the instruction following the admitted primitive does not execute');
  };
  const warm = createReferenceTable(cpu);
  for (let repeat = 0; repeat < 72; ++repeat) runNext(warm, valueNil(), [valueNil()]);
  if (backend === CpuExecutionBackend.JavaScript) {
   assert.equal(frame.decodedPage!.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!.terminal.exit,
    CompiledBlockExit.Call, 'the measured NEXT calls use a warmed generated call entry');
  }

  for (const [array, hash] of [[5, 0], [0, 3], [5, 3]]) {
   const empty = createReferenceTable(cpu, array, hash);
   for (let repeat = 0; repeat < 3; ++repeat) runNext(empty, valueNil(), [valueNil()]);
  }
  const sparse = createReferenceTable(cpu, 8, 0);
  nativeHeapReference(cpu).gc.tables.setInteger(sparse, 3, valueInteger(33));
  nativeHeapReference(cpu).gc.tables.setInteger(sparse, 7, valueInteger(77));
  runNext(sparse, valueNil(), [valueInteger(3), valueInteger(33)]);
  runNext(sparse, valueInteger(3), [valueInteger(7), valueInteger(77)]);
  runNext(sparse, valueInteger(7), [valueNil()]);
  runNext(sparse, valueInteger(8), [valueNil()]);
  runNext(sparse, valueInteger(2), [valueInteger(3), valueInteger(33)]);

  const hash = createReferenceTable(cpu, 0, 8);
  for (let index = 0; index < 8; ++index) nativeHeapReference(cpu).gc.tables.setStringKey(hash, nativeHeapReference(cpu).stringPool.intern(`next-${index}`), valueInteger(index + 10));
  const stored = new ValueSlots(2);
  const keys: Value[] = [], values: Value[] = [];
  for (let slot = 0; slot < 8; ++slot) {
   assert.equal(cpu.tables.loadStoredEntry(hash, slot, stored, 0), true);
   keys.push(stored.get(0));
   values.push(stored.get(1));
  }
  for (let slot = 0; slot < 8; ++slot) if (slot !== 1 && slot !== 4) nativeHeapReference(cpu).gc.tables.set(hash, keys[slot], valueNil());
  runNext(hash, valueNil(), [keys[1], values[1]]);
  runNext(hash, keys[1], [keys[4], values[4]]);
  runNext(hash, keys[2], [keys[4], values[4]]);
  runNext(hash, keys[4], [valueNil()]);

  const falseKey = createReferenceTable(cpu, 0, 1);
  nativeHeapReference(cpu).gc.tables.set(falseKey, valueBool(false), valueBool(false));
  runNext(falseKey, valueNil(), [valueBool(false), valueBool(false)]);
  runNext(falseKey, valueBool(false), [valueNil()]);
 });

 test(`NEXT source result counts remain one nil or a key/value pair (${backend})`, () => {
  const image = compileTableIterationTest(`
local function capture(...) return select('#', ...), ... end
local values<const> = { [false] = false }
local count, key, value = capture(next(values, nil))
assert(count == 2 and key == false and value == false)
count, key, value = capture(next(values, key))
assert(count == 1 and key == nil and value == nil)
count, key, value = capture(next({33}))
assert(count == 2 and key == 1 and value == 33)
count, key, value = capture(next({}))
assert(count == 1 and key == nil and value == nil)
return true`, 3);
  const { cpu } = createTestHeapServiceCpu(image, backend);
  runGuestToHalt(cpu, 200_000);
  const values: Value[] = [];
  cpu.readCompletionValues(values);
  assert.deepEqual(values, [valueBool(true)]);
 });

 test(`host table rebuilds touch only transient CPU grant scratch, not scheduler or checkpoint time (${backend})`, () => {
  const text = new Uint8Array(INSTRUCTION_BYTES);
  writeInstruction(text, 0, OpCode.SETT, 0, 1, 2);
  const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 3 }] });
  const { cpu } = createTestHeapServiceCpu(image, backend), scheduler = new DeviceScheduler(cpu);
  scheduler.setNowCycles(73);
  const r = cpu.rootThread.currentFrame!.registers, table = createReferenceTable(cpu);
  const key = valueString(nativeHeapReference(cpu).stringPool.intern('field'));
  r.setTable(0, table); r.set(1, key); r.setInteger(2, 91); cpu.rootThread.currentFrame!.top = 3;
  cpu.instructionBudgetRemaining = 29;
  nativeHeapReference(cpu).gc.tables.set(table, key, valueInteger(37));
  assert.equal(cpu.instructionBudgetRemaining, 29);
  assert.equal(scheduler.currentNowCycles(), 73, 'host storage work does not advance machine time');
  const saved = cpu.captureRuntimeState();
  cpu.instructionBudgetRemaining = -99;
  assert.deepEqual(cpu.captureRuntimeState(), saved, 'grant scratch is not checkpoint state');
  cpu.restoreRuntimeState(saved);
  assert.equal(cpu.instructionBudgetRemaining, -99, 'restore does not price reconstructed storage');
  assert.equal(scheduler.currentNowCycles(), 73);
  assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
  assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.SETT], 'the next execution owns a fresh grant');
  assert.equal(cpu.tables.get(cpu.rootThread.currentFrame!.registers.getPayload(0), key), valueInteger(91));
 });

}
