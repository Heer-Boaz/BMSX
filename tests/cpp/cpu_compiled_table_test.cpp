#include "common/utf8.h"
#include "machine/cpu/cpu.h"
#include "machine/common/numeric.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "machine/runtime/history/ram_history.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/closure_fixture.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"
#include "support/table_allocation_reference.h"

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
		test::seedManagedFixture(cpu, addresses);
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

void completedOwnStringProbeKeepsLookupSemantics() {
	enum class Path { NoMetatable, EmptyMetatable, IndexWordAlias, InheritedFalse, Callable, BadForward, Loop, TwoHops };
	for (const auto op : {OpCode::GETFIELD, OpCode::SELF, OpCode::GETT}) {
		for (auto path : {Path::NoMetatable, Path::EmptyMetatable, Path::IndexWordAlias, Path::InheritedFalse, Path::Callable,
			Path::BadForward, Path::Loop, Path::TwoHops}) {
			test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
			writeInstruction(image.text, 0, static_cast<u8>(op), 2, 0, op == OpCode::GETT ? 1 : 0);
			writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 4, 2, 0);
			writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETFIELD), 5, 0, 1);
			writeInstruction(image.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
			writeInstruction(image.text, 16, static_cast<u8>(OpCode::HALT), 0, 0, 0);
			image.functions = {{.firstWord=0, .wordCount=4, .maxStack=6}, {.firstWord=16, .wordCount=1}};
			image.constants = {std::string("continue own miss"), std::string("second own read")};
			image.exceptionFunctionIndex = 1;
			CpuMachine native(image), scalar(image, true);
			// Both watched and unwatched fixture lanes take the same emitted
			// completed-probe path with ordinary, independently allocated objects.
			RamHistory nativeHistory, scalarHistory;
			RamHistory::PageMap nativeCheckpoint, scalarCheckpoint;
			if (path == Path::InheritedFalse || path == Path::Callable) {
				nativeHistory.capture(native.memory, nullptr, nativeCheckpoint);
				scalarHistory.capture(scalar.memory, nullptr, scalarCheckpoint);
			}
			for (auto* machine : {&native, &scalar}) {
				auto& cpu = machine->cpu;
				const auto key = cpu.stringPool().intern("continue own miss");
				auto root = bmsx::test::allocateTableReference(cpu, 0, 4);
				root.setStringKey(key, valueInteger(93));
				root.setStringKey(cpu.stringPool().intern("second own read"), valueInteger(39));
				cpu.activeThread()->currentFrame->registers.set(0, valueTable(root.address()));
				cpu.activeThread()->currentFrame->registers.set(1, valueString(key));
			}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			native.cpu.prepareSystemNativeCode();
#endif
			const int ownGrant = BASE_CYCLES[static_cast<u8>(op)];
			require(test::runCpuParity(native.cpu, scalar.cpu, ownGrant) == RunResult::Yielded
				&& native.cpu.readFrameRegister(0, 2) == valueInteger(93),
				"a real own hit trains the existing decoded slot");
			for (auto* machine : {&native, &scalar}) {
				auto& cpu = machine->cpu;
				const auto key = cpu.stringPool().intern("continue own miss");
				const auto index = cpu.stringPool().intern("__index");
				auto root = asTable(cpu.readFrameRegister(0,0), cpu.gcHeap());
				auto meta = bmsx::test::allocateTableReference(cpu, 0,1), holder = bmsx::test::allocateTableReference(cpu, 0,1);
				root.setStringKey(key, valueNil());
				if (path != Path::NoMetatable) root.setMetatableAddress(meta.address());
				if (path == Path::IndexWordAlias) {
					// One hash slot puts the integer at the exact home of "__index".
					meta.setInteger(static_cast<i32>(index), valueInteger(47));
					require(meta.hashSlots() == 1 && meta.getInteger(static_cast<i32>(index)) == valueInteger(47),
						"the non-string key with identical payload occupies the probed node");
				}
				if (path == Path::InheritedFalse) { meta.setStringKey(index, valueTable(holder.address())); holder.setStringKey(key, valueFromTag(ValueTag::False, 37)); }
				if (path == Path::Callable) meta.setStringKey(index, valueBuiltinFunction(BuiltinFunctionId::Type));
				if (path == Path::BadForward) meta.setStringKey(index, valueInteger(47));
				if (path == Path::Loop) meta.setStringKey(index, valueTable(root.address()));
				if (path == Path::TwoHops) {
					auto other = bmsx::test::allocateTableReference(cpu, 0,1), holderMeta = bmsx::test::allocateTableReference(cpu, 0,1);
					meta.setStringKey(index, valueTable(holder.address()));
					holder.setMetatableAddress(holderMeta.address());
					holderMeta.setStringKey(index, valueTable(other.address()));
					other.setStringKey(key, valueInteger(27));
				}
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
				cpu.activeThread()->currentFrame->registers.set(4, valueInteger(73));
			}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			if (op == OpCode::GETFIELD && path == Path::InheritedFalse) {
				auto& cpu = native.cpu;
				auto& frame = *cpu.activeThread()->currentFrame;
				const u32 pc = native.rom.textAddress;
				const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
				const auto* page = frame.executionImage->nativeCodeLookup->find(pc, 0);
				require(page && page->nativeBlocks && page->nativeBlocks->entries[word], "the trained source is still installed");
				const auto& entry = page->nativeBlocks->entries[word];
				const auto read = std::ranges::find(entry->sideExits, NativeBlockExit::ReadField, &NativeBlockExitSite::exit);
				require(read != entry->sideExits.end() && *read->tableRead.decoded >= 0,
					"the published own-slot prediction still points to the formerly present field");
				ValueSlots registers(6);
				registers.set(0, frame.registers.get(0));
				registers.set(2, valueInteger(91));
				registers.set(4, valueInteger(73));
				NativeBlockRunState grant{.constants = frame.executionImage->constPool, .frame = &frame, .heap = &cpu.gcHeap(),
					.globalValues = {}, .systemGlobalValues = {},
					.tableIndexKeyWord = cpu.memory().ramData() + cpu.gcHeap().diagnosticOffset(HeapServiceRemarkHeadField::Index),
					.remainingCycles = 0};
				require(entry->run(registers.view(), grant)->exit == NativeBlockExit::ScalarBoundary,
					"a short grant does not attest to an unperformed own probe");
				grant.remainingCycles = ownGrant;
				require(entry->run(registers.view(), grant)->exit == NativeBlockExit::Continue && grant.remainingCycles == -TABLE_INDEX_VISIT_CYCLES
					&& registers.get(2) == valueFromTag(ValueTag::False,37) && registers.get(4) == valueInteger(73),
					"the native read publishes inherited false and its visit debt before the suffix");
			}
#endif
			require(test::runCpuParity(native.cpu, scalar.cpu, 2048) == RunResult::Halted,
				"both outcomes hit the intended HALT");
			requireParity(native, scalar);
			const auto result = native.cpu.readFrameRegister(0, 4);
			if (path == Path::NoMetatable || path == Path::EmptyMetatable || path == Path::IndexWordAlias) require(result == valueNil(), "an ordinary terminal miss commits nil");
			if (path == Path::InheritedFalse) require(result == valueFromTag(ValueTag::False,37), "an inherited false is not absence");
			if (path == Path::Callable) require(result == valueString(*native.cpu.stringPool().find("table")), "the callable sees the original receiver after the own miss");
			if (path == Path::BadForward) require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INDEX_NON_TABLE && result == valueInteger(73),
				"an invalid forwarded __index keeps its exact fault and unexecuted suffix");
			if (path == Path::Loop) require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_METATABLE_LOOP && result == valueInteger(73),
				"the original receiver counts against the exact loop bound");
			if (path == Path::TwoHops) require(result == valueInteger(27), "later raw probes still read each live chained table");
			if (path != Path::BadForward && path != Path::Loop)
				require(native.cpu.readFrameRegister(0, 5) == valueInteger(39),
					"the completed first miss is consumed before a distinct own read needs its lookup");
			if (op == OpCode::SELF) require(native.cpu.readFrameRegister(0, 3) == native.cpu.readFrameRegister(0, 0),
				"SELF retains its original receiver for all outcomes");
		}
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
			auto root = bmsx::test::allocateTableReference(cpu, 0, 1); auto current = root;
			for (int i = 1; i < depth; ++i) {
				auto next = bmsx::test::allocateTableReference(cpu, 0, 1); auto meta = bmsx::test::allocateTableReference(cpu, 0, 1);
				meta.setStringKey(indexKey, valueTable(next.address())); current.setMetatableAddress(meta.address()); current = next;
			}
			if (depth > 1) current.setStringKey(key, valueFromTag(ValueTag::False, 37));
			else {
				root.setMetatableAddress(bmsx::test::allocateTableReference(cpu, 0, 1).address());
			}
			TableLookupResult scratch{valueInteger(73), -1, 0, TableLookupStatus::Resolved};
			const auto before = std::pair{cpu.luaHeap().usedBytes(), cpu.luaHeap().collectionTarget()};
			root.resolveStringIndex(key, scratch);
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
		r.set(0, valueTable(bmsx::test::allocateTableReference(m->cpu, 4, 1).address())); r.set(1, valueInteger(1)); r.set(2, valueInteger(3));
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
		r.set(1, valueTable(bmsx::test::allocateTableReference(m->cpu).address())); r.set(2, valueTable(bmsx::test::allocateTableReference(m->cpu).address()));
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
		auto table = bmsx::test::allocateTableReference(machine->cpu, 2); table.setInteger(1, valueInteger(23));
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

void nativeTypedIndexRechecksAnExternalEntry() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETI), 4, 1, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 0, 1);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::SETT), 0, 1, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::GETT), 3, 0, 1);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 5}};
	CpuMachine native(image), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto key = bmsx::test::allocateTableReference(cpu, 1, 0);
		key.setInteger(1, valueInteger(22));
		auto table = bmsx::test::allocateTableReference(cpu, 0, 2);
		auto& frame = *cpu.activeThread()->currentFrame;
		frame.registers.set(0, valueTable(table.address()));
		frame.registers.set(1, valueTable(key.address()));
		frame.registers.set(2, valueInteger(73));
		frame.setTop(3);
	}
	auto& cpu = native.cpu;
	const u32 pc = native.rom.textAddress, bodyPc = pc + 3 * INSTRUCTION_BYTES;
	const auto& execution = *cpu.activeThread()->currentFrame->executionImage;
	cpu.prepareSystemNativeCode();
	const auto* page = execution.nativeCodeLookup->find(pc, 0);
	const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	require(page && page->nativeBlocks && page->nativeBlocks->entries[word]
		&& page->nativeBlocks->entries[word + 3]
		&& page->nativeBlocks->entries[word]->region == page->nativeBlocks->entries[word + 3]->region,
		"the separately admitted indexed stores and reads share the preceding Table proof");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& gate = cpu.nativeGateProfile();
	const auto& readIndex = gate.exits[static_cast<size_t>(NativeBlockExit::ReadIndex)].entries;
	const auto& writeIndex = gate.exits[static_cast<size_t>(NativeBlockExit::WriteIndex)].entries;
	const auto beforeRead = readIndex, beforeWrite = writeIndex;
#endif
	const int body = BASE_CYCLES[static_cast<u8>(OpCode::SETT)] + BASE_CYCLES[static_cast<u8>(OpCode::GETT)];
	const int prefix = BASE_CYCLES[static_cast<u8>(OpCode::GETI)] + BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
	test::runCpuParity(cpu, scalar.cpu, prefix + body);
	requireParity(native, scalar);
	const auto table = asTable(cpu.readFrameRegister(0, 0), cpu.gcHeap());
	const Value identity = cpu.readFrameRegister(0, 1);
	require(cpu.readFrameRegister(0, 3) == valueInteger(73) && table.get(identity) == valueInteger(73),
		"the typed identity helpers store and read the real mapping");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(readIndex == beforeRead && writeIndex == beforeWrite, "the proved Table key uses returning helpers");
