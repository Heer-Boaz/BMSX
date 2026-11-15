#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_execution.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/io.h"
#include "spec/blua32/numeric.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

struct Machine {
	Memory memory{MemoryInit{}, PSX_MACHINE_SPEC.ramBytes};
	IrqController irq{memory};
	ExecutionAddressSpace addresses{memory};
	CPU cpu{memory, irq, addresses};
};

struct Operation { OpCode op; u16 a = 0; i16 b = 0, c = 0; u32 bx = 0; };
struct Program {
	std::vector<DecodedInstruction> decoded;
	std::vector<NativeBlockInstruction> source;
	Program(std::initializer_list<Operation> operations, int width = 1) : decoded(operations.size()), source(operations.size()) {
		size_t index = 0;
		for (const auto& op : operations) {
			auto& d = decoded[index]; d.op = static_cast<u8>(op.op); d.a = op.a; d.b = op.b; d.c = op.c; d.bx = op.bx;
			d.width = width; d.baseCycles = BASE_CYCLES[d.op];
			source[index] = {&d, 0x1000u + static_cast<u32>(index * width) * INSTRUCTION_BYTES}; ++index;
		}
	}
	std::unique_ptr<NativeBlock> compile(Machine& machine, size_t& bytes, const Value* constants = nullptr) {
		return NativeBlock::compile(source, constants, bytes, machine.memory, machine.cpu.stringPool(), machine.cpu.stringPool().intern("__index"));
	}
};

void fanoutAndHomeReplacement(Machine& machine) {
	const std::array values{valueNumber(-0.0), VALUE_QNAN_MASK | 0x2au,
		valueFromTag(ValueTag::False, 73), valueString(machine.cpu.stringPool().intern("raw aliases")),
		valueTable(machine.cpu.createTable()), Value{0xfff0000000000001ULL}};
	for (const int base : {0, 512}) for (const bool helper : {false, true}) {
		Program program{{{OpCode::MOV, static_cast<u16>(base + 20), static_cast<i16>(base + 12)},
			{OpCode::MOV, static_cast<u16>(base + 21), static_cast<i16>(base + 12)},
			{OpCode::MOV, static_cast<u16>(base + 22), static_cast<i16>(base + 20)},
			{OpCode::MOV, static_cast<u16>(base + 23), static_cast<i16>(base + 21)},
			{OpCode::MOV, static_cast<u16>(base + 24), static_cast<i16>(base + 12)},
			{OpCode::LOADK, static_cast<u16>(base + 12), 0, 0, 0},
			{OpCode::MOV, static_cast<u16>(base + 25), static_cast<i16>(base + 20)},
			{OpCode::LOADK, static_cast<u16>(base + 20), 0, 0, 1},
			{OpCode::MOV, static_cast<u16>(base + 26), static_cast<i16>(base + 21)},
			{OpCode::MOV, static_cast<u16>(base + 27), static_cast<i16>(base + 12)},
			{helper ? OpCode::MOD : OpCode::ADD, static_cast<u16>(base + 4), -3, -4},
			{OpCode::JMP, 0, 0, 0, 0x2000}}, base == 0 ? 1 : 2};
		const std::array constants{valueFromTag(ValueTag::True, 19), valueNumber(-17.5), valueNumber(17), valueNumber(3)};
		size_t bytes = 0;
		{
			auto block = program.compile(machine, bytes, constants.data());
			for (Value value : values) {
				std::array<Value, 544> actual; actual.fill(valueFromTag(ValueTag::False, 91)); actual[base + 12] = value;
				auto expected = actual;
				for (int destination : {21, 22, 23, 24, 25, 26}) expected[base + destination] = value;
				expected[base + 12] = constants[0]; expected[base + 20] = constants[1]; expected[base + 27] = constants[0];
				expected[base + 4] = valueNumber(helper ? luaModulo(17, 3) : 20);
				NativeBlockRunState run{.registers = actual.data(), .constants = constants.data(), .remainingCycles = block->terminal.cycles, .registerTop = 1};
				require(block->run(run) == &block->terminal && actual == expected && run.remainingCycles == 0 && run.registerTop == base + 28,
					"raw aliases preserve the original source after its bank home and another alias are independently overwritten");
			}
		}
		require(bytes == 0, "value-definition planning does not retain executable storage");
	}
}

