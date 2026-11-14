import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { type Value } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { compileTableIterationTest } from '../helpers/table_iteration';

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
 test(`NEXT charges physical scan slots and completes an exhausted primitive (${backend})`, () => {
  const text = new Uint8Array(3 * INSTRUCTION_BYTES);
  writeInstruction(text, 0, OpCode.CALL, 0, 3, 0);
  writeInstruction(text, 1, OpCode.K1, 7, 0, 0);
  writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
  const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 8 }],
   systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name) });
  const { cpu } = createTestSystemCpu(image, backend);
  cpu.installBootPrimitives();
  const next = cpu.getSystemGlobalByKey(cpu.stringPool.intern('__bmsx_next'));
  const frame = cpu.rootThread.currentFrame!;
  const entry = image.image.functions[0].codeAddress;
  const grant = BASE_CYCLES[OpCode.CALL] + 1;
  const runNext = (table: Table, after: Value, slots: number, expected: Value[]) => {
   cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
   frame.registers.set(0, next);
   frame.registers.setTable(1, table);
   frame.registers.set(2, after);
   frame.registers.setNumber(7, 91);
   assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
   assert.equal(cpu.instructionBudgetRemaining, -slots - expected.length,
    'NEXT adds only inspected Value slots to its existing primitive and result-placement costs');
   assert.equal(frame.top, expected.length, 'success returns two values; exhaustion returns one nil');
   assert.deepEqual(Array.from({ length: frame.top }, (_, index) => frame.registers.get(index)), expected);
   assert.equal(frame.pc, entry + INSTRUCTION_BYTES);
   assert.equal(frame.registers.getNumber(7), 91, 'the instruction following the admitted primitive does not execute');
  };
  const warm = cpu.createTable();
  for (let repeat = 0; repeat < 72; ++repeat) runNext(warm, null, 0, [null]);
  if (backend === CpuExecutionBackend.JavaScript) {
   assert.equal(frame.decodedPage!.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!.terminal.exit,
    CompiledBlockExit.Call, 'the measured NEXT calls use a warmed generated call entry');
  }

  for (const [array, hash, slots] of [[5, 0, 5], [0, 3, 8], [5, 3, 13]]) {
   const empty = cpu.createTable(array, hash);
   for (let repeat = 0; repeat < 3; ++repeat) runNext(empty, null, slots, [null]);
  }
  const sparse = cpu.createTable(8, 0);
  sparse.setInteger(3, 33);
  sparse.setInteger(7, 77);
  runNext(sparse, null, 3, [3, 33]);
  runNext(sparse, 3, 4, [7, 77]);
  runNext(sparse, 7, 1, [null]);
  runNext(sparse, 8, 0, [null]);
  runNext(sparse, 2, 1, [3, 33]);

  const hash = cpu.createTable(0, 8);
  for (let index = 0; index < 8; ++index) hash.setStringKey(cpu.stringPool.intern(`next-${index}`), index + 10);
  const stored = new ValueSlots(2);
  const keys: Value[] = [], values: Value[] = [];
  for (let slot = 0; slot < 8; ++slot) {
   assert.equal(hash.loadStoredEntry(slot, stored, 0), true);
   keys.push(stored.get(0));
   values.push(stored.get(1));
  }
  for (let slot = 0; slot < 8; ++slot) if (slot !== 1 && slot !== 4) hash.set(keys[slot], null);
  runNext(hash, null, 4, [keys[1], values[1]]);
  runNext(hash, keys[1], 6, [keys[4], values[4]]);
  runNext(hash, keys[2], 4, [keys[4], values[4]]);
  runNext(hash, keys[4], 6, [null]);

  const falseKey = cpu.createTable(0, 1);
  falseKey.set(false, false);
  runNext(falseKey, null, 2, [false, false]);
  runNext(falseKey, false, 0, [null]);
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
  const { cpu } = createTestSystemCpu(image, backend);
  cpu.installBootPrimitives();
  assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
  const values: Value[] = [];
  cpu.readCompletionValues(values);
  assert.deepEqual(values, [true]);
 });

 for (const [array, hash, capacity] of [[0, 0, 0], [1, 0, 0], [0, 1, 1], [7, 3, 4], [13, 5, 8], [0, 31, 32], [9, 33, 64], [63, 63, 64]]) {
  test(`NEWT charges initialized value capacity (${backend}, ${array}, ${hash})`, () => {
   const text = new Uint8Array(2 * INSTRUCTION_BYTES);
   writeInstruction(text, 0, OpCode.NEWT, 0, array, hash);
   writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
   const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 1 }] });
   const { cpu } = createTestSystemCpu(image, backend);
   cpu.runUntilDepth(0, 20000);
   const entry = image.image.functions[0].codeAddress;
   if (backend === CpuExecutionBackend.JavaScript) {
    const page = cpu.rootThread.currentFrame!.decodedPage!;
    assert.equal(page.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!.terminal.exit,
     CompiledBlockExit.AllocateTable, 'the NEWT entry is compiled before its cycle check');
   }
   cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
   const grant = BASE_CYCLES[OpCode.NEWT];
   assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
   assert.equal(cpu.instructionBudgetRemaining, 0 - (array + 2 * capacity));
   assert.equal(cpu.rootThread.currentFrame!.pc, image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
   assert.equal(cpu.rootThread.currentFrame!.registers.getTable(0).storedSlotCount, array + capacity);
  });
 }

 test(`field growth currently costs no extra guest cycles (${backend})`, () => {
  const text = new Uint8Array(2 * INSTRUCTION_BYTES);
  writeInstruction(text, 0, OpCode.SETT, 0, 1, 2);
  writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
  const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 3 }] });
  const { cpu } = createTestSystemCpu(image, backend);
  const frame = cpu.rootThread.currentFrame!;
  const entry = image.image.functions[0].codeAddress;
  const keys = Array.from({ length: 16 }, (_, index) => cpu.stringPool.intern(`growth-${index}`));
  frame.registers.setTable(0, cpu.createTable(0, 16));
  frame.registers.setStringId(1, keys[0]);
  frame.registers.setNumber(2, 73);
  cpu.runUntilDepth(0, 10000);
  if (backend === CpuExecutionBackend.JavaScript) {
   assert.ok(frame.decodedPage!.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES],
    'the generated table-store region is actually warmed');
  }
  for (const initialCapacity of [0, 16]) {
   const table = cpu.createTable(0, initialCapacity);
   frame.registers.setTable(0, table);
   let initializedSlots = 0;
   let previousCapacity = table.storedSlotCount;
   for (let index = 0; index < keys.length; index += 1) {
    frame.registers.setStringId(1, keys[index]);
    cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
    assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.SETT] + BASE_CYCLES[OpCode.JMP]), RunResult.Yielded);
    assert.equal(cpu.instructionBudgetRemaining, 0, 'each store and loop jump pays only its base charge');
    assert.equal(table.getStringKey(keys[index]), 73);
    const capacity = table.storedSlotCount;
    assert.equal(capacity, initialCapacity || (1 << (32 - Math.clz32(index))));
    if (capacity !== previousCapacity) initializedSlots += 2 * capacity;
    previousCapacity = capacity;
   }
   assert.equal(initializedSlots, initialCapacity === 0 ? 62 : 0,
    'growth initializes additional key/value storage without an instruction surcharge');
  }
 });
}
