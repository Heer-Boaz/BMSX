#include "machine/cpu/jit/runtime/block.h"
#include "support/native_region_fixture.h"
#include "common/compiler.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/call_state.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "spec/blua32/numeric.h"
#include "machine/cpu/value_arithmetic.h"
#include "support/value_bank.h"

#include <array>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>

namespace {
using namespace bmsx;

Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
IrqController irq(memory);
ExecutionAddressSpace addresses(memory);
CPU cpu(memory, irq, addresses);

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void multipleRegisterDefinitionsSurviveCallAndExit() {
	NativeBlockRunState nativeRunState;
	const std::array ops{OpCode::K1, OpCode::KSMI, OpCode::ADD, OpCode::ADD, OpCode::ADD, OpCode::MUL,
		OpCode::ADD, OpCode::MOV, OpCode::SHR, OpCode::MOV, OpCode::ADD, OpCode::JMP};
	const std::array<std::array<i16, 3>, 12> operands{{
		{0, 0, 0}, {1, 0, 5}, {2, 0, 1}, {0, 0, 1}, {1, 2, 1}, {2, 0, 1},
		{0, 0, 2}, {3, 2, 0}, {2, 2, 0}, {4, 0, 0}, {0, 0, 1}, {0, 0, 0},
	}};
	std::array<DecodedInstruction, 12> decoded{};
	std::array<NativeBlockInstruction, 12> source{};
	for (size_t i = 0; i < ops.size(); ++i) {
		auto& instruction = decoded[i];
		instruction.op = static_cast<u8>(ops[i]); instruction.width = 1; instruction.baseCycles = BASE_CYCLES[instruction.op];
		instruction.a = operands[i][0]; instruction.b = operands[i][1]; instruction.c = operands[i][2];
		if (ops[i] == OpCode::KSMI) instruction.setSbx(5);
		if (ops[i] == OpCode::JMP) instruction.setBx(0x12345678);
		source[i] = {&instruction, 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	for (const auto op : {OpCode::SHR, OpCode::MOD, OpCode::FLOORDIV, OpCode::POW}) {
		decoded[8].op = static_cast<u8>(op);
		auto block = test::compileNative(source, memory, cpu.stringPool());
		ValueSlots registers(5);
		const Value result = op == OpCode::POW ? valueFloat(luaPow(66, 72)) : valueInteger(op == OpCode::MOD ? 66 : 0);
		const std::array expected{valueInteger(83), valueInteger(11), result, valueInteger(66), valueInteger(72)};
		require(block->run(registers.view(), nativeRunState = {.remainingCycles = block->terminal.cycles}) == &block->terminal && test::matchesValues(registers.view(), expected),
			"multiple live native values survive ABI calls, register pressure, alias copies and an actual exit");
	}
}

void independentEntriesBindTheirOwnValueBanks() {
	std::array<DecodedInstruction, 4> decoded{};
	const std::array ops{OpCode::LOADK, OpCode::SHL, OpCode::ADD, OpCode::JMP};
	std::array<NativeBlockInstruction, 4> source{};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]);
		decoded[i].width = decoded[i].baseCycles = 1;
		source[i] = {&decoded[i], 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	decoded[0].a = 1; decoded[0].setBx(0);
	decoded[1].a = 2; decoded[1].b = 0; decoded[1].c = -2;
	decoded[2].a = 3; decoded[2].b = 2; decoded[2].c = 1;
	decoded[3].setBx(0x1800u);
	const std::array constantsA{valueFloat(3.5), valueInteger(1)};
	const auto constantsABank = test::valueBank(constantsA);
	const std::array constantsB{valueInteger(10), valueInteger(2)};
	const auto constantsBBank = test::valueBank(constantsB);
	std::weak_ptr<NativeCodeRegion> helperRegion, leafRegion;
	{
		auto helper = test::compileNative(source, memory, cpu.stringPool());
		decoded[1].op = static_cast<u8>(OpCode::MUL);
		auto leaf = test::compileNative(source, memory, cpu.stringPool());
		helperRegion = helper->region;
		leafRegion = leaf->region;
		auto registersA = test::valueBank(std::array{valueInteger(1), valueNil(), valueNil(), valueNil(), valueBool(true)});
		auto registersB = test::valueBank(std::array{valueInteger(2), valueNil(), valueNil(), valueNil(), valueBool(false)});
		for (int iteration = 0; iteration < 256; ++iteration) {
			NativeBlockRunState a{.constants = constantsABank.view(), .remainingCycles = 97, .registerTop = 1};
			NativeBlockRunState b{.constants = constantsBBank.view(), .remainingCycles = 53, .registerTop = 5};
			require(helper->run(registersA.view(), a) == &helper->terminal && leaf->run(registersB.view(), b) == &leaf->terminal,
				"independent helper and leaf bodies return through the native entry ABI");
			require(a.remainingCycles == 93 && b.remainingCycles == 49 && a.registerTop == 4 && b.registerTop == 5,
				"alternating entries preserve each caller's cycle grant and register top");
			require(registersA.get(3) == valueFloat(5.5) && registersB.get(3) == valueInteger(14)
				&& registersA.get(4) == valueBool(true) && registersB.get(4) == valueBool(false),
				"alternating native entries reload the correct value banks without leaking another caller's state");
		}
	}
	require(helperRegion.expired() && leafRegion.expired(), "independent native bodies retire their own executable allocations");
}

void entryAdmitsTheWholeRegionWindow() {
	constexpr u32 sourcePc = 0x0ff8u, firstPc = 0x1000u, nextPc = 0x1008u, exitPc = 0x2000u;
	std::array<DecodedInstruction, 6> decoded{};
	const std::array ops{OpCode::K1, OpCode::JMP, OpCode::K1, OpCode::JMP, OpCode::MOV, OpCode::JMP};
	const std::array pcs{sourcePc, sourcePc + 4, firstPc, firstPc + 4, nextPc, nextPc + 4};
	std::array<NativeBlockInstruction, 6> source{};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]);
		decoded[i].width = 1;
		decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
		source[i] = {&decoded[i], pcs[i]};
	}
	decoded[0].a = 1;
	decoded[1].setBx(firstPc);
	decoded[3].setBx(nextPc);
	decoded[4].a = 2; decoded[4].b = 7;
	decoded[5].setBx(exitPc);
	const std::span rows(source);
	const std::array plans{NativeBlockSource{rows.subspan(2, 2)}, NativeBlockSource{rows.subspan(4, 2)}};
	auto blocks = NativeCompiler::compile(plans, NativeCodeBindings(memory, cpu.stringPool()));
	auto predecessor = test::compileNative(rows.first(2), memory, cpu.stringPool());
	blocks[0]->linkFrom(predecessor->terminal);
	for (const bool linked : {false, true}) for (const size_t capacity : {7u, 8u}) {
		ValueSlots bank(8);
		bank.set(7, valueFloatBits(0x7fc00019u));
		constexpr int grant = 32;
		NativeBlockRunState state{.remainingCycles = grant, .registerTop = 1};
		const auto& entry = linked ? *predecessor : *blocks[0];
		const auto& exit = *entry.run(bank.view().subspan(0, capacity), state);
		const int paid = linked ? predecessor->terminal.cycles : 0;
		if (capacity == 7) {
			require(exit.exit == NativeBlockExit::ScalarBoundary && exit.nextPc == firstPc
				&& !exit.operands.replay.hasCompletedInstruction && state.remainingCycles == grant - paid
				&& state.registerTop == (linked ? 2 : 1) && bank.get(0) == valueNil() && bank.get(2) == valueNil(),
				"an undersized public or linked entry retires no part of the receiving region");
		} else {
			require(&exit == &blocks[1]->terminal && exit.nextPc == exitPc
				&& state.remainingCycles == grant - paid - blocks[0]->terminal.cycles - blocks[1]->terminal.cycles
				&& state.registerTop == 3 && bank.get(0) == valueInteger(1) && bank.get(2) == bank.get(7),
				"an exact reserved window admits the local successor independently of live top");
		}
		require(bank.get(1) == (linked ? valueInteger(1) : valueNil()) && bank.get(7) == valueFloatBits(0x7fc00019u),
			"window admission preserves the source region's paid writes and the original operand");
	}
}

