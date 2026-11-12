#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <stdexcept>
#include <string>

using namespace bmsx;

int main() {
 for (const bool scalar : {false, true}) {
  for (const auto [array, hash] : {std::array{0, 0}, std::array{1, 0}, std::array{0, 3}, std::array{8, 3}}) {
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
   cpu.runUntilDepth(0, 10000);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
   if (!scalar) {
    const auto& block = cpu.activeThread()->frameAtDepth(0)->decodedPage->nativeBlocks->entries[(rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
    if (!block || block->terminal.exit != NativeBlockExit::AllocateTable) throw std::runtime_error("allocation path was not warmed");
   }
#endif
   cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
   const int surcharge = array + 2 * static_cast<int>(Table::hashCapacity(hash));
   if (cpu.runUntilDepth(0, 1) != RunResult::Yielded || cpu.instructionBudgetRemaining != -surcharge)
    throw std::runtime_error("NEWT must finish its admitted logical initialization charge");
   if (cpu.activeThread()->frameAtDepth(0)->pc != rom.textAddress + INSTRUCTION_BYTES || !valueIsTable(cpu.readFrameRegister(0, 0)))
    throw std::runtime_error("exhausting initialization must stop before the next instruction");
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
     if (cpu.runUntilDepth(0, 3) != RunResult::Yielded || cpu.instructionBudgetRemaining != 0)
      throw std::runtime_error("table store plus jump must cost three cycles regardless of growth");
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
