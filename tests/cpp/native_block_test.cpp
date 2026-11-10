#include "machine/cpu/native_block.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/call_state.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "spec/blua32/numeric.h"
#include "spec/blua32/pow.h"

#include <array>
#include <iostream>
#include <limits>
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
		if (ops[i] == OpCode::KSMI) instruction.sbx = 5;
		if (ops[i] == OpCode::JMP) instruction.bx = 0x12345678;
		source[i] = {&instruction, 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	size_t bytes = 0;
	for (const auto op : {OpCode::SHR, OpCode::MOD, OpCode::FLOORDIV, OpCode::POW}) {
		decoded[8].op = static_cast<u8>(op);
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool());
		std::array<Value, 5> registers{valueNil(), valueNil(), valueNil(), valueNil(), valueNil()};
		const double result = op == OpCode::SHR ? 0.0 : op == OpCode::MOD ? luaModulo(66, 72)
			: op == OpCode::FLOORDIV ? luaFloorDivide(66, 72) : luaPow(66, 72);
		const std::array expected{valueNumber(83), valueNumber(11), valueNumber(result), valueNumber(66), valueNumber(72)};
		require(block->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = block->terminal.cycles}) == &block->terminal && registers == expected,
			"multiple live native values survive ABI calls, register pressure, alias copies and an actual exit");
	}
	require(bytes == 0, "register-allocated blocks retire their executable storage");
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
	decoded[0].a = 1; decoded[0].bx = 0;
	decoded[1].a = 2; decoded[1].b = 0; decoded[1].c = -2;
	decoded[2].a = 3; decoded[2].b = 2; decoded[2].c = 1;
	decoded[3].bx = 0x1800u;
	const std::array constantsA{valueNumber(3.5), valueNumber(1)};
	const std::array constantsB{valueNumber(10), valueNumber(2)};
	size_t bytes = 0;
	{
		auto helper = NativeBlock::compile(source, constantsA.data(), bytes, memory, cpu.stringPool());
		decoded[1].op = static_cast<u8>(OpCode::MUL);
		auto leaf = NativeBlock::compile(source, constantsB.data(), bytes, memory, cpu.stringPool());
		std::array registersA{valueNumber(1), valueNil(), valueNil(), valueNil(), valueBool(true)};
		std::array registersB{valueNumber(2), valueNil(), valueNil(), valueNil(), valueBool(false)};
		for (int iteration = 0; iteration < 256; ++iteration) {
			NativeBlockRunState a{.registers = registersA.data(), .constants = constantsA.data(), .remainingCycles = 97, .registerTop = 1};
			NativeBlockRunState b{.registers = registersB.data(), .constants = constantsB.data(), .remainingCycles = 53, .registerTop = 5};
			require(helper->run(a) == &helper->terminal && leaf->run(b) == &leaf->terminal,
				"independent helper and leaf bodies return through the native entry ABI");
			require(a.remainingCycles == 93 && b.remainingCycles == 49 && a.registerTop == 4 && b.registerTop == 5,
				"alternating entries preserve each caller's cycle grant and register top");
			require(registersA[3] == valueNumber(5.5) && registersB[3] == valueNumber(14)
				&& registersA[4] == valueBool(true) && registersB[4] == valueBool(false),
				"alternating native entries reload the correct value banks without leaking another caller's state");
		}
	}
	require(bytes == 0, "independent native bodies retire their own executable allocations");
}