#endif
	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		lane.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], bodyPc);
		auto registers = lane.activeThread()->currentFrame->registers;
		registers.set(1, valueString(lane.stringPool().intern("external")));
		registers.set(2, valueInteger(89));
	}
	test::runCpuParity(cpu, scalar.cpu, body);
	requireParity(native, scalar);
	require(cpu.readFrameRegister(0, 3) == valueInteger(89) && table.get(identity) == valueInteger(73)
		&& table.get(cpu.readFrameRegister(0, 1)) == valueInteger(89),
		"a different public-entry key tag neither writes nor reads the proved identity arm");
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
		auto& cpu = m->cpu; auto own = bmsx::test::allocateTableReference(cpu, 2), parent = bmsx::test::allocateTableReference(cpu, 2), meta = bmsx::test::allocateTableReference(cpu, 0, 1);
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
		auto table = bmsx::test::allocateTableReference(m->cpu, 2, 4); for (int i = 1; i <= 5; ++i) table.setInteger(i, valueInteger(i));
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
		auto& cpu = m->cpu; auto table = bmsx::test::allocateTableReference(cpu, 0, 1); table.setStringKey(cpu.stringPool().intern("method"), valueInteger(73));
		cpu.activeThread()->frameAtDepth(0)->registers.set(9, valueTable(table.address())); cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 300);
		auto meta = bmsx::test::allocateTableReference(cpu, 0, 1); table.setStringKey(cpu.stringPool().intern("method"), valueNil());
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
		auto& r = m->cpu.activeThread()->frameAtDepth(0)->registers; r.set(0, valueTable(bmsx::test::allocateTableReference(m->cpu, 2).address())); r.set(1, valueInteger(1)); r.set(2, valueInteger(73));
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
	for (auto* machine : {&native, &scalar}) {
		test::seedTestRomClosure(machine->cpu, machine->rom.functionAddresses[1]);
		test::seedTestRomClosure(machine->cpu, machine->rom.functionAddresses[2]);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 2 * BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)]);
	const Value inherited = valueFloatBits(0xffc01234u), overridden = valueInteger(-37);
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto& r = cpu.activeThread()->currentFrame->registers;
		auto obj = bmsx::test::allocateTableReference(cpu, 0, 4); auto parent = bmsx::test::allocateTableReference(cpu, 0, 1); auto meta = bmsx::test::allocateTableReference(cpu, 0, 1);
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
				auto table = bmsx::test::allocateTableReference(cpu, capacity, capacity);
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

void tableIteratorRetainsItsCursorAcrossDeletionAndRestore() {
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(4 * INSTRUCTION_BYTES);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 8}};
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ITERN), 0, 4, 3);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::KSMI), 4, 0, 55);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	CpuMachine native(image), scalar(image, true);
	const u32 pc = native.rom.textAddress;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
	const auto* page = native.cpu.activeThread()->currentFrame->executionImage->nativeCodeLookup->find(pc, 0);
	const auto& entry = page->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(entry && entry->terminal.exit == NativeBlockExit::Continue && entry->terminal.nextPc == pc + INSTRUCTION_BYTES
		&& entry->sideExits.size() == 1 && entry->sideExits[0].exit == NativeBlockExit::Continue
		&& entry->sideExits[0].nextPc == pc + 3 * INSTRUCTION_BYTES,
		"native iterator owns both fallthrough and the complete WIDE skip");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& exits = native.cpu.nativeGateProfile().exits;
	const auto before = exits[static_cast<size_t>(NativeBlockExit::Continue)].entries;
#endif
#endif
	for (auto* machine : {&native, &scalar}) {
		auto table = bmsx::test::allocateTableReference(machine->cpu, 3, 2);
		table.setInteger(1, valueBool(false));
		table.setInteger(3, valueInteger(33));
		table.setInteger(-4, valueInteger(99));
		auto& frame = *machine->cpu.activeThread()->currentFrame;
		frame.registers.set(0, valueBuiltinFunction(BuiltinFunctionId::Next));
		frame.registers.set(1, valueTable(table.address()));
		frame.registers.set(6, valueInteger(-7));
		frame.setTop(7);
	}
	const std::array<std::pair<Value, Value>, 4> expected{{
		{valueInteger(1), valueBool(false)}, {valueInteger(3), valueInteger(33)},
		{valueInteger(-4), valueInteger(99)}, {valueNil(), valueNil()}}};
	for (const auto& [key, value] : expected) {
		test::runCpuParity(native.cpu, scalar.cpu, 1);
		requireParity(native, scalar);
		require(native.cpu.readFramePc(0) == pc + 3 * INSTRUCTION_BYTES
			&& native.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::ITERN)] - 3
			&& native.cpu.readFrameRegister(0, 4) == key && native.cpu.readFrameRegister(0, 5) == value
			&& native.cpu.readFrameRegister(0, 6) == valueNil(), "iterator skips WIDE and places the exact result count");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS) && defined(BMSX_NATIVE_GATE_PROFILE)
		if (key == valueInteger(1))
			require(exits[static_cast<size_t>(NativeBlockExit::Continue)].entries == before + 1
				&& exits[static_cast<size_t>(NativeBlockExit::IterateTable)].entries == 0,
				"the executable cursor pays and publishes only its exhausted grant, without semantic dispatch");
#endif
		if (key == valueInteger(1)) {
			for (auto* machine : {&native, &scalar}) {
				auto table = asTable(machine->cpu.readFrameRegister(0, 1), machine->cpu.gcHeap());
				table.setInteger(1, valueNil());
				const auto state = machine->cpu.captureRuntimeState();
				const auto ram = machine->memory.captureSaveState();
				machine->memory.restoreSaveState(ram);
				machine->cpu.restoreRuntimeState(state);
				require(valuePayload(machine->cpu.readFrameRegister(0, 2)) == 1, "restored frame retains the iterator position");
			}
		}
		test::runCpuParity(native.cpu, scalar.cpu, BASE_CYCLES[static_cast<u8>(OpCode::JMP)]);
	}
	for (auto* machine : {&native, &scalar}) machine->cpu.activeThread()->currentFrame->registers.set(2, valueInteger(1));
	test::runCpuParity(native.cpu, scalar.cpu, 1);
	requireParity(native, scalar);
	require(native.cpu.readFramePc(0) == pc + INSTRUCTION_BYTES && native.cpu.readFrameRegister(0, 4) == valueNil()
		&& native.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::ITERN)],
		"non-nil starting key falls through with no write or placement charge");
}

void tableIteratorUsesNativeEdgesAndRecordsTheCursor() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	for (const bool nextPage : {false, true}) for (const int guard : {0, 1, 2, 3}) {
		test::Blua32TestImage image;
		image.mappedCode = false;
		image.textAlignment = MAPPED_PAGE_BYTE_SIZE;
		const u32 first = nextPage ? DECODED_PAGE_WORDS - 2 : 0;
		image.text.resize((first + 6) * INSTRUCTION_BYTES);
		image.functions = {{.firstWord = first, .wordCount = 6, .maxStack = 6}};
		writeInstruction(image.text, first, static_cast<u8>(OpCode::KSMI), 3, 0, 37);
		writeInstruction(image.text, first + 1, static_cast<u8>(OpCode::ITERN), 0, 2, 2);
		writeInstruction(image.text, first + 2, static_cast<u8>(OpCode::KSMI), 4, 0, 9);
		writeInstruction(image.text, first + 3, static_cast<u8>(OpCode::K1), 5, 0, 0);
		writeInstruction(image.text, first + 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		writeInstruction(image.text, first + 5, static_cast<u8>(OpCode::RET), 0, 1, 0);
		CpuMachine native(image), scalar(image, true);
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			const auto table = bmsx::test::allocateTableReference(cpu, 0, 4);
			TableRecord(cpu.gcHeap(), table.address()).setInteger(-4, valueBool(false));
			auto& frame = *cpu.activeThread()->currentFrame;
			frame.registers.set(0, valueBuiltinFunction(guard == 1 ? BuiltinFunctionId::Type : BuiltinFunctionId::Next));
			frame.registers.set(1, guard == 2 ? valueInteger(3) : valueTable(table.address()));
			frame.registers.set(2, guard == 3 ? valueInteger(4) : valueNil());
			frame.registers.set(3, valueInteger(31));
			frame.setTop(4);
		}
		RamHistory history;
		RamHistory::PageMap before, after;
		history.capture(native.memory, nullptr, before);
		native.cpu.prepareSystemNativeCode();
		const u32 pc = native.rom.textAddress + first * INSTRUCTION_BYTES;
		const auto* page = native.cpu.activeThread()->currentFrame->executionImage->nativeCodeLookup->find(pc, 0);
		const auto& entry = page->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
		require(entry && entry->terminal.exit == (nextPage ? NativeBlockExit::IterateTable : NativeBlockExit::Continue),
			"a mapped-page skip without the next word retains the semantic exit");
		test::runCpuParity(native.cpu, scalar.cpu, 1024);
		requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 4) == (guard == 0 ? valueNil() : valueInteger(9))
			&& native.cpu.readFrameRegister(0, 5) == valueInteger(1)
			&& native.cpu.readFrameRegister(0, 3) == (guard == 0 ? valueBool(false) : valueInteger(37)),
			"only the admitted cursor skips the next block and replaces the cached result");
#if defined(BMSX_NATIVE_GATE_PROFILE)
		const auto& exits = native.cpu.nativeGateProfile().exits;
		require(exits[static_cast<size_t>(NativeBlockExit::IterateTable)].entries == (nextPage ? 1u : 0u),
			"only an unresolved physical skip needs the iterator semantic dispatcher");
		if (!nextPage)
			require(exits[static_cast<size_t>(NativeBlockExit::Continue)].entries == 0
				&& exits[static_cast<size_t>(NativeBlockExit::Halt)].entries == 1,
				"both admitted and declined cursor edges reach their native successor without dispatch");
#endif
		if (!nextPage && guard == 0) {
			const Value cursor = native.cpu.readFrameRegister(0, 2);
			require(isNil(cursor) && valuePayload(cursor) != 0, "cursor write wins an overlapping result placement");
			history.capture(native.memory, &before, after);
			history.restore(native.memory, after, before);
			require(native.cpu.readFrameRegister(0, 2) == valueNil() && native.cpu.readFrameRegister(0, 3) == valueInteger(31),
				"rewind restores both cursor and result");
			history.restore(native.memory, before, after);
			require(native.cpu.readFrameRegister(0, 2) == cursor && native.cpu.readFrameRegister(0, 3) == valueBool(false),
				"forward replay recovers the physical cursor and the generated result");
		}
	}
#endif
}

void hashGrowthKeepsReservedArray() {
	test::Blua32TestImage image;
	image.text.resize(INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 1}};
	CpuMachine machine(image, true);
	auto& cpu = machine.cpu;
	auto mixed = bmsx::test::allocateTableReference(cpu, 8, 0), identity = bmsx::test::allocateTableReference(cpu);
	const auto text = cpu.stringPool().intern("hash only");
	const std::array keys{valueString(text), valueInteger(-1), valueFloat(0.5f), valueTable(identity.address())};
	const auto bytes = cpu.luaHeap().usedBytes();
	const auto retained = valueFloatBits(0xffc01234u);
	mixed.setInteger(8, retained);
	for (size_t i = 0; i < keys.size(); ++i) {
		mixed.set(keys[i], valueInteger(static_cast<i32>(i)));
		require(mixed.arrayCapacity() == 8 && mixed.getInteger(8) == retained
			&& cpu.luaHeap().usedBytes() == bytes + TableRecord::allocationCharge(0, TableRecord::hashCapacity(static_cast<int>(i + 1u))),
			"a non-array key never repartitions a sparse reserved array");
	}
	for (i32 slot = 1; slot < 8; ++slot) mixed.setInteger(slot, valueInteger(slot));
	mixed.set(valueFloat(9.f), retained);
	require(mixed.arrayCapacity() == 16 && mixed.hashSlots() == 4 && mixed.getInteger(9) == retained
		&& cpu.luaHeap().usedBytes() == bytes + 4u * 10u + 8u * 5u,
		"a canonical positive integer crossing the same frontier can still grow the array");
	for (size_t i = 0; i < keys.size(); ++i)
		require(mixed.get(keys[i]) == valueInteger(static_cast<i32>(i)), "array growth retains all ordinary hash keys");
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
		auto table = bmsx::test::allocateTableReference(cpu, 0, 1);
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
		auto receiver = bmsx::test::allocateTableReference(cpu, 0, 1), forwarded = bmsx::test::allocateTableReference(cpu, 0, 1);
		auto holder = bmsx::test::allocateTableReference(cpu, 0, 1), meta = bmsx::test::allocateTableReference(cpu, 0, 1);
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
		r.set(0, valueTable(bmsx::test::allocateTableReference(m->cpu, 0, 1).address())); r.set(1, valueString(m->cpu.stringPool().intern("field"))); r.set(9, valueInteger(1));
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
		auto& strings = m->cpu.stringPool(); auto retained = bmsx::test::allocateTableReference(m->cpu, 1024, 1);
		retained.setStringKey(strings.intern("payload"), valueString(strings.intern("retained")));
		auto receiver = bmsx::test::allocateTableReference(m->cpu, 0, full ? 1 : 0);
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
	test::runCpuParity(native.cpu, scalar.cpu, 516); requireParity(native, scalar);
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
		auto table = bmsx::test::allocateTableReference(cpu, 0, 2);
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
	require(read.decoded == &page.words[word].tableCacheSlot()
		&& write.decoded == &page.words[word + 1].tableCacheSlot(),
		"recompilation borrows the learned sites instead of creating independent writable seeds");
#endif
}

