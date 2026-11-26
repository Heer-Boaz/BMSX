import { GC_LAST_EPOCH_WORK, GC_WORK_WORD_CYCLES, GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { HEAP_PAGE_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';

import { valueBool, valueInteger, valueFloat, valueNil, valueString, valueTable, type Value } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { BuiltinFunctionId, LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { compileTableIterationTest } from '../helpers/table_iteration';

for (const backend of [CpuExecutionBackend.Interpreter]) {
 test(`NEXT ignores physical scan slots and completes an exhausted primitive (${backend})`, () => {
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
  const warm = cpu.createTable();
  for (let repeat = 0; repeat < 72; ++repeat) runNext(warm, valueNil(), [valueNil()]);
  if (backend === CpuExecutionBackend.JavaScript) {
   assert.equal(frame.decodedPage!.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!.terminal.exit,
    CompiledBlockExit.Call, 'the measured NEXT calls use a warmed generated call entry');
  }

  for (const [array, hash] of [[5, 0], [0, 3], [5, 3]]) {
   const empty = cpu.createTable(array, hash);
   for (let repeat = 0; repeat < 3; ++repeat) runNext(empty, valueNil(), [valueNil()]);
  }
  const sparse = cpu.createTable(8, 0);
  cpu.gc.tables.setInteger(sparse, 3, valueInteger(33));
  cpu.gc.tables.setInteger(sparse, 7, valueInteger(77));
  runNext(sparse, valueNil(), [valueInteger(3), valueInteger(33)]);
  runNext(sparse, valueInteger(3), [valueInteger(7), valueInteger(77)]);
  runNext(sparse, valueInteger(7), [valueNil()]);
  runNext(sparse, valueInteger(8), [valueNil()]);
  runNext(sparse, valueInteger(2), [valueInteger(3), valueInteger(33)]);

  const hash = cpu.createTable(0, 8);
  for (let index = 0; index < 8; ++index) cpu.gc.tables.setStringKey(hash, cpu.stringPool.intern(`next-${index}`), valueInteger(index + 10));
  const stored = new ValueSlots(2);
  const keys: Value[] = [], values: Value[] = [];
  for (let slot = 0; slot < 8; ++slot) {
   assert.equal(cpu.gc.tables.loadStoredEntry(hash, slot, stored, 0), true);
   keys.push(stored.get(0));
   values.push(stored.get(1));
  }
  for (let slot = 0; slot < 8; ++slot) if (slot !== 1 && slot !== 4) cpu.gc.tables.set(hash, keys[slot], valueNil());
  runNext(hash, valueNil(), [keys[1], values[1]]);
  runNext(hash, keys[1], [keys[4], values[4]]);
  runNext(hash, keys[2], [keys[4], values[4]]);
  runNext(hash, keys[4], [valueNil()]);

  const falseKey = cpu.createTable(0, 1);
  cpu.gc.tables.set(falseKey, valueBool(false), valueBool(false));
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
  const { cpu } = createTestSystemCpu(image, backend);
  cpu.installBootPrimitives();
  assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
  const values: Value[] = [];
  cpu.readCompletionValues(values);
  assert.deepEqual(values, [valueBool(true)]);
 });

 for (const [array, hash, capacity] of [[0, 0, 0], [1, 0, 0], [0, 1, 1], [7, 3, 4], [13, 5, 8], [0, 31, 32], [9, 33, 64], [63, 63, 64]]) {
  test(`NEWT reserves capacity at the base charge (${backend}, ${array}, ${hash})`, () => {
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
   assert.equal(cpu.instructionBudgetRemaining, 0);
   assert.equal(cpu.rootThread.currentFrame!.pc, image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
   assert.equal(cpu.gc.tables.storedSlotCount(cpu.rootThread.currentFrame!.registers.getPayload(0)), array + capacity);
  });
 }

 test(`field growth charges completed scans, initialization and relocation (${backend})`, () => {
  const text = new Uint8Array(2 * INSTRUCTION_BYTES);
  writeInstruction(text, 0, OpCode.SETT, 0, 1, 2);
  writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
  const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 3 }] });
  const { cpu } = createTestSystemCpu(image, backend);
  const frame = cpu.rootThread.currentFrame!;
  const entry = image.image.functions[0].codeAddress;
  const keys = Array.from({ length: 16 }, (_, index) => cpu.stringPool.intern(`growth-${index}`));
  frame.registers.setTable(0, cpu.createTable(0, 16));
  frame.registers.setString(1, keys[0]);
  frame.registers.setInteger(2, 73);
  cpu.runUntilDepth(0, 10000);
  if (backend === CpuExecutionBackend.JavaScript) {
   assert.ok(frame.decodedPage!.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES],
    'the generated table-store region is actually warmed');
  }
  for (const initialCapacity of [0, 16]) {
   const table = cpu.createTable(0, initialCapacity);
   frame.registers.setTable(0, table);
   let initializedSlots = 0;
   let previousCapacity = cpu.gc.tables.storedSlotCount(table);
   for (let index = 0; index < keys.length; index += 1) {
    frame.registers.setString(1, keys[index]);
    cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
    const grant = BASE_CYCLES[OpCode.SETT] + 1;
    assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
    assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.JMP]);
    assert.equal(frame.pc, entry,
     'growth finishes atomically and stops before the following instruction');
    assert.equal(cpu.gc.tables.getStringKey(table, keys[index]), valueInteger(73));
    const capacity = cpu.gc.tables.storedSlotCount(table);
    assert.equal(capacity, initialCapacity || (1 << (32 - Math.clz32(index))));
    if (capacity !== previousCapacity) initializedSlots += 2 * capacity;
    previousCapacity = capacity;
   }
   assert.equal(initializedSlots, initialCapacity === 0 ? 62 : 0,
    'every replacement initializes its entire key/value storage');
  }
 });
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
 test(`collision placement resumes from the same grant and RAM checkpoint (${backend})`, () => {
  const text = new Uint8Array(2 * INSTRUCTION_BYTES);
  writeInstruction(text, 0, OpCode.SETFIELD, 0, 0, 1);
  writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
  const image = linkRawTestSystemBlua32({ text, constants: ['new'], functions: [{ firstWord: 0, wordCount: 2, maxStack: 2 }] });
  const { cpu } = createTestSystemCpu(image, backend);
  const t = cpu.createTable(0, 256), tables = cpu.gc.tables, field = cpu.stringPool.intern('new');
  for (let i = 1; i <= 256; ++i) tables.setInteger(t, -i, valueInteger(i));
  const r = cpu.rootThread.currentFrame!.registers;
  r.setTable(0, t); r.setInteger(1, 73);
  const grant = () => cpu.runUntilDepth(0, 8, cpu.rootThread.address, CpuRunKind.Scheduled);
  cpu.runUntilDepth(0, 16, cpu.rootThread.address, CpuRunKind.Scheduled);
  for (let i = 0; !cpu.tableRebuild.cursor; ++i) {
   assert.ok(i < 1024); assert.equal(grant(), RunResult.Yielded);
  }
  cpu.requestNonMaskableInterrupt();
  assert.equal(cpu.enterPendingInterrupt(), false);
  cpu.cancelNonMaskableInterrupt();
  const anchor = cpu.captureRuntimeState(), ram = cpu.memory.captureSaveState();
  assert.ok(cpu.tableRebuild.collisions);
  assert.equal(tables.getStringKey(t, field), valueNil());
  assert.equal(tables.hashSize(t), 256);
  const finish = () => {
   let n = 0;
   while (cpu.tableRebuild.record) {
    assert.ok(++n < 1024); assert.equal(grant(), RunResult.Yielded);
   }
   assert.equal(tables.getStringKey(t, field), valueInteger(73));
   assert.equal(grant(), RunResult.Halted);
   return n;
  };
  const n = finish(), expected = cpu.memory.captureSaveState();
  cpu.memory.restoreSaveState(ram); cpu.restoreRuntimeState(anchor);
  assert.equal(finish(), n);
  assert.deepEqual(cpu.memory.captureSaveState().ram, expected.ram);
 });

 for (const protect of [false, true]) test(`rawset publishes before growing its result window (${backend}, protected=${protect})`, () => {
  const text = new Uint8Array(2 * INSTRUCTION_BYTES);
  writeInstruction(text, 0, OpCode.CALL, 0, protect ? 5 : 4, 17);
  writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
  const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 5 }] });
  const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!, r = frame.registers;
  const t = cpu.createTable(0, 256), tables = cpu.gc.tables, key = cpu.stringPool.intern('new');
  for (let i=1; i<=256; ++i) tables.setInteger(t, -i, valueInteger(i));
  const a = protect ? 1 : 0;
  if (protect) r.setBuiltinFunction(0, BuiltinFunctionId.PCall);
  r.setBuiltinFunction(a, BuiltinFunctionId.RawSet);
  r.setTable(a+1, t); r.setString(a+2, key); r.setInteger(a+3, 9);
  const original = r.get(0);
  cpu.runUntilDepth(0, 40, cpu.rootThread.address, CpuRunKind.Scheduled);
  assert.equal(r.get(0), original); assert.ok(cpu.tableRebuild.record); assert.equal(tables.getStringKey(t, key), valueNil());
  const anchor = cpu.captureRuntimeState(), ram = cpu.memory.captureSaveState();
  for (const restored of [false, true]) {
   if (restored) { cpu.memory.restoreSaveState(ram); cpu.restoreRuntimeState(anchor); }
   for (let n=0; cpu.tableRebuild.record; ++n) {
    assert.ok(n<1024); assert.equal(cpu.runUntilDepth(0,8,cpu.rootThread.address,CpuRunKind.Scheduled), RunResult.Yielded);
   }
   assert.equal(tables.getStringKey(t, key), valueInteger(9));
   assert.equal(cpu.rootThread.currentFrame!.registers.get(a), valueTable(t));
   if (protect) assert.equal(cpu.rootThread.currentFrame!.registers.get(0), valueBool(true));
   assert.equal(cpu.rootThread.currentFrame!.registers.get(15), valueNil());
  }
 });

 for (const op of [OpCode.SETT, OpCode.SETI, OpCode.SETFIELD, OpCode.CALL]) {
  test(`table-write routes charge large scans but not overwrites (${backend}, ${op})`, () => {
   const text = new Uint8Array(2 * INSTRUCTION_BYTES);
   writeInstruction(text, 0, op, 0, op === OpCode.SETFIELD ? 0 : op === OpCode.CALL ? 4 : 1, op === OpCode.CALL ? 1 : 2);
   writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
   const image = linkRawTestSystemBlua32({ text, constants: ['field'], functions: [{ firstWord: 0, wordCount: 2, maxStack: 5 }] });
   const { cpu } = createTestSystemCpu(image, backend);
   const frame = cpu.rootThread.currentFrame!, r = frame.registers;
   const entry = image.image.functions[0].codeAddress;
   const integer = op === OpCode.SETI;
   const key = integer ? valueInteger(1) : valueString(cpu.stringPool.intern('field'));
   const prepare = (array: number, hash: number) => {
    const table = cpu.createTable(array, hash);
    if (op === OpCode.CALL) {
     r.setBuiltinFunction(0, BuiltinFunctionId.RawSet); r.setTable(1, table);
     r.set(2, key); r.setInteger(3, 73);
    } else {
     r.setTable(0, table); r.set(1, key); r.setInteger(2, 73);
    }
    return table;
   };
   prepare(integer ? 1 : 0, integer ? 0 : 1); cpu.runUntilDepth(0, 10000);
   if (backend === CpuExecutionBackend.JavaScript) {
    assert.ok(frame.decodedPage!.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES],
     'the allocating miss is entered from an adopted generated region');
   }
   const table = prepare(0, 0);
   cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
   const base = BASE_CYCLES[op] + (op === OpCode.CALL ? 1 : 0);
   assert.equal(cpu.runUntilDepth(0, base), RunResult.Yielded);
   assert.equal(cpu.instructionBudgetRemaining, 0);
   assert.equal(frame.pc, entry + INSTRUCTION_BYTES);
   assert.equal(cpu.gc.tables.get(table, key), valueInteger(73));
   for (const hash of [64, 128, 1024]) for (const kind of [CpuRunKind.Direct, CpuRunKind.Scheduled]) {
    const full = prepare(integer ? 0 : 512, hash);
    for (let i = 1; i <= hash; ++i) cpu.gc.tables.setInteger(full, -i, valueInteger(i));
    for (const overwrite of [false, true]) {
     cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
     assert.equal(cpu.runUntilDepth(0, base, cpu.rootThread.address, kind), RunResult.Yielded);
     assert.equal(cpu.instructionBudgetRemaining, !integer || overwrite || hash === 64 ? 0 : -(hash - 64) / 2);
     assert.equal(frame.pc, entry + INSTRUCTION_BYTES);
     if (!integer && !overwrite && hash > 64) {
      assert.equal(cpu.tableRebuild.record, full);
      assert.equal(cpu.gc.tables.get(full, key), valueNil());
      for (let steps = 0; cpu.tableRebuild.record; ++steps) {
       assert.ok(steps < 5 * hash);
       assert.equal(cpu.runUntilDepth(0, 8, cpu.rootThread.address, kind), RunResult.Yielded);
       assert.equal(frame.pc, entry + INSTRUCTION_BYTES);
      }
      for (let i = 1; i <= hash; ++i) assert.equal(cpu.gc.tables.getInteger(full, -i), valueInteger(i));
     }
     assert.equal(cpu.gc.tables.get(full, key), valueInteger(73));
    }
   }
  });
 }
}