void linkedBodiesShareOneFrameAndRetireTheirEdges() {
	NativeBlockRunState nativeRunState;
	std::array<DecodedInstruction, 5> decoded{};
	const std::array ops{OpCode::ADD, OpCode::JMPIF, OpCode::SHL, OpCode::ADD, OpCode::JMP};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1; decoded[i].baseCycles = 1;
	}
	decoded[0].a = 7; decoded[0].b = 0; decoded[0].c = -1;
	decoded[1].a = 2; decoded[1].bx = 0x1080;
	decoded[2].a = 0; decoded[2].b = 7; decoded[2].c = -1;
	decoded[3].a = 3; decoded[3].b = 0; decoded[3].c = 7;
	decoded[4].bx = 0x1000;
	const std::array firstSource{NativeBlockInstruction{&decoded[0], 0x1000}, NativeBlockInstruction{&decoded[1], 0x1004}};
	const std::array secondSource{NativeBlockInstruction{&decoded[2], 0x1080}, NativeBlockInstruction{&decoded[3], 0x1084},
		NativeBlockInstruction{&decoded[4], 0x1088}};
	const std::array constants{valueNumber(1)};
	size_t bytes = 0;
	auto first = NativeBlock::compile(firstSource, constants.data(), bytes, memory, cpu.stringPool());
	auto second = NativeBlock::compile(secondSource, constants.data(), bytes, memory, cpu.stringPool());
	second->linkFrom(first->sideExits.back()); first->linkFrom(second->terminal);
	for (const int budget : {2, 3, 4, 5, 6, 7, 11, 127, 500002}) {
		std::array<Value, 8> registers{}; registers.fill(valueNil());
		registers[0] = valueNumber(1); registers[2] = valueBool(true);
		auto expected = registers;
		int remaining = budget;
		bool inFirst = true;
		const NativeBlockExitSite* expectedExit;
		for (;;) {
			if (inFirst) {
				expected[7] = valueNumber(asNumber(expected[0]) + 1); remaining -= 2;
				expectedExit = &first->sideExits.back();
			} else {
				expected[0] = valueNumber(static_cast<i32>(toU32(expected[7]) << 1u));
				expected[3] = valueNumber(asNumber(expected[0]) + asNumber(expected[7])); remaining -= 3;
				expectedExit = &second->terminal;
			}
			inFirst = !inFirst;
			if (remaining < (inFirst ? 2 : 3)) break;
		}
		const auto result = first->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = budget});
		require(result == expectedExit && nativeRunState.remainingCycles == remaining && nativeRunState.registerTop == 8 && registers == expected,
			"linked leaf/calling bodies share one frame, bounded stack, exact grants and the maximum live-register extent");
	}
	second->linkFrom(first->terminal);
	std::array<Value, 8> registers{}; registers.fill(valueNil()); registers[0] = valueNumber(1); registers[2] = valueBool(false);
	require(first->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = 5}) == &second->terminal && registers[0] == valueNumber(4),
		"both conditional exits can link independently to the same target");
	first->terminal.link.disconnect();
	require(first->sideExits.back().link.target == second.get(), "unlinking one incoming edge preserves the other");
	second.reset();
	require(!first->sideExits.back().link.code && !first->sideExits.back().link.target,
		"retiring a target disconnects each surviving source before executable storage is freed");
	registers[2] = valueBool(true);
	require(first->run(nativeRunState = {.registers = registers.data(), .constants = constants.data(), .remainingCycles = 1000}) == &first->sideExits.back(),
		"an unlinked predecessor returns normally instead of entering retired native code");
	first->linkFrom(first->sideExits.back());
	first.reset();
	require(bytes == 0, "retiring a self-linked block releases its frame and executable storage exactly once");
}

