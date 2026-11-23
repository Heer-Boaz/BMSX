#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/jit/ir/region.h"
#include "machine/cpu/jit/ir/dump.h"
#include "machine/cpu/jit/ir/type_propagation.h"
#include "machine/cpu/jit/ir/liveness.h"
#include "machine/cpu/jit/ir/numeric_plan.h"
#include "machine/cpu/jit/ir/value_flow.h"

#include <array>
#include <iostream>
#include <limits>
#include <sstream>
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

	const auto fault = planNativeNumeric(OpCode::ADD, ValueTag::Nil, integer, integers, false);
	require(fault.action == NativeNumericAction::Fault && !fault.guardLeft && !fault.result,
		"a known Nil is a guest operand fault, not a missing proof");

	const auto generic = planNativeNumeric(OpCode::ADD, std::nullopt, std::nullopt, std::nullopt, false);
	require(generic.action == NativeNumericAction::Kernel && !generic.result && !generic.guardLeft && !generic.guardRight,
		"unknown operands with no stable feedback use the numeric kernel");

	const auto predicted = planNativeNumeric(OpCode::ADD, std::nullopt, std::nullopt, mixed, false);
	require(predicted.action == NativeNumericAction::Float && predicted.left == integer && predicted.right == floating
		&& predicted.result == floating && predicted.guardLeft && predicted.guardRight,
		"stable feedback permits independent guards for two unknown operands");

	const auto known = planNativeNumeric(OpCode::SUB, floating, std::nullopt, integers, false);
	require(known.action == NativeNumericAction::Float && known.left == floating && known.right == integer
		&& !known.guardLeft && known.guardRight && known.result == floating,
		"a proven operand keeps its tag even when feedback predicts a different one");

	const auto alias = planNativeNumeric(OpCode::MUL, std::nullopt, std::nullopt, integers, true);
	require(alias.action == NativeNumericAction::Word && alias.left == integer && alias.right == integer
		&& alias.guardLeft && !alias.guardRight && alias.result == integer,
		"two uses of one value share its guest tag guard");

	const auto division = planNativeNumeric(OpCode::DIV, integer, integer, std::nullopt, false);
	require(division.action == NativeNumericAction::Float && division.result == floating,
		"integer operands to DIV produce a Float");

	const auto modulo = planNativeNumeric(OpCode::MOD, integer, integer, std::nullopt, false);
	require(modulo.action == NativeNumericAction::Kernel && modulo.result == integer,
		"integer modulo keeps the result proof without bypassing the semantic kernel");

	const auto bitwise = planNativeNumeric(OpCode::BNOT, floating, std::nullopt, std::nullopt, false);
	require(bitwise.action == NativeNumericAction::Kernel && bitwise.result == integer,
		"bitwise conversion is a kernel on Float and only yields an Integer");

	const auto unary = planNativeNumeric(OpCode::UNM, floating, std::nullopt, std::nullopt, false);
	require(unary.action == NativeNumericAction::Float && unary.result == floating,
		"unary negation needs only its one operand proof");
}

void widenedNumericSitesHaveOnlyAnOperandFaultCheckpoint() {
	constexpr u32 pc = 0x4000u;
	const std::array constants{NativeImageConstant{0, valueInteger(7)}, NativeImageConstant{1, valueInteger(2)},
		NativeImageConstant{2, valueFloat(1.5f)}};
	const auto verify = [&](OpCode op, bool widened, i16 left, i16 right, NativeNumericAction action,
		std::optional<ValueTag> result, bool sample) {
		const DecodedInstruction prefix{.a = 4, .op = static_cast<u8>(OpCode::K1), .width = 1,
			.baseCycles = BASE_CYCLES[static_cast<u8>(OpCode::K1)]};
		DecodedInstruction arithmetic{.a = 7, .b = left, .c = right, .op = static_cast<u8>(op),
			.width = 2, .baseCycles = BASE_CYCLES[static_cast<u8>(op)]};
		if (widened) arithmetic.widenNativeNumericFeedback();
		const std::array rows{NativeBlockInstruction{&prefix, pc}, NativeBlockInstruction{&arithmetic, pc + INSTRUCTION_BYTES}};
		const std::array sources{NativeBlockSource{rows}};
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(sources, uses, false, {.observesArithmetic = true}, {.imageConstants = constants});
		const auto& block = region.blocks().front();
		require(block.instructions.size() == rows.size(), "numeric lowering retains the preceding instruction");
		const auto& instruction = block.instructions.back();
		const auto& plan = std::get<NativeNumericPlan>(std::get<NativeArithmetic>(instruction.operation).strategy);
		require(plan.action == action && plan.result == result && plan.sampleOperands == sample,
			"only widened ADD/SUB/MUL with unknown tags select the direct dynamic numeric plan");
		require(!plan.guardLeft && !plan.guardRight && !instruction.replay,
			"the numeric path does not speculate on operand tags or replay a legal pair");
		const auto exits = region.sideExits(block);
		if (action == NativeNumericAction::Word || action == NativeNumericAction::Float) {
			require(!instruction.slow && exits.empty(), "proved numeric operands keep the direct static operation");
		} else {
			require(instruction.slow && exits.size() == 1, "an unknown numeric operand has one fault checkpoint");
			const auto& fault = exits[*instruction.slow];
			require(fault.exit == NativeBlockExit::InvalidOperand && fault.currentPc == pc + INSTRUCTION_BYTES
				&& fault.lastPc == pc + 2u * INSTRUCTION_BYTES && fault.nextPc == pc + 3u * INSTRUCTION_BYTES
				&& fault.cycles == prefix.baseCycles + arithmetic.baseCycles && fault.registerTop == 5,
				"the arithmetic fault pays the WIDE instruction, preserves its prefix PC and does not publish its destination");
		}
	};
	for (const auto op : {OpCode::ADD, OpCode::SUB, OpCode::MUL})
		verify(op, true, 1, 2, NativeNumericAction::DynamicNumber, std::nullopt, false);
	verify(OpCode::SUB, true, -3, 2, NativeNumericAction::DynamicNumber, ValueTag::Float, false);
	verify(OpCode::MUL, true, -1, -2, NativeNumericAction::Word, ValueTag::Integer, false);
	verify(OpCode::ADD, true, -1, -3, NativeNumericAction::Float, ValueTag::Float, false);
	verify(OpCode::ADD, false, 1, 2, NativeNumericAction::Kernel, std::nullopt, true);
	verify(OpCode::FLOORDIV, false, 1, 2, NativeNumericAction::Kernel, std::nullopt, false);
}

void fieldChainHasAnExplicitResumePoint() {
	constexpr u32 pc = 0x4000u;
	std::array<DecodedInstruction, 3> decoded{};
	decoded[0].op = static_cast<u8>(OpCode::GETFIELD);
	decoded[0].a = 9; decoded[0].b = 6; decoded[0].tableCacheSlot() = 0;
	decoded[1].op = static_cast<u8>(OpCode::ADD);
	decoded[1].a = 8; decoded[1].b = 9; decoded[1].c = 1;
	decoded[2].op = static_cast<u8>(OpCode::SETFIELD);
	decoded[2].a = 6; decoded[2].c = 8; decoded[2].tableCacheSlot() = 0;
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
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(sources, uses);
	const auto ops = region.blocks()[0].instructions;
	const auto& field = std::get<NativeTableAccess>(ops[0].operation);
	const auto& arithmetic = std::get<NativeArithmetic>(ops[1].operation);
	const auto& store = std::get<NativeTableAccess>(ops[2].operation);
	const auto& add = std::get<NativeNumericPlan>(arithmetic.strategy);
	require(!ops[1].slow && ops[1].replay, "the Float sum has only its scalar guard exit");
	const auto& replay = region.sideExits(region.blocks().front())[*ops[1].replay];
	require(field.resultTag == ValueTag::Float && region.sideExits(region.blocks().front())[*ops[0].slow].exit == NativeBlockExit::ReadField,
		"only a successful own-field hit provides the Float proof");
	require(add.action == NativeNumericAction::Float && add.left == ValueTag::Float
		&& add.right == ValueTag::Integer && !add.guardLeft && add.guardRight
		&& arithmetic.left == field.value && store.value == arithmetic.result,
		"the sum uses the proven field result, checks the other input and supplies the store");
	require(replay.exit == NativeBlockExit::ScalarBoundary && replay.operands.replay.hasCompletedInstruction
		&& replay.operands.replay.arithmetic == NativeArithmeticFeedback{ValueTag::Float, ValueTag::Integer}
		&& replay.currentPc == pc && replay.lastPc == pc && replay.nextPc == pc + 4
		&& replay.cycles == decoded[0].baseCycles && replay.registerTop == 10,
		"a type miss retires only GETFIELD before replaying the WIDE sum");
}

