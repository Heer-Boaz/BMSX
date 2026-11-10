#include "machine/cpu/native_block_compiler.h"

#include "machine/cpu/call_state.h"
#include "machine/cpu/closure.h"
#include "machine/cpu/execution_image.h"

namespace bmsx {

void NativeBlockCompiler::emitContext(const DecodedInstruction& instruction, NativeBlockExitSite* exit) {
	const auto op = static_cast<OpCode>(instruction.op);
	if (op == OpCode::GETUP || op == OpCode::SETUP) { emitUpvalue(instruction, exit); return; }
	if (op == OpCode::VARARG) { emitVararg(instruction, exit); return; }
	if (op == OpCode::LOADNIL) {
		if (instruction.b == 0) return;
		discardRegisterRange(instruction.a, static_cast<int>(instruction.a) + instruction.b);
		sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueNil()));
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_S0, 0, SLJIT_IMM, instruction.a * sizeof(Value));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, instruction.b);
		auto* loop = sljit_emit_label(m_compiler);
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R0), 0, SLJIT_FR0, 0);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, sizeof(Value));
		sljit_emit_op2(m_compiler, SLJIT_SUB32 | SLJIT_SET_Z, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
		sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_NOT_ZERO), loop);
		return;
	}
	if (op == OpCode::LOADKR) {
		convertWord(instruction.b);
		SlowPath slow; slow.exit = exit; slow.registers = registerSnapshot();
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0,
			SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, constantCount));
		m_slowPaths.push_back(slow);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_S2, 0, SLJIT_R0, 0);
		sljit_emit_op2(m_compiler, SLJIT_SHL, SLJIT_S2, 0, SLJIT_S2, 0, SLJIT_IMM, 3);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_S2, 0, SLJIT_S1, 0, SLJIT_S2, 0);
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_S2), 0);
		writeRegister(instruction.a);
		return;
	}
	const bool store = op == OpCode::SETGL || op == OpCode::SETSYS;
	const auto bank = op == OpCode::GETSYS || op == OpCode::SETSYS
		? offsetof(NativeBlockRunState, systemGlobalValues) : offsetof(NativeBlockRunState, globalValues);
	if (store) loadOperand(instruction.a, SLJIT_FR0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_S2, 0, SLJIT_MEM1(SLJIT_S3), bank);
	if (store) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S2), instruction.bx * sizeof(Value), SLJIT_FR0, 0);
	else {
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_S2), instruction.bx * sizeof(Value));
		writeRegister(instruction.a);
	}
}

void NativeBlockCompiler::emitUpvalue(const DecodedInstruction& instruction, NativeBlockExitSite* exit) {
	const bool store = instruction.op == static_cast<u8>(OpCode::SETUP);
	const auto fields = Upvalue::nativeOffsets();
	if (store) loadOperand(instruction.a, SLJIT_FR0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, closure));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), Closure::nativeUpvaluesOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), instruction.b * sizeof(Upvalue*));
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), fields.open);
	auto* open = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_S2, 0, SLJIT_R0, 0, SLJIT_IMM, fields.value);
	auto* addressReady = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	sljit_set_label(open, sljit_emit_label(m_compiler));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), fields.frame);
	if (store) {
		// Outer-frame and closed cells cannot alias this register bank. Only
		// a write back into our own live bank needs a materialized prefix.
		SlowPath slow; slow.exit = exit; slow.registers = registerSnapshot();
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R1, 0, SLJIT_R2, 0);
		m_slowPaths.push_back(slow);
	} else {
		auto* distinct = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_R2, 0);
		emitRegisterSnapshot(registerSnapshot());
		sljit_set_label(distinct, sljit_emit_label(m_compiler));
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_S2, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, registers));
	sljit_emit_op1(m_compiler, SLJIT_MOV_S32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), fields.index);
	sljit_emit_op2(m_compiler, SLJIT_SHL, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 3);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_S2, 0, SLJIT_S2, 0, SLJIT_R0, 0);
	sljit_set_label(addressReady, sljit_emit_label(m_compiler));
	if (store) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S2), 0, SLJIT_FR0, 0);
	else {
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_S2), 0);
		writeRegister(instruction.a);
	}
}

void NativeBlockCompiler::emitVararg(const DecodedInstruction& instruction, NativeBlockExitSite* exit) {
	const int first = instruction.a, count = instruction.b;
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, frame));
	if (count == 0) sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, varargCount));
	else sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, count);
	sljit_jump* empty = count == 0 ? sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0) : nullptr;
	sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, first);
	SlowPath slow; slow.exit = exit; slow.registers = registerSnapshot();
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R2, 0,
		SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, stackCapacity));
	m_slowPaths.push_back(slow);
	if (empty) sljit_set_label(empty, sljit_emit_label(m_compiler));
	if (count == 0) {
		// Preserve dirty slots which lie beyond the dynamic overwrite range;
		// overwritten slots need no writeback before the bulk copy.
		for (int slot = 0; slot < m_registerCount; ++slot) {
			auto& cached = m_registers[slot];
			if (cached.guest < first) continue;
			if (cached.dirty) {
				auto* overwritten = sljit_emit_cmp(m_compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, cached.guest - first);
				sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_S0), cached.guest * sizeof(Value), cachedFloatRegister(slot), 0);
				sljit_set_label(overwritten, sljit_emit_label(m_compiler));
			}
			cached = CachedRegister{};
		}
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_S5, 0, SLJIT_R0, 0, SLJIT_IMM, first);
	} else discardRegisterRange(first, first + count);
	if (count != 0) {
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_S2, 0, SLJIT_S0, 0, SLJIT_IMM, (first + count) * sizeof(Value));
		auto* allAvailable = sljit_emit_cmp(m_compiler, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R0, 0,
			SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, varargCount));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, varargCount));
		sljit_set_label(allAvailable, sljit_emit_label(m_compiler));
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, varargCount));
	sljit_emit_op2(m_compiler, SLJIT_SHL, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 3);
	sljit_emit_op2(m_compiler, SLJIT_SUB, SLJIT_R1, 0, SLJIT_S0, 0, SLJIT_R1, 0);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_S0, 0, SLJIT_IMM, first * sizeof(Value));
	auto* noCopy = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	auto* copy = sljit_emit_label(m_compiler);
	sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_R1), 0);
	sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_FR0, 0);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, sizeof(Value));
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, sizeof(Value));
	sljit_emit_op2(m_compiler, SLJIT_SUB32 | SLJIT_SET_Z, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_NOT_ZERO), copy);
	sljit_set_label(noCopy, sljit_emit_label(m_compiler));
	if (count != 0) {
		auto* noFill = sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL, SLJIT_R2, 0, SLJIT_S2, 0);
		sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueNil()));
		auto* fill = sljit_emit_label(m_compiler);
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_FR0, 0);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, sizeof(Value));
		sljit_set_label(sljit_emit_cmp(m_compiler, SLJIT_LESS, SLJIT_R2, 0, SLJIT_S2, 0), fill);
		sljit_set_label(noFill, sljit_emit_label(m_compiler));
	}
}
} // namespace bmsx
