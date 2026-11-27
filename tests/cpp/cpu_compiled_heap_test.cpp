#include "machine/cpu/cpu.h"
#include "common/utf8.h"
#include "machine/common/numeric.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/closure_fixture.h"
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
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image, test::RAM_CODE_FIXTURE_BYTES))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
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
		machine->cpu.activeThread()->currentFrame->registers.set(0, valueTable(machine->cpu.createTable().address()));
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
		&& native.cpu.luaHeap().usedBytes() == scalar.cpu.luaHeap().usedBytes() && native.cpu.luaHeap().collectionTarget() == scalar.cpu.luaHeap().collectionTarget(),
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

void concatKindsAndAliases(int destination) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 8, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CONCAT), destination, 0, 1);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 16}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) for (int warm = 0; warm < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++warm) {
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers.set(0, valueInteger(1)); frame.registers.set(1, valueInteger(2));
		m->cpu.runUntilDepth(0, 4);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, word);
	requireParity(native, scalar);
	const auto& block = page.nativeBlocks->entries[word];
	require(block && block->terminal.exit == NativeBlockExit::Concat && block->sourceWords == 2, "the allocating concatenation really terminates a native prefix");
#endif
	const std::array<std::pair<Value, std::string_view>, 10> values{{{valueNil(), "nil"}, {valueBool(false), "false"},
		{valueBool(true), "true"}, {valueInteger(0), "0"}, {valueFloat(-0.f), "-0.0"},
		{valueFloatBits(0xffa12345), "nan"}, {valueFloatBits(0x7f800000), "inf"},
		{valueFloatBits(0xff800000), "-inf"}, {valueFloat(1.234565f), "1.234565"}, {valueBuiltinFunction(BuiltinFunctionId::Type), "function"}}};
	const std::array extra{std::string("λ\0🍻", 7), std::string("table"), std::string("function"), std::string("thread")};
	for (size_t kind = 0; kind < values.size() + extra.size(); ++kind) {
		const std::string expected = std::string(kind < values.size() ? values[kind].second : std::string_view(extra[kind - values.size()])) + "!";
		for (auto* m : {&native, &scalar}) {
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.writeControl(bmsx::FrameField::Top, 0);
			if (kind < values.size()) frame.registers.set(0, values[kind].first);
			else switch (kind - values.size()) {
				case 0: frame.registers.set(0, valueString(m->cpu.stringPool().intern(extra[0]))); break;
				case 1: frame.registers.set(0, valueTable(m->cpu.createTable(0, 0).address())); break;
				case 2: frame.registers.set(0, valueClosure(test::seedTestCapturedClosure(m->cpu, m->rom.functionAddresses[0], {}))); break;
				case 3: frame.registers.set(0, valueThread(m->cpu.activeThread()->address)); break;
			}
			frame.registers.set(1, valueString(m->cpu.stringPool().intern("!")));
		}
		require(native.cpu.runUntilDepth(0, 4) == scalar.cpu.runUntilDepth(0, 4), "aliasing concatenation consumes the same grant"); requireParity(native, scalar);
		require(native.cpu.stringPool().toString(asStringId(native.cpu.readFrameRegister(0, destination))) == expected, "every language kind uses the specified text conversion");
		require(static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Top)) == 9, "the numeric prefix top is retained");
	}
}

void concatConstants() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CONCAT), 0, 63, 62, 63);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8}}; image.constants = {Blua32FloatConstant{0x80000000u}, std::string("🍻")};
	CpuMachine native(image), scalar(image, true); native.cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 320); scalar.cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 320); requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, word);
	requireParity(native, scalar);
	const auto& block = page.nativeBlocks->entries[word];
	require(block && block->terminal.exit == NativeBlockExit::Concat && block->terminal.operands.concat.left == -1 && block->terminal.operands.concat.right == -2, "the native terminal retains signed RK constants");
#endif
	require(native.cpu.stringPool().toString(asStringId(native.cpu.readFrameRegister(0, 0))) == "-0.0🍻", "numeric conversion is not u32 conversion");
}

