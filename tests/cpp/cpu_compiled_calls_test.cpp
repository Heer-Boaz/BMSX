#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"
#include "support/cpu_execution_parity.h"

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
	CpuMachine(const test::Blua32TestImage& image, bool scalar)
		: rom(test::encodeBlua32TestRom(RomImageDomain::System, image))
		, memory(MemoryInit{rom.bytes, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes)
		, irq(memory), addresses(memory), cpu(memory, irq, addresses) {
		cpu.reset();
		if (scalar) cpu.setExecutionHook({[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
	}
};

void requireParity(CpuMachine& native, CpuMachine& scalar) {
	const auto& first = *native.cpu.activeThread(); const auto& second = *scalar.cpu.activeThread();
	require(first.frameDepth == second.frameDepth && first.stackTop == second.stackTop
		&& native.cpu.readCurrentInstructionPc() == scalar.cpu.readCurrentInstructionPc()
		&& native.cpu.lastPc == scalar.cpu.lastPc && native.cpu.readLastExecutionDomain() == scalar.cpu.readLastExecutionDomain()
		&& native.cpu.readCauseWord() == scalar.cpu.readCauseWord() && native.cpu.readEpcWord() == scalar.cpu.readEpcWord()
		&& native.cpu.readBadAddressWord() == scalar.cpu.readBadAddressWord(),
		"compiled calls and returns preserve exact frame, PC, execution-domain and cycle boundaries");
	const CallFrame* firstFrame = first.firstFrame; const CallFrame* secondFrame = second.firstFrame;
	for (size_t index = 0; index < first.frameDepth; ++index, firstFrame = firstFrame->next, secondFrame = secondFrame->next) {
		const auto& a = *firstFrame; const auto& b = *secondFrame;
		require(a.pc == b.pc && a.top == b.top && a.functionAddress == b.functionAddress && a.stackCapacity == b.stackCapacity
			&& a.stackBase == b.stackBase && a.varargBase == b.varargBase && a.varargCount == b.varargCount
			&& a.returnBase == b.returnBase && a.returnCount == b.returnCount && a.callSitePc == b.callSitePc,
			"both executions retain the same caller, callee and result ranges after stack growth");
		for (int reg = 0; reg < a.stackCapacity; ++reg) {
			const Value left = a.registers[reg], right = b.registers[reg];
			if (valueIsClosure(left)) require(valueIsClosure(right) && asClosure(left)->functionAddress == asClosure(right)->functionAddress,
				"corresponding closures retain the same raw function address");
			else require(left == right, "every retained numeric/tagged register agrees across call transitions");
		}
	}
}

void reusableFrameChain() {
	Thread thread;
	auto* root = thread.acquireFrame();
	require(thread.currentFrame == nullptr && thread.frameDepth == 0, "preparing a node does not expose an active frame");
	thread.enterFrame(root);
	root->isExceptionFrame = true;
	for (int depth = 1; depth <= 8; ++depth) {
		auto* previous = thread.currentFrame;
		auto* frame = thread.acquireFrame();
		require(frame->previous == previous && previous->next == frame && frame->thread == &thread,
			"reusable nodes have stable identity and belong to their thread");
		thread.enterFrame(frame);
		require(thread.frameAtDepth(depth) == frame, "diagnostic depth follows the active chain");
	}
	while (thread.frameDepth > 1) thread.leaveFrame();
	auto* prepared = thread.acquireFrame();
	thread.trimFrames();
	require(thread.currentFrame == root && thread.frameDepth == 1 && thread.acquireFrame() == prepared,
		"collection retains the first prepared spare without activating it");
	size_t retained = 0;
	CallFrame* previous = nullptr;
	for (auto* frame = thread.firstFrame; frame; frame = frame->next) {
		require(frame->previous == previous, "tail reclamation repairs backward links");
		previous = frame;
		++retained;
	}
	require(retained == 5, "collection halves the inactive tail while preserving the active root");
	thread.enterFrame(prepared);
	prepared->protectedContinuationIndex = 3;
	thread.leaveFrame();
	require(prepared->protectedContinuationIndex == -1, "a new activation does not inherit a protected return");
	thread.leaveFrame();
	require(thread.currentFrame == nullptr && thread.frameDepth == 0 && !root->isExceptionFrame,
		"retirement clears exception state without deleting reusable frames");
	thread.trimFrames();
	require(thread.acquireFrame() == root, "an empty thread retains its first prepared node through collection");
}

void protectedNestedFrames() {
	test::Blua32TestImage image;
	image.text.resize(11 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETSYS), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 1, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 2, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::CALL), 0, 1, 1);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, 9, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 10, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8},
		{.firstWord = 5, .wordCount = 4, .maxStack = 8}, {.firstWord = 9, .wordCount = 2, .maxStack = 8}};
	image.constants = {7.0};
	image.systemGlobalNames = {"pcall"};
	image.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)},
		{6, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};
	for (const bool scalar : {false, true}) {
		CpuMachine machine(image, scalar);
		machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("pcall"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::PCall));
		for (int grant = 0; grant < 20 && machine.cpu.getFrameDepth() != 3; ++grant) machine.cpu.runUntilDepth(0, 1);
		require(machine.cpu.getFrameDepth() == 3, "protected body invokes an ordinary child activation");
		auto* thread = machine.cpu.activeThread();
		require(thread->protectedCallDepth == 1 && thread->currentFrame->protectedContinuationIndex == -1
			&& thread->currentFrame->previous->protectedContinuationIndex == 0, "only the protected target owns its return obligation");
		const auto state = machine.cpu.captureRuntimeState();
		require(state.threads[0].protectedCalls[0].targetFrameIndex == 1, "snapshot preserves the existing target-depth representation");
		machine.cpu.restoreRuntimeState(state);
		thread = machine.cpu.activeThread();
		require(thread->currentFrame->protectedContinuationIndex == -1
			&& thread->currentFrame->previous->protectedContinuationIndex == 0, "restore installs protection on the target rather than its subtree");
		require(machine.cpu.runUntilDepth(2, 100) == RunResult::Halted && thread->protectedCallDepth == 1,
			"ordinary child return must not finish protection");
		require(machine.cpu.runUntilDepth(0, 100) == RunResult::Halted && thread->protectedCallDepth == 0,
			"only the protected target completes its continuation");
		const auto values = machine.cpu.readCompletionValues();
		require(values.size() == 2 && values[0] == valueBool(true) && values[1] == valueNumber(7), "protected result prefix remains exact");
		require(thread->firstFrame->next->protectedContinuationIndex == -1, "retired target forgets its protected obligation");
	}
}