void fieldSelectionPreservesColdCodeAndContinuation() {
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
	decoded[1].tableCacheSlot() = 0;
	decoded[2].a = 9;
	decoded[2].b = 8;
	decoded[3].a = 7;
	decoded[4].a = 5;
	decoded[4].b = 6;
	decoded[4].c = 7;
	const std::array runs{NativeBlockSource{source}};
	{
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(runs, uses, false, {.observesArithmetic = true});
		require(region.instructionCount() == decoded.size() && region.blocks().size() == 2,
			"unknown types select generic arithmetic without removing its field load or unrelated instructions");
		require(std::get<NativeTableAccess>(region.blocks().front().instructions[1].operation).readPlan
			== NativeTableReadPlan::ProbeOwnOrOneHop,
			"a checkpointed untyped field read can recover its own slot");
		const auto& block = region.blocks().back();
		const auto& sum = block.instructions.back();
		const auto& plan = std::get<NativeNumericPlan>(std::get<NativeArithmetic>(sum.operation).strategy);
		const auto exits = region.sideExits(block);
		require(plan.action == NativeNumericAction::Kernel && plan.sampleOperands && !sum.replay
			&& sum.slow && exits.size() == 1,
			"the generic sum samples in its kernel without an exit to rebuild the region");
		const auto& fault = exits[*sum.slow];
		require(fault.exit == NativeBlockExit::InvalidOperand && fault.currentPc == sum.pc
			&& fault.nextPc == sum.pc + INSTRUCTION_BYTES && fault.registerTop == 10
			&& fault.cycles == block.terminal.cycles,
			"passive sampling does not remove the generic sum's exact semantic fault");
	}

	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		decoded[4].observeNativeNumericTypes(valueFloat(1.5f), valueInteger(1));
	{
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(runs, uses);
		const auto& field = std::get<NativeTableAccess>(region.blocks().front().instructions[1].operation);
		require(region.blocks().size() == 1 && field.resultTag == ValueTag::Float,
			"an own-slot hit has a known type without a continuation checkpoint");
	}
	decoded[3].a = 6;
	{
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(runs, uses);
		const auto& field = std::get<NativeTableAccess>(region.blocks().front().instructions[1].operation);
		require(region.blocks().size() == 2 && !field.resultTag
			&& region.blocks()[1].firstPc == pc + 2 * INSTRUCTION_BYTES,
			"an overwritten field does not donate a type and its real lookup can charge variable work");
	}
}

void distinctFieldValuesSurviveCopiesAndSlotReuse() {
	constexpr u32 pc = 0x5200;
	const std::array opcodes{OpCode::K1, OpCode::GETFIELD, OpCode::MOV, OpCode::GETFIELD, OpCode::ADD, OpCode::JMP};
	std::array<DecodedInstruction, opcodes.size()> decoded{};
	std::array<NativeBlockInstruction, opcodes.size()> source;
	for (size_t i = 0; i < decoded.size(); ++i) {
		auto& inst = decoded[i];
		inst.op = static_cast<u8>(opcodes[i]);
		inst.width = 1;
		inst.baseCycles = BASE_CYCLES[inst.op];
		source[i] = {&inst, pc + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	decoded[1].a = decoded[3].a = 6;
	decoded[1].b = decoded[3].b = 3;
	decoded[1].tableCacheSlot() = decoded[3].tableCacheSlot() = 0;
	decoded[3].c = 1;
	decoded[2].a = 9; decoded[2].b = 6;
	decoded[4].a = 5; decoded[4].b = 9; decoded[4].c = 6;
	decoded[5].setBx(pc + 0x100);
	const std::array runs{NativeBlockSource{source}};
	NativeRegisterUses uses;
	NativeIrRegion cold;
	cold.build(runs, uses, false, {.observesArithmetic = true});
	const auto& coldSum = std::get<NativeArithmetic>(cold.blocks().back().instructions.front().operation);
	require(cold.instructionCount() == decoded.size() && cold.blocks().size() == 3
		&& cold.blocks().back().firstPc == source[4].pc && std::get<NativeNumericPlan>(coldSum.strategy).sampleOperands,
		"initial generic code keeps both field producers and the consumer");

	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		decoded[4].observeNativeNumericTypes(valueFloat(1.5f), valueInteger(2));
	NativeIrRegion warm;
	warm.build(runs, uses);
	require(warm.blocks().size() == 1, "two proved field reads can share a native segment");
	const auto instructions = warm.blocks().front().instructions;
	NativeSlotValues values;
	values.beginRegion(instructions);
	values.beginScope();
	for (u16 index = 0; index < 4; ++index) values.advance(instructions[index], index);
	const auto sum = values.advance(instructions[4], 4);
	require(values.origin(sum.inputs[0]) == NativeValueOrigin{1, 6}
		&& values.origin(sum.inputs[1]) == NativeValueOrigin{3, 6},
		"copying and reusing the same guest slot do not merge two value definitions");
	require(std::get<NativeTableAccess>(instructions[1].operation).resultTag == ValueTag::Float
		&& std::get<NativeTableAccess>(instructions[3].operation).resultTag == ValueTag::Integer,
		"the optimizer proves each field result at its own producing instruction");
	const auto& plan = std::get<NativeNumericPlan>(std::get<NativeArithmetic>(instructions[4].operation).strategy);
	require(plan.action == NativeNumericAction::Float && !plan.guardLeft && !plan.guardRight,
		"the sum uses both field proofs, including the one forwarded by MOV");
}

void capturedOperandsShareOnlyLocalProofs() {
	constexpr u32 pc = 0x5600;
	DecodedInstruction copy{.a = 1, .b = 0, .op = static_cast<u8>(OpCode::MOV), .width = 1, .baseCycles = 1};
	DecodedInstruction replace{.op = static_cast<u8>(OpCode::LOADK), .width = 1, .baseCycles = 1};
	DecodedInstruction sum{.a = 2, .b = 0, .c = 1, .op = static_cast<u8>(OpCode::ADD), .width = 2, .baseCycles = 2};
	DecodedInstruction use{.a = 3, .b = 1, .c = 2, .op = static_cast<u8>(OpCode::ADD), .width = 1, .baseCycles = 2};
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		sum.observeNativeNumericTypes(valueInteger(1), valueInteger(1));

	const std::array dependent{NativeBlockInstruction{&copy, pc}, NativeBlockInstruction{&sum, pc + 4},
		NativeBlockInstruction{&use, pc + 12}};
	const std::array local{NativeBlockSource{dependent}};
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(local, uses);
	const auto rows = region.blocks().front().instructions;
	const auto& checked = std::get<NativeNumericPlan>(std::get<NativeArithmetic>(rows[1].operation).strategy);
	const auto& proved = std::get<NativeNumericPlan>(std::get<NativeArithmetic>(rows[2].operation).strategy);
	require(checked.action == NativeNumericAction::Word && checked.guardLeft && !checked.guardRight && rows[1].replay,
		"copied inputs use a single guard and retain one exact replay site");
	require(proved.action == NativeNumericAction::Word && !proved.guardLeft && !proved.guardRight && !rows[2].replay,
		"the successful guard proves a later use of the copied value, not merely the checked register");

	const std::array overwritten{dependent[0], NativeBlockInstruction{&replace, pc + 4}, NativeBlockInstruction{&sum, pc + 8}};
	const std::array reassigned{NativeBlockSource{overwritten}};
	NativeIrRegion redefined;
	redefined.build(reassigned, uses);
	const auto& separate = std::get<NativeNumericPlan>(
		std::get<NativeArithmetic>(redefined.blocks().front().instructions.back().operation).strategy);
	require(separate.guardLeft && separate.guardRight, "a load into the old source slot creates a different value");

	const std::span chain(dependent);
	const std::array entries{NativeBlockSource{chain.first(1)}, NativeBlockSource{chain.subspan(1)}};
	NativeIrRegion independent;
	independent.build(entries, uses);
	const auto& admitted = std::get<NativeNumericPlan>(
		std::get<NativeArithmetic>(independent.blocks()[1].instructions.front().operation).strategy);
	require(admitted.guardLeft && admitted.guardRight,
		"a public entry cannot assume its incoming slots were copied by the preceding source run");
}

void rangeWritesAndMethodCopiesDefineValues() {
	std::array instructions{
		NativeInstruction(NativeTableAccess{2, 1, 0, NativeTableMode::ReadMethod, NativeTableKey::Field, {}}),
		NativeInstruction(NativeArithmetic{4, 1, 3, OpCode::ADD, NativeArithmeticHint{}}),
		NativeInstruction(NativeVararg{{3, -1}}),
		NativeInstruction(NativeArithmetic{4, 1, 3, OpCode::ADD, NativeArithmeticHint{}}),
		NativeInstruction(NativeMove{5, -1, ValueMoveKind::Copy}),
		NativeInstruction(NativeArithmetic{4, 5, -1, OpCode::ADD, NativeArithmeticHint{}}),
	};
	NativeSlotValues values;
	values.beginRegion(instructions);
	values.beginScope();
	values.advance(instructions[0], 0);
	const auto method = values.advance(instructions[1], 1);
	require(method.inputs[0] == method.inputs[1], "SELF binds A+1 to the captured receiver");
	values.advance(instructions[2], 2);
	const auto open = values.advance(instructions[3], 3);
	require(open.inputs[0] == method.inputs[0] && open.inputs[1] != method.inputs[1]
		&& values.origin(open.inputs[1]).producer == NativeValueOrigin::Opaque,
		"open results end earlier proofs inside their possible write range, not below it");
	const auto captured = values.advance(instructions[4], 4);
	const auto live = values.advance(instructions[5], 5);
	require(live.inputs[0] == captured.inputs[0] && live.inputs[1] != captured.inputs[0],
		"a copied RK value does not alias a later access to the live RAM-backed constant bank");
}

void nestedFieldsShareOnlyTheCheckedAddress() {
	constexpr u32 pc = 0x5300u;
	std::array decoded{
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(7), .a = 1, .b = 0, .c = 0, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(1), .a = 3, .b = 1, .c = 1, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.a = 4, .b = 0, .op = static_cast<u8>(OpCode::MOV)},
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(7), .a = 2, .b = 4, .c = 0, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(2), .a = 5, .b = 2, .c = 2, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.a = 6, .b = 3, .c = 5, .op = static_cast<u8>(OpCode::ADD)},
	};
	std::array<NativeBlockInstruction, decoded.size()> source;
	for (size_t row = 0; row < decoded.size(); ++row) {
		decoded[row].width = row == 3 ? 2 : 1;
		decoded[row].baseCycles = BASE_CYCLES[decoded[row].op];
		source[row] = {&decoded[row], pc + static_cast<u32>(row + (row > 3)) * INSTRUCTION_BYTES};
	}
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		decoded.back().observeNativeNumericTypes(valueFloat(1.5f), valueInteger(2));
	const std::array runs{NativeBlockSource{source}};
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(runs, uses);
	require(region.blocks().size() == 1, "a repeated own-field path stays in one native segment");
	const auto& block = region.blocks().front();
	const auto& first = std::get<NativeTableAccess>(block.instructions[0].operation);
	const auto& second = std::get<NativeTableAccess>(block.instructions[3].operation);
	require(first.ownFieldAddress && first.ownFieldAddress == second.ownFieldAddress
		&& first.readPlan == NativeTableReadPlan::OwnSlot && second.readPlan == NativeTableReadPlan::OwnSlot
		&& first.resultTag == ValueTag::Table && second.resultTag == ValueTag::Table,
		"the two t.a loads share a checked address but keep their own Table result checks");
	const auto& definition = block.ownFieldAddresses[*first.ownFieldAddress];
	require(block.ownFieldAddresses.size() == 3 && definition.definingRow == 0 && definition.receiver == 0
		&& definition.key == 0 && definition.lastUseRow == 3,
		"only the repeated receiver origin and key share a live address definition");
	const auto& b = std::get<NativeTableAccess>(block.instructions[1].operation);
	const auto& c = std::get<NativeTableAccess>(block.instructions[4].operation);
	require(b.receiverCheck == NativeTagCheck::Proved && c.receiverCheck == NativeTagCheck::Proved
		&& b.ownFieldAddress != c.ownFieldAddress && b.resultTag == ValueTag::Float && c.resultTag == ValueTag::Integer,
		"nested receivers use their own Table proofs and independent field addresses");
	const auto& miss = region.sideExits(block)[*block.instructions[3].slow];
	require(block.instructions[0].slow != block.instructions[3].slow && miss.exit == NativeBlockExit::ReadField
		&& miss.currentPc == source[3].pc && miss.lastPc == source[3].pc + INSTRUCTION_BYTES
		&& miss.nextPc == source[4].pc,
		"a reused address does not reuse the first read's semantic miss or WIDE timing");
	std::ostringstream report;
	dumpNativeIr(report, region);
	const auto text = report.str();
	require(text.find("%addr0 = checked-own-field R0, K0") != std::string::npos
		&& text.find("R1 = load-own-field %addr0") != std::string::npos
		&& text.find("R2 = load-own-field %addr0") != std::string::npos
		&& text.find(" own-only miss=e") != std::string::npos,
		"the diagnostic exposes the checked address, both consumers and the selected own-only path");

	const std::array rejected{NativeRejectedFieldProof{source[0].pc, ValueTag::Table}};
	NativeIrRegion adapted;
	adapted.build(runs, uses, false, {}, {.rejectedFieldProofs = rejected});
	const auto& adaptedBlock = adapted.blocks().front();
	const auto& adaptedFirst = std::get<NativeTableAccess>(adaptedBlock.instructions[0].operation);
	const auto& adaptedSecond = std::get<NativeTableAccess>(adaptedBlock.instructions[3].operation);
	require(adaptedFirst.ownFieldAddress == adaptedSecond.ownFieldAddress && !adaptedFirst.resultTag
		&& adaptedSecond.resultTag == ValueTag::Table,
		"field rejection removes only the contradictory proof; both sites still reuse the same checked address");
	const auto& adaptedMiss = adapted.sideExits(adaptedBlock)[*adaptedBlock.instructions[0].slow];
	require(adaptedMiss.exit == NativeBlockExit::ReadField && !adaptedMiss.operands.table.resultProof
		&& adaptedMiss.currentPc == source[0].pc,
		"the original semantic owner's recipe no longer carries the rejected result tag");
}

