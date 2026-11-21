#pragma once

#include <algorithm>
#include <array>
#include <limits>
#include <optional>
#include <variant>

#include "machine/cpu/native_block_exit.h"
#include "machine/cpu/native_ir_numeric.h"
#include "machine/cpu/native_record_plan.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"

namespace bmsx {

// A value reference is the BLua RK selector: a nonnegative slot, or the
// negative selector of a constant-pool entry. Destinations are slots only.
using NativeValueRef = i16;
using NativeSlot = u16;
inline constexpr NativeValueRef NATIVE_NO_OPERAND = std::numeric_limits<NativeValueRef>::min();
static_assert(NATIVE_NO_OPERAND < -MAX_EXT_CONST - 1);

struct NativeSlotRange {
	u32 first = 0;
	u16 count = 0;
	bool open = false;
	constexpr int end() const { return open ? std::numeric_limits<int>::max() : static_cast<int>(first) + count; }
};

struct NativeSlotAccess {
	std::array<NativeValueRef, 3> reads{NATIVE_NO_OPERAND, NATIVE_NO_OPERAND, NATIVE_NO_OPERAND};
	NativeSlotRange writes{};
	NativeSlotRange readsRange{};
};

enum class NativeAccess : u8 { Read, Write };
enum class NativeGlobalBank : u8 { Execution, System };
enum class NativeTagCheck : u8 { Dynamic, Proved, Rejected };
enum class NativeWordSource : u8 { Dynamic, Integer, Float, Invalid };
enum class NativeGcBarrier : u8 { Dynamic, None, Reference };
enum class NativeNilValue : u8 { Dynamic, Nil, Present };

struct NativeStorePlan {
	NativeGcBarrier barrier = NativeGcBarrier::Dynamic;
	NativeNilValue nilValue = NativeNilValue::Dynamic;
};

struct NativeReplay {
	constexpr NativeSlotAccess slots() const { return {}; }
};
struct NativeJump {
	u32 target;
	constexpr NativeSlotAccess slots() const { return {}; }
};
struct NativeHalt {
	static constexpr auto terminalExit = NativeBlockExit::Halt;
	constexpr NativeSlotAccess slots() const { return {}; }
};
struct NativeExceptionReturn {
	static constexpr auto terminalExit = NativeBlockExit::ExceptionReturn;
	constexpr NativeSlotAccess slots() const { return {}; }
};
struct NativeReturnSite : NativeExitOperands::Return {
	static constexpr auto terminalExit = NativeBlockExit::Return;
	constexpr NativeSlotAccess slots() const {
		return {.readsRange = {first, static_cast<u16>(std::max<int>(produced, 0)), produced < 0}};
	}
};
struct NativeTableAllocation : NativeExitOperands::Allocation {
	static constexpr auto terminalExit = NativeBlockExit::AllocateTable;
	std::optional<NativeRecordId> record{};
	constexpr NativeSlotAccess slots() const { return {.writes = {result, 1}}; }
};
struct NativeConcat : NativeExitOperands::Concat {
	static constexpr auto terminalExit = NativeBlockExit::Concat;
	constexpr NativeSlotAccess slots() const {
		return {.reads = {left, right, NATIVE_NO_OPERAND}, .writes = {result, 1}};
	}
};
struct NativeConcatRange : NativeExitOperands::ConcatRange {
	static constexpr auto terminalExit = NativeBlockExit::ConcatRange;
	constexpr NativeSlotAccess slots() const {
		return {.writes = {result, 1}, .readsRange = {first, count}};
	}
};
struct NativeClosure : NativeExitOperands::Closure {
	static constexpr auto terminalExit = NativeBlockExit::CreateClosure;
	constexpr NativeSlotAccess slots() const {
		return {.writes = {result, 1},
			.readsRange = (flags & CLOSURE_ADDRESS_REGISTER_FLAG) != 0 ? NativeSlotRange{address, 1} : NativeSlotRange{}};
	}
};
struct NativeLiteral {
	NativeSlot result;
	Value value;
	constexpr NativeSlotAccess slots() const { return {.writes = {result, 1}}; }
};
struct NativeMove {
	NativeSlot result;
	NativeValueRef source;
	ValueMoveKind conversion;
	std::optional<ValueTag> copyTag{};
	NativeTagCheck conversionCheck = NativeTagCheck::Dynamic;
	constexpr NativeSlotAccess slots() const { return {{source, NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}, {result, 1}}; }
};
struct NativeNot {
	NativeSlot result;
	NativeValueRef source;
	std::optional<bool> sourceTruthy{};
	constexpr NativeSlotAccess slots() const { return {{source, NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}, {result, 1}}; }
};
struct NativeClearSlots {
	NativeSlot first;
	u16 count;
	constexpr NativeSlotAccess slots() const { return {.writes = {first, count}}; }
};
struct NativePoolRead {
	NativeSlot result, index;
	NativeWordSource indexPlan = NativeWordSource::Dynamic;
	constexpr NativeSlotAccess slots() const { return {{static_cast<i16>(index), NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}, {result, 1}}; }
};
struct NativeLength {
	NativeSlot result, source;
	constexpr NativeSlotAccess slots() const { return {{static_cast<i16>(source), NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}, {result, 1}}; }
};
struct NativeGlobalAccess {
	NativeSlot slot;
	u32 index;
	NativeGlobalBank bank;
	NativeAccess access;
	constexpr NativeSlotAccess slots() const {
		return access == NativeAccess::Read ? NativeSlotAccess{.writes = {slot, 1}}
			: NativeSlotAccess{.reads = {static_cast<i16>(slot), NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}};
	}
};
struct NativeUpvalueAccess {
	NativeSlot slot;
	u16 capture;
	NativeAccess access;
	NativeGcBarrier barrier = NativeGcBarrier::Dynamic;
	constexpr NativeSlotAccess slots() const {
		return access == NativeAccess::Read ? NativeSlotAccess{.writes = {slot, 1}}
			: NativeSlotAccess{.reads = {static_cast<i16>(slot), NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}};
	}
};

enum class NativeControlMode : u8 { ReadWord, ReadZero, WriteWord, ConsumeWord, ReadFault, WriteSemantic };
struct NativeControlAccess {
	NativeSlot slot;
	u16 field;
	NativeControlMode mode;
	bool checkPrivilege;
	NativeWordSource operand = NativeWordSource::Dynamic;
	constexpr NativeSlotAccess slots() const {
		switch (mode) {
		case NativeControlMode::ReadWord: case NativeControlMode::ReadZero:
			return {.writes = {slot, 1}};
		case NativeControlMode::WriteWord: case NativeControlMode::ConsumeWord:
			return {.reads = {static_cast<i16>(slot), NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}};
		case NativeControlMode::WriteSemantic:
			return {.reads = {static_cast<i16>(slot), NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}};
		case NativeControlMode::ReadFault:
			return {};
		}
		BMSX_UNREACHABLE();
	}
};

enum class NativeMemoryMode : u8 { Load, Store, StoreWords };
struct NativeMemoryAccess {
	NativeSlot slot;
	NativeValueRef address;
	u32 displacement;
	MemoryAccessKind format;
	NativeMemoryMode mode;
	u16 wordCount;
	NativeTagCheck addressCheck = NativeTagCheck::Dynamic;
	NativeWordSource store = NativeWordSource::Dynamic;

