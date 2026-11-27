#include "machine/cpu/cpu.h"
#include "machine/cpu/upvalue.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/io.h"
#include "support/blua32_test_rom.h"
#include "support/closure_fixture.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <array>
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
	test::seedTestRomClosure(cpu, rom.functionAddresses[1]);
	if (interpreted) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	cpu.runUntilDepth(0, 20000);
	cpu.runUntilDepth(1, 100);
	auto* thread = cpu.activeThread();
	auto* parent = thread->currentFrame;
	require(thread->frameDepth() == 1, "warm execution returns to the original frame");
	require(thread->stackCapacity == 128, "fixed calls share the allocation rather than appending maxStack windows");
	require(parent->registers.get(0) == valueInteger(1), "the lower caller prefix survives calls");
	require(parent->next && parent->next->stackBase() == parent->stackBase() + 5, "callee parameters alias the supplied argument slots");
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress + INSTRUCTION_BYTES);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)]
		+ BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)]);
	require(thread->frameDepth() == 2, "exhausted CALL grant leaves the callee before its first instruction");
	auto* child = thread->currentFrame;
	require(child->registers.words() == parent->registers.words() + 5 && child->registers.tags() == parent->registers.tags() + 5, "callee borrows both planes at the same argument offset");
	require(child->registers.get(0) == valueInteger(37) && child->registers.get(1) == valueNil(), "arguments stay in place and missing formals become nil");
	require(thread->stackTop() == 13, "active stack extent excludes dead caller scratch");
	child->registers.set(0, valueInteger(41));
	require(parent->registers.get(5) == valueInteger(41), "both register views name the same storage");
	cpu.collectHeap();
	const auto snapshot = cpu.captureRuntimeState();
	require(memory.readRamRecordWord(thread->address + static_cast<u32>(ThreadField::StackTop)) == 13, "the thread header owns the shared stack extent");
	cpu.restoreRuntimeState(snapshot);
	thread = cpu.activeThread();
	require(thread->currentFrame->registers.words() == thread->firstFrame->registers.words() + 5
		&& thread->currentFrame->registers.tags() == thread->firstFrame->registers.tags() + 5, "restoring frame offsets restores sharing");
	cpu.runUntilDepth(1, 100);
	parent = thread->currentFrame;
	require(parent->registers.get(4) == valueInteger(41) && parent->registers.get(5) == valueNil(), "overlapping return copies retain values and padding");
	require(thread->stackTop() == 128, "retirement restores the caller reservation without shifting any frame");
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
	test::seedTestRomClosure(cpu, rom.functionAddresses[1]);
	if (interpreted) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	cpu.runUntilDepth(0, 20000);
	cpu.runUntilDepth(1, 100);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress + INSTRUCTION_BYTES);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)]
		+ 3 * BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)]);
	auto* thread = cpu.activeThread();
	require(thread->frameDepth() == 2, "vararg CALL enters before executing the body");
	auto* child = thread->currentFrame;
	require(child->stackBase() == 8 && static_cast<bmsx::i32>(child->readControl(bmsx::FrameField::VarargBase)) == 6 && static_cast<bmsx::i32>(child->readControl(bmsx::FrameField::VarargCount)) == 2, "vararg working registers slide above original arguments");
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
	test::seedTestRomClosure(cpu, rom.functionAddresses[1]);
	if (interpreted) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	auto* parent = cpu.activeThread()->currentFrame;
	for (int index = 0; index < 6; ++index) parent->registers.set(5 + index, valueInteger(index));
	auto table = cpu.createTable(1, 0); table.setInteger(1, valueInteger(73));
	parent->registers.set(11, valueTable(table.address())); parent->writeControl(bmsx::FrameField::Top, 12);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)]);
	auto* child = cpu.activeThread()->currentFrame;
	require(cpu.getFrameDepth() == 2 && child->stackCapacity() == 7 && static_cast<bmsx::i32>(child->readControl(bmsx::FrameField::Top)) == 7,
		"the formal count owns every argument even when maxStack is smaller");
	cpu.collectHeap();
	const auto snapshot = cpu.captureRuntimeState();
	require(memory.readRamRecordWord(child->thread->address + static_cast<u32>(ThreadField::StackTop)) == 12, "the thread header includes the complete formal reservation");
	cpu.restoreRuntimeState(snapshot);
	child = cpu.activeThread()->currentFrame;
	require(asTable(child->registers.get(6), cpu.gcHeap()).getInteger(1) == valueInteger(73),
		"the last formal remains rooted through forced collection and restore");
	cpu.runUntilDepth(0, 100);
	const auto values = cpu.readCompletionValues();
	require(values.size() == 7 && asTable(values.get(6), cpu.gcHeap()).getInteger(1) == valueInteger(73),
		"all formal results survive overlapping return transfer");
}

