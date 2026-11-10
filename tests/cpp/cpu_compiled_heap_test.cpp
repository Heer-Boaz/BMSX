#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <tuple>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

struct CpuMachine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	CpuMachine(const test::Blua32TestImage& image, bool scalar = false)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void requireParity(CpuMachine& native, CpuMachine& scalar) {
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()) && a.nextObjectHashId == b.nextObjectHashId
		&& a.luaHeap.trackedBytes == b.luaHeap.trackedBytes && a.luaHeap.nextCollectionBytes == b.luaHeap.nextCollectionBytes,
		"the complete value graph, allocation roots and heap accounting agree");
	require(std::tie(a.statusWord, a.causeWord, a.epcWord, a.badAddressWord, a.luaFaultReasonWord, a.exceptionDomainWord,
		a.nmiReturnCauseWord, a.nmiReturnEpcWord, a.nmiReturnBadAddressWord, a.nmiReturnLuaFaultReasonWord,
		a.nmiReturnExceptionDomainWord, a.nonMaskableInterruptPending, a.hardHalted, a.haltedUntilIrqFrameDepth,
		a.haltedUntilIrqThreadRef, a.interruptEventPending, a.memoryWriteBlocked, a.memoryWriteBlockedAddress, a.yieldRequested)
		== std::tie(b.statusWord, b.causeWord, b.epcWord, b.badAddressWord, b.luaFaultReasonWord, b.exceptionDomainWord,
		b.nmiReturnCauseWord, b.nmiReturnEpcWord, b.nmiReturnBadAddressWord, b.nmiReturnLuaFaultReasonWord,
		b.nmiReturnExceptionDomainWord, b.nonMaskableInterruptPending, b.hardHalted, b.haltedUntilIrqFrameDepth,
		b.haltedUntilIrqThreadRef, b.interruptEventPending, b.memoryWriteBlocked, b.memoryWriteBlockedAddress, b.yieldRequested),
		"all control words, interrupt and execution latches agree");
	require(native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining
		&& native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc(),
		"cycle grants and the physical instruction prefix/body boundary agree");
	const auto& x = native.cpu.activeThread()->frames; const auto& y = scalar.cpu.activeThread()->frames;
	require(x.size() == y.size(), "frame depths agree");
	for (size_t i = 0; i < x.size(); ++i) require(x[i]->pc == y[i]->pc && x[i]->top == y[i]->top
		&& x[i]->stackBase == y[i]->stackBase && x[i]->stackCapacity == y[i]->stackCapacity, "live frame extents agree");
}

void concatKindsAndAliases(int destination) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 8, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CONCAT), destination, 0, 1);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 16}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) for (int warm = 0; warm < 12; ++warm) {
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		auto& frame = *m->cpu.activeThread()->frames[0]; frame.registers[0] = valueNumber(1); frame.registers[1] = valueNumber(2);
		m->cpu.runUntilDepth(0, 2);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& block = native.cpu.activeThread()->frames[0]->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->terminal.exit == NativeBlockExit::Concat && block->sourceWords == 2, "the allocating concatenation really terminates a native prefix");
#endif
	BuiltinFunction builtin{BuiltinFunctionId::Type};
	const std::array<std::pair<Value, std::string_view>, 10> values{{{valueNil(), "nil"}, {valueBool(false), "false"},
		{valueBool(true), "true"}, {valueNumber(0), "0"}, {valueNumber(-0.0), "-0"},
		{valueNumber(std::numeric_limits<double>::quiet_NaN()), "nan"}, {valueNumber(std::numeric_limits<double>::infinity()), "inf"},
		{valueNumber(-std::numeric_limits<double>::infinity()), "-inf"}, {valueNumber(1.234565), "1.23456"}, {valueBuiltinFunction(&builtin), "function"}}};
	const std::array extra{std::string("λ\0🍻", 7), std::string("table"), std::string("function"), std::string("thread")};
	for (size_t kind = 0; kind < values.size() + extra.size(); ++kind) {
		const std::string expected = std::string(kind < values.size() ? values[kind].second : std::string_view(extra[kind - values.size()])) + "!";
		for (auto* m : {&native, &scalar}) {
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			auto& frame = *m->cpu.activeThread()->frames[0]; frame.top = 0;
			if (kind < values.size()) frame.registers[0] = values[kind].first;
			else switch (kind - values.size()) {
				case 0: frame.registers[0] = valueString(m->cpu.stringPool().intern(extra[0])); break;
				case 1: frame.registers[0] = valueTable(m->cpu.createTable(0, 0)); break;
				case 2: frame.registers[0] = valueClosure(frame.closure); break;
				case 3: frame.registers[0] = valueThread(m->cpu.activeThread()); break;
			}
			frame.registers[1] = valueString(m->cpu.stringPool().intern("!"));
		}
		require(native.cpu.runUntilDepth(0, 2) == scalar.cpu.runUntilDepth(0, 2), "aliasing concatenation consumes the same grant"); requireParity(native, scalar);
		require(native.cpu.stringPool().toString(asStringId(native.cpu.readFrameRegister(0, destination))) == expected, "every language kind uses the specified text conversion");
		require(native.cpu.activeThread()->frames[0]->top == 9, "the numeric prefix top is retained");
	}
}