void fieldAddressRangesSurviveWorkspaceGrowth() {
	constexpr u32 pc = 0x5700u;
	constexpr auto getField = static_cast<u8>(OpCode::GETFIELD);
	std::array<DecodedInstruction, 24> decoded;
	std::array<NativeBlockInstruction, decoded.size()> rows;
	std::array<NativeBlockSource, decoded.size()> sources;
	for (u16 index = 0; index < decoded.size(); ++index) {
		decoded[index] = DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(index), .a = 1, .b = 0,
			.c = static_cast<i16>(index), .op = getField, .width = 1, .baseCycles = BASE_CYCLES[getField]};
		rows[index] = {&decoded[index], pc + index * INSTRUCTION_BYTES};
		sources[index] = {std::span(rows).subspan(index, 1)};
	}
	NativeRegisterUses uses;
	NativeIrRegion region;
	for (const auto count : {1u, 24u, 2u}) {
		region.build(std::span(sources).first(count), uses);
		require(region.blocks().size() == count, "each source retains its own field address range");
		for (u16 index = 0; index < count; ++index) {
			const auto& block = region.blocks()[index];
			require(block.ownFieldAddresses.size() == 1 && block.ownFieldAddresses[0].key == index,
				"earlier blocks keep their address definitions after scratch growth");
		}
	}
}

