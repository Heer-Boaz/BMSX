#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_dump.h"
#include "machine/cpu/native_ir_optimize.h"
#include "machine/cpu/native_ir_liveness.h"
#include "machine/cpu/native_ir_numeric.h"
#include "machine/cpu/native_ir_values.h"

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
	NativeIrRegion region(sources);
	const auto ops = region.blocks()[0].instructions;
	NativeRegisterUses uses;
	region.optimize(uses);
	const auto& field = std::get<NativeTableAccess>(ops[0].operation);
	const auto& arithmetic = std::get<NativeArithmetic>(ops[1].operation);
	const auto& store = std::get<NativeTableAccess>(ops[2].operation);
	const auto& add = std::get<NativeNumericPlan>(arithmetic.strategy);
	const auto& checkedAdd = region.sideExits(region.blocks().front())[*ops[1].slow];
	require(field.resultTag == ValueTag::Float && region.sideExits(region.blocks().front())[*ops[0].slow].exit == NativeBlockExit::ReadField,
		"only a successful own-field hit provides the Float proof");
	require(add.action == NativeNumericAction::Float && add.left == ValueTag::Float
		&& add.right == ValueTag::Integer && !add.guardLeft && add.guardRight
		&& arithmetic.left == field.value && store.value == arithmetic.result,
		"the sum uses the proven field result, checks the other input and supplies the store");
	require(ops[1].before == NativeResumePoint{pc + 4, decoded[0].baseCycles, 10, NativeResumePoint::CompletedInstruction{pc, pc}}
		&& checkedAdd.lastPc == pc + 8 && checkedAdd.nextPc == pc + 12,
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
		NativeIrRegion region(runs, false, {.tier = NativeCompilationTier::ColdImage});
		require(region.instructionCount() == 1 && region.blocks().front().terminal.nextPc == pc + INSTRUCTION_BYTES,
			"unobserved numeric field use defers only its suffix, even across independent assignments");
	}

	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		decoded[4].observeNativeNumericTypes(valueFloat(1.5f), valueInteger(1));
	{
		NativeIrRegion region(runs);
		const auto& field = std::get<NativeTableAccess>(region.blocks().front().instructions[1].operation);
		require(region.blocks().size() == 1 && field.resultTag == ValueTag::Float,
			"an own-slot hit has a known type without a continuation checkpoint");
	}
	decoded[3].a = 6;
	{
		NativeIrRegion region(runs);
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
	decoded[1].tableCacheSlot = decoded[3].tableCacheSlot = 0;
	decoded[3].c = 1;
	decoded[2].a = 9; decoded[2].b = 6;
	decoded[4].a = 5; decoded[4].b = 9; decoded[4].c = 6;
	decoded[5].bx = pc + 0x100;
	const std::array runs{NativeBlockSource{source}};
	NativeIrRegion cold(runs, false, {.tier = NativeCompilationTier::ColdImage});
	require(cold.instructionCount() == 1 && cold.blocks().front().terminal.nextPc == source[1].pc,
		"the cold cut begins at the first reaching field producer, not the most recent slot definition");

	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		decoded[4].observeNativeNumericTypes(valueFloat(1.5f), valueInteger(2));
	NativeIrRegion warm(runs);
	NativeRegisterUses uses;
	warm.optimize(uses);
	require(warm.blocks().size() == 1, "two proved field reads can share a native segment");
	const auto instructions = warm.blocks().front().instructions;
	const NativeRunValues values(instructions);
	require(values.inputs(4)[0] == NativeValueOrigin{1, 6} && values.inputs(4)[1] == NativeValueOrigin{3, 6},
		"copying and reusing the same guest slot do not merge two value definitions");
	require(std::get<NativeTableAccess>(instructions[1].operation).resultTag == ValueTag::Float
		&& std::get<NativeTableAccess>(instructions[3].operation).resultTag == ValueTag::Integer,
		"the optimizer proves each field result at its own producing instruction");
	const auto& plan = std::get<NativeNumericPlan>(std::get<NativeArithmetic>(instructions[4].operation).strategy);
	require(plan.action == NativeNumericAction::Float && !plan.guardLeft && !plan.guardRight,
		"the sum uses both field proofs, including the one forwarded by MOV");
}