void capturedSlotSurvivesOpenTop(int top) {
	test::Blua32TestImage image;
	image.text.resize(5 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETGL), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::VARARG), top, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::GETUP), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 4, .isVararg = true},
		{.firstWord = 3, .wordCount = 2, .maxStack = 1, .staticClosure = false, .upvalues = {{true, 2}}}};
	image.globalNames = {"read"};
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses); cpu.reset();
	auto& frame = *cpu.activeThread()->currentFrame;
	frame.registers.set(2, valueTable(cpu.createTable().address()));
	std::array<u32, 1> cells{};
	frame.registers.set(0, valueClosure(test::seedTestCapturedClosure(cpu, rom.functionAddresses[1], cells)));
	Upvalue::bindOpen(memory, cells[0], frame.thread->address, frame.stackBase() + 2, 0u);
	frame.writeControl(FrameField::OpenHead, cells[0]);
	u32 stopPc = rom.textAddress + 2 * INSTRUCTION_BYTES;
	cpu.setExecutionHook({[](void* context, ExecutionDomainId, u32 pc) { return pc == *static_cast<u32*>(context); }, &stopPc, ALL_EXECUTION_DOMAINS_MASK, 0u});
	require(cpu.runUntilDepth(0, 100) == RunResult::ExecutionStopped, "stop after open VARARG changes top");
	require(static_cast<bmsx::i32>(cpu.activeThread()->currentFrame->readControl(bmsx::FrameField::Top)) == top, "raw open VARARG retains its exact top");
	cpu.collectHeap(); cpu.restoreRuntimeState(cpu.captureRuntimeState());
	require(valueIsTable(cpu.activeThread()->currentFrame->registers.get(2)), "an open capture owns its slot even above lowered top");
	cpu.setExecutionHook({}); cpu.runUntilDepth(0, 100);
	auto closure = asClosure(cpu.getGlobalByKey(cpu.stringPool().intern("read")), cpu.gcHeap());
	cpu.beginCompletionCall(closure); cpu.runUntilDepth(0, 100);
	const auto values = cpu.readCompletionValues();
	require(values.size() == 1 && valueIsTable(values.get(0)), "closing the capture retains its value after the source frame returns");
}

void privatePhysicalStack() {
	test::Blua32TestImage image;
	image.text.resize(3 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 1, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::KSMI), 2, 0, 37);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8}};
	const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
	Memory memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory); ExecutionAddressSpace addresses(memory); CPU cpu(memory, irq, addresses); cpu.reset();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	cpu.setNativeCompilationProfiling(true); cpu.prepareSystemNativeCode();
#endif
	const int cycles = BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + BASE_CYCLES[static_cast<u8>(OpCode::KSMI)] + BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
	auto* thread = cpu.activeThread(); auto& regs = thread->currentFrame->registers;
	regs.set(0, valueInteger(41));
	thread->currentFrame->setTop(1);
	cpu.runUntilDepth(0, 512 * cycles);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	test::waitForFixtureWorkerRequests(cpu);
#endif
	require(cpu.readNativeCompilationProfile().entriesPublished != 0u, "the private-stack regression exercises a warmed native entry");
#endif
	const u32 offset = thread->stackOffset(), slot = RAM_BASE + offset;
	require(slot >= memory.ramBusEnd(), "the actual stack resides outside the public aperture");
	for (const u32 address : {slot, thread->address, RAM_BASE + thread->currentFrame->controlOffset}) {
		memory.clearBusFault();
		require(memory.readMappedBusU32LE(address, MAPPED_BUS_INSTRUCTION_FETCH) == 0u
			&& memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED,
			"the instruction bus cannot observe the active thread or its frame and Value storage");
	}
	memory.clearBusFault(); require(memory.readMappedU32LE(slot) == 0u, "a private stack supplies no ordinary bus payload");
	require(memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED, "an ordinary private-stack read faults");
	memory.clearBusFault(); memory.writeMappedU32LE(slot, 73u);
	require(memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED && regs.get(0) == valueInteger(41), "an ordinary bus store cannot alter the private register");
	memory.writeRamRecordWord(slot, 73u);
	require(regs.get(0) == valueInteger(73), "the bound Value plane is the physical RAM");
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress);
	cpu.runUntilDepth(0, cycles);
	require(regs.get(1) == valueInteger(73), "warmed execution reads the private physical register");
	const auto checkpoint = cpu.captureRuntimeState(); const auto ram = memory.captureSaveState();
	regs.set(1, valueInteger(7)); memory.restoreSaveState(ram); cpu.restoreRuntimeState(checkpoint);
	require(cpu.readFrameRegister(0, 1) == valueInteger(73), "restore rebinds the active private Value plane");
}

void wrappedPhysicalValues() {
	std::array<u8, 1> empty{};
	Memory memory(MemoryInit{{empty.data(), 0u}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	ValueSpan regs(memory, MAIN_RAM_SIZE - 4u, 28u, 8u);
	require(regs.mirrored(), "a wrapped Value window uses the physical port");
	regs.set(0, valueInteger(123)); regs.set(1, valueFloatBits(0xffc00042u));
	require(memory.readRamRecordWord(MAIN_RAM_SIZE - 4u) == 123u && memory.readRamRecordWord(0u) == 0xffc00042u,
		"payload accesses wrap at physical RAM independently from tags");
	require(memory.readRamRecordByte(28u) == static_cast<u8>(ValueTag::Integer) && memory.readRamRecordByte(29u) == static_cast<u8>(ValueTag::Float),
		"the tag plane retains its separate wrapped address");
	regs.copyFrom(regs, 1, 0, 2);
	require(regs.get(1) == valueInteger(123) && regs.get(2) == valueFloatBits(0xffc00042u), "wrapped overlap copies retain memmove order and raw NaN bits");
}

}

int main() {
	try {
		slidingFixedCall(true);
		slidingFixedCall(false);
		formalReservationRoots(true); formalReservationRoots(false);
		privatePhysicalStack(); wrappedPhysicalValues();
		capturedSlotSurvivesOpenTop(0); capturedSlotSurvivesOpenTop(31);
		for (bool interpreted : {true, false}) for (bool open : {false, true}) slidingVarargCall(interpreted, open);
		std::cout << "shared stack tests passed\n";
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
