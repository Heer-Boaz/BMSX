#include "machine/cpu/upvalue.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
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

constexpr int NATIVE_WARM_SCALE = (NATIVE_BLOCK_COMPILATION_THRESHOLD + 7) / 8;

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
	require((left == right && bmsx::test::sameLanguageRam(a, b)), "the complete retained value graph agrees with scalar execution");
	const auto& first = *a.activeThread(); const auto& second = *b.activeThread();
	require(first.frameDepth() == second.frameDepth() && first.stackTop() == second.stackTop(), "frame and stack extents agree");
	const CallFrame* firstFrame = first.firstFrame; const CallFrame* secondFrame = second.firstFrame;
	for (size_t i = 0; i < first.frameDepth(); ++i, firstFrame = firstFrame->next, secondFrame = secondFrame->next) {
		const auto& x = *firstFrame; const auto& y = *secondFrame;
		require(x.readControl(bmsx::FrameField::Pc) == y.readControl(bmsx::FrameField::Pc) && static_cast<bmsx::i32>(x.readControl(bmsx::FrameField::Top)) == static_cast<bmsx::i32>(y.readControl(bmsx::FrameField::Top)) && x.stackBase() == y.stackBase() && x.stackCapacity() == y.stackCapacity()
			&& static_cast<bmsx::i32>(x.readControl(bmsx::FrameField::VarargBase)) == static_cast<bmsx::i32>(y.readControl(bmsx::FrameField::VarargBase)) && static_cast<bmsx::i32>(x.readControl(bmsx::FrameField::VarargCount)) == static_cast<bmsx::i32>(y.readControl(bmsx::FrameField::VarargCount)), "all live frame ranges agree after relocation");
	}
}

void physicalVarargWindow() {
	test::Blua32TestImage image; image.text.resize(3 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::KSMI), 0, 0, 7);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::VARARG), 1, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8, .isVararg = true}};
	for (const bool mirrored : {false, true}) {
		CpuMachine native(image), scalar(image, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		native.cpu.prepareSystemNativeCode();
#endif
		for (auto* machine : {&native, &scalar}) {
			auto* thread = machine->cpu.activeThread();
			auto& frame = *thread->currentFrame;
			const u32 control = RAM_BASE + frame.controlOffset;
			const u32 source = mirrored ? ((MAIN_RAM_SIZE - thread->stackOffset() + 0x1000u) / 4u) : 0u;
			// Forensic frame setup uses the private record port, not the system bus.
			machine->memory.writeRamRecordWord(control + static_cast<u32>(FrameField::VarargBase), 0xb0000000u | source);
			machine->memory.writeRamRecordWord(control + static_cast<u32>(FrameField::VarargCount), 0xa0000001u);
			machine->memory.writeRamRecordWord(control + static_cast<u32>(FrameField::Top), 0xc0000000u);
			if (mirrored) {
				machine->memory.writeRamRecordWord(thread->stackOffset() + source * 4u, 73);
				machine->memory.writeRamRecordByte(thread->stack.tagAddress() + source, static_cast<u8>(ValueTag::Integer));
			}
		}
		const int grant = BASE_CYCLES[static_cast<u8>(OpCode::KSMI)] + BASE_CYCLES[static_cast<u8>(OpCode::VARARG)] + 2;
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		requireParity(native, scalar);
		const auto& frame = *native.cpu.activeThread()->currentFrame;
		require(frame.registers.get(1) == valueInteger(mirrored ? 73 : 7)
			&& frame.readControl(FrameField::Top) == 0xc0000002u,
			"VARARG copies the current physical source, including a register alias or folded address, without replacing top high bits");
	}
}

void hotVarargFrames(int fixed) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 20, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 0, 20, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::K1), 1, 0, 0);
	writeInstruction(image.text, 17, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 18, static_cast<u8>(OpCode::VARARG), 2, fixed == 0 ? 0 : fixed + 1, 0);
	writeInstruction(image.text, 19, static_cast<u8>(OpCode::MOV), 0, 7, 0);
	writeInstruction(image.text, 20, static_cast<u8>(OpCode::MOV), 1, 2, 0);
	writeInstruction(image.text, 21, static_cast<u8>(OpCode::VARARG), 0, 0, 0);
	writeInstruction(image.text, 22, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255);
	writeInstruction(image.text, 24, static_cast<u8>(OpCode::RET), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 160},
		{.firstWord = 16, .wordCount = 9, .maxStack = 16, .isVararg = true}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		m->cpu.runUntilDepth(0, 2); m->cpu.activeThread()->frameAtDepth(0)->writeControl(bmsx::FrameField::Top, 1);
		m->cpu.runUntilDepth(0, 9002);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(1)->decodedPage;
	const u32 entry = ((native.rom.textAddress + 16u * INSTRUCTION_BYTES) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, entry);
	const auto* block = page.nativeBlocks->entries[entry].get();
	require(block && block->sourceWords == 7, "varargs and following control flow really execute in a native block");