void nativeFieldCacheMissReturnsOwnValueAndTrainsTheSameSite() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETFIELD), 9, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 10, 9, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 11}};
	image.constants = {std::string("changing own slot")};

	CpuMachine native(image), scalar(image, true);
	const Value linkedValue = valueFloatBits(0x7fc01234u), singletonValue = valueFromTag(ValueTag::False, 37);
	int linkedSlot = -1;
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		const auto key = *cpu.stringPool().find("changing own slot");
		auto linked = bmsx::test::allocateTableReference(cpu, 3, 4), singleton = bmsx::test::allocateTableReference(cpu, 2, 1), missing = bmsx::test::allocateTableReference(cpu, 0, 1);
		const auto home = linked.beginStringProbe(key).node;
		StringId collider = 0;
		for (int i = 0; i < 64 && !collider; ++i) {
			const auto candidate = cpu.stringPool().intern("colliding field " + std::to_string(i));
			if (linked.beginStringProbe(candidate).node == home) collider = candidate;
		}
		require(collider && linked.setStringKey(collider, valueInteger(19)) == home,
			"the two persistent keys share the current receiver home");
		const int slot = linked.setStringKey(key, linkedValue);
		require(slot > 0 && slot != home && singleton.setStringKey(key, singletonValue) == 0,
			"real table writes place the same key in a chained slot and in singleton slot zero");
		if (machine == &native) linkedSlot = slot;
		else require(slot == linkedSlot, "both guest heaps have the same placement fixture");
		auto& frame = *cpu.activeThread()->currentFrame;
		frame.registers.set(5, valueTable(linked.address()));
		frame.registers.set(6, valueTable(singleton.address()));
		frame.registers.set(7, valueTable(missing.address()));
		frame.setTop(8);
		cpu.stringPool().intern("table");
	}

	auto& cpu = native.cpu;
	const u32 pc = native.rom.textAddress, word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto& activeImage = *cpu.activeThread()->currentFrame->executionImage;
	cpu.prepareSystemNativeCode();
	auto& page = *activeImage.nativeCodeLookup->find(pc, 0);
	const auto* installed = page.nativeBlocks->entries[word].get();
	require(installed != nullptr, "the fixed-key checkpoint is ready before observing a receiver");
	const auto region = installed->region;
	const auto fieldExit = std::ranges::find(installed->sideExits, NativeBlockExit::ReadField, &NativeBlockExitSite::exit);
	require(fieldExit != installed->sideExits.end() && fieldExit->currentPc == pc
		&& !fieldExit->operands.table.resultProof && !fieldExit->operands.table.reusePeerWord
		&& fieldExit->tableRead.decoded == &page.words[word].tableCacheSlot() && page.words[word].tableCacheSlot() == -1,
		"the untyped own lookup starts untrained and borrows its one decoded slot");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& fieldExits = cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::ReadField)].entries;
	const u64 initialExits = fieldExits;
#endif
	const int fieldCharge = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)];
	const auto read = [&](int receiver, Value expected, int extraCharge, int prediction) {
		for (auto* machine : {&native, &scalar}) {
			auto& owner = machine->cpu;
			owner.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
			auto& frame = *owner.activeThread()->currentFrame;
			frame.registers.set(0, frame.registers.get(receiver));
			frame.registers.set(9, valueInteger(57));
			frame.registers.set(10, valueInteger(73));
			frame.setTop(8);
		}
		require(test::runCpuParity(cpu, scalar.cpu, fieldCharge + extraCharge) == RunResult::Yielded
			&& cpu.instructionBudgetRemaining == 0 && cpu.readFrameRegister(0, 9) == expected
			&& cpu.readFrameRegister(0, 10) == valueInteger(73) && cpu.readFramePc(0) == pc + 2 * INSTRUCTION_BYTES
			&& cpu.activeThread()->currentFrame->readWindow(FrameField::Top) == 10,
			"the fixed read commits the live raw Value and its exact frontier without admitting the suffix");
		require(page.nativeBlocks->entries[word].get() == installed && installed->region == region
			&& page.words[word].tableCacheSlot() == prediction,
			"the same installed checkpoint keeps only the live own prediction");
		requireParity(native, scalar);
	};
	read(5, linkedValue, 0, linkedSlot);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(fieldExits == initialExits, "the initial receiver teaches its own slot without a semantic exit");
#endif
	for (int iteration = 0; iteration < 3; ++iteration) {
		read(6, singletonValue, 0, 0);
		read(5, linkedValue, 0, linkedSlot);
	}
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(fieldExits == initialExits, "a trained own miss handles out-of-range and wrong-key slots without a ReadField exit");
#endif
	read(7, valueNil(), 0, linkedSlot);
	for (auto* machine : {&native, &scalar}) {
		auto& owner = machine->cpu;
		auto receiver = asTable(owner.readFrameRegister(0, 7), owner.gcHeap());
		auto meta = bmsx::test::allocateTableReference(owner, 0, 1);
		meta.setStringKey(owner.stringPool().intern("__index"), owner.createBuiltinFunction(BuiltinFunctionId::Type));
		receiver.setMetatableAddress(meta.address());
	}
	read(7, valueString(*cpu.stringPool().find("table")), 2, linkedSlot);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(fieldExits == initialExits + 1, "only callable __index needs the semantic owner");
#endif
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
		auto table = bmsx::test::allocateTableReference(cpu, 0, 1);
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
		auto receiver = bmsx::test::allocateTableReference(cpu), meta = bmsx::test::allocateTableReference(cpu, 0, 1), holder = bmsx::test::allocateTableReference(cpu, 0, 1);
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
		&& native.cpu.readFrameRegister(0, 6) == valueInteger(41), "the first inherited read follows the live table");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const auto& entry = page.nativeBlocks->entries[(start & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(entry && entry->admissionCycles == prefix && entry->terminal.currentPc == field,
		"the installed entry admits the prefix separately from its checked field read");
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

void warmInheritedFieldReadsProveCollisionChainAbsence() {
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETFIELD), 3, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 4, 3, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 1, 0);
	constexpr u32 wideKey = 1u << BASE_OPERAND_BC_BITS;
	image.constants.resize(wideKey + 1u);
	image.constants[wideKey] = std::string("inherited collision field");
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 5}};

	CpuMachine native(image), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		const auto key = *cpu.stringPool().find("inherited collision field");
		const auto index = cpu.stringPool().intern("__index");
		auto receiver = bmsx::test::allocateTableReference(cpu, 2, 4), meta = bmsx::test::allocateTableReference(cpu, 0, 1);
		auto holder = bmsx::test::allocateTableReference(cpu, 0, 1), newHolder = bmsx::test::allocateTableReference(cpu, 0, 1);
		holder.setStringKey(key, valueInteger(41));
		newHolder.setStringKey(key, valueInteger(67));
		meta.setStringKey(index, valueTable(holder.address()));
		receiver.setMetatableAddress(meta.address());
		const auto home = receiver.beginStringProbe(key).node;
		require(home != 0, "the WIDE field must start at a nonzero home in its real receiver");
		std::array<StringId, 2> colliders;
		size_t found = 0;
		for (unsigned n = 0; n < 64 && found < colliders.size(); ++n) {
			const auto candidate = cpu.stringPool().intern("receiver collider " + std::to_string(n));
			if (receiver.beginStringProbe(candidate).node == home) colliders[found++] = candidate;
		}
		require(found == colliders.size(), "distinct interned keys have the same current receiver home as the field");
		require(receiver.setStringKey(colliders[0], valueInteger(13)) == home
			&& receiver.setStringKey(colliders[1], valueInteger(17)) != home && receiver.hashSlots() == 4,
			"ordinary insertions place an unrelated key at home and link another collision");
		auto probe = receiver.beginStringProbe(key);
		require(receiver.advanceStringProbe(key, probe, 1) == 1 && probe.node >= 0 && probe.node != home,
			"the actual receiver home contains a nonterminal collision link");
		require(receiver.advanceStringProbe(key, probe, 4) == 1 && probe.node < 0 && isNil(probe.value),
			"the requested field is absent after the actual chain is searched");
		auto& frame = *cpu.activeThread()->currentFrame;
		frame.registers.set(0, valueTable(receiver.address()));
		frame.registers.set(1, valueTable(newHolder.address()));
		frame.setTop(2);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	native.cpu.prepareSystemNativeCode();
#endif
	const u32 pc = native.rom.textAddress;
	const int field = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)];
	const int inherited = field + TABLE_INDEX_VISIT_CYCLES;
	const auto read = [&](Value expected, int cycles) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
			cpu.activeThread()->currentFrame->registers.set(4, valueInteger(73));
		}
		require(test::runCpuParity(native.cpu, scalar.cpu, cycles) == RunResult::Yielded
			&& native.cpu.instructionBudgetRemaining == 0, "only the field, exhausted collision links and inherited visits consume the grant");
		require(native.cpu.readCurrentInstructionPc() == pc && native.cpu.lastPc == pc + INSTRUCTION_BYTES
			&& native.cpu.readFramePc(0) == pc + 2 * INSTRUCTION_BYTES
			&& native.cpu.readFrameRegister(0, 3) == expected && native.cpu.readFrameRegister(0, 4) == valueInteger(73),
			"the WIDE read returns the live value and leaves the following MOV unexecuted");
		requireParity(native, scalar);
	};
	read(valueInteger(41), inherited + 1);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& readExits = native.cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::ReadField)];
	const u64 trained = readExits.entries;
	require(trained == 0, "the first inherited lookup completes without a semantic exit");
#endif
	read(valueInteger(41), inherited + 1);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(readExits.entries == trained, "the trained inherited read proves absence in the actual receiver collision chain");
