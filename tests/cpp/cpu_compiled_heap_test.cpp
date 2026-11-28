#include "support/string_pool_reference.h"
#include "support/lua_heap_reference.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/gc_heap_reference.h"
#include "support/blua32_test_rom.h"
#include "support/closure_fixture.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"
#include "support/managed_fixture.h"
#include "support/table_allocation_reference.h"
#include "support/global_bank_reference.h"

#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <tuple>

using bmsx::test::NativeGlobalBankReference;

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
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image, test::RAM_CODE_FIXTURE_BYTES))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		test::seedManagedFixture(cpu, addresses);
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void fixedReadContinuation() {
	test::Blua32TestImage image; image.text.resize(INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 4}};
	CpuMachine native(image), scalar(image, true);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	native.cpu.setNativeCompilationProfiling(true);
#endif
	const u32 sourcePc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - INSTRUCTION_BYTES;
	const u32 targetPc = sourcePc + INSTRUCTION_BYTES;
	std::vector<u8> code(3 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, static_cast<u8>(OpCode::GETI), 2, 0, 1);
	writeInstruction(code, 1, static_cast<u8>(OpCode::KSMI), 1, 0, 7);
	writeInstruction(code, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(sourcePc, code.data(), code.size());
		machine->cpu.activeThread()->currentFrame->registers.set(0, valueTable(bmsx::test::allocateTableReference(machine->cpu).address()));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], sourcePc);
	}
	for (int pass = 0; pass < 4; ++pass) {
		test::runCpuParity(native.cpu, scalar.cpu, 4096);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		test::waitForFixtureWorkerRequests(native.cpu);
#endif
	}
	auto& lookup = *native.cpu.activeThread()->currentFrame->executionImage->nativeCodeLookup;
	auto* sourcePage = lookup.find(sourcePc, 0);
	auto* targetPage = lookup.find(targetPc, 0);
	constexpr u32 sourceWord = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES - 1u;
	test::waitForNativeEntry(native.cpu, *sourcePage, sourceWord);
	test::waitForNativeEntry(native.cpu, *targetPage, 0);
	auto* source = sourcePage->nativeBlocks->entries[sourceWord].get();
	const auto& exit = source->sideExits.front();
	const auto cell = exit.continuationCells[0];
	require(exit.exit == NativeBlockExit::ReadInteger && cell
		&& cell == exit.continuationCells[1] && *cell == targetPage->nativeCode[0],
		"same-frame helper binds the shared RAM successor's image-lifetime cell");
	for (int grant : {128, 1, 2, 3, 4, 5, 6, 7}) test::runCpuParity(native.cpu, scalar.cpu, grant);
	writeInstruction(code, 1, static_cast<u8>(OpCode::KSMI), 1, 0, 13);
	for (auto* machine : {&native, &scalar}) machine->memory.writeBytes(targetPc, code.data() + INSTRUCTION_BYTES, INSTRUCTION_BYTES);
	require(sourcePage->nativeBlocks->entries[sourceWord].get() == source && *cell == nullptr,
		"rewriting the successor withdraws its cell without retiring the unmodified helper");
	for (int pass = 0; pass < 4; ++pass) {
		test::runCpuParity(native.cpu, scalar.cpu, 4096);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		test::waitForFixtureWorkerRequests(native.cpu);
#endif
	}
	test::waitForNativeEntry(native.cpu, *targetPage, 0);
	require(exit.continuationCells[0] == cell && *cell == targetPage->nativeCode[0]
		&& native.cpu.readFrameRegister(0, 1) == valueInteger(13), "publication reuses the withdrawn continuation cell");
	// Redirect only the raw code cell, leaving the ordinary target descriptor
	// intact. Generic C++ lookup would execute 13, not the marker's 29.
	// This fixture is disposable and never resumes the redirected cache.
	const u32 markerPc = targetPc + 16u * INSTRUCTION_BYTES;
	std::vector<u8> marker(2 * INSTRUCTION_BYTES);
	writeInstruction(marker, 0, static_cast<u8>(OpCode::KSMI), 1, 0, 29);
	writeInstruction(marker, 1, static_cast<u8>(OpCode::JMP), 0, 63, 45, 255);
	native.memory.writeBytes(markerPc, marker.data(), marker.size());
	for (int visit = 0; visit < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++visit) {
		native.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, native.rom.functionAddresses[0], markerPc);
		native.cpu.runUntilDepth(0, 2);
	}
	test::waitForNativeEntry(native.cpu, *targetPage, 16u);
	native.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, native.rom.functionAddresses[0], sourcePc);
	targetPage->nativeCode[0] = targetPage->nativeCode[16];
	native.cpu.runUntilDepth(0, 5);
	require(native.cpu.readFrameRegister(0, 1) == valueInteger(29), "helper resumes through the raw code cell, not a second descriptor lookup");
}
#endif