	constexpr NativeSlotAccess slots() const {
		switch (mode) {
		case NativeMemoryMode::Load: return {{address, NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}, {slot, 1}};
		case NativeMemoryMode::Store: return {.reads = {address, static_cast<i16>(slot), NATIVE_NO_OPERAND}};
		case NativeMemoryMode::StoreWords:
			return {.reads = {address, NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}, .readsRange = {slot, wordCount}};
		}
		BMSX_UNREACHABLE();
	}
};

enum class NativeTableMode : u8 { Read, Write, ReadMethod };
enum class NativeTableKey : u8 { Value, Integer, Field };
struct NativeTableAccess {
	NativeValueRef value;
	NativeValueRef receiver;
	i16 key;
	NativeTableMode mode;
	NativeTableKey keyKind;
	std::optional<ValueTag> resultTag;
	i32 predictedSlot = -1;
	NativeTagCheck receiverCheck = NativeTagCheck::Dynamic;
	NativeStorePlan store{};

	constexpr NativeSlotAccess slots() const {
		const i16 keySlot = keyKind == NativeTableKey::Value ? key : NATIVE_NO_OPERAND;
		if (mode == NativeTableMode::Write)
			return {.reads = {receiver, keySlot, value}};
		const u16 results = mode == NativeTableMode::ReadMethod ? 2u : 1u;
		return {.reads = {receiver, keySlot, NATIVE_NO_OPERAND}, .writes = {static_cast<u16>(value), results}};
	}
};

struct NativeArithmeticHint {
	std::optional<NativeArithmeticFeedback> feedback;
	bool observed = false;
};
struct NativeArithmetic {
	NativeSlot result;
	NativeValueRef left, right;
	OpCode operation;
	std::variant<NativeArithmeticHint, NativeNumericPlan> strategy;