void linkedAtomicStoreDebitsItsWholeChargeBeforeTestingItsSuccessor() {
	std::array<DecodedInstruction, 4> decoded{};
	const std::array ops{OpCode::K1, OpCode::JMP, OpCode::STORE_MEM_WORDS, OpCode::K1};
	for (size_t i = 0; i < ops.size(); ++i) {
		decoded[i].op = static_cast<u8>(ops[i]); decoded[i].width = 1; decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
	}
	decoded[0].a = 6; decoded[1].bx = 0x1080;
	decoded[2].width = 2; decoded[2].a = 8; decoded[2].b = 0; decoded[2].c = 5;
	decoded[3].a = 7;
	const std::array prefix{NativeBlockInstruction{&decoded[0], 0x1000}, NativeBlockInstruction{&decoded[1], 0x1004}};
	const std::array span{NativeBlockInstruction{&decoded[2], 0x1080}};
	const std::array successor{NativeBlockInstruction{&decoded[3], 0x1088}};
	size_t bytes = 0;
	auto first = NativeBlock::compile(prefix, nullptr, bytes, memory, cpu.stringPool());
	auto second = NativeBlock::compile(span, nullptr, bytes, memory, cpu.stringPool());
	auto third = NativeBlock::compile(successor, nullptr, bytes, memory, cpu.stringPool());
	second->linkFrom(first->terminal); third->linkFrom(second->terminal);
	require(first->entryCycles == 2 && second->entryCycles == 1 && second->terminal.cycles == 4,
		"block entry needs only a positive budget at the final instruction start");
	constexpr u32 target = DYNAMIC_RAM_BASE + 0x80000u;
	for (int budget : {2, 3, 6, 7}) {
		std::array<Value, 13> registers; registers.fill(valueNil());
		registers[0] = valueNumber(target); registers[7] = valueNumber(99);
		for (u32 i = 0; i < 5; ++i) { registers[8 + i] = valueNumber(73u + i); memory.writeMappedWord(target + i * 4u, 0); }
		NativeBlockRunState state{.registers = registers.data(), .remainingCycles = budget};
		const auto* exit = first->run(state);
		const auto* expected = budget == 2 ? &first->terminal : budget == 7 ? &third->terminal : &second->terminal;
		require(exit == expected && state.remainingCycles == budget - (budget == 2 ? 2 : budget == 7 ? 7 : 6)
			&& registers[6] == valueNumber(1) && registers[7] == valueNumber(budget == 7 ? 1 : 99)
			&& state.registerTop == (budget == 7 ? 8 : 7),
			"linked native bodies finish the counted store but never start a successor without positive budget");
		for (u32 i = 0; i < 5; ++i) require(memory.readMappedWord(target + i * 4u) == (budget == 2 ? 0u : 73u + i),
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
	decoded[0].a = 7; decoded[1].bx = 0x1080;
	decoded[2].a = 5; decoded[2].b = 7; decoded[2].c = 7;
	decoded[3].a = 4; decoded[3].b = 1; decoded[3].c = static_cast<i16>(MemoryAccessKind::U32LE); decoded[3].baseCycles = 2;
	decoded[4].a = 6; decoded[4].b = 4; decoded[4].c = 0;
	const std::array firstSource{NativeBlockInstruction{&decoded[0], 0x1000}, NativeBlockInstruction{&decoded[1], 0x1004}};
	const std::array secondSource{NativeBlockInstruction{&decoded[2], 0x1080}, NativeBlockInstruction{&decoded[3], 0x1084},
		NativeBlockInstruction{&decoded[4], 0x1088}};
	size_t bytes = 0;
	auto first = NativeBlock::compile(firstSource, nullptr, bytes, memory, cpu.stringPool());
	auto second = NativeBlock::compile(secondSource, nullptr, bytes, memory, cpu.stringPool());
	second->linkFrom(first->terminal);
	std::array<Value, 8> registers{}; registers.fill(valueNil());
	registers[1] = valueNumber(IO_SYS_BUS_FAULT_CODE); registers[6] = valueNumber(73);
	const auto result = first->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = 100});
	require(result == &second->sideExits[0] && result->exit == NativeBlockExit::ReadMemory
		&& result->currentPc == 0x1084 && result->nextPc == 0x1088 && nativeRunState.remainingCycles == 95
		&& nativeRunState.registerTop == 8 && registers[5] == valueNumber(2) && registers[6] == valueNumber(73) && registers[4] == valueNil(),
		"a target's slow exit materializes the complete chain prefix without executing its load or later arithmetic");
	first.reset();
	// The surviving target must not retain an incoming node in the freed source.
	second.reset(); require(bytes == 0, "a slow exit leaves no executable-frame allocation");
}

