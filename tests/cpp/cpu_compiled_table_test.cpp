#include "common/utf8.h"
#include "machine/cpu/cpu.h"
#include "machine/common/numeric.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace bmsx;

constexpr int NATIVE_WARM_SCALE = (NATIVE_BLOCK_COMPILATION_THRESHOLD + 7) / 8;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

struct CpuMachine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	CpuMachine(const test::Blua32TestImage& image, bool scalar = false, u32 bssByteCount = 0)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image, bssByteCount))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void requireParity(CpuMachine& native, CpuMachine& scalar) {
	auto& a = native.cpu; auto& b = scalar.cpu;
	require(a.lastPc == b.lastPc
		&& a.readCurrentInstructionPc() == b.readCurrentInstructionPc() && a.readCauseWord() == b.readCauseWord()
		&& a.readEpcWord() == b.readEpcWord() && a.readLuaFaultReasonWord() == b.readLuaFaultReasonWord(),
		"table operations retain exact execution and exception boundaries");
	const auto left = a.captureRuntimeState(), right = b.captureRuntimeState();
	require((left == right && bmsx::test::sameActiveLanguageRam(a, b))
		&& native.cpu.luaHeap().usedBytes() == scalar.cpu.luaHeap().usedBytes() && native.cpu.luaHeap().collectionTarget() == scalar.cpu.luaHeap().collectionTarget(),
		"complete value graphs and allocation/collection accounting agree");
	const auto& first = *a.activeThread(); const auto& second = *b.activeThread();
	require(first.frameDepth() == second.frameDepth() && first.stackTop() == second.stackTop(), "frame extents agree");
	const CallFrame* firstFrame = first.firstFrame; const CallFrame* secondFrame = second.firstFrame;
	for (size_t i = 0; i < first.frameDepth(); ++i, firstFrame = firstFrame->next, secondFrame = secondFrame->next) {
		const auto& x = *firstFrame; const auto& y = *secondFrame;
		require(x.readControl(bmsx::FrameField::Pc) == y.readControl(bmsx::FrameField::Pc) && static_cast<bmsx::i32>(x.readControl(bmsx::FrameField::Top)) == static_cast<bmsx::i32>(y.readControl(bmsx::FrameField::Top)) && x.stackBase() == y.stackBase() && x.stackCapacity() == y.stackCapacity(),
			"all live frame boundaries agree");
	}
}

void stringReadChainBoundaries() {
	for (const auto op : {OpCode::GETFIELD, OpCode::SELF, OpCode::GETT}) for (const int depth : {1, 2, 32, 33}) {
		test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 6, 9, 0);
		writeInstruction(image.text, 1, static_cast<u8>(op), 6, 6, op == OpCode::GETT ? 1 : 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 8, 6, 0);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord=0, .wordCount=4, .maxStack=10}, {.firstWord=32, .wordCount=1}};
		image.constants = {std::string("chain field")}; image.exceptionFunctionIndex = 1;
		CpuMachine native(image), scalar(image, true);
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			const auto key = cpu.stringPool().intern("chain field"), indexKey = cpu.stringPool().intern("__index");
			auto root = cpu.createTable(0, 1); auto current = root;
			for (int i = 1; i < depth; ++i) {
				auto next = cpu.createTable(0, 1); auto meta = cpu.createTable(0, 1);
				meta.setStringKey(indexKey, valueTable(next.address())); current.setMetatableAddress(meta.address()); current = next;
			}
			if (depth > 1) current.setStringKey(key, valueFromTag(ValueTag::False, 37));
			else {
				root.setMetatableAddress(cpu.createTable(0, 1).address());
			}
			TableLookupResult scratch{valueInteger(73), -1, 0, TableLookupStatus::Resolved};
			const auto before = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
			root.resolveStringIndex(indexKey, key, scratch);
			require((depth == 33 ? scratch.status == TableLookupStatus::ChainExhausted : scratch.status == TableLookupStatus::Resolved)
				&& (depth == 1 ? isNil(scratch.value) : depth == 33 || scratch.value == valueFromTag(ValueTag::False, 37)),
				"the table resolver preserves nil/false and the exact 32-table chain bound");
			require(cpu.luaHeap().usedBytes() == before.first
				&& cpu.luaHeap().collectionTarget() == before.second,
				"the resolver performs no tracked allocation or collection work");
			auto& frame = *cpu.activeThread()->frameAtDepth(0);
			frame.registers.set(1, valueString(key)); frame.registers.set(9, valueTable(root.address())); frame.registers.set(8, valueInteger(73));
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		native.cpu.prepareSystemNativeCode();
#endif
		for (const int grant : {0, 1, 2, 3, 4, 16}) {
			test::runCpuParity(native.cpu, scalar.cpu, grant); requireParity(native, scalar);
			if (native.cpu.isHaltedUntilIrq()) break;
		}
		require(native.cpu.isHaltedUntilIrq(), "short grants reach the same real HALT or exception-handler HALT");
		if (depth == 33) {
			require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_METATABLE_LOOP
				&& native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES
				&& native.cpu.readFrameRegister(0, 6) == native.cpu.readFrameRegister(0, 9)
				&& native.cpu.readFrameRegister(0, 8) == valueInteger(73),
				"chain exhaustion retains exact fault PC, aliased destination and unexecuted suffix");
			if (op == OpCode::SELF) require(native.cpu.readFrameRegister(0, 7) == native.cpu.readFrameRegister(0, 9),
				"failing SELF retains the receiver copied before its inherited lookup");
		} else require(native.cpu.readFrameRegister(0, 8) == (depth == 1 ? valueNil() : valueFromTag(ValueTag::False, 37)),
			"successful aliased reads commit their own raw result and suffix once");
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
		auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers;
		r.set(0, valueTable(m->cpu.createTable(4, 1).address())); r.set(1, valueInteger(1)); r.set(2, valueInteger(3));
	}
	test::runCpuParity(native.cpu, scalar.cpu, NATIVE_WARM_SCALE * 896);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 entry = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, entry);
	requireParity(native, scalar);
	const auto* block = page.nativeBlocks->entries[entry].get();
	require(block && block->sourceWords == 7, "generic keys, integer stores and length execute in the same native body");
	const auto region = block->region;
