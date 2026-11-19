#include "machine/cpu/cpu.h"
#include "machine/cpu/value_arithmetic.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/number32_cpu_fixture.h"
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <tuple>

namespace {
using namespace bmsx;
void require(bool condition, const char* text) {
	if (!condition)
		throw std::runtime_error(text);
}
using test::Number32Machine;
test::Blua32TestImage operation(OpCode op, u32 selector = 1) {
	test::Blua32TestImage image;
	if (op == OpCode::EQ || op == OpCode::LT || op == OpCode::LE) {
		image.text.resize(7 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(op), 1, 0, 1);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 0, 2);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::KFALSE), 2, 0, 0);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 0, 1);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::KTRUE), 2, 0, 0);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::RET), 2, 2, 0);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 6, .numParams = 3, .maxStack = 8},
			{.firstWord = 6, .wordCount = 1, .maxStack = 8}};
		image.exceptionFunctionIndex = 1;
		return image;
	}
	const u32 prefix = op == OpCode::MOV && selector > MAX_BASE_OPERAND_BC ? 1u : 0u;
	image.text.resize((3 + prefix) * INSTRUCTION_BYTES);
	if (prefix)
		writeInstruction(
			image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, static_cast<u8>(selector >> BASE_OPERAND_BC_BITS));
	writeInstruction(image.text, prefix, static_cast<u8>(op), 2, 0, static_cast<u8>(selector),
		static_cast<u8>((selector >> MAX_OPERAND_BITS) & 7));
	writeInstruction(image.text, prefix + 1, static_cast<u8>(OpCode::RET), 2, 2, 0);
	writeInstruction(image.text, prefix + 2, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 2 + prefix, .numParams = 3, .maxStack = 8},
		{.firstWord = 2 + prefix, .wordCount = 1, .maxStack = 8}};
	image.exceptionFunctionIndex = 1;
	return image;
}
Value calculate(OpCode op, Value a, Value b) {
	switch (op) {
	case OpCode::ADD:
		return valueAdd(a, b);
	case OpCode::SUB:
		return valueSubtract(a, b);
	case OpCode::MUL:
		return valueMultiply(a, b);
	case OpCode::DIV:
		return valueDivide(a, b);
	case OpCode::MOD:
		return valueModulo(a, b);
	case OpCode::FLOORDIV:
		return valueFloorDivide(a, b);
	case OpCode::POW:
		return valuePower(a, b);
	case OpCode::BAND:
		return valueInteger(integerOperand(a) & integerOperand(b));
	case OpCode::BOR:
		return valueInteger(integerOperand(a) | integerOperand(b));
	case OpCode::BXOR:
		return valueInteger(integerOperand(a) ^ integerOperand(b));
	case OpCode::SHL:
		return valueInteger(luaShiftLeft(integerOperand(a), integerOperand(b)));
	case OpCode::SHR:
		return valueInteger(luaShiftRight(integerOperand(a), integerOperand(b)));
	default:
		throw std::runtime_error("test operation");
	}
}
void scalarNumbers() {
	const Value values[] = {valueInteger(0), valueInteger(1), valueInteger(-1), valueInteger(INT32_MIN),
		valueInteger(INT32_MAX), valueInteger(16777217), valueFloat(16777216.0f), valueFloat(-2.5f), valueFloatBits(1),
		valueFloatBits(0x80000000), valueFloatBits(0x7f800000), valueFloatBits(0xff800000), valueFloatBits(0x7fa12345)};
	for (OpCode op : {OpCode::ADD, OpCode::SUB, OpCode::MUL, OpCode::DIV, OpCode::MOD, OpCode::FLOORDIV, OpCode::POW,
			 OpCode::BAND, OpCode::BOR, OpCode::BXOR, OpCode::SHL, OpCode::SHR}) {
		Number32Machine m(operation(op));
		Closure* closure = m.cpu.activeThread()->currentFrame->closure;
		bool first = true;
		for (Value a : values)
			for (Value b : values) {
				Value expected;
				try {
					expected = calculate(op, a, b);
				} catch (const LuaExecutionError&) {
					continue;
				}
				if (!first)
					m.cpu.beginCompletionCall(*closure);
				first = false;
				auto registers = m.cpu.activeThread()->currentFrame->registers;
				registers.set(0, a);
				registers.set(1, b);
				registers.set(2, valueInteger(917));
				require(m.cpu.runUntilDepth(0, 1000) == RunResult::Halted, "numeric function returns");
				const auto result = m.cpu.readCompletionValues();
				require(result.size() == 1 && result.get(0) == expected,
					"CPU opcode retains the numeric subtype and exact word");
			}
#if defined(BMSX_NATIVE_GATE_PROFILE)
		require(m.cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::Return)].entries != 0,
			"real CPU numeric cases must execute generated code, not merely compile it");