void independentEntriesAndPartialRanges(Machine& machine) {
	Program program{{{OpCode::MOV, 20, 12}, {OpCode::MOV, 21, 12}, {OpCode::JMP},
		{OpCode::MOV, 24, 12}, {OpCode::MOV, 25, 20}, {OpCode::MOV, 26, 21},
		{OpCode::LOADNIL, 20, 1}, {OpCode::MOV, 27, 21}, {OpCode::JMP, 0, 0, 0, 0x2000}}};
	program.decoded[2].bx = program.source[3].pc;
	const std::span source(program.source);
	const std::array plans{NativeBlockSource{source.first(3)}, NativeBlockSource{source.subspan(3)}};
	size_t bytes = 0;
	auto blocks = NativeBlock::compileRegion(plans, nullptr, NativeCodeBindings(machine.memory, machine.cpu.stringPool(), machine.cpu.stringPool().intern("__index")));
	blocks.front()->region->publish(bytes);
	const std::array values{valueNumber(-0.0), valueFromTag(ValueTag::False, 47), valueTable(machine.cpu.createTable())};
	for (const bool equal : {true, false}) for (size_t entry = 0; entry < blocks.size(); ++entry) {
		std::array<Value, 32> actual; actual.fill(valueFromTag(ValueTag::True, 83));
		actual[12] = values[0]; actual[20] = values[equal ? 0 : 1]; actual[21] = values[equal ? 0 : 2];
		auto expected = actual;
		if (entry == 0) expected[20] = expected[21] = expected[12];
		expected[24] = expected[12]; expected[25] = expected[20]; expected[26] = expected[27] = expected[21]; expected[20] = valueNil();
		int cycles = blocks[entry]->terminal.cycles;
		if (entry == 0) cycles += blocks[1]->terminal.cycles;
		NativeBlockRunState run{.registers = actual.data(), .remainingCycles = cycles, .registerTop = 1};
		require(blocks[entry]->run(run) == &blocks[1]->terminal && actual == expected && run.remainingCycles == 0 && run.registerTop == 28,
			"a public entry starts with independent slot values even when an internal predecessor established aliases");
	}
}

void openRangesAndSelfUpvalues(Machine& machine) {
	const Value raw = valueFromTag(ValueTag::False, 73);
	for (int count : {0, 1, 5}) {
		Program program{{{OpCode::MOV, 20, 12}, {OpCode::MOV, 21, 12}, {OpCode::MOV, 22, 12},
			{OpCode::VARARG, 20, 0}, {OpCode::LOADKR, 31, 0}}};
		std::array<Value, 64> stack; stack.fill(valueFromTag(ValueTag::True, 19));
		CallFrame frame; frame.registers = stack.data() + 8; frame.stackCapacity = 32; frame.varargCount = count;
		for (int index = 0; index < count; ++index) frame.registers[index - count] = valueNumber(index + 7);
		frame.registers[12] = raw; frame.registers[0] = valueNumber(9);
		auto expected = stack; auto* result = expected.data() + 8;
		result[20] = result[21] = result[22] = raw;
		for (int index = 0; index < count; ++index) result[20 + index] = valueNumber(index + 7);
		size_t bytes = 0; auto block = program.compile(machine, bytes);
		NativeBlockRunState run{.registers = frame.registers, .frame = &frame, .constantCount = 0, .remainingCycles = 100, .registerTop = 32};
		const auto* exit = block->run(run);
		require(exit->exit == NativeBlockExit::InvalidConstant && exit->currentPc == program.source[4].pc
			&& stack == expected && run.registerTop == 20 + count && run.remainingCycles == 100 - exit->cycles - count,
			"an open range preserves every untouched raw alias above its lowered top at the next fault frontier");
	}
	for (const bool store : {false, true}) {
		Program program{{{OpCode::MOV, 20, 12}, {OpCode::MOV, 21, 12}, {OpCode::MOV, 22, 12},
			{store ? OpCode::SETUP : OpCode::GETUP, 23, 0}, {OpCode::JMP, 0, 0, 0, 0x2000}}};
		std::array<Value, 32> actual; actual.fill(valueFromTag(ValueTag::True, 19)); actual[12] = raw; actual[23] = valueNumber(91);
		auto expected = actual; expected[20] = expected[21] = expected[22] = raw;
		CallFrame frame; frame.registers = actual.data(); frame.stackCapacity = actual.size();
		Upvalue upvalue; upvalue.open = true; upvalue.index = 21; upvalue.frame = &frame;
		Upvalue* pointer = &upvalue; Closure closure; closure.upvalues = &pointer; closure.upvalueCount = 1; frame.closure = &closure;
		size_t bytes = 0; auto block = program.compile(machine, bytes);
		NativeBlockRunState run{.registers = actual.data(), .frame = &frame, .remainingCycles = 100, .registerTop = 1};
		const auto* exit = block->run(run);
		if (!store) expected[23] = raw;
		require((store ? exit->exit == NativeBlockExit::WriteUpvalue : exit == &block->terminal) && actual == expected
			&& run.remainingCycles == 100 - exit->cycles && run.registerTop == (store ? 23 : 24),
			"self-frame upvalue reads and pre-write exits publish all dirty aliases before touching the indexed cell");
	}
}