void helperContinuationsReloadTheCurrentRegisterMap() {
	std::array<DecodedInstruction, 6> decoded{};
	std::array<NativeBlockInstruction, 6> source{};
	const std::array ops{OpCode::K1, OpCode::LOAD_MEM, OpCode::MOV, OpCode::STORE_MEM, OpCode::MOV, OpCode::JMP};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1; decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
		source[i] = {&decoded[i], 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	decoded[0].a = 8;
	decoded[1].a = 0; decoded[1].b = 1; decoded[1].c = static_cast<i16>(MemoryAccessKind::U32LE);
	decoded[2].a = 4; decoded[2].b = 8;
	decoded[3].a = 4; decoded[3].b = 1; decoded[3].c = static_cast<i16>(MemoryAccessKind::U32LE);
	decoded[4].a = 5; decoded[4].b = 0;
	decoded[5].setBx(0x1800u);
	const std::span instructions(source);
	const std::array plans{NativeBlockSource{instructions}};
	constexpr u32 target = DYNAMIC_RAM_BASE + 0x84000u;
	const Value payload = valueInteger(0x13574201);
	std::weak_ptr<NativeCodeRegion> region;
	{
		auto blocks = NativeCompiler::compile(plans, NativeCodeBindings(memory, cpu.stringPool()));
		region = blocks[0]->region;
		require(blocks[0]->region == blocks[1]->region && blocks[1]->region == blocks[2]->region,
			"helper continuations are entries of one executable allocation");
		require(blocks[0]->sourceWords == 6 && blocks[1]->sourceWords == 4 && blocks[2]->sourceWords == 2,
			"positive budget admits each continuation's bounded linear suffix");
		for (const Value incoming : {valueInteger(16777217), valueInteger(-1), valueInteger(INT32_MIN)})
		for (int iteration = 0; iteration < 32; ++iteration) for (size_t entry = 0; entry < blocks.size(); ++entry) {
			ValueSlots registers(9);
			registers.set(0, payload); registers.set(1, valueInteger(target)); registers.set(8, incoming);
			memory.writeMappedWord(target, 17u);
			int charge = 0;
			for (size_t i = entry * 2; i < decoded.size(); ++i) charge += decoded[i].baseCycles;
			NativeBlockRunState state{.remainingCycles = charge};
			const auto* observed = blocks[entry]->run(registers.view(), state);
			require(observed == &blocks[2]->terminal && state.remainingCycles == 0,
				"a fully funded suffix reaches its terminal without a mid-span host exit");
			if (entry == 0) require(registers.get(0) == valueInteger(17) && registers.get(4) == valueInteger(1)
				&& registers.get(5) == valueInteger(17) && registers.get(8) == valueInteger(1)
				&& memory.readMappedWord(target) == 1u && state.registerTop == 9,
				"fast helper fallthrough preserves dirty live native registers");
			else require(registers.get(0) == payload && registers.get(5) == payload && registers.get(8) == incoming
				&& registers.get(4) == (entry == 1 ? incoming : valueNil())
				&& memory.readMappedWord(target) == (entry == 1 ? valuePayload(incoming) : 17u) && state.registerTop == 6,
				"admitted cold entries reload current payloads, not predecessor values or register top");
		}
		for (size_t entry = 0; entry < blocks.size(); ++entry) {
			std::array<DecodedInstruction, 2> prefix{};
			prefix[0].op = static_cast<u8>(OpCode::MOV); prefix[0].a = 8; prefix[0].b = 2;
			prefix[1].op = static_cast<u8>(OpCode::JMP); prefix[1].setBx(blocks[entry]->firstPc);
			for (auto& op : prefix) { op.width = 1; op.baseCycles = BASE_CYCLES[op.op]; }
			const std::array prefixSource{NativeBlockInstruction{&prefix[0], 0x2000}, NativeBlockInstruction{&prefix[1], 0x2004}};
			auto predecessor = test::compileNative(prefixSource, memory, cpu.stringPool());
			require(predecessor->terminal.link.patchAddress != 0,
				"an external continuation owns a patchable generated-code edge");
			blocks[entry]->linkFrom(predecessor->terminal);
			const int predecessorCycles = prefix[0].baseCycles + prefix[1].baseCycles;
			int suffixCycles = 0;
			for (size_t i = entry * 2; i < decoded.size(); ++i) suffixCycles += decoded[i].baseCycles;
			for (const Value incoming : {valueInteger(16777217), valueInteger(-1), valueInteger(INT32_MIN)})
			for (const int grant : {1, predecessorCycles, predecessorCycles + suffixCycles}) {
				ValueSlots registers(9);
				registers.set(0, payload); registers.set(1, valueInteger(target)); registers.set(2, incoming);
				memory.writeMappedWord(target, 17u);
				NativeBlockRunState state{.remainingCycles = grant};
				const auto* exit = predecessor->run(registers.view(), state);
				if (grant <= predecessorCycles) {
					const bool beforeJump = grant <= prefix[0].baseCycles;
					require((beforeJump ? exit->exit == NativeBlockExit::ScalarBoundary : exit == &predecessor->terminal)
						&& state.remainingCycles == (beforeJump ? grant : grant - predecessorCycles) && state.registerTop == (beforeJump ? 0 : 9)
						&& registers.get(8) == (beforeJump ? valueNil() : incoming) && registers.get(5) == valueNil() && memory.readMappedWord(target) == 17u,
						"a patched target guard preserves the source descriptor and never admits an exhausted successor");
				} else {
					require(exit == &blocks[2]->terminal && state.remainingCycles == grant - predecessorCycles - suffixCycles
						&& state.registerTop == 9 && registers.get(5) == (entry == 0 ? valueInteger(17) : payload)
						&& registers.get(8) == (entry == 0 ? valueInteger(1) : incoming)
						&& memory.readMappedWord(target) == (entry == 0 ? 1u : entry == 1 ? valuePayload(incoming) : 17u),
						"patched edges enter inherited helper continuations with current values and the target's payload map");
				}
			}
		}
	}
	require(region.expired(), "the shared region is released when all continuation descriptors leave scope");
}

void residentValuesCrossInternalComparisonBranches() {
	std::array<DecodedInstruction, 10> decoded{};
	const std::array ops{OpCode::MOV, OpCode::LT, OpCode::JMP, OpCode::MOV, OpCode::MOV,
		OpCode::MOV, OpCode::MOV, OpCode::ADD, OpCode::MOV, OpCode::JMP};
	std::array<NativeBlockInstruction, 10> source{};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1; decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
		source[i] = {&decoded[i], 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	decoded[0].a = 7; decoded[0].b = 8;
	decoded[1].a = 0; decoded[1].b = 0; decoded[1].c = 1;
	decoded[2].setBx(0x1014u);
	decoded[3].a = 3; decoded[3].b = 7;
	decoded[4].a = 9; decoded[4].b = 8;
	decoded[5].a = 6; decoded[5].b = 7;
	decoded[6].a = 10; decoded[6].b = 8;
	decoded[7].a = 4; decoded[7].b = 4; decoded[7].c = -1;
	decoded[8].a = 5; decoded[8].b = 4;
	decoded[9].setBx(0x1000u);
	const std::span instructions(source);
	const std::array plans{NativeBlockSource{instructions.subspan(0, 2), &decoded[2]},
		NativeBlockSource{instructions.subspan(2, 1)}, NativeBlockSource{instructions.subspan(3, 2)},
		NativeBlockSource{instructions.subspan(5, 5)}};
	const std::array constants{valueInteger(1)};
	const auto constantsBank = test::valueBank(constants);
	const auto alpha = valueString(cpu.stringPool().intern("alpha")), omega = valueString(cpu.stringPool().intern("omega"));
	const std::array values{valueFromTag(ValueTag::False, 37), valueTable(cpu.createTable().address()), valueFloat(-0.0),
		valueFloatBits(0x7fc0002au)};
	for (const auto op : {OpCode::EQ, OpCode::LT, OpCode::LE}) for (bool expected : {false, true}) {
		decoded[1].op = static_cast<u8>(op); decoded[1].a = expected ? 1 : 0;
		auto blocks = NativeCompiler::compile(plans, NativeCodeBindings(memory, cpu.stringPool()));
		const int throughCompare = decoded[0].baseCycles + decoded[1].baseCycles;
		for (bool predicate : {false, true}) for (auto value : values) for (int grant : {1, throughCompare, 32, 63, 128, 257}) {
			ValueSlots registers(11);
			registers.set(0, op == OpCode::EQ || predicate ? alpha : omega);
			registers.set(1, op == OpCode::EQ ? (predicate ? alpha : omega) : (predicate ? omega : alpha));
			registers.set(3, valueInteger(73)); registers.set(4, valueInteger(0)); registers.set(8, value);
			NativeBlockRunState run{.constants = constantsBank.view(), .remainingCycles = grant};
			const auto* observedExit = blocks[0]->run(registers.view(), run);
			if (grant <= throughCompare) {
				const bool beforeCompare = grant <= decoded[0].baseCycles;
				const int charged = beforeCompare ? 0 : throughCompare + (op == OpCode::EQ ? 0 : 5);
				require(registers.get(7) == (beforeCompare ? valueNil() : value) && registers.get(8) == value && registers.get(6) == valueNil()
					&& run.remainingCycles == grant - charged && run.registerTop == (beforeCompare ? 0 : 8),
					"both comparison expectations publish live cached raw values at the exact instruction boundary");
				continue;
			}
			if (observedExit->exit == NativeBlockExit::ScalarBoundary) {
				require(registers.get(7) == value && registers.get(8) == value,
					"short successor preserves live tagged values before scalar execution");
				continue;
			}
			require(registers.get(7) == value && registers.get(6) == value && asInteger(registers.get(4)) > 0
				&& registers.get(5) == registers.get(4)
				&& run.registerTop == 11,
				"shared equality and string-order branches preserve resident definitions at each instruction boundary");
			require(registers.get(8) == value && registers.get(10) == value
				&& registers.get(3) == (predicate != expected ? value : valueInteger(73))
				&& registers.get(9) == (predicate != expected ? value : valueNil()),
				"raw tagged payloads, references, NaN payloads and negative zero survive both cold comparison paths");
		}
	}
}

void segmentEntryPermutationsPreserveRawValuesAndDeadDefinitions() {
	std::array<DecodedInstruction, 12> decoded{};
	std::array<NativeBlockInstruction, 12> instructions{};
	const std::array ops{OpCode::LOADK, OpCode::LOADK, OpCode::LOADK, OpCode::LOADK, OpCode::LOADK, OpCode::JMP,
		OpCode::MOV, OpCode::MOV, OpCode::MOV, OpCode::MOV, OpCode::ADD, OpCode::JMP};
	for (size_t index = 0; index < ops.size(); ++index) {
		decoded[index].op = static_cast<u8>(ops[index]);
		decoded[index].width = decoded[index].baseCycles = 1;
		instructions[index] = {&decoded[index], 0x1000u + static_cast<u32>(index) * INSTRUCTION_BYTES};
	}
	// r8 has no future use but must still be observable at a short grant.
	decoded[0].a = 8; decoded[0].setBx(4);
	for (int index = 0; index < 4; ++index) {
		decoded[index + 1].a = index; decoded[index + 1].setBx(index);
		decoded[index + 6].a = index + 4;
	}
	decoded[5].setBx(0x1018u);
	decoded[10].a = 9; decoded[10].b = -6; decoded[10].c = -7;
	decoded[11].setBx(0x2000u);
	const std::span source(instructions);
	const std::array plans{NativeBlockSource{source.first(6)}, NativeBlockSource{source.subspan(6)}};
	const std::array constants{valueFromTag(ValueTag::False, 37), valueTable(cpu.createTable().address()),
		valueFloat(-0.0), valueString(cpu.stringPool().intern("register permutation")), valueInteger(73), valueInteger(2), valueInteger(4)};
	const auto constantsBank = test::valueBank(constants);
	const std::array<std::array<int, 4>, 3> permutations{{{3, 2, 1, 0}, {1, 2, 3, 0}, {2, 0, 3, 1}}};
	for (const auto& permutation : permutations) for (bool helper : {false, true}) {
		for (int index = 0; index < 4; ++index) decoded[index + 6].b = permutation[index];
		decoded[10].op = static_cast<u8>(helper ? OpCode::POW : OpCode::ADD);
		auto blocks = NativeCompiler::compile(plans, NativeCodeBindings(memory, cpu.stringPool()));
		for (int grant : {1, 6, 7, 12, 100}) {
			ValueSlots registers(10);
			NativeBlockRunState run{.constants = constantsBank.view(), .remainingCycles = grant};
			const auto* exit = blocks[0]->run(registers.view(), run);
			const auto* expectedExit = grant == 6 ? &blocks[0]->terminal : grant >= 12 ? &blocks[1]->terminal : nullptr;
			const int charged = grant < 6 ? 0 : grant < 12 ? 6 : 12;
			require((expectedExit ? exit == expectedExit : exit->exit == NativeBlockExit::ScalarBoundary) && run.remainingCycles == grant - charged,
				"permuted entries preserve exact instruction admission and exit identity");
			for (int index = 0; index < 4; ++index) {
				require(registers.get(index) == (grant >= 6 ? constants[index] : valueNil()),
					"entry permutation preserves every admitted raw Value at the budget guard");
				require(registers.get(index + 4) == (grant >= 12 ? constants[permutation[index]] : valueNil()),
					"only admitted instructions execute after parallel register moves");
			}
			require(registers.get(8) == (grant >= 6 ? constants[4] : valueNil()), "liveness does not erase a dead but observable register definition");
			require(registers.get(9) == (grant >= 12 ? (helper ? valueFloat(16) : valueInteger(6)) : valueNil()),
				"both register banks reconcile joins across a native helper");
		}
		// An external entry admits its own register tags; it never inherits
		// the predecessor's values just because their types match.
		const std::array incoming{valueFromTag(ValueTag::False, 81), constants[1],
			valueFloat(6.25f), valueString(cpu.stringPool().intern("cold entry"))};
		ValueSlots registers(10);
		for (int i = 0; i < 4; ++i) registers.set(i, incoming[i]);
		NativeBlockRunState run{.constants = constantsBank.view(), .remainingCycles = 6};
		require(blocks[1]->run(registers.view(), run) == &blocks[1]->terminal, "matching public-entry facts admit a cold segment");
		for (int i = 0; i < 4; ++i) require(registers.get(i + 4) == incoming[permutation[i]],
			"external entry reloads the current payload of each permuted register");
		for (int i = 0; i < 4; ++i) registers.set(i, constants[3 - i]);
		run.remainingCycles = 6;
		const auto* polymorphic = blocks[1]->run(registers.view(), run);
		require(polymorphic == &blocks[1]->terminal && run.remainingCycles == 0,
			"a public entry that only copies incoming values does not require the donor's tags");
		for (int i = 0; i < 4; ++i) require(registers.get(i + 4) == constants[3 - permutation[i]],
			"an untyped native entry preserves values of every incoming tag");

	}
}

void admissionReplayPublishesOnlyThePaidPrefix() {
	constexpr u32 firstPc = 0x1100, targetPc = 0x1200, backPc = 0x1300;
	std::array<DecodedInstruction, 5> decoded{};
	const std::array ops{OpCode::K1, OpCode::JMP, OpCode::K1, OpCode::ADD, OpCode::KFALSE};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]);
		decoded[i].width = 1;
		decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
	}
	decoded[0].a = decoded[4].a = 2;
	decoded[1].width = 2;
	decoded[1].setBx(targetPc);
	decoded[2].a = 3;
	decoded[3].a = 4; decoded[3].b = decoded[3].c = 2;
	const std::array first{NativeBlockInstruction{&decoded[0], firstPc}, NativeBlockInstruction{&decoded[1], firstPc + 4}};
	const std::array target{NativeBlockInstruction{&decoded[2], targetPc}, NativeBlockInstruction{&decoded[3], targetPc + 4}};
	const std::array back{NativeBlockInstruction{&decoded[4], backPc}, NativeBlockInstruction{&decoded[1], backPc + 4}};
	const std::array sources{NativeBlockSource{first}, NativeBlockSource{target}, NativeBlockSource{back}};
	const auto blocks = NativeCompiler::compile(sources, NativeCodeBindings(memory, cpu.stringPool()));
	const int predecessorCharge = decoded[0].baseCycles + decoded[1].baseCycles;
	const int targetPrefix = decoded[2].baseCycles;
	const auto stop = [&](size_t entry, int grant, int charge, u32 predecessorPc) {
		auto registers = test::valueBank(std::array{valueNil(), valueNil(), valueFloat(-0.0f), valueInteger(71), valueInteger(72)});
		NativeBlockRunState run{.remainingCycles = grant, .registerTop = 2};
		const auto* replay = blocks[entry]->run(registers.view(), run);
		const auto expectedInput = entry == 0 ? valueInteger(1) : entry == 2 ? valueBool(false) : valueFloat(-0.0f);
		require(replay->exit == NativeBlockExit::ScalarBoundary && replay->nextPc == targetPc
			&& replay->cycles == 0 && replay->registerTop == 0 && replay->operands.replay.hasCompletedInstruction == (entry != 1)
			&& replay->currentPc == (entry == 1 ? 0u : predecessorPc + 4)
			&& replay->lastPc == (entry == 1 ? 0u : predecessorPc + 8),
			"admission resumes the target and attributes only the paid WIDE predecessor, if any");
		require(run.remainingCycles == grant - charge && run.registerTop == (entry == 1 ? 2 : 3)
			&& registers.get(2) == expectedInput && registers.get(3) == valueInteger(71) && registers.get(4) == valueInteger(72),
			"grant and type misses retain the current target inputs and exactly the completed register/top changes");
	};
	stop(0, predecessorCharge + targetPrefix, predecessorCharge, firstPc);
	stop(1, targetPrefix, 0, 0);
	stop(1, targetPrefix + 1, 0, 0);
	stop(2, decoded[4].baseCycles + decoded[1].baseCycles + targetPrefix + 1,
		decoded[4].baseCycles + decoded[1].baseCycles, backPc);

	ValueSlots registers(5);
	NativeBlockRunState run{.remainingCycles = predecessorCharge + targetPrefix + 1};
	require(blocks[0]->run(registers.view(), run) == &blocks[1]->terminal
		&& registers.get(3) == valueInteger(1) && registers.get(4) == valueInteger(2)
		&& run.remainingCycles == 1 - decoded[3].baseCycles && run.registerTop == 5,
		"one cycle beyond the admission threshold lets the final instruction exhaust a running grant");
}

