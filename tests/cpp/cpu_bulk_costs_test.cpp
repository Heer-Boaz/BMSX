#include "common/utf8.h"
#include "machine/cpu/cpu.h"
#include "machine/common/numeric.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/memory_map.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <array>
#include <initializer_list>
#include <stdexcept>
#include <string>

using namespace bmsx;

namespace {
struct CpuMachine {
 test::Blua32TestRom rom;
 Memory memory;
 IrqController irq;
 ExecutionAddressSpace addresses;
 CPU cpu;
 CpuMachine(const test::Blua32TestImage& image, bool scalar)
  : rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
  , memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
  , irq(memory), addresses(memory), cpu(memory, irq, addresses) {
  cpu.reset();
  if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
 }
 void warm(bool scalar) {
  cpu.runUntilDepth(0, 10000);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
  if (!scalar) {
   auto& page = *cpu.activeThread()->frameAtDepth(0)->decodedPage;
   const u32 entry = (rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
   test::waitForNativeEntry(cpu, page, entry);
   if (!page.nativeBlocks->entries[entry]) throw std::runtime_error("table-write entry must be adopted before testing its allocating miss");
  }
#endif
 }
 void restart() {
  cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
 }
};

void writeRoutes(bool scalar) {
 for (const auto op : {OpCode::SETT, OpCode::SETI, OpCode::SETFIELD, OpCode::CALL}) {
  test::Blua32TestImage image;
  image.text.resize(2 * INSTRUCTION_BYTES);
  writeInstruction(image.text, 0, static_cast<u8>(op), 0, op == OpCode::SETFIELD ? 0 : op == OpCode::CALL ? 4 : 1, op == OpCode::CALL ? 1 : 2);
  writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
  image.constants = {std::string{"field"}};
  image.functions = {{.firstWord=0, .wordCount=2, .maxStack=5}};
  CpuMachine machine(image, scalar);
  auto& cpu = machine.cpu;
  auto* frame = cpu.activeThread()->frameAtDepth(0);
  auto r = frame->registers;
  const bool integer = op == OpCode::SETI;
  const Value key = integer ? valueInteger(1) : valueString(cpu.stringPool().intern("field"));
  auto prepare = [&](int capacity) {
   auto table = cpu.createTable(integer ? capacity : 0, integer ? 0 : capacity);
   if (op == OpCode::CALL) {
    r.set(0, cpu.createBuiltinFunction(BuiltinFunctionId::RawSet)); r.set(1, valueTable(table.address())); r.set(2, key); r.set(3, valueInteger(73));
   } else {
    r.set(0, valueTable(table.address())); r.set(1, key); r.set(2, valueInteger(73));
   }
   return table;
  };
  prepare(1); machine.warm(scalar);
  auto table = prepare(0); machine.restart();
  const int base = BASE_CYCLES[static_cast<u8>(op)] + (op == OpCode::CALL ? 1 : 0);
  if (cpu.runUntilDepth(0, base) != RunResult::Yielded || cpu.instructionBudgetRemaining != 0
   || frame->readControl(bmsx::FrameField::Pc) != machine.rom.textAddress + INSTRUCTION_BYTES || table.get(key) != valueInteger(73))
   throw std::runtime_error("every table-write route completes growth at its ordinary charge");
 }
}

void rebuildWork(bool scalar) {
 for (const std::string scenario : {"array-growth", "hash-to-array", "array-to-hash", "mixed", "same-capacity", "weak-collection", "failed-growth"}) {
  test::Blua32TestImage image;
  image.text.resize(33 * INSTRUCTION_BYTES);
  writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETT), 0, 1, 2);
  writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
  writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
  image.functions = {{.firstWord=0, .wordCount=2, .maxStack=5}, {.firstWord=32, .wordCount=1}};
  image.exceptionFunctionIndex = 1;
  CpuMachine machine(image, scalar);
  auto& cpu = machine.cpu;
  auto* frame = cpu.activeThread()->frameAtDepth(0);
  auto r = frame->registers;
  r.set(0, valueTable(cpu.createTable(0, 1).address())); r.set(1, valueString(cpu.stringPool().intern("warm"))); r.set(2, valueInteger(73));
  machine.warm(scalar);
  const Value field = valueString(cpu.stringPool().intern("field")), other = valueString(cpu.stringPool().intern("other"));
  const int array = scenario == "array-growth" ? 2 : scenario == "array-to-hash" ? 8 : scenario == "mixed" ? 4 : 0;
  const int hash = scenario == "hash-to-array" || scenario == "mixed" || scenario == "same-capacity" || scenario == "weak-collection" ? 2 : scenario == "failed-growth" ? 1024 : 0;
  auto table = cpu.createTable(array, hash);
  r.set(0, valueTable(table.address())); r.set(2, valueInteger(73)); frame->writeControl(bmsx::FrameField::Top, 5);
  size_t capacity = 0;
  if (scenario == "array-growth") {
   table.setInteger(1, valueInteger(11)); table.setInteger(2, valueInteger(22)); r.set(1, valueInteger(3));
   capacity = 4;
  } else if (scenario == "hash-to-array") {
   table.setInteger(1, valueInteger(11)); table.setInteger(3, valueInteger(33)); r.set(1, valueInteger(2));
   capacity = 4;
  } else if (scenario == "array-to-hash") {
   table.setInteger(8, valueInteger(88)); r.set(1, field);
   capacity = 2;
  } else if (scenario == "mixed") {
   table.setInteger(1, valueInteger(11)); table.setInteger(4, valueInteger(44)); table.set(field, valueInteger(55)); table.set(other, valueInteger(66));
   r.set(1, valueString(cpu.stringPool().intern("third"))); capacity = 5;
  } else if (scenario == "same-capacity") {
   table.set(field, valueInteger(55)); table.set(other, valueInteger(66)); table.set(other, valueNil());
   r.set(1, valueString(cpu.stringPool().intern("third"))); capacity = 2;
  } else if (scenario == "weak-collection") {
   auto mode = cpu.createTable(0, 1);
   mode.setStringKey(cpu.stringPool().intern("__mode"), valueString(cpu.stringPool().intern("v"))); table.setMetatableAddress(mode.address());
   table.set(field, valueTable(cpu.createTable().address())); table.set(other, valueTable(cpu.createTable().address()));
   r.set(1, valueString(cpu.stringPool().intern("third")));
   while (cpu.gcHeap().phase() != GcPhase::Atomic) cpu.stepHeap(valueNil(), valueNil(), valueNil());
   const auto bytes = cpu.luaHeap().usedBytes();
   cpu.luaHeap().setCollectionTarget(bytes);
   capacity = 4;
  } else {
   for (int i = 0; i < 1024; ++i) table.set(valueFloat(i + 0.5f), valueInteger(i));
   r.set(1, valueFloat(1024.5f));
   const int retainedSlots = static_cast<int>((cpu.luaHeap().capacity() - cpu.luaHeap().usedBytes() - 20 * HEAP_PAGE_SIZE) / 5);
   r.set(4, valueTable(cpu.createTable(retainedSlots).address()));
   cpu.collectHeap();
   cpu.luaHeap().setCollectionTarget(cpu.luaHeap().capacity());
   // No contiguous replacement backing even after collection.
   while (cpu.heapAllocator().allocate(HEAP_PAGE_SIZE, true) != 0) { /* fixture-owned RAM */ }
   capacity = 1024;
  }
  int gcCycles = 0;
  if (scenario == "weak-collection" || scenario == "failed-growth") {
   const auto before = cpu.captureRuntimeState();
   const auto ram = cpu.memory().captureSaveState();
   gcCycles = static_cast<int>(scenario == "weak-collection"
    ? cpu.stepHeap(valueNil(), valueNil(), valueNil()) : cpu.collectHeap());
   cpu.memory().restoreSaveState(ram);
   cpu.restoreRuntimeState(before);
   frame = cpu.rootThread()->currentFrame;
   r = frame->registers;
   table = asTable(r.get(0), cpu.gcHeap());
  }
  const Value key = r.get(1); machine.restart();
  if (cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::SETT)]) != RunResult::Yielded
   || cpu.instructionBudgetRemaining != -gcCycles || table.storedSlotCount() != capacity
   || frame->readControl(bmsx::FrameField::Pc) != machine.rom.textAddress + (scenario == "failed-growth" ? 0u : INSTRUCTION_BYTES))
   throw std::runtime_error("table rebuild only charges collection in addition to the opcode: " + scenario);
  if (scenario == "failed-growth") {
   if (cpu.readLuaFaultReasonWord() != LUA_FAULT_REASON_OUT_OF_MEMORY || !isNil(table.get(key)) || table.get(valueFloat(0.5f)) != valueInteger(0))
    throw std::runtime_error("failed replacement does not mutate mappings");
  } else {
   if (table.get(key) != valueInteger(73)) throw std::runtime_error("rebuild lost its inserted mapping");
   if (scenario == "weak-collection" && (!isNil(table.get(field)) || !isNil(table.get(other))))
    throw std::runtime_error("migration must not revive weak entries removed by collection");
  }
 }
}
void hostGrantScratch(bool scalar) {
 test::Blua32TestImage image;
 image.text.resize(INSTRUCTION_BYTES);
 writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETT), 0, 1, 2);
 image.functions = {{.firstWord=0, .wordCount=1, .maxStack=3}};
 CpuMachine machine(image, scalar);
 auto& cpu = machine.cpu;
 DeviceScheduler scheduler(cpu); scheduler.setNowCycles(73);
 auto* frame = cpu.activeThread()->frameAtDepth(0);
 auto table = cpu.createTable();
 const Value key = valueString(cpu.stringPool().intern("field"));
 frame->registers.set(0, valueTable(table.address())); frame->registers.set(1, key); frame->registers.set(2, valueInteger(91)); frame->writeControl(bmsx::FrameField::Top, 3);
 cpu.instructionBudgetRemaining = 29; table.set(key, valueInteger(37));
 if (cpu.instructionBudgetRemaining != 29 || scheduler.currentNowCycles() != 73)
  throw std::runtime_error("host storage work must not advance machine time");
 const auto saved = cpu.captureRuntimeState();
 cpu.instructionBudgetRemaining = -99;
 if (cpu.captureRuntimeState() != saved)
  throw std::runtime_error("grant scratch is not checkpoint state");
 cpu.restoreRuntimeState(saved);
 if (cpu.instructionBudgetRemaining != -99 || scheduler.currentNowCycles() != 73)
  throw std::runtime_error("restore does not price reconstructed storage");
 if (cpu.runUntilDepth(0, 1) != RunResult::Yielded || cpu.instructionBudgetRemaining != 1 - BASE_CYCLES[static_cast<u8>(OpCode::SETT)]
  || asTable(cpu.readFrameRegister(0, 0), cpu.gcHeap()).get(key) != valueInteger(91))
  throw std::runtime_error("the next execution owns a fresh grant");
}
} // namespace

