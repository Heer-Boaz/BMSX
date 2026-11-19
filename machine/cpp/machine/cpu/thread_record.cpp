#include "machine/cpu/thread_record.h"

#include <algorithm>
#include <cstring>

#include "machine/cpu/gc_heap.h"
#include "machine/cpu/builtin_values.h"
#include "machine/cpu/upvalue.h"
#include "machine/cpu/value_arithmetic.h"

namespace bmsx::ThreadRecord {
namespace {

void copyStackControl(Memory& memory, u8* destination, u32 source, u32 bytes) {
	if (bytes == 0) return;
	source &= RAM_RECORD_WORD_MASK;
	const u32 first = std::min(bytes, MAIN_RAM_SIZE - source);
	std::memmove(destination, memory.ramData() + source, first);
	if (first != bytes) std::memmove(destination + first, memory.ramData(), bytes - first);
}

}

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
	const auto layout = stackLayout(memory, thread);
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

void initialize(GcHeap& heap, u32 address, u32 entry) {
	auto& memory = heap.memory;
	const u32 offset = address & RAM_RECORD_WORD_MASK;
	auto* record = memory.ramData() + offset;
	const u32 block = read(memory, address, ThreadField::StackBlock);
	std::fill_n(record, THREAD_HEAP_BYTES, u8{0});
	writeLE32(record, THREAD_RECORD_KIND | (static_cast<u32>(heap.white()) << 8u));
	writeLE32(record + static_cast<u32>(ThreadField::Entry), entry);
	writeLE32(record + static_cast<u32>(ThreadField::StackBlock), block);
	writeLE32(record + static_cast<u32>(ThreadField::StackCapacity), THREAD_INITIAL_VALUES);
	writeLE32(record + static_cast<u32>(ThreadField::FrameCapacity), THREAD_INITIAL_FRAMES);
	const ThreadStackLayout layout{block, THREAD_INITIAL_VALUES, THREAD_INITIAL_FRAMES, 0u};
	const u32 control = layout.frameAddress(0);
	std::fill_n(memory.ramData() + control, THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES, u8{0});
	memory.invalidateRamWrite(control, THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
	memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
	layout.slots(memory).clear(0, THREAD_INITIAL_VALUES);
}

void relocateStack(GcHeap& heap, u32 address, const ThreadStackLayout& from, const ThreadStackLayout& to) {
	auto& memory = heap.memory;
	const auto stack = from.slots(memory);
	auto* words = memory.ramData() + to.offset();
	auto* tags = words + to.valueCapacity * sizeof(u32);
	const u32 retained = std::min(from.valueCapacity, to.valueCapacity);
	if (stack.mirrored()) {
		to.slots(memory).copyFrom(stack, 0, 0, retained);
	} else {
		std::memmove(words, stack.words(), retained * sizeof(u32));
		std::memmove(tags, stack.tags(), retained);
	}
	std::memset(words + retained * sizeof(u32), 0, (to.valueCapacity - retained) * sizeof(u32));
	std::memset(tags + retained, 0, to.valueCapacity - retained);
	auto* frameRecords = words + to.controlOffset();
	const u32 frameBytes = std::min({count(memory, address, ThreadField::FrameDepth), from.frameCapacity, to.frameCapacity}) * FRAME_CONTROL_BYTES;
	auto* protectedRecords = frameRecords + to.frameCapacity * FRAME_CONTROL_BYTES;
	const u32 occupied = std::min({count(memory, address, ThreadField::ProtectedDepth), from.protectedCapacity, to.protectedCapacity}) * PROTECTED_CALL_BYTES;
	copyStackControl(memory, frameRecords, from.frameAddress(0), frameBytes);
	copyStackControl(memory, protectedRecords, from.protectedAddress(0), occupied);
	const u32 bytes = to.byteLength();
	std::fill(words + to.valueCapacity * THREAD_STACK_SLOT_BYTES, frameRecords, u8{0});
	std::fill(frameRecords + frameBytes, protectedRecords, u8{0});
	std::fill(protectedRecords + occupied, words + bytes, u8{0});
	memory.invalidateRamWrite(to.offset(), bytes);

	// Publish the new geometry before releasing the old backing.
	const u32 descriptor = (address + static_cast<u32>(ThreadField::StackBlock)) & RAM_RECORD_WORD_MASK;
	auto* geometry = memory.ramData() + descriptor;
	writeLE32(geometry, to.block);
	writeLE32(geometry + 4, to.valueCapacity);
	writeLE32(geometry + 8, to.frameCapacity);
	writeLE32(geometry + 12, to.protectedCapacity);
	memory.invalidateRamWrite(descriptor, 16);
	heap.arena.free(from.block);
}

u32 shrinkStack(GcHeap& heap, u32 address, const ThreadStackLayout& layout) {
	const auto& memory = heap.memory;
	u32 used = read(memory, address, ThreadField::StackTop) & FRAME_WINDOW_MASK;
	const u32 depth = count(memory, address, ThreadField::FrameDepth);
	for (u32 index = 0; index < depth; ++index) {
		const u32 frame = layout.frameAddress(index);
		const u32 base = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackBase)) & FRAME_WINDOW_MASK;
		const u32 capacity = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackCapacity)) & FRAME_WINDOW_MASK;
		used = std::max(used, base + capacity);
	}
	ThreadStackLayout next = layout;
	if (layout.valueCapacity > 16 && static_cast<u64>(used) * 3 < layout.valueCapacity) next.valueCapacity /= 2;
	if (layout.frameCapacity > 4 && depth * 3 < layout.frameCapacity) next.frameCapacity /= 2;
	if (layout.protectedCapacity > 4 && count(memory, address, ThreadField::ProtectedDepth) * 3 < layout.protectedCapacity) next.protectedCapacity /= 2;
	if (next.valueCapacity == layout.valueCapacity && next.frameCapacity == layout.frameCapacity
		&& next.protectedCapacity == layout.protectedCapacity) return 0;
	const u32 bytes = next.byteLength();
	next.block = heap.arena.allocate(bytes, true);
	if (next.block == 0u) return 0; // Collection cannot recursively collect for a shrink.
	relocateStack(heap, address, layout, next);
	return bytes;
}

} // namespace bmsx::ThreadRecord