void concatRange(int count) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 2, 1, count >> 9);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CONCATN), 1, 0, count & 63);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 1025}};
	CpuMachine native(image), scalar(image, true); std::string expected;
	for (int i = 0; i < count; ++i) expected += i == 0 ? "L" : i == 1 ? "false" : std::to_string(i % 10);
	for (int warm = 0; warm < NATIVE_BLOCK_COMPILATION_THRESHOLD + 8; ++warm) {
		for (auto* m : {&native, &scalar}) {
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			auto registers = m->cpu.activeThread()->frameAtDepth(0)->registers;
			for (int i = 0; i < count; ++i) registers.set(512 + i, i == 0 ? valueString(m->cpu.stringPool().intern("L"))
				: i == 1 ? valueBool(false) : valueInteger(i % 10));
		}
		require(native.cpu.runUntilDepth(0, 5) == scalar.cpu.runUntilDepth(0, 5), "WIDE ranges consume the same grant"); requireParity(native, scalar);
		if (count == 513) {
			require(native.cpu.readFrameRegister(0, 513) == valueBool(false), "destination remains live during assembly");
			const auto pending = native.cpu.captureRuntimeState().concat;
			require(pending.registersLeft == static_cast<u32>(count) && pending.length == 0u, "a base-only grant has sampled no source registers");
			native.cpu.runUntilDepth(0, count); scalar.cpu.runUntilDepth(0, count); requireParity(native, scalar);
			native.cpu.runUntilDepth(0, expected.size()); scalar.cpu.runUntilDepth(0, expected.size()); requireParity(native, scalar);
		}
		require(native.cpu.stringPool().toString(asStringId(native.cpu.readFrameRegister(0, 513))) == expected, "every source is read before the overlapping destination is written");
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, word);
	requireParity(native, scalar);
	const auto& block = page.nativeBlocks->entries[word];
	require(block && block->terminal.exit == NativeBlockExit::ConcatRange && block->terminal.operands.concatRange.count == count, "the full WIDE count belongs to the native terminal");
#endif
	require(static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Top)) == 514, "counted sources do not inflate the destination top");
}

void concatAllocationRoots() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::MOV), 7, 9, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::KNIL), 9, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CONCAT), 0, 1, 2);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 16}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto r = m->cpu.activeThread()->frameAtDepth(0)->registers; r.set(9, valueInteger(1)); r.set(1, valueInteger(2)); r.set(2, valueInteger(3));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 400);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, word);
	requireParity(native, scalar);
	const auto& block = page.nativeBlocks->entries[word];
	require(block && block->terminal.exit == NativeBlockExit::Concat, "collection is reached from actual native code");
#endif
	for (auto* m : {&native, &scalar}) {
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); auto r = frame.registers;
		TableRecord table = m->cpu.createTable(1024, 1); auto& strings = m->cpu.stringPool();
		table.setStringKey(strings.intern("payload"), valueString(strings.intern("retained")));
		r.set(9, valueTable(table.address())); r.set(1, valueString(strings.intern("fresh-"))); r.set(2, valueString(strings.intern("result"))); frame.writeControl(bmsx::FrameField::Top, 0);
		const auto heap = std::pair{m->cpu.luaHeap().usedBytes(), m->cpu.luaHeap().collectionTarget()};
		m->cpu.luaHeap().setCollectionTarget(heap.first);
	}
	require(native.cpu.runUntilDepth(0, 516) == scalar.cpu.runUntilDepth(0, 516), "the allocating instruction consumes the same grant"); requireParity(native, scalar);
	for (auto* m : {&native, &scalar}) {
		auto& strings = m->cpu.stringPool();
		auto r = m->cpu.activeThread()->frameAtDepth(0)->registers; TableRecord retained = asTable(r.get(7), m->cpu.gcHeap());
		require(m->cpu.collecting() && m->memory.readRamRecordByte(retained.address() + GC_COLOR_OFFSET) == 3, "the allocation assist traced the moved reference before returning");
		m->cpu.collectHeap();
		require(retained.getStringKey(*strings.find("payload")) == valueString(*strings.find("retained")), "a moved reference remains rooted across allocation");
		require(strings.toString(asStringId(r.get(0))) == "fresh-result", "allocation commits the entire concatenation result");
	}
}

void canonicalImmediateClosure() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0); writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::MOV), 1, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::WIDE), 0, 0, 0); writeInstruction(image.text, 5, static_cast<u8>(OpCode::CLOSURE), 2, 0, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 57, 255); writeInstruction(image.text, 16, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 8}, {.firstWord = 16, .wordCount = 1}};
	image.closureRelocations = {{2, DYNAMIC_RAM_BASE}, {5, DYNAMIC_RAM_BASE}};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		const u32 offset = m->rom.functionAddresses[1] - SYSTEM_ROM_BASE;
		m->memory.writeBytes(DYNAMIC_RAM_BASE, m->rom.bytes.data() + offset, BLUA32_FUNCTION_RECORD_SIZE);
		test::seedTestMappedClosure(m->cpu, DYNAMIC_RAM_BASE);
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 500);
	}
	requireParity(native, scalar);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, word);
	requireParity(native, scalar);
	const auto& block = page.nativeBlocks->entries[word];
	require(block && block->sourceWords == 3 && block->terminal.exit == NativeBlockExit::CreateClosure
		&& block->terminal.operands.closure.address == DYNAMIC_RAM_BASE / BLUA32_FUNCTION_ALIGNMENT && block->terminal.operands.closure.address > 0xffffu, "the native closure exit retains every Bx bit");