void nestedFieldsShareOnlyTheCheckedAddress() {
	constexpr u32 pc = 0x5300u;
	std::array decoded{
		DecodedInstruction{.tableCacheSlot = 7, .a = 1, .b = 0, .c = 0, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.tableCacheSlot = 1, .a = 3, .b = 1, .c = 1, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.bx = 0, .a = 4, .b = 0, .op = static_cast<u8>(OpCode::MOV)},
		DecodedInstruction{.tableCacheSlot = 7, .a = 2, .b = 4, .c = 0, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.tableCacheSlot = 2, .a = 5, .b = 2, .c = 2, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.bx = 0, .a = 6, .b = 3, .c = 5, .op = static_cast<u8>(OpCode::ADD)},
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
	NativeIrRegion region(runs);
	NativeRegisterUses uses;
	region.optimize(uses);
	require(region.blocks().size() == 1, "a repeated own-field path stays in one native segment");
	const auto& block = region.blocks().front();
	const auto& first = std::get<NativeTableAccess>(block.instructions[0].operation);
	const auto& second = std::get<NativeTableAccess>(block.instructions[3].operation);
	require(first.ownFieldAddress && first.ownFieldAddress == second.ownFieldAddress
		&& first.ownFieldOnly && second.ownFieldOnly
		&& first.resultTag == ValueTag::Table && second.resultTag == ValueTag::Table,
		"the two t.a loads share a checked address but keep their own Table result checks");
	const auto& definition = block.ownFieldAddresses[*first.ownFieldAddress];
	require(block.ownFieldAddresses.size() == 3 && definition.definingRow == 0 && definition.receiver == 0
		&& definition.key == 0 && definition.temporary,
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
		&& text.find("R2 = load-own-field %addr0") != std::string::npos,
		"the diagnostic exposes the one checked field address and both consumers without lowering");

	const std::array rejected{NativeRejectedFieldProof{source[0].pc, ValueTag::Table}};
	NativeIrRegion adapted(runs, false, {}, {.rejectedFieldProofs = rejected});
	adapted.optimize(uses);
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

void fieldAddressesStopAtDefinitionsAndEffects() {
	enum class Boundary { Copy, Redefinition, UncheckedField, Store, Upvalue, Global, Call, FieldKey, Prediction };
	for (const auto boundary : {Boundary::Copy, Boundary::Redefinition, Boundary::Store, Boundary::Upvalue,
		Boundary::Global, Boundary::Call, Boundary::UncheckedField, Boundary::FieldKey, Boundary::Prediction}) {
		std::array decoded{
			DecodedInstruction{.tableCacheSlot = 4, .a = 1, .op = static_cast<u8>(OpCode::GETFIELD)},
			DecodedInstruction{.bx = 0, .a = 4, .op = static_cast<u8>(OpCode::MOV)},
			DecodedInstruction{.tableCacheSlot = 4, .a = 2, .b = 4, .op = static_cast<u8>(OpCode::GETFIELD)},
		};
		auto& between = decoded[1];
		auto& after = decoded[2];
		switch (boundary) {
			case Boundary::Copy: break;
			case Boundary::Redefinition: between.b = 3; break;
			case Boundary::UncheckedField:
				between.op = static_cast<u8>(OpCode::GETFIELD);
				between.tableCacheSlot = -1;
				after.b = 0;
				break;
			case Boundary::Store: between.op = static_cast<u8>(OpCode::SETI); after.b = 0; break;
			case Boundary::Upvalue: between.op = static_cast<u8>(OpCode::SETUP); after.b = 0; break;
			case Boundary::Global: between.op = static_cast<u8>(OpCode::SETGL); after.b = 0; break;
			case Boundary::Call: between.op = static_cast<u8>(OpCode::CALL); after.b = 0; break;
			case Boundary::FieldKey: after.c = 1; break;
			case Boundary::Prediction: after.tableCacheSlot = 5; break;
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
		NativeIrRegion region{std::span(runs).first(boundary == Boundary::Call ? 2 : 1)};
		const auto& firstBlock = region.blocks().front();
		const auto& lastBlock = region.blocks().back();
		const auto& first = std::get<NativeTableAccess>(firstBlock.instructions.front().operation);
		const auto& last = std::get<NativeTableAccess>(lastBlock.instructions.back().operation);
		require(first.ownFieldAddress && last.ownFieldAddress, "each fixed-field read has a checked address operand");
		const auto& definition = firstBlock.ownFieldAddresses[*first.ownFieldAddress];
		if (boundary == Boundary::Copy) {
			require(&firstBlock == &lastBlock && first.ownFieldAddress == last.ownFieldAddress
				&& definition.temporary && first.ownFieldOnly && last.ownFieldOnly && !first.resultTag && !last.resultTag,
				"repeated untyped loads can share an own-only path through an ordinary copy");
		} else {
			require(!definition.temporary && !first.ownFieldOnly && !last.ownFieldOnly,
				"different receivers, keys, seeds or intervening effects do not retain checked addresses");
		}
	}
}

void fieldAddressTemporariesAreBoundedByLifetime() {
	constexpr size_t keyCount = 1 + NATIVE_OWN_FIELD_TEMPORARIES;
	std::array<DecodedInstruction, 2 * keyCount> decoded;
	std::array<NativeBlockInstruction, decoded.size()> source;
	for (size_t row = 0; row < decoded.size(); ++row) {
		const auto key = static_cast<u16>(row % keyCount);
		decoded[row] = {.tableCacheSlot = key, .a = static_cast<u16>(row + 1), .c = static_cast<i16>(key),
			.op = static_cast<u8>(OpCode::GETFIELD), .width = 1, .baseCycles = BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)]};
		source[row] = {&decoded[row], 0x5500u + static_cast<u32>(row) * INSTRUCTION_BYTES};
	}
	const std::array runs{NativeBlockSource{source}};
	NativeIrRegion region(runs);
	const auto& block = region.blocks().front();
	require(region.blocks().size() == 1 && block.ownFieldAddresses.size() == keyCount + 1,
		"overlapping field addresses do not require an additional native temporary");
	for (size_t key = 0; key < keyCount; ++key) {
		const auto& first = std::get<NativeTableAccess>(block.instructions[key].operation);
		const auto& repeated = std::get<NativeTableAccess>(block.instructions[keyCount + key].operation);
		const auto& definition = block.ownFieldAddresses[*first.ownFieldAddress];
		if (key < NATIVE_OWN_FIELD_TEMPORARIES)
			require(first.ownFieldAddress == repeated.ownFieldAddress && definition.temporary == key,
				"simultaneously live addresses occupy distinct temporary ordinals");
		else
			require(first.ownFieldAddress != repeated.ownFieldAddress && !definition.temporary,
				"the excess use computes its checked address anew");
	}
}

void feedbackDoesNotDependOnStoreAdjacency() {
	DecodedInstruction sum{.bx = 0, .a = 3, .b = 1, .c = 2, .op = static_cast<u8>(OpCode::ADD)};
	DecodedInstruction store{.tableCacheSlot = -1, .c = 3, .op = static_cast<u8>(OpCode::SETFIELD)};
	for (auto* instruction : {&sum, &store}) {
		instruction->width = 1;
		instruction->baseCycles = BASE_CYCLES[instruction->op];
	}
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		sum.observeNativeNumericTypes(valueInteger(2), valueFloat(1.5f));
	const std::array source{NativeBlockInstruction{&sum, 0x5300u}, NativeBlockInstruction{&store, 0x5304u}};
	for (const size_t count : {1, 2}) {
		const std::array runs{NativeBlockSource{std::span(source).first(count)}};
		NativeIrRegion region(runs);
		NativeRegisterUses uses;
		region.optimize(uses);
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
	NativeIrRegion region(source);
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
	NativeIrRegion region(sources);
	const auto& row = region.blocks()[0].instructions[0];
	require(std::holds_alternative<NativeReplay>(row.operation) && row.before.pc == 0x4100 && row.before.cycles == 0
		&& region.sideExits(region.blocks().front()).empty(),
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
	NativeIrRegion region(sources);
	NativeRegisterUses uses;
	region.optimize(uses);
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
	NativeIrRegion region(sources);
	NativeRegisterUses uses;
	region.optimize(uses);
	const auto blocks = region.blocks();
	for (size_t target : {1u, 2u})
		require(blocks[target].typePredecessor == target - 1 && blocks[target].entryTypes.size() == 1,
			"only the consumed proof reaches each block's entry contract");
	require(blocks[1].entryTypes[0].slot == 7 && blocks[2].entryTypes[0].slot == 10
		&& blocks[2].entryTypes[0].tag == ValueTag::Integer,
		"the proof follows the copied value, not the separately read global-store operand");
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
	decoded[3].bx = 1;
	decoded[4].bx = source[5].pc;
	decoded[5].a = 7;
	decoded[5].b = 2;
	decoded[5].c = 8;
	decoded[6].a = 10;
	decoded[6].b = 9;
	decoded[6].c = static_cast<i16>(MemoryAccessKind::F32LE);
	const std::span instructions(source);
	const std::array runs{NativeBlockSource{instructions.first(5)}, NativeBlockSource{instructions.last(2)}};
	NativeIrRegion region(runs);
	NativeRegisterUses uses;
	region.optimize(uses);
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
}

void recordPlanUsesTypedEntriesAndFullRomWords() {
	DecodedInstruction allocation{.bx = 0, .c = 2, .op = static_cast<u8>(OpCode::NEWT)};
	DecodedInstruction first{.tableCacheSlot = -1, .c = -1, .op = static_cast<u8>(OpCode::SETFIELD)};
	DecodedInstruction last{.tableCacheSlot = -1, .b = 1, .c = 70, .op = static_cast<u8>(OpCode::SETFIELD)};
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
		NativeIrRegion writable(sources, true);
		require(writable.recordPlans().empty(), "writable code never owns a record recipe");
		NativeIrRegion readonly(sources, true, {.immutablePagePc = page});
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
} // namespace

int main() {
	try {
		numericPlans();
		fieldChainHasAnExplicitResumePoint();
		fieldSelectionOwnsColdCutAndContinuation();
		distinctFieldValuesSurviveCopiesAndSlotReuse();
		nestedFieldsShareOnlyTheCheckedAddress();
		fieldAddressesStopAtDefinitionsAndEffects();
		fieldAddressTemporariesAreBoundedByLifetime();
		feedbackDoesNotDependOnStoreAdjacency();
		decodedFieldsBecomeOperationsAndEffects();
		undefinedMoveKindDoesNotBecomeANumericWordMove();
		successorsImportLogicalTypesBeforeLowering();
		onlyConsumedEntryProofsSurviveCopies();
		dataflowPlansTableAndMemoryInputs();
		recordPlanUsesTypedEntriesAndFullRomWords();
		registerUses();
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
