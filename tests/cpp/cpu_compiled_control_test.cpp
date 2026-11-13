#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

#include <algorithm>
#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <tuple>

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
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require(std::tie(a.statusWord, a.causeWord, a.epcWord, a.badAddressWord, a.luaFaultReasonWord, a.exceptionDomainWord,
		a.nmiReturnCauseWord, a.nmiReturnEpcWord, a.nmiReturnBadAddressWord, a.nmiReturnLuaFaultReasonWord,
		a.nmiReturnExceptionDomainWord, a.nonMaskableInterruptPending, a.hardHalted, a.haltedUntilIrqFrameDepth,
		a.haltedUntilIrqThreadRef, a.interruptEventPending, a.memoryWriteBlocked, a.memoryWriteBlockedAddress, a.yieldRequested)
		== std::tie(b.statusWord, b.causeWord, b.epcWord, b.badAddressWord, b.luaFaultReasonWord, b.exceptionDomainWord,
		b.nmiReturnCauseWord, b.nmiReturnEpcWord, b.nmiReturnBadAddressWord, b.nmiReturnLuaFaultReasonWord,
		b.nmiReturnExceptionDomainWord, b.nonMaskableInterruptPending, b.hardHalted, b.haltedUntilIrqFrameDepth,
		b.haltedUntilIrqThreadRef, b.interruptEventPending, b.memoryWriteBlocked, b.memoryWriteBlockedAddress, b.yieldRequested), "all control words and latches agree");
	require(std::ranges::equal(a.snapshot.words(), b.snapshot.words()) && a.nextObjectHashId == b.nextObjectHashId
		&& a.luaHeap.trackedBytes == b.luaHeap.trackedBytes, "guest values, roots and allocation accounting agree");
	require(native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc(),
		"physical instruction boundaries and WIDE bodies agree");
	const auto& left = *native.cpu.activeThread(); const auto& right = *scalar.cpu.activeThread();
	const CallFrame* x = left.firstFrame; const CallFrame* y = right.firstFrame;
	require(left.frameDepth == right.frameDepth, "control transitions preserve frame depth");
	for (size_t i = 0; i < left.frameDepth; ++i, x = x->next, y = y->next) {
		require(x->pc == y->pc && x->top == y->top && x->stackBase == y->stackBase
			&& x->stackCapacity == y->stackCapacity && x->isExceptionFrame == y->isExceptionFrame
			&& x->isNonMaskableExceptionFrame == y->isNonMaskableExceptionFrame, "all live frame boundaries agree");
	}
}

void rawReadsRetainFullWords() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 8, 0, 0);
	const std::array fields{COP0_STATUS, COP0_CAUSE, COP0_EPC, COP0_BAD_ADDRESS, COP0_LUA_FAULT_REASON, COP0_EXEC};
	for (u32 i = 0; i < fields.size(); ++i) writeInstruction(image.text, i + 1, static_cast<u8>(OpCode::MFC0), i, fields[i], 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::ADD), 9, 1, 8);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::JMP), 0, 63, 55, 255);
	writeInstruction(image.text, 32, static_cast<u8>(OpCode::MTC0), 0, COP0_STATUS, 0);
	writeInstruction(image.text, 48, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 49, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 9, .maxStack = 10}, {.firstWord = 32, .wordCount = 1}, {.firstWord = 48, .wordCount = 2}};
	image.exceptionFunctionIndex = 2;
	for (u32 word : {0u, 0x80000000u, 0xffffffffu, 0xa5a55a5au}) {
		CpuMachine native(image), scalar(image, true);
		for (auto* m : {&native, &scalar}) {
			auto state = m->cpu.captureRuntimeState(); state.statusWord = word & ~CPU_STATUS_USER_MODE_CURRENT;
			state.causeWord = word; state.epcWord = word ^ 0x13579bdfu; state.badAddressWord = ~word; state.luaFaultReasonWord = word;
			m->cpu.restoreRuntimeState(state); m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 900);
		}
		requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
		test::waitForNativeEntry(native.cpu, page, (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
		require(page.nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]->sourceWords == 9,
			"all six CP0 reads and dependent arithmetic execute in one native body");
		require(page.nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]->sideExits.size() == 1,
			"implemented CP0 reads share one privilege guard, without unused fault descriptors");