void receiverCopyPrecedesReadFault(Machine& machine) {
	Program program{{{OpCode::MOV, 20, 12}, {OpCode::MOV, 21, 12}, {OpCode::MOV, 22, 12},
		{OpCode::SELF, 20, 0, 0}, {OpCode::JMP, 0, 0, 0, 0x2000}}};
	const std::array constants{valueString(machine.cpu.stringPool().intern("field"))};
	std::array<Value, 32> actual; actual.fill(valueFromTag(ValueTag::True, 31));
	actual[12] = VALUE_QNAN_MASK | 37u; actual[0] = valueFromTag(ValueTag::False, 19);
	auto expected = actual; expected[20] = expected[22] = actual[12]; expected[21] = actual[0];
	size_t bytes = 0; auto block = program.compile(machine, bytes, constants.data());
	NativeBlockRunState run{.registers = actual.data(), .constants = constants.data(), .remainingCycles = 100, .registerTop = 1};
	const auto* exit = block->run(run);
	require(exit->exit == NativeBlockExit::ReadField && exit->currentPc == program.source[3].pc && actual == expected
		&& run.remainingCycles == 100 - exit->cycles && run.registerTop == 23,
		"SELF detaches only its receiver-copy destination before a typed read fault, leaving the failed result and other aliases intact");
}

void untakenSelfPublicationRetainsDirtyAliases(Machine& machine) {
	Program program{{{OpCode::MOV, 20, 12}, {OpCode::MOV, 21, 12}, {OpCode::MOV, 22, 12},
		{OpCode::MOV, 24, 12}, {OpCode::MOV, 25, 12}, {OpCode::GETUP, 23, 0}, {OpCode::LOADKR, 31, 0}}};
	for (bool openOuter : {false, true}) {
		std::array<Value, 32> actual; actual.fill(valueFromTag(ValueTag::True, 19)); actual[12] = VALUE_QNAN_MASK | 73u;
		actual[0] = valueNumber(99);
		std::array<Value, 32> outerRegisters; outerRegisters.fill(valueNumber(-15));
		const Value cellValue = valueFromTag(ValueTag::False, 29); outerRegisters[21] = cellValue;
		CallFrame frame, outer; frame.registers = actual.data(); frame.stackCapacity = actual.size(); outer.registers = outerRegisters.data();
		Upvalue upvalue; upvalue.open = openOuter; upvalue.index = 21; upvalue.frame = &outer; upvalue.value = cellValue;
		Upvalue* pointer = &upvalue; Closure closure; closure.upvalues = &pointer; closure.upvalueCount = 1; frame.closure = &closure;
		auto expected = actual;
		for (int slot : {20, 21, 22, 24, 25}) expected[slot] = actual[12];
		expected[23] = cellValue;
		size_t bytes = 0; auto block = program.compile(machine, bytes);
		NativeBlockRunState run{.registers = actual.data(), .frame = &frame, .constantCount = 0, .remainingCycles = 100, .registerTop = 1};
		const auto* exit = block->run(run);
		require(exit->exit == NativeBlockExit::InvalidConstant && exit->currentPc == program.source[6].pc && actual == expected
			&& run.remainingCycles == 100 - exit->cycles && run.registerTop == 26,
			"an untaken GETUP self-publication path cannot mark dirty aliases bank-clean before the closed or outer read rejoins a real fault");
	}
}