	constexpr bool unary() const { return operation == OpCode::UNM || operation == OpCode::BNOT; }
	constexpr NativeSlotAccess slots() const { return {{left, unary() ? NATIVE_NO_OPERAND : right, NATIVE_NO_OPERAND}, {result, 1}}; }
};

struct NativeTruthBranch {
	u32 target;
	NativeValueRef condition;
	bool takeOnTruthy;
	std::optional<bool> sourceTruthy{};
	constexpr NativeSlotAccess slots() const { return {.reads = {condition, NATIVE_NO_OPERAND, NATIVE_NO_OPERAND}}; }
};
enum class NativeComparisonStrategy : u8 { Word, Float, Kernel };
struct NativeComparison {
	NativeValueRef left, right;
	OpCode operation;
	bool skipOnMatch;
	NativeComparisonStrategy strategy = NativeComparisonStrategy::Kernel;
	constexpr NativeSlotAccess slots() const { return {.reads = {left, right, NATIVE_NO_OPERAND}}; }
};

struct NativeCallSite : NativeExitOperands::Call {
	static constexpr auto terminalExit = NativeBlockExit::Call;
	NativeTagCheck calleeCheck = NativeTagCheck::Dynamic;
	constexpr NativeSlotAccess slots() const {
		return {.writes = {callee, static_cast<u16>(std::max<int>(requested, 0)), requested < 0},
			.readsRange = {callee, static_cast<u16>(1 + std::max<int>(supplied, 0)), supplied < 0}};
	}
};
struct NativeVararg : NativeExitOperands::Vararg {
	constexpr NativeSlotAccess slots() const {
		return {.writes = {first, static_cast<u16>(std::max<int>(requested, 0)), requested < 0}};
	}
};

using NativeOperation = std::variant<
	NativeReplay, NativeJump, NativeHalt, NativeExceptionReturn, NativeReturnSite, NativeTableAllocation,
	NativeConcat, NativeConcatRange, NativeClosure, NativeLiteral, NativeMove, NativeNot, NativeClearSlots, NativePoolRead,
	NativeLength, NativeGlobalAccess, NativeUpvalueAccess, NativeControlAccess, NativeMemoryAccess,
	NativeTableAccess, NativeArithmetic, NativeTruthBranch, NativeComparison, NativeCallSite, NativeVararg>;

struct NativeSlotType {
	NativeSlot slot;
	ValueTag tag;
};

} // namespace bmsx
