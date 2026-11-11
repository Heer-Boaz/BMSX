#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <limits>
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
	CpuMachine(const test::Blua32TestImage& image, bool scalar = false)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void requireParity(CpuMachine& native, CpuMachine& scalar) {
	auto& a = native.cpu; auto& b = scalar.cpu;
	require(a.lastPc == b.lastPc
		&& a.readCurrentInstructionPc() == b.readCurrentInstructionPc() && a.readCauseWord() == b.readCauseWord()
		&& a.readEpcWord() == b.readEpcWord() && a.readLuaFaultReasonWord() == b.readLuaFaultReasonWord(),
		"generated context execution preserves instruction, fault and cycle boundaries");
	const auto left = a.captureRuntimeState(), right = b.captureRuntimeState();
	require(std::ranges::equal(left.snapshot.words(), right.snapshot.words()), "the complete retained value graph agrees with scalar execution");
	const auto& first = *a.activeThread(); const auto& second = *b.activeThread();
	require(first.frameDepth == second.frameDepth && first.stackTop == second.stackTop, "frame and stack extents agree");
	const CallFrame* firstFrame = first.firstFrame; const CallFrame* secondFrame = second.firstFrame;
	for (size_t i = 0; i < first.frameDepth; ++i, firstFrame = firstFrame->next, secondFrame = secondFrame->next) {
		const auto& x = *firstFrame; const auto& y = *secondFrame;
		require(x.pc == y.pc && x.top == y.top && x.stackBase == y.stackBase && x.stackCapacity == y.stackCapacity
			&& x.varargBase == y.varargBase && x.varargCount == y.varargCount, "all live frame ranges agree after relocation");
	}
}

void hotVarargFrames(int fixed) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 20, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 0, 20, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 0, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::K1), 1, 0, 0);
	writeInstruction(image.text, 17, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 18, static_cast<u8>(OpCode::VARARG), 2, fixed == 0 ? 0 : fixed + 1, 0);
	writeInstruction(image.text, 19, static_cast<u8>(OpCode::MOV), 0, 7, 0);
	writeInstruction(image.text, 20, static_cast<u8>(OpCode::MOV), 1, 2, 0);
	writeInstruction(image.text, 21, static_cast<u8>(OpCode::VARARG), 0, 0, 0);
	writeInstruction(image.text, 22, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255);
	writeInstruction(image.text, 24, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 160},
		{.firstWord = 16, .wordCount = 9, .maxStack = 16, .isVararg = true}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		m->cpu.runUntilDepth(0, 2); m->cpu.activeThread()->frameAtDepth(0)->top = 1;
		m->cpu.runUntilDepth(0, 9002);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(1)->decodedPage;
	const u32 entry = ((native.rom.textAddress + 16u * INSTRUCTION_BYTES) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto* block = page.nativeBlocks->entries[entry].get();
	require(block && block->sourceWords == 7, "varargs and following control flow really execute in a native block");
#endif
	for (const int count : {0, 2, 63}) {
		for (auto* m : {&native, &scalar}) {
			auto& cpu = m->cpu; auto* thread = cpu.activeThread();
			Closure* closure = thread->frameAtDepth(1)->closure;
			cpu.writeFrameExecution(1, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[1], m->rom.textAddress + 24u * INSTRUCTION_BYTES);
			require(cpu.runUntilDepth(1, 2) == RunResult::Halted, "the saved varargs frame returns at its actual depth boundary");
			auto& root = *thread->frameAtDepth(0);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress + 3u * INSTRUCTION_BYTES);
			root.registers[0] = valueClosure(closure);
			for (int i = 0; i < count; ++i) root.registers[i + 1] = i == 0 ? valueBool(false) : i == 1 ? valueNil() : valueNumber(i);
			root.top = count + 1;
			require(cpu.runUntilDepth(0, 2) == RunResult::Yielded && thread->frameAtDepth(1)->varargCount == count,
				"a new frame binds its current saved-argument range before entering hot code");
		}
		test::runCpuParity(native.cpu, scalar.cpu, 9);
		requireParity(native, scalar);
		for (const int grant : {0, 1, 1, 2, 1, 1, 2, 1}) {
			test::runCpuParity(native.cpu, scalar.cpu, grant);
			requireParity(native, scalar);
		}
		require(native.cpu.activeThread()->frameAtDepth(1)->top == count, "the final open VARARG replaces the former top exactly");
		if (count == 63) require(native.cpu.activeThread()->frameAtDepth(1)->stackCapacity > 16, "the hot capacity exit grows the real stack");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(page.nativeBlocks->entries[entry].get() == block, "the compiled varargs body survives frame and stack replacement");
#endif
	}
}