void concatConstants() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CONCAT), 0, 63, 62, 63);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8}}; image.constants = {-0.0, std::string("🍻")};
	CpuMachine native(image), scalar(image, true); native.cpu.runUntilDepth(0, 300); scalar.cpu.runUntilDepth(0, 300); requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& block = native.cpu.activeThread()->frames[0]->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->terminal.exit == NativeBlockExit::Concat && block->terminal.exitB == -1 && block->terminal.exitC == -2, "the native terminal retains signed RK constants");
#endif
	require(native.cpu.stringPool().toString(asStringId(native.cpu.readFrameRegister(0, 0))) == "-0🍻", "numeric conversion is not u32 conversion");
}

void concatRange(int count) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 2, 1, count >> 9);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CONCATN), 1, 0, count & 63);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 1025}};
	CpuMachine native(image), scalar(image, true); std::string expected;
	for (int i = 0; i < count; ++i) expected += i == 0 ? "L" : i == 1 ? "false" : std::to_string(i % 10);
	for (int warm = 0; warm < 12; ++warm) {
		for (auto* m : {&native, &scalar}) {
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			auto* registers = m->cpu.activeThread()->frames[0]->registers;
			for (int i = 0; i < count; ++i) registers[512 + i] = i == 0 ? valueString(m->cpu.stringPool().intern("L"))
				: i == 1 ? valueBool(false) : valueNumber(i % 10);
		}
		require(native.cpu.runUntilDepth(0, 3) == scalar.cpu.runUntilDepth(0, 3), "WIDE ranges consume the same grant"); requireParity(native, scalar);
		require(native.cpu.stringPool().toString(asStringId(native.cpu.readFrameRegister(0, 513))) == expected, "every source is read before the overlapping destination is written");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& block = native.cpu.activeThread()->frames[0]->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->terminal.exit == NativeBlockExit::ConcatRange && block->terminal.exitC == count, "the full WIDE count belongs to the native terminal");
#endif
	require(native.cpu.activeThread()->frames[0]->top == 514, "counted sources do not inflate the destination top");
}

void allocationRoots(bool closure) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 7, 9, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::KNIL), 9, 0, 0);
	if (closure) {
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0); writeInstruction(image.text, 3, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
		image.closureRelocations = {{3, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	} else {
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::CONCAT), 0, 1, 2); writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	}
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = closure ? 5u : 4u, .maxStack = 16},
		{.firstWord = 16, .wordCount = 1, .staticClosure = false, .upvalues = {{true, 7}}}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto* r = m->cpu.activeThread()->frames[0]->registers; r[9] = valueNumber(1); r[1] = valueNumber(2); r[2] = valueNumber(3);
		m->cpu.runUntilDepth(0, 400);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& block = native.cpu.activeThread()->frames[0]->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->terminal.exit == (closure ? NativeBlockExit::CreateClosure : NativeBlockExit::Concat), "collection is reached from actual native code");
