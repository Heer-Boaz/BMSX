#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_optimize.h"
#include "machine/cpu/native_ir_liveness.h"
#include "machine/cpu/native_ir_numeric.h"

#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void numericPlans() {
	constexpr auto integer = ValueTag::Integer, floating = ValueTag::Float;
	constexpr NativeArithmeticFeedback integers{integer, integer}, mixed{integer, floating};

	const auto fault = planNativeNumeric(OpCode::ADD, ValueTag::Nil, integer, integers, false, true);
	require(fault.action == NativeNumericAction::Fault && !fault.guardLeft && !fault.result,
		"a known Nil is a guest operand fault, not a missing proof");

	const auto generic = planNativeNumeric(OpCode::ADD, std::nullopt, std::nullopt, integers, false, false);
	require(generic.action == NativeNumericAction::Kernel && !generic.result && !generic.guardLeft && !generic.guardRight,
		"an untyped, unconsumed sum is not specialized from feedback alone");

	const auto store = planNativeNumeric(OpCode::ADD, std::nullopt, std::nullopt, mixed, false, true);
	require(store.action == NativeNumericAction::Float && store.left == integer && store.right == floating
		&& store.result == floating && store.guardLeft && store.guardRight,
		"a store consumer admits separate assumptions for both input values");

	const auto known = planNativeNumeric(OpCode::SUB, floating, std::nullopt, integers, false, false);
	require(known.action == NativeNumericAction::Float && known.left == floating && known.right == integer
		&& !known.guardLeft && known.guardRight && known.result == floating,
		"a proven operand keeps its tag even when feedback predicts a different one");

	const auto alias = planNativeNumeric(OpCode::MUL, std::nullopt, std::nullopt, integers, true, true);
	require(alias.action == NativeNumericAction::Word && alias.left == integer && alias.right == integer
		&& alias.guardLeft && !alias.guardRight && alias.result == integer,
		"two uses of one value share its guest tag guard");

	const auto division = planNativeNumeric(OpCode::DIV, integer, integer, std::nullopt, false, false);
	require(division.action == NativeNumericAction::Float && division.result == floating,
		"integer operands to DIV produce a Float");

	const auto modulo = planNativeNumeric(OpCode::MOD, integer, integer, std::nullopt, false, false);
	require(modulo.action == NativeNumericAction::Kernel && modulo.result == integer,
		"integer modulo keeps the result proof without bypassing the semantic kernel");

	const auto bitwise = planNativeNumeric(OpCode::BNOT, floating, std::nullopt, std::nullopt, false, false);
	require(bitwise.action == NativeNumericAction::Kernel && bitwise.result == integer,
		"bitwise conversion is a kernel on Float and only yields an Integer");

	const auto unary = planNativeNumeric(OpCode::UNM, floating, std::nullopt, std::nullopt, false, false);
	require(unary.action == NativeNumericAction::Float && unary.result == floating,
		"unary negation needs only its one operand proof");
}

void fieldChainHasAnExplicitResumePoint() {
	constexpr u32 pc = 0x4000u;
	std::array<DecodedInstruction, 3> decoded{};
	decoded[0].op = static_cast<u8>(OpCode::GETFIELD);
	decoded[0].a = 9; decoded[0].b = 6; decoded[0].tableCacheSlot = 0;
	decoded[1].op = static_cast<u8>(OpCode::ADD);
	decoded[1].a = 8; decoded[1].b = 9; decoded[1].c = 1;
	decoded[2].op = static_cast<u8>(OpCode::SETFIELD);
	decoded[2].a = 6; decoded[2].c = 8; decoded[2].tableCacheSlot = 0;
	for (auto& instruction : decoded) {
		instruction.width = 1;
		instruction.baseCycles = BASE_CYCLES[instruction.op];
	}
	// The arithmetic is WIDE; a miss must retry at its prefix, not its body.
	decoded[1].width = 2;
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		decoded[1].observeNativeNumericTypes(valueFloat(10.5f), valueInteger(1));

	const std::array input{NativeBlockInstruction{&decoded[0], pc},
		NativeBlockInstruction{&decoded[1], pc + 4}, NativeBlockInstruction{&decoded[2], pc + 12}};
	const std::array sources{NativeBlockSource{input}};
	NativeIrRegion region(sources, {});
	const auto ops = region.blocks()[0].instructions;
	NativeTypePropagation types;
	types.specialize(ops, {});
	const auto& add = std::get<NativeNumericPlan>(ops[1].specialization);
	require(std::get<NativeFieldRead>(ops[0].specialization).result == ValueTag::Float
		&& ops[0].slow->exit == NativeBlockExit::ReadField,
		"only a successful own-field hit provides the Float proof");
	require(add.action == NativeNumericAction::Float && add.left == ValueTag::Float
		&& add.right == ValueTag::Integer && !add.guardLeft && add.guardRight
		&& ops[1].operands.b == ops[0].operands.a && ops[2].operands.c == ops[1].operands.a,
		"the sum uses the proven field result, checks the other input and supplies the store");
	require(ops[1].before == NativeResumePoint{pc + 4, decoded[0].baseCycles, 10}
		&& ops[1].slow->lastPc == pc + 8 && ops[1].slow->nextPc == pc + 12,
		"a type miss retires only GETFIELD before replaying the WIDE sum");
}

