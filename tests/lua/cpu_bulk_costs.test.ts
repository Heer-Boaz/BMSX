import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { Table } from '../../machine/ts/machine/cpu/table';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
 for (const [array, hash] of [[0, 0], [1, 0], [0, 3], [8, 3]]) {
  test(`NEWT charges initialized value capacity (${backend}, ${array}, ${hash})`, () => {
   const text = new Uint8Array(2 * INSTRUCTION_BYTES);
   writeInstruction(text, 0, OpCode.NEWT, 0, array, hash);
   writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
   const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 1 }] });
   const { cpu } = createTestSystemCpu(image, backend);
   cpu.runUntilDepth(0, 10000);
   cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
   const charged = BASE_CYCLES[OpCode.NEWT] + array + 2 * Table.hashCapacity(hash);
   assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
   assert.equal(cpu.instructionBudgetRemaining, 1 - charged);
   assert.equal(cpu.rootThread.currentFrame!.pc, image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
   assert.ok(cpu.rootThread.currentFrame!.registers.getTable(0));
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