#endif
	std::array<std::string, 2> garbage; size_t index = 0;
	for (auto* m : {&native, &scalar}) {
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		auto& frame = *m->cpu.activeThread()->frames[0]; auto* r = frame.registers;
		Table* table = m->cpu.createTable(0, 1); auto& strings = m->cpu.stringPool();
		table->setStringKey(strings.intern("payload"), valueString(strings.intern("retained")));
		r[9] = valueTable(table); r[1] = valueString(strings.intern("fresh-")); r[2] = valueString(strings.intern("result")); frame.top = 0;
		const auto heap = m->cpu.captureRuntimeState().luaHeap;
		garbage[index] = std::string(heap.nextCollectionBytes - heap.trackedBytes - 1, 'g'); strings.intern(garbage[index++]);
	}
	require(native.cpu.runUntilDepth(0, 3) == scalar.cpu.runUntilDepth(0, 3), "the allocating instruction consumes the same grant"); requireParity(native, scalar);
	index = 0;
	for (auto* m : {&native, &scalar}) {
		auto& strings = m->cpu.stringPool(); require(!strings.find(garbage[index++]), "the operation really collected the unrooted pressure string");
		auto* r = m->cpu.activeThread()->frames[0]->registers; Table* retained = asTable(r[7]);
		require(retained->getStringKey(*strings.find("payload")) == valueString(*strings.find("retained")), "a moved reference remains rooted across allocation");
		if (closure) require(m->cpu.readClosureUpvalue(asClosure(r[0]), 0) == r[7], "capture observes the published reference value");
		else require(strings.toString(asStringId(r[0])) == "fresh-result", "allocation commits the entire concatenation result");
	}
}

void canonicalImmediateClosure() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0); writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::MOV), 1, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::WIDE), 0, 0, 0); writeInstruction(image.text, 5, static_cast<u8>(OpCode::CLOSURE), 2, 0, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255); writeInstruction(image.text, 16, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 8}, {.firstWord = 16, .wordCount = 1}};
	image.closureRelocations = {{2, DYNAMIC_RAM_BASE}, {5, DYNAMIC_RAM_BASE}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		const u32 offset = m->rom.functionAddresses[1] - SYSTEM_ROM_BASE;
		m->memory.writeBytes(DYNAMIC_RAM_BASE, m->rom.bytes.data() + offset, BLUA32_FUNCTION_RECORD_SIZE); m->cpu.runUntilDepth(0, 500);
	}
	requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& block = native.cpu.activeThread()->frames[0]->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->sourceWords == 3 && block->terminal.exit == NativeBlockExit::CreateClosure
		&& block->terminal.exitBx == DYNAMIC_RAM_BASE / BLUA32_FUNCTION_ALIGNMENT && block->terminal.exitBx > 0xffffu, "the native closure exit retains every Bx bit");
#endif
	require(native.cpu.readFrameRegister(0, 0) == native.cpu.readFrameRegister(0, 2), "STATIC creation preserves canonical function identity");
}

void closureBusFault(bool descriptors) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0); writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETGL), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 4, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255); writeInstruction(image.text, 16, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 257},
		{.firstWord = 16, .wordCount = 1, .staticClosure = false, .upvalues = {{true, 7}}}}; image.globalNames = {"target"};
	CpuMachine native(image), scalar(image, true); constexpr u32 bad = 0xdead0000u;
	for (auto* m : {&native, &scalar}) {
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("target"), valueNumber(m->rom.functionAddresses[1] + 0.75)); m->cpu.runUntilDepth(0, 500);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& block = native.cpu.activeThread()->frames[0]->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->terminal.exit == NativeBlockExit::CreateClosure && block->terminal.exitA == 256,
		"the actual hot register-address path retains its WIDE destination");