#endif
		const std::array expected{word & ~CPU_STATUS_USER_MODE_CURRENT, word, word ^ 0x13579bdfu, ~word, word, 0u};
		for (size_t i = 0; i < expected.size(); ++i) require(native.cpu.readFrameRegister(0, i) == valueNumber(expected[i]), "CP0 reads are unsigned-word Numbers");
		require(native.cpu.readFrameRegister(0, 9) == valueNumber(static_cast<double>(word) + 1.0), "ordinary arithmetic after MFC0 is not word-wrapped");
		for (auto* m : {&native, &scalar}) { m->cpu.writeEpcWord(word + 1u); m->cpu.runUntilDepth(0, 18); }
		requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 2) == valueNumber(word + 1u), "compiled reads consume the live registerfile, not captured words");
		for (auto* m : {&native, &scalar}) {
			auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers[0] = valueNumber(CPU_STATUS_USER_MODE_CURRENT);
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress + 32u * INSTRUCTION_BYTES);
			m->cpu.runUntilDepth(0, 1); frame.registers[0] = frame.registers[8] = valueNumber(73); frame.top = 0;
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			m->cpu.runUntilDepth(0, 18);
		}
		requireParity(native, scalar);
		require(native.cpu.readFrameRegister(0, 0) == valueNumber(73) && native.cpu.readFrameRegister(0, 8) == valueNumber(1)
			&& native.cpu.activeThread()->frameAtDepth(0)->top == 9 && native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES,
			"a hot valid MFC0's privilege exit publishes its pending K1 prefix, not the unexecuted destination");
	}
}

void writesConvertWithoutChangingSources() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 4, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MTC0), 4, COP0_EPC, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MFC0), 5, COP0_EPC, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::MOV), 6, 4, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::MTC0), 12, COP0_CAUSE, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 13}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) { auto* r = m->cpu.activeThread()->frameAtDepth(0)->registers; r[0] = r[1] = valueNumber(0); r[12] = valueTable(m->cpu.createTable()); m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 600); }
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	test::waitForNativeEntry(native.cpu, page, (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	require(page.nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]->sourceWords == 6,
		"ordinary CP0 writes, reads and dependent values stay in one native body");
	require(page.nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]->sideExits.size() == 1,
		"EPC and ignored writes share the initial privilege guard");
#endif
	for (const auto value : {valueNumber(-0.0), valueNumber(-1.5), valueNumber(4294967297.75), valueNumber(1e100),
		valueNumber(std::numeric_limits<double>::infinity()), VALUE_QNAN_MASK, valueNil(), valueBool(true)}) {
		for (auto* m : {&native, &scalar}) { m->cpu.activeThread()->frameAtDepth(0)->registers[0] = value; m->cpu.runUntilDepth(0, 12); }
		requireParity(native, scalar);
		const Value numeric = valueNumber(asNumber(value) + 0.0);
		require(native.cpu.readEpcWord() == toU32(numeric) && native.cpu.readCauseWord() == 0u
			&& native.cpu.readFrameRegister(0, 5) == valueNumber(toU32(numeric)) && native.cpu.readFrameRegister(0, 6) == numeric
			&& native.cpu.activeThread()->frameAtDepth(0)->top == 7,
			"MTC0 converts a word without rewriting its numeric source, and ignored writes retain Cause");
	}
}

