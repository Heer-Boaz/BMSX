#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/blua32/opcode.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/managed_fixture.h"
#include "support/table_allocation_reference.h"

#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

struct CpuMachine {
	test::Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;

	CpuMachine(const test::Blua32TestImage& image, bool instrumented)
		: rom(test::encodeManagedFixtureRom(image, test::RAM_CODE_FIXTURE_BYTES))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		test::seedManagedFixture(cpu, addresses, rom, image);
		if (instrumented) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, SYSTEM_EXECUTION_DOMAIN_MASK, 0u});
	}
};

void opcodeOperandInterpretations() {
	std::array<u8, OPCODE_COUNT> expected{};
	for (const OpCode op : {OpCode::SETT, OpCode::ADD, OpCode::SUB, OpCode::MUL,
		OpCode::DIV, OpCode::MOD, OpCode::FLOORDIV, OpCode::POW, OpCode::BAND,
		OpCode::BOR, OpCode::BXOR, OpCode::SHL, OpCode::SHR, OpCode::CONCAT,
		OpCode::EQ, OpCode::LT, OpCode::LE}) expected[static_cast<u8>(op)] = 3u;
	for (const OpCode op : {OpCode::LOAD_MEM, OpCode::STORE_MEM, OpCode::STORE_MEM_WORDS}) expected[static_cast<u8>(op)] = 1u;
	for (const OpCode op : {OpCode::GETT, OpCode::SETI, OpCode::SETFIELD}) expected[static_cast<u8>(op)] = 2u;
	require(OPCODE_RK_OPERANDS == expected, "every opcode selects the specified RK or raw operand interpretation");
}


void arithmeticFeedbackTransitions() {
	DecodedInstruction instruction{.op = static_cast<u8>(OpCode::SUB)};
	const auto one = valueInteger(1);
	const auto fraction = valueFloat(0.5f);
	const auto squared = valueInteger(4);
	const auto initial = instruction.nativeNumericTypes();
	require(!initial.observed() && !initial.stable(), "a decoded arithmetic site starts unseen");

	for (int i = 0; i < 3; ++i) instruction.observeNativeNumericTypes(squared, one);
	const auto candidate = instruction.nativeNumericTypes();
	require(candidate.observed() && !candidate.stable()
		&& candidate.left == ValueTag::Integer && candidate.right == ValueTag::Integer,
		"an unstable site still retains its observed operand tags");
	instruction.observeNativeNumericTypes(squared, one);
	require(instruction.nativeNumericTypes().stable(), "a repeated pair stabilizes at the confidence threshold");
	for (int i = 0; i < 32; ++i) instruction.observeNativeNumericTypes(squared, one);

	const auto copy = instruction;
	for (int i = 0; i < 2; ++i) {
		instruction.observeNativeNumericTypes(fraction, one);
		require(instruction.nativeNumericTypes().stable() && instruction.nativeNumericTypes().left == ValueTag::Integer,
			"a mature pair survives short contradictions");
	}
	instruction.observeNativeNumericTypes(fraction, one);
	require(!instruction.nativeNumericTypes().stable(), "contradictions can age the incumbent pair out of stability");
	for (int i = 0; i < 3; ++i) instruction.observeNativeNumericTypes(fraction, one);
	require(!instruction.nativeNumericTypes().stable(), "a replacement pair must establish its own confidence");
	instruction.observeNativeNumericTypes(fraction, one);
	require(instruction.nativeNumericTypes().stable() && instruction.nativeNumericTypes().left == ValueTag::Float
		&& copy.nativeNumericTypes().left == ValueTag::Integer,
		"a new pair can stabilize without changing a previously copied compilation snapshot");

	DecodedInstruction alternating{.op = static_cast<u8>(OpCode::ADD)};
	for (int i = 0; i < 32; ++i) {
		alternating.observeNativeNumericTypes(squared, one);
		require(!alternating.nativeNumericTypes().stable(), "alternating observations cannot confirm the first pair");
		alternating.observeNativeNumericTypes(squared, fraction);
		require(!alternating.nativeNumericTypes().stable(),
			"alternating observations never stabilize a numeric site");
	}
}

