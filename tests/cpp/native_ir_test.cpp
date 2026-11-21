#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_optimize.h"
#include "machine/cpu/native_ir_liveness.h"
#include "machine/cpu/native_ir_numeric.h"

#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

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
	NativeRegisterUses uses;
	region.optimize({}, uses);
	const auto& field = std::get<NativeTableAccess>(ops[0].operation);
	const auto& arithmetic = std::get<NativeArithmetic>(ops[1].operation);
	const auto& store = std::get<NativeTableAccess>(ops[2].operation);
	const auto& add = std::get<NativeNumericPlan>(arithmetic.strategy);
	require(field.resultTag == ValueTag::Float && ops[0].slow->exit == NativeBlockExit::ReadField,
		"only a successful own-field hit provides the Float proof");
	require(add.action == NativeNumericAction::Float && add.left == ValueTag::Float
		&& add.right == ValueTag::Integer && !add.guardLeft && add.guardRight
		&& arithmetic.left == field.value && store.value == arithmetic.result,
		"the sum uses the proven field result, checks the other input and supplies the store");
	require(ops[1].before == NativeResumePoint{pc + 4, decoded[0].baseCycles, 10, NativeResumePoint::CompletedInstruction{pc, pc}}
		&& ops[1].slow->lastPc == pc + 8 && ops[1].slow->nextPc == pc + 12,
		"a type miss retires only GETFIELD before replaying the WIDE sum");
}