void sparseRegionSuccessorsPreserveExactPcIdentity() {
	const std::array values{valueFloat(-0.0), valueFromTag(ValueTag::False, 73), valueTable(cpu.createTable().address())};
	for (const u32 page : {0x1000u, 0xfffffc00u}) {
		std::array<DecodedInstruction, 5> decoded{};
		const std::array ops{OpCode::MOV, OpCode::JMPIF, OpCode::JMP, OpCode::MOV, OpCode::JMP};
		for (size_t index = 0; index < ops.size(); ++index) {
			decoded[index].op = static_cast<u8>(ops[index]);
			decoded[index].width = decoded[index].baseCycles = 1;
		}
		decoded[0].a = 2; decoded[0].b = 1;
		decoded[1].a = 0; decoded[1].setBx(page + MAPPED_PAGE_BYTE_SIZE - INSTRUCTION_BYTES);
		decoded[3].a = 3; decoded[3].b = 2;
		decoded[4].setBx(0x87654320u);
		// Source order is deliberately not address order. The first and last
		// page words are entries; the word after the low entry is only its body.
		const std::array instructions{NativeBlockInstruction{&decoded[0], page + 512u},
			NativeBlockInstruction{&decoded[1], page + 516u},
			NativeBlockInstruction{&decoded[2], page + MAPPED_PAGE_BYTE_SIZE - INSTRUCTION_BYTES},
			NativeBlockInstruction{&decoded[3], page}, NativeBlockInstruction{&decoded[4], page + INSTRUCTION_BYTES}};
		const std::span source(instructions);
		const std::array plans{NativeBlockSource{source.first(2)}, NativeBlockSource{source.subspan(2, 1)},
			NativeBlockSource{source.subspan(3)}};
		for (const u32 target : {page, page + MAPPED_PAGE_BYTE_SIZE, page - MAPPED_PAGE_BYTE_SIZE,
			page + 1u, page + INSTRUCTION_BYTES}) {
			decoded[2].setBx(target);
			auto blocks = NativeCompiler::compile(plans, NativeCodeBindings(memory, cpu.stringPool()));
			require(blocks[0]->terminal.link.patchAddress != 0 && blocks[0]->sideExits.back().link.patchAddress == 0,
				"a sparse conditional leaves its missing fallthrough external but binds its last-word target internally");
			require((blocks[1]->terminal.link.patchAddress == 0) == (target == page),
				"only the exact entry PC is internal, not another page, an unaligned PC or an interior body word");
			for (const auto value : values) for (const bool taken : {false, true}) for (const int grant : {1, 2, 3, 4, 100}) {
				auto registers = test::valueBank(std::array{valueBool(taken), value, valueInteger(19), valueInteger(29)});
				NativeBlockRunState run{.remainingCycles = grant};
				const auto* exit = blocks[0]->run(registers.view(), run);
				const bool started = grant > 1;
				const bool middle = started && taken && grant > 2;
				const bool last = middle && target == page && grant > 4;
				const bool shortEntry = !started || (middle && target == page && grant == 4);
				const auto* expected = !started ? nullptr
					: !taken ? &blocks[0]->terminal : !middle ? &blocks[0]->sideExits.back()
					: shortEntry ? nullptr : last ? &blocks[2]->terminal : &blocks[1]->terminal;
				const int charged = !started ? 0 : last ? 5 : middle ? 3 : 2;
				require((expected ? exit == expected : exit->exit == NativeBlockExit::ScalarBoundary) && run.remainingCycles == grant - charged,
					"indexed successors preserve branch identity and exact instruction admission");
				require(registers.get(1) == value && registers.get(2) == (started ? value : valueInteger(19)) && registers.get(3) == (last ? value : valueInteger(29))
					&& run.registerTop == (!started ? 0 : last ? 4 : 3),
					"transitive live-in planning preserves raw resident values across sparse reordered entries");
			}
		}
	}
}

void diamondBackedgesPreserveFullStateFromEveryEntry() {
	const std::array ops{OpCode::MOV, OpCode::MOV, OpCode::MOV, OpCode::MOV, OpCode::JMPIF,
		OpCode::MOV, OpCode::MOV, OpCode::LOADK, OpCode::MOV, OpCode::JMP,
		OpCode::MOV, OpCode::MOV, OpCode::LOADK, OpCode::MOV, OpCode::JMP,
		OpCode::MOV, OpCode::MOV, OpCode::ADD,
		OpCode::MOV, OpCode::MOV, OpCode::NOT, OpCode::JMPIF,
		OpCode::LOADK, OpCode::MOV, OpCode::JMP};
	const std::array<std::array<i16, 3>, 25> operands{{
		{4, 0, 0}, {5, 1, 0}, {6, 2, 0}, {7, 3, 0}, {10, 0, 0},
		{0, 5, 0}, {2, 7, 0}, {9, 0, 0}, {11, 3, 0}, {0, 0, 0},
		{1, 4, 0}, {3, 6, 0}, {9, 0, 0}, {11, 0, 0}, {0, 0, 0},
		{4, 3, 0}, {6, 1, 0}, {13, -1, -2},
		{5, 2, 0}, {7, 0, 0}, {10, 10, 0}, {12, 0, 0},
		{9, 0, 0}, {14, 11, 0}, {0, 0, 0},
	}};
	std::array<DecodedInstruction, 25> decoded{};
	std::array<NativeBlockInstruction, 25> instructions{};
	for (size_t index = 0; index < ops.size(); ++index) {
		auto& instruction = decoded[index];
		instruction.op = static_cast<u8>(ops[index]);
		instruction.width = instruction.baseCycles = 1;
		instruction.a = operands[index][0]; instruction.b = operands[index][1]; instruction.c = operands[index][2];
		instructions[index] = {&instruction, 0x1000u + static_cast<u32>(index) * INSTRUCTION_BYTES};
	}
	decoded[4].setBx(instructions[10].pc);
	decoded[7].setBx(2); decoded[12].setBx(3); decoded[22].setBx(4);
	decoded[9].setBx(instructions[15].pc); decoded[14].setBx(instructions[15].pc);
	decoded[21].setBx(instructions[0].pc);
	decoded[24].setBx(0x2000u);
	const std::span source(instructions);
	const std::array plans{NativeBlockSource{source.first(5)}, NativeBlockSource{source.subspan(5, 5)},
		NativeBlockSource{source.subspan(10, 5)}, NativeBlockSource{source.subspan(15, 3)},
		NativeBlockSource{source.subspan(18, 4)}, NativeBlockSource{source.subspan(22)}};
	const std::array constants{valueInteger(2), valueInteger(3), valueFromTag(ValueTag::False, 57),
		valueTable(cpu.createTable().address()), valueFloat(-0.0), valueString(cpu.stringPool().intern("diamond register"))};
	const auto constantsBank = test::valueBank(constants);
	for (const bool helper : {false, true}) for (const bool bypassHelper : {false, true}) {
		decoded[17].op = static_cast<u8>(helper ? OpCode::POW : OpCode::ADD);
		// A forward branch directly into the inherited continuation cannot
		// borrow the values or dirty state of its linear helper predecessor.
		decoded[9].setBx(instructions[bypassHelper ? 18 : 15].pc);
		auto blocks = NativeCompiler::compile(plans, NativeCodeBindings(memory, cpu.stringPool()));
		for (size_t entry = 0; entry < plans.size(); ++entry) for (const bool arm : {false, true})
		for (const bool loop : {false, true}) for (const int grant : {1, 4, 5, 6, 9, 10, 11, 14, 20, 31, 64, 257}) {
			std::array<Value, 16> initial{constants[2], constants[3], constants[4], constants[5],
				valueInteger(23), valueFloat(std::numeric_limits<float>::infinity()), valueNil(), valueBool(true),
				valueInteger(-71), valueFloat(std::numeric_limits<float>::quiet_NaN()), valueBool(arm), constants[5],
				valueBool(loop), valueFloat(-std::numeric_limits<float>::infinity()), constants[2], constants[3]};
			auto expected = initial;
			auto actual = test::valueBank(initial);
			int remaining = grant, top = -5;
			size_t segment = entry;
			const NativeBlockExitSite* expectedExit;
			// Independent scalar execution checks admission before each instruction,
			// including across inherited helper-success continuations.
			for (;;) {
				if (remaining <= blocks[segment]->admissionCycles) { expectedExit = nullptr; break; }
				bool taken = false;
				u32 nextPc = 0;
				for (const auto& item : plans[segment].instructions) {
					if (remaining <= 0) throw std::runtime_error("admitted segment exhausted before its final instruction");
					const auto& op = *item.decoded;
					const auto operand = [&](int selector) { return selector < 0 ? constants[-selector - 1] : expected[selector]; };
					nextPc = item.pc + INSTRUCTION_BYTES;
					remaining -= op.baseCycles;
					switch (static_cast<OpCode>(op.op)) {
						case OpCode::MOV: expected[op.a] = operand(op.b); break;
						case OpCode::LOADK: expected[op.a] = constants[op.bx()]; break;
						case OpCode::ADD: expected[op.a] = valueAdd(operand(op.b), operand(op.c)); break;
						case OpCode::POW: expected[op.a] = valuePower(operand(op.b), operand(op.c)); break;
						case OpCode::NOT: expected[op.a] = valueBool(!isTruthy(operand(op.b))); break;
						case OpCode::JMP: nextPc = op.bx(); continue;
						case OpCode::JMPIF:
							taken = isTruthy(expected[op.a]);
							if (taken) nextPc = op.bx();
							continue;
						default: throw std::runtime_error("unexpected scalar register-graph instruction");
					}
					top = std::max(top, static_cast<int>(op.a) + 1);
				}
				expectedExit = taken ? &blocks[segment]->sideExits.back() : &blocks[segment]->terminal;
				if (remaining <= 0) break;
				for (segment = 0; segment < plans.size(); ++segment) if (plans[segment].instructions.front().pc == nextPc) break;
				if (segment == plans.size()) break;
			}
			NativeBlockRunState run{.constants = constantsBank.view(), .remainingCycles = grant, .registerTop = -5};
			const auto* exit = blocks[entry]->run(actual.view(), run);
			if (!test::matchesValues(actual.view(), expected) || (expectedExit ? exit != expectedExit : exit->exit != NativeBlockExit::ScalarBoundary) || run.remainingCycles != remaining || run.registerTop != top) {
				std::cerr << "register graph helper=" << helper << " bypass=" << bypassHelper << " entry=" << entry << " arm=" << arm
					<< " loop=" << loop << " grant=" << grant << '\n';
				throw std::runtime_error("diamond/backedge allocation must preserve the full raw bank, exit, debt and top");
			}
		}
	}
}