#endif
	for (const int count : {0, 2, 63}) {
		for (auto* m : {&native, &scalar}) {
			auto& cpu = m->cpu; auto* thread = cpu.activeThread();
			u32 closure = thread->frameAtDepth(1)->closureAddress();
			cpu.writeFrameExecution(1, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[1], m->rom.textAddress + 24u * INSTRUCTION_BYTES);
			require(cpu.runUntilDepth(1, 2) == RunResult::Halted, "the saved varargs frame returns at its actual depth boundary");
			auto& root = *thread->frameAtDepth(0);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress + 3u * INSTRUCTION_BYTES);
			root.registers.set(0, valueClosure(closure));
			for (int i = 0; i < count; ++i) root.registers.set(i + 1, i == 0 ? valueBool(false) : i == count - 1 ? valueNil() : valueInteger(i));
			root.writeControl(bmsx::FrameField::Top, count + 1);
			require(cpu.runUntilDepth(0, 2) == RunResult::Yielded && static_cast<bmsx::i32>(thread->frameAtDepth(1)->readControl(bmsx::FrameField::VarargCount)) == count,
				"a new frame binds its current saved-argument range before entering hot code");
		}
		test::runCpuParity(native.cpu, scalar.cpu, 9);
		requireParity(native, scalar);
		for (const int grant : {0, 1, 1, 2, 1, 1, 2, 1}) {
			test::runCpuParity(native.cpu, scalar.cpu, grant);
			requireParity(native, scalar);
		}
		// Variable VARARG costs may place the same grant boundary at different
		// instructions; drive both machines to just past the final VARARG.
		for (int step = 0; step < 6 && native.cpu.readFramePc(1) != native.rom.textAddress + 22u * INSTRUCTION_BYTES; ++step) {
			test::runCpuParity(native.cpu, scalar.cpu, 1);
			requireParity(native, scalar);
		}
		require(native.cpu.readFramePc(1) == native.rom.textAddress + 22u * INSTRUCTION_BYTES,
			"short grants reach the instruction after the final VARARG");
		require(static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(1)->readControl(bmsx::FrameField::Top)) == count, "the final open VARARG replaces the former top exactly");
		if (count == 63) require(native.cpu.activeThread()->frameAtDepth(1)->stackCapacity() > 16, "the hot capacity exit grows the real stack");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		require(page.nativeBlocks->entries[entry].get() == block, "the compiled varargs body survives frame and stack replacement");
#endif
	}
	// Feed the lowered VARARG top directly into open RET, then the caller's
	// open result window. In particular the last nil is still a result.
	for (auto* m : {&native, &scalar})
		m->cpu.writeFrameExecution(1, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[1], m->rom.textAddress + 24u * INSTRUCTION_BYTES);
	require(test::runCpuParity(native.cpu, scalar.cpu, 1, 1) == RunResult::Halted, "open return reaches the caller");
	requireParity(native, scalar);
	const auto& caller = *native.cpu.activeThread()->currentFrame;
	require(static_cast<bmsx::i32>(caller.readControl(bmsx::FrameField::Top)) == 63, "open CALL receives exactly the range selected by VARARG and RET");
	for (int i = 0; i < static_cast<bmsx::i32>(caller.readControl(bmsx::FrameField::Top)); ++i)
		require(caller.registers.get(i) == (i == 0 ? valueBool(false) : i == 62 ? valueNil() : valueInteger(i)),
			"open return preserves every argument, including trailing nil");
}