void comparisonDatapathsRespectEveryValueKind() {
	NativeBlockRunState nativeRunState;
	auto& strings = cpu.stringPool();
	Closure firstClosure, secondClosure;
	Thread otherThread;
	BuiltinFunction type{BuiltinFunctionId::Type}, sameType{BuiltinFunctionId::Type}, next{BuiltinFunctionId::Next};
	const std::array values{valueNil(), valueFromTag(ValueTag::Nil, 37), valueBool(false),
		valueFromTag(ValueTag::False, 37), valueBool(true), valueFromTag(ValueTag::True, 37),
		valueNumber(0), valueNumber(-0.0), valueNumber(1), valueNumber(-1), valueNumber(0.25),
		VALUE_QNAN_MASK, Value{0x7ff0000000000001ULL}, Value{0xfff0000000000001ULL},
		valueNumber(std::numeric_limits<double>::infinity()), valueNumber(-std::numeric_limits<double>::infinity()),
		valueString(strings.intern("")), valueString(strings.intern("a")), valueString(strings.intern(std::string_view("a\0b", 3))),
		valueString(strings.intern("\xee\x80\x80")), valueString(strings.intern("\xf0\x90\x80\x80")),
		valueTable(cpu.createTable()), valueTable(cpu.createTable()), valueClosure(&firstClosure), valueClosure(&secondClosure),
		valueThread(cpu.activeThread()), valueThread(&otherThread), valueBuiltinFunction(&type), valueBuiltinFunction(&sameType),
		valueBuiltinFunction(&next)};
	size_t bytes = 0;
	for (const auto op : {OpCode::EQ, OpCode::LT, OpCode::LE}) for (const bool expected : {false, true}) {
		DecodedInstruction compare;
		compare.op = static_cast<u8>(op); compare.a = expected ? 0x3fffu : 0u; compare.width = 2; compare.baseCycles = 1;
		for (const Value left : values) for (const Value right : values) for (u32 constants = 0; constants < 4; ++constants) {
			bool predicate = false;
			if (op == OpCode::EQ) predicate = valuesEqual(left, right);
			else if (valueIsNumber(left) && valueIsNumber(right)) predicate = op == OpCode::LT
				? asNumber(left) < asNumber(right) : asNumber(left) <= asNumber(right);
			else if (valueIsString(left) && valueIsString(right)) {
				const int order = strings.toString(asStringId(left)).compare(strings.toString(asStringId(right)));
				predicate = op == OpCode::LT ? order < 0 : order <= 0;
			}
			compare.b = (constants & 1) != 0 ? -1 : 0;
			compare.c = (constants & 2) != 0 ? -2 : 1;
			const std::array source{NativeBlockInstruction{&compare, 0x1000}};
			const std::array pool{left, right};
			auto registers = pool;
			auto block = NativeBlock::compile(source, pool.data(), bytes, memory, strings);
			const auto* exit = block->run(nativeRunState = {.registers = registers.data(), .constants = pool.data(), .remainingCycles = block->terminal.cycles});
			require((exit->exit == NativeBlockExit::SkipInstruction) == (predicate != expected)
				&& registers == pool && exit->registerTop == 0 && exit->cycles == 1
				&& exit->nextPc == 0x1008 && exit->currentPc == 0x1000 && exit->lastPc == 0x1004,
				"native EQ/LT/LE preserve kind rules, RK sources, NaNs, UTF-8 order and non-destination A flags");
		}
	}
	require(bytes == 0, "native comparisons retire all generated storage");
}

Value evaluate(OpCode op, Value left, Value right) {
	switch (op) {
		case OpCode::ADD: return valueNumber(asNumber(left) + asNumber(right));
		case OpCode::SUB: return valueNumber(asNumber(left) - asNumber(right));
		case OpCode::MUL: return valueNumber(asNumber(left) * asNumber(right));
		case OpCode::DIV: return valueNumber(asNumber(left) / asNumber(right));
		case OpCode::MOD: return valueNumber(luaModulo(asNumber(left), asNumber(right)));
		case OpCode::FLOORDIV: return valueNumber(luaFloorDivide(asNumber(left), asNumber(right)));
		case OpCode::POW: return valueNumber(luaPow(asNumber(left), asNumber(right)));
		case OpCode::UNM: return valueNumber(-asNumber(left));
		case OpCode::BAND: return valueNumber(static_cast<i32>(toU32(left) & toU32(right)));
		case OpCode::BOR: return valueNumber(static_cast<i32>(toU32(left) | toU32(right)));
		case OpCode::BXOR: return valueNumber(static_cast<i32>(toU32(left) ^ toU32(right)));
		case OpCode::SHL: return valueNumber(static_cast<i32>(toU32(left) << (toU32(right) & 31u)));
		case OpCode::SHR: return valueNumber(toI32(left) >> (toU32(right) & 31u));
		case OpCode::BNOT: return valueNumber(static_cast<i32>(~toU32(left)));
		default: __builtin_unreachable();
	}
}