void returnGrowthCollection() {
	test::Blua32TestImage image;
	image.text.resize(6 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 0, 1, 63);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 8},
		{.firstWord = 4, .wordCount = 1, .maxStack = 8}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	for (const bool scalar : {false, true}) {
		CpuMachine machine(image, scalar);
		while (machine.cpu.activeThread()->frameDepth != 2) machine.cpu.runUntilDepth(0, 1);
		auto* caller = machine.cpu.activeThread()->firstFrame;
		auto* callee = machine.cpu.activeThread()->currentFrame;
		const Value result = valueString(machine.cpu.stringPool().intern("retained-only-by-returning-frame"));
		callee->registers[0] = result;
		const auto heap = machine.cpu.luaHeap().captureState();
		const std::string garbage(heap.nextCollectionBytes - heap.trackedBytes - 1, 'g');
		machine.cpu.stringPool().intern(garbage);
		require(machine.cpu.runUntilDepth(1, 100) == RunResult::Halted, "return stops at the caller depth after growing its window");
		require(!machine.cpu.stringPool().find(garbage), "return window growth actually triggers collection");
		require(machine.cpu.stringPool().find("retained-only-by-returning-frame") == asStringId(result)
			&& caller->registers[0] == result && caller->stackCapacity == 64 && caller->top == 63,
			"return values remain rooted across collection and caller/callee window relocation");
		for (int index = 1; index < 63; ++index) require(caller->registers[index] == valueNil(), "missing fixed returns are nil");
		require(machine.cpu.activeThread()->currentFrame == caller && caller->next == callee,
			"return retires the same callee only after result transfer completes");
	}
}