void tableConstantSurvivesTypeFacts(Machine& machine) {
	const auto key = machine.cpu.stringPool().intern("constant field"); auto* table = machine.cpu.createTable(0, 1);
	const std::array constants{valueTable(table), valueString(key)};
	Program program{{{OpCode::LOADK, 12, 0, 0, 0}, {OpCode::MOV, 20, 12}, {OpCode::MOV, 21, 12},
		{OpCode::GETFIELD, 23, 20, 1}, {OpCode::SELF, 24, 21, 1}, {OpCode::MOV, 26, 12}, {OpCode::JMP, 0, 0, 0, 0x2000}}};
	size_t bytes = 0; auto block = program.compile(machine, bytes, constants.data());
	for (const Value payload : {valueFromTag(ValueTag::False, 37), valueNumber(-0.0), valueString(key)}) {
		table->setStringKey(key, payload);
		std::array<Value, 32> actual; actual.fill(valueFromTag(ValueTag::True, 91)); auto expected = actual;
		for (int slot : {12, 20, 21, 25, 26}) expected[slot] = constants[0];
		expected[23] = expected[24] = payload;
		NativeBlockRunState run{.registers = actual.data(), .constants = constants.data(), .remainingCycles = 100, .registerTop = 1};
		require(block->run(run) == &block->terminal && actual == expected && run.remainingCycles == 100 - block->terminal.cycles && run.registerTop == 27,
			"a proven Table type retains the original raw constant as an alias restore source and still reads current mutable fields");
	}
}