void arithmeticAndWordDatapaths() {
	NativeBlockRunState nativeRunState;
	const std::array values{
		valueNumber(0.0), valueNumber(-0.0), valueNumber(1.0), valueNumber(-1.0),
		valueNumber(0.25), valueNumber(-0.75), valueNumber(31.0), valueNumber(32.0),
		valueNumber(10), valueNumber(0.05), valueNumber(2), valueNumber(1.0 / 12.0),
		valueNumber(1.0000000000000002), valueNumber(2147483649.0),
		valueNumber(2147483647.0), valueNumber(2147483648.0), valueNumber(4294967295.0),
		valueNumber(-2147483648.0), valueNumber(-4294967296.75), valueNumber(4294967296.25),
		valueNumber(1e100), valueNumber(-1e100), valueNumber(std::numeric_limits<double>::denorm_min()),
		valueNumber(std::numeric_limits<double>::infinity()), valueNumber(-std::numeric_limits<double>::infinity()),
		VALUE_QNAN_MASK, Value{0x7ff0000000000001ULL}, valueNil(), valueBool(false),
		valueBool(true), valueString(0x12345678u), valueFromTag(ValueTag::Table, 0x1234u),
	};
	size_t cacheBytes = 0;
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
				std::array registers{left, right, valueNil(), valueNil()};
				{
					auto block = NativeBlock::compile(instructions, pool.data(), cacheBytes, memory, cpu.stringPool());
					block->run(nativeRunState = {.registers = registers.data(), .constants = pool.data(), .remainingCycles = block->terminal.cycles});
					const Value expected = evaluate(op, left, right);
					require(registers[destination] == expected && registers[3] == expected,
						"native arithmetic retains exact number/word semantics and register aliases");
					require(block->terminal.cycles == operation.baseCycles + 1 && block->terminal.registerTop == 4
						&& block->terminal.currentPc == 0x1008u && block->terminal.lastPc == 0x1008u
						&& block->terminal.nextPc == 0x100cu, "native block publishes its physical instruction extent");
					require(cacheBytes == block->codeBytes && cacheBytes != 0, "native code allocation is accounted");
				}
				require(cacheBytes == 0, "retiring native code releases its cache accounting");
			}
		}
	}
}

void movesAndLiteralsPreserveRawValues() {
	NativeBlockRunState nativeRunState;
	const std::array pool{valueNil(), valueBool(false), valueBool(true), valueString(0x12345678u),
		valueFromTag(ValueTag::Table, 0x1234u), Value{0xfff0000000000001ULL}, valueNumber(-0.0)};
	size_t bytes = 0;
	for (u32 index = 0; index < pool.size(); ++index) {
		DecodedInstruction load;
		load.op = static_cast<u8>(OpCode::LOADK);
		load.width = load.baseCycles = 1;
		load.bx = index;
		DecodedInstruction move;
		move.op = static_cast<u8>(OpCode::MOV);
		move.width = move.baseCycles = 1;
		move.a = 1;
		const std::array instructions{NativeBlockInstruction{&load, 0x1000}, NativeBlockInstruction{&move, 0x1004}};
		auto block = NativeBlock::compile(instructions, pool.data(), bytes, memory, cpu.stringPool());
		std::array registers{Value{0}, Value{0}};
		block->run(nativeRunState = {.registers = registers.data(), .constants = pool.data(), .remainingCycles = block->terminal.cycles});
		require(registers[0] == pool[index] && registers[1] == pool[index], "moves preserve every raw tagged and number bit");
	}
	for (const auto op : {OpCode::KNIL, OpCode::KFALSE, OpCode::KTRUE, OpCode::K0, OpCode::K1, OpCode::KM1, OpCode::KSMI}) {
		DecodedInstruction load;
		load.op = static_cast<u8>(op);
		load.width = 2;
		load.baseCycles = 1;
		load.sbx = -33554432;
		const std::array instructions{NativeBlockInstruction{&load, 0x1000}};
		auto block = NativeBlock::compile(instructions, pool.data(), bytes, memory, cpu.stringPool());
		Value reg = 0;
		block->run(nativeRunState = {.registers = &reg, .constants = pool.data(), .remainingCycles = block->terminal.cycles});
		const Value expected = op == OpCode::KNIL ? valueNil() : op == OpCode::KFALSE ? valueBool(false)
			: op == OpCode::KTRUE ? valueBool(true) : op == OpCode::K0 ? valueNumber(0.0)
			: op == OpCode::K1 ? valueNumber(1.0) : op == OpCode::KM1 ? valueNumber(-1.0) : valueNumber(-33554432.0);
		require(reg == expected && block->terminal.lastPc == 0x1004 && block->terminal.currentPc == 0x1000,
			"literal blocks retain raw tags and distinguish WIDE prefix and body PCs");
	}
}