void failedCallAdmission() {
	test::Blua32TestImage image;
	image.text.resize(6 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 0, 1, 1);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 8},
		{.firstWord = 4, .wordCount = 1, .maxStack = PSX_MACHINE_SPEC.ramBytes},
		{.firstWord = 5, .wordCount = 1, .maxStack = 8}};
	image.exceptionFunctionIndex = 2;
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	for (const bool scalar : {false, true}) for (const bool completion : {false, true}) {
		CpuMachine machine(image, scalar);
		machine.cpu.runUntilDepth(0, 1);
		auto* thread = machine.cpu.activeThread();
		auto* caller = thread->currentFrame;
		if (completion) {
			bool rejected = false;
			try { machine.cpu.beginCompletionCall(*asClosure(caller->registers[0])); }
			catch (const LuaOutOfMemorySignal&) { rejected = true; }
			require(rejected && thread->frameDepth == 1 && thread->stackTop == 8,
				"failed completion admission never publishes an unallocated stack extent");
			require(caller->next->closure == nullptr && caller->next->executionImage == nullptr,
				"the unadmitted reusable node retains no callee references");
		} else {
			machine.cpu.runUntilDepth(0, 2);
			require(machine.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_OUT_OF_MEMORY
				&& thread->frameDepth == 2 && thread->stackTop == 16 && thread->currentFrame->stackBase == 8,
				"failed guest CALL enters its fault handler above the real caller, not a phantom callee window");
		}
		require(thread->firstFrame == caller && caller->stackBase == 0 && caller->stackCapacity == 8,
			"call admission preserves the caller's live register extent");
	}
}

void crossPageCalls(bool open, u32 recordOffset) {
	const u32 record = DYNAMIC_RAM_BASE + recordOffset;
	test::Blua32TestImage image; image.text.resize(2 * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 0, 4, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::LOADK), 1, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::LOADK), 2, 0, 1);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::CALL), 0, open ? 0 : 3, open ? 0 : 2);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::ADD), 3, 0, 1);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	for (const u32 start : {DECODED_PAGE_WORDS, DECODED_PAGE_WORDS + 32u}) {
		writeInstruction(image.text, start, static_cast<u8>(start == DECODED_PAGE_WORDS ? OpCode::ADD : OpCode::SUB), 2, 0, 1);
		writeInstruction(image.text, start + 1u, static_cast<u8>(OpCode::MOV), 3, start == DECODED_PAGE_WORDS ? 0 : 1, 0);
		writeInstruction(image.text, start + 2u, static_cast<u8>(OpCode::RET), 2, open ? 0 : 2, 0);
	}
	image.functions = {{.firstWord = 0, .wordCount = 8, .maxStack = 8},
		{.firstWord = DECODED_PAGE_WORDS, .wordCount = 3, .numParams = 2, .maxStack = 8},
		{.firstWord = DECODED_PAGE_WORDS + 32u, .wordCount = 3, .numParams = 2, .maxStack = 1024}};
	image.constants = {3.0, 4.0}; image.closureRelocations = {{1, record}};
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(record, machine->rom.bytes.data() + machine->rom.functionAddresses[1], BLUA32_FUNCTION_RECORD_SIZE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 20000);
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	bool call = false, ret = false;
	for (const auto& [key, page] : native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages) if (page.nativeBlocks) {
		for (const auto& block : page.nativeBlocks->entries) if (block) {
			call |= block->terminal.exit == NativeBlockExit::Call; ret |= block->terminal.exit == NativeBlockExit::Return;
		}
	}
	require(call && ret, "both callers and their cross-page callees execute generated blocks");
