#include "machine/cpu/cpu.h"
#include "machine/common/numeric.h"
#include "machine/cpu/native_block.h"
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
	require(a.lastPc == b.lastPc
		&& a.readCurrentInstructionPc() == b.readCurrentInstructionPc() && a.readCauseWord() == b.readCauseWord()
		&& a.readEpcWord() == b.readEpcWord() && a.readLuaFaultReasonWord() == b.readLuaFaultReasonWord(),
		"table operations retain exact execution and exception boundaries");
	const auto left = a.captureRuntimeState(), right = b.captureRuntimeState();
	require(std::ranges::equal(left.snapshot.words(), right.snapshot.words())
		&& std::ranges::equal(left.snapshot.objectWords(), right.snapshot.objectWords()) && left.nextObjectHashId == right.nextObjectHashId
		&& left.luaHeap.trackedBytes == right.luaHeap.trackedBytes && left.luaHeap.nextCollectionBytes == right.luaHeap.nextCollectionBytes,
		"complete value graphs and allocation/collection accounting agree");
	const auto& first = *a.activeThread(); const auto& second = *b.activeThread();
	require(first.frameDepth == second.frameDepth && first.stackTop == second.stackTop, "frame extents agree");
	const CallFrame* firstFrame = first.firstFrame; const CallFrame* secondFrame = second.firstFrame;
	for (size_t i = 0; i < first.frameDepth; ++i, firstFrame = firstFrame->next, secondFrame = secondFrame->next) {
		const auto& x = *firstFrame; const auto& y = *secondFrame;
		require(x.pc == y.pc && x.top == y.top && x.stackBase == y.stackBase && x.stackCapacity == y.stackCapacity,
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
			auto* root = cpu.createTable(0, 1); auto* current = root;
			for (int i = 1; i < depth; ++i) {
				auto* next = cpu.createTable(0, 1); auto* meta = cpu.createTable(0, 1);
				meta->setStringKey(indexKey, valueTable(next)); current->metatable = meta; current = next;
			}
			if (depth > 1) current->setStringKey(key, valueFromTag(ValueTag::False, 37));
			else {
				auto* meta = cpu.createTable(0, 1); meta->setStringKey(indexKey, valueBool(false)); root->metatable = meta;
			}
			TableLookupResult scratch{valueNumber(73), -1, 0, TableLookupStatus::Resolved};
			const auto before = cpu.luaHeap().captureState();
			Table::loadStringIndex(root, indexKey, key, scratch);
			require((depth == 33 ? scratch.status == TableLookupStatus::ChainExhausted : scratch.status == TableLookupStatus::Resolved)
				&& (depth == 1 ? isNil(scratch.value) : depth == 33 || scratch.value == valueFromTag(ValueTag::False, 37)),
				"the raw Table leaf preserves nil/false and the exact32-table chain bound");
			require(cpu.luaHeap().usedBytes() == before.trackedBytes
				&& cpu.luaHeap().captureState().nextCollectionBytes == before.nextCollectionBytes,
				"the leaf performs no tracked allocation or collection work");
			auto& frame = *cpu.activeThread()->frameAtDepth(0);
			frame.registers[1] = valueString(key); frame.registers[9] = valueTable(root); frame.registers[8] = valueNumber(73);
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
				&& native.cpu.readFrameRegister(0, 8) == valueNumber(73),
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
		auto* r = m->cpu.activeThread()->frameAtDepth(0)->registers;
		r[0] = valueTable(m->cpu.createTable(4, 1)); r[1] = valueNumber(1); r[2] = valueNumber(3);
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
	const std::array keys{valueNumber(1), valueNumber(2), valueNumber(4), valueNumber(5), valueNumber(0), valueNumber(-0.0),
		valueNumber(-7), valueNumber(1.5), valueNumber(2147483647.0), valueNumber(2147483648.0), valueNumber(4294967297.0),
		VALUE_QNAN_MASK, valueNumber(std::numeric_limits<double>::infinity()), valueNumber(-std::numeric_limits<double>::infinity()),
		valueBool(false), valueBool(true), valueString(field)};
	const std::array values{valueNil(), valueFromTag(ValueTag::False, 37), valueFromTag(ValueTag::True, 37),
		valueNumber(-0.0), VALUE_QNAN_MASK, valueNumber(std::numeric_limits<double>::infinity()), valueString(valueText)};
	for (const Value key : keys) for (const Value value : values) {
		for (auto* m : {&native, &scalar}) {
			auto* r = m->cpu.activeThread()->frameAtDepth(0)->registers; r[1] = key; r[2] = value;
		}
		test::runCpuParity(native.cpu, scalar.cpu, 16);
		// Rebuilding can consume the grant before the loop's readback.
		for (u32 remaining = image.functions[0].wordCount;
			remaining > 0 && native.cpu.activeThread()->frameAtDepth(0)->pc != native.rom.textAddress; --remaining)
			test::runCpuParity(native.cpu, scalar.cpu, 1);
		require(native.cpu.activeThread()->frameAtDepth(0)->pc == native.rom.textAddress,
			"readback completes within one seven-word loop");
		requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 3) == value && native.cpu.readFrameRegister(0, 5) == valueNumber(1),
			"all raw values survive generic array/hash access and the pending store source stays live");
	}
	for (auto* m : {&native, &scalar}) {
		auto* r = m->cpu.activeThread()->frameAtDepth(0)->registers;
		r[1] = valueTable(m->cpu.createTable()); r[2] = valueTable(m->cpu.createTable());
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
		auto* table = machine->cpu.createTable(2); table->setInteger(1, valueNumber(23));
		machine->cpu.activeThread()->frameAtDepth(0)->registers[1] = valueTable(table);
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
		machine->cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNil();
		machine->cpu.activeThread()->frameAtDepth(0)->registers[4] = valueNil();
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc + 2u * INSTRUCTION_BYTES);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 1);
	requireParity(native, scalar);
	require(native.cpu.readFrameRegister(0, 4) == valueNumber(1) && native.cpu.readFramePc(0) == pc + 3u * INSTRUCTION_BYTES,
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
		auto& cpu = m->cpu; auto* own = cpu.createTable(2), *parent = cpu.createTable(2), *meta = cpu.createTable(0, 1);
		parent->setInteger(1, valueNumber(73)); meta->setStringKey(cpu.stringPool().intern("__index"), valueTable(parent)); own->metatable = meta;
		auto* r = cpu.activeThread()->frameAtDepth(0)->registers; r[0] = valueTable(own); r[1] = valueNumber(1); cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 300);
	}
	for (const Value value : {valueBool(false), valueNumber(0), valueNil(), valueBool(true), valueNumber(19), valueNil()}) {
		for (auto* m : {&native, &scalar}) { asTable(m->cpu.readFrameRegister(0, 0))->setInteger(1, value); m->cpu.runUntilDepth(0, 6); }
		requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 3) == (isNil(value) ? valueNumber(73) : value), "only missing own slots traverse inheritance");
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
		auto* table = m->cpu.createTable(2, 4); for (int i = 1; i <= 5; ++i) table->setInteger(i, valueNumber(i));
		auto* r = m->cpu.activeThread()->frameAtDepth(0)->registers; r[0] = valueTable(table); r[2] = valueNumber(2); m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 605);
	}
	for (const Value value : {valueNil(), valueBool(false), valueNil(), valueNumber(2)}) {
		for (auto* m : {&native, &scalar}) { m->cpu.activeThread()->frameAtDepth(0)->registers[2] = value; m->cpu.runUntilDepth(0, 11); }
		requireParity(native, scalar);
		const double boundary = asNumber(native.cpu.readFrameRegister(0, 3));
		const Table* table = asTable(native.cpu.readFrameRegister(0, 0));
		require((boundary == 0 || !isNil(table->get(valueNumber(boundary)))) && isNil(table->get(valueNumber(boundary + 1))), "native LEN returns a valid boundary");
		if (!isNil(value)) require(boundary == 5, "native LEN finds the unique sequence boundary");
		require(native.cpu.readFrameRegister(0, 4) == valueNumber(boundary + 1), "the live definition survives the length helper");
	}
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::KSMI), 4, 0, 7);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 2, 1, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::LEN), 2, 2, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::ADD), 3, 2, 4);
	CpuMachine textNative(image), textScalar(image, true);
	for (auto* m : {&textNative, &textScalar}) {
		m->cpu.activeThread()->frameAtDepth(0)->registers[1] = valueString(m->cpu.stringPool().intern(std::string_view("A\xc3\xa9\xe9\x9b\xaa\0\xf0\x9f\x98\x80", 11)));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 500);
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
		cpu.activeThread()->frameAtDepth(0)->registers[9] = valueTable(table); cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 300);
		auto* meta = cpu.createTable(0, 1); table->setStringKey(cpu.stringPool().intern("method"), valueNil());
		meta->setStringKey(cpu.stringPool().intern("__index"), valueTable(table)); table->metatable = meta;
		cpu.activeThread()->frameAtDepth(0)->top = 0;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 3); requireParity(native, scalar);
	require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_METATABLE_LOOP && native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES
		&& native.cpu.activeThread()->frameAtDepth(0)->top == 8 && native.cpu.readFrameRegister(0, 7) == native.cpu.readFrameRegister(0, 9),
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
		auto* r = m->cpu.activeThread()->frameAtDepth(0)->registers; r[0] = valueTable(m->cpu.createTable(2)); r[1] = valueNumber(1); r[2] = valueNumber(73);
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 504); r[1] = valueNil(); r[3] = valueNumber(19); m->cpu.activeThread()->frameAtDepth(0)->top = 0;
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
		auto& cpu = m->cpu; auto& root = *cpu.activeThread()->frameAtDepth(0); root.registers[8] = valueNumber(73); root.registers[9] = valueNil(); root.top = 9;
		const auto key = cpu.stringPool().find("retained"); auto* retained = cpu.createTable(350000); cpu.setGlobalByKey(*key, valueTable(retained));
	}
	const int gcCycles = 2 * ceilDiv4(static_cast<int>(native.cpu.luaHeap().usedBytes())) + 3;
	test::runCpuParity(native.cpu, scalar.cpu, BASE_CYCLES[static_cast<u8>(OpCode::K1)] + BASE_CYCLES[static_cast<u8>(OpCode::NEWT)]); requireParity(native, scalar);
	require(native.cpu.instructionBudgetRemaining == -gcCycles, "failed NEWT pays prefix/base and pre-admission GC, but no initialization");
	require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_OUT_OF_MEMORY
		&& native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES
		&& native.cpu.readFrameRegister(0, 8) == valueNumber(73) && native.cpu.activeThread()->frameAtDepth(0)->top == 9,
		"failed allocation retains the precise prefix, original destination and WIDE EPC after collection");
}
void stringStoreGrowthRoots(bool generic) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 7, 9, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::KNIL), 9, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(generic ? OpCode::SETT : OpCode::SETFIELD), 0, generic ? 1 : 0, 7);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 16}};
	image.constants = {std::string("field")};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto* r = m->cpu.activeThread()->frameAtDepth(0)->registers;
		r[0] = valueTable(m->cpu.createTable(0, 1)); r[1] = valueString(m->cpu.stringPool().intern("field")); r[9] = valueNumber(1);
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
	std::array<std::string, 2> garbage; size_t index = 0;
	for (auto* m : {&native, &scalar}) {
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); auto* r = frame.registers;
		auto& strings = m->cpu.stringPool(); auto* retained = m->cpu.createTable(0, 1);
		retained->setStringKey(strings.intern("payload"), valueString(strings.intern("retained")));
		r[0] = valueTable(m->cpu.createTable()); r[9] = valueTable(retained); frame.top = 0;
		const auto heap = m->cpu.captureRuntimeState().luaHeap;
		garbage[index] = std::string(heap.nextCollectionBytes - heap.trackedBytes - 1, 'g'); strings.intern(garbage[index++]);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 3); requireParity(native, scalar);
	for (size_t i = 0; i < 2; ++i) {
		auto& machine = i == 0 ? native : scalar;
		require(machine.cpu.readFramePc(0) == machine.rom.textAddress + 2u * INSTRUCTION_BYTES
			&& machine.cpu.stringPool().find(garbage[i]).has_value(),
			"an exhausted grant stops before the store and its possible collection");
	}
	test::runCpuParity(native.cpu, scalar.cpu, 1); requireParity(native, scalar);
	index = 0;
	for (auto* m : {&native, &scalar}) {
		auto& strings = m->cpu.stringPool(); require(!strings.find(garbage[index++]), "hash growth really collects unreachable pressure");
		auto* r = m->cpu.activeThread()->frameAtDepth(0)->registers; auto* retained = asTable(r[7]);
		require(retained->getStringKey(*strings.find("payload")) == valueString(*strings.find("retained")),
			"growth sees all reference roots published by the completed native prefix");
		require(asTable(r[0])->getStringKey(*strings.find("field")) == r[7], "growth commits the requested reference store once");
	}
}
} // namespace

int main() {
	try {
		stringReadChainBoundaries();
		genericArraysAndHashKeys(); inheritedTableFactsAreRecheckedOnCpuEntry(); inheritedArrayReads(false); inheritedArrayReads(true); boundaryLengthAndUtf8(); selfAndNilFaults(); wideAllocationFailure(); stringStoreGrowthRoots(false); stringStoreGrowthRoots(true);
		std::cout << "Compiled table tests passed\n";
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
