#pragma once

#include "machine/cpu/cpu.h"
#include "spec/blua32/opcode.h"
#include "blua32_test_rom.h"
#include "spec/bmsx/heap_service.h"

#include <algorithm>
#include <array>
#include <optional>

namespace bmsx::test {

// Independent native fixture for tests whose subject starts after firmware
// admission. Reset semantics are tested separately with compiled BIOS ROMs.
// The following allocator, diagnostic keys and Thread are test data; none
// of this code is part of CPU reset or linked into a shipping core.
inline u32 provisionManagedFixture(CPU& cpu, u32 staticEnd) {
	auto& memory = cpu.memory();
	auto& arena = cpu.heapAllocator();
	const u32 management = arena.managementOffset();
	const u32 floor = arena.floorOffset(staticEnd);
	memory.setRamBusEnd(RAM_BASE + floor);
	bmsx_dlmalloc_reset({memory.ramData(), arena.stateOffset(), memory.ramWriteWatches().groupData()},
		floor, management);
	cpu.luaHeap().setCollectionTarget(1024u * 1024u);

	// Reference: native bootstrap before the reset-to-firmware cutover.
	auto& strings = cpu.stringPool();
	const StringId index = strings.intern("__index");
	const StringId newIndex = strings.intern("__newindex");
	const StringId length = strings.intern("__len");
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
	using Remark = HeapServiceRemarkHeadField;
	const u32 remark = management + HEAP_SERVICE_REMARK_HEAD_OFFSET;
	const u32 faults = management + HEAP_SERVICE_REMARK_FAULTS_OFFSET;
	memory.writeRamRecordWord(remark + static_cast<u32>(Remark::Mode), mode);
	memory.writeRamRecordPair(remark + static_cast<u32>(Remark::Index), index, newIndex);
	memory.writeRamRecordPair(remark + static_cast<u32>(Remark::Length), length, errorInHandler);
	memory.writeRamRecordWord(remark + static_cast<u32>(Remark::FaultIds), RAM_BASE + faults);
	for (u32 reason = 0; reason < faultIds.size(); ++reason)
		memory.writeRamRecordWord(faults + reason * sizeof(u32), faultIds[reason]);
	const u32 root = cpu.luaHeap().allocateThreadRecord(0u);
	memory.writeRamRecordWord(root + static_cast<u32>(ThreadField::Status), static_cast<u32>(ThreadStatus::Running));
	return root;
}

// Heap-only reference tests have no executable image or frame to admit.
inline void seedManagedHeapFixture(CPU& cpu) {
	auto state = cpu.captureRuntimeState();
	const u32 root = provisionManagedFixture(cpu, DYNAMIC_RAM_BASE);
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

inline void seedManagedFixture(CPU& cpu, ExecutionAddressSpace& addresses,
	const std::optional<FrameEntryControl>& entry = std::nullopt) {
	cpu.reset();
	auto state = cpu.captureRuntimeState();
	const auto& raw = *cpu.activeThread();
	const auto& rawFrame = *raw.currentFrame;
	const auto boot = addresses.resolveSystemDomain();
	auto& memory = cpu.memory();
	const u32 root = provisionManagedFixture(cpu, boot.staticEnd);
	Thread prepared(cpu.gcHeap(), root);
	prepared.bindStack();
	const int end = entry ? entry->stackBase + entry->capacity : raw.stackTop();
	prepared.reserveFrame(end, valueNil());
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
	state.rootThreadAddress = state.activeThreadAddress = state.completionThreadAddress = root;
	cpu.restoreRuntimeState(state);
	cpu.replaceExecutionImage(boot);
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