#endif
	for (auto* m : {&native, &scalar}) {
		if (descriptors) {
			const u32 offset = m->rom.functionAddresses[1] - SYSTEM_ROM_BASE;
			m->memory.writeBytes(DYNAMIC_RAM_BASE, m->rom.bytes.data() + offset, BLUA32_FUNCTION_RECORD_SIZE);
			m->memory.writeMappedU32LE(DYNAMIC_RAM_BASE + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, bad);
		}
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("target"), valueNumber(descriptors ? DYNAMIC_RAM_BASE : bad));
		auto& frame = *m->cpu.activeThread()->frames[0]; frame.registers[256] = valueNumber(73); frame.top = 0;
	}
	require(native.cpu.runUntilDepth(0, 4) == RunResult::Halted && scalar.cpu.runUntilDepth(0, 4) == RunResult::Halted, "a metadata bus fault hard-halts both paths"); requireParity(native, scalar);
	require(native.cpu.captureRuntimeState().hardHalted && native.cpu.readFrameRegister(0, 256) == valueNumber(73)
		&& native.cpu.activeThread()->frames[0]->top == 8, "the failed instruction does not write or extend its destination");
	require(native.cpu.readCurrentInstructionPc() == native.rom.textAddress + 2u * INSTRUCTION_BYTES
		&& native.cpu.lastPc == native.rom.textAddress + 3u * INSTRUCTION_BYTES, "faults retain the WIDE prefix/body boundary");
}

void closureAddressAlias(int source) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), source >> 6, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETGL), source & 63, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), source >> 6, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CLOSURE), source & 63, (source >> 6) & 63, source & 63);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255); writeInstruction(image.text, 16, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = static_cast<u32>(source + 1)},
		{.firstWord = 16, .wordCount = 1}, {.firstWord = 16, .wordCount = 1, .staticClosure = false}}; image.globalNames = {"target"};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("target"), valueNumber(m->rom.functionAddresses[1])); m->cpu.runUntilDepth(0, 400);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& block = native.cpu.activeThread()->frames[0]->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->terminal.exit == NativeBlockExit::CreateClosure && block->terminal.exitA == source
		&& block->terminal.exitBx == static_cast<u32>(source), "the generated body retains the aliasing WIDE register operand");
#endif
	for (int index : {2, 1, 2, 2, 1}) {
		for (auto* m : {&native, &scalar}) {
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			m->cpu.setGlobalByKey(*m->cpu.stringPool().find("target"), valueNumber(m->rom.functionAddresses[index] + 0.75));
		}
		require(native.cpu.runUntilDepth(0, 3) == scalar.cpu.runUntilDepth(0, 3), "both live operand paths consume the same grant"); requireParity(native, scalar);
		require(asClosure(native.cpu.readFrameRegister(0, source))->functionAddress == native.rom.functionAddresses[index], "the full source address is sampled before its slot is replaced");
	}
}

void concatAllocationFault(bool range) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 8, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(range ? OpCode::CONCATN : OpCode::CONCAT), 0, 1, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255); writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 16}, {.firstWord = 32, .wordCount = 1}}; image.exceptionFunctionIndex = 1;
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto& frame = *m->cpu.activeThread()->frames[0]; frame.registers[1] = valueNumber(1); frame.registers[2] = valueNumber(2);
		m->cpu.runUntilDepth(0, range ? 400 : 300);
		const StringId id = m->cpu.stringPool().intern(std::string(2u * 1024u * 1024u, 'x'));
		frame.registers[1] = valueString(id); frame.registers[2] = valueString(id); frame.registers[0] = valueNumber(73); frame.top = 0;
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& block = native.cpu.activeThread()->frames[0]->decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->terminal.exit == (range ? NativeBlockExit::ConcatRange : NativeBlockExit::Concat), "the allocation fault leaves generated code before throwing");
#endif
	require(native.cpu.runUntilDepth(0, range ? 3 : 2) == scalar.cpu.runUntilDepth(0, range ? 3 : 2), "failed allocations consume the same grant"); requireParity(native, scalar);
	require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_OUT_OF_MEMORY
		&& native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES, "allocation faults use the completed prefix PC");
	require(native.cpu.readFrameRegister(0, 0) == valueNumber(73) && native.cpu.activeThread()->frames[0]->top == 9, "the failed allocation preserves its destination and published top");
}
} // namespace

int main() {
	try {
		for (int destination : {0, 1, 2}) concatKindsAndAliases(destination);
		concatConstants(); for (int count : {0, 3, 513}) concatRange(count);
		allocationRoots(false); allocationRoots(true); canonicalImmediateClosure(); closureBusFault(false); closureBusFault(true);
		closureAddressAlias(0); closureAddressAlias(513); concatAllocationFault(false); concatAllocationFault(true);
		std::cout << "Compiled CPU heap tests passed\n"; return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
