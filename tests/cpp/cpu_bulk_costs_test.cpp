#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <array>
#include <initializer_list>
#include <stdexcept>
#include <string>

using namespace bmsx;

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
   const auto runNext = [&](Table* table, Value after, int slots, std::initializer_list<Value> expected) {
    cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
    frame->registers[0] = next;
    frame->registers[1] = valueTable(table);
    frame->registers[2] = after;
    frame->registers[7] = valueNumber(91);
    if (cpu.runUntilDepth(0, grant) != RunResult::Yielded
        || cpu.instructionBudgetRemaining != -slots - static_cast<int>(expected.size()))
     throw std::runtime_error("NEXT adds inspected Value slots to its existing primitive and result-placement costs");
    if (frame->top != static_cast<int>(expected.size()))
     throw std::runtime_error("NEXT success returns two values and exhaustion returns one nil");
    int index = 0;
    for (const auto value : expected) {
     if (frame->registers[index++] != value) throw std::runtime_error("NEXT result tuple changed at an exhausted grant");
    }
    if (frame->pc != rom.textAddress + INSTRUCTION_BYTES || frame->registers[7] != valueNumber(91))
     throw std::runtime_error("NEXT finishes the admitted primitive but stops before the next guest instruction");
   };
   auto* warm = cpu.createTable();
   for (int repeat = 0; repeat < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++repeat)
    runNext(warm, valueNil(), 0, {valueNil()});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
   if (!scalar) {
    test::waitForNativeEntry(cpu, *frame->decodedPage, (rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
    const auto& block = frame->decodedPage->nativeBlocks->entries[(rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
    if (!block || block->terminal.exit != NativeBlockExit::Call) throw std::runtime_error("NEXT call entry was not warmed");
   }
#endif
   for (const auto [array, hash, slots] : {std::array{5, 0, 5}, std::array{0, 3, 8}, std::array{5, 3, 13}}) {
    auto* empty = cpu.createTable(array, hash);
    for (int repeat = 0; repeat < 3; ++repeat) runNext(empty, valueNil(), slots, {valueNil()});
   }
   auto* sparse = cpu.createTable(8, 0);
   sparse->setInteger(3, valueNumber(33));
   sparse->setInteger(7, valueNumber(77));
   runNext(sparse, valueNil(), 3, {valueNumber(3), valueNumber(33)});
   runNext(sparse, valueNumber(3), 4, {valueNumber(7), valueNumber(77)});
   runNext(sparse, valueNumber(7), 1, {valueNil()});
   runNext(sparse, valueNumber(8), 0, {valueNil()});
   runNext(sparse, valueNumber(2), 1, {valueNumber(3), valueNumber(33)});

   auto* hash = cpu.createTable(0, 8);
   for (int index = 0; index < 8; ++index)
    hash->setStringKey(cpu.stringPool().intern("next-" + std::to_string(index)), valueNumber(index + 10));
   std::array<Value, 8> keys{}, values{};
   for (size_t slot = 0; slot < keys.size(); ++slot) {
    if (!hash->loadStoredEntry(slot, keys[slot], values[slot])) throw std::runtime_error("NEXT fixture fills every reserved hash node");
   }
   for (size_t slot = 0; slot < keys.size(); ++slot) if (slot != 1 && slot != 4) hash->set(keys[slot], valueNil());
   runNext(hash, valueNil(), 4, {keys[1], values[1]});
   runNext(hash, keys[1], 6, {keys[4], values[4]});
   runNext(hash, keys[2], 4, {keys[4], values[4]});
   runNext(hash, keys[4], 6, {valueNil()});

   auto* falseKey = cpu.createTable(0, 1);
   falseKey->set(valueBool(false), valueBool(false));
   runNext(falseKey, valueNil(), 2, {valueBool(false), valueBool(false)});
   runNext(falseKey, valueBool(false), 0, {valueNil()});
  }
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
   const int surcharge = array + 2 * capacity;
   const int grant = BASE_CYCLES[static_cast<u8>(OpCode::NEWT)];
   if (cpu.runUntilDepth(0, grant) != RunResult::Yielded || cpu.instructionBudgetRemaining != -surcharge)
    throw std::runtime_error("NEWT must finish its admitted logical initialization charge");
   if (cpu.activeThread()->frameAtDepth(0)->pc != rom.textAddress + INSTRUCTION_BYTES || !valueIsTable(cpu.readFrameRegister(0, 0)))
    throw std::runtime_error("exhausting initialization must stop before the next instruction");
   if (asTable(cpu.readFrameRegister(0, 0))->storedSlotCount() != static_cast<size_t>(array + capacity))
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
   frame->registers[0] = valueTable(cpu.createTable(0, 16));
   frame->registers[1] = valueString(keys[0]);
   frame->registers[2] = valueNumber(73);
   cpu.runUntilDepth(0, 10000);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
   if (!scalar) test::waitForNativeEntry(cpu, *frame->decodedPage, (rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
   if (!scalar && !frame->decodedPage->nativeBlocks->entries[(rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES])
    throw std::runtime_error("table store was not warmed in native code");
#endif
   for (const int initialCapacity : {0, 16}) {
    auto* table = cpu.createTable(0, initialCapacity);
    frame->registers[0] = valueTable(table);
    size_t previousCapacity = table->storedSlotCount(), initializedSlots = 0;
    for (size_t i = 0; i < keys.size(); ++i) {
     frame->registers[1] = valueString(keys[i]);
     cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
     const int charge = BASE_CYCLES[static_cast<u8>(OpCode::SETT)] + BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
     if (cpu.runUntilDepth(0, charge) != RunResult::Yielded || cpu.instructionBudgetRemaining != 0)
      throw std::runtime_error("table store plus jump keeps its base costs regardless of growth");
     if (table->getStringKey(keys[i]) != valueNumber(73)) throw std::runtime_error("table store lost a field");
     const size_t capacity = table->storedSlotCount();
     size_t expectedCapacity = 1;
     while (expectedCapacity <= i) expectedCapacity *= 2;
     if (capacity != (initialCapacity ? 16u : expectedCapacity)) throw std::runtime_error("unexpected hash growth");
     if (capacity != previousCapacity) initializedSlots += 2 * capacity;
     previousCapacity = capacity;
    }
    if (initializedSlots != (initialCapacity == 0 ? 62u : 0u))
     throw std::runtime_error("growth initializes slots without an instruction surcharge");
   }
  }
 }
}