#endif
	for (auto* m : {&native, &scalar}) m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
	const auto field = native.cpu.stringPool().intern("field"), valueText = native.cpu.stringPool().intern("value");
	require(field == scalar.cpu.stringPool().intern("field") && valueText == scalar.cpu.stringPool().intern("value"), "matching runtime string ids");
	const std::array keys{valueInteger(1), valueInteger(2), valueInteger(4), valueInteger(5), valueInteger(0), valueFloat(-0.f),
		valueInteger(-7), valueFloat(1.f), valueFloat(1.5f), valueInteger(INT32_MAX), valueInteger(16777217), valueFloat(16777216.f), valueFloat(0x1p31f), valueFloat(0x1p32f),
		valueFloat(std::numeric_limits<float>::infinity()), valueFloat(-std::numeric_limits<float>::infinity()),
		valueBool(false), valueBool(true), valueString(field)};
	const std::array values{valueNil(), valueFromTag(ValueTag::False, 37), valueFromTag(ValueTag::True, 37),
		valueFloat(-0.f), valueFloatBits(0xffc01234u), valueFloat(std::numeric_limits<float>::infinity()), valueString(valueText)};
	for (const Value key : keys) for (const Value value : values) {
		for (auto* m : {&native, &scalar}) {
			auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers; r.set(1, key); r.set(2, value);
		}
		test::runCpuParity(native.cpu, scalar.cpu, 16);
		// Rebuilding can consume the grant before the loop's readback.
		for (u32 remaining = image.functions[0].wordCount;
			remaining > 0 && native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Pc) != native.rom.textAddress; --remaining)
			test::runCpuParity(native.cpu, scalar.cpu, 1);
		require(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Pc) == native.rom.textAddress,
			"readback completes within one seven-word loop");
		requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 3) == value && native.cpu.readFrameRegister(0, 5) == valueInteger(1),
			"all raw values survive generic array/hash access and the pending store source stays live");
	}
	for (auto* m : {&native, &scalar}) {
		auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers;
		r.set(1, valueTable(m->cpu.createTable().address())); r.set(2, valueTable(m->cpu.createTable().address()));
	}
	for (const int grant : {9, 1, 2, 1, 2, 1, 1, 1, 256}) {
		test::runCpuParity(native.cpu, scalar.cpu, grant); requireParity(native, scalar);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(page.nativeBlocks->entries[entry]->region == region, "table relocation and helper returns retain the original executable owner");
#endif
}

void inheritedTableFactsAreRecheckedOnCpuEntry() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 0, 1, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETI), 2, 0, 1);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::K1), 4, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::GETI), 3, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 5}, {.firstWord = 32, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	CpuMachine native(image), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		auto table = machine->cpu.createTable(2); table.setInteger(1, valueInteger(23));
		machine->cpu.activeThread()->frameAtDepth(0)->registers.set(1, valueTable(table.address()));
	}
	test::runCpuParity(native.cpu, scalar.cpu, NATIVE_WARM_SCALE * 900);
	const u32 pc = native.rom.textAddress;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 first = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, first);
	test::waitForNativeEntry(native.cpu, page, first + 2u);
	const auto& entry = page.nativeBlocks->entries[first + 2u];
	require(entry && page.nativeBlocks->entries[first]->region == entry->region,
		"the table continuation is an externally reachable native entry");
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueNil());
		machine->cpu.activeThread()->frameAtDepth(0)->registers.set(4, valueNil());
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc + 2u * INSTRUCTION_BYTES);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 1);
	requireParity(native, scalar);
	require(native.cpu.readFrameRegister(0, 4) == valueInteger(1) && native.cpu.readFramePc(0) == pc + 3u * INSTRUCTION_BYTES,
		"a failed entry guard executes an earlier unrelated instruction at its exact boundary");
	test::runCpuParity(native.cpu, scalar.cpu, 1);
	requireParity(native, scalar);
	require(native.cpu.readEpcWord() == pc + 3u * INSTRUCTION_BYTES,
		"a resumed entry rechecks its table fact before the original instruction faults");
}

void inheritedArrayReads(bool generic) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(generic ? OpCode::GETT : OpCode::GETI), 3, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 4, 3, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 5}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto& cpu = m->cpu; auto own = cpu.createTable(2), parent = cpu.createTable(2), meta = cpu.createTable(0, 1);
		parent.setInteger(1, valueInteger(73)); meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(parent.address())); own.setMetatableAddress(meta.address());
		auto& r = cpu.activeThread()->frameAtDepth(0)->registers; r.set(0, valueTable(own.address())); r.set(1, valueInteger(1)); cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 300);
	}
	for (const Value value : {valueBool(false), valueInteger(0), valueNil(), valueBool(true), valueInteger(19), valueNil()}) {
		for (auto* m : {&native, &scalar}) { asTable(m->cpu.readFrameRegister(0, 0), m->cpu.gcHeap()).setInteger(1, value); m->cpu.runUntilDepth(0, 6); }
		requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 3) == (isNil(value) ? valueInteger(73) : value), "only missing own slots traverse inheritance");
	}
}

void boundaryLengthAndUtf8() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 8, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETI), 0, 2, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::LEN), 3, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 4, 8, 3);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 9}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto table = m->cpu.createTable(2, 4); for (int i = 1; i <= 5; ++i) table.setInteger(i, valueInteger(i));
		auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers; r.set(0, valueTable(table.address())); r.set(2, valueInteger(2)); m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 605);
	}
	for (const Value value : {valueNil(), valueBool(false), valueNil(), valueInteger(2)}) {
		for (auto* m : {&native, &scalar}) { m->cpu.activeThread()->frameAtDepth(0)->registers.set(2, value); m->cpu.runUntilDepth(0, 11); }
		requireParity(native, scalar);
		const auto boundary = asInteger(native.cpu.readFrameRegister(0, 3));
		const TableRecord table = asTable(native.cpu.readFrameRegister(0, 0), native.cpu.gcHeap());
		require((boundary == 0 || !isNil(table.get(valueInteger(boundary)))) && isNil(table.get(valueInteger(boundary + 1))), "native LEN returns a valid boundary");
		if (!isNil(value)) require(boundary == 5, "native LEN finds the unique sequence boundary");
		require(native.cpu.readFrameRegister(0, 4) == valueInteger(boundary + 1), "the live definition survives the length helper");
	}
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::KSMI), 4, 0, 7);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 2, 1, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::LEN), 2, 2, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 3, 2, 4);
	CpuMachine textNative(image), textScalar(image, true);
	for (auto* m : {&textNative, &textScalar}) {
		m->cpu.activeThread()->frameAtDepth(0)->registers.set(1, valueString(m->cpu.stringPool().intern(std::string_view("A\xc3\xa9\xe9\x9b\xaa\0\xf0\x9f\x98\x80", 11))));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 500);
	}
	requireParity(textNative, textScalar);
	require(textNative.cpu.readFrameRegister(0, 2) == valueInteger(11) && textNative.cpu.readFrameRegister(0, 3) == valueInteger(18),
		"the string-count native ABI retains pending values and byte counts including NUL");
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
		auto& cpu = m->cpu; auto table = cpu.createTable(0, 1); table.setStringKey(cpu.stringPool().intern("method"), valueInteger(73));
		cpu.activeThread()->frameAtDepth(0)->registers.set(9, valueTable(table.address())); cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 300);
		auto meta = cpu.createTable(0, 1); table.setStringKey(cpu.stringPool().intern("method"), valueNil());
		meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(table.address())); table.setMetatableAddress(meta.address());
		cpu.activeThread()->frameAtDepth(0)->writeControl(bmsx::FrameField::Top, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 3); requireParity(native, scalar);
	require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_METATABLE_LOOP && native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES
		&& static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Top)) == 8 && native.cpu.readFrameRegister(0, 7) == native.cpu.readFrameRegister(0, 9),
		"SELF publishes its original receiver and top before a failing inherited lookup");
	require(native.cpu.readFrameRegister(0, 6) == native.cpu.readFrameRegister(0, 9),
		"failed inherited lookup leaves the method destination unchanged");
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETT), 0, 1, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETT), 3, 0, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions[0].wordCount = 4;
	CpuMachine nilNative(image), nilScalar(image, true);
	for (auto* m : {&nilNative, &nilScalar}) {
		auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers; r.set(0, valueTable(m->cpu.createTable(2).address())); r.set(1, valueInteger(1)); r.set(2, valueInteger(73));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 504); r.set(1, valueNil()); r.set(3, valueInteger(19)); m->cpu.activeThread()->frameAtDepth(0)->writeControl(bmsx::FrameField::Top, 0);
	}
	nilNative.cpu.runUntilDepth(0, 5); nilScalar.cpu.runUntilDepth(0, 5); requireParity(nilNative, nilScalar);
	require(nilNative.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INDEX_NIL
		&& nilNative.cpu.readEpcWord() == nilNative.rom.textAddress + INSTRUCTION_BYTES && nilNative.cpu.readFrameRegister(0, 3) == valueInteger(19),
		"nil-key writes trap without mutating the table or a later read destination");
}