void pinnedOperandsSurviveColdReadsAndDestinationReuse() {
	const std::array values{valueNumber(-0.0), valueNumber(3.5), valueNumber(-17.25),
		valueNumber(std::numeric_limits<double>::infinity()), VALUE_QNAN_MASK,
		valueString(0x12345678u), Value{0xfff0000000000001ULL}};
	size_t bytes = 0;
	for (const bool helper : {false, true}) for (const bool coldLeft : {false, true}) {
		for (const auto op : {OpCode::MOV, OpCode::ADD, OpCode::SUB, OpCode::MUL, OpCode::DIV, OpCode::UNM}) {
			for (const u16 destination : {u16{0}, u16{1}, u16{4}, u16{5}}) for (const Value value : values) {
				const std::array pool{value, valueNumber(2), valueNumber(3), valueNumber(4)};
				std::array<Value, 8> registers; registers.fill(valueNil()); registers[4] = valueNumber(0.25);
				auto expected = registers;
				std::array<DecodedInstruction, 7> decoded{};
				std::array<NativeBlockInstruction, 7> source{};
				for (u16 i = 0; i < 4; ++i) {
					decoded[i].op = static_cast<u8>(OpCode::LOADK); decoded[i].a = i; decoded[i].bx = i;
					expected[i] = pool[i];
				}
				auto& operation = decoded[4]; operation.op = static_cast<u8>(op); operation.a = destination;
				operation.b = coldLeft ? 4 : 0; operation.c = coldLeft ? 0 : 4;
				expected[destination] = op == OpCode::MOV ? expected[operation.b]
					: evaluate(op, expected[operation.b], expected[operation.c]);
				decoded[5].op = static_cast<u8>(helper ? OpCode::MOD : OpCode::MOV);
				decoded[5].a = 7; decoded[5].b = helper ? -2 : destination; decoded[5].c = -3;
				expected[7] = helper ? valueNumber(2) : expected[destination];
				decoded[6].op = static_cast<u8>(OpCode::MOV); decoded[6].a = 6; decoded[6].b = destination;
				expected[6] = expected[destination];
				for (u32 i = 0; i < decoded.size(); ++i) {
					decoded[i].width = 1; decoded[i].baseCycles = BASE_CYCLES[decoded[i].op];
					source[i] = {&decoded[i], 0x1000u + i * INSTRUCTION_BYTES};
				}
				auto block = NativeBlock::compile(source, pool.data(), bytes, memory, cpu.stringPool());
				NativeBlockRunState state{.registers = registers.data(), .constants = pool.data(), .remainingCycles = block->terminal.cycles};
				require(block->run(state) == &block->terminal && registers == expected && state.remainingCycles == 0,
					"cold inputs cannot clobber pinned operands, aliased destinations or live values across a helper ABI call");
			}
		}
	}
	require(bytes == 0, "direct-register bodies release their accounted executable storage");
}