#endif

	for (const Value own : {valueInteger(97), valueNil()}) {
		for (auto* machine : {&native, &scalar}) {
			auto& cpu = machine->cpu;
			const auto key = *cpu.stringPool().find("inherited collision field");
			const auto registers = cpu.activeThread()->currentFrame->registers;
			auto receiver = asTable(registers.get(0), cpu.gcHeap());
			const auto storage = receiver.hashAddress();
			auto liveProbe = receiver.beginStringProbe(key);
			const auto priorVisits = receiver.advanceStringProbe(key, liveProbe, liveProbe.remaining);
			const auto node = receiver.setStringKey(key, own);
			if (!isNil(own)) require(node >= 0 && node != receiver.beginStringProbe(key).node,
				"the inserted shadow occupies a chained slot rather than home");
			else {
				auto probe = receiver.beginStringProbe(key);
				require(priorVisits > 1 && liveProbe.value == valueInteger(97)
					&& receiver.advanceStringProbe(key, probe, probe.remaining) == priorVisits && isNil(probe.value),
					"deletion leaves the matched non-home key with a nil value in the chain");
				TableRecord(cpu.gcHeap(), receiver.metatableAddress()).setStringKey(cpu.stringPool().intern("__index"), registers.get(1));
			}
			require(receiver.hashAddress() == storage && receiver.hashSlots() == 4, "shadow updates keep the same receiver storage");
		}
#if defined(BMSX_NATIVE_GATE_PROFILE)
		const u64 before = readExits.entries;
#endif
		read(isNil(own) ? valueInteger(67) : own, isNil(own) ? inherited : field);
#if defined(BMSX_NATIVE_GATE_PROFILE)
		if (isNil(own)) require(readExits.entries == before, "a chained tombstone restores the warm path and sees the live prototype");
#endif
	}
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
	for (auto* machine : {&native, &scalar}) {
		test::seedTestRomClosure(machine->cpu, machine->rom.functionAddresses[3]);
		test::seedTestRomClosure(machine->cpu, machine->rom.functionAddresses[4]);
	}
	auto& cpu = native.cpu;
	cpu.prepareSystemNativeCode();
	require(test::runCpuParity(cpu, scalar.cpu, 100) == RunResult::Halted, "boot retains both verified closures");
	for (auto* machine : {&native, &scalar}) {
		auto& owner = machine->cpu;
		const auto index = owner.stringPool().intern("__index");
		auto holder = bmsx::test::allocateTableReference(owner, 0, 1);
		holder.setStringKey(*owner.stringPool().find("nested inherited field"), valueInteger(41));
		// Resolve two live table hops before returning across both pending calls.
		for (int depth = 0; depth < 2; ++depth) {
			auto receiver = bmsx::test::allocateTableReference(owner), meta = bmsx::test::allocateTableReference(owner, 0, 1);
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
		region->retire(NativeRetirement::Capacity);
	}
	cpu.prepareSystemNativeCode();
	for (const u32 instruction : {parent, middle}) {
		const u32 pc = text + instruction * INSTRUCTION_BYTES, word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		const auto& block = lookup.find(pc, 0)->nativeBlocks->entries[word];
		require(block && block->terminal.callStrategy == NativeCallStrategy::Fixed, "both frames can stay pending");
	}
	const auto& leafBlock = lookup.find(leafPc, 0)->nativeBlocks->entries[(leafPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	const auto fieldExit = std::ranges::find(leafBlock->sideExits, NativeBlockExit::ReadField, &NativeBlockExitSite::exit);
	require(fieldExit != leafBlock->sideExits.end() && fieldExit->currentPc == leafPc
		&& fieldExit->continuationCells[0] && *fieldExit->continuationCells[0], "the WIDE semantic lookup has a live native successor");

	// A resolved read can keep both callers pending, but both RETs must
	// replace stale inactive words even when nothing materializes a live frame.
	restart();
	thread.frameAtDepth(1)->writeControl(FrameField::Pc, 0x10203040u);
	thread.frameAtDepth(2)->writeControl(FrameField::Pc, 0x20304050u);
	require(test::runCpuParity(cpu, scalar.cpu, 200) == RunResult::Halted && thread.frameDepth() == 1
		&& cpu.readFrameRegister(0, 0) == valueInteger(41), "the result crosses both native returns before the caller halts");
	require(thread.frameAtDepth(1)->readControl(FrameField::Pc) == text + (middle + 2) * INSTRUCTION_BYTES
		&& thread.frameAtDepth(2)->readControl(FrameField::Pc) == leafPc + 3 * INSTRUCTION_BYTES,
		"both retired frame PCs record completed RETs rather than stale inactive words");
	for (const u32 depth : {1u, 2u}) {
		const auto& retired = *thread.frameAtDepth(depth);
		const auto& scalarRetired = *scalar.cpu.activeThread()->frameAtDepth(depth);
		for (u32 offset = 0; offset < FRAME_CONTROL_BYTES; offset += sizeof(u32)) {
			const auto field = static_cast<FrameField>(offset);
			require(retired.readControl(field) == scalarRetired.readControl(field),
				"the retired words from both native returns match scalar dispatch");
		}
	}
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
		registers.set(0, valueTable(bmsx::test::allocateTableReference(cpu, 4, 0).address()));
		registers.set(1, valueInteger(29));
		registers.set(2, valueInteger(1));
		auto fields = bmsx::test::allocateTableReference(cpu, 0, 1);
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
		const auto pressure = bmsx::test::allocateTableReference(cpu, 2 * GC_STEP_WORDS, 0);
		cpu.setGlobalByKey(cpu.stringPool().intern("mark pressure"), valueTable(pressure.address()));
		cpu.stepHeap(valueNil(), valueNil(), valueNil());
		require(cpu.gcHeap().phase() == GcPhase::Mark
			&& (machine->memory.readRamRecordByte(table.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3u
			&& (machine->memory.readRamRecordByte(fields.address() + GC_COLOR_OFFSET) & GC_COLOR_MASK) == 3u,
			"the receivers have both been visited before adding the new edges");
		registers.set(1, valueTable(bmsx::test::allocateTableReference(cpu).address()));
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
		auto table = bmsx::test::allocateTableReference(cpu, 1, 1), child = bmsx::test::allocateTableReference(cpu), meta = bmsx::test::allocateTableReference(cpu, 0, 1);
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

void nativeDynamicHashProbeReturnsLiveValuesWithinTheGrant() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::KSMI), 4, 0, 39);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::LOADK), 5, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::GETT), 1, 0, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::MOV), 9, 1, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 10}};
	image.constants = {Blua32FloatConstant{0x80000000u}};

	CpuMachine native(image), scalar(image, true);
	const Value indexed = valueFloatBits(0x7fc01234u), identity = valueFromTag(ValueTag::False, 37);
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto receiver = bmsx::test::allocateTableReference(cpu, 2, 4), key = bmsx::test::allocateTableReference(cpu), otherKey = bmsx::test::allocateTableReference(cpu);
		receiver.setInteger(1, valueInteger(61));
		receiver.setInteger(INT32_MIN, indexed);
		receiver.setInteger(INT32_MAX, valueInteger(-73));
		receiver.set(valueTable(key.address()), identity);
		receiver.setInteger(static_cast<i32>(key.address()), valueInteger(203));
		require(receiver.arrayCapacity() == 2 && receiver.hashSlots() == 4 && key.address() != otherKey.address(),
			"the signed-extreme keys are outside the array and the two empty tables have distinct identities");
		auto& frame = *cpu.activeThread()->currentFrame;
		frame.registers.set(0, valueTable(receiver.address()));
		frame.registers.set(6, valueTable(key.address()));
		frame.registers.set(7, valueTable(otherKey.address()));
		frame.setTop(8);
	}

	auto& cpu = native.cpu;
	const u32 pc = native.rom.textAddress, word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto& imageState = *cpu.activeThread()->currentFrame->executionImage;
	cpu.prepareSystemNativeCode();
	auto& page = *imageState.nativeCodeLookup->find(pc, 0);
	const auto* installed = page.nativeBlocks->entries[word].get();
	require(installed != nullptr, "the WIDE dynamic read has a native checkpoint");
	const auto region = installed->region;
	const auto exit = std::ranges::find(installed->sideExits, NativeBlockExit::ReadIndex, &NativeBlockExitSite::exit);
	require(exit != installed->sideExits.end() && exit->currentPc == pc + 2 * INSTRUCTION_BYTES,
		"the prefix and the dynamic GETT execute within the selected native block");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& readExits = cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::ReadIndex)].entries;
	const u64 originalExits = readExits;
#endif
	const int prefix = BASE_CYCLES[static_cast<u8>(OpCode::KSMI)] + BASE_CYCLES[static_cast<u8>(OpCode::LOADK)];
	const int field = BASE_CYCLES[static_cast<u8>(OpCode::GETT)];
	const int follow = BASE_CYCLES[static_cast<u8>(OpCode::MOV)];
	const auto read = [&](Value query, Value expected, int inheritedCost = 0, bool successor = true) {
		for (auto* machine : {&native, &scalar}) {
			auto& lane = machine->cpu;
			lane.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], pc);
			auto& frame = *lane.activeThread()->currentFrame;
			frame.registers.set(1, query);
			frame.registers.set(9, valueInteger(99));
			frame.setTop(8);
		}
		require(test::runCpuParity(cpu, scalar.cpu, prefix + field + inheritedCost + (successor ? follow : 0)) == RunResult::Yielded
			&& cpu.instructionBudgetRemaining == 0, "only the admitted guest prefix and exact lookup tariff consume the grant");
		require(cpu.readFrameRegister(0, 1) == expected && cpu.readFrameRegister(0, 4) == valueInteger(39)
			&& cpu.readFrameRegister(0, 5) == valueFloatBits(0x80000000u)
			&& cpu.readFrameRegister(0, 9) == (successor ? expected : valueInteger(99))
			&& cpu.readFramePc(0) == pc + (successor ? 5 : 4) * INSTRUCTION_BYTES,
			"the aliased result and live integer and float writes survive the returning lookup with no extra instruction");
		require(page.nativeBlocks->entries[word].get() == installed && installed->region == region,
			"lookup variants reuse the same installed native region");
		requireParity(native, scalar);
	};
	for (int warm = 0; warm < 3; ++warm) read(valueInteger(1), valueInteger(61));
	const Value key = cpu.readFrameRegister(0, 6), otherKey = cpu.readFrameRegister(0, 7);
	for (const bool successor : {false, true}) {
		read(valueInteger(INT32_MIN), indexed, 0, successor);
		read(valueInteger(INT32_MIN + 1), valueNil(), 0, successor);
		read(valueInteger(INT32_MAX), valueInteger(-73), 0, successor);
		read(valueInteger(INT32_MAX - 1), valueNil(), 0, successor);
		read(key, identity, 0, successor);
		read(valueInteger(static_cast<i32>(valuePayload(key))), valueInteger(203), 0, successor);
		read(otherKey, valueNil(), 0, successor);
	}
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(readExits == originalExits, "int32 and table-identity hits and absent keys complete without a ReadIndex exit");
#endif

	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		auto receiver = asTable(lane.readFrameRegister(0, 0), lane.gcHeap());
		auto meta = bmsx::test::allocateTableReference(lane, 0, 1), holder = bmsx::test::allocateTableReference(lane, 0, 1);
		holder.set(lane.readFrameRegister(0, 7), valueInteger(107));
		meta.setStringKey(lane.stringPool().intern("__index"), valueTable(holder.address()));
		receiver.setMetatableAddress(meta.address());
	}
	read(valueInteger(INT32_MIN), indexed);
	read(otherKey, valueInteger(107), TABLE_INDEX_VISIT_CYCLES);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(readExits == originalExits + 1, "a live own hash entry stays native; only the inherited miss needs __index");
#endif
#endif
}

void nativeIdentityHashStoreReturnsWithinTheGrant() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	constexpr int receiverSlot = 256, methodSlot = 10, keysSlot = 16;
	constexpr int loop = 16, method = 32, trap = 48, methodArgs = 3;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), methodSlot, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, loop, static_cast<u8>(OpCode::MOV), 2, 8, 0);
	writeInstruction(image.text, loop + 1, static_cast<u8>(OpCode::KSMI), 4, 0, 39);
	writeInstruction(image.text, loop + 2, static_cast<u8>(OpCode::WIDE), 1, 0, 0);
	writeInstruction(image.text, loop + 3, static_cast<u8>(OpCode::SETT), 0, 1, 2);
	writeInstruction(image.text, loop + 4, static_cast<u8>(OpCode::MOV), 9, 2, 0);
	writeInstruction(image.text, loop + 5, static_cast<u8>(OpCode::MOV), 11, 4, 0);
	writeInstruction(image.text, loop + 6, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255);
	writeInstruction(image.text, method, static_cast<u8>(OpCode::SETI), 0, 1, 2);
	writeInstruction(image.text, method + 1, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, trap, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, trap + 1, static_cast<u8>(OpCode::RFE), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = receiverSlot + 1},
		{.firstWord = loop, .wordCount = 7, .maxStack = receiverSlot + 1},
		{.firstWord = method, .wordCount = 2, .numParams = methodArgs, .maxStack = methodArgs},
		{.firstWord = trap, .wordCount = 2}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};
	image.exceptionFunctionIndex = 3;

	CpuMachine native(image), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		test::seedTestRomClosure(machine->cpu, machine->rom.functionAddresses[2]);
	}
	auto& cpu = native.cpu;
	const auto cycles = [](OpCode op) { return BASE_CYCLES[static_cast<u8>(op)]; };
	const int prefix = cycles(OpCode::MOV) + cycles(OpCode::KSMI);
	const int throughStore = prefix + cycles(OpCode::SETT);
	const int throughSuffix = throughStore + 2 * cycles(OpCode::MOV);
	const u32 pc = native.rom.textAddress + loop * INSTRUCTION_BYTES;
	const u32 storePc = pc + 2 * INSTRUCTION_BYTES, suffixPc = pc + 4 * INSTRUCTION_BYTES;
	require(test::runCpuParity(cpu, scalar.cpu, cycles(OpCode::CLOSURE)) == RunResult::Yielded,
		"the two lanes first create the real __newindex closure");
	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		auto& frame = *lane.activeThread()->currentFrame;
		auto receiver = bmsx::test::allocateTableReference(lane, 1, 0);
		frame.registers.set(receiverSlot, valueTable(receiver.address()));
		frame.registers.set(3, valueNil());
		frame.setTop(receiverSlot + 1);
		receiver.setInteger(1, valueInteger(61));
		receiver.setMetatableAddress(bmsx::test::allocateTableReference(lane, 0, 1).address());
		std::array<Value, 5> keys;
		for (size_t i = 0; i < keys.size(); ++i) {
			keys[i] = valueTable(bmsx::test::allocateTableReference(lane).address());
			frame.registers.set(keysSlot + i, keys[i]);
		}
		// Five distinct identities guarantee a collision among four hash homes.
		for (size_t i = 1; i < keys.size(); ++i) {
			const u32 home = hashCanonicalTableKey(keys[i]) & 3u;
			const auto end = keys.begin() + i;
			const auto collider = std::find_if(keys.begin(), end, [home](Value key) {
				return (hashCanonicalTableKey(key) & 3u) == home;
			});
			if (collider == end) continue;
			std::iter_swap(keys.begin(), collider);
			std::swap(keys[3], keys[i]);
			break;
		}
		require(keys[0] != keys[3] && ((hashCanonicalTableKey(keys[0]) ^ hashCanonicalTableKey(keys[3])) & 3u) == 0u,
			"the new identity collides with a different live identity");
		for (size_t i = 0; i < keys.size(); ++i) frame.registers.set(keysSlot + i, keys[i]);
		for (int i = 0; i < 3; ++i) receiver.set(keys[i], valueInteger(21 + i));
		require(receiver.hashSlots() == 4 && isNil(receiver.get(keys[3])),
			"three ordinary insertions leave one spare slot with no explicit reserve");
	}
	const auto start = [&](int keySlot, Value value) {
		for (auto* machine : {&native, &scalar}) {
			auto& lane = machine->cpu;
			lane.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[1], pc);
			auto registers = lane.activeThread()->currentFrame->registers;
			registers.set(1, registers.get(keySlot));
			registers.set(8, value);
			registers.set(9, valueInteger(-9));
			registers.set(11, valueInteger(-11));
		}
	};
	start(keysSlot, valueInteger(21));
	require(test::runCpuParity(cpu, scalar.cpu, NATIVE_WARM_SCALE * 16
		* (throughSuffix + cycles(OpCode::JMP))) == RunResult::Yielded,
		"the real Table-identity store and its successor warm in a guest loop");
	auto& page = *cpu.activeThread()->currentFrame->decodedPage;
	const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(cpu, page, word);
	const auto* installed = page.nativeBlocks->entries[word].get();
	const auto exit = std::ranges::find(installed->sideExits, NativeBlockExit::WriteIndex, &NativeBlockExitSite::exit);
	require(exit != installed->sideExits.end() && exit->currentPc == storePc && exit->nextPc == suffixPc,
		"the warmed native body has the real WIDE store and its exact fallback frontier");
	requireParity(native, scalar);

	auto receiver = asTable(cpu.readFrameRegister(0, receiverSlot), cpu.gcHeap());
	const Value inserted = cpu.readFrameRegister(0, keysSlot + 3), grows = cpu.readFrameRegister(0, keysSlot + 4);
	const Value raw = valueFloatBits(0x7fc01234u);
	const u32 storage = receiver.hashAddress();
	const auto bytes = cpu.luaHeap().usedBytes();
	const auto charge = TableRecord::allocationCharge(0, 1);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& writeExits = cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::WriteIndex)].entries;
	const auto warmExits = writeExits;