#endif
	require(native.cpu.readFrameRegister(0, 0) == native.cpu.readFrameRegister(0, 2), "STATIC creation preserves canonical function identity");
}

void closurePrototypeBusFault() {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 7, 0, 0); writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETGL), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 4, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255); writeInstruction(image.text, 16, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 257},
		{.firstWord = 16, .wordCount = 1}}; image.globalNames = {"target"};
	CpuMachine native(image), scalar(image, true); constexpr u32 bad = 0xdead0000u;
	for (auto* m : {&native, &scalar}) {
		test::seedTestRomClosure(m->cpu, m->rom.functionAddresses[1]);
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("target"), valueInteger(m->rom.functionAddresses[1]));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 504);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, word);
	requireParity(native, scalar);
	const auto& block = page.nativeBlocks->entries[word];
	require(block && block->terminal.exit == NativeBlockExit::CreateClosure && block->terminal.operands.closure.result == 256,
		"the actual hot register-address path retains its WIDE destination");
#endif
	for (auto* m : {&native, &scalar}) {
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("target"), valueInteger(bad));
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers.set(256, valueInteger(73)); frame.writeControl(bmsx::FrameField::Top, 0);
	}
	require(native.cpu.runUntilDepth(0, 6) == RunResult::Halted && scalar.cpu.runUntilDepth(0, 6) == RunResult::Halted, "a metadata bus fault hard-halts both paths"); requireParity(native, scalar);
	require(native.cpu.captureRuntimeState().hardHalted && native.cpu.readFrameRegister(0, 256) == valueInteger(73)
		&& static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Top)) == 8, "the failed instruction does not write or extend its destination");
	require(native.cpu.readCurrentInstructionPc() == native.rom.textAddress + 2u * INSTRUCTION_BYTES
		&& native.cpu.lastPc == native.rom.textAddress + 3u * INSTRUCTION_BYTES, "faults retain the WIDE prefix/body boundary");
}

void closureAddressAlias(int source) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), source >> 6, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETGL), source & 63, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), source >> 6, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CLOSURE), source & 63, (source >> 6) & 63, source & 63);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255); writeInstruction(image.text, 16, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = static_cast<u32>(source + 1)},
		{.firstWord = 16, .wordCount = 1}, {.firstWord = 16, .wordCount = 1}}; image.globalNames = {"target"};
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		m->memory.writeBytes(DYNAMIC_RAM_BASE, m->rom.bytes.data() + m->rom.functionAddresses[2] - SYSTEM_ROM_BASE, BLUA32_FUNCTION_RECORD_SIZE);
		test::seedTestMappedClosure(m->cpu, DYNAMIC_RAM_BASE);
		test::seedTestRomClosure(m->cpu, m->rom.functionAddresses[1]);
		m->cpu.setGlobalByKey(*m->cpu.stringPool().find("target"), valueInteger(m->rom.functionAddresses[1])); m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * 400);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, word);
	requireParity(native, scalar);
	const auto& block = page.nativeBlocks->entries[word];
	require(block && block->terminal.exit == NativeBlockExit::CreateClosure && block->terminal.operands.closure.result == source
		&& block->terminal.operands.closure.address == static_cast<u32>(source), "the generated body retains the aliasing WIDE register operand");
#endif
	for (u32 address : {DYNAMIC_RAM_BASE, native.rom.functionAddresses[1], DYNAMIC_RAM_BASE, DYNAMIC_RAM_BASE, native.rom.functionAddresses[1]}) {
		for (auto* m : {&native, &scalar}) {
			m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], m->rom.textAddress);
			m->cpu.setGlobalByKey(*m->cpu.stringPool().find("target"), valueInteger(address));
		}
		require(native.cpu.runUntilDepth(0, 4) == scalar.cpu.runUntilDepth(0, 4), "both live operand paths consume the same grant"); requireParity(native, scalar);
		require(native.cpu.readClosureBinding(asClosure(native.cpu.readFrameRegister(0, source), native.cpu.gcHeap())).functionAddress == address, "the full source address is sampled before its slot is replaced");
	}
}