#endif
	}
	for (Value bad : {valueNil(), valueBool(true), valueString(0)}) {
		Number32Machine m(operation(OpCode::ADD));
		auto registers = m.cpu.activeThread()->currentFrame->registers;
		registers.set(0, bad);
		registers.set(1, valueInteger(1));
		registers.set(2, valueInteger(917));
		m.cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::ADD)]);
		require(m.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT,
			"non-Numbers take the guest operand fault");
		require(m.cpu.readFrameRegister(0, 2) == valueInteger(917), "failed arithmetic leaves destination intact");
	}
}
void unaryAndCompare() {
	for (auto op : {OpCode::UNM, OpCode::BNOT})
		for (Value value : {valueInteger(INT32_MIN), valueInteger(1), valueFloatBits(0x7fa12345),
				 valueFloatBits(0xffc00000), valueFloatBits(0x80000000)}) {
			if (op == OpCode::BNOT && !valueIsInteger(value))
				continue;
			Number32Machine m(operation(op));
			m.cpu.activeThread()->currentFrame->registers.set(0, value);
			m.cpu.runUntilDepth(0, 100);
			const auto expected = op == OpCode::UNM ? valueNegate(value) : valueInteger(~asInteger(value));
			require(m.cpu.readCompletionValues().get(0) == expected,
				"unary operations preserve subtype and raw negated NaN payloads");
		}
	const Value values[] = {valueInteger(16777217), valueFloat(16777216.0f), valueInteger(INT32_MAX),
		valueFloatBits(0x4f000000), valueFloatBits(0x7fa12345), valueFloatBits(0x80000000), valueInteger(0),
		valueFromTag(ValueTag::True, 1), valueFromTag(ValueTag::True, 2), valueNil()};
	for (auto op : {OpCode::EQ, OpCode::LT, OpCode::LE}) {
		Number32Machine m(operation(op));
		auto* closure = m.cpu.activeThread()->currentFrame->closure;
		bool first = true;
		for (Value a : values)
			for (Value b : values) {
				if (!first)
					m.cpu.beginCompletionCall(*closure);
				first = false;
				auto regs = m.cpu.activeThread()->currentFrame->registers;
				regs.set(0, a);
				regs.set(1, b);
				m.cpu.runUntilDepth(0, 100);
				const bool both = valueIsNumber(a) && valueIsNumber(b);
				const bool expected = op == OpCode::EQ
										  ? valuesEqual(a, b)
										  : both && (op == OpCode::LT ? compareNumbers(a, b) == NumericOrder::Less
																	  : static_cast<int>(compareNumbers(a, b)) <= 0);
				require(m.cpu.readCompletionValues().get(0) == valueBool(expected),
					"mixed comparisons use exact Integer values and their 32-bit skip/jump continuations");
			}
	}
}
void wordMoves() {
	for (auto kind : {ValueMoveKind::Copy, ValueMoveKind::FloatBits, ValueMoveKind::FloatFromBits}) {
		for (u32 word : {0u, 0x80000000u, 0x7fa12345u, 0xffa12345u, 0xffffffffu}) {
			for (int target : {0, 2}) {
				auto image = operation(OpCode::MOV);
				writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), target, 0, static_cast<u8>(kind));
				Number32Machine m(image);
				const Value source = kind == ValueMoveKind::FloatBits ? valueFloatBits(word) : valueInteger(word);
				m.cpu.activeThread()->currentFrame->registers.set(0, source);
				m.cpu.runUntilDepth(0, 1);
				const Value expected = kind == ValueMoveKind::FloatFromBits ? valueFloatBits(word)
									   : kind == ValueMoveKind::FloatBits	? valueInteger(word)
																			: source;
				require(m.cpu.readFrameRegister(0, target) == expected,
					"MOV changes only the selected tag, including aliased operands and signaling NaNs");
				require(m.cpu.instructionBudgetRemaining == -1, "all MOV kinds cost two cycles");
			}
		}
	}
	for (auto kind : {ValueMoveKind::FloatBits, ValueMoveKind::FloatFromBits}) {
		for (Value bad : {valueNil(), valueBool(true), valueString(0),
				 kind == ValueMoveKind::FloatBits ? valueInteger(1) : valueFloat(1)}) {
			auto image = operation(OpCode::MOV);
			writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 2, 0, static_cast<u8>(kind));
			Number32Machine m(image);
			auto regs = m.cpu.activeThread()->currentFrame->registers;
			regs.set(0, bad);
			regs.set(2, valueInteger(917));
			m.cpu.runUntilDepth(0, 1);
			require(m.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT,
				"word reinterpretation requires its exact numeric subtype");
			require(
				m.cpu.readFrameRegister(0, 2) == valueInteger(917), "failed word move leaves the destination intact");
			require(m.cpu.instructionBudgetRemaining == -1, "failed word move retains its started charge");
		}
	}
	for (u32 kind : {3, 255, 256, 257, 258, 511, 512, 16384, MAX_EXT_REGISTER_BC}) {
		auto image = operation(OpCode::MOV, kind);
		Number32Machine m(image);
		m.cpu.activeThread()->currentFrame->registers.set(2, valueInteger(917));
		m.cpu.runUntilDepth(0, 1);
		require(m.cpu.readCauseWord() == CPU_CAUSE_CODE_RESERVED_INSTRUCTION,
			"unknown MOV kinds take Reserved Instruction");
		require(m.cpu.readFrameRegister(0, 2) == valueInteger(917), "reserved word move publishes no value");
		require(m.cpu.instructionBudgetRemaining == -1, "reserved word move retains its started charge");
	}
}