void dependentInstructionsWriteBackEveryLiveRegister() {
	NativeBlockRunState nativeRunState;
	const std::array pool{valueNumber(-0.0), valueNumber(0.25), valueNumber(-4294967296.75),
		valueNumber(std::numeric_limits<double>::infinity()), VALUE_QNAN_MASK, valueNil(), valueBool(false),
		valueBool(true), valueString(0x12345678u), valueFromTag(ValueTag::Table, 0x1234u),
		Value{0x7ff0000000000001ULL}, Value{0xfff0000000000001ULL}};
	const std::array operations{OpCode::ADD, OpCode::SUB, OpCode::MUL, OpCode::DIV, OpCode::MOD, OpCode::FLOORDIV, OpCode::POW,
		OpCode::BAND, OpCode::BOR, OpCode::BXOR, OpCode::SHL, OpCode::SHR, OpCode::UNM, OpCode::BNOT,
		OpCode::MOV, OpCode::LOADK, OpCode::KNIL, OpCode::KFALSE, OpCode::KTRUE,
		OpCode::K0, OpCode::K1, OpCode::KM1, OpCode::KSMI, OpCode::NOT};
	u32 random = 0x915acd38u;
	auto next = [&]() {
		random ^= random << 13u; random ^= random >> 17u; random ^= random << 5u;
		return random;
	};
	size_t bytes = 0;
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
			if (op == OpCode::LOADK) instruction.bx = next() % pool.size();
			if (op == OpCode::KSMI) instruction.sbx = static_cast<i32>(next() & 0x3ffffffu) - 0x2000000;
			const bool binary = op >= OpCode::ADD && op <= OpCode::SHR;
			if (binary && (next() & 3u) == 0) instruction.b = -static_cast<i16>(1 + next() % pool.size());
			if (binary && (next() & 3u) == 0) instruction.c = -static_cast<i16>(1 + next() % pool.size());
			const auto operand = [&](int selector) { return selector < 0 ? pool[-selector - 1] : expected[selector]; };
			switch (op) {
				case OpCode::MOV: expected[instruction.a] = expected[instruction.b]; break;
				case OpCode::LOADK: expected[instruction.a] = pool[instruction.bx]; break;
				case OpCode::KNIL: expected[instruction.a] = valueNil(); break;
				case OpCode::KFALSE: expected[instruction.a] = valueBool(false); break;
				case OpCode::KTRUE: expected[instruction.a] = valueBool(true); break;
				case OpCode::K0: expected[instruction.a] = valueNumber(0); break;
				case OpCode::K1: expected[instruction.a] = valueNumber(1); break;
				case OpCode::KM1: expected[instruction.a] = valueNumber(-1); break;
				case OpCode::KSMI: expected[instruction.a] = valueNumber(instruction.sbx); break;
				case OpCode::NOT: expected[instruction.a] = valueBool(!isTruthy(expected[instruction.b])); break;
				default: expected[instruction.a] = evaluate(op, operand(instruction.b), operand(instruction.c)); break;
			}
			source[index] = {&instruction, index == 0 ? 0x1000u : source[index - 1].pc + decoded[index - 1].width * INSTRUCTION_BYTES};
			previous = instruction.a;
			auto block = NativeBlock::compile(std::span(source).first(index + 1), pool.data(), bytes, memory, cpu.stringPool());
			auto registers = initial;
			block->run(nativeRunState = {.registers = registers.data(), .constants = pool.data(), .remainingCycles = block->terminal.cycles});
			require(registers == expected, "dependent native instructions preserve every live raw register at each prefix exit");
		}
		for (const auto op : {OpCode::HALT, OpCode::JMP, OpCode::JMPIF, OpCode::JMPIFNOT}) {
			auto& terminal = decoded.back();
			terminal.op = static_cast<u8>(op); terminal.width = 2; terminal.baseCycles = BASE_CYCLES[terminal.op];
			terminal.a = previous; terminal.bx = 0x2000u;
			source.back() = {&terminal, source[31].pc + decoded[31].width * INSTRUCTION_BYTES};
			auto block = NativeBlock::compile(source, pool.data(), bytes, memory, cpu.stringPool());
			auto registers = initial;
			const auto pc = block->run(nativeRunState = {.registers = registers.data(), .constants = pool.data(), .remainingCycles = block->terminal.cycles})->nextPc;
			const bool taken = op == OpCode::JMP || (op == OpCode::JMPIF && isTruthy(expected[previous]))
				|| (op == OpCode::JMPIFNOT && !isTruthy(expected[previous]));
			require(registers == expected && pc == (taken ? terminal.bx : source.back().pc + 2 * INSTRUCTION_BYTES),
				"all native control exits consume and publish the final pending result");
		}
	}
	require(bytes == 0, "dependent block compilation retires all executable allocations");
}

void truthinessAndConditionalExits() {
	NativeBlockRunState nativeRunState;
	size_t bytes = 0;
	for (const auto op : {OpCode::NOT, OpCode::JMPIF, OpCode::JMPIFNOT}) {
		DecodedInstruction instruction;
		instruction.op = static_cast<u8>(op);
		instruction.a = op == OpCode::NOT ? 0 : 1;
		instruction.b = 1;
		instruction.width = 2;
		instruction.baseCycles = 1;
		instruction.bx = 0xfffffffcu;
		const std::array source{NativeBlockInstruction{&instruction, 0x1000u}};
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool());
		// Exhaust the entire raw Value-header domain, with nonzero payloads:
		// falsey tags are not compared as floating-point NaNs or whole values.
		for (u32 header = 0; header != 65536u; ++header) {
			const Value input = (static_cast<Value>(header) << 48u) | 0x123456789abcULL;
			std::array registers{valueNil(), input};
			const u32 nextPc = block->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = block->terminal.cycles})->nextPc;
			if (op == OpCode::NOT) {
				require(registers[0] == valueBool(!isTruthy(input)) && nextPc == 0x1008u,
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
	auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool());
	require(block->run(nativeRunState = {.registers = nullptr, .constants = nullptr, .remainingCycles = block->terminal.cycles})->nextPc == 0u && block->terminal.exit == NativeBlockExit::Halt
		&& block->terminal.registerTop == 0 && block->terminal.cycles == 1 && block->terminal.lastPc == 0xfffffffcu,
		"a standalone native WIDE HALT has an exact wrapped continuation and explicit exit");
}