void inheritedTableFactsAndIndependentJoin(Machine& machine) {
	Program program{{{OpCode::MOV, 20, 12}, {OpCode::MOV, 21, 12}, {OpCode::GETFIELD, 23, 20, 0},
		{OpCode::GETFIELD, 24, 21, 0}, {OpCode::GETFIELD, 25, 12, 0}, {OpCode::JMP, 0, 0, 0, 0x2000}, {OpCode::JMP}}};
	program.decoded[6].bx = program.source[3].pc;
	const std::span source(program.source);
	const std::array plans{NativeBlockSource{source.first(3), nullptr, true}, NativeBlockSource{source.subspan(3, 3)}, NativeBlockSource{source.subspan(6)}};
	const auto key = machine.cpu.stringPool().intern("field"), indexKey = machine.cpu.stringPool().intern("__index");
	const std::array constants{valueString(key)};
	for (bool inheritedLookup : {false, true}) {
		auto* first = machine.cpu.createTable(0, 1); auto* second = machine.cpu.createTable(0, 1);
		second->setStringKey(key, valueNumber(-0.0));
		Table* fields = first;
		if (inheritedLookup) {
			fields = machine.cpu.createTable(0, 1); auto* meta = machine.cpu.createTable(0, 1);
			meta->setStringKey(indexKey, valueTable(fields)); first->metatable = meta;
		}
		const Value payload = valueFromTag(ValueTag::False, 37); fields->setStringKey(key, payload);
		size_t bytes = 0;
		auto blocks = NativeBlock::compileRegion(plans, constants.data(), NativeCodeBindings(machine.memory, machine.cpu.stringPool(), indexKey));
		blocks.front()->region->publish(bytes);
		for (int entry = 0; entry < 3; ++entry) for (int invalid = 0; invalid <= (entry == 0 ? 0 : 2); ++invalid) {
			std::array<Value, 32> actual; actual.fill(valueNumber(-37));
			actual[12] = valueTable(entry == 0 ? first : second); actual[21] = valueTable(first);
			if (invalid == 1) actual[21] = valueBool(false);
			if (invalid == 2) actual[12] = valueBool(false);
			const auto initial = actual;
			auto expected = actual;
			if (entry == 0) { expected[20] = expected[21] = expected[12]; expected[23] = payload; }
			if (invalid != 1) expected[24] = payload;
			if (invalid == 0) expected[25] = entry == 0 ? payload : valueNumber(-0.0);
			NativeBlockRunState run{.registers = actual.data(), .constants = constants.data(), .remainingCycles = 100, .registerTop = 1};
			const auto* exit = blocks[entry]->run(run);
			if (invalid != 0) {
				require(exit->exit == NativeBlockExit::ScalarBoundary && run.scalarPc == program.source[3].pc && actual == initial
					&& run.registerTop == 1 && run.remainingCycles == 100 - (entry == 2 ? blocks[2]->terminal.cycles : 0),
					"a failed canonical Table proof hands off at the first suffix PC with no unexecuted lookup, result, traversal charge or top change");
				continue;
			}
			const int visits = inheritedLookup ? entry == 0 ? 3 : 1 : 0;
			const int charged = (entry == 0 ? blocks[0]->terminal.cycles : entry == 2 ? blocks[2]->terminal.cycles : 0) + exit->cycles
				+ visits * TABLE_INDEX_VISIT_CYCLES;
			require(exit == &blocks[1]->terminal && actual == expected && run.remainingCycles == 100 - charged && run.registerTop == 26,
				"inherited Table facts follow only the successful alias-producing path; every public or bypass join validates its own independent raw values");
		}
	}
}

enum class CpuOperation { Length, ConstantFault, Builtin };
struct CpuProgram {
	test::Blua32TestRom rom;
	u32 operationPc, successorPc;
	CpuProgram(CpuOperation operation, bool wide) {
		test::Blua32TestImage image; image.text.resize(3 * MAPPED_PAGE_BYTE_SIZE); u32 word = 0;
		for (const auto op : {Operation{OpCode::MOV, 20, 12}, Operation{OpCode::MOV, 21, 12}, Operation{OpCode::MOV, 22, 12},
			Operation{OpCode::MOV, 0, 14}, Operation{OpCode::MOV, 1, 13}, Operation{OpCode::MOV, 2, 15}}) {
			writeInstruction(image.text, word++, static_cast<u8>(op.op), op.a, op.b, op.c);
		}
		const u32 operationWord = word;
		if (wide) writeInstruction(image.text, word++, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		if (operation == CpuOperation::Length) writeInstruction(image.text, word++, static_cast<u8>(OpCode::LEN), 23, 13, 0);
		else if (operation == CpuOperation::ConstantFault) writeInstruction(image.text, word++, static_cast<u8>(OpCode::LOADKR), 23, 3, 0);
		else writeInstruction(image.text, word++, static_cast<u8>(OpCode::CALL), 0, 3, 1);
		const u32 successorWord = word;
		for (const auto op : {Operation{OpCode::MOV, 24, 20}, Operation{OpCode::MOV, 25, 21}, Operation{OpCode::MOV, 26, 12}, Operation{OpCode::HALT}})
			writeInstruction(image.text, word++, static_cast<u8>(op.op), op.a, op.b, op.c);
		writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		writeInstruction(image.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::MTC0), 0, COP0_STATUS, 0);
		writeInstruction(image.text, 2 * DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = word, .maxStack = 32},
			{.firstWord = DECODED_PAGE_WORDS, .wordCount = 1}, {.firstWord = 2 * DECODED_PAGE_WORDS, .wordCount = 2, .maxStack = 32}};
		image.exceptionFunctionIndex = image.irqFunctionIndex = 1;
		rom = test::encodeBlua32TestRom(RomImageDomain::System, image);
		operationPc = rom.textAddress + operationWord * INSTRUCTION_BYTES;
		successorPc = rom.textAddress + successorWord * INSTRUCTION_BYTES;
	}
};
struct CpuMachine {
	const CpuProgram& program;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	CpuMachine(const CpuProgram& p, bool scalar) : program(p), memory(MemoryInit{p.rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0});
		else cpu.prepareSystemNativeCode();
	}
	void seed(CpuOperation operation) {
		auto* frame = cpu.rootThread()->currentFrame; auto* r = frame->registers;
		for (int index = 0; index < frame->stackCapacity; ++index) r[index] = valueNumber(-70 - index);
		r[12] = valueNumber(-0.0); r[14] = cpu.createBuiltinFunction(BuiltinFunctionId::StringByte); r[15] = valueNumber(2); r[3] = valueNumber(99);
		if (operation == CpuOperation::Length) {
			auto* table = cpu.createTable(256);
			for (int index = 256; index >= 1; --index) table->setInteger(index, valueBool(false));
			r[13] = valueTable(table);
		} else r[13] = valueString(cpu.stringPool().intern("A\xc3\xa9"));
		frame->top = 3;
	}
};