void typedNativeOperands() {
	const std::array<std::array<Value, 2>, 10> pairs{
		{{valueInteger(-1), valueInteger(-1)}, {valueInteger(INT32_MIN), valueInteger(-32)},
			{valueInteger(INT32_MAX), valueInteger(33)}, {valueInteger(16777217), valueInteger(1)},
			{valueFloat(1.0f), valueFloatBits(0x33800000)}, {valueInteger(16777217), valueFloat(16777216.0f)},
			{valueFloatBits(0x7fa12345), valueFloat(2.0f)}, {valueFloatBits(0xffc00000), valueInteger(0)},
			{valueFloatBits(0x80000000), valueInteger(-1)}, {valueFloatBits(1), valueFloatBits(0x7f800000)}}};
	for (OpCode op : {OpCode::ADD, OpCode::SUB, OpCode::MUL, OpCode::DIV, OpCode::MOD, OpCode::FLOORDIV, OpCode::POW,
			 OpCode::BAND, OpCode::BOR, OpCode::BXOR, OpCode::SHL, OpCode::SHR, OpCode::UNM, OpCode::BNOT}) {
		for (const auto& pair : pairs)
			for (int form = 0; form < 4; ++form) {
				const bool unary = op == OpCode::UNM || op == OpCode::BNOT;
				if (unary && form != 0)
					continue;
				Value expected;
				try {
					expected = op == OpCode::UNM	? valueNegate(pair[0])
							   : op == OpCode::BNOT ? valueInteger(~integerOperand(pair[0]))
													: calculate(op, pair[0], pair[1]);
				} catch (const LuaExecutionError&) {
					continue;
				}
				auto image = operation(op);
				image.text.resize(5 * INSTRUCTION_BYTES);
				image.functions = {
					{.firstWord = 0, .wordCount = 4, .maxStack = 8}, {.firstWord = 4, .wordCount = 1, .maxStack = 8}};
				for (Value value : pair) {
					if (valueIsInteger(value))
						image.constants.emplace_back(asInteger(value));
					else
						image.constants.emplace_back(Blua32FloatConstant{valuePayload(value)});
				}
				writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
				writeInstruction(image.text, 1, static_cast<u8>(OpCode::LOADK), 1, 0, 1);
				const int b = form & 1 ? -1 : 0, c = unary ? 0 : form & 2 ? -2 : 1;
				writeInstruction(image.text, 2, static_cast<u8>(op), 2, static_cast<u8>(b), static_cast<u8>(c),
					static_cast<u8>(((b >> 6) & 7) << 3) | ((c >> 6) & 7));
				writeInstruction(image.text, 3, static_cast<u8>(OpCode::RET), 2, 2, 0);
				writeInstruction(image.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
				Number32Machine m(image);
				require(m.cpu.runUntilDepth(0, 1000) == RunResult::Halted, "typed operand function returns");
				const auto results = m.cpu.readCompletionValues();
				if (results.size() != 1 || results.get(0) != expected) {
					std::cerr << "typed op " << static_cast<int>(op) << " form " << form << " inputs " << std::hex
							  << pair[0] << ',' << pair[1] << std::dec << '\n';
					throw std::runtime_error("native cache/RK operands match Integer/Float semantics");
				}
#if defined(BMSX_NATIVE_GATE_PROFILE)
				if (m.cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::Return)].entries == 0) {
					std::cerr
						<< "not native op " << static_cast<int>(op) << " form " << form << " bytes "
						<< m.cpu.readNativeCompilationProfile().codeBytes << " scalar "
						<< m.cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::ScalarBoundary)].entries
						<< '\n';
					throw std::runtime_error("typed operands must enter generated code");
				}
#endif
			}
	}
}

void typedNativeComparisons() {
	const Value values[] = {valueInteger(INT32_MIN), valueInteger(INT32_MAX), valueInteger(16777217),
		valueFloat(16777216.0f), valueFloatBits(0x4f000000), valueFloatBits(0x7fa12345), valueFloatBits(0xffc00000),
		valueFloatBits(0x80000000), valueFloatBits(1), valueInteger(0)};
	for (auto op : {OpCode::EQ, OpCode::LT, OpCode::LE})
		for (Value left : values)
			for (Value right : values) {
				for (int form = 0; form < 4; ++form) {
					auto image = operation(op);
					const auto old = image.text;
					image.text.resize(old.size() + 2 * INSTRUCTION_BYTES);
					std::copy(old.begin(), old.end(), image.text.begin() + 2 * INSTRUCTION_BYTES);
					image.functions[0].wordCount += 2;
					image.functions[1].firstWord += 2;
					for (Value value : {left, right}) {
						if (valueIsInteger(value))
							image.constants.emplace_back(asInteger(value));
						else
							image.constants.emplace_back(Blua32FloatConstant{valuePayload(value)});
					}
					writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
					writeInstruction(image.text, 1, static_cast<u8>(OpCode::LOADK), 1, 0, 1);
					const int b = form & 1 ? -1 : 0, c = form & 2 ? -2 : 1;
					writeInstruction(image.text, 2, static_cast<u8>(op), 1, static_cast<u8>(b), static_cast<u8>(c),
						static_cast<u8>(((b >> 6) & 7) << 3) | ((c >> 6) & 7));
					Number32Machine m(image);
					m.cpu.runUntilDepth(0, 100);
					const auto order = compareNumbers(left, right);
					const bool expected = op == OpCode::EQ	 ? order == NumericOrder::Equal
										  : op == OpCode::LT ? order == NumericOrder::Less
															 : static_cast<int>(order) <= 0;
					require(m.cpu.readCompletionValues().get(0) == valueBool(expected),
						"typed compare/RK operands preserve exact mixed ordering, NaNs and fused jumps");
					const int cycles =
						2 * BASE_CYCLES[static_cast<u8>(OpCode::LOADK)] + BASE_CYCLES[static_cast<u8>(op)] +
						2 * BASE_CYCLES[static_cast<u8>(OpCode::JMP)] + BASE_CYCLES[static_cast<u8>(OpCode::RET)] +
						1; // One result placed in the completion latch.
					if (m.cpu.instructionBudgetRemaining != 100 - cycles)
						std::cerr << "compare budget " << m.cpu.instructionBudgetRemaining << " expected "
								  << 100 - cycles << " op " << static_cast<int>(op) << " form " << form << " truth "
								  << expected << "\n";
					require(m.cpu.instructionBudgetRemaining == 100 - cycles,
						"both fused compare/jump outcomes retain the exact cycle charge");
#if defined(BMSX_NATIVE_GATE_PROFILE)
					require(m.cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::Return)].entries != 0,
						"typed comparisons must execute generated code");
#endif
				}
			}
}

