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
	auto& a = native.cpu; auto& b = scalar.cpu;
	require(a.instructionBudgetRemaining == b.instructionBudgetRemaining && a.lastPc == b.lastPc
		&& a.readCurrentInstructionPc() == b.readCurrentInstructionPc() && a.readCauseWord() == b.readCauseWord()
		&& a.readEpcWord() == b.readEpcWord() && a.readLuaFaultReasonWord() == b.readLuaFaultReasonWord(),
		"table operations retain exact execution and exception boundaries");
	const auto left = a.captureRuntimeState(), right = b.captureRuntimeState();
	require(std::ranges::equal(left.snapshot.words(), right.snapshot.words()) && left.nextObjectHashId == right.nextObjectHashId
		&& left.luaHeap.trackedBytes == right.luaHeap.trackedBytes && left.luaHeap.nextCollectionBytes == right.luaHeap.nextCollectionBytes,
		"complete value graphs and allocation/collection accounting agree");
	const auto& first = *a.activeThread(); const auto& second = *b.activeThread();
	require(first.frames.size() == second.frames.size() && first.stackTop == second.stackTop, "frame extents agree");
	for (size_t i = 0; i < first.frames.size(); ++i) {
		const auto& x = *first.frames[i]; const auto& y = *second.frames[i];
		require(x.pc == y.pc && x.top == y.top && x.stackBase == y.stackBase && x.stackCapacity == y.stackCapacity,
			"all live frame boundaries agree");
	}
}

void genericArraysAndHashKeys() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 9, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETI), 0, 2, 9);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::SETT), 0, 1, 2);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::GETT), 3, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::LEN), 4, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::MOV), 5, 9, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 12}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto* r = m->cpu.activeThread()->frames[0]->registers;
		r[0] = valueTable(m->cpu.createTable(4, 1)); r[1] = valueNumber(1); r[2] = valueNumber(3); m->cpu.runUntilDepth(0, 900);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frames[0]->decodedPage;
	const u32 entry = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto* block = page.nativeBlocks->entries[entry].get();
	require(block && block->sourceWords == 7, "generic keys, integer stores and length execute in the same native body");
#endif
	const auto field = native.cpu.stringPool().intern("field"), valueText = native.cpu.stringPool().intern("value");
	require(field == scalar.cpu.stringPool().intern("field") && valueText == scalar.cpu.stringPool().intern("value"), "matching runtime string ids");
	const std::array keys{valueNumber(1), valueNumber(2), valueNumber(4), valueNumber(5), valueNumber(0), valueNumber(-0.0),
		valueNumber(-7), valueNumber(1.5), valueNumber(2147483647.0), valueNumber(2147483648.0), valueNumber(4294967297.0),
		VALUE_QNAN_MASK, valueNumber(std::numeric_limits<double>::infinity()), valueNumber(-std::numeric_limits<double>::infinity()),
		valueBool(false), valueBool(true), valueString(field)};
	const std::array values{valueNil(), valueFromTag(ValueTag::False, 37), valueFromTag(ValueTag::True, 37),
		valueNumber(-0.0), VALUE_QNAN_MASK, valueNumber(std::numeric_limits<double>::infinity()), valueString(valueText)};
	for (const Value key : keys) for (const Value value : values) {
		for (auto* m : {&native, &scalar}) {
			auto* r = m->cpu.activeThread()->frames[0]->registers; r[1] = key; r[2] = value; m->cpu.runUntilDepth(0, 9);
		}
		requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 3) == value && native.cpu.readFrameRegister(0, 5) == valueNumber(1),
			"all raw values survive generic array/hash access and the pending store source stays live");
	}
	for (auto* m : {&native, &scalar}) {
		auto* r = m->cpu.activeThread()->frames[0]->registers;
		r[1] = valueTable(m->cpu.createTable()); r[2] = valueTable(m->cpu.createTable());
	}
	for (const int grant : {9, 1, 2, 1, 2, 1, 1, 1, 256}) {
		require(native.cpu.runUntilDepth(0, grant) == scalar.cpu.runUntilDepth(0, grant), "short table grants agree"); requireParity(native, scalar);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(page.nativeBlocks->entries[entry].get() == block, "table relocation and helper returns retain the original executable owner");
#endif
}

void inheritedArrayReads(bool generic) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(generic ? OpCode::GETT : OpCode::GETI), 3, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 4, 3, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 5}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto& cpu = m->cpu; auto* own = cpu.createTable(2), *parent = cpu.createTable(2), *meta = cpu.createTable(0, 1);
		parent->setInteger(1, valueNumber(73)); meta->setStringKey(cpu.stringPool().intern("__index"), valueTable(parent)); own->metatable = meta;
		auto* r = cpu.activeThread()->frames[0]->registers; r[0] = valueTable(own); r[1] = valueNumber(1); cpu.runUntilDepth(0, 300);
	}
	for (const Value value : {valueBool(false), valueNumber(0), valueNil(), valueBool(true), valueNumber(19), valueNil()}) {
		for (auto* m : {&native, &scalar}) { asTable(m->cpu.readFrameRegister(0, 0))->setInteger(1, value); m->cpu.runUntilDepth(0, 3); }
		requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 3) == (isNil(value) ? valueNumber(73) : value), "only missing own slots traverse inheritance");
	}
}

