#include "common/utf8.h"
#include "machine/cpu/cpu.h"
#include "machine/common/numeric.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
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
	require((left == right && bmsx::test::sameLanguageRam(a, b))
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

void lengthSeesMaterializedRegisterTags() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 2, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::LEN), 3, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4}};
	CpuMachine native(image), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		const auto table = cpu.createTable(1);
		frame.registers.set(0, valueTable(table.address()));
		frame.setTop(4);
		// With one array slot and no hash, the first value tag follows
		// its payload word. Alias just that tag to the pending R2 write.
		const u32 backing = frame.registers.tagAddress() + 2u - sizeof(u32);
		machine->memory.writeRamRecordWord(table.address() + static_cast<u32>(TableHeader::Storage), backing);
	}
	const u32 pc = native.rom.textAddress;
	const auto prefixCycles = BASE_CYCLES[static_cast<u8>(OpCode::K1)];
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
	const auto& installedImage = *native.cpu.activeThread()->frameAtDepth(0)->executionImage;
	const auto* page = installedImage.nativeCodeLookup->find(pc, 0);
	const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto* entry = page->nativeBlocks->entries[word].get();
	require(entry && entry->terminal.currentPc == pc + INSTRUCTION_BYTES && entry->admissionCycles == prefixCycles,
		"the installed segment can admit the prefix and WIDE LEN in a single grant");
#endif
	const int grant = prefixCycles + 1;
	require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded,
		"the two actual presence probes exhaust the grant before JMP");
	requireParity(native, scalar);
	require(native.cpu.readFrameRegister(0, 3) == valueInteger(1) && native.cpu.lastPc == pc + 2u * INSTRUCTION_BYTES
		&& native.cpu.readFramePc(0) == pc + 3u * INSTRUCTION_BYTES
		&& native.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::LEN)] - 2 * TABLE_LENGTH_PROBE_CYCLES,
		"LEN observes the newly written tag and charges the original WIDE frontier exactly");
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
	const auto beforeGc = scalar.cpu.captureRuntimeState();
	const auto beforeGcRam = scalar.cpu.memory().captureSaveState();
	const int gcCycles = static_cast<int>(scalar.cpu.collectHeap());
	scalar.cpu.memory().restoreSaveState(beforeGcRam);
	scalar.cpu.restoreRuntimeState(beforeGc);
	test::runCpuParity(native.cpu, scalar.cpu, BASE_CYCLES[static_cast<u8>(OpCode::K1)] + BASE_CYCLES[static_cast<u8>(OpCode::NEWT)]); requireParity(native, scalar);
	require(native.cpu.instructionBudgetRemaining == -gcCycles, "failed NEWT pays prefix/base and pre-admission GC, but no initialization");
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
	require(warm.left == ValueTag::Integer && warm.right == ValueTag::Integer && warm.stable,
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
	require(types.stable && types.left == ValueTag::Integer, "the real arithmetic profile still prefers integers");
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

void stringStoreCanRetireItsOwnSource() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETFIELD), 0, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 2}};
	image.constants = {std::string("field")};
	std::array<u8, INSTRUCTION_BYTES> replacement{};
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	const u32 halt = readLE32(replacement.data());
	constexpr u32 code = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE;
	constexpr u32 array = 32u;
	for (const bool scalar : {false, true}) {
		CpuMachine machine(image, scalar, test::RAM_CODE_FIXTURE_BYTES);
		auto& cpu = machine.cpu;
		auto& frame = *cpu.activeThread()->frameAtDepth(0);
		machine.memory.writeBytes(code, machine.rom.bytes.data() + machine.rom.textAddress, image.text.size());
		auto table = cpu.createTable(array, 1);
		const auto key = *cpu.stringPool().find("field");
		frame.registers.set(0, valueTable(table.address()));
		frame.registers.set(1, valueNil());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], code);
		cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 512);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		auto& page = *frame.decodedPage;
		if (!scalar) {
			test::waitForNativeEntry(cpu, page, 0);
			require(*page.nativeBlocks->entries[0]->sideExits.front().tableStore.decoded == -1,
				"the warm missing key does not train an overwrite prediction");
		}