void signedRkBoundaries() {
	for (const bool instrumented : {false, true}) for (const bool wide : {false, true}) {
		const int limit = wide ? 16384 : 256;
		for (const auto [b, c] : {std::pair{limit - 1, -limit}, {-limit, limit - 1},
			{-limit, -1}, {limit - 1, 0}, {-1, -limit}, {0, limit - 1}}) {
			test::Blua32TestImage image;
			image.text.resize(3u * INSTRUCTION_BYTES);
			const u32 rawB = static_cast<u32>(b) & static_cast<u32>(2 * limit - 1);
			const u32 rawC = static_cast<u32>(c) & static_cast<u32>(2 * limit - 1);
			if (wide) writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, static_cast<u8>(rawB >> 9u), static_cast<u8>(rawC >> 9u));
			writeInstruction(image.text, wide ? 1 : 0, static_cast<u8>(OpCode::ADD), 0,
				static_cast<u8>(rawB & 63u), static_cast<u8>(rawC & 63u),
				static_cast<u8>(((rawB >> 6u) & 7u) << 3u | ((rawC >> 6u) & 7u)));
			writeInstruction(image.text, wide ? 2 : 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
			image.functions = {{.firstWord = 0, .wordCount = static_cast<u32>(wide ? 3 : 2), .maxStack = static_cast<u32>(limit)}};
			for (int i = 0; i < limit; ++i) image.constants.emplace_back(Blua32FloatConstant{numberToF32Bits(i + 0.25f)});
			CpuMachine machine(image, instrumented);
			auto registers = machine.cpu.activeThread()->frameAtDepth(0)->registers;
			for (int i = 0; i < limit; ++i) registers.set(i, valueFloat(-(i + 0.75)));
			const auto operand = [](int selector) { return selector < 0 ? (-1 - selector) + 0.25 : -(selector + 0.75); };
			require(machine.cpu.runUntilDepth(0, 1) == RunResult::Yielded, "an RK instruction retains its nominal charge");
			require(machine.cpu.readFrameRegister(0, 0) == valueFloat(operand(b) + operand(c)), "narrow and WIDE RK boundaries select the correct register or constant");
		}
	}
}

void rawFieldsAndInlineCaches() {
	for (const bool instrumented : {false, true}) {
		test::Blua32TestImage image;
		image.text.resize(13u * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 63, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::MOV), 0, 63, 0, 56);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 63, 32);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::SETI), 1, 63, 0, 56);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::WIDE), 0, 0, 63);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::GETI), 2, 1, 63, 7);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::WIDE), 0, 63, 32);
		writeInstruction(image.text, 7, static_cast<u8>(OpCode::SETFIELD), 1, 63, 0, 56);
		writeInstruction(image.text, 8, static_cast<u8>(OpCode::WIDE), 0, 0, 63);
		writeInstruction(image.text, 9, static_cast<u8>(OpCode::GETFIELD), 3, 1, 63, 7);
		writeInstruction(image.text, 10, static_cast<u8>(OpCode::WIDE), 0, 0, 63);
		writeInstruction(image.text, 11, static_cast<u8>(OpCode::SELF), 4, 1, 63, 7);
		writeInstruction(image.text, 12, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 13, .maxStack = 32768}};
		image.constants.resize(32768, i32{0});
		image.constants[16383] = Blua32FloatConstant{numberToF32Bits(101.5f)};
		image.constants[32767] = std::string("field-key");
		CpuMachine machine(image, instrumented);
		auto& cpu = machine.cpu;
		// Keep growth work separate from the operand and inline-cache base charges.
		TableRecord table = bmsx::test::allocateTableReference(cpu, 0, 2);
		auto registers = cpu.activeThread()->frameAtDepth(0)->registers;
		registers.set(1, valueTable(table.address()));
		registers.set(32767, valueFloat(91.5));
		const u32 pc = cpu.readFramePc(0);
		for (int pass = 0; pass < 2; ++pass) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], pc);
			const int charge = BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + BASE_CYCLES[static_cast<u8>(OpCode::SETI)]
				+ BASE_CYCLES[static_cast<u8>(OpCode::GETI)] + BASE_CYCLES[static_cast<u8>(OpCode::SETFIELD)]
				+ BASE_CYCLES[static_cast<u8>(OpCode::GETFIELD)] + BASE_CYCLES[static_cast<u8>(OpCode::SELF)];
			require(cpu.runUntilDepth(0, charge) == RunResult::Yielded && cpu.instructionBudgetRemaining == 0, "raw-field and cached-field instructions preserve their charges");
			require(cpu.readFrameRegister(0, 0) == valueFloat(91.5), "raw B retains its unsigned 15-bit register index");
			for (int destination : {2, 3, 4}) require(cpu.readFrameRegister(0, destination) == valueFloat(101.5), "raw integer/string keys and signed RK values remain independent of inline caches");
			require(cpu.readFrameRegister(0, 5) == valueTable(table.address()), "SELF preserves the original table");
		}
	}
}