#endif
	start(keysSlot + 3, raw);
	require(test::runCpuParity(cpu, scalar.cpu, prefix) == RunResult::Yielded
		&& cpu.readFramePc(0) == storePc && isNil(receiver.get(inserted))
		&& cpu.luaHeap().usedBytes() == bytes,
		"an exhausted prefix cannot enter the store or charge its mapping");
	requireParity(native, scalar);
	start(keysSlot + 3, raw);
	require(test::runCpuParity(cpu, scalar.cpu, throughStore) == RunResult::Yielded
		&& cpu.instructionBudgetRemaining == 0 && cpu.readCurrentInstructionPc() == storePc
		&& cpu.lastPc == storePc + INSTRUCTION_BYTES && cpu.readFramePc(0) == suffixPc
		&& cpu.readFrameRegister(0, 9) == valueInteger(-9),
		"an exact grant commits the WIDE store without executing its successor");
	require(receiver.get(inserted) == raw && receiver.getInteger(1) == valueInteger(61)
		&& receiver.get(cpu.readFrameRegister(0, keysSlot)) == valueInteger(21)
		&& receiver.hashAddress() == storage && cpu.luaHeap().usedBytes() == bytes,
		"colliding identities remain distinct and insertion reuses paid-for storage");
	requireParity(native, scalar);
	start(keysSlot + 3, grows);
	require(test::runCpuParity(cpu, scalar.cpu, throughSuffix) == RunResult::Yielded
		&& cpu.instructionBudgetRemaining == 0 && cpu.readFramePc(0) == pc + 6 * INSTRUCTION_BYTES
		&& cpu.readFrameRegister(0, 9) == grows && cpu.readFrameRegister(0, 11) == valueInteger(39)
		&& receiver.get(inserted) == grows && cpu.luaHeap().usedBytes() == bytes,
		"a live overwrite at full occupancy returns to the generated suffix, preserving both prefix values");
	require(page.nativeBlocks->entries[word].get() == installed, "the complete grant reuses the warmed executable");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(writeExits == warmExits, "the in-capacity insert and overwrite avoid the materialized WriteIndex exit");
#endif
	requireParity(native, scalar);

	start(keysSlot + 4, raw);
	require(test::runCpuParity(cpu, scalar.cpu, throughSuffix) == RunResult::Yielded
		&& receiver.hashSlots() == 8 && receiver.get(grows) == raw && receiver.get(inserted) == grows
		&& cpu.luaHeap().usedBytes() == bytes + 4 * charge
		&& cpu.readFrameRegister(0, 9) == raw && cpu.readFrameRegister(0, 11) == valueInteger(39),
		"a full table grows and continues with the live native registers");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(writeExits == warmExits, "ordinary growth returns to the native body without WriteIndex");
#endif
	requireParity(native, scalar);
	start(keysSlot + 3, valueNil());
	require(test::runCpuParity(cpu, scalar.cpu, throughStore) == RunResult::Yielded
		&& isNil(receiver.get(inserted)) && receiver.get(grows) == raw && cpu.luaHeap().usedBytes() == bytes + 4 * charge,
		"a nil value removes the colliding mapping without releasing its reserved slot");
	start(keysSlot + 3, valueNil());
	require(test::runCpuParity(cpu, scalar.cpu, throughSuffix) == RunResult::Yielded
		&& isNil(receiver.get(inserted)) && isNil(cpu.readFrameRegister(0, 9)),
		"nil to the missing identity returns through the same native suffix");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(writeExits == warmExits, "a setter-free metatable permits insertion, growth, deletion and a missing nil write");
#endif
	requireParity(native, scalar);

	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		auto& thread = *lane.activeThread();
		thread.reserveFrame(thread.stackTop() + methodArgs);
		const auto meta = asTable(lane.readFrameRegister(0, receiverSlot), lane.gcHeap()).metatableAddress();
		TableRecord(lane.gcHeap(), meta).setStringKey(lane.stringPool().intern("__newindex"), lane.readFrameRegister(0, methodSlot));
	}
	start(keysSlot + 3, raw);
	// An implicit call copies its three arguments from outside the shared stack.
	require(test::runCpuParity(cpu, scalar.cpu, throughStore + methodArgs) == RunResult::Yielded
		&& cpu.instructionBudgetRemaining == 0 && cpu.getFrameDepth() == 2
		&& cpu.readFramePc(0) == suffixPc && cpu.readFrameRegister(1, 0) == valueTable(receiver.address())
		&& cpu.readFrameRegister(1, 1) == inserted && cpu.readFrameRegister(1, 2) == raw
		&& receiver.getInteger(1) == valueInteger(61) && isNil(receiver.get(inserted)),
		"callable __newindex sees the live receiver, key and value before the pending append or caller suffix");
	requireParity(native, scalar);
	require(test::runCpuParity(cpu, scalar.cpu, cycles(OpCode::SETI) + cycles(OpCode::RET) + 2 * cycles(OpCode::MOV)) == RunResult::Yielded
		&& cpu.getFrameDepth() == 1 && receiver.getInteger(1) == raw && isNil(receiver.get(inserted))
		&& cpu.readFrameRegister(0, 9) == raw && cpu.readFrameRegister(0, 11) == valueInteger(39),
		"the callable writes its observable marker and returns once to the saved successor");
	requireParity(native, scalar);

	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		asTable(lane.readFrameRegister(0, receiverSlot), lane.gcHeap()).setMetatableAddress(0);
	}
	start(3, raw);
	require(test::runCpuParity(cpu, scalar.cpu, throughStore + cycles(OpCode::HALT)) == RunResult::Halted
		&& cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INDEX_NIL && cpu.readEpcWord() == storePc
		&& cpu.readFrameRegister(0, 9) == valueInteger(-9) && receiver.get(grows) == raw,
		"a nil key traps at the WIDE prefix without assigning or executing the suffix");
	requireParity(native, scalar);
#endif
}

void nativeArrayStoresFollowHistorySessions() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(2u * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::SETI), 0, 1, 2);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0u, .wordCount = 2u, .maxStack = 3u}};
	CpuMachine machine(image);
	auto& cpu = machine.cpu;
	auto& memory = machine.memory;
	auto& watches = memory.ramWriteWatches();
	auto table = bmsx::test::allocateTableReference(cpu, 4096, 0);
	table.setMetatableAddress(bmsx::test::allocateTableReference(cpu).address());
	auto& frame = *cpu.activeThread()->currentFrame;
	frame.registers.set(0, valueTable(table.address()));
	frame.registers.set(2, valueInteger(101));
	frame.setTop(3);
	const u32 pc = machine.rom.textAddress, word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	cpu.prepareSystemNativeCode();
	const auto& page = *frame.executionImage->nativeCodeLookup->find(pc, 0);
	const std::weak_ptr<NativeCodeRegion> unrecorded = page.nativeBlocks->entries[word]->region;
	const int grant = BASE_CYCLES[static_cast<u8>(OpCode::SETI)] + BASE_CYCLES[static_cast<u8>(OpCode::JMP)];
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& storeExits = cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::WriteInteger)].entries;
	const auto before = storeExits;
#endif
	require(cpu.runUntilDepth(0, grant) == RunResult::Yielded && cpu.readFramePc(0) == pc
		&& table.getInteger(1) == valueInteger(101) && table.lengthHint() == 1,
		"the published unrecorded store appends within its grant");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(storeExits == before, "the unrecorded append does not exit at a store watch");
#endif
	table.setInteger(1, valueNil());
	RamHistory history;
	RamHistory::PageMap first, second;
	history.capture(memory, nullptr, first);
	cpu.runUntilDepth(0, 0);
	require(unrecorded.expired() && page.nativeCode[word] == nullptr,
		"the first checkpoint unpublishes every entry of the unrecorded region before execution");
	cpu.prepareSystemNativeCode();
	const std::weak_ptr<NativeCodeRegion> recorded = page.nativeBlocks->entries[word]->region;
	require(cpu.runUntilDepth(0, grant) == RunResult::Yielded && cpu.readFramePc(0) == pc
		&& table.getInteger(1) == valueInteger(101) && table.lengthHint() == 1,
		"the replacement history-aware store appends within the same grant");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(storeExits == before + 1, "the recorded append publishes its first physical writes");
#endif
	history.capture(memory, &first, second);
	cpu.runUntilDepth(0, 0);
	require(recorded.lock() == page.nativeBlocks->entries[word]->region,
		"checkpoint re-arming retains the recording-mode native region");
	history.restore(memory, second, first);
	require(isNil(table.getInteger(1)) && table.lengthHint() == 0,
		"rewinding restores the original value lanes and length hint");
	history.restore(memory, first, second);
	require(table.getInteger(1) == valueInteger(101) && table.lengthHint() == 1,
		"forward restoration recovers every lane of the native append");
	watches.disarmHistoryWrites();
	cpu.prepareSystemNativeCode();
	require(recorded.expired() && page.nativeCode[word] != nullptr,
		"explicit preparation replaces the recording region when history ends");
	table.setInteger(1, valueNil());
	require(cpu.runUntilDepth(0, grant) == RunResult::Yielded && cpu.readFramePc(0) == pc
		&& table.getInteger(1) == valueInteger(101) && table.lengthHint() == 1,
		"native appends resume without rewind after stopping history");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(storeExits == before + 1, "disabling history restores the unobserved native route");
#endif
	auto meta = TableRecord(cpu.gcHeap(), table.metatableAddress());
	auto destination = bmsx::test::allocateTableReference(cpu, 1, 0);
	meta.setStringKey(cpu.stringPool().intern("__newindex"), valueTable(destination.address()));
	table.setInteger(1, valueNil());
	require(cpu.runUntilDepth(0, grant + TABLE_INDEX_VISIT_CYCLES) == RunResult::Yielded
		&& cpu.readFramePc(0) == pc && isNil(table.getInteger(1)) && destination.getInteger(1) == valueInteger(101),
		"the installed array store sees a newly installed __newindex and forwards the missing element");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(storeExits == before + 2, "installing the setter takes exactly one semantic store exit");
#endif
#endif
}

void nativeIntegerGrowthReturnsWithinTheGrant() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 6, 4, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETT), 0, 1, 6);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::SETI), 2, 2, 6);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::SETT), 7, 3, 6);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::MOV), 5, 6, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 8}};

	CpuMachine native(image), scalar(image, true);
	const Value retained = valueFromTag(ValueTag::False, 37), appended = valueFloatBits(0x7fc01234u);
	constexpr i32 negativeKey = INT32_MIN + 2;
	for (auto* machine : {&native, &scalar}) {
		auto& cpu = machine->cpu;
		auto dynamic = bmsx::test::allocateTableReference(cpu, 1, 0), immediate = bmsx::test::allocateTableReference(cpu, 1, 0), signedHash = bmsx::test::allocateTableReference(cpu, 1, 1);
		const auto meta = bmsx::test::allocateTableReference(cpu);
		for (auto* table : {&dynamic, &immediate, &signedHash}) {
			table->setInteger(1, retained);
			table->setMetatableAddress(meta.address());
		}
		signedHash.setInteger(-1, valueInteger(73));
		auto& frame = *cpu.activeThread()->currentFrame;
		frame.registers.set(0, valueTable(dynamic.address()));
		frame.registers.set(1, valueInteger(2));
		frame.registers.set(2, valueTable(immediate.address()));
		frame.registers.set(3, valueInteger(negativeKey));
		frame.registers.set(4, appended);
		frame.registers.set(7, valueTable(signedHash.address()));
		frame.setTop(8);
	}

	auto& cpu = native.cpu;
	const u32 pc = native.rom.textAddress, word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto& imageState = *cpu.activeThread()->currentFrame->executionImage;
	cpu.prepareSystemNativeCode();
	const auto* page = imageState.nativeCodeLookup->find(pc, 0);
	require(page && page->nativeBlocks && page->nativeBlocks->entries[word],
		"the verified integer stores enter an installed native body");
	const auto* installed = page->nativeBlocks->entries[word].get();
	auto dynamic = asTable(cpu.readFrameRegister(0, 0), cpu.gcHeap());
	auto immediate = asTable(cpu.readFrameRegister(0, 2), cpu.gcHeap());
	auto signedHash = asTable(cpu.readFrameRegister(0, 7), cpu.gcHeap());
	const u32 dynamicStorage = dynamic.arrayAddress(), immediateStorage = immediate.arrayAddress();
	require(dynamic.arrayCapacity() == 1 && dynamic.lengthHint() == 1
		&& immediate.arrayCapacity() == 1 && immediate.lengthHint() == 1 && signedHash.hashSlots() == 1,
		"the two array parts and the negative-key hash start full");
	const auto bytes = cpu.luaHeap().usedBytes();
	const auto delta = 2 * (TableRecord::allocationCharge(2, 0) - TableRecord::allocationCharge(1, 0))
		+ TableRecord::allocationCharge(1, 2) - TableRecord::allocationCharge(1, 1);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto before = cpu.nativeGateProfile().exits;