void linkedBodiesShareOneFrameAndRetireTheirEdges() {
	NativeBlockRunState nativeRunState;
	std::array<DecodedInstruction, 5> decoded{};
	const std::array ops{OpCode::ADD, OpCode::JMPIF, OpCode::SHL, OpCode::ADD, OpCode::JMP};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1; decoded[i].baseCycles = 1;
	}
	decoded[0].a = 7; decoded[0].b = 0; decoded[0].c = -1;
	decoded[1].a = 2; decoded[1].setBx(0x1080);
	decoded[2].a = 0; decoded[2].b = 7; decoded[2].c = -1;
	decoded[3].a = 3; decoded[3].b = 0; decoded[3].c = 7;
	decoded[4].setBx(0x1000);
	const std::array firstSource{NativeBlockInstruction{&decoded[0], 0x1000}, NativeBlockInstruction{&decoded[1], 0x1004}};
	const std::array secondSource{NativeBlockInstruction{&decoded[2], 0x1080}, NativeBlockInstruction{&decoded[3], 0x1084},
		NativeBlockInstruction{&decoded[4], 0x1088}};
	const std::array constants{valueInteger(1)};
	const auto constantsBank = test::valueBank(constants);
	auto first = test::compileNative(firstSource, memory, cpu.stringPool());
	auto second = test::compileNative(secondSource, memory, cpu.stringPool());
	const std::weak_ptr<NativeCodeRegion> firstRegion = first->region, secondRegion = second->region;
	second->linkFrom(first->sideExits.back()); first->linkFrom(second->terminal);
	for (const int budget : {2, 3, 4, 5, 6, 7, 11, 127, 500002}) {
		std::array<Value, 8> initial{}; initial.fill(valueNil());
		initial[0] = valueInteger(1); initial[2] = valueBool(true);
		auto expected = initial;
		auto registers = test::valueBank(initial);
		int remaining = budget;
		bool inFirst = true;
		const NativeBlockExitSite* expectedExit;
		for (;;) {
			if (remaining <= (inFirst ? first->admissionCycles : second->admissionCycles)) { expectedExit = nullptr; break; }
			if (inFirst) {
				expected[7] = valueAdd(expected[0], valueInteger(1)); --remaining;
				--remaining; expectedExit = &first->sideExits.back();
			} else {
				expected[0] = valueInteger(static_cast<i32>(valuePayload(expected[7]) << 1u)); --remaining;
				expected[3] = valueAdd(expected[0], expected[7]); --remaining;
				--remaining; expectedExit = &second->terminal;
			}
			inFirst = !inFirst;
			if (remaining <= 0) break;
		}
		const auto result = first->run(registers.view(), nativeRunState = {.constants = constantsBank.view(), .remainingCycles = budget});
		require((expectedExit ? result == expectedExit : result->exit == NativeBlockExit::ScalarBoundary) && nativeRunState.remainingCycles == remaining && nativeRunState.registerTop == 8 && test::matchesValues(registers.view(), expected),
			"linked leaf/calling bodies share one frame, bounded stack, complete segment charges and the maximum live-register extent");
	}
	second->linkFrom(first->terminal);
	ValueSlots registers(8); registers.set(0, valueInteger(1)); registers.set(2, valueBool(false));
	require(first->run(registers.view(), nativeRunState = {.constants = constantsBank.view(), .remainingCycles = 5}) == &second->terminal && registers.get(0) == valueInteger(4),
		"both conditional exits can link independently to the same target");
	first->terminal.link.disconnect();
	require(first->sideExits.back().link.target == second.get(), "unlinking one incoming edge preserves the other");
	second.reset();
	require(secondRegion.expired() && !firstRegion.expired(), "retiring a linked target releases only its own executable allocation");
	require(!first->sideExits.back().link.target,
		"retiring a target disconnects each surviving source before executable storage is freed");
	registers.set(2, valueBool(true));
	require(first->run(registers.view(), nativeRunState = {.constants = constantsBank.view(), .remainingCycles = 1000}) == &first->sideExits.back(),
		"an unlinked predecessor returns normally instead of entering retired native code");
	first->linkFrom(first->sideExits.back());
	first.reset();
	require(firstRegion.expired(), "a self-link does not retain its executable region");
}

void linkedAtomicStoreDebitsItsWholeChargeBeforeTestingItsSuccessor() {
	std::array<DecodedInstruction, 4> decoded{};
	const std::array ops{OpCode::K1, OpCode::JMP, OpCode::STORE_MEM_WORDS, OpCode::K1};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1; decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
	}
	decoded[0].a = 6; decoded[1].setBx(0x1080);
	decoded[2].width = 2; decoded[2].a = 8; decoded[2].b = 0; decoded[2].c = 5;
	decoded[3].a = 7;
	const std::array prefix{NativeBlockInstruction{&decoded[0], 0x1000}, NativeBlockInstruction{&decoded[1], 0x1004}};
	const std::array span{NativeBlockInstruction{&decoded[2], 0x1080}};
	const std::array successor{NativeBlockInstruction{&decoded[3], 0x1088}};
	auto first = test::compileNative(prefix, memory, cpu.stringPool());
	auto second = test::compileNative(span, memory, cpu.stringPool());
	auto third = test::compileNative(successor, memory, cpu.stringPool());
	require(first->terminal.link.patchAddress && second->terminal.link.patchAddress,
		"plain spans have a native completion edge for the following segment");
	second->linkFrom(first->terminal); third->linkFrom(second->terminal);
	const int prefixCycles = decoded[0].baseCycles + decoded[1].baseCycles;
	const int spanCycles = decoded[2].baseCycles + 5;
	require(second->terminal.cycles == spanCycles,
		"segment entry needs positive budget and retains the complete atomic store charge");
	constexpr u32 target = DYNAMIC_RAM_BASE + 0x80000u;
	for (int budget : {prefixCycles, prefixCycles + 1, prefixCycles + spanCycles, prefixCycles + spanCycles + 1}) {
		ValueSlots registers(13);
		registers.set(0, valueInteger(target)); registers.set(7, valueInteger(99));
		for (u32 i = 0; i < 5; ++i) { registers.set(8 + i, valueInteger(73u + i)); memory.writeMappedWord(target + i * 4u, 0); }
		NativeBlockRunState state{.remainingCycles = budget};
		const auto* exit = first->run(registers.view(), state);
		const bool prefixOnly = budget == prefixCycles;
		const bool successorRuns = budget > prefixCycles + spanCycles;
		const auto* expected = prefixOnly ? &first->terminal : successorRuns ? &third->terminal : &second->terminal;
		const int charge = prefixCycles + (prefixOnly ? 0 : spanCycles) + (successorRuns ? decoded[3].baseCycles : 0);
		require(exit == expected && state.remainingCycles == budget - charge
			&& registers.get(6) == valueInteger(1) && registers.get(7) == valueInteger(successorRuns ? 1 : 99)
			&& state.registerTop == (successorRuns ? 8 : 7),
			"linked native bodies finish the counted store but never start a successor without positive budget");
		for (u32 i = 0; i < 5; ++i) require(memory.readMappedWord(target + i * 4u) == (prefixOnly ? 0u : 73u + i),
			"a short positive grant commits the complete ordered RAM span");
	}
}

void linkedSlowExitPublishesTheWholeExecutedChain() {
	NativeBlockRunState nativeRunState;
	std::array<DecodedInstruction, 5> decoded{};
	const std::array ops{OpCode::K1, OpCode::JMP, OpCode::ADD, OpCode::LOAD_MEM, OpCode::ADD};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1; decoded[i].baseCycles = 1;
	}
	decoded[0].a = 7; decoded[1].setBx(0x1080);
	decoded[2].a = 5; decoded[2].b = 7; decoded[2].c = 7;
	decoded[3].a = 4; decoded[3].b = 1; decoded[3].c = static_cast<i16>(MemoryAccessKind::U32LE); decoded[3].baseCycles = 2;
	decoded[4].a = 6; decoded[4].b = 4; decoded[4].c = 0;
	const std::array firstSource{NativeBlockInstruction{&decoded[0], 0x1000}, NativeBlockInstruction{&decoded[1], 0x1004}};
	const std::array secondSource{NativeBlockInstruction{&decoded[2], 0x1080}, NativeBlockInstruction{&decoded[3], 0x1084},
		NativeBlockInstruction{&decoded[4], 0x1088}};
	auto first = test::compileNative(firstSource, memory, cpu.stringPool());
	auto second = test::compileNative(secondSource, memory, cpu.stringPool());
	const std::weak_ptr<NativeCodeRegion> firstRegion = first->region, secondRegion = second->region;
	second->linkFrom(first->terminal);
	ValueSlots registers(8);
	registers.set(1, valueInteger(IO_SYS_BUS_FAULT_CODE)); registers.set(6, valueInteger(73));
	const auto result = first->run(registers.view(), nativeRunState = {.remainingCycles = 100});
	require(result->exit == NativeBlockExit::ReadMemory
		&& result->currentPc == 0x1084 && result->nextPc == 0x1088 && nativeRunState.remainingCycles == 95
		&& nativeRunState.registerTop == 8 && registers.get(5) == valueInteger(2) && registers.get(6) == valueInteger(73) && registers.get(4) == valueNil(),
		"a target's slow exit materializes the complete chain prefix without executing its load or later arithmetic");
	first.reset();
	// The surviving target must not retain an incoming node in the freed source.
	second.reset();
	require(firstRegion.expired() && secondRegion.expired(), "a slow exit does not retain the linked regions");
}

