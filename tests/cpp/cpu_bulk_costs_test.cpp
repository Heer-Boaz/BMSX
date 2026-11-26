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
  auto prepare = [&](int array, int hash) {
   auto table = cpu.createTable(array, hash);
   if (op == OpCode::CALL) {
    r.set(0, cpu.createBuiltinFunction(BuiltinFunctionId::RawSet)); r.set(1, valueTable(table.address())); r.set(2, key); r.set(3, valueInteger(73));
   } else {
    r.set(0, valueTable(table.address())); r.set(1, key); r.set(2, valueInteger(73));
   }
   return table;
  };
  prepare(integer ? 1 : 0, integer ? 0 : 1); machine.warm(scalar);
  auto table = prepare(0, 0); machine.restart();
  const int base = BASE_CYCLES[static_cast<u8>(op)] + (op == OpCode::CALL ? 1 : 0);
  if (cpu.runUntilDepth(0, base) != RunResult::Yielded || cpu.instructionBudgetRemaining != 0
   || frame->readControl(bmsx::FrameField::Pc) != machine.rom.textAddress + INSTRUCTION_BYTES || table.get(key) != valueInteger(73))
   throw std::runtime_error("every table-write route completes growth at its ordinary charge");
  for (const int hash : {64, 128, 512, 1024}) for (auto kind : {CpuRunKind::Direct, CpuRunKind::Scheduled}) {
   auto full = prepare(integer ? 0 : 512, hash);
   for (int i = 1; i <= hash; ++i) full.setInteger(-i, valueInteger(i));
   for (const bool overwrite : {false, true}) {
    machine.restart();
    if (cpu.runUntilDepth(0, base, 0u, kind) != RunResult::Yielded
     || cpu.instructionBudgetRemaining != (integer && !overwrite && hash < 1024 ? -(hash - 64) / 2 : 0)
     || frame->readControl(FrameField::Pc) != machine.rom.textAddress + INSTRUCTION_BYTES)
     throw std::runtime_error("only an unindexed hash scans its bounded slots");
    if (!integer && !overwrite && hash > 64) {
     if (cpu.tableRebuild.record != full.address() || !isNil(full.get(key))) throw std::runtime_error("store must be pending");
     for (int steps = 0; cpu.tableRebuild.record; ++steps) {
      if (steps >= 5 * hash || cpu.runUntilDepth(0, 8, 0u, kind) != RunResult::Yielded
       || frame->readControl(FrameField::Pc) != machine.rom.textAddress + INSTRUCTION_BYTES)
       throw std::runtime_error("short grant must advance the store before the next opcode");
     }
     for (int i = 1; i <= hash; ++i) if (full.getInteger(-i) != valueInteger(i)) throw std::runtime_error("lost hash entry");
    }
    if (full.get(key) != valueInteger(73)) throw std::runtime_error("lost triggering assignment");
   }
  }
 }
}