void hotEmptyVararg() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::VARARG), 31, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0, .wordCount = 2, .maxStack = 4}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		m->cpu.activeThread()->frameAtDepth(0)->registers.set(0, valueInteger(73)); m->cpu.runUntilDepth(0, 600);
	}
	requireParity(native, scalar);
	const auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
	require(static_cast<bmsx::i32>(frame.readControl(bmsx::FrameField::Top)) == 31 && frame.stackCapacity() == 4 && frame.registers.get(0) == valueInteger(73),
		"zero saved varargs change top without forming an out-of-range host slot or extending capacity");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	test::waitForNativeEntry(native.cpu, *frame.decodedPage, (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
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
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 514}}; image.constants = {11};
	for (const Value bad : {valueInteger(8), valueInteger(-1), valueNil(), valueFloatBits(0xff800000), valueFloatBits(0x7fa12345)}) {
		CpuMachine native(image), scalar(image, true);
		for (auto* m : {&native, &scalar}) {
			auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers.set(513, valueInteger(0));
			m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 300);
			frame.registers.set(513, bad); frame.registers.set(256, valueInteger(73)); frame.writeControl(bmsx::FrameField::Top, 0);
		}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
		test::waitForNativeEntry(native.cpu, *frame.decodedPage, (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	const auto& block = frame.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
		require(block && block->sideExits[0].exit == NativeBlockExit::InvalidConstant, "the trapping instruction is lowered, not skipped");
#endif
		test::runCpuParity(native.cpu, scalar.cpu, 3); requireParity(native, scalar);
		require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_INVALID_ARGUMENT
			&& native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES
			&& native.cpu.activeThread()->frameAtDepth(0)->registers.get(256) == valueInteger(73)
			&& static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Top)) == 8, "a WIDE load traps after its prefix, without writing its destination or top");
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
	test::runCpuParity(native.cpu, scalar.cpu, NATIVE_WARM_SCALE * 1100);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 entry = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, entry);
	const auto* block = page.nativeBlocks->entries[entry].get(); require(block && block->sourceWords == 8, "global transfers stay in one native block");