// Reuse the same SELF, CALL and RET sites as a script switches between an
// inherited method and an instance override. Each method returns (self, field).
void methodCallReturnsOriginalReceiver() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CLOSURE), 1, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::SELF), 4, 4, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::CALL), 4, 2, 3);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::MOV), 3, 5, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
	for (u32 i = 0; i < 2; ++i) {
		writeInstruction(image.text, 16 + 2 * i, static_cast<u8>(OpCode::GETFIELD), 1, 0, 1 + i);
		writeInstruction(image.text, 17 + 2 * i, static_cast<u8>(OpCode::RET), 0, 3, 0);
	}
	image.functions = {{.firstWord=0, .wordCount=8, .maxStack=8}, {.firstWord=16, .wordCount=2, .numParams=1, .maxStack=2},
		{.firstWord=18, .wordCount=2, .numParams=1, .maxStack=2}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)},
		{3, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};
	image.constants = {std::string("method"), std::string("fromParent"), std::string("fromOwn")};
	CpuMachine native(image), scalar(image, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 2 * BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)]);
	const Value inherited = valueFloatBits(0xffc01234u), overridden = valueInteger(-37);
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto& r = cpu.activeThread()->currentFrame->registers;
		auto obj = cpu.createTable(0, 4); auto parent = cpu.createTable(0, 1); auto meta = cpu.createTable(0, 1);
		parent.setStringKey(*cpu.stringPool().find("method"), r.get(0));
		meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(parent.address()));
		obj.setMetatableAddress(meta.address());
		obj.setStringKey(*cpu.stringPool().find("fromParent"), inherited);
		obj.setStringKey(*cpu.stringPool().find("fromOwn"), overridden);
		r.set(2, valueTable(obj.address()));
	}
	for (const bool step : {false, true}) for (const bool own : {false, true, false}) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu; auto& r = cpu.activeThread()->currentFrame->registers;
			asTable(r.get(2), cpu.gcHeap()).setStringKey(*cpu.stringPool().find("method"), own ? r.get(1) : valueNil());
			r.set(4, r.get(2)); r.set(3, valueNil());
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 4 * INSTRUCTION_BYTES);
		}
		if (step) {
			test::runCpuParity(native.cpu, scalar.cpu, 1);
			test::runCpuParity(native.cpu, scalar.cpu, 1);
			requireParity(native, scalar);
			require(native.cpu.getFrameDepth() == 2 && native.cpu.readFrameRegister(1, 0) == native.cpu.readFrameRegister(0, 2),
				"method receives the instance, not the table which supplied the closure");
			test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
			requireParity(native, scalar);
			require(isNil(native.cpu.readFrameRegister(0, 3)), "RET stops at the requested depth before the caller consumes the result");
		}
		test::runCpuParity(native.cpu, scalar.cpu, 200); requireParity(native, scalar);
		require(native.cpu.getFrameDepth() == 1 && native.cpu.readFrameRegister(0, 4) == native.cpu.readFrameRegister(0, 2)
			&& native.cpu.readFrameRegister(0, 5) == (own ? overridden : inherited)
			&& native.cpu.readFrameRegister(0, 3) == native.cpu.readFrameRegister(0, 5),
			"the selected closure returns both the original receiver and its exact tagged field to the caller");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& page = *native.cpu.activeThread()->currentFrame->decodedPage;
	const auto first = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	// SELF, its CALL continuation and both methods share this mapped page.
	for (const auto word : {4u, 5u, 16u, 18u}) test::waitForNativeEntry(native.cpu, page, first + word);
#endif
}

void iterationChargeIgnoresVacantCapacity() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::CALL), 0, 3, 3);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::K1), 3, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 4}};
	for (const int capacity : {1, 1024}) {
		CpuMachine generated(image), scalar(image, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		generated.cpu.prepareSystemNativeCode();
#endif
		for (const Value after : {valueNil(), valueInteger(1)}) {
			for (auto* machine : {&generated, &scalar}) {
				auto& cpu = machine->cpu;
				auto table = cpu.createTable(capacity, capacity);
				table.setInteger(1, valueBool(false));
				auto registers = cpu.activeThread()->currentFrame->registers;
				registers.set(0, valueBuiltinFunction(BuiltinFunctionId::Next));
				registers.set(1, valueTable(table.address()));
				registers.set(2, after);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
			}
			test::runCpuParity(generated.cpu, scalar.cpu, 1);
			requireParity(generated, scalar);
			require(generated.cpu.instructionBudgetRemaining == 1 - 32 - 1 - 2
				&& generated.cpu.readFramePc(0) == generated.rom.textAddress + INSTRUCTION_BYTES
				&& isNil(generated.cpu.readFrameRegister(0, 3)), "next pays the same call and receiving range without charging vacant capacity");
			require(generated.cpu.readFrameRegister(0, 0) == (isNil(after) ? valueInteger(1) : valueNil())
				&& generated.cpu.readFrameRegister(0, 1) == (isNil(after) ? valueBool(false) : valueNil()),
				"next returns the own mapping or exhaustion, not a traversal count");
		}
	}
}

void allocationChargesRequestedCapacity() {
	for (const bool wide : {false, true}) {
		test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
		u32 word = 0;
		if (wide) writeInstruction(image.text, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, word++, static_cast<u8>(OpCode::NEWT), 0, 2, 3, wide ? 1 : 0);
		const u32 successor = word;
		writeInstruction(image.text, word++, static_cast<u8>(OpCode::K1), 1, 0, 0);
		writeInstruction(image.text, word, static_cast<u8>(OpCode::JMP), 0, 63, 63 - word, 255);
		image.functions = {{.firstWord = 0, .wordCount = word + 1, .maxStack = 2}};
		CpuMachine native(image), scalar(image, true);
		const int hash = wide ? 67 : 3;
		const int cycles = BASE_CYCLES[static_cast<u8>(OpCode::NEWT)] + 2 + 2 * hash;
		const int loopCycles = cycles + BASE_CYCLES[static_cast<u8>(OpCode::K1)] + BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
		test::runCpuParity(native.cpu, scalar.cpu, loopCycles * NATIVE_WARM_SCALE * 34);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto& page = *native.cpu.activeThread()->currentFrame->decodedPage;
		const auto index = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		test::waitForNativeEntry(native.cpu, page, index);
		require(page.nativeBlocks->entries[index]->terminal.exit == NativeBlockExit::AllocateTable,
			"the charge is tested through the native allocation exit");
#endif
		for (auto* machine : {&native, &scalar}) {
			machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
			machine->cpu.activeThread()->currentFrame->registers.set(1, valueNil());
		}
		test::runCpuParity(native.cpu, scalar.cpu, 1);
		requireParity(native, scalar);
		require(native.cpu.instructionBudgetRemaining == 1 - cycles
			&& native.cpu.readFramePc(0) == native.rom.textAddress + successor * INSTRUCTION_BYTES
			&& isNil(native.cpu.readFrameRegister(0, 1)), "successful NEWT charges only the requests and stops before the successor");
		const auto table = asTable(native.cpu.readFrameRegister(0, 0), native.cpu.gcHeap());
		require(table.arrayCapacity() == 2 && table.hashSlots() > static_cast<u32>(hash), "actual hash storage is rounded independently of the charge");
	}
}

