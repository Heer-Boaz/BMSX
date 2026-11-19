#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void slidingFixedCall(bool interpreted) {
	test::Blua32TestImage image;
	image.text.resize(10 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::LOADK), 5, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::CALL), 4, 2, 3);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::MOV), 2, 0, 0);
	writeInstruction(image.text, 9, static_cast<u8>(OpCode::RET), 0, 3, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 128},
		{.firstWord = 8, .wordCount = 2, .numParams = 2, .maxStack = 8}};
	image.constants = {37};
	image.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	cpu.reset();
	if (interpreted) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	cpu.runUntilDepth(0, 20000);
	cpu.runUntilDepth(1, 100);
	auto* thread = cpu.activeThread();
	auto* parent = thread->currentFrame;
	require(thread->frameDepth == 1, "warm execution returns to the original frame");
	require(thread->stackCapacity == 128, "fixed calls share the allocation rather than appending maxStack windows");
	require(parent->registers.get(0) == valueInteger(1), "the lower caller prefix survives calls");
	require(parent->next && parent->next->stackBase == parent->stackBase + 5, "callee parameters alias the supplied argument slots");
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress + INSTRUCTION_BYTES);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)]
		+ BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)]);
	require(thread->frameDepth == 2, "exhausted CALL grant leaves the callee before its first instruction");
	auto* child = thread->currentFrame;
	require(child->registers.words() == parent->registers.words() + 5 && child->registers.tags() == parent->registers.tags() + 5, "callee borrows both planes at the same argument offset");
	require(child->registers.get(0) == valueInteger(37) && child->registers.get(1) == valueNil(), "arguments stay in place and missing formals become nil");
	require(thread->stackTop == 13, "active stack extent excludes dead caller scratch");
	child->registers.set(0, valueInteger(41));
	require(parent->registers.get(5) == valueInteger(41), "both register views name the same storage");
	cpu.collectHeap();
	const auto snapshot = cpu.captureRuntimeState();
	require(snapshot.threads[0].stackTop == 13, "snapshot records shared storage once");
	cpu.restoreRuntimeState(snapshot);
	thread = cpu.activeThread();
	require(thread->currentFrame->registers.words() == thread->firstFrame->registers.words() + 5
		&& thread->currentFrame->registers.tags() == thread->firstFrame->registers.tags() + 5, "restoring frame offsets restores sharing");
	cpu.runUntilDepth(1, 100);
	parent = thread->currentFrame;
	require(parent->registers.get(4) == valueInteger(41) && parent->registers.get(5) == valueNil(), "overlapping return copies retain values and padding");
	require(thread->stackTop == 128, "retirement restores the caller reservation without shifting any frame");
}
void slidingVarargCall(bool interpreted, bool open) {
	test::Blua32TestImage image;
	image.text.resize(19 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::LOADK), 5, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::LOADK), 6, 0, 1);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::LOADK), 7, 0, 2);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::CALL), 4, 4, open ? 0 : 4);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 17, static_cast<u8>(OpCode::VARARG), 1, open ? 0 : 3, 0);
	writeInstruction(image.text, 18, static_cast<u8>(OpCode::RET), 0, open ? 0 : 4, 0);
	image.functions = {{.firstWord = 0, .wordCount = 8, .maxStack = 128},
		{.firstWord = 16, .wordCount = 3, .numParams = 1, .maxStack = 8, .isVararg = true}};
	image.constants = {37, false, Blua32FloatConstant{0x80000000u}};
	image.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	cpu.reset();
	if (interpreted) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	cpu.runUntilDepth(0, 20000);
	cpu.runUntilDepth(1, 100);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress + INSTRUCTION_BYTES);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)]
		+ 3 * BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)]);
	auto* thread = cpu.activeThread();
	require(thread->frameDepth == 2, "vararg CALL enters before executing the body");
	auto* child = thread->currentFrame;
	require(child->stackBase == 8 && static_cast<bmsx::i32>(child->readControl(bmsx::FrameField::VarargBase)) == 6 && static_cast<bmsx::i32>(child->readControl(bmsx::FrameField::VarargCount)) == 2, "vararg working registers slide above original arguments");
	require(child->registers.get(0) == valueInteger(37) && thread->stack.get(5) == valueNil(), "fixed parameters move, original copies no longer retain roots");
	cpu.collectHeap();
	const auto snapshot = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(snapshot);
	cpu.runUntilDepth(1, 100);
	auto* parent = cpu.activeThread()->currentFrame;
	require(static_cast<bmsx::i32>(parent->readControl(bmsx::FrameField::Top)) == 7 && parent->registers.get(4) == valueInteger(1)
		&& parent->registers.get(5) == valueBool(false) && parent->registers.get(6) == valueFloatBits(0x80000000u),
		"fixed and open VARARG/RET retain false and signed zero after parameter mutation and replay");
}