void replayInFlightHash(bool scalar) {
 test::Blua32TestImage image;
 image.text.resize(2 * INSTRUCTION_BYTES);
 writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETFIELD), 0, 0, 1);
 writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
 image.constants = {std::string{"new"}};
 image.functions = {{.firstWord=0, .wordCount=2, .maxStack=2}};
 CpuMachine m(image, scalar);
 auto& cpu = m.cpu;
 auto table = cpu.createTable(0, 512);
 for (int i = 1; i <= 512; ++i) table.setInteger(i <= 256 ? i : -i, valueInteger(i));
 auto r = cpu.activeThread()->currentFrame->registers;
 r.set(0, valueTable(table.address())); r.set(1, valueInteger(73));
 const auto field = valueString(cpu.stringPool().intern("new"));
 const auto grant = [&] { return cpu.runUntilDepth(0, 8, 0, CpuRunKind::Scheduled); };
 cpu.runUntilDepth(0, 16, 0, CpuRunKind::Scheduled);
 for (int i = 0; !cpu.tableRebuild.cursor; ++i) {
  if (i >= 1024 || grant() != RunResult::Yielded) throw std::runtime_error("never entered collision placement");
 }
 cpu.requestNonMaskableInterrupt();
 if (cpu.enterPendingInterrupt()) throw std::runtime_error("NMI split the store before publication");
 cpu.cancelNonMaskableInterrupt();
 const auto anchor = cpu.captureRuntimeState();
 const auto ram = m.memory.captureSaveState();
 if (!anchor.rebuild.collisions || !isNil(table.get(field)) || table.hashSlots() != 512)
  throw std::runtime_error("the old mapping must remain published");
 const auto finish = [&] {
  int n = 0;
  while (cpu.tableRebuild.record) if (++n > 1024 || grant() != RunResult::Yielded)
   throw std::runtime_error("rebuild did not retire in bounded grants");
  if (table.get(field) != valueInteger(73) || grant() != RunResult::Halted)
   throw std::runtime_error("HALT must follow publication");
  return n;
 };
 const int n = finish();
 const auto expected = m.memory.captureSaveState();
 m.memory.restoreSaveState(ram);
 cpu.restoreRuntimeState(anchor);
 if (finish() != n || m.memory.captureSaveState().ram != expected.ram)
  throw std::runtime_error("collision replay must reproduce the remaining grants and identical RAM");
 // Cross the census threshold by copying a hash with no stored range counts.
 for (int i = 513; i <= 1023; ++i) table.setInteger(-i, valueInteger(i));
 table.setInteger(257, valueInteger(71));
 if (table.arrayCapacity() != 512 || table.hashSlots() != 1024 || table.getInteger(257) != valueInteger(71))
  throw std::runtime_error("replayed placement did not build the new hash integer census");
}

void publishInPlaceArray(bool scalar) {
 test::Blua32TestImage image;
 image.text.resize(2 * INSTRUCTION_BYTES);
 writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETT), 0, 1, 2);
 writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
 image.functions = {{.firstWord=0, .wordCount=2, .maxStack=3}};
 image.systemGlobalNames = {"growing"};
 CpuMachine machine(image, scalar);
 auto& cpu = machine.cpu;
 constexpr int old = 2047;
 const auto root = cpu.stringPool().intern("growing");
 auto& arena = cpu.heapAllocator();
 arena.free(arena.allocate(12*old, true));
 auto table = cpu.createTable(old, 0);
 const u32 original = table.arrayAddress();
 cpu.setSystemGlobalByKey(root, valueTable(table.address()));
 const auto value = [](int i) { return i%3 ? valueInteger(-i) : valueBool(false); };
 for (int i=1; i<=old; ++i) table.setInteger(i, value(i));
 auto r = cpu.activeThread()->currentFrame->registers;
 r.set(0, valueTable(table.address())); r.set(1, valueInteger(old+1)); r.set(2, valueInteger(73));
 const auto grant = [&](int cycles) { cpu.runUntilDepth(0, cycles, 0, CpuRunKind::Scheduled); };
 grant(16); grant(1);
 if (cpu.tableRebuild.density.cursor != 68 || cpu.tableRebuild.arrayStorage || cpu.instructionBudgetRemaining != 0)
  throw std::runtime_error("first sixty-four tags included; one cycle scans four more before reservation");
 const auto censusState = cpu.captureRuntimeState();
 const auto censusRam = machine.memory.captureSaveState();
 grant(495);
 if (cpu.tableRebuild.arrayStorage != original || cpu.tableRebuild.arrayCleared || cpu.instructionBudgetRemaining != 0)
  throw std::runtime_error("finishing the partial band must not borrow transfer cycles");
 machine.memory.restoreSaveState(censusRam); cpu.restoreRuntimeState(censusState); grant(496);
 if (cpu.tableRebuild.arrayStorage != original || cpu.tableRebuild.arrayCleared != 16)
  throw std::runtime_error("in-place grant did not move sixteen tags");
 const auto state = cpu.captureRuntimeState();
 const auto ram = machine.memory.captureSaveState();
 const auto check = [&] {
  if (table.arrayAddress() != original || table.arrayCapacity() != old+1 || table.getInteger(old+1) != valueInteger(73))
   throw std::runtime_error("in-place growth did not retire at its original address");
  for (int i=1; i<=old; ++i) if (table.getInteger(i) != value(i)) throw std::runtime_error("overlapping transfer corrupted slot");
 };
 grant(127);
 if (cpu.tableRebuild.record != table.address()) throw std::runtime_error("early retirement");
 grant(1); check();
 const auto end = machine.memory.captureSaveState();
 machine.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state); grant(128); check();
 if (machine.memory.captureSaveState().ram != end.ram) throw std::runtime_error("in-place transfer replay changed RAM");
 machine.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state); cpu.reset(); check();
}