void requireParity(CpuMachine& native, CpuMachine& scalar) {
	const auto a = native.cpu.captureRuntimeState(), b = scalar.cpu.captureRuntimeState();
	require((a == b && bmsx::test::sameLanguageRam(native.cpu, scalar.cpu))
		&& bmsx::LuaHeap(native.cpu).usedBytes() == bmsx::LuaHeap(scalar.cpu).usedBytes() && bmsx::LuaHeap(native.cpu).collectionTarget() == bmsx::LuaHeap(scalar.cpu).collectionTarget(),
		"the complete value graph, allocation roots and heap accounting agree");
	require(std::tie(a.statusWord, a.causeWord, a.epcWord, a.badAddressWord, a.luaFaultReasonWord, a.exceptionDomainWord,
		a.nmiReturnCauseWord, a.nmiReturnEpcWord, a.nmiReturnBadAddressWord, a.nmiReturnLuaFaultReasonWord,
		a.nmiReturnExceptionDomainWord, a.nonMaskableInterruptPending, a.hardHalted, a.haltedUntilIrqFrameDepth,
		a.haltedUntilIrqThreadAddress, a.interruptEventPending, a.memoryWriteBlocked, a.memoryWriteBlockedAddress, a.yieldRequested)
		== std::tie(b.statusWord, b.causeWord, b.epcWord, b.badAddressWord, b.luaFaultReasonWord, b.exceptionDomainWord,
		b.nmiReturnCauseWord, b.nmiReturnEpcWord, b.nmiReturnBadAddressWord, b.nmiReturnLuaFaultReasonWord,
		b.nmiReturnExceptionDomainWord, b.nonMaskableInterruptPending, b.hardHalted, b.haltedUntilIrqFrameDepth,
		b.haltedUntilIrqThreadAddress, b.interruptEventPending, b.memoryWriteBlocked, b.memoryWriteBlockedAddress, b.yieldRequested),
		"all control words, interrupt and execution latches agree");
	require(native.cpu.instructionBudgetRemaining == scalar.cpu.instructionBudgetRemaining
		&& native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc(),
		"cycle grants and the physical instruction prefix/body boundary agree");
	const auto& left = *native.cpu.activeThread(); const auto& right = *scalar.cpu.activeThread();
	const CallFrame* x = left.firstFrame; const CallFrame* y = right.firstFrame;
	require(left.frameDepth() == right.frameDepth(), "frame depths agree");
	for (size_t i = 0; i < left.frameDepth(); ++i, x = x->next, y = y->next) require(x->readControl(bmsx::FrameField::Pc) == y->readControl(bmsx::FrameField::Pc) && static_cast<bmsx::i32>(x->readControl(bmsx::FrameField::Top)) == static_cast<bmsx::i32>(y->readControl(bmsx::FrameField::Top))
		&& x->stackBase() == y->stackBase() && x->stackCapacity() == y->stackCapacity(), "live frame extents agree");
}

} // namespace

int main() {
	try {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		fixedReadContinuation();
#endif
		std::cout << "Compiled CPU heap tests passed\n"; return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