void formalReservationRoots(bool interpreted) {
	test::Blua32TestImage image;
	image.text.resize(5 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 4, 8, 8);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::RET), 4, 8, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 8, 0);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 16},
		{.firstWord = 4, .wordCount = 1, .numParams = 7, .maxStack = 2}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses); cpu.reset();
	if (interpreted) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	auto* parent = cpu.activeThread()->currentFrame;
	for (int index = 0; index < 6; ++index) parent->registers.set(5 + index, valueInteger(index));
	auto* table = cpu.createTable(1, 0); table->setInteger(1, valueInteger(73));
	parent->registers.set(11, valueTable(cpu.gcHeap().reference(table))); parent->writeControl(bmsx::FrameField::Top, 12);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)]);
	auto* child = cpu.activeThread()->currentFrame;
	require(cpu.getFrameDepth() == 2 && child->stackCapacity == 7 && static_cast<bmsx::i32>(child->readControl(bmsx::FrameField::Top)) == 7,
		"the formal count owns every argument even when maxStack is smaller");
	cpu.collectHeap();
	const auto snapshot = cpu.captureRuntimeState();
	require(snapshot.threads[0].stackTop == 12, "snapshot includes the complete formal reservation once");
	cpu.restoreRuntimeState(snapshot);
	child = cpu.activeThread()->currentFrame;
	require(asTable(child->registers.get(6), cpu.gcHeap())->getInteger(1) == valueInteger(73),
		"the last formal remains rooted through forced collection and restore");
	cpu.runUntilDepth(0, 100);
	const auto values = cpu.readCompletionValues();
	require(values.size() == 7 && asTable(values.get(6), cpu.gcHeap())->getInteger(1) == valueInteger(73),
		"all formal results survive overlapping return transfer");
}

void capturedSlotSurvivesOpenTop(int top) {
	test::Blua32TestImage image;
	image.text.resize(8 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::NEWT), 2, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::SETGL), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::VARARG), top, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::GETUP), 0, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 4, .isVararg = true},
		{.firstWord = 6, .wordCount = 2, .maxStack = 1, .staticClosure = false, .upvalues = {{true, 2}}}};
	image.globalNames = {"read"};
	image.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses); cpu.reset();
	u32 stopPc = rom.textAddress + 5 * INSTRUCTION_BYTES;
	cpu.setExecutionHook({[](void* context, ExecutionDomainId, u32 pc) { return pc == *static_cast<u32*>(context); }, &stopPc, ALL_EXECUTION_DOMAINS_MASK, 0u});
	require(cpu.runUntilDepth(0, 100) == RunResult::ExecutionStopped, "stop after open VARARG changes top");
	require(static_cast<bmsx::i32>(cpu.activeThread()->currentFrame->readControl(bmsx::FrameField::Top)) == top, "raw open VARARG retains its exact top");
	cpu.collectHeap(); cpu.restoreRuntimeState(cpu.captureRuntimeState());
	require(valueIsTable(cpu.activeThread()->currentFrame->registers.get(2)), "an open capture owns its slot even above lowered top");
	cpu.setExecutionHook({}); cpu.runUntilDepth(0, 100);
	auto* closure = asClosure(cpu.getGlobalByKey(cpu.stringPool().intern("read")), cpu.gcHeap());
	cpu.beginCompletionCall(*closure); cpu.runUntilDepth(0, 100);
	const auto values = cpu.readCompletionValues();
	require(values.size() == 1 && valueIsTable(values.get(0)), "closing the capture retains its value after the source frame returns");
}

void memoryAliasesActiveStack() {
	test::Blua32TestImage image;
	image.text.resize(5 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::KSMI), 0, 0, 37);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::LOAD_MEM), 1, 4, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::STORE_MEM), 5, 4, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::MOV), 2, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8}};
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses); cpu.reset();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	cpu.setNativeCompilationProfiling(true);
	cpu.prepareSystemNativeCode();
