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
#include "support/managed_fixture.h"
#include "support/table_allocation_reference.h"

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
  test::seedManagedFixture(cpu, addresses);
  if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
 }

};

void hostGrantScratch(bool scalar) {
 test::Blua32TestImage image;
 image.text.resize(INSTRUCTION_BYTES);
 writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETT), 0, 1, 2);
 image.functions = {{.firstWord=0, .wordCount=1, .maxStack=3}};
 CpuMachine machine(image, scalar);
 auto& cpu = machine.cpu;
 DeviceScheduler scheduler(cpu); scheduler.setNowCycles(73);
 auto* frame = cpu.activeThread()->frameAtDepth(0);
 auto table = bmsx::test::allocateTableReference(cpu);
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
   const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
   Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
   IrqController irq(memory);
   ExecutionAddressSpace addresses(memory);
   CPU cpu(memory, irq, addresses);
   test::seedManagedFixture(cpu, addresses);
   if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
   const Value next = valueBuiltinFunction(BuiltinFunctionId::Next);
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
   auto warm = bmsx::test::allocateTableReference(cpu);
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
    auto empty = bmsx::test::allocateTableReference(cpu, array, hash);
    for (int repeat = 0; repeat < 3; ++repeat) runNext(empty, valueNil(), {valueNil()});
   }
   auto sparse = bmsx::test::allocateTableReference(cpu, 8, 0);
   sparse.setInteger(3, valueInteger(33));
   sparse.setInteger(7, valueInteger(77));
   runNext(sparse, valueNil(), {valueInteger(3), valueInteger(33)});
   runNext(sparse, valueInteger(3), {valueInteger(7), valueInteger(77)});
   runNext(sparse, valueInteger(7), {valueNil()});
   runNext(sparse, valueInteger(8), {valueNil()});
   runNext(sparse, valueInteger(2), {valueInteger(3), valueInteger(33)});

   auto hash = bmsx::test::allocateTableReference(cpu, 0, 8);
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

   auto falseKey = bmsx::test::allocateTableReference(cpu, 0, 1);
   falseKey.set(valueBool(false), valueBool(false));
   runNext(falseKey, valueNil(), {valueBool(false), valueBool(false)});
   runNext(falseKey, valueBool(false), {valueNil()});
  }
  hostGrantScratch(scalar);
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
   test::seedManagedFixture(cpu, addresses);
   if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
   std::array<StringId, 16> keys{};
   for (size_t i = 0; i < keys.size(); ++i) keys[i] = cpu.stringPool().intern("growth-" + std::to_string(i));
   auto* frame = cpu.activeThread()->frameAtDepth(0);
   frame->registers.set(0, valueTable(bmsx::test::allocateTableReference(cpu, 0, 16).address()));
   frame->registers.set(1, valueString(keys[0]));
   frame->registers.set(2, valueInteger(73));
   cpu.runUntilDepth(0, 10000);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
   if (!scalar) test::waitForNativeEntry(cpu, *frame->decodedPage, (rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
   if (!scalar && !frame->decodedPage->nativeBlocks->entries[(rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES])
    throw std::runtime_error("table store was not warmed in native code");
#endif
   auto table = bmsx::test::allocateTableReference(cpu, 0, 16);
   frame->registers.set(0, valueTable(table.address()));
   for (const StringId key : keys) {
    frame->registers.set(1, valueString(key));
    cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
    const int grant = BASE_CYCLES[static_cast<u8>(OpCode::SETT)] + 1;
    if (cpu.runUntilDepth(0, grant) != RunResult::Yielded
     || cpu.instructionBudgetRemaining != 1 - BASE_CYCLES[static_cast<u8>(OpCode::JMP)])
     throw std::runtime_error("an insertion into reserved storage pays only the instruction charge");
    if (frame->readControl(bmsx::FrameField::Pc) != rom.textAddress || table.getStringKey(key) != valueInteger(73))
     throw std::runtime_error("the fixed-capacity store retires before the following instruction");
    if (table.storedSlotCount() != keys.size()) throw std::runtime_error("a fitting write does not change hash capacity");
   }
  }
 }
}