void statusWriteRechecksInterrupts() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::ADD), 3, 0, 1);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::MTC0), 3, COP0_STATUS, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::KSMI), 6, 0, 9);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	writeInstruction(image.text, 17, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 7}, {.firstWord = 16, .wordCount = 2}};
	image.irqFunctionIndex = 1;
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers[0] = frame.registers[1] = valueNumber(0);
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 400); frame.top = 0; frame.registers[0] = valueNumber(1); frame.registers[6] = valueNumber(73);
		m->memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_VBLANK); m->irq.raise(IRQ_VBLANK);
		require(m->cpu.runUntilDepth(0, 32) == RunResult::Halted && m->cpu.isExceptionFrame(1),
			"enabling interrupts enters the IRQ handler before the successor instruction");
	}
	requireParity(native, scalar);
	require(native.cpu.readFramePc(0) == native.rom.textAddress + 2u * INSTRUCTION_BYTES
		&& native.cpu.readFrameRegister(0, 6) == valueNumber(73) && native.cpu.readCauseWord() == CPU_CAUSE_IRQ
		&& native.cpu.readEpcWord() == native.cpu.readFramePc(0), "the generated Status write cannot link across IRQ arbitration");
}

test::Blua32TestImage faultLoopImage(OpCode op, bool wide) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MTC0), 0, COP0_STATUS, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::K1), 3, 0, 0);
	if (wide) writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 1, 0);
	writeInstruction(image.text, wide ? 3 : 2, static_cast<u8>(op), 12, 44, 0);
	writeInstruction(image.text, wide ? 4 : 3, static_cast<u8>(OpCode::JMP), 0, 63, wide ? 61 : 62, 255);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::GETGL), 0, 0, 0);
	writeInstruction(image.text, 17, static_cast<u8>(OpCode::MTC0), 0, COP0_STATUS, 0);
	writeInstruction(image.text, 18, static_cast<u8>(OpCode::WIDE), 255, 255, 255);
	writeInstruction(image.text, 19, static_cast<u8>(OpCode::RFE), 63, 63, 63, 255);
	image.functions = {{.firstWord = 0, .wordCount = wide ? 5u : 4u, .maxStack = 16}, {.firstWord = 16, .wordCount = 4, .maxStack = 1}};
	image.exceptionFunctionIndex = 1; image.globalNames = {"returnStatus"};
	return image;
}

void unknownFieldStillFaultsAfterAnEarlierGuard() {
	auto image = faultLoopImage(OpCode::MFC0, false);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MFC0), 6, COP0_EPC, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::MFC0), 12, 44, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions[0].wordCount = 5;
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers[0] = valueNumber(CPU_STATUS_USER_MODE_CURRENT);
		frame.registers[12] = valueTable(m->cpu.createTable());
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("returnStatus"), valueNumber(8)); m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 900);
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("returnStatus"), valueNumber(0));
		require(m->cpu.runUntilDepth(0, 20) == RunResult::Halted, "a late unknown selector still hard-halts after the earlier guard succeeds");
	}
	requireParity(native, scalar);
	require(native.cpu.readCurrentInstructionPc() == native.rom.textAddress + 3u * INSTRUCTION_BYTES
		&& native.cpu.readFrameRegister(0, 6) == valueNumber(native.rom.textAddress + 2u * INSTRUCTION_BYTES)
		&& valueIsTable(native.cpu.readFrameRegister(0, 12)) && native.cpu.activeThread()->frameAtDepth(0)->top == 7,
		"the later sparse fault edge publishes the successful CP0-read prefix, not the rejected destination");
}