void fieldAddressesStopAtDefinitionsAndEffects() {
	enum class Boundary { Copy, EmptyVararg, FixedVararg, Redefinition, UncheckedField, Store, Upvalue, Global, Call, FieldKey, Prediction };
	for (const auto boundary : {Boundary::Copy, Boundary::Redefinition, Boundary::Store, Boundary::Upvalue,
		Boundary::Global, Boundary::Call, Boundary::UncheckedField, Boundary::FieldKey, Boundary::Prediction,
		Boundary::EmptyVararg, Boundary::FixedVararg}) {
		std::array decoded{
			DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(4), .a = 1, .op = static_cast<u8>(OpCode::GETFIELD)},
			DecodedInstruction{.a = 4, .op = static_cast<u8>(OpCode::MOV)},
			DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(4), .a = 2, .b = 4, .op = static_cast<u8>(OpCode::GETFIELD)},
		};
		auto& between = decoded[1];
		auto& after = decoded[2];
		switch (boundary) {
			case Boundary::Copy: break;
			case Boundary::EmptyVararg: case Boundary::FixedVararg:
				between.op = static_cast<u8>(OpCode::VARARG);
				between.b = boundary == Boundary::EmptyVararg ? 1 : 2;
				after.b = 0;
				break;
			case Boundary::Redefinition: between.b = 3; break;
			case Boundary::UncheckedField:
				between.op = static_cast<u8>(OpCode::GETFIELD);
				between.tableCacheSlot() = -1;
				after.b = 0;
				break;
			case Boundary::Store: between.op = static_cast<u8>(OpCode::SETI); after.b = 0; break;
			case Boundary::Upvalue: between.op = static_cast<u8>(OpCode::SETUP); after.b = 0; break;
			case Boundary::Global: between.op = static_cast<u8>(OpCode::SETGL); after.b = 0; break;
			case Boundary::Call: between.op = static_cast<u8>(OpCode::CALL); after.b = 0; break;
			case Boundary::FieldKey: after.c = 1; break;
			case Boundary::Prediction: after.tableCacheSlot() = 5; break;
		}
		std::array<NativeBlockInstruction, decoded.size()> source;
		for (size_t row = 0; row < decoded.size(); ++row) {
			decoded[row].width = 1;
			decoded[row].baseCycles = BASE_CYCLES[decoded[row].op];
			source[row] = {&decoded[row], 0x5400u + static_cast<u32>(row) * INSTRUCTION_BYTES};
		}
		const std::span instructions(source);
		const std::array runs{NativeBlockSource{boundary == Boundary::Call ? instructions.first(2) : instructions},
			NativeBlockSource{instructions.last(1)}};
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(std::span(runs).first(boundary == Boundary::Call ? 2 : 1), uses);
		const auto& firstBlock = region.blocks().front();
		const auto& lastBlock = region.blocks().back();
		const auto& first = std::get<NativeTableAccess>(firstBlock.instructions.front().operation);
		const auto& last = std::get<NativeTableAccess>(lastBlock.instructions.back().operation);
		require(first.ownFieldAddress && last.ownFieldAddress, "each fixed-field read has a checked address operand");
		const auto& definition = firstBlock.ownFieldAddresses[*first.ownFieldAddress];
		if (boundary == Boundary::Copy || boundary == Boundary::EmptyVararg) {
			require(&firstBlock == &lastBlock && first.ownFieldAddress == last.ownFieldAddress
				&& definition.lastUseRow == 2 && first.readPlan == NativeTableReadPlan::OwnSlot
				&& last.readPlan == NativeTableReadPlan::OwnSlot && !first.resultTag && !last.resultTag,
				"repeated untyped loads share the checked address across operations without conflicting effects");
		} else {
			require(!definition.lastUseRow && first.readPlan == NativeTableReadPlan::ProbeOwnOrOneHop
				&& last.readPlan == NativeTableReadPlan::ProbeOwnOrOneHop,
				"different receivers, keys, seeds or intervening effects do not retain checked addresses");
			if (boundary == Boundary::UncheckedField) {
				const auto& peer = std::get<NativeTableAccess>(region.blocks()[1].instructions.front().operation);
				require(peer.reusePeerWord && peer.readPlan == NativeTableReadPlan::OneHopIndex,
					"an own-slot miss that can reproject a peer still goes to its semantic owner");
			}
		}
	}
}

void fieldAddressRetentionIsBoundedByLifetime() {
	constexpr size_t keyCount = 1 + NATIVE_OWN_FIELD_TEMPORARIES;
	std::array<DecodedInstruction, 2 + 2 * keyCount> decoded;
	std::array<NativeBlockInstruction, decoded.size()> source;
	// The source-row and block-row numbering differ after the checkpoint;
	// the block's address lifetime must not include that earlier segment.
	decoded[0] = {.a = 12, .b = 13, .op = static_cast<u8>(OpCode::LEN)};
	decoded[1] = {.a = 14, .op = static_cast<u8>(OpCode::K1)};
	for (size_t row = 2; row < decoded.size(); ++row) {
		const auto key = static_cast<u16>((row - 2) % keyCount);
		decoded[row] = {.payload = DecodedInstruction::Payload::tableSlot(key), .a = static_cast<u16>(row + 1), .c = static_cast<i16>(key),
			.op = static_cast<u8>(OpCode::GETFIELD)};
	}
	for (size_t row = 0; row < decoded.size(); ++row) {
		decoded[row].width = 1;
		decoded[row].baseCycles = BASE_CYCLES[decoded[row].op];
		source[row] = {&decoded[row], 0x5500u + static_cast<u32>(row) * INSTRUCTION_BYTES};
	}
	const std::array runs{NativeBlockSource{source}};
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(runs, uses);
	require(region.blocks().size() == 2, "LEN keeps its own checkpoint");
	const auto& block = region.blocks().back();
	require(block.ownFieldAddresses.size() == keyCount + 1,
		"retention avoids exceeding the overlap budget");
	for (size_t key = 0; key < keyCount; ++key) {
		const size_t firstRow = key + 1, lastRow = keyCount + firstRow;
		const auto& first = std::get<NativeTableAccess>(block.instructions[firstRow].operation);
		const auto& repeated = std::get<NativeTableAccess>(block.instructions[lastRow].operation);
		const auto& definition = block.ownFieldAddresses[*first.ownFieldAddress];
		if (key < NATIVE_OWN_FIELD_TEMPORARIES)
			require(first.ownFieldAddress == repeated.ownFieldAddress && definition.lastUseRow == lastRow,
				"the definition remains live through its final use in this block");
		else
			require(first.ownFieldAddress != repeated.ownFieldAddress && !definition.lastUseRow,
				"the excess use computes its checked address anew");
	}
}

void feedbackDoesNotDependOnStoreAdjacency() {
	DecodedInstruction sum{.a = 3, .b = 1, .c = 2, .op = static_cast<u8>(OpCode::ADD)};
	DecodedInstruction store{.payload = DecodedInstruction::Payload::tableSlot(-1), .c = 3, .op = static_cast<u8>(OpCode::SETFIELD)};
	for (auto* instruction : {&sum, &store}) {
		instruction->width = 1;
		instruction->baseCycles = BASE_CYCLES[instruction->op];
	}
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		sum.observeNativeNumericTypes(valueInteger(2), valueFloat(1.5f));
	const std::array source{NativeBlockInstruction{&sum, 0x5300u}, NativeBlockInstruction{&store, 0x5304u}};
	for (const size_t count : {1, 2}) {
		const std::array runs{NativeBlockSource{std::span(source).first(count)}};
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(runs, uses);
		const auto& operation = std::get<NativeArithmetic>(region.blocks().front().instructions.front().operation);
		const auto& plan = std::get<NativeNumericPlan>(operation.strategy);
		require(plan.action == NativeNumericAction::Float && plan.left == ValueTag::Integer && plan.right == ValueTag::Float
			&& plan.result == ValueTag::Float && plan.guardLeft && plan.guardRight,
			"the same arithmetic feedback gives the same guards with or without a following SETFIELD");
	}
}

void decodedFieldsBecomeOperationsAndEffects() {
	DecodedInstruction memory, call, rk;
	memory.op = static_cast<u8>(OpCode::STORE_MEM_WORDS_D);
	memory.a = 20; memory.b = 6; memory.c = 3; memory.setBx(7);
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
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(source, uses);
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
	std::ostringstream report;
	dumpNativeIr(report, region);
	const auto text = report.str();
	require(text.find("memory R6 reads=R20..R22 store-words") != std::string::npos
		&& text.find("R4..top = call R4 reads=R5..R6") != std::string::npos,
		"the dump preserves counted source and open destination operands");
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
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(sources, uses);
	const auto& row = region.blocks()[0].instructions[0];
	const auto exits = region.sideExits(region.blocks().front());
	require(std::holds_alternative<NativeReplay>(row.operation) && row.replay && exits.size() == 1
		&& exits[*row.replay].exit == NativeBlockExit::ScalarBoundary && exits[*row.replay].nextPc == 0x4100
		&& exits[*row.replay].cycles == 0 && !exits[*row.replay].operands.replay.hasCompletedInstruction,
		"an unhandled move replays from its start without committing the numeric transfer");
}

void successorsImportLogicalTypesBeforeLowering() {
	constexpr u32 producerPc = 0x4000, consumerPc = 0x4200;
	DecodedInstruction load, jump, arithmetic;
	load.op = static_cast<u8>(OpCode::K1); load.a = 7; load.width = load.baseCycles = 1;
	jump.op = static_cast<u8>(OpCode::JMP); jump.setBx(consumerPc); jump.width = jump.baseCycles = 1;
	arithmetic.op = static_cast<u8>(OpCode::ADD); arithmetic.a = 1; arithmetic.b = arithmetic.c = 7;
	arithmetic.width = 1; arithmetic.baseCycles = BASE_CYCLES[arithmetic.op];
	const std::array before{NativeBlockInstruction{&load, producerPc}, NativeBlockInstruction{&jump, producerPc + 4}};
	const std::array after{NativeBlockInstruction{&arithmetic, consumerPc}};
	const std::array sources{NativeBlockSource{before}, NativeBlockSource{after}};
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(sources, uses);
	const auto& entry = region.blocks()[1];
	require(entry.entryTypes.size() == 1 && entry.entryTypes[0].slot == 7 && entry.entryTypes[0].tag == ValueTag::Integer,
		"the successor has an explicit Integer entry proof independently of host allocation");
	const auto& plan = std::get<NativeNumericPlan>(std::get<NativeArithmetic>(entry.instructions[0].operation).strategy);
	require(plan.action == NativeNumericAction::Word && !plan.guardLeft && !plan.guardRight
		&& region.sideExits(entry).empty() && !region.blocks()[0].edgeReplay[0],
		"the sum consumes its block's admission proof without a redundant semantic or replay exit");
}