void registerUses() {
	std::array first{NativeInstruction{{OpCode::K0, 1, 0, 0, 0}, {}, nullptr, {}}};
	std::array left{NativeInstruction{{OpCode::LOADNIL, 10, 2, 0, 0}, {}, nullptr, {}}};
	std::array right{NativeInstruction{{OpCode::K0, 11, 0, 0, 0}, {}, nullptr, {}}};
	std::array join{NativeInstruction{{OpCode::ADD, 8, 10, 12, 0}, {}, nullptr, {}}};
	std::array blocks{
		NativeIrBlock{first, nullptr, {1, 2}}, NativeIrBlock{left, nullptr, {3, 3}},
		NativeIrBlock{right, nullptr, {3, 4}}, NativeIrBlock{join, nullptr, {4, 4}},
	};
	NativeRegisterUses uses;
	uses.analyze(blocks);
	require(uses.hasForwardMerge(3) && !uses.hasForwardMerge(1) && !uses.hasForwardMerge(2),
		"only the diamond join has distinct forward predecessors");
	require(uses.entryReads(0, 10) && !uses.entryReads(1, 10) && uses.entryReads(2, 10)
		&& uses.entryReads(1, 12) && uses.entryReads(3, 10) && !uses.entryReads(3, 11),
		"entry liveness follows both edges but excludes values overwritten before they are read");
	blocks[2].successors = {4, 4};
	uses.analyze(blocks);
	require(!uses.hasForwardMerge(3), "two exits from one predecessor do not form a merge");

	std::array<NativeInstruction, 64> instructions;
	instructions.fill(NativeInstruction{{OpCode::K0, 1, 0, 0, 0}, {}, nullptr, {}});
	instructions[0].operands = {OpCode::MOV, 10, 9, 0, 0};
	instructions[2].operands = {OpCode::MOV, 8, 10, 0, 0};
	instructions[4].operands = {OpCode::LOADNIL, 10, 2, 0, 0};
	instructions[5].operands = {OpCode::STORE_MEM_WORDS_D, 15, 16, 3, 0};
	instructions[63].operands = {OpCode::K0, 10, 0, 0, 0};
	uses.beginBlock(instructions);
	constexpr int never = std::numeric_limits<int>::max();
	require(uses.nextUse(1, 10) == 1 && uses.nextUse(2, 10) == 0 && uses.nextUse(3, 10) == 1,
		"next use counts both reads and overwrites");
	require(uses.nextUse(3, 11) == 1 && uses.nextUse(3, 12) == never,
		"LOADNIL overwrites exactly its supplied range");
	require(uses.nextUse(5, 14) == never && uses.nextUse(5, 15) == 0 && uses.nextUse(5, 16) == 0
		&& uses.nextUse(5, 17) == 0 && uses.nextUse(5, 18) == never,
		"word-store liveness includes the exact source range and an aliased address");
	require(uses.nextUse(62, 10) == 1 && uses.nextUse(63, 10) == 0 && uses.nextUse(64, 10) == never,
		"next use includes the final instruction in a full block");
}
} // namespace

int main() {
	try {
		numericPlans();
		fieldChainHasAnExplicitResumePoint();
		registerUses();
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