#endif
		// Point the existing key's value lane at SETFIELD's own instruction;
		// the String key and adjacent tags lie outside the decoded loop.
		const u32 word = code - RAM_BASE;
		const u32 storage = word - (array + 1u) * sizeof(u32);
		const u32 keyTag = storage + (array + 3u) * sizeof(u32) + array;
		machine.memory.writeRamRecordWord(table.address() + static_cast<u32>(TableHeader::Storage), storage);
		machine.memory.writeRamRecordWord(word - sizeof(u32), key);
		machine.memory.writeRamRecordByte(keyTag, static_cast<u8>(ValueTag::String));
		machine.memory.writeRamRecordByte(keyTag + 1u, static_cast<u8>(ValueTag::Integer));
		frame.registers.set(1, valueInteger(halt));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], code);
		require(cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::SETFIELD)]) == RunResult::Yielded
			&& cpu.readFramePc(0) == code + INSTRUCTION_BYTES && table.getStringKey(key) == valueInteger(halt),
			"the watched store completes once and publishes the original successor");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		if (!scalar) require(!page.nativeBlocks || !page.nativeBlocks->entries[0],
			"the canonical write retires the executing native source and its prediction");
#endif
		require(cpu.runUntilDepth(0, 12) == RunResult::Halted,
			"the loop fetches the replacement without returning through retired code");
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
	require(page.words[word].tableCacheSlot == -1 && page.words[word + 1].tableCacheSlot == -1,
		"preparation observes no table layout");
	const int grant = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)] + BASE_CYCLES[static_cast<u8>(OpCode::SETFIELD)];
	require(test::runCpuParity(cpu, scalar.cpu, grant) == RunResult::Yielded, "the two indexed operations complete exactly");
	requireParity(prepared, scalar);
	const auto table = asTable(cpu.readFrameRegister(0, 0), cpu.gcHeap());
	int readSlot = -1, writeSlot = -1;
	require(table.getStringKeyCached(*cpu.stringPool().find("read"), readSlot) == valueInteger(73)
		&& table.getStringKeyCached(*cpu.stringPool().find("write"), writeSlot) == valueInteger(41)
		&& readSlot >= 0 && writeSlot >= 0, "the actual own record contains both live values");
	require(page.words[word].tableCacheSlot == readSlot && page.words[word + 1].tableCacheSlot == writeSlot,
		"successful native lookups train the same source slots used by scalar execution and compilation");
	page.retireNativeBlocks();
	cpu.prepareSystemNativeCode();
	const auto& read = page.nativeBlocks->entries[word]->sideExits.front().tableRead;
	const auto& write = page.nativeBlocks->entries[word + 1]->sideExits.front().tableStore;
	require(read.own.decoded == &page.words[word].tableCacheSlot
		&& write.decoded == &page.words[word + 1].tableCacheSlot,
		"recompilation borrows the learned sites instead of creating independent writable seeds");
#endif
}

void nestedFieldReadObservesPublishedRegisterAlias() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETFIELD), 2, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETFIELD), 3, 2, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::K1), 6, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8}};
	image.constants = {std::string("nested subject"), std::string("nested word")};
	CpuMachine native(image), scalar(image, true);
	const int readCycles = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)];
	const u32 start = native.rom.textAddress;
	const u32 nestedPc = start + INSTRUCTION_BYTES;
	const u32 suffixPc = start + 3u * INSTRUCTION_BYTES;
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto outer = cpu.createTable(0, 1), nested = cpu.createTable(0, 1);
		outer.setStringKey(*cpu.stringPool().find("nested subject"), valueTable(nested.address()));
		nested.setStringKey(*cpu.stringPool().find("nested word"), valueInteger(41));
		cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueTable(outer.address()));
	}
	require(test::runCpuParity(native.cpu, scalar.cpu, 2 * readCycles) == RunResult::Yielded
		&& native.cpu.readFrameRegister(0, 3) == valueInteger(41), "both initial own-field reads train on the ordinary table layout");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const auto& entry = page.nativeBlocks->entries[(start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(entry && entry->terminal.currentPc == nestedPc && entry->terminal.nextPc == suffixPc
		&& entry->admissionCycles == readCycles && entry->sideExits.size() == 2
		&& *entry->sideExits[0].tableRead.own.decoded == 0 && *entry->sideExits[1].tableRead.own.decoded == 0,
		"both own predictions are published in one native entry admissible on the short grant");
#endif

	const Value subject = native.cpu.readFrameRegister(0, 2);
	const auto word = valuePayload(subject);
	for (auto* machine : {&native, &scalar}) {
		const auto& frame = *machine->cpu.activeThread()->frameAtDepth(0);
		// For A=0,H=1, the value immediately follows the key word; the
		// two tag bytes follow those words and the hash link.
		const u32 storage = frame.registers.wordAddress() + sizeof(u32);
		const u32 tags = storage + 3u * sizeof(u32);
		machine->memory.writeRamRecordWord(word + static_cast<u32>(TableHeader::Storage), storage);
		machine->memory.writeRamRecordWord(storage, *machine->cpu.stringPool().find("nested word"));
		machine->memory.writeRamRecordByte(tags, static_cast<u8>(ValueTag::String));
		machine->memory.writeRamRecordByte(tags + 1u, static_cast<u8>(ValueTag::Integer));
	}
	for (const int grant : {2 * readCycles, readCycles + 1}) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
			registers.set(2, valueInteger(73));
			registers.set(3, valueInteger(-1));
			registers.set(6, valueInteger(99));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
		}
		require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded,
			"both runs complete the WIDE read without entering the suffix");
		require(native.cpu.readFrameRegister(0, 2) == subject && native.cpu.readFrameRegister(0, 3) == valueInteger(static_cast<i32>(word)),
			"the nested read observes the newly written register word, not its previous spill");
		require(native.cpu.readCurrentInstructionPc() == nestedPc && native.cpu.lastPc == nestedPc + INSTRUCTION_BYTES
			&& native.cpu.readFramePc(0) == suffixPc && native.cpu.instructionBudgetRemaining == grant - 2 * readCycles
			&& native.cpu.readFrameRegister(0, 6) == valueInteger(99),
			"the overlapping read pays both base charges and publishes the WIDE boundary exactly");
		requireParity(native, scalar);
	}
}