void admissionReplaysPreserveTheExactFusedPredecessor() {
	constexpr u32 pc = 0x4000, successorPc = pc + 12;
	DecodedInstruction compare{}, jump{}, prefix{}, tail{};
	compare.op = static_cast<u8>(OpCode::EQ); compare.width = 1;
	jump.op = static_cast<u8>(OpCode::JMP); jump.width = 2; jump.setBx(successorPc);
	prefix.op = static_cast<u8>(OpCode::K1); prefix.width = 1;
	tail.op = static_cast<u8>(OpCode::HALT); tail.width = 1;
	for (auto* inst : {&compare, &jump, &prefix, &tail}) inst->baseCycles = BASE_CYCLES[inst->op];
	const std::array before{NativeBlockInstruction{&compare, pc}};
	const std::array after{NativeBlockInstruction{&prefix, successorPc},
		NativeBlockInstruction{&tail, successorPc + 4}};
	const std::array sources{NativeBlockSource{before, &jump}, NativeBlockSource{after}};
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(sources, uses);
	const auto& source = region.blocks()[0];
	const auto& target = region.blocks()[1];
	const auto replays = region.admissionReplays();
	require(target.admissionCycles == prefix.baseCycles && source.successors == std::array<size_t, 2>{1, 1}
		&& source.edgeReplay[0] && source.edgeReplay[1] && source.edgeReplay[0] != source.edgeReplay[1],
		"two fused outcomes leading to the same admission preserve different completed instructions");
	for (const auto id : {target.entryReplay, *source.edgeReplay[0], *source.edgeReplay[1]}) {
		const auto& replay = replays[id];
		require(replay.exit == NativeBlockExit::ScalarBoundary && replay.nextPc == successorPc
			&& replay.cycles == 0 && replay.registerTop == 0 && !replay.operands.replay.arithmetic,
			"admission never charges the denied target or republishes the predecessor's top floor");
	}
	const auto& withJump = replays[*source.edgeReplay[0]];
	const auto& withoutJump = replays[*source.edgeReplay[1]];
	require(!replays[target.entryReplay].operands.replay.hasCompletedInstruction
		&& withJump.operands.replay.hasCompletedInstruction && withJump.currentPc == pc + 4 && withJump.lastPc == pc + 8
		&& withoutJump.operands.replay.hasCompletedInstruction && withoutJump.currentPc == pc && withoutJump.lastPc == pc,
		"public, fused-jump and skipped-jump admission each identify the actual completed guest prefix");
	std::ostringstream report;
	dumpNativeIr(report, region);
	const auto text = report.str();
	require(text.find(" taken=e" + std::to_string(*source.taken)) != std::string::npos
		&& text.find(" fused-jump-pc=" + std::to_string(pc + INSTRUCTION_BYTES) + " jump-target=" + std::to_string(successorPc)
			+ " jump-cycles=" + std::to_string(jump.baseCycles) + " before-jump=e" + std::to_string(*source.beforeFusedJump)) != std::string::npos,
		"the dump names the planned jump fusion, skip and short-grant exit");
	jump.dispatchOp = static_cast<u8>(DecodedDispatchOp::Observe);
	NativeIrRegion notFused;
	notFused.build(sources, uses);
	std::ostringstream observed;
	dumpNativeIr(observed, notFused);
	require(observed.str().find("fused-jump-pc=") == std::string::npos,
		"a compare with a separately observed following jump does not advertise fusion");
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
	decoded[2].setBx(copyPc);
	decoded[3].a = 10;
	decoded[3].b = 7;
	decoded[4].a = 8;
	decoded[5].setBx(consumerPc);
	decoded[6].a = 1;
	decoded[6].b = decoded[6].c = 10;
	const std::array producer{NativeBlockInstruction{&decoded[0], firstPc},
		NativeBlockInstruction{&decoded[1], firstPc + 4}, NativeBlockInstruction{&decoded[2], firstPc + 8}};
	const std::array copy{NativeBlockInstruction{&decoded[3], copyPc},
		NativeBlockInstruction{&decoded[4], copyPc + 4}, NativeBlockInstruction{&decoded[5], copyPc + 8}};
	const std::array consumer{NativeBlockInstruction{&decoded[6], consumerPc}};
	const std::array sources{NativeBlockSource{producer}, NativeBlockSource{copy}, NativeBlockSource{consumer}};
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(sources, uses);
	const auto blocks = region.blocks();
	for (size_t target : {1u, 2u})
		require(blocks[target - 1].provesEntryTo(target) && blocks[target].entryTypes.size() == 1,
			"only the consumed proof reaches each block's entry contract");
	require(blocks[1].entryTypes[0].slot == 7 && blocks[2].entryTypes[0].slot == 10
		&& blocks[2].entryTypes[0].tag == ValueTag::Integer,
		"the proof follows the copied value, not the separately read global-store operand");
}

void forwardJoinMeetsTagsNotValues() {
	constexpr u32 leftPc = 0x4000, rightPc = 0x4100, joinPc = 0x4200;
	for (const bool matching : {true, false}) {
		std::array decoded{
			DecodedInstruction{.a = 7, .op = static_cast<u8>(OpCode::K1)},
			DecodedInstruction{.op = static_cast<u8>(OpCode::JMP)},
			DecodedInstruction{.a = 7, .op = static_cast<u8>(matching ? OpCode::KSMI : OpCode::KFALSE)},
			DecodedInstruction{.op = static_cast<u8>(OpCode::JMP)},
			DecodedInstruction{.a = 2, .b = 7, .c = 7, .op = static_cast<u8>(OpCode::ADD)},
		};
		for (auto& op : decoded) { op.width = 1; op.baseCycles = BASE_CYCLES[op.op]; }
		decoded[1].setBx(joinPc);
		decoded[2].setSbx(3);
		decoded[3].setBx(joinPc);
		const std::array left{NativeBlockInstruction{&decoded[0], leftPc}, NativeBlockInstruction{&decoded[1], leftPc + 4}};
		const std::array right{NativeBlockInstruction{&decoded[2], rightPc}, NativeBlockInstruction{&decoded[3], rightPc + 4}};
		const std::array join{NativeBlockInstruction{&decoded[4], joinPc}};
		const std::array sources{NativeBlockSource{left}, NativeBlockSource{right}, NativeBlockSource{join}};
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(sources, uses);
		const auto blocks = region.blocks();
		const auto& entry = blocks[2];
		const auto& plan = std::get<NativeNumericPlan>(std::get<NativeArithmetic>(entry.instructions[0].operation).strategy);
		if (matching) {
			require(entry.entryTypes.size() == 1 && entry.entryTypes[0].slot == 7
				&& entry.entryTypes[0].tag == ValueTag::Integer && blocks[0].provesEntryTo(2) && blocks[1].provesEntryTo(2),
				"both forward edges discharge the same public tag contract after distinct definitions");
			require(plan.action == NativeNumericAction::Word && region.sideExits(entry).empty(),
				"the joined arithmetic consumes the proof without a per-operation guard");
		} else require(entry.entryTypes.empty() && plan.action == NativeNumericAction::Kernel,
			"one conflicting forward edge prevents importing that slot's tag");
	}
}

void nativeTableGuardProvesTheFollowingReceiver() {
	constexpr u32 pc = 0x6000;
	std::array decoded{
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(-1), .a = 1, .b = 0,
			.op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(-1), .a = 2, .b = 0, .c = 1,
			.op = static_cast<u8>(OpCode::GETFIELD)},
	};
	for (auto& row : decoded) { row.width = 1; row.baseCycles = BASE_CYCLES[row.op]; }
	const std::array source{NativeBlockInstruction{&decoded[0], pc}, NativeBlockInstruction{&decoded[1], pc + INSTRUCTION_BYTES}};
	const std::array sources{NativeBlockSource{source}};
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(sources, uses);
	const auto blocks = region.blocks();
	const auto& first = std::get<NativeTableAccess>(blocks[0].instructions[0].operation);
	const auto& second = std::get<NativeTableAccess>(blocks[1].instructions[0].operation);
	require(first.receiverCheck == NativeTagCheck::Dynamic && second.receiverCheck == NativeTagCheck::Proved
		&& blocks[0].provesEntryTo(1) && blocks[1].entryTypes.size() == 1
		&& blocks[1].entryTypes[0].slot == 0 && blocks[1].entryTypes[0].tag == ValueTag::Table,
		"the direct edge carries a successful receiver guard, whereas semantic and public entry must admit it");
}