#endif
	for (int grant = 1; grant <= 128; ++grant) {
		test::runCpuParity(native.cpu, scalar.cpu, grant);
		requireParity(native, scalar);
	}
	for (auto* machine : {&native, &scalar}) {
		machine->cpu.runUntilDepth(1, 100);
		machine->cpu.activeThread()->frameAtDepth(0)->registers[3] = valueNumber(99);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 2u * INSTRUCTION_BYTES);
		require(machine->cpu.runUntilDepth(0, 5) == RunResult::Yielded && machine->cpu.activeThread()->frameDepth == 2,
			"CALL cannot consume a callee instruction without a further cycle grant");
		require(machine->cpu.runUntilDepth(1, 50) == RunResult::Halted && machine->cpu.instructionBudgetRemaining == 46
			&& machine->cpu.readFrameRegister(0, 3) == valueNumber(99),
			"a hot RET respects target depth before a hot caller continuation executes");
	}
	requireParity(native, scalar);
	for (auto* machine : {&native, &scalar}) {
		const auto capacity = machine->cpu.activeThread()->stack.size();
		const auto* caller = machine->cpu.activeThread()->currentFrame;
		const auto* spare = caller->next;
		require(spare != nullptr, "warm calls have a reusable callee node");
		machine->memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, 1024);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 2u * INSTRUCTION_BYTES);
		const auto heap = machine->cpu.luaHeap().captureState();
		const std::string garbage(heap.nextCollectionBytes - heap.trackedBytes - 1, 'g');
		machine->cpu.stringPool().intern(garbage);
		require(machine->cpu.runUntilDepth(0, 9) == RunResult::Yielded && machine->cpu.activeThread()->frameDepth == 1
			&& machine->cpu.activeThread()->stack.size() > capacity && machine->cpu.readFrameRegister(0, 0) == valueNumber(7),
			"a hot call relocates the stack before a hot callee and return use the new register bases");
		require(!machine->cpu.stringPool().find(garbage), "callee stack growth actually collects unrooted pressure data");
		require(machine->cpu.activeThread()->currentFrame == caller && caller->next == spare,
			"collection during call preparation preserves the inactive callee and active caller identities");
	}
	requireParity(native, scalar);
	for (auto* machine : {&native, &scalar}) {
		const u32 entry = machine->rom.textAddress + 2u * INSTRUCTION_BYTES;
		machine->memory.writeBytes(record, machine->rom.bytes.data() + machine->rom.functionAddresses[2], BLUA32_FUNCTION_RECORD_SIZE);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], entry);
		machine->cpu.runUntilDepth(0, 20000); machine->cpu.runUntilDepth(1, 100);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], entry);
		machine->cpu.runUntilDepth(0, 5); machine->cpu.runUntilDepth(1, 100);
		require(machine->cpu.readFrameRegister(0, 0) == valueNumber(-1), "a live closure re-reads its current RAM function record");
		machine->memory.writeMappedU32LE(record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, machine->rom.textAddress + DECODED_PAGE_WORDS * INSTRUCTION_BYTES + 1u);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], entry);
		require(machine->cpu.runUntilDepth(0, 5) == RunResult::Yielded && machine->cpu.readBadAddressWord() == 0u,
			"an exhausted call grant leaves a raw unaligned callee PC unfetched");
		machine->cpu.runUntilDepth(0, 1);
		require(machine->cpu.readBadAddressWord() == machine->rom.textAddress + DECODED_PAGE_WORDS * INSTRUCTION_BYTES + 1u,
			"a resumed unaligned PC takes the ordinary instruction address exception");
	}
	requireParity(native, scalar);
}
} // namespace

int main() {
	try {
		reusableFrameChain();
		protectedNestedFrames();
		returnGrowthCollection();
		failedCallAdmission();
		for (const bool open : {false, true}) for (const u32 offset : {0x1800u, 0x1ff0u}) crossPageCalls(open, offset);
		std::cout << "Compiled call/return tests passed\n"; return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