void fieldSelectionOwnsColdCutAndContinuation() {
	constexpr u32 pc = 0x5100;
	std::array<DecodedInstruction, 5> decoded{};
	std::array<NativeBlockInstruction, 5> source;
	const std::array opcodes{OpCode::K1, OpCode::GETFIELD, OpCode::MOV, OpCode::K1, OpCode::ADD};
	for (size_t i = 0; i < decoded.size(); ++i) {
		decoded[i].op = static_cast<u8>(opcodes[i]);
		decoded[i].width = 1;
		decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
		source[i] = {&decoded[i], pc + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	decoded[1].a = 6;
	decoded[1].b = 3;
	decoded[1].tableCacheSlot = 0;
	decoded[2].a = 9;
	decoded[2].b = 8;
	decoded[3].a = 7;
	decoded[4].a = 5;
	decoded[4].b = 6;
	decoded[4].c = 7;
	const std::array runs{NativeBlockSource{source}};
	{
		NativeIrRegion region(runs, {}, {}, false, NativeCompilationTier::ColdImage);
		require(region.instructionCount() == 1 && region.entries.front()->terminal.nextPc == pc + INSTRUCTION_BYTES,
			"unobserved numeric field use defers only its suffix, even across independent assignments");
	}

	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		decoded[4].observeNativeNumericTypes(valueFloat(1.5f), valueInteger(1));
	{
		NativeIrRegion region(runs, {});
		const auto& field = std::get<NativeTableAccess>(region.blocks().front().instructions[1].operation);
		require(region.blocks().size() == 1 && field.resultTag == ValueTag::Float,
			"an own-slot hit has a known type without a continuation checkpoint");
	}
	decoded[3].a = 6;
	{
		NativeIrRegion region(runs, {});
		const auto& field = std::get<NativeTableAccess>(region.blocks().front().instructions[1].operation);
		require(region.blocks().size() == 2 && !field.resultTag
			&& region.entries[1]->firstPc == pc + 2 * INSTRUCTION_BYTES,
			"an overwritten field does not donate a type and its real lookup can charge variable work");
	}
}

void decodedFieldsBecomeOperationsAndEffects() {
	DecodedInstruction memory, call, rk;
	memory.op = static_cast<u8>(OpCode::STORE_MEM_WORDS_D);
	memory.a = 20; memory.b = 6; memory.c = 3; memory.disp = 7;
	memory.width = 2; memory.baseCycles = BASE_CYCLES[memory.op];
	call.op = static_cast<u8>(OpCode::CALL);
	call.a = 4; call.b = 3; call.c = 0;
	call.width = 1; call.baseCycles = BASE_CYCLES[call.op];
	const std::array first{NativeBlockInstruction{&memory, 0x4000}};
	const std::array second{NativeBlockInstruction{&call, 0x4008}};
	rk = memory;
	rk.op = static_cast<u8>(OpCode::STORE_MEM_WORDS);
	rk.b = -1; rk.width = 1;
	const std::array third{NativeBlockInstruction{&rk, 0x4010}};
	const std::array source{NativeBlockSource{first}, NativeBlockSource{second}, NativeBlockSource{third}};
	NativeIrRegion region(source, {});
	const auto& write = region.blocks()[0].instructions.front();
	const auto& transfer = region.blocks()[1].instructions.front();
	const auto& store = std::get<NativeMemoryAccess>(write.operation);
	const auto& invoke = std::get<NativeCallSite>(transfer.operation);
	require(store.mode == NativeMemoryMode::StoreWords && store.format == MemoryAccessKind::Word
		&& store.displacement == 28 && store.address == 6 && store.wordCount == 3
		&& write.slots.readsRange.first == 20 && write.slots.readsRange.end() == 23 && !write.slots.readsRange.open,
		"a counted displaced write carries a byte displacement and a register address");
	const auto& direct = std::get<NativeMemoryAccess>(region.blocks()[2].instructions.front().operation);
	require(direct.address == -1 && direct.displacement == 0, "only the undisplaced form takes an RK address");
	require(invoke.callee == 4 && invoke.supplied == 2 && invoke.requested < 0
		&& transfer.slots.readsRange.end() == 7 && transfer.slots.writes.first == 4 && transfer.slots.writes.open,
		"a call carries a selected argument range, not the biased instruction operand");
}

void undefinedMoveKindDoesNotBecomeANumericWordMove() {
	DecodedInstruction move;
	move.op = static_cast<u8>(OpCode::MOV);
	move.a = 2;
	move.b = 1;
	move.c = 3;
	move.width = 2;
	move.baseCycles = BASE_CYCLES[move.op];
	const std::array instructions{NativeBlockInstruction{&move, 0x4100}};
	const std::array sources{NativeBlockSource{instructions}};
	NativeIrRegion region(sources, {});
	const auto& row = region.blocks()[0].instructions[0];
	require(std::holds_alternative<NativeReplay>(row.operation) && row.before.pc == 0x4100 && row.before.cycles == 0
		&& region.entries[0]->sideExits.empty(),
		"an unhandled move replays from its start without committing the numeric transfer");
}

void successorsImportLogicalTypesBeforeLowering() {
	constexpr u32 producerPc = 0x4000, consumerPc = 0x4200;
	DecodedInstruction load, jump, arithmetic;
	load.op = static_cast<u8>(OpCode::K1); load.a = 7; load.width = load.baseCycles = 1;
	jump.op = static_cast<u8>(OpCode::JMP); jump.bx = consumerPc; jump.width = jump.baseCycles = 1;
	arithmetic.op = static_cast<u8>(OpCode::ADD); arithmetic.a = 1; arithmetic.b = arithmetic.c = 7;
	arithmetic.width = 1; arithmetic.baseCycles = BASE_CYCLES[arithmetic.op];
	const std::array before{NativeBlockInstruction{&load, producerPc}, NativeBlockInstruction{&jump, producerPc + 4}};
	const std::array after{NativeBlockInstruction{&arithmetic, consumerPc}};
	const std::array sources{NativeBlockSource{before}, NativeBlockSource{after}};
	NativeIrRegion region(sources, {});
	NativeRegisterUses uses;
	region.optimize({}, uses);
	const auto& entry = region.blocks()[1];
	require(entry.entryTypes.size() == 1 && entry.entryTypes[0].slot == 7 && entry.entryTypes[0].tag == ValueTag::Integer,
		"the successor has an explicit Integer entry proof independently of host allocation");
	const auto& plan = std::get<NativeNumericPlan>(std::get<NativeArithmetic>(entry.instructions[0].operation).strategy);
	require(plan.action == NativeNumericAction::Word && !plan.guardLeft && !plan.guardRight,
		"the sum consumes its block's admission proof before a backend binds locations");
}

void onlyConsumedEntryProofsSurviveCopies() {
	constexpr u32 firstPc = 0x4000, copyPc = 0x4100, consumerPc = 0x4200;
	std::array<DecodedInstruction, 7> decoded{};
	const std::array opcodes{OpCode::K1, OpCode::K1, OpCode::JMP, OpCode::MOV, OpCode::SETGL, OpCode::JMP, OpCode::ADD};
	for (size_t index = 0; index < decoded.size(); ++index) {
		auto& inst = decoded[index];
		inst.op = static_cast<u8>(opcodes[index]);
		inst.width = 1;
		inst.baseCycles = BASE_CYCLES[inst.op];
	}
	decoded[0].a = 7;
	decoded[1].a = 8;
	decoded[2].bx = copyPc;
	decoded[3].a = 10;
	decoded[3].b = 7;
	decoded[4].a = 8;
	decoded[5].bx = consumerPc;
	decoded[6].a = 1;
	decoded[6].b = decoded[6].c = 10;
	const std::array producer{NativeBlockInstruction{&decoded[0], firstPc},
		NativeBlockInstruction{&decoded[1], firstPc + 4}, NativeBlockInstruction{&decoded[2], firstPc + 8}};
	const std::array copy{NativeBlockInstruction{&decoded[3], copyPc},
		NativeBlockInstruction{&decoded[4], copyPc + 4}, NativeBlockInstruction{&decoded[5], copyPc + 8}};
	const std::array consumer{NativeBlockInstruction{&decoded[6], consumerPc}};
	const std::array sources{NativeBlockSource{producer}, NativeBlockSource{copy}, NativeBlockSource{consumer}};
	NativeIrRegion region(sources, {});
	NativeRegisterUses uses;
	region.optimize({}, uses);
	const auto blocks = region.blocks();
	for (size_t target : {1u, 2u})
		require(blocks[target].typePredecessor == target - 1 && blocks[target].entryTypes.size() == 1,
			"only the consumed proof reaches each block's entry contract");
	require(blocks[1].entryTypes[0].slot == 7 && blocks[2].entryTypes[0].slot == 10
		&& blocks[2].entryTypes[0].tag == ValueTag::Integer,
		"the proof follows the copied value, not the separately read global-store operand");
}

void registerUses() {
	std::array first{NativeInstruction(NativeLiteral{1, valueInteger(0)})};
	std::array left{NativeInstruction(NativeClearSlots{10, 2})};
	std::array right{NativeInstruction(NativeLiteral{11, valueInteger(0)})};
	std::array join{NativeInstruction(NativeArithmetic{8, 10, 12, OpCode::ADD, NativeArithmeticHint{}})};
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

	std::vector<NativeInstruction> instructions(64, NativeInstruction(NativeLiteral{1, valueInteger(0)}));
	instructions[0] = NativeInstruction(NativeMove{10, 9, ValueMoveKind::Copy});
	instructions[2] = NativeInstruction(NativeMove{8, 10, ValueMoveKind::Copy});
	instructions[4] = NativeInstruction(NativeClearSlots{10, 2});
	instructions[5] = NativeInstruction(NativeMemoryAccess{15, 16, 12u, MemoryAccessKind::Word, NativeMemoryMode::StoreWords, 3});
	instructions[6] = NativeInstruction(NativeClosure{{65537u, 1, CLOSURE_ADDRESS_REGISTER_FLAG}});
	instructions[63] = NativeInstruction(NativeLiteral{10, valueInteger(0)});
	uses.beginBlock(instructions);
	constexpr int never = std::numeric_limits<int>::max();
	require(uses.nextUse(1, 10) == 1 && uses.nextUse(2, 10) == 0 && uses.nextUse(3, 10) == 1,
		"next use counts both reads and overwrites");
	require(uses.nextUse(3, 11) == 1 && uses.nextUse(3, 12) == never,
		"LOADNIL overwrites exactly its supplied range");
	require(uses.nextUse(5, 14) == never && uses.nextUse(5, 15) == 0 && uses.nextUse(5, 16) == 0
		&& uses.nextUse(5, 17) == 0 && uses.nextUse(5, 18) == never,
		"word-store liveness includes the exact source range and an aliased address");
	require(uses.nextUse(6, 65537) == 0 && uses.nextUse(6, 1) == 0 && uses.nextUse(6, 65538) == never,
		"register-address CLOSURE reads the complete Bx slot and independently defines its result");
	require(uses.nextUse(62, 10) == 1 && uses.nextUse(63, 10) == 0 && uses.nextUse(64, 10) == never,
		"next use includes the final instruction in a full block");
}
} // namespace

int main() {
	try {
		numericPlans();
		fieldChainHasAnExplicitResumePoint();
		fieldSelectionOwnsColdCutAndContinuation();
		decodedFieldsBecomeOperationsAndEffects();
		undefinedMoveKindDoesNotBecomeANumericWordMove();
		successorsImportLogicalTypesBeforeLowering();
		onlyConsumedEntryProofsSurviveCopies();
		registerUses();
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