void publishDisplacedArray(bool scalar, bool keepHash) {
 test::Blua32TestImage image;
 image.text.resize(2 * INSTRUCTION_BYTES);
 writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETT), 0, 1, 2);
 writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
 image.functions = {{.firstWord=0, .wordCount=2, .maxStack=3}};
 CpuMachine machine(image, scalar);
 auto& cpu = machine.cpu;
 auto table = cpu.createTable(1024, 2);
 const u32 original = table.arrayAddress(), originalHash = table.hashAddress();
 for (int i=1; i<=1024; ++i) if (i != 77) table.setInteger(i, valueInteger(-i));
 if (keepHash) table.setInteger(77, valueInteger(0));
 table.setInteger(-1, valueInteger(71)); table.setInteger(keepHash ? -2 : 1026, valueInteger(72));
 auto r = cpu.activeThread()->currentFrame->registers;
 r.set(0, valueTable(table.address())); r.set(1, valueInteger(1025)); r.set(2, valueInteger(73));
 const auto grant = [&](int cycles) { cpu.runUntilDepth(0, cycles, 0, CpuRunKind::Scheduled); };
 grant(16); grant(240);
 if (cpu.tableRebuild.record != table.address() || !cpu.tableRebuild.arrayStorage || cpu.tableRebuild.arrayStorage == original)
  throw std::runtime_error("expected a detached replacement");
 for (int i=0; cpu.tableRebuild.arrayCleared <= 8192; ++i) {
  if (i >= 100) throw std::runtime_error("never entered retained tag transfer");
  grant(37);
 }
 if (table.arrayAddress() != original || !isNil(table.getInteger(1025))) throw std::runtime_error("early publication");
 const auto state = cpu.captureRuntimeState();
 const auto ram = machine.memory.captureSaveState();
 const auto finish = [&] {
  int n=0;
  while (cpu.tableRebuild.record) {
   if (++n >= 100) throw std::runtime_error("array transfer did not retire");
   grant(37);
  }
  if (table.arrayCapacity() != 2048 || (table.hashAddress() == originalHash) != keepHash
   || table.getInteger(1025) != valueInteger(73) || table.getInteger(keepHash ? -2 : 1026) != valueInteger(72)
   || table.getInteger(-1) != valueInteger(71) || !isNil(table.getInteger(2048)))
   throw std::runtime_error("wrong replacement partition");
  for (int i=1; i<=1024; ++i) if (table.getInteger(i) != (i != 77 ? valueInteger(-i) : keepHash ? valueInteger(0) : valueNil()))
   throw std::runtime_error("retained array slot changed");
  return n;
 };
 const int n = finish();
 const auto end = machine.memory.captureSaveState();
 machine.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
 if (finish() != n || machine.memory.captureSaveState().ram != end.ram)
  throw std::runtime_error("partial tag transfer replay changed retirement");
}

