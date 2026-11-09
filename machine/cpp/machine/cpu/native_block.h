#pragma once

#include <cstddef>
#include <memory>
#include <span>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

struct DecodedInstruction;

struct NativeBlockInstruction {
	const DecodedInstruction* decoded;
	u32 pc;
};

// Only operations without observable bus accesses, allocations, callbacks or
// exceptions belong in a whole-budget native block. Other operations continue
// through the ordinary instruction executor.
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
		case OpCode::BAND:
		case OpCode::BOR:
		case OpCode::BXOR:
		case OpCode::SHL:
		case OpCode::SHR:
		case OpCode::BNOT:
		case OpCode::JMP:
			return true;
		default:
			return false;
	}
}

class NativeBlock {
public:
	static std::unique_ptr<NativeBlock> compile(
		std::span<const NativeBlockInstruction> instructions,
		const Value* constants,
		size_t& cacheBytes
	);
	~NativeBlock();
	NativeBlock(const NativeBlock&) = delete;
	NativeBlock& operator=(const NativeBlock&) = delete;

	void run(Value* registers, const Value* constants) const;

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