void nativeOperandFaultPrefix() {
	auto image = operation(OpCode::MOV);
	image.text.resize(4 * INSTRUCTION_BYTES);
	image.constants = {i32{17}};
	image.functions = {
		{.firstWord = 0, .wordCount = 3, .maxStack = 8}, {.firstWord = 3, .wordCount = 1, .maxStack = 8}};
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 2, 0, 1);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::RET), 2, 2, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	Number32Machine m(image);
	m.cpu.activeThread()->currentFrame->registers.set(2, valueInteger(917));
	m.cpu.runUntilDepth(0, 5);
	require(m.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT,
		"native known-type contradiction takes the exact guest fault");
	require(m.cpu.readFrameRegister(0, 0) == valueInteger(17) && m.cpu.readFrameRegister(0, 2) == valueInteger(917),
		"native cold fault publishes only the completed prefix");
#if defined(BMSX_NATIVE_GATE_PROFILE)
	require(m.cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::InvalidOperand)].entries == 1,
		"fault must execute the generated cold path");
#endif
}

void memoryWords() {
	for (auto kind :
		{MemoryAccessKind::Word, MemoryAccessKind::U32LE, MemoryAccessKind::F32LE, MemoryAccessKind::F64LE}) {
		auto image = operation(OpCode::LOAD_MEM);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOAD_MEM), 2, 0, static_cast<u8>(kind));
		Number32Machine m(image);
		const u32 address = DYNAMIC_RAM_BASE + 0x200;
		m.memory.writeMappedU32LE(address, kind == MemoryAccessKind::F32LE ? 0xffa12345u : 0xffffffffu);
		if (kind == MemoryAccessKind::F64LE)
			m.memory.writeMappedF64LE(address, 16777217.0);
		m.cpu.activeThread()->currentFrame->registers.set(0, valueInteger(address));
		m.cpu.runUntilDepth(0, 1);
		const Value expected = kind == MemoryAccessKind::F32LE	 ? valueFloatBits(0xffa12345u)
							   : kind == MemoryAccessKind::F64LE ? valueFloat(16777216.0f)
																 : valueInteger(-1);
		require(m.cpu.readFrameRegister(0, 2) == expected,
			"scalar load produces a signed word or raw/rounded Float as specified");
		require(m.cpu.instructionBudgetRemaining ==
					1 - BASE_CYCLES[static_cast<u8>(OpCode::LOAD_MEM)] - (kind == MemoryAccessKind::F64LE ? 2 : 0),
			"F64 second-word transfer is charged exactly once");
	}
	for (auto kind : {MemoryAccessKind::Word, MemoryAccessKind::F32LE, MemoryAccessKind::F64LE}) {
		auto image = operation(OpCode::STORE_MEM);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::STORE_MEM), 2, 0, static_cast<u8>(kind));
		Number32Machine m(image);
		const u32 address = DYNAMIC_RAM_BASE + 0x300;
		auto regs = m.cpu.activeThread()->currentFrame->registers;
		regs.set(0, valueInteger(address));
		regs.set(2, kind == MemoryAccessKind::F32LE ? valueFloatBits(0xffa12345) : valueInteger(-1));
		m.cpu.runUntilDepth(0, 1);
		if (kind == MemoryAccessKind::F64LE)
			require(m.memory.readMappedF64LE(address) == -1.0, "external binary64 encoding widens Integer exactly");
		else
			require(m.memory.readMappedU32LE(address) == (kind == MemoryAccessKind::F32LE ? 0xffa12345u : 0xffffffffu),
				"word/F32 store preserves all bits");
	}
	for (auto op : {OpCode::LOAD_MEM, OpCode::STORE_MEM}) {
		auto image = operation(op);
		writeInstruction(image.text, 0, static_cast<u8>(op), 2, 0, static_cast<u8>(MemoryAccessKind::F64LE));
		Number32Machine m(image);
		m.cpu.activeThread()->currentFrame->registers.set(0, valueInteger(DYNAMIC_RAM_BASE + 1));
		m.cpu.runUntilDepth(0, 1);
		require(m.cpu.instructionBudgetRemaining == -4, "even alignment faults retain the started F64 format charge");
	}
	for (auto op : {OpCode::LOAD_MEM, OpCode::LOAD_MEM_D, OpCode::STORE_MEM, OpCode::STORE_MEM_D})
		for (Value address : {valueNil(), valueBool(true), valueFloatBits(0x7fc00000), valueFloatBits(0x7f800000)}) {
			Number32Machine m(operation(op, static_cast<u32>(MemoryAccessKind::F64LE)));
			auto regs = m.cpu.activeThread()->currentFrame->registers;
			regs.set(0, address);
			regs.set(2, valueInteger(917));
			m.cpu.runUntilDepth(0, 1);
			require(m.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT,
				"F64 address conversion reports the operand fault");
			require(m.cpu.instructionBudgetRemaining == -4,
				"F64 charges its second transfer before even address conversion can fail");
			require(m.cpu.readFrameRegister(0, 2) == valueInteger(917),
				"address conversion faults do not touch the value slot");
		}
}