void rewrittenPayloadVariants() {
	for (const bool instrumented : {false, true}) {
		test::Blua32TestImage image;
		image.text.resize(INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 4}};
		image.constants = {std::string("field"), Blua32FloatConstant{numberToF32Bits(73.5f)}};
		CpuMachine machine(image, instrumented);
		auto& cpu = machine.cpu;
		cpu.activeThread()->frameAtDepth(0)->registers.set(1, valueTable(bmsx::test::allocateTableReference(cpu).address()));
		cpu.activeThread()->frameAtDepth(0)->registers.set(2, valueFloat(81.5));
		std::array<u8, 2u * INSTRUCTION_BYTES> code{};
		for (const OpCode op : {OpCode::KSMI, OpCode::SETFIELD, OpCode::JMP, OpCode::GETFIELD, OpCode::LOADK, OpCode::KSMI}) {
			const u32 raw = op == OpCode::KSMI ? static_cast<u32>(MIN_SIGNED_BX) & MAX_EXT_BX : op == OpCode::JMP ? 3u : 1u;
			writeInstruction(code, 0, static_cast<u8>(OpCode::WIDE), 0, static_cast<u8>(raw >> BASE_BX_BITS), 0);
			writeInstruction(code, 1, static_cast<u8>(op), 0, static_cast<u8>((raw >> MAX_OPERAND_BITS) & MAX_LOW_OPERAND), static_cast<u8>(raw & MAX_LOW_OPERAND), static_cast<u8>(raw >> MAX_BX_BITS));
			if (op == OpCode::SETFIELD) writeInstruction(code, 1, static_cast<u8>(op), 1, 0, 2);
			if (op == OpCode::GETFIELD) writeInstruction(code, 1, static_cast<u8>(op), 3, 1, 0);
			machine.memory.writeBytes(DYNAMIC_RAM_BASE, code.data(), code.size());
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], DYNAMIC_RAM_BASE);
			require(cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(op)]) == RunResult::Yielded, "rewritten instruction executes at its actual charge");
			if (op == OpCode::KSMI) require(cpu.readFrameRegister(0, 0) == valueInteger(MIN_SIGNED_BX), "rewritten KSMI retains all 26 signed bits");
			if (op == OpCode::GETFIELD) require(cpu.readFrameRegister(0, 3) == valueFloat(81.5), "rewritten field opcode initializes its prediction instead of reading the previous branch payload");
			if (op == OpCode::LOADK) require(cpu.readFrameRegister(0, 0) == valueFloat(73.5), "rewritten unsigned Bx is independent of the previous inline cache");
			require(cpu.readFramePc(0) == DYNAMIC_RAM_BASE + (op == OpCode::JMP ? 20u : 8u), "rewritten branch keeps its precomputed absolute target");
		}
	}
}

void wideDisplacementsKeepTheirOwnOperandLanes() {
	for (const bool instrumented : {false, true}) {
		test::Blua32TestImage image;
		image.text.resize(2u * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 63, 63, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::LOAD_MEM_D), 63, 63, static_cast<u8>(MemoryAccessKind::U32LE), 255);
		image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 4096}};
		CpuMachine machine(image, instrumented);
		const u32 address = DYNAMIC_RAM_BASE + 0x1000u;
		machine.memory.writeMappedU32LE(address, 0x12345678u);
		machine.cpu.activeThread()->frameAtDepth(0)->registers.set(4095, valueInteger(address - (255u << 2u)));
		require(machine.cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::LOAD_MEM_D)]) == RunResult::Yielded && machine.cpu.instructionBudgetRemaining == 0, "WIDE displaced load retains its scalar charge");
		require(machine.cpu.readFrameRegister(0, 4095) == valueInteger(0x12345678u), "EXT is displacement, not ABC register extension; WIDE A/B retain all12bits");
	}
}

void wideDisplacedStoreCountRemainsUnsigned() {
	for (const bool instrumented : {false, true}) {
		test::Blua32TestImage image;
		image.text.resize(2u * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 63, 63);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::STORE_MEM_WORDS_D), 0, 63, 63, 255);
		image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 4096}};
		CpuMachine machine(image, instrumented);
		const u32 address = DYNAMIC_RAM_BASE + 0x4000u;
		auto registers = machine.cpu.activeThread()->frameAtDepth(0)->registers;
		for (int i = 1; i < 4094; ++i) registers.set(i, valueInteger(i));
		registers.set(0, valueInteger(0x10203040u));
		registers.set(4094, valueInteger(0xa1b2c3d4u));
		registers.set(4095, valueInteger(address - (255u << 2u)));
		const int charge = BASE_CYCLES[static_cast<u8>(OpCode::STORE_MEM_WORDS_D)] + 4095;
		require(machine.cpu.runUntilDepth(0, charge) == RunResult::Yielded && machine.cpu.instructionBudgetRemaining == 0, "WIDE counted store retains its complete count surcharge");
		require(machine.memory.readMappedWord(address) == 0x10203040u && machine.memory.readMappedWord(address + 4094u * 4u) == 0xa1b2c3d4u, "WIDE displacement B/C remain raw unsigned12-bit register/count fields");
		require(machine.memory.readMappedWord(address + 4095u * 4u) == 0u, "counted store writes exactly C words");
	}
}
} // namespace

int main() {
	try {
		opcodeOperandInterpretations(); arithmeticFeedbackTransitions(); signedRkBoundaries(); rawFieldsAndInlineCaches(); rewrittenPayloadVariants();
		wideDisplacementsKeepTheirOwnOperandLanes(); wideDisplacedStoreCountRemainsUnsigned();
		std::cout << "CPU decoded operand tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