void wideAllocationFailure() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 63, 63);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::NEWT), 8, 63, 63, 63);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::MOV), 9, 8, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	// The reserved exception frame also needs one value slot. Requesting 15
	// registers leaves that slot in the existing 16-slot backing block.
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 15}, {.firstWord = 32, .wordCount = 1}};
	image.globalNames = {"retained"}; image.exceptionFunctionIndex = 1;
	CpuMachine native(image), scalar(image, true);
	for (int visit = 0; visit < NATIVE_WARM_SCALE * 32; ++visit) test::runCpuParity(native.cpu, scalar.cpu, 1);
	requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
	test::waitForNativeEntry(native.cpu, *frame.decodedPage, (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	requireParity(native, scalar);
	const auto& block = frame.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->terminal.exit == NativeBlockExit::AllocateTable, "the WIDE allocator is a real typed native exit, not interpreter dispatch");
#endif
	for (auto* m : {&native, &scalar}) {
		auto& cpu = m->cpu; auto& root = *cpu.activeThread()->frameAtDepth(0); root.registers.set(8, valueInteger(73)); root.registers.set(9, valueNil()); root.writeControl(bmsx::FrameField::Top, 9);
		const auto key = cpu.stringPool().find("retained"); auto retained = cpu.createTable(690000); cpu.setGlobalByKey(*key, valueTable(retained.address()));
		cpu.collectHeap();
	}
	test::runCpuParity(native.cpu, scalar.cpu, BASE_CYCLES[static_cast<u8>(OpCode::K1)] + BASE_CYCLES[static_cast<u8>(OpCode::NEWT)]); requireParity(native, scalar);
	require(native.cpu.instructionBudgetRemaining == 0, "failed NEWT pays prefix and base, not emergency collection or initialization");
	require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_OUT_OF_MEMORY
		&& native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES
		&& native.cpu.readFrameRegister(0, 8) == valueInteger(73) && static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Top)) == 9,
		"failed allocation retains the precise prefix, original destination and WIDE EPC after collection");
}
void observedArithmeticResumesAtItsOwnInstruction() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETFIELD), 9, 6, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::K1), 10, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::SUB), 8, 9, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::SETFIELD), 6, 0, 8);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 11}, {.firstWord = 16, .wordCount = 1}};
	image.constants = {std::string("x")}; image.exceptionFunctionIndex = 1;
	CpuMachine native(image), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		auto table = cpu.createTable(0, 1);
		table.setStringKey(*cpu.stringPool().find("x"), valueInteger(10));
		frame.registers.set(6, valueTable(table.address())); frame.registers.set(1, valueInteger(0));
	}
	test::runCpuParity(native.cpu, scalar.cpu, NATIVE_WARM_SCALE * 640);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 first = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, first);
	const auto warm = page.words[first + 2u].nativeNumericTypes();
	require(warm.left == ValueTag::Integer && warm.right == ValueTag::Integer && warm.stable(),
		"native warm-up records the actual operands without widening decoded instructions");
#endif
	const int grant = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)] + BASE_CYCLES[static_cast<u8>(OpCode::K1)]
		+ BASE_CYCLES[static_cast<u8>(OpCode::SUB)] + BASE_CYCLES[static_cast<u8>(OpCode::SETFIELD)];
	for (const Value step : {valueInteger(2), valueFloat(0.5f), valueBool(false)}) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
			auto& frame = *cpu.activeThread()->frameAtDepth(0);
			asTable(frame.registers.get(6), cpu.gcHeap()).setStringKey(*cpu.stringPool().find("x"), valueInteger(10));
			frame.registers.set(1, step); frame.registers.set(8, valueInteger(73)); frame.registers.set(10, valueNil());
		}
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		auto& cpu = native.cpu;
		const auto table = asTable(cpu.readFrameRegister(0, 6), cpu.gcHeap());
		const auto x = table.getStringKey(*cpu.stringPool().find("x"));
		if (step == valueBool(false)) {
			require(cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT
				&& cpu.readEpcWord() == native.rom.textAddress + 2u * INSTRUCTION_BYTES
				&& cpu.readFrameRegister(0, 8) == valueInteger(73) && x == valueInteger(10),
				"a non-Number faults at SUB without changing its destination or the field");
		} else {
			const auto wanted = step == valueInteger(2) ? valueInteger(8) : valueFloat(9.5f);
			require(x == wanted && scalar.cpu.readFrameRegister(0, 8) == wanted && cpu.readFrameRegister(0, 10) == valueInteger(1)
				&& cpu.readFramePc(0) == native.rom.textAddress + 4u * INSTRUCTION_BYTES,
				"the field update preserves scalar results and the exact next PC across a type change");
		}
	}
}

void contradictoryOwnFieldProofRetiresItsSource() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::JMPIF), 6, 0, 4);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETFIELD), 3, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::SUB), 4, 3, 1);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::K1), 5, 0, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.constants = {std::string("observed field")};
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 7}};
	CpuMachine native(image), scalar(image, true);
	const u32 start = native.rom.textAddress + INSTRUCTION_BYTES;
	const u32 arithmetic = start + 2u * INSTRUCTION_BYTES, suffix = arithmetic + 2u * INSTRUCTION_BYTES;
	const int fieldCharge = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)];
	const int arithmeticCharge = BASE_CYCLES[static_cast<u8>(OpCode::SUB)];
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		const auto key = *cpu.stringPool().find("observed field");
		auto receiver = cpu.createTable(0, 1), forwarded = cpu.createTable(0, 1);
		auto holder = cpu.createTable(0, 1), meta = cpu.createTable(0, 1);
		holder.setStringKey(key, valueFloat(12.5f));
		meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(holder.address()));
		forwarded.setMetatableAddress(meta.address());
		auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
		registers.set(0, valueTable(receiver.address())); registers.set(1, valueInteger(2));
		registers.set(2, valueTable(forwarded.address())); registers.set(6, valueTable(receiver.address()));
	}
	const auto read = [&](Value field, Value expected, bool forwarded, bool shortGrant) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
			auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
			asTable(registers.get(6), cpu.gcHeap()).setStringKey(*cpu.stringPool().find("observed field"), field);
			registers.set(0, registers.get(forwarded ? 2 : 6));
			registers.set(4, valueInteger(73)); registers.set(5, valueInteger(99));
		}
		const int charged = fieldCharge + (forwarded ? TABLE_INDEX_VISIT_CYCLES : 0) + arithmeticCharge;
		const int grant = charged - (shortGrant ? arithmeticCharge - 1 : 0);
		require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded, "the grant stops before the suffix");
		require(native.cpu.readFrameRegister(0, 4) == expected && native.cpu.readFrameRegister(0, 5) == valueInteger(99)
			&& native.cpu.instructionBudgetRemaining == grant - charged && native.cpu.readCurrentInstructionPc() == arithmetic
			&& native.cpu.lastPc == arithmetic + INSTRUCTION_BYTES && native.cpu.readFramePc(0) == suffix,
			"own results and delegated reads complete with the same exact WIDE frontier and charge");
		requireParity(native, scalar);
	};
	for (int visit = 0; visit < 16; ++visit) read(valueInteger(12), valueInteger(10), false, false);

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 entry = (start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto installed = [&] { return page.nativeBlocks && page.nativeBlocks->entries[entry]; };
	require(installed() && page.nativeBlocks->entries[entry]->admissionCycles == fieldCharge
		&& page.nativeBlocks->entries[entry]->terminal.currentPc == arithmetic,
		"the two WIDE instructions are genuinely published in one admitted specializable region");
#endif
	for (int visit = 0; visit < 5; ++visit) read(valueInteger(12), valueFloat(10.5f), true, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(installed(), "a different metatable's result does not count as a contradictory own field");
	read(valueFloat(12.5f), valueFloat(10.5f), false, true);
	require(installed(), "one contradictory own result does not withdraw the region");
	for (int visit = 0; visit < 8 && installed(); ++visit) read(valueFloat(12.5f), valueFloat(10.5f), false, true);
	require(!installed(), "only repeated contradictory own results withdraw the region");

	// Restore the original arithmetic profile via real integer executions.
	// The old field proof must not return merely because the consumer still
	// benefits from arithmetic specialization; it now guards at its own PC.
	for (int visit = 0; visit < 10; ++visit) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], arithmetic);
			cpu.activeThread()->frameAtDepth(0)->registers.set(3, valueInteger(12));
		}
		test::runCpuParity(native.cpu, scalar.cpu, arithmeticCharge);
	}
	const auto types = page.words[entry + 2u].nativeNumericTypes();
	require(types.stable() && types.left == ValueTag::Integer, "the real arithmetic profile still prefers integers");
	native.cpu.prepareSystemNativeCode();
	require(installed(), "updated field policy does not prevent native compilation");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& exits = native.cpu.nativeGateProfile().exits;
	const auto fieldMisses = exits[static_cast<size_t>(NativeBlockExit::ReadField)].entries;
	const auto replayExits = exits[static_cast<size_t>(NativeBlockExit::ScalarBoundary)].entries;