void comparisonDatapathsRespectEveryValueKind() {
	NativeBlockRunState nativeRunState;
	auto& strings = cpu.stringPool();
	auto& heap = cpu.gcHeap();
	const u32 firstClosure = heap.budget.allocateClosureRecord(0);
	ClosureRecord::initialize(heap.memory, firstClosure, {}, heap.white(), 0, false, false);
	const u32 secondClosure = heap.budget.allocateClosureRecord(0);
	ClosureRecord::initialize(heap.memory, secondClosure, {}, heap.white(), 0, false, false);
	const std::array values{valueNil(), valueFromTag(ValueTag::Nil, 37), valueBool(false),
		valueFromTag(ValueTag::False, 37), valueBool(true), valueFromTag(ValueTag::True, 37),
		valueInteger(0), valueFloat(-0.0), valueInteger(1), valueInteger(-1), valueFloat(0.25),
		valueFloatBits(BLUA32_FLOAT_NAN), valueFloatBits(0x7fc0002au), valueFloatBits(0x7f800001u), valueFloatBits(0xff800001u),
		valueFloat(std::numeric_limits<float>::infinity()), valueFloat(-std::numeric_limits<float>::infinity()),
		valueString(strings.intern("")), valueString(strings.intern("a")),
		valueString(strings.intern(std::string_view("a\0b", 3))),
		valueString(strings.intern("\xee\x80\x80")), valueString(strings.intern("\xf0\x90\x80\x80")),
		valueTable(cpu.createTable().address()), valueTable(cpu.createTable().address()), valueClosure(firstClosure), valueClosure(secondClosure),
		valueFromTag(ValueTag::Table, 37), valueFromTag(ValueTag::Table, 0x80000025u),
		valueFromTag(ValueTag::BuiltinFunction, 37), valueFromTag(ValueTag::BuiltinFunction, 0x80000025u),
		valueThread(cpu.activeThread()->address), valueThread(cpu.activeThread()->address - THREAD_HEAP_BYTES), valueBuiltinFunction(BuiltinFunctionId::Type),
		valueBuiltinFunction(BuiltinFunctionId::Next)};
	for (const auto op : {OpCode::EQ, OpCode::LT, OpCode::LE}) for (const bool expected : {false, true}) {
		DecodedInstruction compare;
		compare.op = static_cast<u8>(op); compare.a = expected ? 0x3fffu : 0u; compare.width = 2; compare.baseCycles = 1;
		for (const Value left : values) for (const Value right : values) for (u32 constants = 0; constants < 4; ++constants) {
			bool predicate = false;
			if (op == OpCode::EQ) predicate = valuesEqual(left, right);
			else if (valueIsNumber(left) && valueIsNumber(right)) predicate = op == OpCode::LT
				? compareNumbers(left, right) == NumericOrder::Less : static_cast<int>(compareNumbers(left, right)) <= 0;
			else if (valueIsString(left) && valueIsString(right)) {
				const int order = strings.toString(asStringId(left)).compare(strings.toString(asStringId(right)));
				predicate = op == OpCode::LT ? order < 0 : order <= 0;
			}
			compare.b = (constants & 1) != 0 ? -1 : 0;
			compare.c = (constants & 2) != 0 ? -2 : 1;
			const std::array source{NativeBlockInstruction{&compare, 0x1000}};
			const std::array pool{left, right};
			const auto poolBank = test::valueBank(pool);
			auto registers = test::valueBank(pool);
			auto block = test::compileNative(source, memory, strings);
			const auto* exit = block->run(registers.view(), nativeRunState = {.constants = poolBank.view(), .remainingCycles = block->terminal.cycles});
			require((exit->exit == NativeBlockExit::SkipInstruction) == (predicate != expected)
				&& test::matchesValues(registers.view(), pool) && exit->registerTop == 0 && exit->cycles == 1
				&& exit->nextPc == 0x1008 && exit->currentPc == 0x1000 && exit->lastPc == 0x1004,
				"native EQ/LT/LE preserve kind rules, RK sources, NaNs, UTF-8 order and non-destination A flags");
		}
	}
}

Value evaluate(OpCode op, Value left, Value right) {
	switch (op) {
		case OpCode::ADD: return valueAdd(left, right);
		case OpCode::SUB: return valueSubtract(left, right);
		case OpCode::MUL: return valueMultiply(left, right);
		case OpCode::DIV: return valueDivide(left, right);
		case OpCode::MOD: return valueModulo(left, right);
		case OpCode::FLOORDIV: return valueFloorDivide(left, right);
		case OpCode::POW: return valuePower(left, right);
		case OpCode::UNM: return valueNegate(left);
		case OpCode::BAND: return valueInteger(integerOperand(left) & integerOperand(right));
		case OpCode::BOR: return valueInteger(integerOperand(left) | integerOperand(right));
		case OpCode::BXOR: return valueInteger(integerOperand(left) ^ integerOperand(right));
		case OpCode::SHL: return valueInteger(luaShiftLeft(integerOperand(left), integerOperand(right)));
		case OpCode::SHR: return valueInteger(luaShiftRight(integerOperand(left), integerOperand(right)));
		case OpCode::BNOT: return valueInteger(~integerOperand(left));
		default: BMSX_UNREACHABLE();
	}
}

void arithmeticAndWordDatapaths() {
	NativeBlockRunState nativeRunState;
	const std::array values{
		valueInteger(0), valueFloat(-0.0), valueInteger(1), valueInteger(-1),
		valueFloat(0.25), valueFloat(-0.75), valueFloat(31.0), valueFloat(32.0),
		valueInteger(10), valueFloat(0.05), valueInteger(2), valueFloat(1.0 / 12.0),
		valueFloatBits(0x3f800001u), valueInteger(16777217),
		valueInteger(INT32_MAX), valueFloat(2147483648.0), valueFloat(4294967295.0),
		valueInteger(INT32_MIN), valueFloatBits(0xcf000001u), valueFloatBits(0x4f000001u),
		valueFloatBits(0x7f7fffffu), valueFloatBits(0xff7fffffu), valueFloatBits(1u),
		valueFloat(std::numeric_limits<float>::infinity()), valueFloat(-std::numeric_limits<float>::infinity()),
		valueFloatBits(BLUA32_FLOAT_NAN), valueFloatBits(0x7f800001u), valueNil(), valueBool(false),
		valueBool(true), valueString(0x12345678u), valueFromTag(ValueTag::Table, 0x1234u),
	};
	for (const auto op : {OpCode::ADD, OpCode::SUB, OpCode::MUL, OpCode::DIV, OpCode::MOD, OpCode::FLOORDIV, OpCode::POW,
		OpCode::BAND, OpCode::BOR, OpCode::BXOR, OpCode::SHL, OpCode::SHR, OpCode::UNM, OpCode::BNOT}) {
		for (const Value left : values) for (const Value right : values) {
			for (const bool constants : {false, true}) for (const u16 destination : {u16{0}, u16{1}, u16{2}}) {
				const bool unary = op == OpCode::UNM || op == OpCode::BNOT;
				DecodedInstruction operation;
				operation.op = static_cast<u8>(op);
				operation.width = 2;
				operation.baseCycles = BASE_CYCLES[operation.op];
				operation.a = destination;
				operation.b = constants && !unary ? -1 : 0;
				operation.c = constants ? -2 : 1;
				DecodedInstruction move;
				move.op = static_cast<u8>(OpCode::MOV);
				move.width = move.baseCycles = 1;
				move.a = 3;
				move.b = static_cast<i16>(destination);
				const std::array instructions{NativeBlockInstruction{&operation, 0x1000u},
					NativeBlockInstruction{&move, 0x1008u}};
				const std::array pool{left, right};
				const auto poolBank = test::valueBank(pool);
				auto registers = test::valueBank(std::array{left, right, valueNil(), valueNil()});
				auto block = test::compileNative(instructions, memory, cpu.stringPool());
				const auto* exit = block->run(registers.view(), nativeRunState = {.constants = poolBank.view(), .remainingCycles = block->terminal.cycles});
				try {
					const Value expected = evaluate(op, left, right);
					require(exit == &block->terminal && nativeRunState.remainingCycles == 0
						&& registers.get(destination) == expected && registers.get(3) == expected,
						"native arithmetic retains exact number/word semantics and register aliases");
				} catch (const LuaExecutionError& error) {
					require(error.reason == LUA_FAULT_REASON_INVALID_ARGUMENT && exit->exit == NativeBlockExit::InvalidOperand
						&& exit->currentPc == 0x1000u && nativeRunState.remainingCycles == 1 && nativeRunState.registerTop == 0
						&& test::matchesValues(registers.view(), std::array{left, right, valueNil(), valueNil()}),
						"an invalid operand charges only the attempted operation and commits neither destination");
				}
				require(block->terminal.cycles == operation.baseCycles + 1 && block->terminal.registerTop == 4
					&& block->terminal.currentPc == 0x1008u && block->terminal.lastPc == 0x1008u
					&& block->terminal.nextPc == 0x100cu, "native block publishes its physical instruction extent");
			}
		}
	}
}

void provenOperandFaultNeedsOnlyItsOwnGrant() {
	constexpr u32 pc = 0x1300;
	for (const auto op : {OpCode::ADD, OpCode::MOV}) {
		std::array decoded{
			DecodedInstruction{.a = 1, .op = static_cast<u8>(OpCode::KFALSE)},
			DecodedInstruction{.a = 5, .b = 1, .c = 2, .op = static_cast<u8>(op)},
			DecodedInstruction{.a = 6, .b = 2, .op = static_cast<u8>(OpCode::LEN)},
		};
		for (auto& row : decoded) { row.width = 1; row.baseCycles = BASE_CYCLES[row.op]; }
		decoded[1].width = 2;
		const std::array source{NativeBlockInstruction{&decoded[0], pc},
			NativeBlockInstruction{&decoded[1], pc + 4}, NativeBlockInstruction{&decoded[2], pc + 12}};
		const auto block = test::compileNative(source, memory, cpu.stringPool());
		ValueSlots registers(7);
		registers.set(1, valueInteger(3));
		registers.set(5, valueInteger(5));
		registers.set(6, valueInteger(6));
		const int prefix = decoded[0].baseCycles;
		NativeBlockRunState state{.remainingCycles = prefix};
		const auto* replay = block->run(registers.view(), state);
		require(replay->exit == NativeBlockExit::ScalarBoundary && replay->nextPc == pc
			&& state.remainingCycles == prefix && registers.get(1) == valueInteger(3),
			"a grant ending before the WIDE fault replays before any native work");
		state.remainingCycles = prefix + 1;
		const auto* fault = block->run(registers.view(), state);
		require(fault == &block->terminal && fault->exit == NativeBlockExit::InvalidOperand
			&& fault->currentPc == pc + 4 && fault->lastPc == pc + 8 && fault->nextPc == pc + 12
			&& state.remainingCycles == 1 - decoded[1].baseCycles && state.registerTop == 2
			&& registers.get(1) == valueBool(false) && registers.get(5) == valueInteger(5)
			&& registers.get(6) == valueInteger(6),
			"the positive grant at a proven WIDE fault charges only the attempted instruction and publishes its prefix");
	}
}