void hotEmptyVararg() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::VARARG), 31, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 4}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		m->cpu.activeThread()->frameAtDepth(0)->registers[0] = valueNumber(73); m->cpu.runUntilDepth(0, 600);
	}
	requireParity(native, scalar);
	const auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
	require(frame.top == 31 && frame.stackCapacity == 4 && frame.registers[0] == valueNumber(73),
		"zero saved varargs change top without forming an out-of-range host slot or extending capacity");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& block = frame.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(block && block->sourceWords == 2, "the empty copy executes through both the native path and scalar warmup");
#endif
}

void hotConstantTrap() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 1, 1, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::LOADKR), 0, 1, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 514}}; image.constants = {11.0};
	for (const double bad : {8.0, -1.0, 4294967295.0}) {
		CpuMachine native(image), scalar(image, true);
		for (auto* m : {&native, &scalar}) {
			auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers[513] = valueNumber(0);
			m->cpu.runUntilDepth(0, 300);
			frame.registers[513] = valueNumber(bad); frame.registers[256] = valueNumber(73); frame.top = 0;
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
		const auto& block = frame.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
		require(block && block->sideExits[0].exit == NativeBlockExit::InvalidConstant, "the trapping instruction is lowered, not skipped");
#endif
		test::runCpuParity(native.cpu, scalar.cpu, 3); requireParity(native, scalar);
		require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT
			&& native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES
			&& native.cpu.activeThread()->frameAtDepth(0)->registers[256] == valueNumber(73)
			&& native.cpu.activeThread()->frameAtDepth(0)->top == 8, "a WIDE load traps after its prefix, without writing its destination or top");
	}
}

void hotGlobalBanks() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	const std::array ops{OpCode::GETGL, OpCode::SETSYS, OpCode::GETSYS, OpCode::SETGL, OpCode::K1, OpCode::SETGL, OpCode::SETSYS, OpCode::JMP};
	const std::array<std::array<u32, 3>, 8> args{{{0, 0, 0}, {0, 0, 1}, {1, 0, 0}, {1, 0, 1}, {2, 0, 0}, {2, 0, 2}, {12, 0, 2}, {0, 63, 56}}};
	for (u32 i = 0; i < ops.size(); ++i) writeInstruction(image.text, i, static_cast<u8>(ops[i]), args[i][0], args[i][1], args[i][2], i == 7 ? 255 : 0);
	image.functions = {{.firstWord = 0, .wordCount = 8, .maxStack = 16}};
	image.globalNames = {"shared", "copied", "numeric"}; image.systemGlobalNames = image.globalNames;
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		for (const auto* name : {"shared", "copied", "numeric"}) m->cpu.stringPool().intern(name);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 1100);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 entry = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const auto* block = page.nativeBlocks->entries[entry].get(); require(block && block->sourceWords == 8, "global transfers stay in one native block");
#endif
	for (auto* m : {&native, &scalar}) for (int i = 0; i < 257; ++i) {
		m->cpu.setGlobalByKey(m->cpu.stringPool().intern("grown-" + std::to_string(i)), valueNumber(i));
	}
	for (const Value value : {valueNil(), valueBool(false), valueBool(true), valueNumber(-0.0), VALUE_QNAN_MASK, valueNumber(73)}) {
		for (auto* m : {&native, &scalar}) {
			auto& cpu = m->cpu; cpu.activeThread()->frameAtDepth(0)->registers[12] = value;
			cpu.setGlobalByKey(cpu.stringPool().intern("shared"), value);
			cpu.setSystemGlobalByKey(cpu.stringPool().intern("shared"), valueNumber(73));
		}
		test::runCpuParity(native.cpu, scalar.cpu, 11);
		requireParity(native, scalar);
		require(native.cpu.getSystemGlobalByKey(native.cpu.stringPool().intern("copied")) == value
			&& native.cpu.getGlobalByKey(native.cpu.stringPool().intern("copied")) == valueNumber(73)
			&& native.cpu.activeThread()->frameAtDepth(0)->top == 3, "grown global banks remain live, distinct and do not extend top on stores");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(page.nativeBlocks->entries[entry].get() == block, "host bank relocation does not invalidate an unrelated compiled instruction page");
#endif
}