#endif
	read(valueFloat(12.5f), valueFloat(10.5f), false, true);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(exits[static_cast<size_t>(NativeBlockExit::ReadField)].entries == fieldMisses
		&& exits[static_cast<size_t>(NativeBlockExit::ScalarBoundary)].entries == replayExits + 1,
		"the live field stays on its native own read while arithmetic, not the field, checks the subtype");
#endif
#endif
}

void stringStoreGrowthRoots(bool generic, bool full) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 7, 9, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::KNIL), 9, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(generic ? OpCode::SETT : OpCode::SETFIELD), 0, generic ? 1 : 0, 7);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 16}};
	image.constants = {std::string("field")};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers;
		r.set(0, valueTable(m->cpu.createTable(0, 1).address())); r.set(1, valueString(m->cpu.stringPool().intern("field"))); r.set(9, valueInteger(1));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 500);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, word);
	requireParity(native, scalar);
	const auto& block = page.nativeBlocks->entries[word];
	require(block != nullptr, "growing string store starts from adopted native code");
#endif
	for (auto* m : {&native, &scalar}) {
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); auto& r = frame.registers;
		auto& strings = m->cpu.stringPool(); auto retained = m->cpu.createTable(0, 1);
		retained.setStringKey(strings.intern("payload"), valueString(strings.intern("retained")));
		auto receiver = m->cpu.createTable(0, full ? 1 : 0);
		if (full) receiver.setStringKey(strings.intern("resident"), valueInteger(71));
		r.set(0, valueTable(receiver.address())); r.set(9, valueTable(retained.address())); frame.writeControl(bmsx::FrameField::Top, 0);
		const auto heap = std::pair{m->cpu.luaHeap().usedBytes(), m->cpu.luaHeap().collectionTarget()};
		m->cpu.luaHeap().setCollectionTarget(heap.first);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 3); requireParity(native, scalar);
	for (size_t i = 0; i < 2; ++i) {
		auto& machine = i == 0 ? native : scalar;
		require(machine.cpu.readFramePc(0) == machine.rom.textAddress + 2u * INSTRUCTION_BYTES
			&& !machine.cpu.collecting(),
			"an exhausted grant stops before the store and its possible collection");
	}
	test::runCpuParity(native.cpu, scalar.cpu, 1); requireParity(native, scalar);
	for (auto* m : {&native, &scalar}) {
		auto& strings = m->cpu.stringPool();
		auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers; auto retained = asTable(r.get(7), m->cpu.gcHeap());
		require(m->cpu.collecting() && m->memory.readRamRecordByte(retained.address() + GC_COLOR_OFFSET) == 3, "the hash growth assist traced the moved reference");
		m->cpu.collectHeap();
		require(retained.getStringKey(*strings.find("payload")) == valueString(*strings.find("retained")),
			"growth sees all reference roots published by the completed native prefix");
		auto receiver = asTable(r.get(0), m->cpu.gcHeap());
		require(receiver.getStringKey(*strings.find("field")) == r.get(7), "growth commits the requested reference store once");
		if (full) require(receiver.getStringKey(*strings.find("resident")) == valueInteger(71), "growth preserves the occupied hash slot");
	}
}

void nativeFieldOperationsLearnTheDecodedSite() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETFIELD), 1, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETFIELD), 0, 1, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 3}};
	image.constants = {std::string("read"), std::string("write")};
	CpuMachine prepared(image), scalar(image, true);
	for (auto* machine : {&prepared, &scalar}) {
		auto& cpu = machine->cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		auto table = cpu.createTable(0, 2);
		table.setStringKey(*cpu.stringPool().find("read"), valueInteger(73));
		table.setStringKey(*cpu.stringPool().find("write"), valueInteger(5));
		frame.registers.set(0, valueTable(table.address()));
		frame.registers.set(2, valueInteger(41));
		frame.setTop(3);
	}
	auto& cpu = prepared.cpu;
	const u32 pc = prepared.rom.textAddress, word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto& activeImage = *cpu.activeThread()->frameAtDepth(0)->executionImage;
	cpu.prepareSystemNativeCode();
	auto& page = *activeImage.nativeCodeLookup->find(pc, 0);
	require(page.nativeBlocks->entries[word] && page.nativeBlocks->entries[word + 1],
		"both cold operations have independent generated entries");
	require(page.words[word].tableCacheSlot() == -1 && page.words[word + 1].tableCacheSlot() == -1,
		"preparation observes no table layout");
	const int grant = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)] + BASE_CYCLES[static_cast<u8>(OpCode::SETFIELD)];
	require(test::runCpuParity(cpu, scalar.cpu, grant) == RunResult::Yielded, "the two indexed operations complete exactly");
	requireParity(prepared, scalar);
	const auto table = asTable(cpu.readFrameRegister(0, 0), cpu.gcHeap());
	int readSlot = -1, writeSlot = -1;
	require(table.getStringKeyCached(*cpu.stringPool().find("read"), readSlot) == valueInteger(73)
		&& table.getStringKeyCached(*cpu.stringPool().find("write"), writeSlot) == valueInteger(41)
		&& readSlot >= 0 && writeSlot >= 0, "the actual own record contains both live values");
	require(page.words[word].tableCacheSlot() == readSlot && page.words[word + 1].tableCacheSlot() == writeSlot,
		"successful native lookups train the same source slots used by scalar execution and compilation");
	page.retireNativeBlocks();
	cpu.prepareSystemNativeCode();
	const auto& read = page.nativeBlocks->entries[word]->sideExits.front().tableRead;
	const auto& write = page.nativeBlocks->entries[word + 1]->sideExits.front().tableStore;
	require(read.own.decoded == &page.words[word].tableCacheSlot()
		&& write.decoded == &page.words[word + 1].tableCacheSlot(),
		"recompilation borrows the learned sites instead of creating independent writable seeds");
