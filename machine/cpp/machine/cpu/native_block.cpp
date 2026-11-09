#include "machine/cpu/native_block.h"

#include <algorithm>
#include <new>

#include "machine/cpu/execution_image.h"
#include "sljitLir.h"

namespace bmsx {
namespace {

class NativeBlockCompiler {
public:
	explicit NativeBlockCompiler(const Value* constants)
		: m_compiler(sljit_create_compiler(nullptr)), m_constants(constants) {
		if (!m_compiler) throw std::bad_alloc();
		// S0/S1 keep the guest register and constant banks across conversion
		// calls. S2 keeps a converted word while the other operand is converted.
		sljit_emit_enter(m_compiler, 0, SLJIT_ARGS2V(P, P),
			2 | SLJIT_ENTER_FLOAT(3), 3, 0);
	}

	~NativeBlockCompiler() { sljit_free_compiler(m_compiler); }

	void emit(const DecodedInstruction& instruction) {
		const auto op = static_cast<OpCode>(instruction.op);
		const sljit_sw destination = static_cast<sljit_sw>(instruction.a) * sizeof(Value);
		switch (op) {
			case OpCode::MOV:
				sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0,
					SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(instruction.b) * sizeof(Value));
				break;
			case OpCode::LOADK:
				sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0,
					SLJIT_MEM1(SLJIT_S1), static_cast<sljit_sw>(instruction.bx) * sizeof(Value));
				break;
			case OpCode::KNIL: sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueNil())); break;
			case OpCode::KFALSE: sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueBool(false))); break;
			case OpCode::KTRUE: sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueBool(true))); break;
			case OpCode::K0: sljit_emit_fset64(m_compiler, SLJIT_FR0, 0.0); break;
			case OpCode::K1: sljit_emit_fset64(m_compiler, SLJIT_FR0, 1.0); break;
			case OpCode::KM1: sljit_emit_fset64(m_compiler, SLJIT_FR0, -1.0); break;
			case OpCode::KSMI: sljit_emit_fset64(m_compiler, SLJIT_FR0, instruction.sbx); break;
			case OpCode::ADD:
			case OpCode::SUB:
			case OpCode::MUL:
			case OpCode::DIV: {
				loadOperand(instruction.b, SLJIT_FR0);
				loadOperand(instruction.c, SLJIT_FR1);
				const sljit_s32 operation = op == OpCode::ADD ? SLJIT_ADD_F64
					: op == OpCode::SUB ? SLJIT_SUB_F64
					: op == OpCode::MUL ? SLJIT_MUL_F64 : SLJIT_DIV_F64;
				sljit_emit_fop2(m_compiler, operation, SLJIT_FR0, 0, SLJIT_FR0, 0, SLJIT_FR1, 0);
				canonicalizeNumber();
				break;
			}
			case OpCode::UNM:
				loadOperand(instruction.b, SLJIT_FR0);
				sljit_emit_fop1(m_compiler, SLJIT_NEG_F64, SLJIT_FR0, 0, SLJIT_FR0, 0);
				canonicalizeNumber();
				break;
			case OpCode::BAND:
			case OpCode::BOR:
			case OpCode::BXOR:
			case OpCode::SHL:
			case OpCode::SHR: {
				convertWord(instruction.b);
				sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_S2, 0, SLJIT_R0, 0);
				convertWord(instruction.c);
				if (op == OpCode::SHL || op == OpCode::SHR) {
					sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 31);
				}
				const sljit_s32 operation = op == OpCode::BAND ? SLJIT_AND32
					: op == OpCode::BOR ? SLJIT_OR32
					: op == OpCode::BXOR ? SLJIT_XOR32
					: op == OpCode::SHL ? SLJIT_SHL32 : SLJIT_ASHR32;
				sljit_emit_op2(m_compiler, operation, SLJIT_R0, 0, SLJIT_S2, 0, SLJIT_R0, 0);
				sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_S32, SLJIT_FR0, 0, SLJIT_R0, 0);
				break;
			}
			case OpCode::BNOT:
				convertWord(instruction.b);
				sljit_emit_op2(m_compiler, SLJIT_XOR32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, -1);
				sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_S32, SLJIT_FR0, 0, SLJIT_R0, 0);
				break;
			case OpCode::JMP:
				return;
			default:
				__builtin_unreachable();
		}
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S0), destination, SLJIT_FR0, 0);
	}

	void* finish(size_t& codeBytes) {
		sljit_emit_return_void(m_compiler);
		void* code = sljit_generate_code(m_compiler, 0, nullptr);
		if (!code) throw std::bad_alloc();
		codeBytes = sljit_get_generated_code_size(m_compiler);
		return code;
	}

private:
	void loadOperand(int selector, sljit_s32 floatingRegister) {
		const bool constant = selector < 0;
		const int index = constant ? -selector - 1 : selector;
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, floatingRegister, 0,
			SLJIT_MEM1(constant ? SLJIT_S1 : SLJIT_S0), static_cast<sljit_sw>(index) * sizeof(Value));
	}

	void canonicalizeNumber() {
		// Arithmetic returns the canonical numeric NaN, never a tagged payload.
		auto* ordered = sljit_emit_fcmp(m_compiler, SLJIT_ORDERED,
			SLJIT_FR0, 0, SLJIT_FR0, 0);
		sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(VALUE_QNAN_MASK));
		sljit_set_label(ordered, sljit_emit_label(m_compiler));
	}

	void convertWord(int selector) {
		if (selector < 0) {
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM,
				static_cast<sljit_s32>(toU32(m_constants[-selector - 1])));
			return;
		}
		loadOperand(selector, SLJIT_FR0);
		const auto convert = static_cast<uint32_t (*)(double)>(&toU32);
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS1(32, F64), SLJIT_IMM, SLJIT_FUNC_ADDR(convert));
	}

	sljit_compiler* m_compiler;
	const Value* m_constants;
};

} // namespace

std::unique_ptr<NativeBlock> NativeBlock::compile(
	std::span<const NativeBlockInstruction> instructions,
	const Value* constants,
	size_t& cacheBytes
) {
	auto block = std::unique_ptr<NativeBlock>(new NativeBlock(cacheBytes));
	NativeBlockCompiler compiler(constants);
	for (const auto& source : instructions) {
		const auto& instruction = *source.decoded;
		compiler.emit(instruction);
		block->cycles += instruction.baseCycles;
		block->currentPc = source.pc;
		block->lastPc = source.pc + (static_cast<u32>(instruction.width) - 1u) * INSTRUCTION_BYTES;
		block->nextPc = static_cast<OpCode>(instruction.op) == OpCode::JMP
			? instruction.bx : source.pc + static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
		if (static_cast<OpCode>(instruction.op) != OpCode::JMP) {
			block->registerTop = std::max(block->registerTop, static_cast<int>(instruction.a) + 1);
		}
	}
	block->m_code = compiler.finish(block->codeBytes);
	cacheBytes += block->codeBytes;
	return block;
}

NativeBlock::~NativeBlock() {
	if (m_code) sljit_free_code(m_code, nullptr);
	m_cacheBytes -= codeBytes;
}

void NativeBlock::run(Value* registers, const Value* constants) const {
	using Entry = void (SLJIT_FUNC *)(Value*, const Value*);
	reinterpret_cast<Entry>(m_code)(registers, constants);
}

} // namespace bmsx