void tableIndexProofsFollowTheKeyAcrossEntries() {
	constexpr u32 firstPc = 0x6100, joinPc = 0x6120;
	struct Case {
		OpCode definition;
		NativeTableIndexType index;
		NativeHashStore store;
		std::optional<ValueTag> tag;
	};
	const std::array cases{
		Case{OpCode::K1, NativeTableIndexType::Integer, NativeHashStore::Integer, ValueTag::Integer},
		Case{OpCode::LOADK, NativeTableIndexType::String, NativeHashStore::String, ValueTag::String},
		Case{OpCode::GETI, NativeTableIndexType::Table, NativeHashStore::Identity, ValueTag::Table},
		Case{OpCode::MOV, NativeTableIndexType::Dynamic, NativeHashStore::Index, {}},
	};
	const std::array constants{NativeImageConstant{0, valueString(12)}};
	for (const auto& item : cases) {
		std::array decoded{
			DecodedInstruction{.a = 1, .op = static_cast<u8>(item.definition)},
			DecodedInstruction{.op = static_cast<u8>(OpCode::JMP)},
			DecodedInstruction{.a = 4, .b = 1, .op = static_cast<u8>(OpCode::MOV)},
			DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(-1), .a = 0, .b = 4, .c = 2,
				.op = static_cast<u8>(OpCode::SETT)},
			DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(-1), .a = 3, .b = 0, .c = 4,
				.op = static_cast<u8>(OpCode::GETT)},
		};
		if (item.definition == OpCode::LOADK) decoded[0].setBx(0);
		if (item.definition == OpCode::GETI) {
			decoded[0].a = 5;
			decoded[0].b = decoded[0].c = 1;
		}
		for (auto& row : decoded) { row.width = 1; row.baseCycles = BASE_CYCLES[row.op]; }
		decoded[1].setBx(joinPc);
		const std::array first{NativeBlockInstruction{&decoded[0], firstPc}, NativeBlockInstruction{&decoded[1], firstPc + 4}};
		const std::array join{NativeBlockInstruction{&decoded[2], joinPc}, NativeBlockInstruction{&decoded[3], joinPc + 4},
			NativeBlockInstruction{&decoded[4], joinPc + 8}};
		const std::array sources{NativeBlockSource{first}, NativeBlockSource{join}};
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(sources, uses, true, {}, {.imageConstants = constants});
		int accesses = 0;
		for (const auto& block : region.blocks()) {
			if (block.firstPc == joinPc) {
				require(block.entryTypes.size() == static_cast<size_t>(item.tag.has_value())
					&& (!item.tag || (block.entryTypes[0].slot == 1 && block.entryTypes[0].tag == *item.tag)),
					"imported index proofs guard the source of the copied key at a public entry");
			}
			for (const auto& row : block.instructions) {
				if (row.pc != joinPc + 4 && row.pc != joinPc + 8) continue;
				const auto& op = std::get<NativeTableAccess>(row.operation);
				const bool write = row.pc == joinPc + 4;
				require(op.keyKind == NativeTableKey::Value && op.key == 4 && op.indexType == item.index
					&& (!write || op.store.hash == item.store),
					"both dynamic-key operations select the proved type without changing the key selector");
				const auto& exit = region.sideExits(block)[*row.slow];
				require(exit.exit == (write ? NativeBlockExit::WriteIndex : NativeBlockExit::ReadIndex)
					&& exit.operands.table.key == 4 && exit.currentPc == row.pc,
					"a specialized index still uses the original semantic continuation");
				++accesses;
			}
		}
		require(accesses == 2, "both table operations are present in the region");
	}
}

void dataflowPlansTableAndMemoryInputs() {
	constexpr u32 pc = 0x5300;
	std::array<DecodedInstruction, 7> decoded{};
	std::array<NativeBlockInstruction, 7> source;
	const std::array opcodes{OpCode::LOADK, OpCode::KFALSE, OpCode::K1, OpCode::LOADK, OpCode::JMP, OpCode::SETFIELD, OpCode::STORE_MEM};
	for (size_t index = 0; index < decoded.size(); ++index) {
		auto& instruction = decoded[index];
		instruction.op = static_cast<u8>(opcodes[index]);
		instruction.width = 1;
		instruction.baseCycles = BASE_CYCLES[instruction.op];
		source[index] = {&instruction, pc + static_cast<u32>(index) * INSTRUCTION_BYTES};
	}
	decoded[0].a = 7;
	decoded[1].a = 8;
	decoded[2].a = 9;
	decoded[3].a = 10;
	decoded[3].setBx(1);
	decoded[4].setBx(source[5].pc);
	decoded[5].a = 7;
	decoded[5].b = 2;
	decoded[5].c = 8;
	decoded[6].a = 10;
	decoded[6].b = 9;
	decoded[6].c = static_cast<i16>(MemoryAccessKind::F32LE);
	const std::span instructions(source);
	const std::array runs{NativeBlockSource{instructions.first(5)}, NativeBlockSource{instructions.last(2)}};
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(runs, uses);
	const auto blocks = region.blocks();
	const auto& table = std::get<NativeTableAccess>(blocks[1].instructions.front().operation);
	const auto& memory = std::get<NativeMemoryAccess>(blocks[2].instructions.front().operation);
	const auto& receiver = std::get<NativeConstantLoad>(blocks[0].instructions.front().operation);
	require(receiver.index == 0 && receiver.result == 7
		&& table.receiverCheck == NativeTagCheck::Dynamic && table.store.barrier == NativeGcBarrier::None
		&& table.store.nilValue == NativeNilValue::Present,
		"the table plan distinguishes a live constant bank load from an immediate with a proved tag");
	require(memory.addressCheck == NativeTagCheck::Proved && memory.store == NativeWordSource::Dynamic,
		"the memory plan receives the immediate address proof but no tag proof for the live constant value");
	std::ostringstream report;
	dumpNativeIr(report, region);
	const auto text = report.str();
	require(text.find("table-write R7 R8 K2 receiver=guard barrier=none value=present") != std::string::npos
		&& text.find("address=proved") != std::string::npos && text.find("source-word=dynamic") != std::string::npos
		&& text.find("terminal kind=") != std::string::npos,
		"the dump exposes store, address, value and continuation choices directly");
}

void rejectedReceiverDoesNotAdvertiseAFieldDatapath() {
	std::array decoded{
		DecodedInstruction{.op = static_cast<u8>(OpCode::KFALSE)},
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(1), .a = 1, .op = static_cast<u8>(OpCode::GETFIELD)},
	};
	for (auto& row : decoded) { row.width = 1; row.baseCycles = BASE_CYCLES[row.op]; }
	const std::array source{NativeBlockInstruction{&decoded[0], 0x5400}, NativeBlockInstruction{&decoded[1], 0x5404}};
	NativeRegisterUses uses;
	const std::array runs{NativeBlockSource{source}};
	NativeIrRegion region;
	region.build(runs, uses);
	std::ostringstream report;
	dumpNativeIr(report, region);
	const auto text = report.str();
	require(text.find("table-semantic R0 K0 receiver=rejected miss=e") != std::string::npos
		&& text.find("checked-own-field") == std::string::npos,
		"an operation that always leaves has no emitted checked address");
}