test::Blua32TestImage constantImage() {
	auto image = operation(OpCode::LOADK);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 2, 0, 1);
	image.constants = {i32{2}, Blua32FloatConstant{0xffa12345}};
	image.globalNames = {"saved", "graph"};
	image.systemGlobalNames = {"system"};
	return image;
}
test::Blua32TestImage regionImage(const std::string& name) {
	struct Instruction {
		OpCode op;
		u8 a, b, c, ext = 0;
	};
	std::vector<Instruction> program;
	if (name == "chain")
		program = {{OpCode::MOV, 8, 0, 0}, {OpCode::ADD, 2, 0, 1}, {OpCode::SHL, 3, 2, 4}, {OpCode::BXOR, 2, 3, 5},
			{OpCode::UNM, 3, 2, 0}, {OpCode::MUL, 2, 3, 1}, {OpCode::DIV, 3, 2, 1}, {OpCode::UNM, 3, 3, 0},
			{OpCode::SETGL, 3, 0, 0}, {OpCode::GETGL, 4, 0, 0}, {OpCode::RET, 2, 4, 0}};
	else if (name == "table")
		program = {{OpCode::MOV, 8, 0, 0}, {OpCode::SETI, 8, 1, 1}, {OpCode::GETI, 2, 8, 1},
			{OpCode::SETFIELD, 8, 0, 2}, {OpCode::GETFIELD, 3, 8, 0}, {OpCode::SELF, 4, 8, 0}, {OpCode::GETT, 6, 8, 7},
			{OpCode::LEN, 9, 8, 0}, {OpCode::RET, 2, 9, 0}};
	else if (name == "upvalue")
		program = {{OpCode::MOV, 8, 0, 0}, {OpCode::GETUP, 20, 0, 0}, {OpCode::MOV, 21, 20, 0},
			{OpCode::SETUP, 1, 0, 0}, {OpCode::GETUP, 22, 0, 0}, {OpCode::RET, 20, 4, 0}};
	else if (name == "words")
		program = {{OpCode::MOV, 8, 0, 0}, {OpCode::STORE_MEM_WORDS, 1, 8, 3}, {OpCode::RET, 1, 4, 0}};
	else if (name == "control")
		program = {{OpCode::MTC0, 0, COP0_EPC, 0}, {OpCode::MFC0, 2, COP0_EPC, 0}, {OpCode::LOADKR, 3, 1, 0},
			{OpCode::RET, 2, 3, 0}};
	else if (name == "loop")
		program = {{OpCode::MOV, 8, 0, 0}, {OpCode::ADD, 2, 2, 1}, {OpCode::SUB, 0, 0, 1}, {OpCode::LE, 0, 0, 3},
			{OpCode::JMP, 0, 63, 60, 255}, {OpCode::RET, 2, 2, 0}};
	else if (name == "typed-loop")
		program = {{OpCode::LOADK, 0, 0, 0}, {OpCode::K1, 1, 0, 0}, {OpCode::K0, 2, 0, 0}, {OpCode::LOADK, 3, 0, 1},
			{OpCode::LOADK, 4, 0, 2}, {OpCode::K0, 5, 0, 0}, {OpCode::ADD, 2, 2, 1}, {OpCode::ADD, 3, 3, 4},
			{OpCode::SUB, 0, 0, 1}, {OpCode::LE, 0, 0, 5}, {OpCode::JMP, 0, 63, 59, 255}, {OpCode::RET, 2, 3, 0}};
	else if (name == "memory")
		program = {{OpCode::LOAD_MEM, 2, 0, static_cast<u32>(MemoryAccessKind::F64LE)}, {OpCode::MOV, 6, 2, 0},
			{OpCode::STORE_MEM, 2, 1, static_cast<u32>(MemoryAccessKind::F64LE)},
			{OpCode::LOAD_MEM, 3, 1, static_cast<u32>(MemoryAccessKind::F32LE)}, {OpCode::RET, 2, 6, 0}};
	else
		throw std::runtime_error("unknown CPU32 region fixture");
	test::Blua32TestImage image;
	image.text.resize((program.size() + 1) * INSTRUCTION_BYTES);
	for (u32 i = 0; i < program.size(); ++i)
		writeInstruction(
			image.text, i, static_cast<u8>(program[i].op), program[i].a, program[i].b, program[i].c, program[i].ext);
	writeInstruction(image.text, static_cast<u32>(program.size()), static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = static_cast<u32>(program.size()), .numParams = 8, .maxStack = 24},
		{.firstWord = static_cast<u32>(program.size()), .wordCount = 1, .maxStack = 8}};
	image.exceptionFunctionIndex = 1;
	image.constants = {std::string("field")};
	if (name == "typed-loop")
		image.constants = {i32{3}, Blua32FloatConstant{0x3f800000}, Blua32FloatConstant{0x3e800000}};
	image.globalNames = {"saved"};
	return image;
}
void scalarRegions() {
	for (const char* name : {"chain", "memory", "table", "words", "control", "loop"}) {
		Number32Machine m(regionImage(name));
		auto r = m.cpu.activeThread()->currentFrame->registers;
		r.set(0, valueInteger(3));
		r.set(1, valueInteger(2));
		r.set(2, valueInteger(0));
		r.set(3, valueInteger(0));
		r.set(4, valueInteger(1));
		r.set(5, valueInteger(7));
		if (std::string(name) == "memory") {
			r.set(0, valueInteger(DYNAMIC_RAM_BASE + 0x100));
			r.set(1, valueInteger(DYNAMIC_RAM_BASE + 0x200));
			m.memory.writeMappedF64LE(DYNAMIC_RAM_BASE + 0x100, 16777217.0);
		} else if (std::string(name) == "table") {
			auto* table = m.cpu.createTable(1, 1);
			r.set(0, valueTable(m.cpu.gcHeap().reference(table)));
			r.set(7, valueFloat(1));
		} else if (std::string(name) == "words")
			r.set(0, valueInteger(DYNAMIC_RAM_BASE + 0x200));
		else if (std::string(name) == "control") {
			r.set(0, valueInteger(INT32_MIN));
			r.set(1, valueFloat(0));
		} else if (std::string(name) == "loop")
			r.set(1, valueInteger(1));
		m.cpu.runUntilDepth(0, 1000);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS) && defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		if (std::string(name) == "table") {
			const auto& profile = m.cpu.diagnosticExecutionProfile();
			require(profile.nativeOpcodes.setfield == 1 && profile.interpreterOpcodes.setfield == 0,
				"generated instruction attempts retain their native diagnostic attribution");
		}
#endif
		auto results = m.cpu.readCompletionValues();
		if (std::string(name) == "chain")
			require(results.size() == 3 && results.get(0) == valueInteger(-26) && results.get(1) == valueFloat(13) &&
						results.get(2) == valueFloat(13),
				"typed arithmetic/globals chain");
		if (std::string(name) == "table")
			require(results.size() == 8 && results.get(0) == valueInteger(2) && results.get(1) == valueInteger(2) &&
						results.get(7) == valueInteger(1),
				"Table opcode chain");
		if (std::string(name) == "memory")
			require(results.get(0) == valueFloat(16777216) &&
						m.memory.readMappedF64LE(DYNAMIC_RAM_BASE + 0x200) == 16777216.0,
				"external F64 transfer chain");
		if (std::string(name) == "words")
			require(m.memory.readMappedU32LE(DYNAMIC_RAM_BASE + 0x200) == 2, "counted word stores");
		if (std::string(name) == "control")
			require(results.get(0) == valueInteger(INT32_MIN) && valueIsString(results.get(1)),
				"control words and indirect constant index");
		if (std::string(name) == "loop")
			require(results.get(0) == valueInteger(3), "word-addressed backward jump");
	}
}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void polymorphicForwardJoin() {
	Number32Machine machine(operation(OpCode::MOV), false);
	// Two independently callable predecessors define different kinds in R0.
	// The join is also a public entry, so even its first caller cannot own R0.
	const std::array ops{OpCode::K1, OpCode::JMP, OpCode::LOADK, OpCode::JMP, OpCode::MOV, OpCode::JMP};
	std::array<DecodedInstruction, 6> decoded{};
	std::array<NativeBlockInstruction, 6> instructions{};
	for (size_t i = 0; i < ops.size(); ++i) {
		auto& d = decoded[i];
		d.op = static_cast<u8>(ops[i]);
		d.width = 1;
		d.baseCycles = BASE_CYCLES[d.op];
		instructions[i] = {&d, 0x3000u + static_cast<u32>(i) * INSTRUCTION_BYTES};
	}
	decoded[1].bx = decoded[3].bx = instructions[4].pc;
	decoded[4].a = 1;
	decoded[5].bx = 0x4000u;
	const auto code = std::span(instructions);
	const std::array sources{NativeBlockSource{code.first(2)}, NativeBlockSource{code.subspan(2, 2)},
		NativeBlockSource{code.last(2)}};
	ValueSlots constants(1);
	constants.set(0, valueFloatBits(0xffa12345));
	auto& pool = machine.cpu.stringPool();
	size_t bytes = 0;
	auto blocks = NativeBlock::compileRegion(
		sources, constants.view(), NativeCodeBindings(machine.memory, pool, pool.intern("__index")));
	blocks.front()->region->publish(bytes);
	const std::array expected{valueInteger(1), constants.get(0), valueBool(true)};
	for (size_t i = 0; i < blocks.size(); ++i) {
		ValueSlots registers(2);
		registers.set(0, valueBool(true));
		NativeBlockRunState state{};
		state.registers = registers.view();
		state.remainingCycles = 100;
		require(blocks[i]->run(state) == &blocks.back()->terminal,
			"neither predecessor nor a public entry may deopt at a polymorphic forward join");
		require(registers.get(0) == expected[i] && registers.get(1) == expected[i],
			"a forward join transports both tag and payload, including raw Float NaNs");
		const int prefix = i == 2 ? 0 : blocks[i]->terminal.cycles;
		require(state.remainingCycles == 100 - prefix - blocks.back()->terminal.cycles,
			"each predecessor and the common suffix charge only their own instructions");
	}
}
#endif