void privilegeFaultsAndExceptionReturns(OpCode op, bool wide, bool returnIntoRoot) {
	const auto image = faultLoopImage(op, wide); CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers[0] = valueNumber(CPU_STATUS_USER_MODE_CURRENT);
		frame.registers[12] = valueTable(m->cpu.createTable());
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("returnStatus"), valueNumber(0xa5a5a508u));
	}
	test::runCpuParity(native.cpu, scalar.cpu, NATIVE_WARM_SCALE * 900);
	requireParity(native, scalar);
	require(native.cpu.readCauseWord() == CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE && native.cpu.readEpcWord() == native.rom.textAddress + 2u * INSTRUCTION_BYTES,
		"user mode faults before selecting an unknown CP0 field or converting a source");
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
	for (;;) {
		bool compiled = false, returned = false;
		for (const auto& [key, page] : native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages) if (page.nativeBlocks) {
			for (const auto& block : page.nativeBlocks->entries) if (block) {
				compiled |= block->sideExits.size() != 0 && block->sideExits[0].currentPc == native.rom.textAddress + 2u * INSTRUCTION_BYTES;
				returned |= block->terminal.exit == NativeBlockExit::ExceptionReturn && block->sourceWords == 2;
			}
		}
		if (compiled && returned) break;
		require(std::chrono::steady_clock::now() < deadline, "the repeated privilege fault and WIDE RFE both execute through generated control exits");
		test::runCpuParity(native.cpu, scalar.cpu, NATIVE_WARM_SCALE * 900);
		std::this_thread::yield();
	}
	requireParity(native, scalar);
#endif
	for (auto* m : {&native, &scalar}) {
		if (returnIntoRoot) {
			for (int step = 0; step < 8 && m->cpu.activeThread()->frameDepth > 1; ++step) m->cpu.runUntilDepth(0, 1);
			require(m->cpu.activeThread()->frameDepth == 1, "the warmed handler must return before revisiting it from an ordinary frame");
			m->cpu.runUntilDepth(0, 1);
			m->cpu.writeEpcWord(m->rom.textAddress + 18u * INSTRUCTION_BYTES);
		}
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("returnStatus"), valueNumber(0));
		require(m->cpu.runUntilDepth(0, 20) == RunResult::Halted, "unknown supervisor fields and RFE from an ordinary frame hard-halt");
	}
	requireParity(native, scalar);
	require(native.cpu.captureRuntimeState().hardHalted && native.cpu.readCauseWord() == CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE
		&& valueIsTable(native.cpu.readFrameRegister(0, 12)) && native.cpu.activeThread()->frameAtDepth(0)->top == 4,
		"a rejected control operation preserves Cause, its unwritten destination and prefix top");
}