#endif
	const auto cycles = [](OpCode op) { return BASE_CYCLES[static_cast<u8>(op)]; };
	const int grant = 2 * cycles(OpCode::MOV) + 2 * cycles(OpCode::SETT) + cycles(OpCode::SETI) + cycles(OpCode::HALT);
	require(test::runCpuParity(cpu, scalar.cpu, grant) == RunResult::Halted
		&& cpu.instructionBudgetRemaining == 0 && cpu.readFramePc(0) == pc + 6 * INSTRUCTION_BYTES
		&& cpu.readFrameRegister(0, 5) == appended,
		"all three returning stores preserve the live native value through the exact grant and suffix");
	require(dynamic.arrayCapacity() == 2 && immediate.arrayCapacity() == 2 && dynamic.arrayAddress() == dynamicStorage && immediate.arrayAddress() == immediateStorage,
		"register-key and immediate dense appends both use the capacity of their original chunks");
	for (const auto* table : {&dynamic, &immediate}) {
		require(table->arrayCapacity() == 2 && table->hashSlots() == 0 && table->lengthHint() == 2
			&& table->getInteger(1) == retained && table->getInteger(2) == appended,
			"array growth preserves the raw prefix, writes the new value, and advances the length hint");
	}
	require(signedHash.arrayCapacity() == 1 && signedHash.hashSlots() == 2 && signedHash.lengthHint() == 1
		&& signedHash.getInteger(1) == retained && signedHash.getInteger(-1) == valueInteger(73)
		&& signedHash.getInteger(negativeKey) == appended && cpu.luaHeap().usedBytes() == bytes + delta,
		"a signed out-of-array key grows only the hash and charges only the resulting logical storage");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& after = cpu.nativeGateProfile().exits;
	const auto halt = static_cast<size_t>(NativeBlockExit::Halt);
	require(after[halt].entries == before[halt].entries + 1, "generated execution reaches the intended native HALT");
	for (const auto exit : {NativeBlockExit::WriteIndex, NativeBlockExit::WriteInteger, NativeBlockExit::ScalarBoundary}) {
		const auto kind = static_cast<size_t>(exit);
		require(after[kind].entries == before[kind].entries, "ordinary integer growth needs no materialized store or scalar replay");
	}
#endif
	require(page->nativeBlocks->entries[word].get() == installed, "all growth preserves the installed native body");
	requireParity(native, scalar);
#endif
}

void nativeFixedStringMissReturnsWithinTheGrant([[maybe_unused]] u8 extraHashSlots) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	image.constants = {std::string("retained field")};
	constexpr int receiverSlot = 256, methodSlot = 10, warmSlot = 12, spareSlot = 13, fullSlot = 14, metaSlot = 15;
	constexpr int loop = 16, method = 32, methodArgs = 3, nilLoop = 48, nilFunction = 3;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), methodSlot, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, loop, static_cast<u8>(OpCode::MOV), 2, 8, 0);
	writeInstruction(image.text, loop + 1, static_cast<u8>(OpCode::KSMI), 4, 0, 39);
	writeInstruction(image.text, loop + 2, static_cast<u8>(OpCode::WIDE), 1, 0, 0, extraHashSlots);
	writeInstruction(image.text, loop + 3, static_cast<u8>(OpCode::SETFIELD), 0, 0, 2);
	writeInstruction(image.text, loop + 4, static_cast<u8>(OpCode::MOV), 9, 2, 0);
	writeInstruction(image.text, loop + 5, static_cast<u8>(OpCode::MOV), 11, 4, 0);
	writeInstruction(image.text, loop + 6, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255);
	writeInstruction(image.text, method, static_cast<u8>(OpCode::SETI), 0, 1, 2);
	writeInstruction(image.text, method + 1, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, nilLoop, static_cast<u8>(OpCode::KNIL), 2, 0, 0);
	writeInstruction(image.text, nilLoop + 1, static_cast<u8>(OpCode::WIDE), 1, 0, 0, extraHashSlots);
	writeInstruction(image.text, nilLoop + 2, static_cast<u8>(OpCode::SETFIELD), 0, 0, 2);
	writeInstruction(image.text, nilLoop + 3, static_cast<u8>(OpCode::MOV), 9, 2, 0);
	writeInstruction(image.text, nilLoop + 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = receiverSlot + 1},
		{.firstWord = loop, .wordCount = 7, .maxStack = receiverSlot + 1},
		{.firstWord = method, .wordCount = 2, .numParams = methodArgs, .maxStack = methodArgs},
		{.firstWord = nilLoop, .wordCount = 5, .maxStack = receiverSlot + 1}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};

	CpuMachine native(image), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		test::seedTestRomClosure(machine->cpu, machine->rom.functionAddresses[2]);
	}
	auto& cpu = native.cpu;
	const auto cycles = [](OpCode op) { return BASE_CYCLES[static_cast<u8>(op)]; };
	const int throughStore = cycles(OpCode::MOV) + cycles(OpCode::KSMI) + cycles(OpCode::SETFIELD);
	const int throughSuffix = throughStore + 2 * cycles(OpCode::MOV);
	const u32 pc = native.rom.textAddress + loop * INSTRUCTION_BYTES;
	const u32 storePc = pc + 2 * INSTRUCTION_BYTES, suffixPc = pc + 4 * INSTRUCTION_BYTES;
	require(test::runCpuParity(cpu, scalar.cpu, cycles(OpCode::CLOSURE)) == RunResult::Yielded,
		"the test first creates the actual __newindex closure");
	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		auto& frame = *lane.activeThread()->currentFrame;
		auto& strings = lane.stringPool();
		const auto field = *strings.find("retained field");
		auto warm = bmsx::test::allocateTableReference(lane, 1, 4), spare = bmsx::test::allocateTableReference(lane, 1, 0), full = bmsx::test::allocateTableReference(lane, 1, 1);
		auto meta = bmsx::test::allocateTableReference(lane, 0, 2);
		frame.registers.set(warmSlot, valueTable(warm.address()));
		frame.registers.set(spareSlot, valueTable(spare.address()));
		frame.registers.set(fullSlot, valueTable(full.address()));
		frame.registers.set(metaSlot, valueTable(meta.address()));
		frame.setTop(receiverSlot + 1);
		for (auto* table : {&warm, &spare, &full}) table->setInteger(1, valueInteger(61));
		const auto home = warm.setStringKey(field, valueBool(false));
		for (int i = 0; i < 64; ++i) {
			const auto candidate = strings.intern("field collider " + std::to_string(i));
			if (warm.beginStringProbe(candidate).node != home) continue;
			spare.setStringKey(candidate, valueInteger(27));
			break;
		}
		const auto resident = strings.intern("resident field");
		full.setStringKey(resident, valueInteger(31));
		spare.setStringKey(resident, valueInteger(31));
		spare.setStringKey(strings.intern("third field"), valueInteger(37));
		require(spare.hashSlots() == 4 && isNil(spare.getStringKey(field)),
			"three unreserved entries leave exactly one spare hash slot");
		meta.setStringKey(strings.intern("unrelated metatable field"), valueInteger(9));
		spare.setMetatableAddress(meta.address());
	}
	const auto start = [&](int table, Value value, int function = 1) {
		for (auto* machine : {&native, &scalar}) {
			auto& lane = machine->cpu;
			const u32 entry = machine->rom.textAddress + (function == nilFunction ? nilLoop : loop) * INSTRUCTION_BYTES;
			lane.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[function], entry);
			auto registers = lane.activeThread()->currentFrame->registers;
			registers.set(receiverSlot, registers.get(table));
			registers.set(8, value);
			registers.set(9, valueInteger(-9));
			registers.set(11, valueInteger(-11));
		}
	};
	start(warmSlot, valueBool(false));
	require(test::runCpuParity(cpu, scalar.cpu, NATIVE_WARM_SCALE * 16
		* (throughSuffix + cycles(OpCode::JMP))) == RunResult::Yielded, "the real fixed field warms a live native entry");
	auto& page = *cpu.activeThread()->currentFrame->decodedPage;
	const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(cpu, page, word);
	const auto* installed = page.nativeBlocks->entries[word].get();
	const auto exit = std::ranges::find(installed->sideExits, NativeBlockExit::WriteField, &NativeBlockExitSite::exit);
	require(exit != installed->sideExits.end() && exit->currentPc == storePc && exit->nextPc == suffixPc
		&& exit->operands.table.extraHashSlots == extraHashSlots,
		"the warmed body contains the WIDE SETFIELD checkpoint and its immutable growth operand");
	auto& prediction = *exit->tableStore.decoded;
	const auto originalSlot = prediction;
	require(originalSlot >= 0, "the first receiver trained the actual store site");
	requireParity(native, scalar);

	const auto field = *cpu.stringPool().find("retained field");
	auto warm = asTable(cpu.readFrameRegister(0, warmSlot), cpu.gcHeap());
	auto spare = asTable(cpu.readFrameRegister(0, spareSlot), cpu.gcHeap());
	auto full = asTable(cpu.readFrameRegister(0, fullSlot), cpu.gcHeap());
	const auto grownHash = TableRecord::hashCapacity(2 + extraHashSlots);
	const auto charge = TableRecord::allocationCharge(0, grownHash) - TableRecord::allocationCharge(0, 1);
	const Value raw = valueFloatBits(0x7fc01234u);
	const auto initialStorage = spare.hashAddress();
	const auto initialBytes = cpu.luaHeap().usedBytes();
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& writeExits = cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::WriteField)].entries;
	const auto warmExits = writeExits;
#endif
	start(spareSlot, valueNil());
	const auto freeBeforeMiss = spare.hashFree();
	require(test::runCpuParity(cpu, scalar.cpu, throughSuffix) == RunResult::Yielded
		&& cpu.instructionBudgetRemaining == 0 && cpu.readFramePc(0) == pc + 6 * INSTRUCTION_BYTES
		&& isNil(cpu.readFrameRegister(0, 9)) && cpu.readFrameRegister(0, 11) == valueInteger(39)
		&& prediction == -1 && spare.hashAddress() == initialStorage && spare.hashFree() == freeBeforeMiss
		&& cpu.luaHeap().usedBytes() == initialBytes,
		"nil to a missing field returns as a no-op when the metatable has no __newindex");
	TableLookupResult absent;
	spare.resolveStringAssignment(field, absent);
	require(absent.status == TableLookupStatus::Store && absent.slot == TABLE_HASH_UNPROBED && isNil(spare.getStringKey(field)),
		"the no-op does not create a new hash node or a tombstone");
	requireParity(native, scalar);

	start(spareSlot, raw);
	require(test::runCpuParity(cpu, scalar.cpu, throughStore) == RunResult::Yielded
		&& cpu.instructionBudgetRemaining == 0 && cpu.readCurrentInstructionPc() == storePc
		&& cpu.lastPc == storePc + INSTRUCTION_BYTES && cpu.readFramePc(0) == suffixPc
		&& cpu.readFrameRegister(0, 9) == valueInteger(-9),
		"the exact WIDE grant commits the field without executing the suffix");
	int insertedSlot = -1;
	require(spare.getStringKeyCached(field, insertedSlot) == raw && prediction == insertedSlot && prediction != originalSlot
		&& spare.hashAddress() == initialStorage && cpu.luaHeap().usedBytes() == initialBytes
		&& spare.getInteger(1) == valueInteger(61),
		"absent __newindex allows a colliding own insertion and trains its actual slot without touching the array");
	requireParity(native, scalar);

	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		auto meta = asTable(lane.readFrameRegister(0, metaSlot), lane.gcHeap());
		meta.setStringKey(lane.stringPool().intern("__newindex"), lane.readFrameRegister(0, methodSlot));
		asTable(lane.readFrameRegister(0, warmSlot), lane.gcHeap()).setMetatableAddress(meta.address());
	}
	start(warmSlot, raw);
	require(test::runCpuParity(cpu, scalar.cpu, throughSuffix) == RunResult::Yielded
		&& cpu.getFrameDepth() == 1 && cpu.readFramePc(0) == pc + 6 * INSTRUCTION_BYTES
		&& cpu.readFrameRegister(0, 9) == raw && cpu.readFrameRegister(0, 11) == valueInteger(39)
		&& warm.getStringKey(field) == raw && warm.getInteger(1) == valueInteger(61) && prediction == originalSlot,
		"a stale slot recovers the live false field despite callable __newindex and continues natively");
	require(page.nativeBlocks->entries[word].get() == installed, "store feedback keeps the original body");
	requireParity(native, scalar);

	const auto warmStorage = warm.hashAddress();
	const auto beforeOwnDelete = cpu.luaHeap().usedBytes();
	start(warmSlot, valueNil());
	require(test::runCpuParity(cpu, scalar.cpu, throughStore) == RunResult::Yielded
		&& cpu.instructionBudgetRemaining == 0 && cpu.getFrameDepth() == 1 && cpu.readFramePc(0) == suffixPc
		&& prediction == -1 && isNil(warm.getStringKey(field)) && warm.getInteger(1) == valueInteger(61)
		&& warm.hashAddress() == warmStorage && cpu.luaHeap().usedBytes() == beforeOwnDelete,
		"a live own field deletes before callable __newindex and clears the prediction");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(writeExits == warmExits, "warm insert, overwrite, nil no-op and deletion all return without WriteField");