for (const backend of [CpuExecutionBackend.Interpreter]) {
 for (const scenario of ['array-growth', 'hash-to-array', 'array-to-hash', 'mixed', 'same-capacity', 'weak-collection', 'failed-growth'] as const) {
  test(`table rebuild adds no storage surcharge: ${scenario} (${backend})`, () => {
   const text = new Uint8Array(33 * INSTRUCTION_BYTES);
   writeInstruction(text, 0, OpCode.SETT, 0, 1, 2);
   writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
   writeInstruction(text, 32, OpCode.HALT, 0, 0, 0);
   const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 5 },
    { firstWord: 32, wordCount: 1 }], exceptionFunctionIndex: 1 });
   const { cpu } = createTestSystemCpu(image, backend);
   const frame = cpu.rootThread.currentFrame!, r = frame.registers;
   const entry = image.image.functions[0].codeAddress;
   r.setTable(0, cpu.createTable(0, 1)); r.set(1, valueString(cpu.stringPool.intern('warm'))); r.setInteger(2, 73);
   cpu.runUntilDepth(0, 10000);
   if (backend === CpuExecutionBackend.JavaScript) {
    assert.ok(frame.decodedPage!.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]);
   }
   const field = valueString(cpu.stringPool.intern('field'));
   const other = valueString(cpu.stringPool.intern('other'));
   const array = scenario === 'array-growth' ? 2 : scenario === 'array-to-hash' ? 8 : scenario === 'mixed' ? 4 : 0;
   const hash = scenario === 'hash-to-array' || scenario === 'mixed' || scenario === 'same-capacity' || scenario === 'weak-collection' ? 2 : scenario === 'failed-growth' ? 1024 : 0;
   const table = cpu.createTable(array, hash);
   r.setTable(0, table); r.setInteger(2, 73); frame.top = 5;
   let capacity: number;
   if (scenario === 'array-growth') {
    cpu.gc.tables.setInteger(table, 1, valueInteger(11)); cpu.gc.tables.setInteger(table, 2, valueInteger(22)); r.setInteger(1, 3);
    capacity = 4;
   } else if (scenario === 'hash-to-array') {
    cpu.gc.tables.setInteger(table, 1, valueInteger(11)); cpu.gc.tables.setInteger(table, 3, valueInteger(33)); r.setInteger(1, 2);
    capacity = 4;
   } else if (scenario === 'array-to-hash') {
    cpu.gc.tables.setInteger(table, 8, valueInteger(88)); r.setInteger(1, 9);
    capacity = 2;
   } else if (scenario === 'mixed') {
    cpu.gc.tables.setInteger(table, 1, valueInteger(11)); cpu.gc.tables.setInteger(table, 4, valueInteger(44)); cpu.gc.tables.set(table, field, valueInteger(55)); cpu.gc.tables.set(table, other, valueInteger(66));
    r.setInteger(1, 9);
    capacity = 5;
   } else if (scenario === 'same-capacity') {
    cpu.gc.tables.set(table, field, valueInteger(55)); cpu.gc.tables.set(table, other, valueInteger(66)); cpu.gc.tables.set(table, other, valueNil());
    r.set(1, valueString(cpu.stringPool.intern('third')));
    capacity = 2;
   } else if (scenario === 'weak-collection') {
    const mode = cpu.createTable(0, 1);
    cpu.gc.tables.setStringKey(mode, cpu.stringPool.intern('__mode'), valueString(cpu.stringPool.intern('v'))); cpu.gc.tables.setMetatableAddress(table, mode);
    cpu.gc.tables.set(table, field, valueTable(cpu.createTable())); cpu.gc.tables.set(table, other, valueTable(cpu.createTable()));
    r.set(1, valueString(cpu.stringPool.intern('third')));
    while (cpu.gc.phase() !== GcPhase.Atomic) cpu.gc.step();
    const trackedBytes = cpu.luaHeap.usedBytes();
    cpu.luaHeap.setCollectionTarget(trackedBytes);
    capacity = 4;
   } else {
    for (let i = 0; i < 1024; ++i) cpu.gc.tables.set(table, valueFloat(i + 0.5), valueInteger(i));
    r.setFloat(1, 1024.5);
    const retainedSlots = ((cpu.luaHeap.capacity() - cpu.luaHeap.usedBytes() - 20 * HEAP_PAGE_SIZE) / 5) | 0;
    r.setTable(4, cpu.createTable(retainedSlots));
    cpu.collectTrackedHeapBytes();
    cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
    // Claim all remaining page runs so the live table has no contiguous
    // replacement backing even after the emergency collection.
    while (cpu.heapAllocator.allocate(HEAP_PAGE_SIZE, true) !== 0) { /* fixture-owned RAM */ }
    capacity = 1024;
   }
   const key = r.get(1);
   cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
   assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.SETT]), RunResult.Yielded);
   const recoveryCost = scenario === 'failed-growth' ? GC_WORK_WORD_CYCLES *
    cpu.memory.readRamRecordWord(cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET + GC_LAST_EPOCH_WORK) : 0;
   assert.equal(cpu.instructionBudgetRemaining + recoveryCost, 0, 'a hash-only retry uses the live count again; only recovery work adds to the base charge');
   assert.equal(frame.pc, scenario === 'failed-growth' ? entry : entry + INSTRUCTION_BYTES);
   assert.equal(cpu.gc.tables.storedSlotCount(table), capacity);
   if (scenario === 'failed-growth') {
    assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
    assert.equal(cpu.gc.tables.get(table, key), valueNil(), 'failed admission performs no insertion');
    assert.equal(cpu.gc.tables.get(table, valueFloat(0.5)), valueInteger(0), 'existing mappings survive failed admission');
   } else {
    assert.equal(cpu.gc.tables.get(table, key), valueInteger(73));
    if (scenario === 'weak-collection') {
     assert.equal(cpu.gc.finalMarkPending(), true, 'the store does not enter the pending final collection');
     assert.notEqual(cpu.gc.tables.get(table, field), valueNil());
     assert.notEqual(cpu.gc.tables.get(table, other), valueNil());
     cpu.gc.finishFinalMark();
     assert.equal(cpu.instructionBudgetRemaining, 0, 'final work uses no guest grant');
     assert.equal(cpu.gc.tables.get(table, field), valueNil());
     assert.equal(cpu.gc.tables.get(table, other), valueNil());
     assert.equal(cpu.gc.tables.get(table, key), valueInteger(73));
    }
   }
  });
 }


 test(`host table rebuilds touch only transient CPU grant scratch, not scheduler or checkpoint time (${backend})`, () => {
  const text = new Uint8Array(INSTRUCTION_BYTES);
  writeInstruction(text, 0, OpCode.SETT, 0, 1, 2);
  const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 3 }] });
  const { cpu } = createTestSystemCpu(image, backend), scheduler = new DeviceScheduler(cpu);
  scheduler.setNowCycles(73);
  const r = cpu.rootThread.currentFrame!.registers, table = cpu.createTable();
  const key = valueString(cpu.stringPool.intern('field'));
  r.setTable(0, table); r.set(1, key); r.setInteger(2, 91); cpu.rootThread.currentFrame!.top = 3;
  cpu.instructionBudgetRemaining = 29;
  cpu.gc.tables.set(table, key, valueInteger(37));
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
  assert.equal(cpu.gc.tables.get(cpu.rootThread.currentFrame!.registers.getPayload(0), key), valueInteger(91));
 });

}