void execReplacesFramesAfterNativeReturn() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	for (const u32 word : {0u, 16u}) {
		writeInstruction(image.text, word, static_cast<u8>(OpCode::GETGL), 0, 0, word == 0 ? 0 : 1);
		writeInstruction(image.text, word + 1, static_cast<u8>(OpCode::MTC0), 0, COP0_EXEC, 0);
	}
	writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 2}, {.firstWord = 16, .wordCount = 2}, {.firstWord = 32, .wordCount = 1, .staticClosure = false}};
	image.globalNames = {"next", "start"};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("next"), valueNumber(m->rom.functionAddresses[1] + 0.75));
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("start"), valueNumber(m->rom.functionAddresses[0]));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 800);
	}
	requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	bool generated = false;
	for (const auto& [key, page] : native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages) if (page.nativeBlocks) {
		const auto& block = page.nativeBlocks->entries[(native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
		generated |= block && block->terminal.exit == NativeBlockExit::ExecuteFunction && block->terminal.currentPc == native.rom.textAddress + INSTRUCTION_BYTES;
	}
	require(generated, "the context-replacing EXEC is a real generated exit, even when the new frame has not fetched yet");
#endif
	for (auto* m : {&native, &scalar}) {
		for (const auto key : {"next", "start"}) m->cpu.setGlobalByKey(*m->cpu.stringPool().find(key), valueNumber(m->rom.functionAddresses[2]));
		require(m->cpu.runUntilDepth(0, 4) == RunResult::Halted, "EXEC rejects non-static records without retaining an obsolete native frame");
	}
	requireParity(native, scalar);
	require(native.cpu.captureRuntimeState().hardHalted, "a non-static EXEC target hard-halts instead of entering its HALT body");
}

void nmiReturnsRetainedWordsAndUsesActiveEpc() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::ADD), 1, 1, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::MFC0), 0, COP0_CAUSE, 0);
	writeInstruction(image.text, 17, static_cast<u8>(OpCode::WIDE), 255, 255, 255);
	writeInstruction(image.text, 18, static_cast<u8>(OpCode::RFE), 63, 63, 63, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 2}, {.firstWord = 16, .wordCount = 3}};
	image.exceptionFunctionIndex = 1;
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto state = m->cpu.captureRuntimeState(); state.statusWord = 0xa5a5a511u; state.causeWord = 0xdeadbeefu;
		state.epcWord = 0x12345679u; state.badAddressWord = 0x87654321u; state.luaFaultReasonWord = 0x80000000u; state.exceptionDomainWord = 7;
		m->cpu.restoreRuntimeState(state); m->cpu.activeThread()->frameAtDepth(0)->registers[1] = valueNumber(0); m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 300);
	}
	for (int iteration = 0; iteration < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++iteration) {
		for (auto* m : {&native, &scalar}) {
			const auto before = m->cpu.captureRuntimeState(); m->cpu.requestNonMaskableInterrupt();
			require(m->cpu.enterPendingInterrupt(), "NMI enters its real exception frame");
			m->cpu.writeEpcWord(m->rom.textAddress + INSTRUCTION_BYTES);
			require(m->cpu.runUntilDepth(1, 100) == RunResult::Halted, "NMI returns to its outer continuation depth");
			const auto after = m->cpu.captureRuntimeState();
			const u32 entered = (before.statusWord & ~CPU_STATUS_MODE_STACK_MASK) | ((before.statusWord << 2u) & CPU_STATUS_MODE_STACK_MASK);
			require(after.statusWord == ((entered & ~CPU_STATUS_RFE_RESTORE_MASK) | ((entered >> 2u) & CPU_STATUS_RFE_RESTORE_MASK))
				&& after.causeWord == before.causeWord && after.epcWord == before.epcWord && after.badAddressWord == before.badAddressWord
				&& after.luaFaultReasonWord == before.luaFaultReasonWord && after.exceptionDomainWord == before.exceptionDomainWord
				&& m->cpu.readFramePc(0) == m->rom.textAddress + INSTRUCTION_BYTES,
				"RFE samples active EPC before restoring all retained NMI words, without restoring Status wholesale");
		}
		requireParity(native, scalar);
		test::runCpuParity(native.cpu, scalar.cpu, 1);
		requireParity(native, scalar);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	bool generated = false;
	for (const auto& [key, page] : native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages) if (page.nativeBlocks) {
		const auto& block = page.nativeBlocks->entries[((native.rom.textAddress + 16u * INSTRUCTION_BYTES) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
		generated |= block && block->terminal.exit == NativeBlockExit::ExceptionReturn && block->sourceWords == 3;
	}
	require(generated, "the repeatedly entered NMI handler executes its CP0 read and WIDE RFE in a native body");
	const u32 continuation = native.rom.textAddress + INSTRUCTION_BYTES;
	const auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	require(static_cast<bool>(page.nativeBlocks->entries[(continuation & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]),
		"a repeated RFE entry into the middle of a hot body is a translation entry, unlike an arbitrary grant resumption");
#endif
}
} // namespace

int main() {
	try {
		rawReadsRetainFullWords(); writesConvertWithoutChangingSources(); statusWriteRechecksInterrupts();
		unknownFieldStillFaultsAfterAnEarlierGuard();
		for (const auto op : {OpCode::MFC0, OpCode::MTC0}) for (const bool wide : {false, true}) privilegeFaultsAndExceptionReturns(op, wide, false);
		privilegeFaultsAndExceptionReturns(OpCode::MFC0, false, true);
		execReplacesFramesAfterNativeReturn(); nmiReturnsRetainedWordsAndUsesActiveEpc();
		std::cout << "Compiled CP0 control tests passed\n";
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