void wordProducerFactsPreserveRawValuesAndOverwrites() {
	const std::array inputs{valueInteger(0x12345678), valueInteger(INT32_MIN), valueInteger(-1), valueFloat(-0.0), valueFloat(0.75), valueFloat(-1.75),
		valueInteger(INT32_MAX), valueFloat(2147483648.0), valueFloat(4294967295.0),
		valueFloat(4294967301.0), valueFloat(-2147483649.0), valueFloat(-4294967296.75),
		valueFloat(std::numeric_limits<float>::infinity()), valueFloatBits(0x7fc0002au),
		valueFloatBits(0x7f800001u), valueNil(), valueFromTag(ValueTag::False, 37),
		valueString(73), valueFromTag(ValueTag::Table, 0x80000001u)};
	const std::array ops{OpCode::LOADK, OpCode::MOV, OpCode::MOV, OpCode::BAND, OpCode::MOV,
		OpCode::BNOT, OpCode::SHL, OpCode::SHR, OpCode::ADD, OpCode::BXOR, OpCode::MOV,
		OpCode::BAND, OpCode::LOADNIL, OpCode::BNOT, OpCode::JMP};
	const std::array<std::array<i16, 3>, 15> operands{{
		{0, 0, 0}, {14, 0, 0}, {1, 0, 0}, {2, 1, -2}, {2, 2, 0},
		{3, 2, 0}, {4, 3, -4}, {5, 4, -4}, {2, 2, -3}, {6, 2, -2},
		{2, 13, 0}, {7, 2, -2}, {0, 3, 0}, {8, 14, 0}, {0, 0, 0},
	}};
	std::array<DecodedInstruction, 15> decoded{};
	std::array<NativeBlockInstruction, 15> source{};
	for (size_t i = 0; i < ops.size(); ++i) {
		auto& op = decoded[i]; op.op = static_cast<u8>(ops[i]); op.width = op.baseCycles = 1;
		op.a = operands[i][0]; op.b = operands[i][1]; op.c = operands[i][2];
		source[i] = {&op, 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	decoded.back().setBx(0x2000);
	for (const auto constant : inputs) {
		const std::array constants{constant, valueInteger(-1), valueInteger(7), valueInteger(31)};
		const auto constantsBank = test::valueBank(constants);
		auto block = test::compileNative(source, memory, cpu.stringPool());
		for (const auto incoming : inputs) for (const int grant : {1, 15, 100}) {
			std::array<Value, 16> initial; initial.fill(valueFromTag(ValueTag::True, 53)); initial[13] = incoming;
			auto expected = initial;
			auto actual = test::valueBank(initial);
			int remaining = grant, top = 0;
			u32 faultPc = 0;
			const NativeBlockExitSite* expectedExit = remaining <= block->admissionCycles ? nullptr : &block->terminal;
			for (size_t index = 0; expectedExit && index < decoded.size(); ++index) {
				const auto& op = decoded[index];
				const auto operand = [&](int selector) { return selector < 0 ? constants[-selector - 1] : expected[selector]; };
				const auto kind = static_cast<OpCode>(op.op);
				remaining -= op.baseCycles;
				if (kind == OpCode::LOADK) expected[op.a] = constants[op.bx()];
				else if (kind == OpCode::MOV) expected[op.a] = operand(op.b);
				else if (kind == OpCode::LOADNIL) { std::fill_n(expected.begin() + op.a, op.b, valueNil()); remaining -= op.b; }
				else if (kind != OpCode::JMP) {
					try { expected[op.a] = evaluate(kind, operand(op.b), operand(op.c)); }
					catch (const LuaExecutionError& error) {
						require(error.reason == LUA_FAULT_REASON_INVALID_ARGUMENT, "word operation operand fault");
						faultPc = source[index].pc;
						break;
					}
				}
				if (kind == OpCode::LOADNIL) top = std::max(top, static_cast<int>(op.a + op.b));
				else if (kind != OpCode::JMP) top = std::max(top, static_cast<int>(op.a) + 1);
			}
			NativeBlockRunState state{.constants = constantsBank.view(), .remainingCycles = grant};
			const auto* exit = block->run(actual.view(), state);
			require((faultPc ? exit->exit == NativeBlockExit::InvalidOperand && exit->currentPc == faultPc
				: expectedExit ? exit == expectedExit : exit->exit == NativeBlockExit::ScalarBoundary) && test::matchesValues(actual.view(), expected) && state.registerTop == top
				&& state.remainingCycles == remaining,
				"word producer facts preserve full raw state through MOV aliases, signed chains, arithmetic/unknown overwrites and nil ranges");
		}
	}
}

void movesAndLiteralsPreserveRawValues() {
	NativeBlockRunState nativeRunState;
	const std::array pool{valueNil(), valueBool(false), valueBool(true), valueString(0x12345678u),
		valueFromTag(ValueTag::Table, 0x1234u), valueFloatBits(0xff800001u), valueFloat(-0.0)};
	const auto poolBank = test::valueBank(pool);
	for (u32 index = 0; index < pool.size(); ++index) {
		DecodedInstruction load;
		load.op = static_cast<u8>(OpCode::LOADK);
		load.width = load.baseCycles = 1;
		load.setBx(index);
		DecodedInstruction move;
		move.op = static_cast<u8>(OpCode::MOV);
		move.width = move.baseCycles = 1;
		move.a = 1;
		const std::array instructions{NativeBlockInstruction{&load, 0x1000}, NativeBlockInstruction{&move, 0x1004}};
		auto block = test::compileNative(instructions, memory, cpu.stringPool());
		auto registers = test::valueBank(std::array{Value{0}, Value{0}});
		block->run(registers.view(), nativeRunState = {.constants = poolBank.view(), .remainingCycles = block->terminal.cycles});
		require(registers.get(0) == pool[index] && registers.get(1) == pool[index], "moves preserve every raw tagged and number bit");
	}
	for (const auto op : {OpCode::KNIL, OpCode::KFALSE, OpCode::KTRUE, OpCode::K0, OpCode::K1, OpCode::KM1, OpCode::KSMI}) {
		DecodedInstruction load;
		load.op = static_cast<u8>(op);
		load.width = 2;
		load.baseCycles = 1;
		load.setSbx(-33554432);
		const std::array instructions{NativeBlockInstruction{&load, 0x1000}};
		auto block = test::compileNative(instructions, memory, cpu.stringPool());
		ValueSlots reg(1);
		block->run(reg.view(), nativeRunState = {.constants = poolBank.view(), .remainingCycles = block->terminal.cycles});
		const Value expected = op == OpCode::KNIL ? valueNil() : op == OpCode::KFALSE ? valueBool(false)
			: op == OpCode::KTRUE ? valueBool(true) : op == OpCode::K0 ? valueInteger(0)
			: op == OpCode::K1 ? valueInteger(1) : op == OpCode::KM1 ? valueInteger(-1) : valueInteger(-33554432);
		require(reg.get(0) == expected && block->terminal.lastPc == 0x1004 && block->terminal.currentPc == 0x1000,
			"literal blocks retain raw tags and distinguish WIDE prefix and body PCs");
	}
}

void pinnedOperandsSurviveColdReadsAndDestinationReuse() {
	const std::array values{valueFloat(-0.0), valueFloat(3.5), valueFloat(-17.25),
		valueFloat(std::numeric_limits<float>::infinity()), valueFloatBits(BLUA32_FLOAT_NAN),
		valueString(0x12345678u), valueFloatBits(0xff800001u)};
	for (const bool helper : {false, true}) for (const bool coldLeft : {false, true}) {
		for (const auto op : {OpCode::MOV, OpCode::ADD, OpCode::SUB, OpCode::MUL, OpCode::DIV, OpCode::UNM}) {
			for (const u16 destination : {u16{0}, u16{1}, u16{4}, u16{5}}) for (const Value value : values) {
				const std::array pool{value, valueInteger(2), valueInteger(3), valueInteger(4)};
				const auto poolBank = test::valueBank(pool);
				std::array<Value, 8> initial; initial.fill(valueNil()); initial[4] = valueFloat(0.25);
				auto expected = initial;
				auto registers = test::valueBank(initial);
				std::array<DecodedInstruction, 7> decoded{};
				std::array<NativeBlockInstruction, 7> source{};
				for (u16 i = 0; i < 4; ++i) {
					decoded[i].op = static_cast<u8>(OpCode::LOADK); decoded[i].a = i; decoded[i].setBx(i);
					expected[i] = pool[i];
				}
				auto& operation = decoded[4]; operation.op = static_cast<u8>(op); operation.a = destination;
				operation.b = coldLeft ? 4 : 0; operation.c = op == OpCode::MOV || coldLeft ? 0 : 4;
				bool invalid = false;
				try {
					expected[destination] = op == OpCode::MOV ? expected[operation.b]
						: evaluate(op, expected[operation.b], expected[operation.c]);
				} catch (const LuaExecutionError& error) {
					require(error.reason == LUA_FAULT_REASON_INVALID_ARGUMENT, "aliased numeric operand fault");
					invalid = true;
				}
				decoded[5].op = static_cast<u8>(helper ? OpCode::MOD : OpCode::MOV);
				decoded[5].a = 7; decoded[5].b = helper ? -2 : destination; decoded[5].c = helper ? -3 : 0;
				if (!invalid) expected[7] = helper ? valueInteger(2) : expected[destination];
				decoded[6].op = static_cast<u8>(OpCode::MOV); decoded[6].a = 6; decoded[6].b = destination;
				if (!invalid) expected[6] = expected[destination];
				for (u32 i = 0; i < decoded.size(); ++i) {
					decoded[i].width = 1; decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
					source[i] = {&decoded[i], 0x1000u + i * INSTRUCTION_BYTES};
				}
				auto block = test::compileNative(source, memory, cpu.stringPool());
				NativeBlockRunState state{.constants = poolBank.view(), .remainingCycles = block->terminal.cycles};
				const auto* exit = block->run(registers.view(), state);
				require((invalid ? exit->exit == NativeBlockExit::InvalidOperand && exit->currentPc == source[4].pc
					&& state.registerTop == 4 && state.remainingCycles == decoded[5].baseCycles + decoded[6].baseCycles
					: exit == &block->terminal && state.remainingCycles == 0) && test::matchesValues(registers.view(), expected),
					"cold inputs cannot clobber pinned operands, aliased destinations or live values across a helper ABI call");
			}
		}
	}
}

void nextAccessPressurePreservesEveryRawGuestSlot() {
	const std::array raw{valueFloatBits(0x7fc0002au), valueFloat(-0.0),
		valueFromTag(ValueTag::False, 73), valueString(0xfedcba98u),
		valueFromTag(ValueTag::Table, 0x80000001u), valueFromTag(ValueTag::BuiltinFunction, 91)};
	const std::array<int, 15> reads{0, 1, 0, 2, 0, 3, 0, 4, 0, 1, 0, 2, 0, 3, 0};
	for (const int base : {0, 512}) for (const bool helper : {false, true}) {
		std::array<DecodedInstruction, 28> decoded{};
		std::array<NativeBlockInstruction, 28> source{};
		for (int index = 0; index < 5; ++index) {
			decoded[index].op = static_cast<u8>(OpCode::LOADK);
			decoded[index].a = base + index; decoded[index].setBx(index);
		}
		// The oldest definitions are repeatedly needed sooner than recent ones.
		// Destinations remain observable even when they have no later reader.
		for (size_t index = 0; index < reads.size(); ++index) {
			auto& op = decoded[5 + index]; op.op = static_cast<u8>(OpCode::MOV);
			op.a = base + 5 + index % 5; op.b = base + reads[index];
		}
		decoded[20].op = static_cast<u8>(OpCode::MOV); decoded[20].a = base; decoded[20].b = base;
		decoded[21].op = static_cast<u8>(OpCode::LOADNIL); decoded[21].a = base; decoded[21].b = 0;
		decoded[22].op = static_cast<u8>(OpCode::MOV); decoded[22].a = base + 10; decoded[22].b = base;
		decoded[23].op = static_cast<u8>(OpCode::LOADNIL); decoded[23].a = base + 1; decoded[23].b = 3;
		decoded[24].op = static_cast<u8>(OpCode::MOV); decoded[24].a = base + 11; decoded[24].b = base + 2;
		decoded[25].op = static_cast<u8>(helper ? OpCode::MOD : OpCode::ADD);
		decoded[25].a = base + 12; decoded[25].b = -6; decoded[25].c = -7;
		decoded[26].op = static_cast<u8>(OpCode::MOV); decoded[26].a = base + 13; decoded[26].b = base;
		decoded[27].op = static_cast<u8>(OpCode::JMP); decoded[27].setBx(0x1800u);
		for (size_t index = 0; index < decoded.size(); ++index) {
			decoded[index].width = base == 0 ? 1 : 2;
			decoded[index].baseCycles = BASE_CYCLES[decoded[index].op];
			source[index] = {&decoded[index], 0x1000u + static_cast<u32>(index) * decoded[index].width * INSTRUCTION_BYTES};
		}
		for (size_t rotation = 0; rotation < raw.size(); ++rotation) {
			std::array<Value, 7> constants;
			for (size_t index = 0; index < 5; ++index) constants[index] = raw[(index + rotation) % raw.size()];
			constants[5] = valueInteger(17); constants[6] = valueInteger(3);
			const auto constantsBank = test::valueBank(constants);
			std::array<Value, 526> initial; initial.fill(raw[rotation]);
			auto expected = initial;
			int cycles = 0, top = -7;
			for (size_t prefix = 1; prefix <= source.size(); ++prefix) {
				const auto& op = decoded[prefix - 1]; cycles += op.baseCycles;
				if (op.op == static_cast<u8>(OpCode::LOADNIL)) cycles += op.b;
				switch (static_cast<OpCode>(op.op)) {
					case OpCode::LOADK: expected[op.a] = constants[op.bx()]; break;
					case OpCode::MOV: expected[op.a] = expected[op.b]; break;
					case OpCode::LOADNIL:
						for (int index = op.a; index < op.a + op.b; ++index) expected[index] = valueNil();
						break;
					case OpCode::ADD: expected[op.a] = valueInteger(20); break;
					case OpCode::MOD: expected[op.a] = valueInteger(2); break;
					case OpCode::JMP: break;
					default: throw std::runtime_error("unexpected pressure fixture instruction");
				}
				if (op.op == static_cast<u8>(OpCode::LOADNIL)) {
					if (op.b != 0) top = std::max(top, static_cast<int>(op.a) + op.b);
				} else if (op.op != static_cast<u8>(OpCode::JMP)) top = std::max(top, static_cast<int>(op.a) + 1);
				auto block = test::compileNative(std::span(source).first(prefix), memory, cpu.stringPool());
				for (const int grant : {cycles, cycles + 7}) {
					auto actual = test::valueBank(initial);
					NativeBlockRunState state{.constants = constantsBank.view(),
						.remainingCycles = grant, .registerTop = -7};
					require(block->run(actual.view(), state) == &block->terminal && test::matchesValues(actual.view(), expected)
						&& state.remainingCycles == grant - cycles && state.registerTop == top,
						"next-access eviction preserves every raw WIDE register, alias, empty/ranged write and helper prefix");
				}
				if (prefix > 1) {
					auto actual = test::valueBank(initial);
					NativeBlockRunState state{.constants = constantsBank.view(),
						.remainingCycles = 1, .registerTop = -7};
					const auto* exit = block->run(actual.view(), state);
					require(exit->exit == NativeBlockExit::ScalarBoundary && test::matchesValues(actual.view(), initial)
						&& state.remainingCycles == 1 && state.registerTop == -7,
						"a short pressure grant exits before its first definition for scalar admission");
				}
			}
		}
	}
}

void dependentInstructionsWriteBackEveryLiveRegister() {
	NativeBlockRunState nativeRunState;
	const std::array pool{valueInteger(INT32_MIN), valueInteger(16777217), valueFloat(-0.0), valueFloat(0.25), valueFloat(-4294967296.75),
		valueFloat(std::numeric_limits<float>::infinity()), valueFloatBits(BLUA32_FLOAT_NAN), valueNil(), valueBool(false),
		valueBool(true), valueString(0x12345678u), valueFromTag(ValueTag::Table, 0x1234u),
		valueFloatBits(0x7f800001u), valueFloatBits(0xff800001u)};
	const auto poolBank = test::valueBank(pool);
	const std::array operations{OpCode::ADD, OpCode::SUB, OpCode::MUL, OpCode::DIV, OpCode::MOD, OpCode::FLOORDIV, OpCode::POW,
		OpCode::BAND, OpCode::BOR, OpCode::BXOR, OpCode::SHL, OpCode::SHR, OpCode::UNM, OpCode::BNOT,
		OpCode::MOV, OpCode::LOADK, OpCode::KNIL, OpCode::KFALSE, OpCode::KTRUE,
		OpCode::K0, OpCode::K1, OpCode::KM1, OpCode::KSMI, OpCode::NOT};
	u32 random = 0x915acd38u;
	auto next = [&]() {
		random ^= random << 13u; random ^= random >> 17u; random ^= random << 5u;
		return random;
	};
	for (u32 program = 0; program < 128; ++program) {
		std::array<Value, 8> initial;
		for (auto& reg : initial) reg = pool[next() % pool.size()];
		auto expected = initial;
		std::array<DecodedInstruction, 33> decoded{};
		std::array<NativeBlockInstruction, 33> source{};
		u16 previous = 0;
		for (u32 index = 0; index < 32; ++index) {
			auto& instruction = decoded[index];
			const auto op = operations[next() % operations.size()];
			instruction.op = static_cast<u8>(op);
			instruction.width = index % 5 == 0 ? 2 : 1;
			instruction.baseCycles = BASE_CYCLES[instruction.op];
			instruction.a = index % 3 == 0 ? previous : next() & 7u;
			instruction.b = index % 3 == 0 ? previous : next() & 7u;
			instruction.c = index % 3 == 1 ? previous : next() & 7u;
			if (op == OpCode::MOV) instruction.c = 0;
			if (op == OpCode::LOADK) instruction.setBx(next() % pool.size());
			if (op == OpCode::KSMI) instruction.setSbx(static_cast<i32>(next() & 0x3ffffffu) - 0x2000000);
			const bool binary = op >= OpCode::ADD && op <= OpCode::SHR;
			if (binary && (next() & 3u) == 0) instruction.b = -static_cast<i16>(1 + next() % pool.size());
			if (binary && (next() & 3u) == 0) instruction.c = -static_cast<i16>(1 + next() % pool.size());
			const auto operand = [&](int selector) { return selector < 0 ? pool[-selector - 1] : expected[selector]; };
			bool invalid = false;
			switch (op) {
				case OpCode::MOV: expected[instruction.a] = expected[instruction.b]; break;
				case OpCode::LOADK: expected[instruction.a] = pool[instruction.bx()]; break;
				case OpCode::KNIL: expected[instruction.a] = valueNil(); break;
				case OpCode::KFALSE: expected[instruction.a] = valueBool(false); break;
				case OpCode::KTRUE: expected[instruction.a] = valueBool(true); break;
				case OpCode::K0: expected[instruction.a] = valueInteger(0); break;
				case OpCode::K1: expected[instruction.a] = valueInteger(1); break;
				case OpCode::KM1: expected[instruction.a] = valueInteger(-1); break;
				case OpCode::KSMI: expected[instruction.a] = valueInteger(instruction.sbx()); break;
				case OpCode::NOT: expected[instruction.a] = valueBool(!isTruthy(expected[instruction.b])); break;
				default:
					try { expected[instruction.a] = evaluate(op, operand(instruction.b), operand(instruction.c)); }
					catch (const LuaExecutionError& error) {
						require(error.reason == LUA_FAULT_REASON_INVALID_ARGUMENT, "dependent numeric operand fault");
						invalid = true;
					}
					break;
			}
			source[index] = {&instruction, index == 0 ? 0x1000u : source[index - 1].pc + decoded[index - 1].width * INSTRUCTION_BYTES};
			previous = instruction.a;
			auto block = test::compileNative(std::span(source).first(index + 1), memory, cpu.stringPool());
			auto registers = test::valueBank(initial);
			const auto* exit = block->run(registers.view(), nativeRunState = {.constants = poolBank.view(), .remainingCycles = block->terminal.cycles});
			require((invalid ? exit->exit == NativeBlockExit::InvalidOperand && exit->currentPc == source[index].pc
				: exit == &block->terminal) && nativeRunState.remainingCycles == 0 && test::matchesValues(registers.view(), expected), "dependent native instructions preserve every live raw register at each prefix exit");
			if (invalid) {
				// The faulting prefix has been checked. Give the next generated
				// prefix a reachable continuation and a fresh Integer producer.
				instruction.op = static_cast<u8>(OpCode::KSMI);
				instruction.baseCycles = BASE_CYCLES[instruction.op];
				instruction.setSbx(static_cast<i32>(index) - 17);
				expected[instruction.a] = valueInteger(instruction.sbx());
			}
		}
		for (const auto op : {OpCode::HALT, OpCode::JMP, OpCode::JMPIF, OpCode::JMPIFNOT}) {
			auto& terminal = decoded.back();
			terminal.op = static_cast<u8>(op); terminal.width = 2; terminal.baseCycles = BASE_CYCLES[terminal.op];
			terminal.a = previous; terminal.setBx(0x2000u);
			source.back() = {&terminal, source[31].pc + decoded[31].width * INSTRUCTION_BYTES};
			auto block = test::compileNative(source, memory, cpu.stringPool());
			auto registers = test::valueBank(initial);
			const auto pc = block->run(registers.view(), nativeRunState = {.constants = poolBank.view(), .remainingCycles = block->terminal.cycles})->nextPc;
			const bool taken = op == OpCode::JMP || (op == OpCode::JMPIF && isTruthy(expected[previous]))
				|| (op == OpCode::JMPIFNOT && !isTruthy(expected[previous]));
			require(test::matchesValues(registers.view(), expected) && pc == (taken ? terminal.bx() : source.back().pc + 2 * INSTRUCTION_BYTES),
				"all native control exits consume and publish the final pending result");
		}
	}
}

void truthinessAndConditionalExits() {
	NativeBlockRunState nativeRunState;
	for (const auto op : {OpCode::NOT, OpCode::JMPIF, OpCode::JMPIFNOT}) {
		DecodedInstruction instruction;
		instruction.op = static_cast<u8>(op);
		instruction.a = op == OpCode::NOT ? 0 : 1;
		instruction.b = 1;
		instruction.width = 2;
		instruction.baseCycles = 1;
		instruction.setBx(0xfffffffcu);
		const std::array source{NativeBlockInstruction{&instruction, 0x1000u}};
		auto block = test::compileNative(source, memory, cpu.stringPool());
		// Exhaust the entire raw Value-header domain, with nonzero payloads:
		// falsey tags are not compared as floating-point NaNs or whole values.
		for (u32 header = 0; header != 256u; ++header) {
			const Value input = valueFromTag(static_cast<ValueTag>(header), 0x89abcdefu);
			auto registers = test::valueBank(std::array{valueNil(), input});
			const u32 nextPc = block->run(registers.view(), nativeRunState = {.remainingCycles = block->terminal.cycles})->nextPc;
			if (op == OpCode::NOT) {
				require(registers.get(0) == valueBool(!isTruthy(input)) && nextPc == 0x1008u,
					"native NOT preserves every representable Value header and boxed Boolean");
			} else {
				const bool taken = op == OpCode::JMPIF ? isTruthy(input) : !isTruthy(input);
				require(nextPc == (taken ? 0xfffffffcu : 0x1008u),
					"native conditional exits return raw branch or WIDE fallthrough PCs");
			}
		}
		require(block->terminal.registerTop == (op == OpCode::NOT ? 1 : 0),
			"conditional branch register reads never extend the open-result top");
	}
	DecodedInstruction halt;
	halt.op = static_cast<u8>(OpCode::HALT);
	halt.a = 63; // All operand bits are ignored by HALT.
	halt.width = 2;
	halt.baseCycles = 1;
	const std::array source{NativeBlockInstruction{&halt, 0xfffffff8u}};
	auto block = test::compileNative(source, memory, cpu.stringPool());
	require(block->run({}, nativeRunState = {.remainingCycles = block->terminal.cycles})->nextPc == 0u && block->terminal.exit == NativeBlockExit::Halt
		&& block->terminal.registerTop == 0 && block->terminal.cycles == 1 && block->terminal.lastPc == 0xfffffffcu,
		"a standalone native WIDE HALT has an exact wrapped continuation and explicit exit");
}

void typedCallExitPublishesPrefix() {
	DecodedInstruction one, shift, call;
	one.op = static_cast<u8>(OpCode::K1); one.width = one.baseCycles = 1;
	shift.op = static_cast<u8>(OpCode::SHL); shift.width = shift.baseCycles = 1;
	shift.a = 1; shift.b = shift.c = 0;
	call.op = static_cast<u8>(OpCode::CALL); call.width = 2; call.baseCycles = 2;
	call.a = 3; call.b = 1; call.c = 2;
	const std::array source{NativeBlockInstruction{&one, 0x1000u}, NativeBlockInstruction{&shift, 0x1004u},
		NativeBlockInstruction{&call, 0x1008u}};
	ValueSlots registers(4);
	auto block = test::compileNative(source, memory, cpu.stringPool());
	NativeBlockRunState state{.remainingCycles = 4};
	const auto* exit = block->run(registers.view(), state);
	require(exit->exit == NativeBlockExit::Call && exit->operands.call.callee == 3
		&& exit->operands.call.supplied == 0 && exit->operands.call.requested == 1,
		"a generated CALL gives the CPU its typed arguments and result count");
	require(registers.get(0) == valueInteger(1) && registers.get(1) == valueInteger(2)
		&& state.registerTop == 2 && state.remainingCycles == 0
		&& exit->currentPc == 0x1008u && exit->lastPc == 0x100cu && exit->nextPc == 0x1010u,
		"CALL publishes the completed prefix but does not extend top, and preserves both WIDE PCs");
}

void sharedExitMapsPublishRawValuesFromEitherRegisterBank() {
	const std::array constants{valueFromTag(ValueTag::False, 37), valueFloat(-0.0),
		valueFromTag(ValueTag::Nil, 19), valueTable(cpu.createTable().address()),
		valueString(cpu.stringPool().intern("field")), valueInteger(5), valueInteger(2)};
	const auto constantsBank = test::valueBank(constants);
	for (bool calling : {false, true}) for (int definitions = 0; definitions <= 4; ++definitions) {
		for (auto terminal : {OpCode::JMP, OpCode::GETFIELD, OpCode::LOAD_MEM}) {
			std::array<DecodedInstruction, 6> decoded{};
			std::array<NativeBlockInstruction, 6> source{};
			size_t count = 0;
			std::array<Value, 16> initial;
			initial.fill(valueFromTag(ValueTag::True, 53));
			initial[12] = valueInteger(0xf0000000u);
			auto expected = initial;
			auto registers = test::valueBank(initial);
			if (calling) {
				auto& op = decoded[count++]; op.op = static_cast<u8>(OpCode::MOD);
				op.a = 15; op.b = -6; op.c = -7; expected[15] = valueInteger(1);
			}
			for (int index = 0; index < definitions; ++index) {
				auto& op = decoded[count++]; op.op = static_cast<u8>(OpCode::LOADK);
				op.a = index; op.setBx(index); expected[index] = constants[index];
			}
			auto& last = decoded[count++]; last.op = static_cast<u8>(terminal);
			last.a = 8; last.b = 12;
			last.c = terminal == OpCode::GETFIELD ? 4 : static_cast<i16>(MemoryAccessKind::U32LE);
			last.setBx(0x8000);
			for (size_t index = 0; index < count; ++index) {
				decoded[index].width = 1; decoded[index].baseCycles = BASE_CYCLES[decoded[index].op];
				source[index] = {&decoded[index], 0x1000u + static_cast<u32>(index) * INSTRUCTION_BYTES};
			}
			auto block = test::compileNative(std::span(source).first(count), memory, cpu.stringPool());
			const int grant = block->terminal.cycles;
			NativeBlockRunState state{.constants = constantsBank.view(), .remainingCycles = grant, .registerTop = -3};
			const auto* exit = block->run(registers.view(), state);
			require(exit->exit == (terminal == OpCode::JMP ? NativeBlockExit::Continue
				: terminal == OpCode::GETFIELD ? NativeBlockExit::ReadField : NativeBlockExit::ReadMemory),
				"normal, typed-table and bus exits reach the shared gate with the actual descriptor");
			require(test::matchesValues(registers.view(), expected), "shared exit maps preserve raw payloads and publish no unwritten register");
			require(state.remainingCycles == grant - exit->cycles
				&& state.registerTop == (calling ? 16 : definitions == 0 ? -3 : definitions),
				"the shared gate charges a segment once and preserves an unchanged register top");
		}
	}
}

void twoFieldProofsWithAliasedSlotsResumeAtTheFailedRead() {
	const auto x = cpu.stringPool().intern("two-field x");
	const auto y = cpu.stringPool().intern("two-field y");
	auto table = cpu.createTable(0, 2);
	int xSlot = table.setStringKey(x, valueFloat(1.5f));
	const int ySlot = table.setStringKey(y, valueInteger(2));
	table.getStringKeyCached(x, xSlot);
	const auto constants = test::valueBank(std::array{valueString(x), valueString(y)});
	std::array decoded{
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(xSlot), .a = 1, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.a = 2, .b = 1, .op = static_cast<u8>(OpCode::MOV)},
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(ySlot), .a = 1, .c = 1, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.a = 3, .b = 2, .c = 1, .op = static_cast<u8>(OpCode::ADD)},
	};
	std::array<NativeBlockInstruction, decoded.size()> source;
	for (size_t index = 0; index < decoded.size(); ++index) {
		auto& inst = decoded[index];
		inst.width = index == 2 ? 2 : 1;
		inst.baseCycles = BASE_CYCLES[inst.op];
		source[index] = {&inst, 0x9000u + static_cast<u32>(index + (index > 2)) * INSTRUCTION_BYTES};
	}
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		decoded.back().observeNativeNumericTypes(valueFloat(1.5f), valueInteger(2));
	auto block = test::compileNative(source, memory, cpu.stringPool());
	const int grant = block->terminal.cycles;
	require(block->terminal.currentPc == source.back().pc, "both field proofs and their arithmetic share one native entry");
	for (const auto failure : {-1, 0, 2}) {
		table.setStringKey(x, failure == 0 ? valueInteger(4) : valueFloat(1.5f));
		table.setStringKey(y, failure == 2 ? valueFloat(4.0f) : valueInteger(2));
		ValueSlots registers(4);
		registers.set(0, valueTable(table.address()));
		registers.set(1, valueBool(true));
		registers.set(2, valueBool(false));
		registers.set(3, valueInteger(-7));
		NativeBlockRunState state{};
		state.constants = constants.view();
		state.remainingCycles = grant;
		state.registerTop = 1;
		const auto* exit = block->run(registers.view(), state);
		if (failure < 0) {
			require(exit == &block->terminal && registers.get(3) == valueFloat(3.5f)
				&& registers.get(1) == valueInteger(2) && registers.get(2) == valueFloat(1.5f)
				&& state.remainingCycles == 0 && state.registerTop == 4,
				"native sum consumes both proved values without confusing the reused guest slot");
			continue;
		}
		require(exit->exit == NativeBlockExit::ReadField && exit->currentPc == source[failure].pc
			&& exit->lastPc == source[failure].pc + (decoded[failure].width - 1u) * INSTRUCTION_BYTES
			&& exit->nextPc == source[failure].pc + decoded[failure].width * INSTRUCTION_BYTES
			&& state.remainingCycles == grant - exit->cycles && registers.get(3) == valueInteger(-7),
			"the checked field exit names its original instruction, including the full WIDE span");
		require(failure == 0 ? registers.get(1) == valueBool(true) && registers.get(2) == valueBool(false)
			: registers.get(1) == valueFloat(1.5f) && registers.get(2) == valueFloat(1.5f),
			"a failed proof leaves the destination of that field read untouched, including after its slot was used");
	}
}