#endif
	for (auto* m : {&native, &scalar}) for (int i = 0; i < 257; ++i) {
		m->cpu.setGlobalByKey(m->cpu.stringPool().intern("grown-" + std::to_string(i)), valueInteger(i));
	}
	int loopCycles = 0;
	for (const auto op : ops) loopCycles += BASE_CYCLES[static_cast<u8>(op)];
	for (const Value value : {valueNil(), valueBool(false), valueBool(true), valueFloat(-0.f), valueFloatBits(0xffa12345), valueInteger(73)}) {
		for (auto* m : {&native, &scalar}) {
			auto& cpu = m->cpu; cpu.activeThread()->frameAtDepth(0)->registers.set(12, value);
			cpu.activeThread()->frameAtDepth(0)->writeControl(bmsx::FrameField::Pc, m->rom.textAddress);
			cpu.setGlobalByKey(cpu.stringPool().intern("shared"), value);
			cpu.setSystemGlobalByKey(cpu.stringPool().intern("shared"), valueInteger(73));
		}
		test::runCpuParity(native.cpu, scalar.cpu, loopCycles);
		requireParity(native, scalar);
		require(native.cpu.getSystemGlobalByKey(native.cpu.stringPool().intern("copied")) == value
			&& native.cpu.getGlobalByKey(native.cpu.stringPool().intern("copied")) == valueInteger(73)
			&& static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Top)) == 3, "grown global banks remain live, distinct and do not extend top on stores");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	require(page.nativeBlocks->entries[entry].get() == block, "guest bank relocation does not invalidate an unrelated compiled instruction page");
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
	for (auto* m : {&native, &scalar}) {
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0);
		auto& heap = m->cpu.gcHeap();
		std::array<u32, 2> cells{};
		const auto prototype = ClosureRecord::readBinding(heap.memory, frame.closureAddress());
		const u32 closure = heap.budget.allocateClosureRecord(2, false, cells);
		ClosureRecord::initialize(heap.memory, closure, prototype, heap.white(), 2, false, false);
		Upvalue::bindOpen(heap.memory, cells[0], frame.thread->address, frame.stackBase(), 0);
		ClosureRecord::setCaptureAddress(heap.memory, closure, 0, cells[0]);
		ClosureRecord::setCaptureAddress(heap.memory, closure, 1, cells[1]);
		frame.writeControl(bmsx::FrameField::Closure, closure); m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 1100);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& first = *native.cpu.activeThread()->frameAtDepth(0);
	test::waitForNativeEntry(native.cpu, *first.decodedPage, (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	const auto& compiled = first.decodedPage->nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	require(compiled && compiled->sideExits[0].exit == NativeBlockExit::WriteUpvalue,
		"the VM exercises a real compiled self-alias exit before resuming the remaining operations");
#endif
	int loopCycles = 0;
	for (const auto op : ops) loopCycles += BASE_CYCLES[static_cast<u8>(op)];
	for (const auto value : {valueNil(), valueBool(false), valueFloat(-0.f), valueFloatBits(0xffa12345), valueInteger(73)}) {
		for (auto* m : {&native, &scalar}) {
			m->cpu.activeThread()->frameAtDepth(0)->registers.set(12, value);
			m->cpu.activeThread()->frameAtDepth(0)->writeControl(bmsx::FrameField::Pc, m->rom.textAddress);
		}
		test::runCpuParity(native.cpu, scalar.cpu, loopCycles); requireParity(native, scalar);
		const auto& frame = *native.cpu.activeThread()->frameAtDepth(0);
		require(frame.registers.get(3) == valueInteger(10) && frame.registers.get(4) == valueInteger(9)
			&& frame.registers.get(6) == value && static_cast<bmsx::i32>(frame.readControl(bmsx::FrameField::Top)) == 7, "a self-alias side exit writes the actual cell without losing live values or extending top");
	}
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
struct ContextBlock {
	struct Instruction { OpCode op; u16 a = 0; i16 b = 0; i16 c = 0; u32 bx = 0; };
	size_t bytes = 0;
	std::vector<DecodedInstruction> decoded;
	std::vector<NativeBlockInstruction> source;
	std::unique_ptr<NativeBlock> block;
	ContextBlock(CpuMachine& machine, std::initializer_list<Instruction> code, ConstValueSpan constants = {}) {
		decoded.resize(code.size()); source.resize(code.size());
		size_t i = 0;
		for (const auto& instruction : code) {
			auto& d = decoded[i]; d.op = static_cast<u8>(instruction.op); d.a = instruction.a;
			d.b = instruction.b; d.c = instruction.c; d.bx = instruction.bx; d.width = 1; d.baseCycles = BASE_CYCLES[d.op];
			source[i] = {&d, 0x1000u + static_cast<u32>(i) * INSTRUCTION_BYTES}; ++i;
		}
		block = NativeBlock::compile(source, constants, bytes, machine.memory, machine.cpu.stringPool(), machine.cpu.stringPool().intern("__index"));
	}
};

void rawContextValues(CpuMachine& machine) {
	auto& cpu = machine.cpu;
	const std::array values{valueNil(), valueFromTag(ValueTag::False, 37), valueFromTag(ValueTag::True, 37),
		valueFloat(-0.f), valueFloatBits(0xffa12345), valueFloat(std::numeric_limits<float>::infinity()),
		valueString(cpu.stringPool().intern("context")), valueTable(cpu.createTable().address()), valueClosure(cpu.activeThread()->frameAtDepth(0)->closureAddress()),
		valueThread(cpu.activeThread()->address)};
	ContextBlock globals(machine, {{OpCode::SETGL, 12, 0, 0, 1}, {OpCode::GETGL, 0, 0, 0, 1},
		{OpCode::SETSYS, 0, 0, 0, 1}, {OpCode::GETSYS, 1, 0, 0, 1}, {OpCode::K1, 2},
		{OpCode::SETGL, 2}, {OpCode::LOADNIL, 15, 0}, {OpCode::JMP}});
	ValueSlots registers(16);
	ValueSpan ordinary(machine.memory, 0x1000u, 0x1008u, 2), system(machine.memory, 0x1040u, 0x1048u, 2);
	for (const auto value : values) {
		registers.clear(0, registers.capacity()); ordinary.clear(0, ordinary.size()); system.clear(0, system.size()); registers.set(12, value);
		NativeBlockRunState state{.globalValues = ordinary, .systemGlobalValues = system, .remainingCycles = 100};
		require(globals.block->run(registers.view(), state) == &globals.block->terminal && registers.get(0) == value && registers.get(1) == value
			&& ordinary.get(1) == value && system.get(1) == value && ordinary.get(0) == valueInteger(1) && system.get(0) == valueNil()
			&& state.registerTop == 3, "raw global banks preserve every kind, cached definitions and namespace without a source-top write");
	}
	// Arm only the destination tag word. The payload must not change
	// until the checked store, even though the payload has no watch.
	registers.set(12, valueFloatBits(0xffa12345));
	ordinary.set(1, valueInteger(99));
	machine.memory.ramWriteWatches().armCodeRange(0x1008u, 4u);
	NativeBlockRunState watchedGlobal{.globalValues = ordinary, .systemGlobalValues = system, .remainingCycles = 100};
	const auto* globalExit = globals.block->run(registers.view(), watchedGlobal);
	require(globalExit->exit == NativeBlockExit::WriteGlobal && watchedGlobal.remainingCycles == 100 - BASE_CYCLES[static_cast<u8>(OpCode::SETGL)]
		&& ordinary.get(1) == valueInteger(99), "native watched global store leaves before changing either lane");
	auto* owner = cpu.activeThread();
	owner->resizeStack(32);
	auto captureRegisters = owner->stack.subspan(0, 16);
	auto outerRegisters = owner->stack.subspan(16, 1);
	CallFrame frame;
	frame.bindControl(machine.memory, DYNAMIC_RAM_BASE - RAM_BASE + 0x800);
	frame.registers = captureRegisters;
	auto& heap = cpu.gcHeap();
	std::array<u32, 2> cells{};
	const u32 boundClosure = heap.budget.allocateClosureRecord(2, false, cells);
	const u32 open = cells[0], closed = cells[1];
	Upvalue::bindOpen(machine.memory, open, owner->address, 0, 0);
	ClosureRecord::initialize(heap.memory, boundClosure, {}, heap.white(), 2, false, false);
	frame.writeControl(bmsx::FrameField::Closure, boundClosure);
	ClosureRecord::setCaptureAddress(heap.memory, boundClosure, 0, open);
	ClosureRecord::setCaptureAddress(heap.memory, boundClosure, 1, closed);
	ContextBlock captures(machine, {{OpCode::K1, 0}, {OpCode::GETUP, 1}, {OpCode::KSMI, 2, 0, 0, 9},
		{OpCode::SETUP, 2}, {OpCode::ADD, 3, 0, 1}, {OpCode::GETUP, 4}, {OpCode::SETUP, 12, 1}, {OpCode::GETUP, 6, 1}, {OpCode::JMP}});
	captureRegisters.clear(0, captureRegisters.size());
	NativeBlockRunState alias{.frame = &frame, .heap = &heap, .remainingCycles = 100, .ram = machine.memory.ramData()};
	require(captures.block->run(captureRegisters, alias) == &captures.block->sideExits[0] && alias.registerTop == 3
		&& captureRegisters.get(0) == valueInteger(1) && captureRegisters.get(1) == valueInteger(1) && captureRegisters.get(2) == valueInteger(9)
		&& captureRegisters.get(3) == valueNil(), "the self-alias guard publishes the exact prefix before writing a captured register");
	Upvalue::bindOpen(machine.memory, open, owner->address, 16, 0);
	ContextBlock outerRead(machine, {{OpCode::GETUP, 1}, {OpCode::K1, 0}, {OpCode::ADD, 3, 0, 1},
		{OpCode::SETUP, 12, 1}, {OpCode::GETUP, 6, 1}, {OpCode::JMP}});
	for (const auto value : values) {
		captureRegisters.clear(0, captureRegisters.size()); captureRegisters.set(12, value); outerRegisters.set(0, valueInteger(1));
		NativeBlockRunState state{.frame = &frame, .heap = &heap, .remainingCycles = 100, .ram = machine.memory.ramData()};
		require(outerRead.block->run(captureRegisters, state) == &outerRead.block->terminal && captureRegisters.get(0) == valueInteger(1)
			&& captureRegisters.get(1) == valueInteger(1) && captureRegisters.get(3) == valueInteger(2)
			&& captureRegisters.get(6) == value && Upvalue::load(machine.memory, closed) == value && state.registerTop == 7,
			"native outer and closed cells preserve raw values without invalidating unrelated register definitions");
	}
	machine.memory.writeRamRecordByte(closed + GC_COLOR_OFFSET, GC_OLD | heap.white());
	const Value scalar = valueFloatBits(0xffa54321u);
	captureRegisters.set(12, scalar);
	NativeBlockRunState closedStore{.frame = &frame, .heap = &heap,
		.remainingCycles = 100, .ram = machine.memory.ramData()};
	require(outerRead.block->run(captureRegisters, closedStore) == &outerRead.block->terminal
		&& Upvalue::load(machine.memory, closed) == scalar
		&& machine.memory.readRamRecordByte(closed + GC_COLOR_OFFSET) == (GC_OLD | heap.white()),
		"native scalar writes do not remember old closed cells");
	const Value child = valueTable(cpu.createTable().address());
	captureRegisters.set(12, child);
	closedStore.remainingCycles = 100;
	require(outerRead.block->run(captureRegisters, closedStore)->exit == NativeBlockExit::WriteUpvalue
		&& Upvalue::load(machine.memory, closed) == scalar, "the first reference write to an old cell leaves before changing either lane");
	Upvalue::store(heap, closed, child);
	require(machine.memory.readRamRecordByte(closed + GC_COLOR_OFFSET) == (GC_OLD | GC_REMEMBERED | heap.white())
		&& Upvalue::load(machine.memory, closed) == child,
		"the semantic store publishes the new edge and remembers its owner");

	machine.memory.writeRamRecordByte(closed + GC_COLOR_OFFSET, GC_OLD | GC_REMEMBERED | 3u);
	const u32 head = heap.changedHeadOffset();
	const u32 previousHead = machine.memory.readRamRecordWord(head);
	auto& watches = machine.memory.ramWriteWatches();
	const u32 cellLink = (closed + UPVALUE_NEXT) & RAM_RECORD_WORD_MASK;
	watches.armCodeRange(cellLink, sizeof(u32));
	captureRegisters.set(12, valueInteger(23));
	closedStore.remainingCycles = 100;
	require(outerRead.block->run(captureRegisters, closedStore) == &outerRead.block->terminal
		&& Upvalue::load(machine.memory, closed) == valueInteger(23)
		&& machine.memory.readRamRecordByte(closed + GC_COLOR_OFFSET) == (GC_OLD | GC_REMEMBERED | 3u)
		&& machine.memory.readRamRecordWord(head) == previousHead,
		"a scalar write to a black cell does not touch its watched queue link");
	captureRegisters.set(12, child);
	closedStore.remainingCycles = 100;
	require(outerRead.block->run(captureRegisters, closedStore)->exit == NativeBlockExit::WriteUpvalue
		&& Upvalue::load(machine.memory, closed) == valueInteger(23)
		&& machine.memory.readRamRecordByte(closed + GC_COLOR_OFFSET) == (GC_OLD | GC_REMEMBERED | 3u)
		&& machine.memory.readRamRecordWord(head) == previousHead,
		"a watched queue link defers the reference barrier and its value write");
	watches.clearCodeRange(cellLink, sizeof(u32));
	closedStore.remainingCycles = 100;
	require(outerRead.block->run(captureRegisters, closedStore) == &outerRead.block->terminal && Upvalue::load(machine.memory, closed) == child
		&& machine.memory.readRamRecordByte(closed + GC_COLOR_OFFSET) == (GC_OLD | GC_REMEMBERED | 2u)
		&& machine.memory.readRamRecordWord(closed + UPVALUE_NEXT) == previousHead
		&& machine.memory.readRamRecordWord(head) == ((closed & GC_RECORD_MASK) >> GC_RECORD_SHIFT),
		"generated SETUP publishes both the reference and the closed cell's raw changed-queue link");
	const u32 rawCell = DYNAMIC_RAM_BASE + 0x600u;
	machine.memory.writeRamRecordByte(rawCell, UPVALUE_RECORD_KIND);
	require(heap.cellRecordAddress(rawCell) == 0u, "an unallocated header is not a GC cell");
	machine.memory.writeRamRecordWord(boundClosure + CLOSURE_CAPTURE_WORDS + sizeof(u32), rawCell | 0x80000000u);
	captureRegisters.set(12, valueFloatBits(0x80000000u));
	NativeBlockRunState addressed{.frame = &frame, .heap = &heap,
		.remainingCycles = 100, .ram = machine.memory.ramData()};
	require(outerRead.block->run(captureRegisters, addressed) == &outerRead.block->terminal
		&& captureRegisters.get(6) == valueFloatBits(0x80000000u)
		&& machine.memory.readRamRecordWord(rawCell + UPVALUE_VALUE_WORD) == 0x80000000u
		&& Upvalue::load(machine.memory, closed) == child,
		"generated GETUP and SETUP use masked cell bytes rather than an unrelated host slot");
	machine.memory.writeRamRecordByte(rawCell + UPVALUE_FLAGS, UPVALUE_OPEN);
	machine.memory.writeRamRecordWord(rawCell + UPVALUE_VALUE_WORD, 16);
	machine.memory.writeRamRecordWord(rawCell + UPVALUE_OWNER, owner->address | 0x80000000u);
	outerRegisters.set(0, valueFloatBits(0xffa12345u));
	const u32 rawClosure = DYNAMIC_RAM_BASE + 0x700u;
	machine.memory.writeRamRecordWord(rawClosure + CLOSURE_CAPTURE_WORDS, rawCell | 0x80000000u);
	machine.memory.writeRamRecordWord(frame.controlOffset + static_cast<u32>(FrameField::Closure), rawClosure | 0x80000000u);
	ContextBlock rawOpen(machine, {{OpCode::GETUP, 1}, {OpCode::JMP}});
	NativeBlockRunState rawAlias{.frame = &frame, .heap = &heap,
		.remainingCycles = 100, .ram = machine.memory.ramData()};
	require(rawOpen.block->run(captureRegisters, rawAlias) == &rawOpen.block->terminal
		&& captureRegisters.get(1) == valueFloatBits(0xffa12345u),
		"generated GETUP resolves a raw frame closure and an open capture without host attachments");
	const std::array literals{valueNil(), valueBool(false), valueBool(true), values[6], valueFloat(-0.f), valueFloatBits(0xffa12345), valueInteger(11)};
	ValueSlots constants(literals.size());
	for (size_t i = 0; i < literals.size(); ++i) constants.set(i, literals[i]);
	for (const int destination : {0, 2}) {
		ContextBlock pool(machine, {{OpCode::K1, 8}, {OpCode::K1, 9}, {OpCode::LOADNIL, 8, 2},
			{OpCode::LOADNIL, 15, 0}, {OpCode::LOADKR, static_cast<u16>(destination), 2}, {OpCode::MOV, 3, static_cast<i16>(destination)}, {OpCode::JMP}}, constants.view());
		for (const auto& [index, expected] : std::array<std::pair<Value, int>, 9>{{
			{valueInteger(0), 0}, {valueFloat(1.9f), 1}, {valueFloat(2.9f), 2}, {valueInteger(3), 3},
			{valueFloat(4.f), 4}, {valueInteger(5), 5}, {valueInteger(6), 6}, {valueFloat(0x1p32f), 0}, {valueFloat(-0.f), 0}}}) {
			registers.clear(0, 16); registers.set(2, index);
			NativeBlockRunState state{.constants = constants.view(), .remainingCycles = 100};
			require(pool.block->run(registers.view(), state) == &pool.block->terminal && registers.get(3) == constants.get(expected)
				&& registers.get(8) == valueNil() && registers.get(9) == valueNil() && state.registerTop == 10,
				"nil fill discards dirty definitions and pool loads retain raw kinds across U32 conversion and aliases");
		}
	}
}

void varargAliasesAndSideExits(CpuMachine& machine) {
	ValueSlots stack(48);
	Thread thread(machine.cpu.gcHeap());
	thread.stack = stack.view();
	CallFrame frame;
	frame.thread = &thread;
	frame.registers = thread.stack.subspan(16, 32);
	frame.bindControl(machine.memory, DYNAMIC_RAM_BASE - RAM_BASE + 0x700);
	frame.writeControl(bmsx::FrameField::StackBase, 16);
	const std::array values{valueNil(), valueFromTag(ValueTag::False, 37), valueFromTag(ValueTag::True, 37),
		valueFloat(-0.f), valueFloatBits(0xffa12345), valueInteger(0),
		valueTable(machine.cpu.createTable().address()), valueThread(machine.cpu.activeThread()->address)};
	ContextBlock empty(machine, {{OpCode::VARARG, 31, 0}, {OpCode::JMP}});
	frame.writeControl(bmsx::FrameField::VarargCount, 0); frame.writeControl(bmsx::FrameField::StackCapacity, 16);
	for (size_t i = 0; i < stack.capacity(); ++i) stack.set(i, valueInteger(73));
	NativeBlockRunState zero{.frame = &frame, .remainingCycles = 100, .registerTop = 48};
	require(empty.block->run(frame.registers, zero) == &empty.block->terminal && zero.registerTop == 31,
		"an empty open VARARG resets top without touching or growing the destination range");
	for (size_t i = 0; i < stack.capacity(); ++i) require(stack.get(i) == valueInteger(73), "empty window leaves both planes unchanged");
	// The fixed form charges requested slots (also nil padding), never available slots.
	// B=1 performs no copy and leaves top alone even when A is beyond capacity.
	frame.writeControl(bmsx::FrameField::VarargBase, 14); frame.writeControl(bmsx::FrameField::VarargCount, 2);
	stack.set(14, valueString(machine.cpu.stringPool().intern("vararg"))); stack.set(15, valueFloatBits(0xffa12345));
	for (const int count : {0, 1, 5}) {
		const u16 first = count ? 6 : 31;
		ContextBlock fixed(machine, {{OpCode::VARARG, first, static_cast<i16>(count + 1)}});
		NativeBlockRunState state{.frame = &frame, .remainingCycles = 100, .registerTop = 3};
		require(fixed.block->run(frame.registers, state) == &fixed.block->terminal && state.registerTop == (count ? first + count : 3)
			&& state.remainingCycles == 100 - BASE_CYCLES[static_cast<u8>(OpCode::VARARG)] - count,
			"native fixed VARARG completes without a dispatch and charges the requested slots once");
		for (int i = 0; i < count; ++i)
			require(frame.registers.get(first + i) == (i < 2 ? stack.get(14 + i) : valueNil()), "fixed arguments truncate or nil-pad both planes");
	}
	for (const int fixed : {0, 5}) {
		ContextBlock first(machine, {{OpCode::K1, 1}, {OpCode::K1, 7}, {OpCode::VARARG, 2, static_cast<i16>(fixed == 0 ? 0 : fixed + 1)},
			{OpCode::MOV, 0, 7}, {OpCode::MOV, 1, 2}, {OpCode::BNOT, 15, 7}, {OpCode::JMP}});
		ContextBlock second(machine, {{OpCode::VARARG, 0, 0}, {OpCode::LOADKR, 15, 14}});
		second.block->linkFrom(first.block->terminal);
		for (const int count : {0, 2, 8}) {
			for (size_t i = 0; i < stack.capacity(); ++i) stack.set(i, valueInteger(73));
			frame.writeControl(bmsx::FrameField::VarargCount, count); frame.writeControl(bmsx::FrameField::StackCapacity, 16);
			frame.writeControl(bmsx::FrameField::VarargBase, frame.stackBase() - count);
			for (int i = 0; i < count; ++i) stack.set(static_cast<bmsx::i32>(frame.readControl(bmsx::FrameField::VarargBase)) + i, values[i]);
			frame.registers.set(14, valueInteger(1));
			NativeBlockRunState state{.frame = &frame, .remainingCycles = 100, .registerTop = 16};
			require(first.block->run(frame.registers, state) == &second.block->sideExits[1] && state.registerTop == count,
				"an invalid pool load after a linked open VARARG publishes its exact lowered top, not an earlier block maximum");
			for (int i = 0; i < count; ++i) require(frame.registers.get(i) == values[i], "varargs preserve every raw value bit");
			require(frame.registers.get(15) == valueInteger(fixed == 0 && count == 8 ? -1 : -2),
				"a word consumer sees the overwritten vararg kind, not a cached literal fact; fixed ranges retain untouched facts");
		}
		for (size_t i = 0; i < stack.capacity(); ++i) stack.set(i, valueInteger(73));
		frame.writeControl(bmsx::FrameField::VarargCount, 8); frame.writeControl(bmsx::FrameField::StackCapacity, 8);
		frame.writeControl(bmsx::FrameField::VarargBase, frame.stackBase() - 8);
		for (int i = 0; i < 8; ++i) stack.set(static_cast<bmsx::i32>(frame.readControl(bmsx::FrameField::VarargBase)) + i, values[i]);
		// Only the open first copy exceeds this capacity.
		if (fixed == 0) {
			NativeBlockRunState state{.frame = &frame, .remainingCycles = 100};
			require(first.block->run(frame.registers, state) == &first.block->sideExits[0] && state.registerTop == 8
				&& frame.registers.get(1) == valueInteger(1) && frame.registers.get(7) == valueInteger(1) && frame.registers.get(2) == valueInteger(73),
				"a capacity exit materializes only the prefix, before any copy or top reset");
		}
	}
}
#endif
} // namespace

int main() {
	try {
		physicalVarargWindow(); hotVarargFrames(0); hotVarargFrames(5); hotEmptyVararg(); hotConstantTrap(); hotUpvalueAlias(); hotGlobalBanks();
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
