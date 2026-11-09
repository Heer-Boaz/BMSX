#include "machine/cpu/native_block.h"
#include "machine/cpu/execution_image.h"

#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace bmsx;

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
					auto block = NativeBlock::compile(instructions, pool.data(), cacheBytes);
					block->run(registers.data(), pool.data());
					const Value expected = evaluate(op, left, right);
					require(registers[destination] == expected && registers[3] == expected,
						"native arithmetic retains exact number/word semantics and register aliases");
					require(block->cycles == operation.baseCycles + 1 && block->registerTop == 4
						&& block->currentPc == 0x1008u && block->lastPc == 0x1008u
						&& block->nextPc == 0x100cu, "native block publishes its physical instruction extent");
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
		auto block = NativeBlock::compile(instructions, pool.data(), bytes);
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
		auto block = NativeBlock::compile(instructions, pool.data(), bytes);
		Value reg = 0;
		block->run(&reg, pool.data());
		const Value expected = op == OpCode::KNIL ? valueNil() : op == OpCode::KFALSE ? valueBool(false)
			: op == OpCode::KTRUE ? valueBool(true) : op == OpCode::K0 ? valueNumber(0.0)
			: op == OpCode::K1 ? valueNumber(1.0) : op == OpCode::KM1 ? valueNumber(-1.0) : valueNumber(-33554432.0);
		require(reg == expected && block->lastPc == 0x1004 && block->currentPc == 0x1000,
			"literal blocks retain raw tags and distinguish WIDE prefix and body PCs");
	}
}

} // namespace

int main() {
	try {
		arithmeticAndWordDatapaths();
		movesAndLiteralsPreserveRawValues();
		std::cout << "Native block datapath tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