#endif
	const int cycles = BASE_CYCLES[static_cast<u8>(OpCode::KSMI)] + BASE_CYCLES[static_cast<u8>(OpCode::LOAD_MEM)]
		+ BASE_CYCLES[static_cast<u8>(OpCode::STORE_MEM)] + BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
	auto* thread = cpu.activeThread();
	auto& regs = thread->currentFrame->registers;
	regs.set(4, valueInteger(DYNAMIC_RAM_BASE));
	regs.set(5, valueInteger(73));
	cpu.runUntilDepth(0, 512 * cycles);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(cpu.readNativeCompilationProfile().entriesPublished != 0u, "the alias regression exercises a warmed native entry");
#endif
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
	const u32 slot = RAM_BASE + thread->stackOffset();
	regs.set(4, valueInteger(slot));
	cpu.runUntilDepth(0, 512 * cycles);
	require(regs.get(1) == valueInteger(37), "a bus read observes the preceding dirty register");
	require(regs.get(2) == valueInteger(73), "a bus write invalidates the resident register value");
	require(memory.readRamRecordWord(slot) == 73u && regs.get(0) == valueInteger(73),
		"both CPU registers and bus accesses refer to the actual guest RAM bytes");

	MappedPageBinding binding{};
	const u32 slotOffset = slot & MAPPED_PAGE_BYTE_MASK;
	memory.bindMappedPage(slot & ~MAPPED_PAGE_BYTE_MASK, MAPPED_BUS_MASTER_CPU, binding);
	binding.writeWatch.armWord(slotOffset / INSTRUCTION_BYTES);
	binding.writeWatch.armWord(slotOffset / INSTRUCTION_BYTES + 7);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
	cpu.runUntilDepth(0, cycles);
	require(!binding.writeWatch.consume(slotOffset / INSTRUCTION_BYTES, slotOffset / INSTRUCTION_BYTES + 1),
		"the stack write consumed the watch on that exact word");
	require(binding.writeWatch.consume(slotOffset / INSTRUCTION_BYTES + 7, slotOffset / INSTRUCTION_BYTES + 8),
		"the unused slot's watch survived");
	// A cartridge write changes the physical register aperture even if it
	// straddles RAM's end. The two lanes wrap independently at the record port.
	const u32 descriptor = thread->address + static_cast<u32>(ThreadField::StackBlock);
	memory.writeMappedU32LE(descriptor, RAM_BASE + MAIN_RAM_SIZE - 4u);
	require(thread->stack.mirrored(), "the relocated bank needs the physical record port");
	regs.set(0, valueInteger(123));
	regs.set(1, valueFloatBits(0xffc00042));
	require(memory.readRamRecordWord(MAIN_RAM_SIZE - 4u) == 123u && memory.readRamRecordWord(0u) == 0xffc00042u,
		"only the record port wraps payload addresses");
	require(memory.readRamRecordByte(28u) == static_cast<u8>(ValueTag::Integer)
		&& memory.readRamRecordByte(29u) == static_cast<u8>(ValueTag::Float)
		&& regs.get(1) == valueFloatBits(0xffc00042), "the independently wrapped tags preserve the raw Value");
	regs.copyFrom(regs, 1, 0, 2);
	require(regs.get(1) == valueInteger(123) && regs.get(2) == valueFloatBits(0xffc00042), "wrapped overlap copies have memmove order");
	const auto checkpoint = cpu.captureRuntimeState();
	const auto ram = memory.captureSaveState();
	regs.set(1, valueInteger(7));
	memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(checkpoint);
	require(cpu.readFrameRegister(0, 1) == valueInteger(123), "restoring RAM restores a wrapped register bank");

}

}

int main() {
	try {
		slidingFixedCall(true);
		slidingFixedCall(false);
		formalReservationRoots(true); formalReservationRoots(false);
		memoryAliasesActiveStack();
		capturedSlotSurvivesOpenTop(0); capturedSlotSurvivesOpenTop(31);
		for (bool interpreted : {true, false}) for (bool open : {false, true}) slidingVarargCall(interpreted, open);
		std::cout << "shared stack tests passed\n";
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
