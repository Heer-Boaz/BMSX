#include "machine/cpu/thread_record.h"

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

} // namespace bmsx::ThreadRecord
