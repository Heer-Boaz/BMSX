#pragma once

#include "common/dlmalloc/dlmalloc.h"
#include "machine/cpu/cpu.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/opcode.h"
#include "blua32_test_rom.h"
#include "firmware_heap_layout.h"
#include "global_bank_reference.h"
#include "thread_allocation_reference.h"

#include <algorithm>
#include <array>
#include <optional>

namespace bmsx::test {

// Independent native fixture for tests whose subject starts after firmware
// admission. Reset semantics are tested separately with compiled BIOS ROMs.
// The following allocator, diagnostic keys and Thread are test data; none
// of this code is part of CPU reset or linked into a shipping core.
inline u32 provisionManagedFixture(CPU& cpu, u32 staticEnd, CpuRuntimeState& state) {
	auto& memory = cpu.memory();
	HeapAllocator arena(memory);
	const u32 management = arena.managementOffset();
	const u32 floor = arena.floorOffset(staticEnd);
	memory.setRamBusEnd(RAM_BASE + floor);
	bmsx_dlmalloc_reset({memory.ramData(), arena.stateOffset(), memory.ramWriteWatches().groupData()},
		floor, management);
	LuaHeap(cpu).setCollectionTarget(1024u * 1024u);

	// Reference: native bootstrap before the reset-to-firmware cutover.
	StringPoolReference strings(cpu);
	const StringId index = strings.intern("__index");
	const StringId newIndex = strings.intern("__newindex");
	const StringId length = strings.intern("__len");
	state.tableLookupKeyWord = index;
	state.tableAssignKeyWord = newIndex;
	state.tableLengthKeyWord = length;
	const StringId mode = strings.intern("__mode");
	const StringId errorInHandler = strings.intern("error in error handling");
	std::array<StringId, LUA_FAULT_REASON_INDEX_NAN + 1u> faultIds{};
	faultIds[LUA_FAULT_REASON_UNKNOWN] = strings.intern("Attempted to get length of an unsupported value.");
	faultIds[LUA_FAULT_REASON_CALL_NON_FUNCTION] = strings.intern("Attempted to call a non-function value.");
	faultIds[LUA_FAULT_REASON_INDEX_NON_TABLE] = strings.intern("Attempted to index field on a non-table value.");
	faultIds[LUA_FAULT_REASON_ASSIGN_NON_TABLE] = strings.intern("Attempted to assign to a non-table value.");
	faultIds[LUA_FAULT_REASON_INDEX_NIL] = strings.intern("Table index is nil.");
	faultIds[LUA_FAULT_REASON_METATABLE_LOOP] = strings.intern("Metatable index chain too long.");
	faultIds[LUA_FAULT_REASON_ITERATE_NON_TABLE] = strings.intern("Attempted to iterate a non-table value.");
	faultIds[LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION] = strings.intern("xpcall error handler must be a function.");
	faultIds[LUA_FAULT_REASON_OUT_OF_MEMORY] = strings.intern("Out of memory.");
	faultIds[LUA_FAULT_REASON_INVALID_ARGUMENT] = strings.intern("Invalid argument.");
	faultIds[LUA_FAULT_REASON_INVALID_NEXT_KEY] = strings.intern("invalid key to 'next'");
	faultIds[LUA_FAULT_REASON_INDEX_NAN] = strings.intern("Table index is NaN.");
	using Remark = GcDiagnosticField;
	const u32 remark = management + GC_DIAGNOSTIC_OFFSET;
	const u32 faults = management + GC_DIAGNOSTIC_FAULTS_OFFSET;
	memory.writeRamRecordWord(remark + static_cast<u32>(Remark::Mode), mode);
	memory.writeRamRecordPair(remark + static_cast<u32>(Remark::Index), index, newIndex);
	memory.writeRamRecordPair(remark + static_cast<u32>(Remark::Length), length, errorInHandler);
	memory.writeRamRecordWord(remark + static_cast<u32>(Remark::FaultIds), RAM_BASE + faults);
	for (u32 reason = 0; reason < faultIds.size(); ++reason)
		memory.writeRamRecordWord(faults + reason * sizeof(u32), faultIds[reason]);
	const u32 root = bmsx::test::allocateThreadRecordReference(cpu, 0u);
	memory.writeRamRecordWord(root + static_cast<u32>(ThreadField::Status), static_cast<u32>(ThreadStatus::Running));
	return root;
}

// Heap-only reference tests have no executable image or frame to admit.
inline void seedManagedHeapFixture(CPU& cpu) {
	auto state = cpu.captureRuntimeState();
	const u32 root = provisionManagedFixture(cpu, DYNAMIC_RAM_BASE, state);
	state.rootThreadAddress = state.activeThreadAddress = state.completionThreadAddress = root;
	cpu.restoreRuntimeState(state);
}

// An opcode test may author a window wider than the physical reset bank.
// Keep the test program's function indices and relative code unchanged and
// give hardware reset a separate, one-slot vector.
inline auto encodeManagedFixtureRom(Blua32TestImage image, u32 bssByteCount) -> Blua32TestRom {
	const u32 firstWord = static_cast<u32>(image.text.size() / INSTRUCTION_BYTES);
	image.text.resize(image.text.size() + INSTRUCTION_BYTES);
	writeInstruction(image.text, firstWord, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.startupFunctionIndex = static_cast<u32>(image.functions.size());
	image.functions.push_back({.firstWord = firstWord, .wordCount = 1});
	return encodeBlua32TestRom(RomImageDomain::System, image, bssByteCount);
}

// Author the preinstalled operands for raw opcode fixtures, not the BIOS boot path.
inline void installFixtureOperands(CPU& cpu, const ExecutionAddressSpace& addresses, Blua32ExecutionBoot boot) {
	const auto domain = boot.executionDomainId;
	auto& memory = cpu.memory();
	StringPoolReference strings(cpu);
	Span<const u8> header, constants;
	addresses.bindReadOnlyView(domain, boot.imageAddress, BLUA32_IMAGE_HEADER_SIZE, header);
	const auto field = [&](u32 offset) { return readLE32(header.data() + offset); };
	const u32 buckets = field(BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET);
	if (buckets != 0u) strings.activateRomTable(domain, field(BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET), buckets);
	const u32 constantCount = field(BLUA32_IMAGE_CONSTANT_COUNT_OFFSET);
	if (constantCount != 0u) addresses.bindReadOnlyView(domain, field(BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET),
		constantCount * BLUA32_CONSTANT_RECORD_SIZE, constants);
	const auto isString = [&](const u8* record) {
		return readLE32(record + BLUA32_CONSTANT_TAG_OFFSET) == static_cast<u32>(Blua32ConstantTag::String);
	};
	u32 stringCount = 0u;
	for (u32 i = 0u; i < constantCount; ++i)
		stringCount += isString(constants.data() + i * BLUA32_CONSTANT_RECORD_SIZE);
	const u32 names = field(BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET);
	const u32 systemNames = field(BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET);
	const u32 bytes = 4u * (names + systemNames + stringCount);
	if (bytes == 0u) return;
	const u32 management = HeapAllocator(memory).managementOffset();
	const u32 base = LuaHeap(cpu).allocateRecord(bytes, false, 0u, 0u);
	const auto bindNames = [&](u32 table, u32 count, u32 namespaceOffset, u32 destination) {
		if (count == 0u) return;
		Span<const u8> records;
		addresses.bindReadOnlyView(domain, table, count * BLUA32_GLOBAL_NAME_RECORD_SIZE, records);
		GlobalBank bank(memory, management + namespaceOffset);
		bank.bind();
		for (u32 i = 0u; i < count; ++i) {
			const u32 address = readLE32(records.data() + i * BLUA32_GLOBAL_NAME_RECORD_SIZE + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET);
			memory.writeRamRecordWord(destination + 4u * i, NativeGlobalBankReference(bank).registerName(GcHeap(cpu), strings.resolveImageRecord(domain, address)));
		}
	};
	bindNames(field(BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET), names, GLOBAL_BANK_OFFSET, base);
	bindNames(field(BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET), systemNames, SYSTEM_GLOBAL_BANK_OFFSET, base + 4u * names);
	const u32 stringBase = base + 4u * (names + systemNames);
	u32 slot = 0u, ramEnd = 0u;
	for (u32 i = 0u; i < constantCount; ++i) {
		const auto* record = constants.data() + i * BLUA32_CONSTANT_RECORD_SIZE;
		if (!isString(record)) continue;
		const StringId id = strings.resolveImageRecord(domain, readLE32(record + BLUA32_CONSTANT_PAYLOAD_OFFSET));
		memory.writeRamRecordWord(stringBase + 4u * slot, id);
		++slot;
		if (isRamStringId(id)) ramEnd = slot;
	}
	const u32 binding = executionImageBindingOffset(domain);
	memory.writeRamRecordPair(binding + EXECUTION_IMAGE_BINDING_ORDINARY_OFFSET,
		names != 0u ? base : 0u, systemNames != 0u ? base + 4u * names : 0u);
	memory.writeRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, stringCount != 0u ? stringBase : 0u);
	const u32 storage = firmwareImageStorageOffset(management, domain);
	memory.writeRamRecordWord(storage + FIRMWARE_IMAGE_STORAGE_BASE_OFFSET, base);
	memory.writeRamRecordWord(storage + FIRMWARE_IMAGE_STORAGE_BYTES_OFFSET, bytes);
	memory.writeRamRecordWord(storage + FIRMWARE_IMAGE_STORAGE_RAM_STRING_END_OFFSET, ramEnd);
}

inline void seedManagedFixture(CPU& cpu, ExecutionAddressSpace& addresses,
	const std::optional<FrameEntryControl>& entry = std::nullopt) {
	cpu.reset();
	auto state = cpu.captureRuntimeState();
	const auto& raw = *cpu.activeThread();
	const auto& rawFrame = *raw.currentFrame;
	const auto boot = addresses.resolveSystemDomain();
	auto& memory = cpu.memory();
	const u32 root = provisionManagedFixture(cpu, boot.staticEnd, state);
	installFixtureOperands(cpu, addresses, boot);
	Thread prepared(memory, root);
	prepared.bindStack();
	const int end = entry ? entry->stackBase + entry->capacity : raw.stackTop();
	reserveReferenceThreadFrame(GcHeap(cpu), prepared, end);
	const u32 control = ThreadRecord::storageLayout(memory, root).frameAddress(0u);
	if (entry) entry->writeWords([&](FrameField field, u32 word) {
		memory.writeRamRecordWord(control + static_cast<u32>(field), word);
	});
	else {
		std::copy_n(memory.ramData() + rawFrame.controlOffset, FRAME_CONTROL_BYTES, memory.ramData() + control);
		memory.invalidateRamWrite(control, FRAME_CONTROL_BYTES);
	}
	prepared.setStackTop(end);
	memory.writeRamRecordWord(root + static_cast<u32>(ThreadField::FrameDepth), 1u);
	// The fixed exception bank reuses the physical reset window after handoff.
	memory.writeRamRecordWord(CPU_RESET_BANK_ADDRESS + static_cast<u32>(ThreadField::FrameDepth), 0u);
	memory.writeRamRecordWord(CPU_RESET_BANK_ADDRESS + static_cast<u32>(ThreadField::StackTop), 0u);
	state.rootThreadAddress = state.activeThreadAddress = state.completionThreadAddress = root;
	cpu.restoreRuntimeState(state);
}

// A standalone native entry receives its detached registerfile explicitly.
inline std::array<u32, 32> fixtureTableControls(const CPU& cpu) {
	const auto state = cpu.captureRuntimeState();
	std::array<u32, 32> words{};
	words[COP0_TABLE_LOOKUP_KEY] = state.tableLookupKeyWord;
	words[COP0_TABLE_ASSIGN_KEY] = state.tableAssignKeyWord;
	words[COP0_TABLE_LENGTH_KEY] = state.tableLengthKeyWord;
	words[COP0_STRING_INDEX_TABLE] = state.stringIndexTableWord;
	return words;
}

// Publish the original subject's exact logical MaxStack, not the rounded
// backing reservation bucket used to satisfy that window.
inline void seedManagedFixture(CPU& cpu, ExecutionAddressSpace& addresses,
	const Blua32TestRom& rom, const Blua32TestImage& subject) {
	const u32 index = subject.startupFunctionIndex;
	const auto& function = subject.functions[index];
	const u32 pc = rom.textAddress + function.firstWord * INSTRUCTION_BYTES;
	const auto params = static_cast<i32>(function.numParams);
	const auto capacity = static_cast<i32>(std::max({1u, function.numParams, function.maxStack}));
	seedManagedFixture(cpu, addresses, FrameEntryControl{
		rom.functionAddresses[index], pc, pc, frameBankWord(SYSTEM_EXECUTION_DOMAIN_ID),
		params, 0, {}, params, 0u, 0, capacity,
	});
}

} // namespace bmsx::test