int main() {
 for (const bool scalar : {false, true}) {
  {
   test::Blua32TestImage image;
   image.text.resize(3 * INSTRUCTION_BYTES);
   writeInstruction(image.text, 0, static_cast<u8>(OpCode::CALL), 0, 3, 0);
   writeInstruction(image.text, 1, static_cast<u8>(OpCode::K1), 7, 0, 0);
   writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
   image.functions = {{.firstWord=0, .wordCount=3, .maxStack=8}};
   for (const auto& primitive : LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
   const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
   Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
   IrqController irq(memory);
   ExecutionAddressSpace addresses(memory);
   CPU cpu(memory, irq, addresses);
   cpu.reset();
   if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
   cpu.installBootPrimitives();
   const Value next = cpu.getSystemGlobalByKey(cpu.stringPool().intern("__bmsx_next"));
   auto* frame = cpu.activeThread()->frameAtDepth(0);
   const int grant = BASE_CYCLES[static_cast<u8>(OpCode::CALL)] + 1;
   const auto runNext = [&](TableRecord table, Value after, std::initializer_list<Value> expected) {
    cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
    frame->registers.set(0, next);
    frame->registers.set(1, valueTable(table.address()));
    frame->registers.set(2, after);
    frame->registers.set(7, valueInteger(91));
    if (cpu.runUntilDepth(0, grant) != RunResult::Yielded
        || cpu.instructionBudgetRemaining != -static_cast<int>(expected.size()))
     throw std::runtime_error("NEXT charges only the primitive and result placement");
    if (static_cast<bmsx::i32>(frame->readControl(bmsx::FrameField::Top)) != static_cast<int>(expected.size()))
     throw std::runtime_error("NEXT success returns two values and exhaustion returns one nil");
    int index = 0;
    for (const auto value : expected) {
     if (frame->registers.get(index++) != value) throw std::runtime_error("NEXT result tuple changed at an exhausted grant");
    }
    if (frame->readControl(bmsx::FrameField::Pc) != rom.textAddress + INSTRUCTION_BYTES || frame->registers.get(7) != valueInteger(91))
     throw std::runtime_error("NEXT finishes the admitted primitive but stops before the next guest instruction");
   };
   auto warm = cpu.createTable();
   for (int repeat = 0; repeat < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++repeat)
    runNext(warm, valueNil(), {valueNil()});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
   if (!scalar) {
    test::waitForNativeEntry(cpu, *frame->decodedPage, (rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
    const auto& block = frame->decodedPage->nativeBlocks->entries[(rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
    if (!block || block->terminal.exit != NativeBlockExit::Call) throw std::runtime_error("NEXT call entry was not warmed");
   }
#endif
   for (const auto [array, hash] : {std::array{5, 0}, std::array{0, 3}, std::array{5, 3}}) {
    auto empty = cpu.createTable(array, hash);
    for (int repeat = 0; repeat < 3; ++repeat) runNext(empty, valueNil(), {valueNil()});
   }
   auto sparse = cpu.createTable(8, 0);
   sparse.setInteger(3, valueInteger(33));
   sparse.setInteger(7, valueInteger(77));
   runNext(sparse, valueNil(), {valueInteger(3), valueInteger(33)});
   runNext(sparse, valueInteger(3), {valueInteger(7), valueInteger(77)});
   runNext(sparse, valueInteger(7), {valueNil()});
   runNext(sparse, valueInteger(8), {valueNil()});
   runNext(sparse, valueInteger(2), {valueInteger(3), valueInteger(33)});

   auto hash = cpu.createTable(0, 8);
   for (int index = 0; index < 8; ++index)
    hash.setStringKey(cpu.stringPool().intern("next-" + std::to_string(index)), valueInteger(index + 10));
   std::array<Value, 8> keys{}, values{};
   for (size_t slot = 0; slot < keys.size(); ++slot) {
    if (!hash.loadStoredEntry(slot, keys[slot], values[slot])) throw std::runtime_error("NEXT fixture fills every reserved hash node");
   }
   for (size_t slot = 0; slot < keys.size(); ++slot) if (slot != 1 && slot != 4) hash.set(keys[slot], valueNil());
   runNext(hash, valueNil(), {keys[1], values[1]});
   runNext(hash, keys[1], {keys[4], values[4]});
   runNext(hash, keys[2], {keys[4], values[4]});
   runNext(hash, keys[4], {valueNil()});

   auto falseKey = cpu.createTable(0, 1);
   falseKey.set(valueBool(false), valueBool(false));
   runNext(falseKey, valueNil(), {valueBool(false), valueBool(false)});
   runNext(falseKey, valueBool(false), {valueNil()});
  }
  writeRoutes(scalar);
  rebuildWork(scalar);
  hostGrantScratch(scalar);
  for (const auto [array, hash, capacity] : {std::array{0, 0, 0}, std::array{1, 0, 0}, std::array{0, 1, 1}, std::array{7, 3, 4}, std::array{13, 5, 8}, std::array{0, 31, 32}, std::array{9, 33, 64}, std::array{63, 63, 64}}) {
   test::Blua32TestImage image;
   image.text.resize(2 * INSTRUCTION_BYTES);
   writeInstruction(image.text, 0, static_cast<u8>(OpCode::NEWT), 0, array, hash);
   writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
   image.functions = {{.firstWord=0, .wordCount=2, .maxStack=1}};
   const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
   Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
   IrqController irq(memory);
   ExecutionAddressSpace addresses(memory);
   CPU cpu(memory, irq, addresses);
   cpu.reset();
   if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
   cpu.runUntilDepth(0, 20000);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
   if (!scalar) {
    test::waitForNativeEntry(cpu, *cpu.activeThread()->frameAtDepth(0)->decodedPage, (rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
    const auto& block = cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[(rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
    if (!block || block->terminal.exit != NativeBlockExit::AllocateTable) throw std::runtime_error("allocation path was not warmed");
   }
#endif
   cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
   const int surcharge = array + 2 * hash;
   const int grant = BASE_CYCLES[static_cast<u8>(OpCode::NEWT)];
   if (cpu.runUntilDepth(0, grant) != RunResult::Yielded || cpu.instructionBudgetRemaining != -surcharge)
    throw std::runtime_error("NEWT must finish its admitted logical initialization charge");
   if (cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Pc) != rom.textAddress + INSTRUCTION_BYTES || !valueIsTable(cpu.readFrameRegister(0, 0)))
    throw std::runtime_error("exhausting initialization must stop before the next instruction");
   if (asTable(cpu.readFrameRegister(0, 0), cpu.gcHeap()).storedSlotCount() != static_cast<size_t>(array + capacity))
    throw std::runtime_error("NEWT retains the requested array and rounded hash capacity");
  }
  {
   test::Blua32TestImage image;
   image.text.resize(2 * INSTRUCTION_BYTES);
   writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETT), 0, 1, 2);
   writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
   image.functions = {{.firstWord=0, .wordCount=2, .maxStack=3}};
   const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
   Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
   IrqController irq(memory);
   ExecutionAddressSpace addresses(memory);
   CPU cpu(memory, irq, addresses);
   cpu.reset();
   if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
   std::array<StringId, 16> keys{};
   for (size_t i = 0; i < keys.size(); ++i) keys[i] = cpu.stringPool().intern("growth-" + std::to_string(i));
   auto* frame = cpu.activeThread()->frameAtDepth(0);
   frame->registers.set(0, valueTable(cpu.createTable(0, 16).address()));
   frame->registers.set(1, valueString(keys[0]));
   frame->registers.set(2, valueInteger(73));
   cpu.runUntilDepth(0, 10000);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
   if (!scalar) test::waitForNativeEntry(cpu, *frame->decodedPage, (rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
   if (!scalar && !frame->decodedPage->nativeBlocks->entries[(rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES])
    throw std::runtime_error("table store was not warmed in native code");
#endif
   for (const int initialCapacity : {0, 16}) {
    auto table = cpu.createTable(0, initialCapacity);
    frame->registers.set(0, valueTable(table.address()));
    size_t previousCapacity = table.storedSlotCount(), initializedSlots = 0;
    for (size_t i = 0; i < keys.size(); ++i) {
     frame->registers.set(1, valueString(keys[i]));
     cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
     size_t expectedCapacity = 1;
     while (expectedCapacity <= i) expectedCapacity *= 2;
     if (initialCapacity) expectedCapacity = static_cast<size_t>(initialCapacity);
     const int grant = BASE_CYCLES[static_cast<u8>(OpCode::SETT)] + 1;
     if (cpu.runUntilDepth(0, grant) != RunResult::Yielded
      || cpu.instructionBudgetRemaining != 1 - BASE_CYCLES[static_cast<u8>(OpCode::JMP)])
      throw std::runtime_error("growth and overwrite pay the same instruction charge");
     if (frame->readControl(bmsx::FrameField::Pc) != rom.textAddress)
      throw std::runtime_error("growth finishes atomically before the following instruction");
     if (table.getStringKey(keys[i]) != valueInteger(73)) throw std::runtime_error("table store lost a field");
     const size_t capacity = table.storedSlotCount();
     if (capacity != expectedCapacity) throw std::runtime_error("unexpected hash growth");
     if (capacity != previousCapacity) initializedSlots += 2 * capacity;
     previousCapacity = capacity;
    }
    if (initializedSlots != (initialCapacity == 0 ? 62u : 0u))
     throw std::runtime_error("every replacement initializes its entire key/value storage");
   }
  }
 }
}