void publishFirstArray(bool scalar, int dense) {
 test::Blua32TestImage image;
 image.text.resize(2 * INSTRUCTION_BYTES);
 writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETT), 0, 1, 2);
 writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
 image.functions = {{.firstWord=0, .wordCount=2, .maxStack=3}};
 CpuMachine machine(image, scalar);
 auto& cpu = machine.cpu;
 auto table = cpu.createTable(0, 1024);
 for (int i=1; i<=1024; ++i) table.setInteger(i <= dense ? i : -i, valueInteger(i));
 auto r = cpu.activeThread()->currentFrame->registers;
 r.set(0, valueTable(table.address())); r.set(1, valueInteger(dense+1)); r.set(2, valueInteger(73));
 const auto grant = [&](int cycles) { cpu.runUntilDepth(0, cycles, 0, CpuRunKind::Scheduled); };
 grant(16);
 if (cpu.instructionBudgetRemaining != 0) throw std::runtime_error("integer census overran the issuing grant");
 grant(8);
 if (cpu.tableRebuild.arrayCleared != 128 || table.arrayCapacity() || !isNil(table.getInteger(dense+1)))
  throw std::runtime_error("only the detached array can change before retirement");
 const auto state = cpu.captureRuntimeState();
 const auto ram = machine.memory.captureSaveState();
 const auto finish = [&] {
  int n=0;
  while (cpu.tableRebuild.record) {
   if (++n >= 4096) throw std::runtime_error("integer migration failed to retire");
   grant(16);
  }
  if (table.arrayCapacity() != dense*2 || table.hashSlots() != 1024-dense || table.getInteger(dense+1) != valueInteger(73))
   throw std::runtime_error("wrong partition after integer store");
  for (int i=1; i<=1024; ++i) if (table.getInteger(i <= dense ? i : -i) != valueInteger(i))
   throw std::runtime_error("integer migration lost an entry");
  return n;
 };
 const int n = finish();
 const auto end = machine.memory.captureSaveState();
 machine.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
 if (finish() != n || machine.memory.captureSaveState().ram != end.ram)
  throw std::runtime_error("first-array restore changed retirement");
}