void dumpDistinguishesFoldedEdgesFromPublicEntries() {
	constexpr u32 pc = 0x5500, branchPc = pc + 8, fallthrough = branchPc + 8, taken = pc + 32;
	std::array decoded{
		DecodedInstruction{.a = 7},
		DecodedInstruction{.op = static_cast<u8>(OpCode::JMP)},
		DecodedInstruction{.a = 7, .op = static_cast<u8>(OpCode::JMPIF)},
		DecodedInstruction{.op = static_cast<u8>(OpCode::K1)},
		DecodedInstruction{.op = static_cast<u8>(OpCode::HALT)},
	};
	for (auto& row : decoded) { row.width = 1; row.baseCycles = BASE_CYCLES[row.op]; }
	decoded[1].setBx(branchPc);
	decoded[2].setBx(taken);
	decoded[2].width = 2;
	const std::array entry{NativeBlockInstruction{&decoded[0], pc}, NativeBlockInstruction{&decoded[1], pc + 4}};
	const std::array condition{NativeBlockInstruction{&decoded[2], branchPc}};
	const std::array left{NativeBlockInstruction{&decoded[3], fallthrough}, NativeBlockInstruction{&decoded[4], fallthrough + 4}};
	const std::array right{NativeBlockInstruction{&decoded[3], taken}, NativeBlockInstruction{&decoded[4], taken + 4}};
	const std::array sources{NativeBlockSource{entry}, NativeBlockSource{condition}, NativeBlockSource{left}, NativeBlockSource{right}};
	for (const bool truthy : {false, true}) {
		decoded[0].op = static_cast<u8>(truthy ? OpCode::KTRUE : OpCode::KFALSE);
		decoded[0].baseCycles = BASE_CYCLES[decoded[0].op];
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(sources, uses);
		const auto blocks = region.blocks();
		const auto& branch = blocks[1];
		const size_t chosen = truthy ? 3 : 2, discarded = truthy ? 2 : 3;
		const auto& jump = std::get<NativeJump>(branch.instructions.front().operation);
		const u32 destination = truthy ? taken : fallthrough;
		const auto replays = region.admissionReplays();
		require(jump.target == destination && branch.terminal.nextPc == destination
			&& branch.successors == std::array<size_t, 2>{chosen, blocks.size()}
			&& !branch.taken && region.sideExits(branch).empty(),
			"the proven WIDE branch has exactly the selected destination and no conditional exit");
		require(branch.entryTypes.size() == 1 && branch.entryTypes[0].slot == 7
			&& branch.entryTypes[0].tag == (truthy ? ValueTag::True : ValueTag::False) && blocks[0].provesEntryTo(1),
			"an independently entered branch still checks the proof that selected its jump");
		require(branch.edgeReplay[0] && !branch.edgeReplay[1] && replays.size() == blocks.size() + 1,
			"only the selected successor has a linked admission replay");
		const auto& replay = replays[*branch.edgeReplay[0]];
		require(replay.nextPc == destination && replay.currentPc == branchPc && replay.lastPc == branchPc + 4
			&& replay.operands.replay.hasCompletedInstruction && replay.cycles == 0
			&& branch.terminal.cycles == decoded[2].baseCycles,
			"the surviving replay keeps the already charged WIDE branch as its exact prefix");
		std::ostringstream report;
		dumpNativeIr(report, region);
		const auto text = report.str();
		require(text.find("edge b" + std::to_string(chosen) + " replay=r") != std::string::npos
			&& text.find("edge b" + std::to_string(discarded)) == std::string::npos
			&& text.find("block b" + std::to_string(discarded) + " pc=") != std::string::npos,
			"folding removes the dead edge from the plan, not its independent entry");
	}
}

void dumpReportsSelectedBuiltinAndVarargPaths() {
	constexpr u32 pc = 0x5600;
	std::array decoded{
		DecodedInstruction{.a = 7, .b = 1, .op = static_cast<u8>(OpCode::VARARG)},
		DecodedInstruction{.a = 3, .b = 3, .c = 2, .op = static_cast<u8>(OpCode::CALL)},
		DecodedInstruction{.op = static_cast<u8>(OpCode::HALT)},
	};
	for (auto& row : decoded) { row.width = 1; row.baseCycles = BASE_CYCLES[row.op]; }
	const std::array entry{NativeBlockInstruction{&decoded[0], pc}, NativeBlockInstruction{&decoded[1], pc + 4}};
	const std::array after{NativeBlockInstruction{&decoded[2], pc + 8}};
	const std::array sources{NativeBlockSource{entry}, NativeBlockSource{after}};
	NativeRegisterUses uses;
	NativeIrRegion eligible;
	eligible.build(sources, uses, true);
	const auto& block = eligible.blocks().front();
	require(block.instructions.size() == 2 && !block.instructions.front().slow && block.completedCall,
		"a no-result VARARG has no exit and an eligible CALL has a returning builtin arm");
	std::ostringstream eligibleReport;
	dumpNativeIr(eligibleReport, eligible);
	const auto text = eligibleReport.str();
	require(text.find("vararg no-results\n") != std::string::npos
		&& text.find("builtin-tag=guard completed-call=e" + std::to_string(*block.completedCall)) != std::string::npos,
		"the dump reports the empty placement and names the actual returning builtin arm");
	decoded[0].op = static_cast<u8>(OpCode::K1);
	decoded[0].a = decoded[1].a;
	decoded[0].baseCycles = BASE_CYCLES[decoded[0].op];
	NativeIrRegion rejected;
	rejected.build(sources, uses, true);
	const auto& fallback = rejected.blocks().front();
	require(!fallback.completedCall && std::get<NativeCallSite>(fallback.instructions.back().operation).calleeCheck
		== NativeTagCheck::Rejected, "the proved integer callee prevents emitting the builtin arm");
	std::ostringstream rejectedReport;
	dumpNativeIr(rejectedReport, rejected);
	require(rejectedReport.str().find("builtin-tag=") == std::string::npos
		&& rejectedReport.str().find("completed-call=") == std::string::npos,
		"a rejected builtin candidate is not printed as an emitted fast path");
}

void recordPlanUsesTypedEntriesAndFullRomWords() {
	DecodedInstruction allocation{.c = 2, .op = static_cast<u8>(OpCode::NEWT)};
	DecodedInstruction first{.payload = DecodedInstruction::Payload::tableSlot(-1), .c = -1, .op = static_cast<u8>(OpCode::SETFIELD)};
	DecodedInstruction last{.payload = DecodedInstruction::Payload::tableSlot(-1), .b = 1, .c = 70, .op = static_cast<u8>(OpCode::SETFIELD)};
	allocation.width = first.width = 1;
	last.width = 2;
	for (auto* instruction : {&allocation, &first, &last}) instruction->baseCycles = BASE_CYCLES[instruction->op];
	constexpr u32 page = 0x1000;
	for (const u32 start : {page, page + MAPPED_PAGE_BYTE_SIZE - 3 * INSTRUCTION_BYTES}) {
		const std::array head{NativeBlockInstruction{&allocation, start}};
		const std::array fields{NativeBlockInstruction{&first, start + INSTRUCTION_BYTES},
			NativeBlockInstruction{&last, start + 2 * INSTRUCTION_BYTES}};
		// Publish out of address order to exercise the typed entry directory.
		const std::array sources{NativeBlockSource{fields}, NativeBlockSource{head}};
		NativeRegisterUses uses;
		NativeIrRegion writable;
		writable.build(sources, uses, true);
		require(writable.recordPlans().empty(), "writable code never owns a record recipe");
		NativeIrRegion readonly;
		readonly.build(sources, uses, true, {.immutableSource = true});
		const auto& entry = readonly.blocks().back();
		const auto& allocation = std::get<NativeTableAllocation>(entry.instructions.back().operation);
		const auto* recipe = allocation.record ? &readonly.recordPlans()[*allocation.record] : nullptr;
		if (start != page) {
			require(!recipe, "a WIDE body must also belong to the captured immutable page");
			continue;
		}
		require(recipe && recipe->count == 2 && recipe->requiredSlots == 71
			&& recipe->keySelectors[0] == 0 && recipe->keySelectors[1] == 1 && recipe->operands[0] == -1 && recipe->operands[1] == 70
			&& recipe->lastInstructionPc == start + 2 * INSTRUCTION_BYTES && recipe->lastWordPc == start + 3 * INSTRUCTION_BYTES
			&& recipe->nextPc == start + 4 * INSTRUCTION_BYTES && entry.sourceWords == 4,
			"the typed plan preserves operands, guest positions and complete source coverage");
		require(readonly.blocks()[0].firstPc == fields[0].pc && readonly.blocks()[1].firstPc == fields[1].pc,
			"each field retains its ordinary independent entry");
		std::ostringstream report;
		dumpNativeIr(report, readonly);
		require(report.str().find("allocate-record {K0=K0, K1=R70}") != std::string::npos,
			"the fused constructor recipe is visible in the IR beside ordinary field entries");
	}
}

