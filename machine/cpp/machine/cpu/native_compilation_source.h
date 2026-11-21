#pragma once

#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_compiler.h"
#include "spec/blua32/cop0.h"
#include "machine/memory/mapped_page.h"
#include "machine/memory/bus_signals.h"

namespace bmsx {

// Guest control-flow and opcode admission for instruction-source discovery.
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

// Source discovery already ends the run at these instructions. Feed their
// successor if the ordinary CPU can return there.
inline constexpr bool nativeBlockHasTerminalContinuation(u8 op, int field) {
	switch (static_cast<OpCode>(op)) {
		case OpCode::STORE_MEM_WORDS: case OpCode::STORE_MEM_WORDS_D:
		case OpCode::NEWT: case OpCode::CONCAT: case OpCode::CONCATN:
		case OpCode::CLOSURE: case OpCode::CALL:
			return true;
		case OpCode::MTC0: return field == COP0_STATUS;
		default: return false;
	}
}

inline constexpr bool nativeBlockComparison(u8 op) {
	return op == static_cast<u8>(OpCode::EQ) || op == static_cast<u8>(OpCode::LT) || op == static_cast<u8>(OpCode::LE);
}

inline constexpr auto NATIVE_BLOCK_BOUNDARY_OPS = [] {
	// Decoded dispatch opcodes are bytes, including the internal pseudo-ops.
	std::array<bool, 256> boundaries{};
	for (const auto op : {OpCode::JMP, OpCode::JMPIF, OpCode::JMPIFNOT, OpCode::HALT,
		OpCode::CALL, OpCode::RET, OpCode::NEWT, OpCode::CLOSURE, OpCode::CONCAT, OpCode::CONCATN,
		OpCode::STORE_MEM_WORDS, OpCode::STORE_MEM_WORDS_D, OpCode::RFE, OpCode::EQ, OpCode::LT, OpCode::LE}) {
		boundaries[static_cast<u8>(op)] = true;
	}
	return boundaries;
}();

inline constexpr bool nativeBlockEndsBlock(u8 op, int field) {
	return NATIVE_BLOCK_BOUNDARY_OPS[op]
		|| (op == static_cast<u8>(OpCode::MTC0) && (field == COP0_STATUS || field == COP0_EXEC || !cop0FieldImplemented(field)));
}

// A physical instruction page and its compilation graph. No running frame,
// register file, CPU PC latch or device access is needed to discover its source.
// The lazy compiler keeps this bounded workspace on its stack; the cold image
// preparation pass retains one per page until all incoming roots are discovered.
struct NativeCompilationSource {
	NativeCompilationSource(Blua32ExecutionImage& image, DecodedInstructionPage& page,
		MappedPageBinding binding, u32 pagePc, MappedBusSignals busSignals, u32 slot)
		: image(image), page(page), binding(binding), pagePc(pagePc), busSignals(busSignals), slot(slot) {}

	// Emission specializes constant operands. A source word that cannot bind
	// those constants is not compilable; executing it remains the CPU's job.
	bool canEmit(const DecodedInstruction& instruction) const {
		if (!nativeBlockSupports(instruction.op)
			|| (instruction.op == static_cast<u8>(OpCode::MOV) && instruction.c > static_cast<int>(ValueMoveKind::FloatFromBits))) return false;
		const u8 rk = OPCODE_RK_OPERANDS[instruction.op];
		if (((rk & RK_OPERAND_B) != 0u && instruction.b < 0
				&& static_cast<size_t>(-instruction.b - 1) >= image.constPool.size())
			|| ((rk & RK_OPERAND_C) != 0u && instruction.c < 0
				&& static_cast<size_t>(-instruction.c - 1) >= image.constPool.size())) return false;
		switch (static_cast<OpCode>(instruction.op)) {
			case OpCode::JMP: return instruction.a == 0;
			case OpCode::LOADK: return instruction.bx < image.constPool.size();
			case OpCode::GETFIELD: case OpCode::SELF:
				return static_cast<size_t>(instruction.c) < image.constPool.size();
			case OpCode::SETFIELD:
				return static_cast<size_t>(instruction.b) < image.constPool.size();
			default: return true;
		}
	}

	void enqueue(u32 pc, bool leader, std::vector<u32>* outgoing = nullptr, bool root = false) {
		const u32 offset = pc - pagePc;
		if (offset >= MAPPED_PAGE_BYTE_SIZE) {
			if (outgoing) outgoing->push_back(pc);
			return;
		}
		const u32 word = offset / INSTRUCTION_BYTES;
		if (root) roots[word] = 1;
		if (leader || queued[word]) leaders[word] = 1;
		if (!queued[word]) { queued[word] = 1; pending[pendingCount++] = word; }
	}

	Blua32ExecutionImage& image;
	DecodedInstructionPage& page;
	MappedPageBinding binding;
	u32 pagePc;
	MappedBusSignals busSignals;
	u32 slot;
	std::array<u8, DECODED_PAGE_WORDS> roots{}, queued{}, available{}, leaders{};
	std::array<u32, DECODED_PAGE_WORDS> pending{};
	size_t pendingCount = 0, discoveredCount = 0;
	bool discoveryQueued = false;
};

} // namespace bmsx