void inheritedFieldReadObservesPublishedRegisterAlias() {
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
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
		// A=0,H=1: the holder's value is the physical R3 payload. The
		// receiver and its metatable remain disjoint from the activation.
		const u32 storage = registers.wordAddress() + 2u * sizeof(u32);
		const u32 tags = storage + 3u * sizeof(u32);
		machine->memory.writeRamRecordWord(valuePayload(registers.get(1)) + static_cast<u32>(TableHeader::Storage), storage);
		machine->memory.writeRamRecordWord(storage, *cpu.stringPool().find("inherited word"));
		machine->memory.writeRamRecordByte(tags, static_cast<u8>(ValueTag::String));
		machine->memory.writeRamRecordByte(tags + 1u, static_cast<u8>(ValueTag::Integer));
	}
	for (int grant : {prefix + 1, total}) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
			auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
			registers.set(3, valueInteger(73));
			registers.set(6, valueInteger(99)); registers.set(7, valueInteger(99));
		}
		require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded, "one hop stops at the suffix");
		require(native.cpu.readFrameRegister(0, 3) == valueInteger(1) && native.cpu.readFrameRegister(0, 6) == valueInteger(1),
			"the inherited probe sees the pending prefix word rather than the old spill");
		require(native.cpu.readCurrentInstructionPc() == field && native.cpu.lastPc == field + INSTRUCTION_BYTES
			&& native.cpu.readFramePc(0) == suffix && native.cpu.instructionBudgetRemaining == grant - total
			&& native.cpu.readFrameRegister(0, 7) == valueInteger(99), "the WIDE read charges one hop and publishes the exact frontier");
		requireParity(native, scalar);
	}
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(readExits.entries == initialExits, "publishing a pending prefix does not send the one-hop read to scalar lookup");
#endif
}