void concatAllocationFault(bool range, int bytes) {
	test::Blua32TestImage image; image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::K1), 8, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(range ? OpCode::CONCATN : OpCode::CONCAT), 0, 1, 2);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255); writeInstruction(image.text, 32, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 16}, {.firstWord = 32, .wordCount = 1}}; image.exceptionFunctionIndex = 1;
	image.constants = {std::string("12")}; // Loop warmup does not grow the RAM intern index.
	CpuMachine native(image), scalar(image, true);
	for (auto* m : {&native, &scalar}) {
		auto& frame = *m->cpu.activeThread()->frameAtDepth(0); frame.registers.set(1, valueInteger(1)); frame.registers.set(2, valueInteger(2));
		m->cpu.runUntilDepth(0, NATIVE_WARM_SCALE * (range ? 396 : 320));
		m->cpu.luaHeap().setCollectionTarget(m->cpu.luaHeap().capacity());
		const StringId id = m->cpu.stringPool().intern(std::string(bytes, 'x'));
		frame.registers.set(1, valueString(id)); frame.registers.set(2, valueString(id)); frame.registers.set(0, valueInteger(73)); frame.writeControl(bmsx::FrameField::Top, 0);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto& page = *native.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	const u32 word = (native.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	test::waitForNativeEntry(native.cpu, page, word);
	requireParity(native, scalar);
	const auto& block = page.nativeBlocks->entries[word];
	require(block && block->terminal.exit == (range ? NativeBlockExit::ConcatRange : NativeBlockExit::Concat), "the allocation fault leaves generated code before throwing");
#endif
	const auto lastWorkAt = native.cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET + GC_LAST_EPOCH_WORK;
	const int beforeWork = native.memory.readRamRecordWord(lastWorkAt);
	require(native.cpu.runUntilDepth(0, range ? 5 : 4) == scalar.cpu.runUntilDepth(0, range ? 5 : 4), "failed allocations consume the same grant"); requireParity(native, scalar);
	if (2 * bytes < MAIN_RAM_SIZE) {
		require(native.cpu.instructionBudgetRemaining == -(range ? 2 : 0), "the issue grant did not assemble payload bytes");
		native.cpu.runUntilDepth(0, 2 * bytes); scalar.cpu.runUntilDepth(0, 2 * bytes); requireParity(native, scalar);
	}
	require(native.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_OUT_OF_MEMORY
		&& native.cpu.readEpcWord() == native.rom.textAddress + INSTRUCTION_BYTES, "allocation faults use the completed prefix PC");
	const int afterWork = native.memory.readRamRecordWord(lastWorkAt);
	const bool fitsArena = 2 * bytes + BLUA32_STRING_RECORD_HEADER_SIZE <= native.cpu.luaHeap().capacity();
	const int work = fitsArena ? afterWork : 0;
	require(fitsArena ? work > 0 : afterWork == beforeWork, "only a record that could fit attempts recovery");
	require(native.cpu.instructionBudgetRemaining == (2 * bytes < MAIN_RAM_SIZE ? 0 : -static_cast<int>(MAIN_RAM_SIZE) - (range ? 2 : 0)) - 3 * work,
		"oversized result saturates the byte debit; an ordinary allocation fault retains recovery work");
	require(native.cpu.readFrameRegister(0, 0) == valueInteger(73) && static_cast<bmsx::i32>(native.cpu.activeThread()->frameAtDepth(0)->readControl(bmsx::FrameField::Top)) == 9, "the failed allocation preserves its destination and published top");
}
void concatRangeAtMixedLengthBoundary(bool over) {
	test::Blua32TestImage image;
	image.text.resize(2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::CONCATN), 0, 1, 32);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 33}, {.firstWord = 1, .wordCount = 1}};
	image.exceptionFunctionIndex = 1;
	CpuMachine m(image);
	auto& frame = *m.cpu.rootThread()->currentFrame;
	// Four bytes remain: nil fits the String representation, false does not.
	const auto repeated = valueString(m.cpu.stringPool().intern(std::string(135300, 'x')));
	for (int i = 1; i <= 31; ++i) frame.registers.set(i, repeated);
	frame.registers.set(32, over ? valueBool(false) : valueNil());
	m.cpu.runUntilDepth(0, BASE_CYCLES[static_cast<u8>(OpCode::CONCATN)]);
	if (!over) { require(m.cpu.instructionBudgetRemaining == -32, "only the source count is charged at issue"); m.cpu.runUntilDepth(0, MAIN_RAM_SIZE - 1); }
	require(m.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_OUT_OF_MEMORY
		&& m.cpu.instructionBudgetRemaining == (over ? -static_cast<int>(MAIN_RAM_SIZE) - 32 : 0)
		&& isNil(frame.registers.get(0)), "converted non-String bytes participate in the saturated size fault");
}
} // namespace

int main() {
	try {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		fixedReadContinuation();
#endif
		for (int destination : {0, 1, 2}) concatKindsAndAliases(destination);
		concatConstants(); for (int count : {0, 3, 513}) concatRange(count);
		concatAllocationRoots(); canonicalImmediateClosure(); closurePrototypeBusFault();
		closureAddressAlias(0); closureAddressAlias(513); for (bool over : {false, true}) concatRangeAtMixedLengthBoundary(over);
		for (int bytes : {3 << 19, (2 << 20) - 1, 2 << 20, (2 << 20) + 1}) for (bool range : {false, true}) concatAllocationFault(range, bytes);
		std::cout << "Compiled CPU heap tests passed\n"; return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
