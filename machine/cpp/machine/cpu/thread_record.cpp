#include "machine/cpu/thread_record.h"

#include <algorithm>
#include <cstring>

#include "machine/cpu/gc_heap.h"
#include "machine/cpu/lua_heap.h"
#include "machine/cpu/builtin_values.h"
#include "machine/cpu/upvalue.h"
#include "machine/cpu/value_arithmetic.h"

namespace bmsx {

u32 ThreadStorageLayout::allocationBytes() const {
	return heapAllocationBytes(THREAD_HEAP_BYTES + GC_OBJECT_PREFIX) + heapAllocationBytes(valueBytes()) + heapAllocationBytes(frameBytes()) + heapAllocationBytes(protectedBytes());
}

} // namespace bmsx

namespace bmsx::ThreadRecord {

void invokeDiagnostic(GcHeap& heap, BuiltinFunctionId id, BuiltinArgsView args, BuiltinResults& out) {
	auto& memory = heap.memory;
	if (!valueIsThread(args[0])) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const u32 thread = asThread(args[0], heap);
	const u32 depth = count(memory, thread, ThreadField::FrameDepth);
	if (id == BuiltinFunctionId::FrameCount) {
		out.push_back(valueInteger(depth));
		return;
	}

	const u32 index = static_cast<u32>(integerOperand(args[1]));
	if (index >= depth) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const auto layout = storageLayout(memory, thread);
	const u32 frame = layout.frameAddress(index);
	const auto field = [&](FrameField lane) { return memory.readRamRecordWord(frame + static_cast<u32>(lane)); };
	switch (id) {
		case BuiltinFunctionId::FrameHeader: {
			const u32 flags = field(FrameField::Flags);
			out.push_back(valueInteger(field(FrameField::Function)));
			out.push_back(valueInteger(field(FrameField::Pc)));
			out.push_back(valueInteger(field(FrameField::CallSite)));
			out.push_back(valueBool((flags & FRAME_COMPLETION) != 0u));
			out.push_back(valueInteger(static_cast<u32>(frameExecutionBank(flags))));
			out.push_back(valueBool((flags & FRAME_EXCEPTION) != 0u));
			return;
		}
		case BuiltinFunctionId::GetFrameRegister:
		case BuiltinFunctionId::SetFrameRegister: {
			const u32 reg = static_cast<u32>(integerOperand(args[2]));
			if (reg >= (field(FrameField::StackCapacity) & FRAME_WINDOW_MASK))
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const u32 slot = (field(FrameField::StackBase) & FRAME_WINDOW_MASK) + reg;
			auto registers = layout.slots(memory);
			if (id == BuiltinFunctionId::GetFrameRegister) out.push_back(registers.get(slot));
			else {
				if (args.size() < 4) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				registers.set(slot, args[3]);
			}
			return;
		}
		case BuiltinFunctionId::GetFrameUpvalue:
		case BuiltinFunctionId::SetFrameUpvalue: {
			const u32 capture = static_cast<u32>(integerOperand(args[2]));
			const u32 closure = field(FrameField::Closure);
			if (capture >= ClosureRecord::captureCount(memory, closure))
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const u32 cell = ClosureRecord::captureAddress(memory, closure, capture);
			if (id == BuiltinFunctionId::GetFrameUpvalue) out.push_back(Upvalue::load(memory, cell));
			else {
				if (args.size() < 4) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
				Upvalue::store(heap, cell, args[3]);
			}
			return;
		}
		default: BMSX_UNREACHABLE();
	}
}

void initialize(GcHeap& heap, u32 address, u32 valueBlock, u32 frameBlock, u32 entry) {
	auto& memory = heap.memory;
	const u32 offset = address & RAM_RECORD_WORD_MASK;
	auto* record = memory.ramData() + offset;
	std::fill_n(record, THREAD_HEAP_BYTES, u8{0});
	writeLE32(record, THREAD_RECORD_KIND | (static_cast<u32>(heap.white()) << 8u));
	writeLE32(record + static_cast<u32>(ThreadField::Entry), entry);
	writeLE32(record + static_cast<u32>(ThreadField::StackBlock), valueBlock);
	writeLE32(record + static_cast<u32>(ThreadField::FrameBlock), frameBlock);
	writeLE32(record + static_cast<u32>(ThreadField::StackCapacity), THREAD_INITIAL_VALUES);
	writeLE32(record + static_cast<u32>(ThreadField::FrameCapacity), THREAD_INITIAL_FRAMES);
	const ThreadStorageLayout layout{valueBlock, THREAD_INITIAL_VALUES, THREAD_INITIAL_FRAMES, 0u, frameBlock, 0u};
	const u32 control = layout.frameAddress(0);
	std::fill_n(memory.ramData() + control, layout.frameBytes(), u8{0});
	memory.invalidateRamWrite(control, layout.frameBytes());
	memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
	layout.slots(memory).clear(0, THREAD_INITIAL_VALUES);
}

void replaceStack(GcHeap& heap, u32 address, u32 block, u32 capacity) {
	auto& memory = heap.memory;
	const u32 oldBlock = read(memory, address, ThreadField::StackBlock);
	const u32 previous = read(memory, address, ThreadField::StackCapacity);
	const u32 offset = block & RAM_RECORD_WORD_MASK;
	const auto* source = memory.ramData() + (oldBlock & RAM_RECORD_WORD_MASK);
	auto* words = memory.ramData() + offset;
	auto* tags = words + capacity * sizeof(u32);
	const u32 retained = std::min(previous, capacity);
	std::memcpy(words, source, retained * sizeof(u32));
	std::memcpy(tags, source + previous * sizeof(u32), retained);
	std::memset(words + retained * sizeof(u32), 0, (capacity - retained) * sizeof(u32));
	std::memset(tags + retained, 0, capacity - retained);
	memory.invalidateRamWrite(offset, capacity * THREAD_STACK_SLOT_BYTES);
	memory.writeRamRecordPair(address + static_cast<u32>(ThreadField::StackBlock), block, capacity);
	heap.budget.replaceRecord(oldBlock, previous * THREAD_STACK_SLOT_BYTES, capacity * THREAD_STACK_SLOT_BYTES);
}

void replaceControls(GcHeap& heap, u32 address, ThreadField field, u32 block, u32 capacity) {
	auto& memory = heap.memory;
	const bool frames = field == ThreadField::FrameBlock;
	const u32 stride = frames ? FRAME_CONTROL_BYTES : PROTECTED_CALL_BYTES;
	const auto capacityField = frames ? ThreadField::FrameCapacity : ThreadField::ProtectedCapacity;
	const auto depthField = frames ? ThreadField::FrameDepth : ThreadField::ProtectedDepth;
	const u32 previous = count(memory, address, capacityField);
	const u32 oldBlock = read(memory, address, field);
	const u32 offset = block & RAM_RECORD_WORD_MASK;
	auto* destination = memory.ramData() + offset;
	const u32 occupied = count(memory, address, depthField) * stride;
	std::memcpy(destination, memory.ramData() + (oldBlock & RAM_RECORD_WORD_MASK), occupied);
	std::memset(destination + occupied, 0, capacity * stride - occupied);
	memory.invalidateRamWrite(offset, capacity * stride);
	memory.writeRamRecordWord(address + static_cast<u32>(field), block);
	memory.writeRamRecordWord(address + static_cast<u32>(capacityField), capacity);
	heap.budget.replaceRecord(oldBlock, previous * stride, capacity * stride);
}

u32 shrinkStack(GcHeap& heap, u32 address, const ThreadStorageLayout& layout) {
	const auto& memory = heap.memory;
	u32 used = read(memory, address, ThreadField::StackTop) & FRAME_WINDOW_MASK;
	const u32 depth = count(memory, address, ThreadField::FrameDepth);
	for (u32 index = 0; index < depth; ++index) {
		const u32 frame = layout.frameAddress(index);
		const u32 base = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackBase)) & FRAME_WINDOW_MASK;
		const u32 capacity = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackCapacity)) & FRAME_WINDOW_MASK;
		used = std::max(used, base + capacity);
	}
	u32 copied = 0;
	// Sweeping cannot recursively collect. Each reservation can shrink
	// independently if the allocator has a replacement for that lane.
	if (layout.valueCapacity > 16 && static_cast<u64>(used) * 3 < layout.valueCapacity) {
		const u32 capacity = layout.valueCapacity / 2, bytes = capacity * THREAD_STACK_SLOT_BYTES;
		if (const u32 block = heap.arena.allocate(bytes, true)) {
			replaceStack(heap, address, block, capacity);
			copied += bytes;
		}
	}
	if (layout.frameCapacity > 4 && depth * 3 < layout.frameCapacity) {
		const u32 capacity = layout.frameCapacity / 2, bytes = capacity * FRAME_CONTROL_BYTES;
		if (const u32 block = heap.arena.allocate(bytes, true)) {
			replaceControls(heap, address, ThreadField::FrameBlock, block, capacity);
			copied += bytes;
		}
	}
	if (layout.protectedCapacity > 4 && count(memory, address, ThreadField::ProtectedDepth) * 3 < layout.protectedCapacity) {
		const u32 capacity = layout.protectedCapacity / 2, bytes = capacity * PROTECTED_CALL_BYTES;
		if (const u32 block = heap.arena.allocate(bytes, true)) {
			replaceControls(heap, address, ThreadField::ProtectedBlock, block, capacity);
			copied += bytes;
		}
	}
	return copied;
}

} // namespace bmsx::ThreadRecord