void parity(CpuMachine& generated, CpuMachine& scalar) {
	const auto a = generated.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()) && std::ranges::equal(a.snapshot.objectWords(), b.snapshot.objectWords())
		&& a.nextObjectHashId == b.nextObjectHashId && a.luaHeap.trackedBytes == b.luaHeap.trackedBytes && a.luaHeap.nextCollectionBytes == b.luaHeap.nextCollectionBytes
		&& a.causeWord == b.causeWord && a.epcWord == b.epcWord && a.lastPc == b.lastPc && a.luaFaultReasonWord == b.luaFaultReasonWord,
		"value residency preserves the complete guest graph, heap and fault state");
	require(generated.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining
		&& generated.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc(), "value residency preserves the exact completed instruction and cycle frontier");
	auto* left = generated.cpu.rootThread()->firstFrame; auto* right = scalar.cpu.rootThread()->firstFrame;
	require(left->pc == right->pc && left->top == right->top && left->stackCapacity == right->stackCapacity, "all root-frame extents agree, including a lowered top");
	for (int slot : {12, 20, 21, 22, 24, 25, 26}) require(left->registers[slot] == right->registers[slot], "numeric raw aliases remain exact above and below top");
}

void grantsFaultsAndRestore() {
	for (const auto operation : {CpuOperation::Length, CpuOperation::ConstantFault, CpuOperation::Builtin}) for (const bool wide : {false, true}) {
		const CpuProgram program(operation, wide);
		for (int grant = 0; grant <= 48; ++grant) {
			CpuMachine generated(program, false), scalar(program, true); generated.seed(operation); scalar.seed(operation);
			test::runCpuParity(generated.cpu, scalar.cpu, grant); parity(generated, scalar);
			const auto a = generated.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
			generated.cpu.restoreRuntimeState(a); scalar.cpu.restoreRuntimeState(b);
			test::runCpuParity(generated.cpu, scalar.cpu, 256); parity(generated, scalar);
			const auto* frame = generated.cpu.rootThread()->firstFrame;
			for (int slot : {20, 21, 22}) require(frame->registers[slot] == valueNumber(-0.0), "completed or faulted execution publishes every alias once");
			if (operation == CpuOperation::ConstantFault) require(generated.cpu.readEpcWord() == program.operationPc && frame->registers[24] == valueNumber(-94),
				"a narrow or WIDE fault retains its true instruction PC and does not run the alias suffix");
			else require(generated.cpu.readCauseWord() == 0 && generated.cpu.isHaltedUntilIrq() && frame->registers[24] == valueNumber(-0.0),
				"the completed read or builtin resumes its original side-effecting successor after restore");
		}
	}
}