void storedLengthAndUtf8() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 8, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETI), 0, 2, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::LEN), 3, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 4, 8, 3);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 9}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto* table = m->cpu.createTable(2, 4); for (int i = 1; i <= 5; ++i) table->setInteger(i, valueNumber(i));
		auto* r = m->cpu.activeThread()->frames[0]->registers; r[0] = valueTable(table); r[2] = valueNumber(2); m->cpu.runUntilDepth(0, 600);
	}
	for (const Value value : {valueNil(), valueBool(false), valueNil(), valueNumber(2)}) {
		for (auto* m : {&native, &scalar}) { m->cpu.activeThread()->frames[0]->registers[2] = value; m->cpu.runUntilDepth(0, 6); }
		requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 3) == valueNumber(isNil(value) ? 1 : 5), "native length advancement includes hash-held entries and nil shortens it");
	}
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::KSMI), 4, 0, 7);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 2, 1, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::LEN), 2, 2, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 3, 2, 4);
	CpuMachine textNative(image), textScalar(image, true);
	for (auto* m : {&textNative, &textScalar}) {
		m->cpu.activeThread()->frames[0]->registers[1] = valueString(m->cpu.stringPool().intern(std::string_view("A\xc3\xa9\xe9\x9b\xaa\0\xf0\x9f\x98\x80", 11)));
		m->cpu.runUntilDepth(0, 500);
	}
	requireParity(textNative, textScalar);
	require(textNative.cpu.readFrameRegister(0, 2) == valueNumber(5) && textNative.cpu.readFrameRegister(0, 3) == valueNumber(12),
		"the string-count native ABI retains pending values and UTF-8 codepoint semantics including NUL");
}

void selfAndNilFaults() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 6, 9, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SELF), 6, 6, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 10}, {.firstWord = 32, .wordCount = 1}};
	image.constants = {std::string("method")}; image.exceptionFunctionIndex = 1;
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto& cpu = m->cpu; auto* table = cpu.createTable(0, 1); table->setStringKey(cpu.stringPool().intern("method"), valueNumber(73));
		cpu.activeThread()->frames[0]->registers[9] = valueTable(table); cpu.runUntilDepth(0, 300);
		auto* meta = cpu.createTable(0, 1); table->setStringKey(cpu.stringPool().intern("method"), valueNil());
		meta->setStringKey(cpu.stringPool().intern("__index"), valueTable(table)); table->metatable = meta;
		cpu.activeThread()->frames[0]->top = 0;
	}
	native.cpu.runUntilDepth(0, 3); scalar.cpu.runUntilDepth(0, 3); requireParity(native, scalar);
	require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_METATABLE_LOOP && native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES
		&& native.cpu.activeThread()->frames[0]->top == 8 && native.cpu.readFrameRegister(0, 7) == native.cpu.readFrameRegister(0, 9),
		"SELF publishes its original receiver and top before a failing inherited lookup");
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETT), 0, 1, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETT), 3, 0, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions[0].wordCount = 4;
	CpuMachine nilNative(image), nilScalar(image, true);
	for (auto* m : {&nilNative, &nilScalar}) {
		auto* r = m->cpu.activeThread()->frames[0]->registers; r[0] = valueTable(m->cpu.createTable(2)); r[1] = valueNumber(1); r[2] = valueNumber(73);
		m->cpu.runUntilDepth(0, 500); r[1] = valueNil(); r[3] = valueNumber(19); m->cpu.activeThread()->frames[0]->top = 0;
	}
	nilNative.cpu.runUntilDepth(0, 5); nilScalar.cpu.runUntilDepth(0, 5); requireParity(nilNative, nilScalar);
	require(nilNative.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INDEX_NIL
		&& nilNative.cpu.readEpcWord() == nilNative.rom.textAddress + INSTRUCTION_BYTES && nilNative.cpu.readFrameRegister(0, 3) == valueNumber(19),
		"nil-key writes trap without mutating the table or a later read destination");
}

void wideAllocationFailure() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 63, 63);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::NEWT), 8, 63, 63, 63);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::MOV), 9, 8, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 16}, {.firstWord = 32, .wordCount = 1}};
	image.globalNames = {"retained"}; image.exceptionFunctionIndex = 1;
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) m->cpu.runUntilDepth(0, 100);
	requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& frame = *native.cpu.activeThread()->frames[0];
	const auto& block = frame.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->terminal.exit == NativeBlockExit::AllocateTable, "the WIDE allocator is a real typed native exit, not interpreter dispatch");
#endif
	for (auto* m : {&native, &scalar}) {
		auto& cpu = m->cpu; auto& root = *cpu.activeThread()->frames[0]; root.registers[8] = valueNumber(73); root.registers[9] = valueNil(); root.top = 0;
		const auto key = cpu.stringPool().find("retained"); auto* retained = cpu.createTable(350000); cpu.setGlobalByKey(*key, valueTable(retained));
	}
	native.cpu.runUntilDepth(0, 4); scalar.cpu.runUntilDepth(0, 4); requireParity(native, scalar);
	require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_OUT_OF_MEMORY
		&& native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES
		&& native.cpu.readFrameRegister(0, 8) == valueNumber(73) && native.cpu.activeThread()->frames[0]->top == 8,
		"failed allocation retains the precise prefix, original destination and WIDE EPC after collection");
}
} // namespace

int main() {
	try {
		genericArraysAndHashKeys(); inheritedArrayReads(false); inheritedArrayReads(true); storedLengthAndUtf8(); selfAndNilFaults(); wideAllocationFailure();
		std::cout << "Compiled table tests passed\n";
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
