#include "machine/cpu/thread_record.h"

#include <algorithm>
#include <cstring>

#include "machine/cpu/gc_heap.h"
#include "machine/cpu/lua_heap.h"
#include "machine/cpu/builtin_values.h"
#include "machine/cpu/upvalue.h"
#include "machine/cpu/value_arithmetic.h"

namespace bmsx::ThreadRecord {

void invokeDiagnostic(Memory& memory, BuiltinFunctionId id, BuiltinArgsView args, BuiltinResults& out) {
	const Value receiver = args[0];
	if (!valueIsThread(receiver)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const u32 thread = valuePayload(receiver);
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
		case BuiltinFunctionId::GetFrameUpvalue: {
			const u32 capture = static_cast<u32>(integerOperand(args[2]));
			const u32 closure = field(FrameField::Closure);
			if (capture >= frameCaptureCount(memory, closure))
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const u32 cell = ClosureRecord::captureAddress(memory, closure, capture);
			out.push_back(Upvalue::load(memory, cell));
			return;
		}
		default: BMSX_UNREACHABLE();
	}
}

bool resizeStackBacking(GcHeap& heap, u32 address, u32 capacity) {
	auto& memory = heap.memory;
	const u32 old = read(memory, address, ThreadField::StackBlock);
	const u32 previous = read(memory, address, ThreadField::StackCapacity);
	const u32 bytes = capacity * THREAD_STACK_SLOT_BYTES;
	u32 block = old;
	if (capacity > previous) {
		block = heap.arena.resizeBacking(old, bytes);
		if (!block) return false;
	}
	const u32 offset = block & RAM_RECORD_WORD_MASK;
	auto* data = memory.ramData() + offset;
	const u32 kept = std::min(previous, capacity);
	// realloc preserves the old planes as bytes. Move tags before clearing
	// new words on growth, and before releasing the suffix on shrink.
	std::memmove(data + capacity * sizeof(u32), data + previous * sizeof(u32), kept);
	if (capacity > previous) {
		std::memset(data + previous * sizeof(u32), 0, (capacity - previous) * sizeof(u32));
		std::memset(data + capacity * sizeof(u32) + previous, 0, capacity - previous);
	}
	memory.invalidateRamWrite(offset + kept * sizeof(u32), bytes - kept * sizeof(u32));
	if (capacity < previous) heap.arena.shrinkBacking(old, bytes);
	memory.writeRamRecordPair(address + static_cast<u32>(ThreadField::StackBlock), block, capacity);
	heap.budget.resizeRecordCharge(previous * THREAD_STACK_SLOT_BYTES, bytes);
	return true;
}

u32 growFrames(GcHeap& heap, u32 address, u32 capacity, u32 staged) {
	auto& memory = heap.memory;
	const u32 previous = count(memory, address, ThreadField::FrameCapacity);
	const u32 oldBlock = read(memory, address, ThreadField::FrameBlock);
	const u32 bytes = capacity * FRAME_CONTROL_BYTES;
	const u32 block = staged ? staged : (oldBlock ? heap.arena.resizeBacking(oldBlock, bytes) : heap.arena.allocate(bytes, true));
	if (!block) return 0;
	const u32 offset = block & RAM_RECORD_WORD_MASK;
	auto* destination = memory.ramData() + offset;
	const u32 occupied = count(memory, address, ThreadField::FrameDepth) * FRAME_CONTROL_BYTES;
	if (staged) std::memcpy(destination, memory.ramData() + (oldBlock & RAM_RECORD_WORD_MASK), occupied);
	std::memset(destination + occupied, 0, bytes - occupied);
	const u32 dirty = staged ? 0u : occupied;
	memory.invalidateRamWrite(offset + dirty, bytes - dirty);
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::FrameBlock), block);
	memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::FrameCapacity), capacity);
	if (staged) heap.arena.free(oldBlock);
	heap.budget.resizeRecordCharge(previous * FRAME_CONTROL_BYTES, bytes);
	return block;
}

u32 shrinkStack(GcHeap& heap, u32 address, const ThreadStorageLayout& layout) {
	auto& memory = heap.memory;
	const u32 depth = count(memory, address, ThreadField::FrameDepth);
	u32 used = read(memory, address, ThreadField::StackTop) & FRAME_WINDOW_MASK;
	u32 retained = 0;
	if (layout.valueCapacity > 16) {
		for (u32 index = 0; index < depth && static_cast<u64>(used) * 3 < layout.valueCapacity; ++index) {
			const u32 frame = layout.frameAddress(index);
			const u32 base = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackBase)) & FRAME_WINDOW_MASK;
			const u32 capacity = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::StackCapacity)) & FRAME_WINDOW_MASK;
			used = std::max(used, base + capacity);
		}
		if (static_cast<u64>(used) * 3 < layout.valueCapacity) {
			const u32 next = layout.valueCapacity / 2, bytes = next * THREAD_STACK_SLOT_BYTES;
			resizeStackBacking(heap, address, next);
			retained = bytes;
		}
	}
	// The occupied frame prefix has no capacity-relative fields. Keep it in
	// place, clearing the retained spare records just as on fresh reservation.
	if (layout.frameCapacity > 4 && depth * 3 < layout.frameCapacity) {
		const u32 next = layout.frameCapacity / 2, bytes = next * FRAME_CONTROL_BYTES;
		const u32 occupied = depth * FRAME_CONTROL_BYTES;
		const u32 spare = (layout.frameBlock & RAM_RECORD_WORD_MASK) + occupied;
		std::memset(memory.ramData() + spare, 0, bytes - occupied);
		memory.invalidateRamWrite(spare, bytes - occupied);
		heap.arena.shrinkBacking(layout.frameBlock, bytes);
		memory.writeRamRecordWord(address + static_cast<u32>(ThreadField::FrameCapacity), next);
		heap.budget.resizeRecordCharge(layout.frameBytes(), bytes);
		retained += bytes;
	}
	return retained;
}

} // namespace bmsx::ThreadRecord