struct TailFault { int value; };
std::unique_ptr<NativeBlock>* retiringBlock = nullptr;

NativeBlockTransition exitResult(CPU*, CallFrame* frame, const NativeBlockExitSite* exit) {
	require(frame->registers[1] == valueNumber(2), "side-exit handlers see committed word conversions");
	require(exit->exit == NativeBlockExit::Call && exit->exitA == 3 && exit->exitB == 1 && exit->exitC == 2,
		"a generated exit retains decoded call operands");
	return NativeBlockTransition::RebindFrame;
}

NativeBlockTransition exitThrow(CPU*, CallFrame*, const NativeBlockExitSite*) {
	throw TailFault{73};
}

NativeBlockTransition exitRetire(CPU*, CallFrame*, const NativeBlockExitSite*) {
	retiringBlock->reset();
	return NativeBlockTransition::Redispatch;
}

void sideExitHandlersRunAfterGeneratedFrameReturns() {
	NativeBlockRunState nativeRunState;
	DecodedInstruction one, shift, call;
	one.op = static_cast<u8>(OpCode::K1); one.width = one.baseCycles = 1;
	shift.op = static_cast<u8>(OpCode::SHL); shift.width = shift.baseCycles = 1;
	shift.a = 1; shift.b = shift.c = 0;
	call.op = static_cast<u8>(OpCode::CALL); call.width = 2; call.baseCycles = 2;
	call.a = 3; call.b = 1; call.c = 2;
	const std::array source{NativeBlockInstruction{&one, 0x1000u}, NativeBlockInstruction{&shift, 0x1004u},
		NativeBlockInstruction{&call, 0x1008u}};
	size_t bytes = 0;
	std::array registers{valueNil(), valueNil()};
	CallFrame frame;
	frame.registers = registers.data();
	{
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool(), {nullptr, nullptr, &exitResult});
		const auto* exit = block->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = block->terminal.cycles});
		require(exit->handler(nullptr, &frame, exit) == NativeBlockTransition::RebindFrame,
			"the generated side exit returns its typed frame transition");
		require(block->terminal.registerTop == 2 && block->terminal.cycles == 4 && block->terminal.lastPc == 0x100cu,
			"CALL reads do not extend top and retain the terminal WIDE/cycle extent");
	}
	{
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool(), {nullptr, nullptr, &exitThrow});
		bool caught = false;
		try { const auto* exit = block->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = block->terminal.cycles}); exit->handler(nullptr, &frame, exit); }
		catch (const TailFault& error) { caught = error.value == 73; }
		require(caught, "C++ exceptions unwind ordinary registered frames, never generated code");
	}
	{
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, cpu.stringPool(), {nullptr, nullptr, &exitRetire});
		retiringBlock = &block;
		const auto* exit = block->run(nativeRunState = {.registers = registers.data(), .constants = nullptr, .remainingCycles = block->terminal.cycles});
		require(exit->handler(nullptr, &frame, exit) == NativeBlockTransition::Redispatch && !block,
			"a side-exit handler may retire its own code before returning");
		retiringBlock = nullptr;
	}
	require(bytes == 0, "retired side-exit code leaves no executable cache allocation");
}

} // namespace

int main() {
	try {
		multipleRegisterDefinitionsSurviveCallAndExit();
		independentEntriesBindTheirOwnValueBanks();
		linkedBodiesShareOneFrameAndRetireTheirEdges();
		linkedAtomicStoreDebitsItsWholeChargeBeforeTestingItsSuccessor();
		linkedSlowExitPublishesTheWholeExecutedChain();
		comparisonDatapathsRespectEveryValueKind();
		arithmeticAndWordDatapaths();
		movesAndLiteralsPreserveRawValues();
		pinnedOperandsSurviveColdReadsAndDestinationReuse();
		dependentInstructionsWriteBackEveryLiveRegister();
		truthinessAndConditionalExits();
		sideExitHandlersRunAfterGeneratedFrameReturns();
		std::cout << "Native block datapath tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
