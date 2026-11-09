#pragma once

#include <cstddef>
#include <memory>
#include <span>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

struct DecodedInstruction;
struct CallFrame;
class CPU;
class NativeBlock;

struct NativeBlockExecution {
	CPU* cpu;
	CallFrame* frame;
};

enum class NativeBlockTransition : u32 {
	Redispatch,
	RebindFrame,
};

using NativeBlockExitHandler = NativeBlockTransition (*)(NativeBlockExecution*, const NativeBlock*);

inline constexpr u8 NATIVE_BLOCK_COMPILATION_THRESHOLD = 8u;
inline constexpr u32 NATIVE_BLOCK_MAX_INSTRUCTIONS = 64u;

enum class NativeBlockExit : u8 {
	Continue,
	Halt,
	Call,
	Return,
};

struct NativeBlockInstruction {
	const DecodedInstruction* decoded;
	u32 pc;
};

// The prefix is side-effect-free. Calls/returns terminate in a native tail
// helper, after publishing state and releasing the generated host stack frame.
inline constexpr bool nativeBlockSupports(u8 op) {
	switch (static_cast<OpCode>(op)) {
		case OpCode::MOV:
		case OpCode::LOADK:
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
		case OpCode::HALT:
		case OpCode::CALL:
		case OpCode::RET:
			return true;
		default:
			return false;
	}
}

inline constexpr bool nativeBlockEndsBlock(u8 op) {
	return op == static_cast<u8>(OpCode::JMP) || op == static_cast<u8>(OpCode::JMPIF)
		|| op == static_cast<u8>(OpCode::JMPIFNOT) || op == static_cast<u8>(OpCode::HALT)
		|| op == static_cast<u8>(OpCode::CALL) || op == static_cast<u8>(OpCode::RET);
}

class NativeBlock {
public:
	static std::unique_ptr<NativeBlock> compile(
		std::span<const NativeBlockInstruction> instructions,
		const Value* constants,
		size_t& cacheBytes,
		NativeBlockExitHandler exitHandler = nullptr
	);
	~NativeBlock();
	NativeBlock(const NativeBlock&) = delete;
	NativeBlock& operator=(const NativeBlock&) = delete;

	u32 run(Value* registers, const Value* constants) const;
	NativeBlockTransition run(Value* registers, const Value* constants, NativeBlockExecution& execution) const;

	NativeBlockExit exit = NativeBlockExit::Continue;
	u16 exitA = 0;
	u16 exitB = 0;
	u16 exitC = 0;
	u16 sourceWords = 0;
	int cycles = 0;
	int registerTop = 0;
	u32 nextPc = 0;
	u32 currentPc = 0;
	u32 lastPc = 0;
	size_t codeBytes = 0;

private:
	explicit NativeBlock(size_t& cacheBytes) : m_cacheBytes(cacheBytes) {}
	void* m_code = nullptr;
	size_t& m_cacheBytes;
};

} // namespace bmsx