#endif
}

void coldRepeatedFieldsRecompileTheirSource() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETFIELD), 1, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 4, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::GETFIELD), 2, 4, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::K1), 5, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 6}};
	image.constants = {std::string("field")};
	CpuMachine native(image), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		auto table = cpu.createTable(0, 1);
		table.setStringKey(*cpu.stringPool().find("field"), valueInteger(41));
		frame.registers.set(0, valueTable(table.address()));
		frame.registers.set(5, valueInteger(73));
		frame.setTop(6);
	}
	auto& cpu = native.cpu;
	const auto& frame = *cpu.activeThread()->frameAtDepth(0);
	const u32 pc = native.rom.textAddress, word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	cpu.prepareSystemNativeCode();
	auto& page = *frame.executionImage->nativeCodeLookup->find(pc, 0);
	const auto& coldFirst = page.nativeBlocks->entries[word];
	const auto& coldSecond = page.nativeBlocks->entries[word + 1];
	require(coldFirst && coldSecond && coldFirst->terminal.currentPc == pc
		&& coldSecond->terminal.currentPc == pc + 2 * INSTRUCTION_BYTES,
		"the two cold reads start at separate generated checkpoints");
	require(page.words[word].tableCacheSlot() == -1 && page.words[word + 2].tableCacheSlot() == -1,
		"neither cold read starts with a trained own slot");
	const int grant = 2 * BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)] + BASE_CYCLES[static_cast<u8>(OpCode::MOV)];
	require(test::runCpuParity(cpu, scalar.cpu, grant) == RunResult::Yielded, "cold reads use exactly the requested grant");
	requireParity(native, scalar);
	require(cpu.readFramePc(0) == pc + 4 * INSTRUCTION_BYTES && cpu.lastPc == pc + 3 * INSTRUCTION_BYTES
		&& cpu.readFrameRegister(0, 1) == valueInteger(41) && cpu.readFrameRegister(0, 2) == valueInteger(41)
		&& cpu.readFrameRegister(0, 5) == valueInteger(73),
		"learning does not replay either read or execute the successor early");
	require(page.words[word].tableCacheSlot() >= 0 && page.words[word].tableCacheSlot() == page.words[word + 2].tableCacheSlot(),
		"both executed own reads learned the same owner slot");
	test::waitForNativeEntry(cpu, page, word);
	const auto& optimized = page.nativeBlocks->entries[word];
	require(optimized && optimized->sideExits.size() == 2 && optimized->terminal.currentPc == pc + 5 * INSTRUCTION_BYTES,
		"native feedback replaces the source root with both checked reads and the suffix in one entry");
	for (auto* machine : {&native, &scalar})
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
	require(test::runCpuParity(cpu, scalar.cpu, grant + 10) == RunResult::Halted, "the replacement executes the whole source");
	requireParity(native, scalar);
	require(cpu.readFrameRegister(0, 5) == valueInteger(1), "the replacement executes the ordinary successor");
#endif
}

void warmInheritedFieldReadsKeepTheirFrame() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 3, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETFIELD), 6, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.constants = {std::string("inherited word")};
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8}};
	CpuMachine native(image), scalar(image, true);
	const u32 start = native.rom.textAddress, field = start + INSTRUCTION_BYTES, suffix = field + 2u * INSTRUCTION_BYTES;
	const int prefix = BASE_CYCLES[static_cast<u8>(OpCode::K1)];
	const int total = prefix + BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)] + TABLE_INDEX_VISIT_CYCLES;
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto receiver = cpu.createTable(), meta = cpu.createTable(0, 1), holder = cpu.createTable(0, 1);
		meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(holder.address()));
		holder.setStringKey(*cpu.stringPool().find("inherited word"), valueInteger(41));
		receiver.setMetatableAddress(meta.address());
		auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
		registers.set(0, valueTable(receiver.address()));
		registers.set(1, valueTable(holder.address()));
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
#endif
	require(test::runCpuParity(native.cpu, scalar.cpu, total) == RunResult::Yielded
		&& native.cpu.readFrameRegister(0, 6) == valueInteger(41), "the ordinary inherited read trains its one-hop cache");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const auto& entry = page.nativeBlocks->entries[(start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(entry && entry->admissionCycles == prefix && entry->terminal.currentPc == field
		&& entry->sideExits[0].tableRead.path.holderDepth == 1,
		"the installed entry has a trained one-hop proof, not just a generic table exit");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& readExits = native.cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::ReadField)];
	const auto initialExits = readExits.entries;
#endif
#endif
	for (int grant : {prefix + 1, total}) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
			auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
			registers.set(3, valueInteger(73));
			registers.set(6, valueInteger(99)); registers.set(7, valueInteger(99));
		}
		require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded, "one hop stops at the suffix");
		require(native.cpu.readFrameRegister(0, 3) == valueInteger(1)
			&& native.cpu.readFrameRegister(0, 6) == valueInteger(41),
			"the inherited probe returns its own table value and preserves the preceding register definition");
		require(native.cpu.readCurrentInstructionPc() == field && native.cpu.lastPc == field + INSTRUCTION_BYTES
			&& native.cpu.readFramePc(0) == suffix && native.cpu.instructionBudgetRemaining == grant - total
			&& native.cpu.readFrameRegister(0, 7) == valueInteger(99), "the WIDE read charges one hop and publishes the exact frontier");
		requireParity(native, scalar);
	}
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(readExits.entries == initialExits, "the trained one-hop read completes in-frame with a live register definition");
#endif
}