void reusedFieldAddressHonorsEachSiteAndPhysicalStackAliases() {
	const auto key = cpu.stringPool().intern("reused field");
	const auto alternate = cpu.stringPool().intern("alternate field");
	auto table = cpu.createTable(0, 2);
	int slot = table.setStringKey(key, valueInteger(13));
	const int alternateSlot = table.setStringKey(alternate, valueInteger(29));
	table.getStringKeyCached(key, slot);
	const auto constants = test::valueBank(std::array{valueString(key)});
	std::array decoded{
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(slot), .a = 1, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.a = 4, .op = static_cast<u8>(OpCode::MOV)},
		DecodedInstruction{.payload = DecodedInstruction::Payload::tableSlot(slot), .a = 2, .b = 4, .op = static_cast<u8>(OpCode::GETFIELD)},
		DecodedInstruction{.a = 3, .b = 1, .c = 2, .op = static_cast<u8>(OpCode::ADD)},
	};
	std::array<NativeBlockInstruction, decoded.size()> source;
	u32 pc = 0xa000u;
	for (size_t index = 0; index < decoded.size(); ++index) {
		auto& inst = decoded[index];
		inst.width = index == 2 ? 2 : 1;
		inst.baseCycles = BASE_CYCLES[inst.op];
		source[index] = {&inst, pc};
		pc += inst.width * INSTRUCTION_BYTES;
	}
	for (unsigned sample = 0; sample < NATIVE_BLOCK_COMPILATION_THRESHOLD; ++sample)
		decoded.back().observeNativeNumericTypes(valueInteger(13), valueInteger(13));

	auto block = test::compileNative(source, memory, cpu.stringPool());
	const int grant = block->terminal.cycles;
	require(block->terminal.currentPc == source.back().pc, "a repeated field can share the native segment through a receiver copy");
	ValueSlots registers(5);
	registers.set(0, valueTable(table.address()));
	NativeBlockRunState state{.constants = constants.view(), .remainingCycles = grant};
	require(block->run(registers.view(), state) == &block->terminal && registers.get(3) == valueInteger(26),
		"both VM reads consume the checked address and produce their own results");
	// Distinct callsites can accept distinct matching raw hash nodes. The
	// optimized read must not silently substitute the first prediction.
	const u32 words = table.storageAddress();
	memory.writeRamRecordWord(words + static_cast<u32>(alternateSlot) * sizeof(u32), key);
	block->sideExits[1].tableRead.own.standalone = alternateSlot;
	registers.set(2, valueInteger(-3));
	state.remainingCycles = grant;
	const auto* mismatch = block->run(registers.view(), state);
	require(mismatch == &block->sideExits[1] && mismatch->currentPc == source[2].pc
		&& mismatch->lastPc == source[2].pc + INSTRUCTION_BYTES && state.remainingCycles == grant - mismatch->cycles
		&& registers.get(1) == valueInteger(13) && registers.get(2) == valueInteger(-3),
		"a live prediction split takes the consuming instruction's exact WIDE exit");
	memory.writeRamRecordWord(words + static_cast<u32>(alternateSlot) * sizeof(u32), alternate);
	block->sideExits[1].tableRead.own.standalone = slot;

	// An admitted host-owned fixture has no guest alias; a RAM-backed view
	// can physically overlap a field value even when the guest slots differ.
	const u32 valueWord = words + (table.hashSlots() + static_cast<u32>(slot)) * sizeof(u32);
	const u32 tags = DYNAMIC_RAM_BASE + 0x70000u;
	ValueSpan aliased(memory, valueWord, tags, registers.capacity());
	aliased.set(0, valueTable(table.address()));
	state.remainingCycles = grant;
	const auto* overlap = block->run(aliased, state);
	require(overlap == &block->sideExits[0] && state.remainingCycles == grant - overlap->cycles,
		"a checked address cannot be retained across physical writes to its backing through the register window");
	table.setStringKey(key, valueInteger(13));
}

} // namespace