void registerUses() {
	std::array first{NativeInstruction(NativeLiteral{1, valueInteger(0)})};
	std::array left{NativeInstruction(NativeClearSlots{10, 2})};
	std::array right{NativeInstruction(NativeLiteral{11, valueInteger(0)})};
	std::array join{NativeInstruction(NativeArithmetic{8, 10, 12, OpCode::ADD, NativeArithmeticHint{}})};
	std::array blocks{
		NativeIrBlock{first, std::nullopt, {1, 2}}, NativeIrBlock{left, std::nullopt, {3, 3}},
		NativeIrBlock{right, std::nullopt, {3, 4}}, NativeIrBlock{join, std::nullopt, {4, 4}},
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

void knownFaultEndsOnlyTheNativePath() {
	constexpr u32 pc = 0x5800, target = 0x5810, independent = 0x5820;
	std::array decoded{
		DecodedInstruction{.op = static_cast<u8>(OpCode::KFALSE)},
		DecodedInstruction{.op = static_cast<u8>(OpCode::JMP)},
		DecodedInstruction{.a = 1, .op = static_cast<u8>(OpCode::K1)},
		DecodedInstruction{.a = 2, .c = 1, .op = static_cast<u8>(OpCode::ADD)},
		DecodedInstruction{.a = 3, .b = 1, .op = static_cast<u8>(OpCode::LEN)},
		DecodedInstruction{.op = static_cast<u8>(OpCode::HALT)},
	};
	for (auto& row : decoded) { row.width = 1; row.baseCycles = BASE_CYCLES[row.op]; }
	decoded[1].setBx(target);
	decoded[3].width = 2;
	const std::array from{NativeBlockInstruction{&decoded[0], pc}, NativeBlockInstruction{&decoded[1], pc + 4}};
	const std::array body{NativeBlockInstruction{&decoded[2], target}, NativeBlockInstruction{&decoded[3], target + 4},
		NativeBlockInstruction{&decoded[4], target + 12}};
	const std::array publicEntry{NativeBlockInstruction{&decoded[5], independent}};
	const std::array sources{NativeBlockSource{from}, NativeBlockSource{body}, NativeBlockSource{publicEntry}};
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(sources, uses);
	const auto blocks = region.blocks();
	const auto& fault = blocks[1];
	require(blocks.size() == 3 && blocks[0].provesEntryTo(1) && fault.entryTypes.size() == 1
		&& fault.entryTypes[0].slot == 0 && fault.entryTypes[0].tag == ValueTag::False,
		"the fault consumes the incoming tag proof and its separately callable entry still admits it");
	require(fault.instructions.size() == 2 && std::holds_alternative<NativeInvalidOperand>(fault.instructions.back().operation)
		&& region.sideExits(fault).empty() && fault.successors == std::array<size_t, 2>{blocks.size(), blocks.size()}
		&& fault.terminal.exit == NativeBlockExit::InvalidOperand && fault.terminal.currentPc == target + 4
		&& fault.terminal.lastPc == target + 8 && fault.terminal.nextPc == target + 12
		&& fault.admissionCycles == decoded[2].baseCycles && fault.terminal.cycles == decoded[2].baseCycles + decoded[3].baseCycles
		&& fault.terminal.registerTop == 2 && fault.sourceWords == 4 && blocks[2].firstPc == independent,
		"the fault is the only terminal: the dead LEN cannot add an exit, charge or top, and source dependencies stay intact");
}

void knownFaultEndsTheFieldAddressLifetime() {
	std::array decoded{
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(1), .a = 2, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(1), .a = 3, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.a = 1, .op = static_cast<u8>(OpCode::KFALSE)},
		DecodedInstruction{.a = 4, .b = 1, .c = 2, .op = static_cast<u8>(OpCode::ADD)},
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(1), .a = 5, .op = static_cast<u8>(OpCode::GETFIELD)},
	};
	std::array<NativeBlockInstruction, decoded.size()> rows;
	for (size_t row = 0; row < rows.size(); ++row) {
		decoded[row].width = 1;
		decoded[row].baseCycles = BASE_CYCLES[decoded[row].op];
		rows[row] = {&decoded[row], 0x5900 + static_cast<u32>(row) * INSTRUCTION_BYTES};
	}
	const std::array sources{NativeBlockSource{rows}};
	NativeRegisterUses uses;
	NativeIrRegion region;
	region.build(sources, uses);
	const auto& block = region.blocks().front();
	require(region.blocks().size() == 1 && block.instructions.size() == 4 && block.ownFieldAddresses.size() == 1
		&& block.ownFieldAddresses[0].lastUseRow == 1 && region.sideExits(block).size() == 2,
		"a checked address remains shared only through the last reachable consumer");
}

void imageLiteralsProveNativeComparisonTypes() {
	std::array<DecodedInstruction, 2> decoded{};
	decoded[0].op = static_cast<u8>(OpCode::LOADK);
	decoded[0].setBx(23);
	decoded[1].op = static_cast<u8>(OpCode::LT);
	decoded[1].c = -1;
	for (auto& instruction : decoded) {
		instruction.width = 1;
		instruction.baseCycles = BASE_CYCLES[instruction.op];
	}
	const std::array rows{NativeBlockInstruction{&decoded[0], 0x1000}, NativeBlockInstruction{&decoded[1], 0x1004}};
	const std::array sources{NativeBlockSource{rows}};
	const auto verify = [&](std::span<const NativeImageConstant> constants, NativeComparisonStrategy expected) {
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(sources, uses, false, {}, {.imageConstants = constants});
		const auto instructions = region.blocks().front().instructions;
		require(std::get<NativeComparison>(instructions[1].operation).strategy == expected,
			"only the owning image's literal tags establish a direct native comparison");
		if (!constants.empty())
			require(std::get<NativeLiteral>(instructions[0].operation).value == constants[1].value,
				"a fixed LOADK becomes a literal before lowering");
	};
	verify({}, NativeComparisonStrategy::Kernel);
	const std::array words{NativeImageConstant{0, valueInteger(-9)}, NativeImageConstant{23, valueInteger(-12)}};
	verify(words, NativeComparisonStrategy::Word);
	const std::array floats{NativeImageConstant{0, valueFloat(0.5f)}, NativeImageConstant{23, valueFloat(1.5f)}};
	verify(floats, NativeComparisonStrategy::Float);
}

void fixedWindowCountsOnlyAdmittedAccesses() {
	struct Case { OpCode op; u16 a; i16 b, c; bool cpuOwned; u32 slots; };
	const std::array cases{
		Case{OpCode::MOV, 0, 31, 0, true, 32},
		Case{OpCode::LOADNIL, 31, 0, 0, true, 0},
		Case{OpCode::LOADNIL, 5, 4, 0, true, 9},
		Case{OpCode::SELF, 5, 2, 40, true, 7},
		Case{OpCode::STORE_MEM_WORDS, 31, 2, 0, true, 3},
		Case{OpCode::STORE_MEM_WORDS, 5, 2, 4, true, 9},
		Case{OpCode::VARARG, 31, 0, 0, true, 0},
		Case{OpCode::VARARG, 31, 5, 0, true, 0},
		Case{OpCode::CONCAT, 31, 21, 22, true, 32},
		Case{OpCode::RET, 31, 9, 0, true, 0},
		Case{OpCode::CALL, 9, 7, 9, true, 10},
		Case{OpCode::CALL, 9, 3, 2, true, 12},
		Case{OpCode::CALL, 9, 3, 2, false, 0},
	};
	for (const auto& [op, a, b, c, cpuOwned, slots] : cases) {
		std::array<DecodedInstruction, 2> decoded{};
		decoded[0].op = static_cast<u8>(op);
		decoded[0].a = a; decoded[0].b = b; decoded[0].c = c;
		decoded[1].op = static_cast<u8>(OpCode::HALT);
		for (auto& row : decoded) { row.width = 1; row.baseCycles = BASE_CYCLES[row.op]; }
		const std::array rows{NativeBlockInstruction{&decoded[0], 0x1000}, NativeBlockInstruction{&decoded[1], 0x1004}};
		const std::array sources{NativeBlockSource{rows}};
		NativeRegisterUses uses;
		NativeIrRegion region;
		region.build(sources, uses, cpuOwned);
		require(region.blocks().front().requiredSlots == slots, "the entry admits fixed operands, not dynamic receiving ranges");
	}
}
} // namespace

int main() {
	try {
		numericPlans();
		widenedNumericSitesHaveOnlyAnOperandFaultCheckpoint();
		fieldChainHasAnExplicitResumePoint();
		fieldSelectionPreservesColdCodeAndContinuation();
		distinctFieldValuesSurviveCopiesAndSlotReuse();
		capturedOperandsShareOnlyLocalProofs();
		rangeWritesAndMethodCopiesDefineValues();
		nestedFieldsShareOnlyTheCheckedAddress();
		fieldAddressRangesSurviveWorkspaceGrowth();
		fieldAddressesStopAtDefinitionsAndEffects();
		fieldAddressRetentionIsBoundedByLifetime();
		feedbackDoesNotDependOnStoreAdjacency();
		decodedFieldsBecomeOperationsAndEffects();
		undefinedMoveKindDoesNotBecomeANumericWordMove();
		successorsImportLogicalTypesBeforeLowering();
		admissionReplaysPreserveTheExactFusedPredecessor();
		onlyConsumedEntryProofsSurviveCopies();
		forwardJoinMeetsTagsNotValues();
		nativeTableGuardProvesTheFollowingReceiver();
		tableIndexProofsFollowTheKeyAcrossEntries();
		dataflowPlansTableAndMemoryInputs();
		rejectedReceiverDoesNotAdvertiseAFieldDatapath();
		dumpDistinguishesFoldedEdgesFromPublicEntries();
		dumpReportsSelectedBuiltinAndVarargPaths();
		recordPlanUsesTypedEntriesAndFullRomWords();
		registerUses();
		knownFaultEndsOnlyTheNativePath();
		knownFaultEndsTheFieldAddressLifetime();
		imageLiteralsProveNativeComparisonTypes();
		fixedWindowCountsOnlyAdmittedAccesses();
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