void resolvedFieldKeepsPendingFixedCallsUntilAnObserver() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(3 * MAPPED_PAGE_BYTE_SIZE);
	constexpr u32 parent = 16, trap = 32, middle = DECODED_PAGE_WORDS, leaf = 2 * DECODED_PAGE_WORDS;
	const auto emit = [&](u32 word, OpCode op, u32 a = 0, u32 b = 0, u32 c = 0) {
		writeInstruction(image.text, word, static_cast<u8>(op), a, b, c);
	};
	emit(0, OpCode::WIDE);
	emit(1, OpCode::CLOSURE, 8);
	emit(2, OpCode::WIDE);
	emit(3, OpCode::CLOSURE, 9);
	emit(4, OpCode::HALT);
	emit(5, OpCode::RET, 0, 1);
	emit(parent, OpCode::CALL, 0, 3, 2);
	emit(parent + 1, OpCode::HALT);
	emit(parent + 2, OpCode::RET, 0, 1);
	emit(trap, OpCode::HALT);
	emit(trap + 1, OpCode::RFE);
	emit(middle, OpCode::CALL, 0, 2, 2);
	emit(middle + 1, OpCode::RET, 0, 2);
	emit(leaf, OpCode::WIDE);
	emit(leaf + 1, OpCode::GETFIELD, 3, 0, 0);
	emit(leaf + 2, OpCode::RET, 3, 2);
	image.functions = {{.firstWord=0, .wordCount=6, .maxStack=16},
		{.firstWord=parent, .wordCount=3, .maxStack=16}, {.firstWord=trap, .wordCount=2},
		{.firstWord=middle, .wordCount=2, .numParams=2, .maxStack=2},
		{.firstWord=leaf, .wordCount=3, .numParams=1, .maxStack=4}};
	image.exceptionFunctionIndex = 2;
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 3)},
		{3, test::blua32TestFunctionAddress(RomImageDomain::System, 4)}};
	image.constants = {std::string("nested inherited field")};

	CpuMachine native(image), scalar(image, true);
	auto& cpu = native.cpu;
	cpu.prepareSystemNativeCode();
	require(test::runCpuParity(cpu, scalar.cpu, 100) == RunResult::Halted, "boot retains both verified closures");
	for (auto* machine : {&native, &scalar}) {
		auto& owner = machine->cpu;
		const auto index = owner.stringPool().intern("__index");
		auto holder = owner.createTable(0, 1);
		holder.setStringKey(*owner.stringPool().find("nested inherited field"), valueInteger(41));
		// Two hops always exercise the runtime resolver, including after the
		// one-hop generated probe learns that this path has a deeper holder.
		for (int depth = 0; depth < 2; ++depth) {
			auto receiver = owner.createTable(), meta = owner.createTable(0, 1);
			meta.setStringKey(index, valueTable(holder.address()));
			receiver.setMetatableAddress(meta.address());
			holder = receiver;
		}
		owner.activeThread()->currentFrame->registers.set(10, valueTable(holder.address()));
	}
	const auto restart = [&](bool invalid = false) {
		for (auto* machine : {&native, &scalar}) {
			auto& owner = machine->cpu;
			owner.clearHaltUntilIrq();
			auto& frame = *owner.activeThread()->currentFrame;
			frame.registers.set(0, frame.registers.get(8));
			frame.registers.set(1, frame.registers.get(9));
			frame.registers.set(2, invalid ? valueInteger(19) : frame.registers.get(10));
			frame.registers.set(5, valueInteger(73));
			frame.setTop(11);
			owner.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[1],
				machine->rom.textAddress + parent * INSTRUCTION_BYTES);
		}
	};
	restart();
	require(test::runCpuParity(cpu, scalar.cpu, 200) == RunResult::Halted, "learn both CALL targets and prepare retained frame views");
	const u32 text = native.rom.textAddress, leafPc = text + leaf * INSTRUCTION_BYTES;
	auto& thread = *cpu.activeThread();
	auto& lookup = *thread.currentFrame->executionImage->nativeCodeLookup;
	for (auto [instruction, function] : {std::pair{parent, 3u}, std::pair{middle, 4u}}) {
		const u32 pc = text + instruction * INSTRUCTION_BYTES, word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		auto& page = *lookup.find(pc, 0);
		const auto& block = page.nativeBlocks->entries[word];
		require(block && page.words[word].nativeCallTarget() == native.rom.functionAddresses[function], "the real CALLs have observed fixed targets");
		const auto region = block->region;
		page.retireNativeRegion(region.get(), DecodedInstructionPage::Retirement::Capacity);
	}
	cpu.prepareSystemNativeCode();
	for (const u32 instruction : {parent, middle}) {
		const u32 pc = text + instruction * INSTRUCTION_BYTES, word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		const auto& block = lookup.find(pc, 0)->nativeBlocks->entries[word];
		require(block && block->terminal.operands.call.strategy == NativeCallStrategy::Fixed, "both frames can stay pending");
	}
	const auto& leafBlock = lookup.find(leafPc, 0)->nativeBlocks->entries[(leafPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	const auto fieldExit = std::ranges::find(leafBlock->sideExits, NativeBlockExit::ReadField, &NativeBlockExitSite::exit);
	require(fieldExit != leafBlock->sideExits.end() && fieldExit->currentPc == leafPc
		&& fieldExit->continuationCells[0] && *fieldExit->continuationCells[0], "the WIDE semantic lookup has a live native successor");

	// Physical control words outside frameDepth are private scratch. An
	// activation that returns before a real observer never writes that record.
	constexpr u32 middleScratchPc = 0x10203040, leafScratchPc = 0x20304050;
	restart();
	thread.frameAtDepth(1)->writeControl(FrameField::Pc, middleScratchPc);
	thread.frameAtDepth(2)->writeControl(FrameField::Pc, leafScratchPc);
	require(test::runCpuParity(cpu, scalar.cpu, 200) == RunResult::Halted && thread.frameDepth() == 1
		&& cpu.readFrameRegister(0, 0) == valueInteger(41), "the result crosses both native returns before the caller halts");
	require(thread.frameAtDepth(1)->readControl(FrameField::Pc) == middleScratchPc
		&& thread.frameAtDepth(2)->readControl(FrameField::Pc) == leafScratchPc,
		"the resolved native read did not publish either frame before it returned");
	requireParity(native, scalar);

	const int calls = 2 * BASE_CYCLES[static_cast<u8>(OpCode::CALL)];
	const int field = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)];
	const int total = calls + field + 2 * TABLE_INDEX_VISIT_CYCLES;
	for (const int grant : {total - 1, total}) {
		restart();
		require(test::runCpuParity(cpu, scalar.cpu, grant) == RunResult::Yielded
			&& cpu.instructionBudgetRemaining == grant - total && thread.frameDepth() == 3,
			"the admitted WIDE read pays both visits even if grant becomes zero or negative");
		require(cpu.readCurrentInstructionPc() == leafPc && cpu.lastPc == leafPc + INSTRUCTION_BYTES
			&& cpu.readFramePc(2) == leafPc + 2 * INSTRUCTION_BYTES
			&& thread.frameAtDepth(2)->readWindow(FrameField::Top) == 4
			&& cpu.readFrameRegister(2, 3) == valueInteger(41),
			"grant exhaustion publishes the completed result and exact next PC, not a replay");
		requireParity(native, scalar);
		require(test::runCpuParity(cpu, scalar.cpu, 100) == RunResult::Halted
			&& cpu.readFrameRegister(0, 0) == valueInteger(41), "the next grant resumes at RET and returns the published result");
	}

	restart(true);
	require(test::runCpuParity(cpu, scalar.cpu, 100) == RunResult::Halted
		&& cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INDEX_NON_TABLE && cpu.readEpcWord() == leafPc
		&& thread.frameDepth() == 4 && cpu.readFramePc(2) == leafPc,
		"an indexing fault materializes both pending calls before exposing the WIDE instruction to the trap");
	require(thread.frameAtDepth(2)->readWindow(FrameField::Top) == 1
		&& cpu.readFrameRegister(2, 0) == valueInteger(19) && cpu.readFrameRegister(2, 3) == valueInteger(73),
		"the failed read observes its live arguments without storing a result or extending the frame");
	requireParity(native, scalar);
#endif
}