void publishRawStoreBeforeReturning(bool protectedCall, bool census) {
 test::Blua32TestImage image;
 image.text.resize(2 * INSTRUCTION_BYTES);
 writeInstruction(image.text, 0, static_cast<u8>(OpCode::CALL), 0, protectedCall ? 5 : 4, 17);
 writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
 image.functions = {{.firstWord=0, .wordCount=2, .maxStack=5}};
 CpuMachine m(image, true);
 auto& cpu = m.cpu;
 auto table = cpu.createTable(census ? 2048 : 0, census ? 0 : 256);
 const auto key = census ? valueInteger(2049) : valueString(cpu.stringPool().intern("new"));
 for (int i = 1; i <= (census ? 2048 : 256); ++i) table.setInteger(census ? i : -i, valueInteger(i));
 auto* frame = cpu.activeThread()->currentFrame;
 const int a = protectedCall ? 1 : 0;
 if (protectedCall) frame->registers.set(0, valueBuiltinFunction(BuiltinFunctionId::PCall));
 frame->registers.set(a, valueBuiltinFunction(BuiltinFunctionId::RawSet));
 frame->registers.set(a+1, valueTable(table.address()));
 frame->registers.set(a+2, key); frame->registers.set(a+3, valueInteger(9));
 cpu.runUntilDepth(0, 40, 0, CpuRunKind::Scheduled);
 if (!valueIsBuiltinFunction(frame->registers.get(0)) || !cpu.tableRebuild.record || !isNil(table.get(key)))
  throw std::runtime_error("rawset must not publish results before the mapping");
 const auto anchor = cpu.captureRuntimeState();
 const auto ram = m.memory.captureSaveState();
 for (bool restored : {false, true}) {
  if (restored) { m.memory.restoreSaveState(ram); cpu.restoreRuntimeState(anchor); frame = cpu.activeThread()->currentFrame; }
  for (int n=0; cpu.tableRebuild.record; ++n) {
   if (n>1024 || cpu.runUntilDepth(0,8,0,CpuRunKind::Scheduled) != RunResult::Yielded) throw std::runtime_error("unexpected rawset grant");
  }
  if (table.get(key) != valueInteger(9) || frame->registers.get(a) != valueTable(table.address())
   || (protectedCall && frame->registers.get(0) != valueBool(true)) || !isNil(frame->registers.get(15)))
   throw std::runtime_error("rawset must finish its saved return placement");
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
   table.setInteger(8, valueInteger(88)); r.set(1, valueInteger(9));
   capacity = 2;
  } else if (scenario == "mixed") {
   table.setInteger(1, valueInteger(11)); table.setInteger(4, valueInteger(44)); table.set(field, valueInteger(55)); table.set(other, valueInteger(66));
   r.set(1, valueInteger(9)); capacity = 5;
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
   while (cpu.heapAllocator().allocate(4088u, true) != 0) { /* fixture-owned RAM */ }
   capacity = 1024;
  }
  const Value key = r.get(1); machine.restart();
  const auto result = cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::SETT)]);
  const int recoveryCost = scenario == "failed-growth" ? GC_WORK_WORD_CYCLES * static_cast<int>(
   machine.memory.readRamRecordWord(cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET + GC_LAST_EPOCH_WORK)) : 0;
  if (result != RunResult::Yielded || cpu.instructionBudgetRemaining != -recoveryCost || table.storedSlotCount() != capacity
   || frame->readControl(bmsx::FrameField::Pc) != machine.rom.textAddress + (scenario == "failed-growth" ? 0u : INSTRUCTION_BYTES))
   throw std::runtime_error("table rebuild charges completed scans and emergency collection: " + scenario);
  if (scenario == "failed-growth") {
   if (cpu.readLuaFaultReasonWord() != LUA_FAULT_REASON_OUT_OF_MEMORY || !isNil(table.get(key)) || table.get(valueFloat(0.5f)) != valueInteger(0))
    throw std::runtime_error("failed replacement does not mutate mappings");
  } else {
   if (table.get(key) != valueInteger(73)) throw std::runtime_error("rebuild lost its inserted mapping");
   if (scenario == "weak-collection") {
    if (!cpu.gcHeap().finalMarkPending() || isNil(table.get(field)) || isNil(table.get(other)))
     throw std::runtime_error("rebuild does not enter a pending final collection inside the store");
    cpu.gcHeap().finishFinalMark();
    if (cpu.instructionBudgetRemaining != 0 || !isNil(table.get(field)) || !isNil(table.get(other)) || table.get(key) != valueInteger(73))
     throw std::runtime_error("final collection sees the migrated weak entries and charges no guest grant");
   }
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
  if (scalar) for (bool census : {false, true}) { publishRawStoreBeforeReturning(false, census); publishRawStoreBeforeReturning(true, census); }
  writeRoutes(scalar);
  replayInFlightHash(scalar);
  publishInPlaceArray(scalar); publishDisplacedArray(scalar, true); publishDisplacedArray(scalar, false);
  publishFirstArray(scalar, 512); publishFirstArray(scalar, 1024);
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
   const int grant = BASE_CYCLES[static_cast<u8>(OpCode::NEWT)];
   if (cpu.runUntilDepth(0, grant) != RunResult::Yielded || cpu.instructionBudgetRemaining != 0)
    throw std::runtime_error("NEWT must charge its fixed cost independently of the reservation");
   if (cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Pc) != rom.textAddress + INSTRUCTION_BYTES || !valueIsTable(cpu.readFrameRegister(0, 0)))
    throw std::runtime_error("an exact grant must stop after creating the table and before the next instruction");
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