#endif
	requireParity(native, scalar);

	start(fullSlot, raw);
	require(test::runCpuParity(cpu, scalar.cpu, throughSuffix) == RunResult::Yielded
		&& full.hashSlots() == grownHash && full.getStringKey(field) == raw
		&& full.getStringKey(*cpu.stringPool().find("resident field")) == valueInteger(31)
		&& cpu.readFrameRegister(0, 9) == raw && cpu.readFrameRegister(0, 11) == valueInteger(39),
		"a full hash grows and returns with the live native prefix");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(writeExits == warmExits, "fixed field growth returns without the VM handoff");
#endif
	requireParity(native, scalar);
	int grownSlot = -1;
	require(full.getStringKeyCached(field, grownSlot) == raw && prediction == grownSlot,
		"feedback names the slot in the new storage, not the retired body");
	const auto fullStorage = full.hashAddress();
	const auto beforeFullDelete = cpu.luaHeap().usedBytes();
	for (int attempt = 0; attempt < 2; ++attempt) {
		start(fullSlot, valueNil());
		require(test::runCpuParity(cpu, scalar.cpu, throughStore) == RunResult::Yielded
			&& prediction == -1 && isNil(full.getStringKey(field)) && full.getInteger(1) == valueInteger(61)
			&& full.hashAddress() == fullStorage && cpu.luaHeap().usedBytes() == beforeFullDelete
			&& cpu.instructionBudgetRemaining == 0 && cpu.readFramePc(0) == suffixPc,
			"nil pays no further storage or mapping charge after deleting this field once");
		requireParity(native, scalar);
	}
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(writeExits == warmExits, "deletion and the following tombstone no-op never enter WriteField");
#endif
	start(spareSlot, raw);
	require(test::runCpuParity(cpu, scalar.cpu, throughStore) == RunResult::Yielded && prediction == insertedSlot,
		"retrain the callsite to a different receiver's live field before exercising a decline");
	requireParity(native, scalar);

	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		auto& thread = *lane.activeThread();
		thread.reserveFrame(thread.stackTop() + methodArgs);
		asTable(lane.readFrameRegister(0, fullSlot), lane.gcHeap()).setMetatableAddress(valuePayload(lane.readFrameRegister(0, metaSlot)));
	}
	for (const Value value : {raw, valueNil()}) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
		const auto beforeCallback = writeExits;
#endif
		start(fullSlot, value);
		require(test::runCpuParity(cpu, scalar.cpu, throughStore + methodArgs) == RunResult::Yielded
			&& cpu.instructionBudgetRemaining == 0 && cpu.getFrameDepth() == 2 && cpu.readFramePc(0) == suffixPc
			&& cpu.readFrameRegister(1, 0) == valueTable(full.address()) && cpu.readFrameRegister(1, 1) == valueString(field)
			&& cpu.readFrameRegister(1, 2) == value && isNil(full.getStringKey(field)) && prediction == insertedSlot,
			"a declined store passes even nil to actual __newindex without clearing the unrelated prediction");
#if defined(BMSX_NATIVE_GATE_PROFILE)
		require(writeExits == beforeCallback + 1, "the callable remains an ordinary WriteField observer");
#endif
		requireParity(native, scalar);
		require(test::runCpuParity(cpu, scalar.cpu, cycles(OpCode::SETI) + cycles(OpCode::RET) + 2 * cycles(OpCode::MOV)) == RunResult::Yielded
			&& cpu.getFrameDepth() == 1 && full.getInteger(1) == value && isNil(full.getStringKey(field))
			&& cpu.readFrameRegister(0, 9) == value && cpu.readFrameRegister(0, 11) == valueInteger(39),
			"the callback marks the receiver once and returns to the live suffix");
		requireParity(native, scalar);
	}

	// A literal nil produced by KNIL is a different lowering than the live
	// input above. Warm it on a missing key before testing an owned deletion.
	const int nilThroughSuffix = cycles(OpCode::KNIL) + cycles(OpCode::SETFIELD) + cycles(OpCode::MOV);
	const u32 nilPc = native.rom.textAddress + nilLoop * INSTRUCTION_BYTES;
	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		asTable(lane.readFrameRegister(0, fullSlot), lane.gcHeap()).setMetatableAddress(0);
	}
	start(fullSlot, raw, nilFunction);
	require(test::runCpuParity(cpu, scalar.cpu, NATIVE_WARM_SCALE * 16
		* (nilThroughSuffix + cycles(OpCode::JMP))) == RunResult::Yielded, "the known-nil WIDE store warms separately");
	const auto nilWord = (nilPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(cpu, page, nilWord);
	const auto* nilBody = page.nativeBlocks->entries[nilWord].get();
	const auto nilExit = std::ranges::find(nilBody->sideExits, NativeBlockExit::WriteField, &NativeBlockExitSite::exit);
	require(nilExit != nilBody->sideExits.end() && nilExit->currentPc == nilPc + INSTRUCTION_BYTES,
		"the compiled known-nil row has the actual WIDE checkpoint");
	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		asTable(lane.readFrameRegister(0, fullSlot), lane.gcHeap()).setStringKey(field, raw);
	}
	const auto beforeKnownDelete = cpu.luaHeap().usedBytes();
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto beforeKnownNil = writeExits;
#endif
	for (int attempt = 0; attempt < 2; ++attempt) {
		start(fullSlot, raw, nilFunction);
		require(test::runCpuParity(cpu, scalar.cpu, nilThroughSuffix) == RunResult::Yielded
			&& cpu.instructionBudgetRemaining == 0 && cpu.readFramePc(0) == nilPc + 4 * INSTRUCTION_BYTES
			&& isNil(cpu.readFrameRegister(0, 9)) && isNil(full.getStringKey(field))
			&& cpu.luaHeap().usedBytes() == beforeKnownDelete && *nilExit->tableStore.decoded == -1,
			"known nil deletes once, then returns from an absent mapping with the same exact charge and suffix");
		requireParity(native, scalar);
	}
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(writeExits == beforeKnownNil, "the compiled known-nil lane also avoids WriteField");
#endif
	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		auto receiver = bmsx::test::allocateTableReference(lane, 0, 1);
		receiver.setStringKey(*lane.stringPool().find("resident field"), valueInteger(37));
		lane.activeThread()->currentFrame->registers.set(fullSlot, valueTable(receiver.address()));
		lane.luaHeap().setCollectionTarget(static_cast<u32>(lane.luaHeap().usedBytes()));
	}
	start(fullSlot, raw);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto beforeAssist = writeExits;
#endif
	auto underPressure = asTable(cpu.readFrameRegister(0, fullSlot), cpu.gcHeap());
	const auto beforePressure = cpu.luaHeap().usedBytes();
	require(test::runCpuParity(cpu, scalar.cpu, throughSuffix) == RunResult::Yielded
		&& underPressure.hashSlots() == grownHash && underPressure.getStringKey(field) == raw
		&& cpu.luaHeap().usedBytes() == beforePressure + charge && cpu.instructionBudgetRemaining < 0
		&& cpu.readFramePc(0) == suffixPc && cpu.readFrameRegister(0, 9) == valueInteger(-9),
		"the assisted store publishes once and exhausts the grant before its suffix");
	require(test::runCpuParity(cpu, scalar.cpu, throughSuffix - throughStore) == RunResult::Yielded
		&& cpu.instructionBudgetRemaining == 0 && cpu.readFrameRegister(0, 9) == raw
		&& cpu.readFrameRegister(0, 11) == valueInteger(39) && cpu.luaHeap().usedBytes() == beforePressure + charge,
		"the next grant runs the two live moves without replaying the allocation");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(writeExits == beforeAssist + 1, "pressure still publishes the activation before collecting");
#endif
	requireParity(native, scalar);
	if (extraHashSlots) {
		for (auto* machine : {&native, &scalar}) {
			auto& lane = machine->cpu;
			auto destination = bmsx::test::allocateTableReference(lane, 0, 1);
			destination.setStringKey(*lane.stringPool().find("resident field"), valueInteger(41));
			auto metatable = bmsx::test::allocateTableReference(lane, 0, 1);
			metatable.setStringKey(lane.stringPool().intern("__newindex"), valueTable(destination.address()));
			auto receiver = bmsx::test::allocateTableReference(lane);
			receiver.setMetatableAddress(metatable.address());
			auto regs = lane.activeThread()->currentFrame->registers;
			regs.set(fullSlot, valueTable(receiver.address()));
			regs.set(spareSlot, valueTable(destination.address()));
		}
		start(fullSlot, raw);
		require(test::runCpuParity(cpu, scalar.cpu, throughSuffix + TABLE_INDEX_VISIT_CYCLES) == RunResult::Yielded
			&& cpu.instructionBudgetRemaining == 0, "forwarded SETFIELD pays exactly one additional visit");
		const auto forwarded = asTable(cpu.readFrameRegister(0, spareSlot), cpu.gcHeap());
		const auto receiver = asTable(cpu.readFrameRegister(0, fullSlot), cpu.gcHeap());
		require(forwarded.hashSlots() == 2 && forwarded.getStringKey(field) == raw
			&& receiver.hashSlots() == 0 && isNil(receiver.getStringKey(field)),
			"a forwarded growth obeys ordinary capacity, not the original receiver's hint");
		requireParity(native, scalar);
	}
#endif
}

enum class FieldPressure { Budget, Fragmented, Exhausted };