void hotUpvalueAlias() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	const std::array ops{OpCode::K1, OpCode::GETUP, OpCode::KSMI, OpCode::SETUP, OpCode::ADD, OpCode::GETUP, OpCode::SETUP, OpCode::GETUP, OpCode::JMP};
	const std::array<std::array<u32, 3>, 9> args{{{0, 0, 0}, {1, 0, 0}, {2, 0, 9}, {2, 0, 0},
		{3, 0, 1}, {4, 0, 0}, {12, 1, 0}, {6, 1, 0}, {0, 63, 55}}};
	for (u32 i = 0; i < ops.size(); ++i) writeInstruction(image.text, i, static_cast<u8>(ops[i]), args[i][0], args[i][1], args[i][2], i == 8 ? 255 : 0);
	image.functions = {{.firstWord = 0, .wordCount = 9, .maxStack = 16}};
	CpuMachine native(image), scalar(image, true);
	std::array<Upvalue, 4> cells; std::array<Upvalue*, 4> pointers; std::array<Closure, 2> closures;
	int index = 0;
	for (auto* m : {&native, &scalar}) {
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0);
		auto& closure = closures[index]; closure.functionAddress = frame.functionAddress; closure.upvalueCount = 2;
		closure.upvalues = pointers.data() + index * 2; closure.hashId = 100; closure.type = ObjType::Closure;
		for (int c = 0; c < 2; ++c) {
			auto& cell = cells[index * 2 + c]; closure.upvalues[c] = &cell;
			cell.hashId = 101 + c; cell.type = ObjType::Upvalue; cell.open = c == 0; cell.frame = c == 0 ? &frame : nullptr;
		}
		frame.closure = &closure; m->cpu.runUntilDepth(0, 1100); ++index;
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& first = *native.cpu.activeThread()->frameAtDepth(0);
	const auto& compiled = first.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(compiled && compiled->sideExits[0].exit == NativeBlockExit::WriteUpvalue,
		"the VM exercises a real compiled self-alias exit before resuming the remaining operations");
#endif
	for (const auto value : {valueNil(), valueBool(false), valueNumber(-0.0), VALUE_QNAN_MASK, valueNumber(73)}) {
		for (auto* m : {&native, &scalar}) m->cpu.activeThread()->frameAtDepth(0)->registers[12] = value;
		test::runCpuParity(native.cpu, scalar.cpu, 11); requireParity(native, scalar);
		const auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
		require(frame.registers[3] == valueNumber(10) && frame.registers[4] == valueNumber(9)
			&& frame.registers[6] == value && frame.top == 7, "a self-alias side exit writes the actual cell without losing live values or extending top");
	}
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
struct ContextBlock {
	struct Instruction { OpCode op; u16 a = 0; i16 b = 0; i16 c = 0; u32 bx = 0; };
	size_t bytes = 0;
	std::vector<DecodedInstruction> decoded;
	std::vector<NativeBlockInstruction> source;
	std::unique_ptr<NativeBlock> block;
	ContextBlock(CpuMachine& machine, std::initializer_list<Instruction> code, const Value* constants = nullptr) {
		decoded.resize(code.size()); source.resize(code.size());
		size_t i = 0;
		for (const auto& instruction : code) {
			auto& d = decoded[i]; d.op = static_cast<u8>(instruction.op); d.a = instruction.a;
			d.b = instruction.b; d.c = instruction.c; d.bx = instruction.bx; d.width = 1; d.baseCycles = BASE_CYCLES[d.op];
			source[i] = {&d, 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES}; ++i;
		}
		block = NativeBlock::compile(source, constants, bytes, machine.memory, machine.cpu.stringPool());
	}
};