void builtinInterruptPublishesAliases(bool nmi, bool wide) {
	const CpuProgram program(CpuOperation::Builtin, wide); CpuMachine machine(program, false);
	if (!nmi) {
		machine.cpu.rootThread()->currentFrame->registers[0] = valueNumber(CPU_STATUS_INTERRUPT_ENABLE_CURRENT);
		machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, program.rom.functionAddresses[2], program.rom.textAddress + 2 * MAPPED_PAGE_BYTE_SIZE);
		machine.cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::MTC0)]);
		machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, program.rom.functionAddresses[0], program.rom.textAddress);
		machine.memory.writeMappedU32LE(IO_IRQ_MASK, 1);
	}
	machine.seed(CpuOperation::Builtin); auto* frame = machine.cpu.rootThread()->currentFrame; auto* owner = frame->executionImage;
	auto* page = owner->nativeCodeLookup->find(program.rom.textAddress, 0);
	require(page && page->nativeBlocks->entries[(program.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES], "the interrupt witness uses a real CPU-owned published caller");
	const int primitiveCycles = asBuiltinFunction(frame->registers[14])->cycleBase;
	const auto& gate = nativeBlockGate();
	NativeCpuRunState run{.state = {.registers = frame->registers, .constants = owner->constPool.data(), .frame = frame,
		.constantCount = static_cast<u32>(owner->constPool.size()), .remainingCycles = 128, .registerTop = frame->top, .exitCode = gate.dispatch},
		.cpu = &machine.cpu, .targetDepth = 0, .codeRoot = owner->nativeCodeLookup->root(0), .systemRom = &machine.memory.systemRomStorage(),
		.cartridgeRom = machine.memory.cartridgeController().romStorage(0), .ram = {machine.memory.ramData(), machine.memory.ramByteCount()}, .cartridgeSlot = 0, .error = {}};
	if (nmi) machine.cpu.requestNonMaskableInterrupt(); else machine.irq.raise(1);
	using Entry = void (SLJIT_FUNC *)(NativeCpuRunState*, void*);
	reinterpret_cast<Entry>(gate.entry)(&run, page->nativeCode[(program.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
	if (run.error) std::rethrow_exception(run.error);
	require(frame->pc == program.successorPc && frame->top == 0 && frame->registers[24] == valueNumber(-94)
		&& run.state.remainingCycles == 128 - 6 * BASE_CYCLES[static_cast<u8>(OpCode::MOV)] - BASE_CYCLES[static_cast<u8>(OpCode::CALL)] - primitiveCycles,
		"a completed C1 builtin publishes its lowered top and exact charge before the pending interrupt, without replay or successor");
	for (int slot : {20, 21, 22}) require(frame->registers[slot] == valueNumber(-0.0), "pending IRQ/NMI publishes all dirty alias names above top");
	machine.cpu.runUntilDepth(0, 1);
	require((machine.cpu.readCauseWord() & (nmi ? CPU_CAUSE_NMI : CPU_CAUSE_IRQ)) != 0 && machine.cpu.readEpcWord() == program.successorPc,
		"the real CPU admits IRQ/NMI at the completed successor PC");
}

void actualTransportEmissions(Machine& machine, bool baselineReport) {
	Program program{{{OpCode::MOV, 20, 12}, {OpCode::MOV, 21, 12}, {OpCode::MOV, 22, 12},
		{OpCode::MOV, 23, 12}, {OpCode::MOV, 24, 12}, {OpCode::MOV, 25, 12},
		{OpCode::ADD, 2, 12, -1}, {OpCode::JMP, 0, 0, 0, 0x2000}}};
	const std::array constants{valueNumber(1)};
	const std::array plans{NativeBlockSource{program.source}};
	NativeCodeBindings bindings(machine.memory, machine.cpu.stringPool(), machine.cpu.stringPool().intern("__index"));
	size_t disabledBytes = 0, enabledBytes = 0;
	auto disabled = NativeBlock::compileRegion(plans, constants.data(), bindings);
	bindings.profileLowering = true;
	auto enabled = NativeBlock::compileRegion(plans, constants.data(), bindings);
	disabled.front()->region->publish(disabledBytes); enabled.front()->region->publish(enabledBytes);
	require(!disabled.front()->region->loweringStats && enabled.front()->region->loweringStats
		&& disabledBytes == enabledBytes, "cold lowering capture is opt-in and changes neither the emitted allocation size nor the guest program");
	for (const Value sourceValue : {valueNumber(-0.0), valueNumber(37), VALUE_QNAN_MASK | 73u}) {
		std::array<Value, 32> expected; expected.fill(valueFromTag(ValueTag::False, 91)); expected[12] = sourceValue;
		for (int slot = 20; slot <= 25; ++slot) expected[slot] = sourceValue;
		expected[2] = valueNumber(asNumber(sourceValue) + 1);
		for (auto* block : {disabled.front().get(), enabled.front().get()}) {
			auto actual = expected; for (int slot = 20; slot <= 25; ++slot) actual[slot] = valueFromTag(ValueTag::False, 91); actual[2] = valueFromTag(ValueTag::False, 91);
			NativeBlockRunState run{.registers = actual.data(), .constants = constants.data(), .remainingCycles = block->terminal.cycles, .registerTop = 1};
			require(block->run(run) == &block->terminal && actual == expected && run.remainingCycles == 0 && run.registerTop == 26,
				"both capture policies retain every raw alias, original source and actual arithmetic result at the real exit");
		}
	}
	const auto& stats = *enabled.front()->region->loweringStats;
	const std::array phaseNames{"body", "entry", "edge", "frontier"};
	std::cout << "{\"emissionOracle\":\"six MOV aliases plus source ADD\",\"instrumentationOnlyBaselineAllowed\":" << (baselineReport ? "true" : "false")
		<< ",\"codeBytes\":" << enabledBytes << ",\"sharedGateStoresNotRepeatedPerRegion\":true,\"phases\":{";
	for (size_t phase = 0; phase < phaseNames.size(); ++phase) {
		const auto& c = stats.phases[phase]; if (phase != 0) std::cout << ',';
		std::cout << '\"' << phaseNames[phase] << "\":{\"registerValueLoads\":" << c.registerValueLoads
			<< ",\"registerHeaderLoads\":" << c.registerHeaderLoads << ",\"registerPayloadLoads\":" << c.registerPayloadLoads
			<< ",\"rawFprCopies\":" << c.rawFprCopies << ",\"dirtyEvictionStores\":" << c.dirtyEvictionStores
			<< ",\"publicationStores\":" << c.publicationStores << ",\"helperSpillStores\":" << c.helperSpillStores
			<< ",\"helperSpillReloads\":" << c.helperSpillReloads << '}';
	}
	std::cout << "}}\n";
	if (!baselineReport) {
		const auto& body = stats.phases[static_cast<size_t>(NativeLoweringPhase::Body)];
		const auto& entry = stats.phases[static_cast<size_t>(NativeLoweringPhase::Entry)];
		require(body.rawFprCopies == 0 && body.dirtyEvictionStores == 0 && body.registerValueLoads + entry.registerValueLoads <= 1,
			"proven MOV aliases share raw-value residency without physical copies, dirty evictions or reloading the still-live source");
	}
}
} // namespace

int main(int argc, char** argv) {
	try {
		const bool baselineReport = argc == 2 && std::string_view(argv[1]) == "--baseline-emission";
		Machine machine;
		fanoutAndHomeReplacement(machine);
		independentEntriesAndPartialRanges(machine);
		openRangesAndSelfUpvalues(machine);
		receiverCopyPrecedesReadFault(machine);
		untakenSelfPublicationRetainsDirtyAliases(machine);
		tableConstantSurvivesTypeFacts(machine);
		inheritedTableFactsAndIndependentJoin(machine);
		grantsFaultsAndRestore();
		for (const bool nmi : {false, true}) for (const bool wide : {false, true}) builtinInterruptPublishesAliases(nmi, wide);
		actualTransportEmissions(machine, baselineReport);
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
	return 0;
}
