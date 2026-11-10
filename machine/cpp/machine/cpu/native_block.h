#pragma once

#include <cstddef>
#include <memory>
#include <span>
#include <array>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "spec/blua32/opcode.h"
#include "spec/blua32/cop0.h"

namespace bmsx {

struct DecodedInstruction;
struct CallFrame;
class CPU;
class Memory;
class StringPool;
class NativeBlock;
struct NativeBlockExitSite;

struct NativeBlockLink {
	void disconnect();
	void* code = nullptr;
	int cycles = 0;
	NativeBlock* target = nullptr;
	NativeBlockLink* previous = nullptr;
	NativeBlockLink* next = nullptr;
};

struct NativeBlockRunState {
	Value* registers = nullptr;
	const Value* constants = nullptr;
	CallFrame* frame = nullptr;
	Value* globalValues = nullptr;
	Value* systemGlobalValues = nullptr;
	u32* cop0Words = nullptr;
	u32 constantCount = 0;
	int remainingCycles = 0;
	int registerTop = 0;
};

enum class NativeBlockTransition : u32 {
	Redispatch,
	RebindFrame,
	NextInstruction,
};

using NativeBlockExitHandler = NativeBlockTransition (*)(CPU*, CallFrame*, const NativeBlockExitSite*);

inline constexpr u8 NATIVE_BLOCK_COMPILATION_THRESHOLD = 8u;
inline constexpr u32 NATIVE_BLOCK_MAX_INSTRUCTIONS = 64u;

enum class NativeBlockExit : u8 {
	Continue,
	Halt,
	Call,
	Return,
	ReadField,
	WriteField,
	ReadMemory,
	WriteMemory,
	SkipInstruction,
	WriteUpvalue,
	Vararg,
	InvalidConstant,
	ReadIndex,
	WriteIndex,
	ReadInteger,
	WriteInteger,
	InvalidLength,
	AllocateTable,
	ControlFault,
	ControlBoundary,
	ExecuteFunction,
	ExceptionReturn,
	Concat,
	ConcatRange,
	CreateClosure,
	WriteWords,
	Count,
};

struct NativeBlockExitSite {
	NativeBlockExit exit = NativeBlockExit::Continue;
	NativeBlockExitHandler handler = nullptr;
	u16 exitA = 0;
	i16 exitB = 0;
	i16 exitC = 0;
	u32 exitBx = 0;
	u8 displacement = 0;
	bool displaced = false;
	mutable int tableCacheSlot = -1;
	int cycles = 0;
	int registerTop = 0;
	u32 nextPc = 0;
	u32 currentPc = 0;
	u32 lastPc = 0;
	mutable NativeBlockLink link;
};

using NativeBlockExitHandlers = std::array<NativeBlockExitHandler, static_cast<size_t>(NativeBlockExit::Count)>;

struct NativeBlockInstruction {
	const DecodedInstruction* decoded;
	u32 pc;
};

// Cached fields and plain RAM stay in generated code. Slow exits return their precise
// state map before a semantic helper can allocate, raise or invalidate code.
inline constexpr bool nativeBlockSupports(u8 op) {
	switch (static_cast<OpCode>(op)) {
		case OpCode::MOV:
		case OpCode::GETT:
		case OpCode::SETT:
		case OpCode::GETI:
		case OpCode::SETI:
		case OpCode::SELF:
		case OpCode::LEN:
		case OpCode::NEWT:
		case OpCode::CONCAT:
		case OpCode::CONCATN:
		case OpCode::CLOSURE:
		case OpCode::MFC0:
		case OpCode::MTC0:
		case OpCode::RFE:
		case OpCode::LOADK:
		case OpCode::LOADKR:
		case OpCode::LOADNIL:
		case OpCode::GETGL:
		case OpCode::SETGL:
		case OpCode::GETSYS:
		case OpCode::SETSYS:
		case OpCode::GETUP:
		case OpCode::SETUP:
		case OpCode::VARARG:
		case OpCode::KNIL:
		case OpCode::KFALSE:
		case OpCode::KTRUE:
		case OpCode::K0:
		case OpCode::K1:
		case OpCode::KM1:
		case OpCode::KSMI:
		case OpCode::ADD:
		case OpCode::SUB:
		case OpCode::MUL:
		case OpCode::DIV:
		case OpCode::MOD:
		case OpCode::FLOORDIV:
		case OpCode::POW:
		case OpCode::UNM:
		case OpCode::NOT:
		case OpCode::BAND:
		case OpCode::BOR:
		case OpCode::BXOR:
		case OpCode::SHL:
		case OpCode::SHR:
		case OpCode::BNOT:
		case OpCode::JMP:
		case OpCode::JMPIF:
		case OpCode::JMPIFNOT:
		case OpCode::EQ:
		case OpCode::LT:
		case OpCode::LE:
		case OpCode::HALT:
		case OpCode::CALL:
		case OpCode::RET:
		case OpCode::GETFIELD:
		case OpCode::SETFIELD:
		case OpCode::LOAD_MEM:
		case OpCode::LOAD_MEM_D:
		case OpCode::STORE_MEM:
		case OpCode::STORE_MEM_D:
		case OpCode::STORE_MEM_WORDS:
		case OpCode::STORE_MEM_WORDS_D:
			return true;
		default:
			return false;
	}
}

inline constexpr bool nativeBlockComparison(u8 op) {
	return op == static_cast<u8>(OpCode::EQ) || op == static_cast<u8>(OpCode::LT) || op == static_cast<u8>(OpCode::LE);
}

inline constexpr bool nativeBlockEndsBlock(u8 op, int field) {
	return op == static_cast<u8>(OpCode::JMP) || op == static_cast<u8>(OpCode::JMPIF)
		|| op == static_cast<u8>(OpCode::JMPIFNOT) || op == static_cast<u8>(OpCode::HALT)
		|| op == static_cast<u8>(OpCode::CALL) || op == static_cast<u8>(OpCode::RET)
		|| op == static_cast<u8>(OpCode::NEWT) || op == static_cast<u8>(OpCode::CLOSURE)
		|| op == static_cast<u8>(OpCode::CONCAT) || op == static_cast<u8>(OpCode::CONCATN)
		|| op == static_cast<u8>(OpCode::STORE_MEM_WORDS) || op == static_cast<u8>(OpCode::STORE_MEM_WORDS_D)
		|| (op == static_cast<u8>(OpCode::MTC0) && (field == COP0_STATUS || field == COP0_EXEC || !cop0FieldImplemented(field)))
		|| op == static_cast<u8>(OpCode::RFE) || nativeBlockComparison(op);
}

inline constexpr NativeBlockExit nativeBlockSlowExit(u8 op, int field, bool controlGuarded) {
	switch (static_cast<OpCode>(op)) {
		case OpCode::MFC0:
		case OpCode::MTC0: return controlGuarded && cop0FieldImplemented(field) ? NativeBlockExit::Continue : NativeBlockExit::ControlFault;
		case OpCode::GETFIELD: return NativeBlockExit::ReadField;
		case OpCode::SELF: return NativeBlockExit::ReadField;
		case OpCode::SETFIELD: return NativeBlockExit::WriteField;
		case OpCode::GETT: return NativeBlockExit::ReadIndex;
		case OpCode::SETT: return NativeBlockExit::WriteIndex;
		case OpCode::GETI: return NativeBlockExit::ReadInteger;
		case OpCode::SETI: return NativeBlockExit::WriteInteger;
		case OpCode::LEN: return NativeBlockExit::InvalidLength;
		case OpCode::SETUP: return NativeBlockExit::WriteUpvalue;
		case OpCode::VARARG: return NativeBlockExit::Vararg;
		case OpCode::LOADKR: return NativeBlockExit::InvalidConstant;
		case OpCode::LOAD_MEM:
		case OpCode::LOAD_MEM_D: return NativeBlockExit::ReadMemory;
		case OpCode::STORE_MEM:
		case OpCode::STORE_MEM_D: return NativeBlockExit::WriteMemory;
		case OpCode::STORE_MEM_WORDS:
		case OpCode::STORE_MEM_WORDS_D: return NativeBlockExit::WriteWords;
		default: return NativeBlockExit::Continue;
	}
}

class NativeBlock {
public:
	static std::unique_ptr<NativeBlock> compile(
		std::span<const NativeBlockInstruction> instructions,
		const Value* constants,
		size_t& cacheBytes,
		Memory& memory,
		StringPool& strings,
		const NativeBlockExitHandlers& exitHandlers = {},
		u8 skippedInstructionWidth = 0
	);
	~NativeBlock();
	NativeBlock(const NativeBlock&) = delete;
	NativeBlock& operator=(const NativeBlock&) = delete;

	const NativeBlockExitSite* run(NativeBlockRunState& state) const;
	void linkFrom(const NativeBlockExitSite& source);

	NativeBlockExitSite terminal;
	std::vector<NativeBlockExitSite> sideExits;
	// The final instruction may start with one cycle left. Counted stores end
	// a block so their surcharge cannot run a following instruction past zero.
	int entryCycles = 0;
	u16 sourceWords = 0;
	size_t codeBytes = 0;

private:
	friend struct NativeBlockLink;
	explicit NativeBlock(size_t& cacheBytes) : m_cacheBytes(cacheBytes) {}
	void* m_code = nullptr;
	void* m_body = nullptr;
	NativeBlockLink* m_incoming = nullptr;
	size_t& m_cacheBytes;
};

} // namespace bmsx