void hintedFieldUnderPressure(FieldPressure pressure, bool weak = false) {
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(3u * INSTRUCTION_BYTES);
	image.constants = {std::string("new field")};
	constexpr u8 extraHashSlots = 255;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0, extraHashSlots);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::SETFIELD), 0, 0, 1);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 2}};
	CpuMachine machine(image); // First execution takes the ordinary cold dispatch.
	auto& cpu = machine.cpu;
	auto& budget = cpu.luaHeap();
	budget.setCollectionTarget(static_cast<u32>(budget.capacity()));
	auto owner = bmsx::test::allocateTableReference(cpu, 0, 1);
	auto regs = cpu.activeThread()->currentFrame->registers;
	regs.set(0, valueTable(owner.address()));
	regs.set(1, valueInteger(91));
	cpu.activeThread()->currentFrame->setTop(2);
	const auto field = *cpu.stringPool().find("new field");
	const auto resident = cpu.stringPool().intern("resident field");
	if (weak) {
		auto mode = bmsx::test::allocateTableReference(cpu, 0, 1);
		mode.setStringKey(cpu.stringPool().intern("__mode"), valueString(cpu.stringPool().intern("v")));
		owner.setMetatableAddress(mode.address());
		owner.setStringKey(resident, valueTable(bmsx::test::allocateTableReference(cpu).address()));
	} else {
		owner.setStringKey(resident, valueInteger(37));
	}
	const u32 originalStorage = owner.hashAddress();
	bmsx::test::allocateTableReference(cpu, 2048, 0); // Unreachable; completes the refused backing reservation after GC.
	auto& arena = cpu.heapAllocator();
	const auto grownHash = TableRecord::hashCapacity(2 + extraHashSlots);
	if (pressure == FieldPressure::Budget) {
		const u32 required = TableRecord::allocationCharge(0, 2) - TableRecord::allocationCharge(0, 1);
		cpu.memory().writeRamRecordWord(arena.managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET, budget.capacity() - required);
	} else {
		const u32 minimum = TableRecord::storageBytes(0, 2);
		const u32 hole = arena.allocate(minimum, true);
		while (arena.allocate(4088u, true)) {}
		while (arena.allocate(minimum, true)) {}
		if (pressure == FieldPressure::Fragmented) arena.free(hole);
		require(!arena.allocate(TableRecord::storageBytes(0, grownHash), true), "force a physical refusal of the preferred layout");
	}
	const auto budgetBefore = budget.usedBytes();
	const int cycles = BASE_CYCLES[static_cast<u8>(OpCode::SETFIELD)];
	const u32 pc = machine.rom.textAddress;
	const auto result = cpu.runUntilDepth(0, cycles, 0u, CpuRunKind::Scheduled);
	if (pressure != FieldPressure::Exhausted) {
		require(result == RunResult::Yielded && !cpu.allocationParked() && cpu.readFramePc(0) == pc + 2u * INSTRUCTION_BYTES
			&& owner.hashSlots() == 2 && owner.getStringKey(field) == valueInteger(91)
			&& owner.getStringKey(resident) == valueInteger(37)
			&& budget.usedBytes() - budgetBefore == TableRecord::allocationCharge(0, 2) - TableRecord::allocationCharge(0, 1),
			"only the minimum reservation fits and is charged; the write completes without parking");
		return;
	}
	require(result == RunResult::ParkedAllocation, "SETFIELD parks when even minimum backing is unavailable");
	const auto pending = cpu.captureRuntimeState().pendingAllocation;
	require(cpu.readFramePc(0) == pc && pending.instructionPc == pc && pending.lastPc == pc + INSTRUCTION_BYTES
		&& pending.nextPc == pc + 2u * INSTRUCTION_BYTES
		&& pending.receiver == owner.address() && pending.key == valueString(field)
		&& pending.value == valueInteger(91) && pending.extraHashSlots == extraHashSlots
		&& owner.hashAddress() == originalStorage && budget.usedBytes() == budgetBefore,
		"the WIDE reservation and canonical operands are parked without publishing the store");
	for (int step = 0; !cpu.allocationReady() && step < 120; ++step) cpu.advanceAllocationRecovery();
	require(cpu.allocationReady(), "collection makes the retired decision retryable");
	cpu.resumeAllocation();
	require(!cpu.allocationParked() && cpu.readFramePc(0) == pending.nextPc && owner.getStringKey(field) == valueInteger(91),
		"recovery completes exactly the parked assignment");
	if (weak) require(owner.hashSlots() == 1 && owner.hashAddress() == originalStorage && isNil(owner.getStringKey(resident)),
		"weak clearing opens a slot, so the hint does not force unnecessary growth");
	else require(owner.hashSlots() == grownHash && owner.hashAddress() != originalStorage && owner.getStringKey(resident) == valueInteger(37),
		"if growth is still required, it retains the exact extra-slot count");
}

void nativeDynamicStringMissReturnsWithinTheGrant() {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::Blua32TestImage image;
	image.mappedCode = false;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	image.constants = {std::string("dynamic resident"), std::string("dynamic growth"), std::string("unrelated metatable field")};
	constexpr int receiver = 256, ordinary = 6, pressure = 7, nilEntry = 16;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 5, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 1, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::SETT), 0, 1, 2);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::MOV), 4, 2, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, nilEntry, static_cast<u8>(OpCode::KNIL), 2, 0, 0);
	writeInstruction(image.text, nilEntry + 1, static_cast<u8>(OpCode::WIDE), 1, 0, 0);
	writeInstruction(image.text, nilEntry + 2, static_cast<u8>(OpCode::SETT), 0, 1, 2);
	writeInstruction(image.text, nilEntry + 3, static_cast<u8>(OpCode::MOV), 4, 2, 0);
	writeInstruction(image.text, nilEntry + 4, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = receiver + 1},
		{.firstWord = nilEntry, .wordCount = 5, .maxStack = receiver + 1}};

	CpuMachine native(image), scalar(image, true);
	auto& cpu = native.cpu;
	const auto resident = *cpu.stringPool().find("dynamic resident"), growth = *cpu.stringPool().find("dynamic growth");
	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		auto& frame = *lane.activeThread()->currentFrame;
		auto meta = bmsx::test::allocateTableReference(lane, 0, 1);
		meta.setStringKey(*lane.stringPool().find("unrelated metatable field"), valueInteger(41));
		for (const int slot : {ordinary, pressure}) {
			auto table = bmsx::test::allocateTableReference(lane, 1, 1);
			table.setInteger(1, valueInteger(61));
			table.setStringKey(resident, valueBool(false));
			table.setMetatableAddress(meta.address());
			frame.registers.set(slot, valueTable(table.address()));
		}
		frame.setTop(receiver + 1);
	}
	const u32 pc = native.rom.textAddress;
	const int throughStore = BASE_CYCLES[static_cast<u8>(OpCode::K1)] + BASE_CYCLES[static_cast<u8>(OpCode::SETT)];
	const auto run = [&](int table, StringId key, Value value, bool suffix) {
		for (auto* machine : {&native, &scalar}) {
			auto& lane = machine->cpu;
			lane.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
			auto registers = lane.activeThread()->currentFrame->registers;
			registers.set(receiver, registers.get(table));
			registers.set(1, valueString(key));
			registers.set(2, value);
			registers.set(4, valueInteger(-4));
		}
		const int assistCycles = table == pressure ? GC_WORK_WORD_CYCLES : 0;
		const int grant = throughStore + assistCycles + (suffix ? BASE_CYCLES[static_cast<u8>(OpCode::MOV)] : 0);
		require(test::runCpuParity(cpu, scalar.cpu, grant) == RunResult::Yielded, "dynamic store consumes its grant");
		const int paid = table == pressure ? static_cast<int>(cpu.memory().readRamRecordWord(
			cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET + GC_PACE_PAID)) : 0;
		require((table != pressure || paid > 0) && cpu.instructionBudgetRemaining == assistCycles - GC_WORK_WORD_CYCLES * paid
			&& cpu.readFramePc(0) == pc + (suffix ? 4u : 3u) * INSTRUCTION_BYTES
			&& cpu.readCurrentInstructionPc() == pc + (suffix ? 3u : 1u) * INSTRUCTION_BYTES
			&& cpu.lastPc == pc + (suffix ? 3u : 2u) * INSTRUCTION_BYTES
			&& cpu.readFrameRegister(0, 4) == (suffix ? value : valueInteger(-4)) && cpu.readFrameRegister(0, 5) == valueInteger(1),
			"dynamic WIDE SETT returns to the exact charged boundary and retains the live prefix and suffix");
		requireParity(native, scalar);
	};
	cpu.prepareSystemNativeCode();
	run(ordinary, resident, valueBool(false), true);
	const auto& page = *cpu.activeThread()->currentFrame->decodedPage;
	const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	require(page.nativeBlocks && page.nativeBlocks->entries[word], "the actual dynamic store entered a prepared native body");
	const auto* installed = page.nativeBlocks->entries[word].get();
	const auto store = std::ranges::find(installed->sideExits, NativeBlockExit::WriteIndex, &NativeBlockExitSite::exit);
	require(store != installed->sideExits.end() && store->currentPc == pc + INSTRUCTION_BYTES
		&& store->nextPc == pc + 3u * INSTRUCTION_BYTES && *store->tableStore.decoded >= 0,
		"the native body contains the actual WIDE dynamic store and its trained own-slot prediction");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const auto& writeIndex = cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::WriteIndex)].entries;
	const auto warmExits = writeIndex;
#endif
	auto table = asTable(cpu.readFrameRegister(0, ordinary), cpu.gcHeap());
	const auto storage = table.hashAddress();
	const auto free = table.hashFree();
	const auto bytes = cpu.luaHeap().usedBytes();
	run(ordinary, growth, valueNil(), true);
	require(isNil(table.getStringKey(growth)) && table.hashSlots() == 1 && table.hashAddress() == storage
		&& table.hashFree() == free && cpu.luaHeap().usedBytes() == bytes,
		"nil to a different absent key is a no-op with a metatable but no __newindex");
	const auto raw = valueFloatBits(0x7fc01234u);
	run(ordinary, growth, raw, false);
	require(table.getStringKey(growth) == raw && table.getStringKey(resident) == valueBool(false)
		&& table.hashSlots() == 2 && table.hashAddress() != storage && table.getInteger(1) == valueInteger(61)
		&& cpu.luaHeap().usedBytes() == bytes + TableRecord::allocationCharge(0, 1),
		"the changed dynamic key grows full own storage and preserves both earlier mappings");
	run(ordinary, resident, valueInteger(39), true);
	require(table.getStringKey(resident) == valueInteger(39) && table.getStringKey(growth) == raw
		&& cpu.luaHeap().usedBytes() == bytes + TableRecord::allocationCharge(0, 1),
		"switching back to the earlier String key changes only the selected own mapping");
	const u32 nilPc = pc + nilEntry * INSTRUCTION_BYTES;
	for (auto* machine : {&native, &scalar}) {
		auto& lane = machine->cpu;
		lane.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[1], nilPc);
		auto registers = lane.activeThread()->currentFrame->registers;
		registers.set(1, valueString(growth));
	}
	const int nilGrant = BASE_CYCLES[static_cast<u8>(OpCode::KNIL)] + BASE_CYCLES[static_cast<u8>(OpCode::SETT)]
		+ BASE_CYCLES[static_cast<u8>(OpCode::MOV)];
	const auto beforeDelete = cpu.luaHeap().usedBytes();
	require(test::runCpuParity(cpu, scalar.cpu, nilGrant) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0
		&& cpu.readFramePc(0) == nilPc + 4u * INSTRUCTION_BYTES && isNil(cpu.readFrameRegister(0, 4))
		&& isNil(table.getStringKey(growth)) && table.getStringKey(resident) == valueInteger(39)
		&& cpu.luaHeap().usedBytes() == beforeDelete,
		"a proven nil still passes the live String key to the returning delete");
	requireParity(native, scalar);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(writeIndex == warmExits, "ordinary dynamic String misses, growth and overwrite stay in the native body");
#endif
	for (auto* machine : {&native, &scalar})
		machine->cpu.luaHeap().setCollectionTarget(static_cast<u32>(machine->cpu.luaHeap().usedBytes()));
	run(pressure, growth, raw, false);
	auto pressured = asTable(cpu.readFrameRegister(0, pressure), cpu.gcHeap());
	require(pressured.hashSlots() == 2 && pressured.getStringKey(growth) == raw && pressured.getStringKey(resident) == valueBool(false),
		"allocation under pressure completes the same logical store once through its semantic owner");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(writeIndex == warmExits + 1, "a real collector assist retains the materialized WriteIndex boundary");
#endif
	require(page.nativeBlocks->entries[word].get() == installed, "changing runtime keys does not retire the native body");
#endif
}
} // namespace

int main() {
	try {
		completedOwnStringProbeKeepsLookupSemantics();
		stringReadChainBoundaries();
		observedArithmeticResumesAtItsOwnInstruction();
		contradictoryOwnFieldProofRetiresItsSource();
		genericArraysAndHashKeys(); inheritedTableFactsAreRecheckedOnCpuEntry(); inheritedArrayReads(false); inheritedArrayReads(true); boundaryLengthAndUtf8(); selfAndNilFaults(); methodCallReturnsOriginalReceiver(); iterationChargeIgnoresVacantCapacity(); hashGrowthKeepsReservedArray();
		nativeTypedIndexRechecksAnExternalEntry();
		tableIteratorRetainsItsCursorAcrossDeletionAndRestore();
		tableIteratorUsesNativeEdgesAndRecordsTheCursor();
		for (const bool generic : {false, true}) for (const bool full : {false, true}) stringStoreGrowthRoots(generic, full);

		nativeFieldOperationsLearnTheDecodedSite();
		nativeFieldCacheMissReturnsOwnValueAndTrainsTheSameSite();
		coldRepeatedFieldsRecompileTheirSource();

		warmInheritedFieldReadsKeepTheirFrame();
		warmInheritedFieldReadsProveCollisionChainAbsence();
		resolvedFieldKeepsPendingFixedCallsUntilAnObserver();

		warmTableStoresCompleteTheirEffects();
		negativeIntegerKeysUseHashStorage();
		nativeDynamicHashProbeReturnsLiveValuesWithinTheGrant();
		nativeIdentityHashStoreReturnsWithinTheGrant();
		nativeArrayStoresFollowHistorySessions();
		nativeIntegerGrowthReturnsWithinTheGrant();
		nativeFixedStringMissReturnsWithinTheGrant(0);
		nativeFixedStringMissReturnsWithinTheGrant(7);
		hintedFieldUnderPressure(FieldPressure::Budget);
		hintedFieldUnderPressure(FieldPressure::Fragmented);
		hintedFieldUnderPressure(FieldPressure::Exhausted);
		hintedFieldUnderPressure(FieldPressure::Exhausted, true);
		nativeDynamicStringMissReturnsWithinTheGrant();
		std::cout << "Compiled table tests passed\n";
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