int main() {
	try {
		require(cpu.heapAllocator().setFloor(DYNAMIC_RAM_BASE + 0x85000u), "native datapath buffers occupy public static RAM");
		multipleRegisterDefinitionsSurviveCallAndExit();
		sharedExitMapsPublishRawValuesFromEitherRegisterBank();
		independentEntriesBindTheirOwnValueBanks();
		entryAdmitsTheWholeRegionWindow();
		helperContinuationsReloadTheCurrentRegisterMap();
		residentValuesCrossInternalComparisonBranches();
		segmentEntryPermutationsPreserveRawValuesAndDeadDefinitions();
		admissionReplayPublishesOnlyThePaidPrefix();
		sparseRegionSuccessorsPreserveExactPcIdentity();
		diamondBackedgesPreserveFullStateFromEveryEntry();
		linkedBodiesShareOneFrameAndRetireTheirEdges();
		linkedAtomicStoreDebitsItsWholeChargeBeforeTestingItsSuccessor();
		linkedSlowExitPublishesTheWholeExecutedChain();
		comparisonDatapathsRespectEveryValueKind();
		arithmeticAndWordDatapaths();
		provenOperandFaultNeedsOnlyItsOwnGrant();
		wordProducerFactsPreserveRawValuesAndOverwrites();
		movesAndLiteralsPreserveRawValues();
		pinnedOperandsSurviveColdReadsAndDestinationReuse();
		nextAccessPressurePreservesEveryRawGuestSlot();
		dependentInstructionsWriteBackEveryLiveRegister();
		truthinessAndConditionalExits();
		typedCallExitPublishesPrefix();
		twoFieldProofsWithAliasedSlotsResumeAtTheFailedRead();
		reusedFieldAddressHonorsEachSiteAndPhysicalStackAliases();
		std::cout << "Native block datapath tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