void tableWriteObservesCleanRegisterAlias(bool field) {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 8, 2, 2);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 8, 3, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(field ? OpCode::SETFIELD : OpCode::SETI), 0, field ? 0 : 1, 7);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::MOV), 5, 2, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.constants = {std::string("overwritten slot")};
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 9}};
	CpuMachine native(image), scalar(image, true);
	const u32 start = native.rom.textAddress, write = start + 2u * INSTRUCTION_BYTES, copy = write + 2u * INSTRUCTION_BYTES;
	const int prefix = BASE_CYCLES[static_cast<u8>(OpCode::ADD)] + BASE_CYCLES[static_cast<u8>(OpCode::MOV)];
	const int store = BASE_CYCLES[static_cast<u8>(field ? OpCode::SETFIELD : OpCode::SETI)];
	const int move = BASE_CYCLES[static_cast<u8>(OpCode::MOV)], halt = BASE_CYCLES[static_cast<u8>(OpCode::HALT)];
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto table = cpu.createTable(field ? 0 : 2, field ? 1 : 0);
		if (field) table.setStringKey(*cpu.stringPool().find("overwritten slot"), valueInteger(13));
		else table.setInteger(1, valueInteger(13));
		auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
		registers.set(0, valueTable(table.address())); registers.set(2, valueInteger(13));
		registers.set(3, valueString(cpu.stringPool().intern("raw copy"))); registers.set(7, valueInteger(77));
	}
	const auto restart = [&] {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], start);
			auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
			registers.set(2, valueInteger(13)); registers.set(5, valueInteger(99));
		}
	};
	for (int visit = 0; visit < 16; ++visit) {
		restart();
		test::runCpuParity(native.cpu, scalar.cpu, prefix + store + move);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto& entry = page.nativeBlocks->entries[word];
	require(entry && entry->admissionCycles == prefix && entry->terminal.currentPc == write
		&& page.nativeBlocks->entries[word + 4u] && page.words[word].nativeNumericTypes().stable,
		"the real installed body caches a profiled read before the WIDE store and can link to its consumer");
#endif
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		const auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
		const u32 table = valuePayload(registers.get(0));
		const u32 storage = registers.wordAddress() + (field ? 1u : 2u) * sizeof(u32);
		machine->memory.writeRamRecordWord(table + static_cast<u32>(TableHeader::Storage), storage);
		if (field) {
			const u32 tags = storage + 3u * sizeof(u32);
			machine->memory.writeRamRecordWord(storage, *cpu.stringPool().find("overwritten slot"));
			machine->memory.writeRamRecordByte(tags, static_cast<u8>(ValueTag::String));
			machine->memory.writeRamRecordByte(tags + 1u, static_cast<u8>(ValueTag::Integer));
		}
	}
	restart();
	require(test::runCpuParity(native.cpu, scalar.cpu, prefix + 1) == RunResult::Yielded,
		"one cycle starts the complete WIDE store but not the successor");
	require(native.cpu.readFrameRegister(0, 2) == valueInteger(77) && native.cpu.readFrameRegister(0, 5) == valueInteger(99)
		&& native.cpu.instructionBudgetRemaining == 1 - store && native.cpu.readCurrentInstructionPc() == write
		&& native.cpu.lastPc == write + INSTRUCTION_BYTES && native.cpu.readFramePc(0) == copy,
		"the physical store commits its value without executing the next instruction");
	requireParity(native, scalar);
	restart();
	require(test::runCpuParity(native.cpu, scalar.cpu, prefix + store + move + 1) == RunResult::Halted,
		"a larger grant admits the compiled consumer and starts HALT");
	require(native.cpu.readFrameRegister(0, 2) == valueInteger(77) && native.cpu.readFrameRegister(0, 5) == valueInteger(77),
		"the successor uses the updated physical value instead of the earlier clean host binding");
	require(native.cpu.instructionBudgetRemaining == 1 - halt && native.cpu.readCurrentInstructionPc() == copy + INSTRUCTION_BYTES
		&& native.cpu.lastPc == copy + INSTRUCTION_BYTES && native.cpu.readFramePc(0) == copy + 2u * INSTRUCTION_BYTES,
		"the aliased write and receiving segment retain exact guest charge and PCs");
	requireParity(native, scalar);
}

void tableWriteDoesNotExportAStaleRamTagProof() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 2, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::LOADNIL), 2, 1, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::SETI), 0, 1, 7);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMPIF), 2, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 8}};
	CpuMachine native(image), scalar(image, true);
	const u32 start = native.rom.textAddress, branch = start + 3u * INSTRUCTION_BYTES, taken = branch + 2u * INSTRUCTION_BYTES;
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto table = cpu.createTable(1, 0);
		table.setInteger(1, valueInteger(13));
		auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
		registers.set(0, valueTable(table.address())); registers.set(7, valueInteger(77));
		// With one array slot the tag follows its payload word. LOADNIL
		// makes R2 definitely Nil in RAM without a resident host binding;
		// writing the array slot replaces that tag, not R2's zero payload.
		const u32 storage = registers.tagAddress() + 2u - sizeof(u32);
		machine->memory.writeRamRecordWord(table.address() + static_cast<u32>(TableHeader::Storage), storage);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
	const auto& imageState = *native.cpu.activeThread()->frameAtDepth(0)->executionImage;
	const auto& page = *imageState.nativeCodeLookup->find(start, 0);
	const u32 word = (start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	require(page.nativeBlocks->entries[word] && page.nativeBlocks->entries[word + 3u],
		"the table store and its typed branch have an installed native edge");
#endif
	const int grant = BASE_CYCLES[static_cast<u8>(OpCode::K1)] + BASE_CYCLES[static_cast<u8>(OpCode::LOADNIL)] + 1
		+ BASE_CYCLES[static_cast<u8>(OpCode::SETI)] + BASE_CYCLES[static_cast<u8>(OpCode::JMPIF)];
	require(test::runCpuParity(native.cpu, scalar.cpu, grant) == RunResult::Yielded,
		"the grant completes the branch but no target instruction");
	require(native.cpu.readFrameRegister(0, 2) == valueInteger(0) && native.cpu.readFramePc(0) == taken
		&& native.cpu.instructionBudgetRemaining == 0 && native.cpu.readCurrentInstructionPc() == branch && native.cpu.lastPc == branch,
		"a type proof in RAM cannot survive a physical tag overwrite across the edge");
	requireParity(native, scalar);
}