void rawContextValues(CpuMachine& machine) {
	auto& cpu = machine.cpu;
	const std::array values{valueNil(), valueFromTag(ValueTag::False, 37), valueFromTag(ValueTag::True, 37),
		valueNumber(-0.0), VALUE_QNAN_MASK, valueNumber(std::numeric_limits<double>::infinity()),
		valueString(cpu.stringPool().intern("context")), valueTable(cpu.createTable()), valueClosure(cpu.activeThread()->frameAtDepth(0)->closure),
		valueThread(cpu.activeThread())};
	ContextBlock globals(machine, {{OpCode::SETGL, 12, 0, 0, 1}, {OpCode::GETGL, 0, 0, 0, 1},
		{OpCode::SETSYS, 0, 0, 0, 1}, {OpCode::GETSYS, 1, 0, 0, 1}, {OpCode::K1, 2},
		{OpCode::SETGL, 2}, {OpCode::LOADNIL, 15, 0}, {OpCode::JMP}});
	std::array<Value, 16> registers; std::array<Value, 2> ordinary, system;
	for (const auto value : values) {
		registers.fill(valueNil()); ordinary.fill(valueNil()); system.fill(valueNil()); registers[12] = value;
		NativeBlockRunState state{.registers = registers.data(), .globalValues = ordinary.data(), .systemGlobalValues = system.data(), .remainingCycles = 100};
		require(globals.block->run(state) == &globals.block->terminal && registers[0] == value && registers[1] == value
			&& ordinary[1] == value && system[1] == value && ordinary[0] == valueNumber(1) && system[0] == valueNil()
			&& state.registerTop == 3, "raw global banks preserve every kind, cached definitions and namespace without a source-top write");
	}
	std::array<Value, 1> outerRegisters{valueNumber(1)};
	CallFrame frame, outer; frame.registers = registers.data(); outer.registers = outerRegisters.data();
	Upvalue open, closed; open.open = true; open.frame = &frame;
	std::array<Upvalue*, 2> upvalues{&open, &closed}; Closure closure; closure.upvalues = upvalues.data(); frame.closure = &closure;
	ContextBlock captures(machine, {{OpCode::K1, 0}, {OpCode::GETUP, 1}, {OpCode::KSMI, 2, 0, 0, 9},
		{OpCode::SETUP, 2}, {OpCode::ADD, 3, 0, 1}, {OpCode::GETUP, 4}, {OpCode::SETUP, 12, 1}, {OpCode::GETUP, 6, 1}, {OpCode::JMP}});
	registers.fill(valueNil());
	NativeBlockRunState alias{.registers = registers.data(), .frame = &frame, .remainingCycles = 100};
	require(captures.block->run(alias) == &captures.block->sideExits[0] && alias.registerTop == 3
		&& registers[0] == valueNumber(1) && registers[1] == valueNumber(1) && registers[2] == valueNumber(9)
		&& registers[3] == valueNil(), "the self-alias guard publishes the exact prefix before writing a captured register");
	open.frame = &outer;
	for (const auto value : values) {
		registers.fill(valueNil()); registers[12] = value; outerRegisters[0] = valueNumber(1);
		NativeBlockRunState state{.registers = registers.data(), .frame = &frame, .remainingCycles = 100};
		require(captures.block->run(state) == &captures.block->terminal && registers[0] == valueNumber(1)
			&& registers[1] == valueNumber(1) && registers[3] == valueNumber(2) && registers[4] == valueNumber(9)
			&& registers[6] == value && closed.value == value && state.registerTop == 7,
			"native outer and closed cells preserve raw values without invalidating unrelated register definitions");
	}
	const std::array constants{valueNil(), valueBool(false), valueBool(true), values[6], valueNumber(-0.0), VALUE_QNAN_MASK, valueNumber(11)};
	for (const int destination : {0, 2}) {
		ContextBlock pool(machine, {{OpCode::K1, 8}, {OpCode::K1, 9}, {OpCode::LOADNIL, 8, 2},
			{OpCode::LOADNIL, 15, 0}, {OpCode::LOADKR, static_cast<u16>(destination), 2}, {OpCode::MOV, 3, static_cast<i16>(destination)}, {OpCode::JMP}}, constants.data());
		for (const double index : {0.0, 1.9, 2.9, 3.0, 4.0, 5.0, 6.0, 4294967296.0,
			std::numeric_limits<double>::quiet_NaN(), std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity()}) {
			registers.fill(valueNil()); registers[2] = valueNumber(index);
			NativeBlockRunState state{.registers = registers.data(), .constants = constants.data(), .constantCount = constants.size(), .remainingCycles = 100};
			require(pool.block->run(state) == &pool.block->terminal && registers[3] == constants[toU32(index)]
				&& registers[8] == valueNil() && registers[9] == valueNil() && state.registerTop == 10,
				"nil fill discards dirty definitions and pool loads retain raw kinds across U32 conversion and aliases");
		}
	}
}

