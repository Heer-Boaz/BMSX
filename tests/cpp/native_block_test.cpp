#include "machine/cpu/native_block.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/call_state.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"

#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace bmsx;

Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

Value evaluate(OpCode op, Value left, Value right) {
	switch (op) {
		case OpCode::ADD: return valueNumber(asNumber(left) + asNumber(right));
		case OpCode::SUB: return valueNumber(asNumber(left) - asNumber(right));
		case OpCode::MUL: return valueNumber(asNumber(left) * asNumber(right));
		case OpCode::DIV: return valueNumber(asNumber(left) / asNumber(right));
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
	const std::array values{
		valueNumber(0.0), valueNumber(-0.0), valueNumber(1.0), valueNumber(-1.0),
		valueNumber(0.25), valueNumber(-0.75), valueNumber(31.0), valueNumber(32.0),
		valueNumber(2147483647.0), valueNumber(2147483648.0), valueNumber(4294967295.0),
		valueNumber(-2147483648.0), valueNumber(-4294967296.75), valueNumber(4294967296.25),
		valueNumber(1e100), valueNumber(-1e100), valueNumber(std::numeric_limits<double>::denorm_min()),
		valueNumber(std::numeric_limits<double>::infinity()), valueNumber(-std::numeric_limits<double>::infinity()),
		VALUE_QNAN_MASK, Value{0x7ff0000000000001ULL}, valueNil(), valueBool(false),
		valueBool(true), valueString(0x12345678u), valueFromTag(ValueTag::Table, 0x1234u),
	};
	size_t cacheBytes = 0;
	for (const auto op : {OpCode::ADD, OpCode::SUB, OpCode::MUL, OpCode::DIV,
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
					auto block = NativeBlock::compile(instructions, pool.data(), cacheBytes, memory);
					block->run(registers.data(), pool.data());
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
		auto block = NativeBlock::compile(instructions, pool.data(), bytes, memory);
		std::array registers{Value{0}, Value{0}};
		block->run(registers.data(), pool.data());
		require(registers[0] == pool[index] && registers[1] == pool[index], "moves preserve every raw tagged and number bit");
	}
	for (const auto op : {OpCode::KNIL, OpCode::KFALSE, OpCode::KTRUE, OpCode::K0, OpCode::K1, OpCode::KM1, OpCode::KSMI}) {
		DecodedInstruction load;
		load.op = static_cast<u8>(op);
		load.width = 2;
		load.baseCycles = 1;
		load.sbx = -33554432;
		const std::array instructions{NativeBlockInstruction{&load, 0x1000}};
		auto block = NativeBlock::compile(instructions, pool.data(), bytes, memory);
		Value reg = 0;
		block->run(&reg, pool.data());
		const Value expected = op == OpCode::KNIL ? valueNil() : op == OpCode::KFALSE ? valueBool(false)
			: op == OpCode::KTRUE ? valueBool(true) : op == OpCode::K0 ? valueNumber(0.0)
			: op == OpCode::K1 ? valueNumber(1.0) : op == OpCode::KM1 ? valueNumber(-1.0) : valueNumber(-33554432.0);
		require(reg == expected && block->terminal.lastPc == 0x1004 && block->terminal.currentPc == 0x1000,
			"literal blocks retain raw tags and distinguish WIDE prefix and body PCs");
	}
}

void dependentInstructionsWriteBackEveryLiveRegister() {
	const std::array pool{valueNumber(-0.0), valueNumber(0.25), valueNumber(-4294967296.75),
		valueNumber(std::numeric_limits<double>::infinity()), VALUE_QNAN_MASK, valueNil(), valueBool(false),
		valueBool(true), valueString(0x12345678u), valueFromTag(ValueTag::Table, 0x1234u),
		Value{0x7ff0000000000001ULL}, Value{0xfff0000000000001ULL}};
	const std::array operations{OpCode::ADD, OpCode::SUB, OpCode::MUL, OpCode::DIV,
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
			auto block = NativeBlock::compile(std::span(source).first(index + 1), pool.data(), bytes, memory);
			auto registers = initial;
			block->run(registers.data(), pool.data());
			require(registers == expected, "dependent native instructions preserve every live raw register at each prefix exit");
		}
		for (const auto op : {OpCode::HALT, OpCode::JMP, OpCode::JMPIF, OpCode::JMPIFNOT}) {
			auto& terminal = decoded.back();
			terminal.op = static_cast<u8>(op); terminal.width = 2; terminal.baseCycles = BASE_CYCLES[terminal.op];
			terminal.a = previous; terminal.bx = 0x2000u;
			source.back() = {&terminal, source[31].pc + decoded[31].width * INSTRUCTION_BYTES};
			auto block = NativeBlock::compile(source, pool.data(), bytes, memory);
			auto registers = initial;
			const auto pc = block->run(registers.data(), pool.data())->nextPc;
			const bool taken = op == OpCode::JMP || (op == OpCode::JMPIF && isTruthy(expected[previous]))
				|| (op == OpCode::JMPIFNOT && !isTruthy(expected[previous]));
			require(registers == expected && pc == (taken ? terminal.bx : source.back().pc + 2 * INSTRUCTION_BYTES),
				"all native control exits consume and publish the final pending result");
		}
	}
	require(bytes == 0, "dependent block compilation retires all executable allocations");
}

void truthinessAndConditionalExits() {
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
		auto block = NativeBlock::compile(source, nullptr, bytes, memory);
		// Exhaust the entire raw Value-header domain, with nonzero payloads:
		// falsey tags are not compared as floating-point NaNs or whole values.
		for (u32 header = 0; header != 65536u; ++header) {
			const Value input = (static_cast<Value>(header) << 48u) | 0x123456789abcULL;
			std::array registers{valueNil(), input};
			const u32 nextPc = block->run(registers.data(), nullptr)->nextPc;
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
	auto block = NativeBlock::compile(source, nullptr, bytes, memory);
	require(block->run(nullptr, nullptr)->nextPc == 0u && block->terminal.exit == NativeBlockExit::Halt
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
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, {nullptr, nullptr, &exitResult});
		const auto* exit = block->run(registers.data(), nullptr);
		require(exit->handler(nullptr, &frame, exit) == NativeBlockTransition::RebindFrame,
			"the generated side exit returns its typed frame transition");
		require(block->terminal.registerTop == 2 && block->terminal.cycles == 4 && block->terminal.lastPc == 0x100cu,
			"CALL reads do not extend top and retain the terminal WIDE/cycle extent");
	}
	{
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, {nullptr, nullptr, &exitThrow});
		bool caught = false;
		try { const auto* exit = block->run(registers.data(), nullptr); exit->handler(nullptr, &frame, exit); }
		catch (const TailFault& error) { caught = error.value == 73; }
		require(caught, "C++ exceptions unwind ordinary registered frames, never generated code");
	}
	{
		auto block = NativeBlock::compile(source, nullptr, bytes, memory, {nullptr, nullptr, &exitRetire});
		retiringBlock = &block;
		const auto* exit = block->run(registers.data(), nullptr);
		require(exit->handler(nullptr, &frame, exit) == NativeBlockTransition::Redispatch && !block,
			"a side-exit handler may retire its own code before returning");
		retiringBlock = nullptr;
	}
	require(bytes == 0, "retired side-exit code leaves no executable cache allocation");
}

} // namespace

int main() {
	try {
		arithmeticAndWordDatapaths();
		movesAndLiteralsPreserveRawValues();
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