void negativeIntegerKeysDoNotEnterRawArrayCapacity() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETT), 3, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETT), 0, 1, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETT), 4, 0, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::GETT), 6, 5, 7);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8}};
	constexpr u32 capacity = 0x80000010u, invalidSlot = 0x80000001u;
	constexpr i32 key = INT32_MIN + 2;
	constexpr u32 words = DYNAMIC_RAM_BASE + 0x3000u, tags = words + (capacity + 3u) * 4u;
	for (const bool scalar : {false, true}) {
		CpuMachine machine(image, scalar, test::RAM_CODE_FIXTURE_BYTES);
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
		auto& memory = machine.memory;
		memory.writeRamRecordWord(table.address() + static_cast<u32>(TableHeader::Storage), words);
		memory.writeRamRecordWord(table.address() + static_cast<u32>(TableHeader::Array), capacity);
		// One positive array value, a real negative hash key/value, and an
		// unrelated lane that a wrapped negative index would read or overwrite.
		memory.writeRamRecordWord(words, 61);
		memory.writeRamRecordByte(tags, static_cast<u8>(ValueTag::Integer));
		memory.writeRamRecordWord(words + capacity * 4u, static_cast<u32>(key));
		memory.writeRamRecordByte(tags + capacity, static_cast<u8>(ValueTag::Integer));
		memory.writeRamRecordWord(words + (capacity + 1u) * 4u, 73);
		memory.writeRamRecordByte(tags + capacity + 1u, static_cast<u8>(ValueTag::Integer));
		memory.writeRamRecordWord(words + invalidSlot * 4u, 47);
		memory.writeRamRecordByte(tags + invalidSlot, static_cast<u8>(ValueTag::Integer));
		frame.registers.set(1, valueInteger(key));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
		cpu.runUntilDepth(0, 3 * BASE_CYCLES[static_cast<u8>(OpCode::GETT)] + BASE_CYCLES[static_cast<u8>(OpCode::SETT)]);
		require(frame.registers.get(3) == valueInteger(73) && frame.registers.get(4) == valueInteger(89)
			&& table.getInteger(key) == valueInteger(89) && memory.readRamRecordWord(words + invalidSlot * 4u) == 47,
			"negative keys select the same hash mapping across generated, scalar and record ports");
		require(frame.registers.get(6) == valueInteger(61) && cpu.readFramePc(0) == machine.rom.textAddress + 4u * INSTRUCTION_BYTES,
			"inherited positive reads consume the actual unsigned array capacity and retain the exact successor");
	}
}
} // namespace

int main() {
	try {
		stringReadChainBoundaries();
		observedArithmeticResumesAtItsOwnInstruction();
		lengthSeesMaterializedRegisterTags();
		contradictoryOwnFieldProofRetiresItsSource();
		genericArraysAndHashKeys(); inheritedTableFactsAreRecheckedOnCpuEntry(); inheritedArrayReads(false); inheritedArrayReads(true); boundaryLengthAndUtf8(); selfAndNilFaults(); methodCallReturnsOriginalReceiver(); wideAllocationFailure();
		for (const bool generic : {false, true}) for (const bool full : {false, true}) stringStoreGrowthRoots(generic, full);
		stringStoreCanRetireItsOwnSource();
		nativeFieldOperationsLearnTheDecodedSite();
		nestedFieldReadObservesPublishedRegisterAlias();
		inheritedFieldReadObservesPublishedRegisterAlias();
		for (bool field : {false, true}) tableWriteObservesCleanRegisterAlias(field);
		tableWriteDoesNotExportAStaleRamTagProof();
		negativeIntegerKeysDoNotEnterRawArrayCapacity();
		std::cout << "Compiled table tests passed\n";
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