void typedLoopBoundaries() {
	// A cold reference CPU visits each loop entry fewer than the native threshold.
	// The second CPU has the identical physical image precompiled, including
	// guarded public entries and the retained integer/F32 backedge maps.
	for (int variant = 0; variant < 3; ++variant)
		for (int grant = 1; grant <= 100; ++grant) {
			Number32Machine scalar(regionImage("typed-loop"), false), native(regionImage("typed-loop"));
			const auto execute = [&](Number32Machine& m) {
				auto* frame = m.cpu.activeThread()->currentFrame;
				for (int i = 0; i < 24; ++i)
					frame->registers.set(i, valueInteger(900 + i));
				if (variant != 0) {
					frame->pc += 6 * INSTRUCTION_BYTES;
					frame->registers.set(0, variant == 1 ? valueInteger(3) : valueFloat(3));
					frame->registers.set(1, variant == 1 ? valueInteger(1) : valueFloat(1));
					frame->registers.set(2, variant == 1 ? valueInteger(0) : valueFloat(0));
					frame->registers.set(3, valueFloatBits(0x3f800000));
					frame->registers.set(4, valueFloatBits(0x3e800000));
					frame->registers.set(5, valueInteger(0));
				}
				const auto result = m.cpu.runUntilDepth(0, grant);
				const bool active = m.cpu.activeThread()->currentFrame == frame;
				std::array<Value, 24> registers{};
				if (active)
					for (int i = 0; i < 24; ++i)
						registers[i] = frame->registers.get(i);
				std::vector<Value> values;
				const auto completed = m.cpu.readCompletionValues();
				for (size_t i = 0; i < completed.size(); ++i)
					values.push_back(completed.get(i));
				return std::tuple{result, m.cpu.instructionBudgetRemaining, active ? frame->pc : 0,
					active ? frame->top : 0, registers, values, m.cpu.readCauseWord(), m.cpu.readLuaFaultReasonWord(),
					m.cpu.lastPc};
			};
			const auto expected = execute(scalar), actual = execute(native);
			if (actual != expected) {
				std::cerr << "typed loop variant " << variant << " grant " << grant << '\n';
				throw std::runtime_error("native integer/F32 jump maps match the interpreter at every grant boundary");
			}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			require(scalar.cpu.readNativeCompilationProfile().codeBytes == 0,
				"cold loop reference executes only the interpreter");
#if defined(BMSX_NATIVE_GATE_PROFILE)
			if (grant == 100) {
				require(native.cpu.nativeGateProfile().exits[static_cast<size_t>(NativeBlockExit::Return)].entries != 0,
					"typed loop completes through generated code");
				if (variant != 2)
					require(native.cpu.nativeGateProfile()
									.exits[static_cast<size_t>(NativeBlockExit::ScalarBoundary)]
									.entries == 0,
						"matching integer/F32 loop proofs never fall back to the interpreter");
				else
					require(native.cpu.nativeGateProfile()
									.exits[static_cast<size_t>(NativeBlockExit::ScalarBoundary)]
									.entries != 0,
						"a changed public entry subtype declines its stale proof");
			}
#endif
#endif
		}
}

