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
	image.constants = {37.0};
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
	require(parent->registers[0] == valueNumber(1), "the lower caller prefix survives calls");
	require(parent->next && parent->next->stackBase == parent->stackBase + 5, "callee parameters alias the supplied argument slots");
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, rom.functionAddresses[0], rom.textAddress + INSTRUCTION_BYTES);
	cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)]
		+ BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)]);
	require(thread->frameDepth == 2, "exhausted CALL grant leaves the callee before its first instruction");
	auto* child = thread->currentFrame;
	require(child->registers == parent->registers + 5, "callee uses a sliding Value pointer");
	require(child->registers[0] == valueNumber(37) && child->registers[1] == valueNil(), "arguments stay in place and missing formals become nil");
	require(thread->stackTop == 13, "active stack extent excludes dead caller scratch");
	child->registers[0] = valueNumber(41);
	require(parent->registers[5] == valueNumber(41), "both register views name the same storage");
	cpu.collectHeap();
	const auto snapshot = cpu.captureRuntimeState();
	require(snapshot.threads[0].stack.size() == 13, "snapshot records shared storage once");
	cpu.restoreRuntimeState(snapshot);
	thread = cpu.activeThread();
	require(thread->currentFrame->registers == thread->firstFrame->registers + 5, "restoring frame offsets restores sharing");
	cpu.runUntilDepth(1, 100);
	parent = thread->currentFrame;
	require(parent->registers[4] == valueNumber(41) && parent->registers[5] == valueNil(), "overlapping return copies retain values and padding");
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
	image.constants = {37.0, false, -0.0};
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
	require(child->stackBase == 8 && child->varargBase == 6 && child->varargCount == 2, "vararg working registers slide above original arguments");
	require(child->registers[0] == valueNumber(37) && thread->stack[5] == valueNil(), "fixed parameters move, original copies no longer retain roots");
	cpu.collectHeap();
	const auto snapshot = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(snapshot);
	cpu.runUntilDepth(1, 100);
	auto* parent = cpu.activeThread()->currentFrame;
	require(parent->top == 7 && parent->registers[4] == valueNumber(1)
		&& parent->registers[5] == valueBool(false) && parent->registers[6] == valueNumber(-0.0),
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
	for (int index = 0; index < 6; ++index) parent->registers[5 + index] = valueNumber(index);
	auto* table = cpu.createTable(1, 0); table->setInteger(1, valueNumber(73));
	parent->registers[11] = valueTable(table); parent->top = 12;
	cpu.runUntilDepth(0, 3);
	auto* child = cpu.activeThread()->currentFrame;
	require(cpu.getFrameDepth() == 2 && child->stackCapacity == 7 && child->top == 7,
		"the formal count owns every argument even when maxStack is smaller");
	cpu.collectHeap();
	const auto snapshot = cpu.captureRuntimeState();
	require(snapshot.threads[0].stack.size() == 12, "snapshot includes the complete formal reservation once");
	cpu.restoreRuntimeState(snapshot);
	child = cpu.activeThread()->currentFrame;
	require(asTable(child->registers[6])->getInteger(1) == valueNumber(73),
		"the last formal remains rooted through forced collection and restore");
	cpu.runUntilDepth(0, 100);
	const auto values = cpu.readCompletionValues();
	require(values.size() == 7 && asTable(values[6])->getInteger(1) == valueNumber(73),
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
	require(cpu.activeThread()->currentFrame->top == top, "raw open VARARG retains its exact top");
	cpu.collectHeap(); cpu.restoreRuntimeState(cpu.captureRuntimeState());
	require(valueIsTable(cpu.activeThread()->currentFrame->registers[2]), "an open capture owns its slot even above lowered top");
	cpu.setExecutionHook({}); cpu.runUntilDepth(0, 100);
	auto* closure = asClosure(cpu.getGlobalByKey(cpu.stringPool().intern("read")));
	cpu.beginCompletionCall(*closure); cpu.runUntilDepth(0, 100);
	const auto values = cpu.readCompletionValues();
	require(values.size() == 1 && valueIsTable(values[0]), "closing the capture retains its value after the source frame returns");
}

}

int main() {
	try {
		slidingFixedCall(true);
		slidingFixedCall(false);
		formalReservationRoots(true); formalReservationRoots(false);
		capturedSlotSurvivesOpenTop(0); capturedSlotSurvivesOpenTop(31);
		for (bool interpreted : {true, false}) for (bool open : {false, true}) slidingVarargCall(interpreted, open);
		std::cout << "shared stack tests passed\n";
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