void warmTableStoresCompleteTheirEffects() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 4, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETI), 0, 1, 4);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETI), 5, 0, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::KNIL), 4, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::SETT), 0, 2, 4);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::GETI), 6, 0, 1);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::SETI), 0, 1, 1);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::GETI), 7, 0, 1);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::SETFIELD), 8, 0, 1);
	writeInstruction(image.text, 9, static_cast<u8>(OpCode::GETFIELD), 9, 8, 0);
	writeInstruction(image.text, 10, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.constants = {std::string("retained")};
	image.functions = {{.firstWord = 0, .wordCount = 11, .maxStack = 10}};
	CpuMachine native(image), scalar(image, true);
	const auto cycles = [](OpCode op) { return BASE_CYCLES[static_cast<u8>(op)]; };
	const int grant = cycles(OpCode::K1) + 2 * cycles(OpCode::SETI) + 3 * cycles(OpCode::GETI)
		+ cycles(OpCode::KNIL) + cycles(OpCode::SETT) + cycles(OpCode::SETFIELD) + cycles(OpCode::GETFIELD);

	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
		registers.set(0, valueTable(cpu.createTable(4, 0).address()));
		registers.set(1, valueInteger(29));
		registers.set(2, valueInteger(1));
		auto fields = cpu.createTable(0, 1);
		fields.setStringKey(*cpu.stringPool().find("retained"), valueInteger(73));
		registers.set(8, valueTable(fields.address()));
	}
	require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded,
		"both routes visit the same array stores before the halt");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
	const auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
	test::waitForNativeEntry(native.cpu, *frame.decodedPage,
		(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
#endif

	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
		auto table = asTable(registers.get(0), cpu.gcHeap());
		auto fields = asTable(registers.get(8), cpu.gcHeap());
		table.setInteger(1, valueNil());
		const auto pressure = cpu.createTable(2 * GC_STEP_WORDS, 0);
		cpu.setGlobalByKey(cpu.stringPool().intern("mark pressure"), valueTable(pressure.address()));
		cpu.stepHeap(valueNil(), valueNil(), valueNil());
		require(cpu.gcHeap().phase() == GcPhase::Mark
			&& (machine->memory.readRamRecordByte(table.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3u
			&& (machine->memory.readRamRecordByte(fields.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3u,
			"the receivers have both been visited before adding the new edges");
		registers.set(1, valueTable(cpu.createTable().address()));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
	}
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& exits = native.cpu.nativeGateProfile().exits;
	const auto integerMisses = exits[static_cast<size_t>(NativeBlockExit::WriteInteger)].entries;
	const auto indexMisses = exits[static_cast<size_t>(NativeBlockExit::WriteIndex)].entries;
	const auto fieldMisses = exits[static_cast<size_t>(NativeBlockExit::WriteField)].entries;
#endif
	require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded
		&& native.cpu.readFramePc(0) == native.rom.textAddress + 10u * INSTRUCTION_BYTES,
		"table effects retain the existing instruction frontier and grant");
	auto registers = native.cpu.activeThread()->frameAtDepth(0)->registers;
	auto table = asTable(registers.get(0), native.cpu.gcHeap());
	auto fields = asTable(registers.get(8), native.cpu.gcHeap());
	const Value child = registers.get(1);
	require(registers.get(5) == valueInteger(1) && isNil(registers.get(6)) && registers.get(7) == child
		&& table.lengthHint() == 1 && table.getInteger(1) == child
		&& (native.memory.readRamRecordByte(table.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 2u,
		"the stores append, retreat, then append and requeue the black owner for its new edge");
	require(registers.get(9) == child && fields.getStringKey(*native.cpu.stringPool().find("retained")) == child
		&& (native.memory.readRamRecordByte(fields.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 2u,
		"the predicted own field uses the same native collector effect");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(exits[static_cast<size_t>(NativeBlockExit::WriteInteger)].entries == integerMisses
		&& exits[static_cast<size_t>(NativeBlockExit::WriteIndex)].entries == indexMisses
		&& exits[static_cast<size_t>(NativeBlockExit::WriteField)].entries == fieldMisses,
		"no ordinary table-store continuation handles the hint or the collector's effect");
#endif
	requireParity(native, scalar);
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto slots = cpu.activeThread()->frameAtDepth(0)->registers;
		slots.set(1, valueNil());
		slots.set(7, valueNil());
		slots.set(9, valueNil());
		asTable(slots.get(0), cpu.gcHeap()).setInteger(1, valueNil());
		while (cpu.collecting()) cpu.stepHeap(valueNil(), valueNil(), valueNil());
		require(cpu.gcHeap().tableRecordAddress(valuePayload(child)) == valuePayload(child),
			"the revisited field edge retains a child no longer rooted by any register or array");
	}
	requireParity(native, scalar);
}

void negativeIntegerKeysUseHashStorage() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETT), 3, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETT), 0, 1, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETT), 4, 0, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::GETT), 6, 5, 7);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8}};
	constexpr i32 key = INT32_MIN + 2;
	for (const bool scalar : {false, true}) {
		CpuMachine machine(image, scalar);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		auto table = cpu.createTable(1, 1), child = cpu.createTable(), meta = cpu.createTable(0, 1);
		table.setInteger(1, valueInteger(61));
		meta.setStringKey(cpu.stringPool().intern("__index"), valueTable(table.address()));
		child.setMetatableAddress(meta.address());
		frame.registers.set(0, valueTable(table.address())); frame.registers.set(1, valueInteger(1));
		frame.registers.set(2, valueInteger(89)); frame.registers.set(5, valueTable(child.address()));
		frame.registers.set(7, valueInteger(1));
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1024);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		if (!scalar) test::waitForNativeEntry(cpu, *frame.decodedPage,
			(machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
#endif
		table.setInteger(1, valueInteger(61));
		table.setInteger(key, valueInteger(73));
		frame.registers.set(1, valueInteger(key));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		cpu.runUntilDepth(0, 3 * BASE_CYCLES[static_cast<u8>(OpCode::GETT)] + BASE_CYCLES[static_cast<u8>(OpCode::SETT)]);
		require(frame.registers.get(3) == valueInteger(73) && frame.registers.get(4) == valueInteger(89)
			&& table.getInteger(key) == valueInteger(89) && table.getInteger(1) == valueInteger(61),
			"negative keys select the same hash mapping across generated, scalar and record ports");
		require(frame.registers.get(6) == valueInteger(61) && cpu.readFramePc(0) == machine.rom.textAddress + 4u * INSTRUCTION_BYTES,
			"inherited positive reads retain the valid array and the exact successor");
	}
}
} // namespace

int main() {
	try {
		stringReadChainBoundaries();
		observedArithmeticResumesAtItsOwnInstruction();
		contradictoryOwnFieldProofRetiresItsSource();
		genericArraysAndHashKeys(); inheritedTableFactsAreRecheckedOnCpuEntry(); inheritedArrayReads(false); inheritedArrayReads(true); boundaryLengthAndUtf8(); selfAndNilFaults(); methodCallReturnsOriginalReceiver(); iterationChargeIgnoresVacantCapacity(); allocationChargesRequestedCapacity(); wideAllocationFailure();
		for (const bool generic : {false, true}) for (const bool full : {false, true}) stringStoreGrowthRoots(generic, full);

		nativeFieldOperationsLearnTheDecodedSite();
		coldRepeatedFieldsRecompileTheirSource();

		warmInheritedFieldReadsKeepTheirFrame();
		resolvedFieldKeepsPendingFixedCallsUntilAnObserver();

		warmTableStoresCompleteTheirEffects();
		negativeIntegerKeysUseHashStorage();
		std::cout << "Compiled table tests passed\n";
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