void constantsGlobalsAndRestore() {
	auto image = constantImage();
	Number32Machine m(image);
	m.cpu.setGlobalByKey(*m.cpu.stringPool().find("saved"), valueFloatBits(0xffa54321));
	m.cpu.setSystemGlobalByKey(*m.cpu.stringPool().find("system"), valueInteger(INT32_MIN));
	auto *graph = m.cpu.createTable(), *child = m.cpu.createTable();
	const auto self = m.cpu.stringPool().intern("self"), childKey = m.cpu.stringPool().intern("child");
	graph->setStringKey(self, valueTable(m.cpu.gcHeap().reference(graph)));
	graph->setStringKey(childKey, valueTable(m.cpu.gcHeap().reference(child)));
	child->setMetatable(graph);
	m.cpu.setGlobalByKey(*m.cpu.stringPool().find("graph"), valueTable(m.cpu.gcHeap().reference(graph)));
	const auto graphHash = graph->hashId, childHash = child->hashId;
	m.cpu.runUntilDepth(0, 1); // Stop after LOADK; retain the real active register graph.
	require(m.cpu.readFrameRegister(0, 2) == valueFloatBits(0xffa12345), "Float constant preserves signaling NaN bits");
	const auto state = m.cpu.captureRuntimeState();
	const auto ram = m.memory.captureSaveState();
	m.cpu.activeThread()->currentFrame->registers.set(2, valueInteger(8));
	m.cpu.setGlobalByKey(*m.cpu.stringPool().find("saved"), valueInteger(7));
	for (int i = 0; i < 10; ++i)
		m.cpu.createTable();
	m.memory.restoreSaveState(ram);
	m.cpu.restoreRuntimeState(state);
	require(m.cpu.readFrameRegister(0, 2) == valueFloatBits(0xffa12345), "frame restore preserves raw Float word");
	require(m.cpu.getGlobalByKey(*m.cpu.stringPool().find("saved")) == valueFloatBits(0xffa54321),
		"compact global restore preserves raw Float word");
	require(m.cpu.getSystemGlobalByKey(*m.cpu.stringPool().find("system")) == valueInteger(INT32_MIN),
		"system globals retain signed Integer identity");
	auto* restored = asTable(m.cpu.getGlobalByKey(*m.cpu.stringPool().find("graph")), m.cpu.gcHeap());
	auto* restoredChild = asTable(restored->getStringKey(childKey), m.cpu.gcHeap());
	require(restored->hashId == graphHash && restoredChild->hashId == childHash,
		"heap restore preserves hash identities independently of payload ids");
	require(asTable(restored->getStringKey(self), m.cpu.gcHeap()) == restored && restoredChild->metatable() == restored,
		"restore remaps cyclic Table and metatable edges");
	m.cpu.runUntilDepth(0, 100);
	require(m.cpu.readCompletionValues().get(0) == valueFloatBits(0xffa12345), "restored function returns exact words");
}
void tableHeap() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	auto *table = cpu.createTable(), *child = cpu.createTable();
	const Value root = valueTable(cpu.gcHeap().reference(table)), key = valueTable(cpu.gcHeap().reference(child));
	table->set(key, valueFloatBits(0xffa12345));
	table->set(valueFloat(2.0f), valueInteger(9));
	for (i32 i = 1; i <= 512; ++i)
		table->setStringKey(cpu.stringPool().intern("field" + std::to_string(i)), valueInteger(i));
	cpu.collectHeap(root);
	require(table->get(key) == valueFloatBits(0xffa12345), "compact Table traces raw heap references");
	require(table->getInteger(2) == valueInteger(9), "integral Float key normalizes into array");
	for (i32 i = 1; i <= 512; ++i)
		require(table->getStringKey(*cpu.stringPool().find("field" + std::to_string(i))) == valueInteger(i),
			"compact hash growth retains entries");
}
} // namespace
int main(int argc, char** argv) {
	if ((argc == 2 || ((argc == 3 || argc == 4) && std::string(argv[2]) == "--boot-primitives")) &&
		std::string(argv[1]) == "--execute-rom") {
		const std::vector<u8> bytes(std::istreambuf_iterator<char>(std::cin), {});
		Memory memory(MemoryInit{bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addresses(memory);
		CPU cpu(memory, irq, addresses);
		cpu.reset();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		cpu.prepareSystemNativeCode();
#endif
		if (argc >= 3)
			cpu.installBootPrimitives();
		cpu.runUntilDepth(0, argc == 4 ? std::stoi(argv[3]) : 100000);
		auto results = cpu.readCompletionValues();
		std::cout << "budget " << cpu.instructionBudgetRemaining << " fault " << cpu.readLuaFaultReasonWord() << "\n";
		for (size_t i = 0; i < results.size(); ++i) {
			const auto value = results.get(i);
			if (valueIsString(value))
				std::cout << "S " << cpu.stringPool().toString(asStringId(value)) << "\n";
			else
				std::cout << std::hex << static_cast<unsigned>(valueTag(value)) << ' ' << valuePayload(value) << "\n";
		}
		return 0;
	}
	if ((argc == 3 || argc == 4) && std::string(argv[1]) == "--rom") {
		auto image = operation(static_cast<OpCode>(std::stoul(argv[2])), argc == 4 ? std::stoul(argv[3]) : 1);
		const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
		std::cout.write(reinterpret_cast<const char*>(rom.bytes.data()), rom.bytes.size());
		return 0;
	}
	if (argc == 3 && std::string(argv[1]) == "--rom-region") {
		const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, regionImage(argv[2]));
		std::cout.write(reinterpret_cast<const char*>(rom.bytes.data()), rom.bytes.size());
		return 0;
	}
	if (argc == 2 && std::string(argv[1]) == "--rom-constants") {
		const auto rom = test::encodeBlua32TestRom(RomImageDomain::System, constantImage());
		std::cout.write(reinterpret_cast<const char*>(rom.bytes.data()), rom.bytes.size());
		return 0;
	}
	try {
		scalarNumbers();
		unaryAndCompare();
		wordMoves();
		typedNativeOperands();
		typedNativeComparisons();
		nativeOperandFaultPrefix();
		memoryWords();
		scalarRegions();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		polymorphicForwardJoin();
#endif
		typedLoopBoundaries();
		constantsGlobalsAndRestore();
		tableHeap();
		std::cout << "CPU32 typed execution, compact roots, snapshots and Table tests passed\n";
		return 0;
	} catch (const std::exception& e) {
		std::cerr << e.what() << '\n';
		return 1;
	}
}