void varargAliasesAndSideExits(CpuMachine& machine) {
	std::array<Value, 48> stack; CallFrame frame; frame.registers = stack.data() + 16;
	const std::array values{valueNil(), valueFromTag(ValueTag::False, 37), valueFromTag(ValueTag::True, 37),
		valueNumber(-0.0), VALUE_QNAN_MASK, valueString(machine.cpu.stringPool().intern("vararg")),
		valueTable(machine.cpu.createTable()), valueThread(machine.cpu.activeThread())};
	ContextBlock empty(machine, {{OpCode::VARARG, 31, 0}, {OpCode::JMP}});
	frame.varargCount = 0; frame.stackCapacity = 16; stack.fill(valueNumber(73));
	NativeBlockRunState zero{.registers = frame.registers, .frame = &frame, .remainingCycles = 100, .registerTop = 48};
	require(empty.block->run(zero) == &empty.block->terminal && zero.registerTop == 31
		&& std::ranges::all_of(stack, [](Value value) { return value == valueNumber(73); }),
		"an empty open VARARG resets top without touching or growing the destination range");
	for (const int fixed : {0, 5}) {
		ContextBlock first(machine, {{OpCode::K1, 1}, {OpCode::K1, 7}, {OpCode::VARARG, 2, static_cast<i16>(fixed == 0 ? 0 : fixed + 1)},
			{OpCode::MOV, 0, 7}, {OpCode::MOV, 1, 2}, {OpCode::BNOT, 15, 7}, {OpCode::JMP}});
		ContextBlock second(machine, {{OpCode::VARARG, 0, 0}, {OpCode::LOADKR, 15, 14}});
		second.block->linkFrom(first.block->terminal);
		for (const int count : {0, 2, 8}) {
			stack.fill(valueNumber(73)); frame.varargCount = count; frame.stackCapacity = 16;
			std::copy_n(values.data(), count, frame.registers - count);
			frame.registers[14] = valueNumber(1);
			NativeBlockRunState state{.registers = frame.registers, .frame = &frame, .remainingCycles = 100, .registerTop = 16};
			require(first.block->run(state) == &second.block->sideExits[1] && state.registerTop == count,
				"an invalid pool load after a linked open VARARG publishes its exact lowered top, not an earlier block maximum");
			for (int i = 0; i < count; ++i) require(frame.registers[i] == values[i], "varargs preserve every raw value bit");
			require(frame.registers[15] == valueNumber(fixed == 0 && count == 8 ? -1 : -2),
				"a word consumer sees the overwritten vararg kind, not a cached literal fact; fixed ranges retain untouched facts");
		}
		stack.fill(valueNumber(73)); frame.varargCount = 8; frame.stackCapacity = 8;
		std::copy(values.begin(), values.end(), frame.registers - 8);
		// B=0 exceeds capacity; for B=5 the first copy fits and the second does too.
		if (fixed == 0) {
			NativeBlockRunState state{.registers = frame.registers, .frame = &frame, .remainingCycles = 100};
			require(first.block->run(state) == &first.block->sideExits[0] && state.registerTop == 8
				&& frame.registers[1] == valueNumber(1) && frame.registers[7] == valueNumber(1) && frame.registers[2] == valueNumber(73),
				"a capacity exit materializes only the prefix, before any copy or top reset");
		}
	}
}
#endif
} // namespace

int main() {
	try {
		hotVarargFrames(0); hotVarargFrames(5); hotEmptyVararg(); hotConstantTrap(); hotUpvalueAlias(); hotGlobalBanks();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		test::Blua32TestImage image; image.text.resize(INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0); image.functions = {{.firstWord = 0, .wordCount = 1}};
		CpuMachine machine(image); rawContextValues(machine); varargAliasesAndSideExits(machine);
#endif
		std::cout << "Compiled CPU context tests passed\n";
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
