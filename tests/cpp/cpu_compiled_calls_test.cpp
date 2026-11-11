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

void ownedValueStack() {
	Thread thread;
	require(thread.stackCapacity == 8, "a thread owns the initial eight Value slots");
	for (size_t index = 0; index < thread.stackCapacity; ++index)
		require(thread.stack[index] == valueNil(), "new stack slots contain the guest nil representation");
	const Value words[]{valueNumber(-0.0), valueBool(true), valueNil(), UINT64_C(0x7ff800000000002a)};
	std::copy(std::begin(words), std::end(words), thread.stack);
	thread.stack[7] = valueNumber(63);
	thread.stackTop = 4;
	thread.resizeStack(32);
	require(thread.stackCapacity == 32 && thread.stackTop == 4, "capacity growth does not activate any stack slots");
	for (size_t index = 0; index < std::size(words); ++index)
		require(thread.stack[index] == words[index], "stack relocation preserves raw Value bits");
	require(thread.stack[7] == valueNumber(63), "relocation preserves allocated argument storage beyond the active prefix");
	for (size_t index = 8; index < thread.stackCapacity; ++index)
		require(thread.stack[index] == valueNil(), "growth initializes only the added allocation");
	auto* storage = thread.stack;
	thread.resizeStack(32);
	require(thread.stack == storage, "unchanged capacity retains the existing allocation");
	thread.stackTop = 0;
	std::fill_n(thread.stack, thread.stackCapacity, valueNil());
	thread.resizeStack(8);
	for (size_t index = 0; index < thread.stackCapacity; ++index)
		require(thread.stack[index] == valueNil(), "a cleared root can restore a smaller empty backing");
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

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void nativeCallRouting(int params, int args, bool vararg, bool open, bool coldTarget, bool ramRecord, bool alias) {
	test::Blua32TestImage image;
	image.text.resize(3 * MAPPED_PAGE_BYTE_SIZE);
	const int base = alias ? 7 : 0;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 6, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), base, 6, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), base, open ? 0 : args + 1, 1);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::SETGL), 0, 0, 0);
	writeInstruction(image.text, 2 * DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = alias ? 8u : 16u},
		{.firstWord = DECODED_PAGE_WORDS, .wordCount = 1, .numParams = static_cast<u32>(params),
			.maxStack = params == 0 ? 0u : 8u, .isVararg = vararg}};
	image.globalNames = {"nativeCallMarker"};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	CpuMachine machine(image, false);
	const u32 markerPc = machine.rom.textAddress + 2 * MAPPED_PAGE_BYTE_SIZE;
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], markerPc);
	machine.cpu.runUntilDepth(0, 4096);
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
	machine.cpu.runUntilDepth(0, 12000);
	machine.cpu.runUntilDepth(1, 100);
	auto* thread = machine.cpu.activeThread();
	auto* caller = thread->currentFrame;
	auto* spare = caller->next;
	require(spare && thread->frameDepth == 1, "warm CALL owns a spare frame and adequate retained Value backing");
	const std::array<Value, 5> payloads{valueNumber(99), valueString(machine.cpu.stringPool().intern("native-call-payload")),
		VALUE_QNAN_MASK | 0x2au, valueBool(true), valueNumber(-0.0)};
	for (int index = 0; index < args; ++index) caller->registers[base + 1 + index] = payloads[index];
	if (alias) thread->stack[8] = valueNumber(63);
	caller->top = open ? base + 1 + args : caller->stackCapacity;
	const u32 calleePc = machine.rom.textAddress + MAPPED_PAGE_BYTE_SIZE;
	if (ramRecord) {
		// Neither a guest address nor the host backing needs function alignment for
		// an effect-free record span. Cross a decoded page with fresh record fields.
		const u32 record = DYNAMIC_RAM_BASE + 0x1ff1u;
		machine.memory.writeBytes(record, machine.rom.bytes.data() + machine.rom.functionAddresses[1], BLUA32_FUNCTION_RECORD_SIZE);
		asClosure(caller->registers[6])->functionAddress = record;
		machine.memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, 7);
	}
	const auto marker = machine.cpu.stringPool().intern("nativeCallMarker");
	machine.cpu.setGlobalByKey(marker, valueBool(false));
	const auto& lookup = *caller->executionImage->nativeCodeLookup;
	auto* calleePage = lookup.find(calleePc, 0);
	auto* alternate = lookup.find(markerPc, 0);
	const u32 word = (calleePc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const u32 markerWord = (markerPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	require(calleePage->nativeCode && calleePage->nativeCode[word] && alternate->nativeCode && alternate->nativeCode[markerWord],
		"callee and independent marker have live raw native entries");
	// A semantic CALL still selects the original RET descriptor. Only the shared
	// raw CALL gate can follow this independently redirected code word.
	calleePage->nativeBlocks->code[word] = coldTarget ? nullptr : alternate->nativeCode[markerWord];
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress + 2 * INSTRUCTION_BYTES);
	const int callerTop = caller->top;
	require(machine.cpu.runUntilDepth(0, 4) == RunResult::Yielded, "CALL and its first callee instruction retain grant accounting");
	if (coldTarget) {
		require(machine.cpu.getGlobalByKey(marker) == valueBool(false) && thread->currentFrame == caller,
			"missing raw target dispatches the original semantic call and return before any native activation writes");
		return;
	}
	const Value first = params > 0 && args > 0 && !alias ? payloads[0] : valueNil();
	require(machine.cpu.getGlobalByKey(marker) == first && thread->currentFrame == spare && thread->frameDepth == 2,
		"warm CALL tail-jumps through the raw native entry without the C++ CALL handler");
	require(caller->pc == machine.rom.textAddress + 4 * INSTRUCTION_BYTES && caller->top == callerTop
		&& spare->callSitePc == machine.rom.textAddress + 3 * INSTRUCTION_BYTES
		&& spare->returnBase == base && spare->returnCount == 1 && !spare->returnToCompletionLatch,
		"native CALL publishes exact caller continuation and callee result obligations");
	const int count = vararg ? std::max(args - params, 0) : 0;
	require(spare->varargBase == caller->stackCapacity && spare->varargCount == count
		&& spare->stackBase == spare->varargBase + count && spare->top == params
		&& spare->stackCapacity == (ramRecord ? 7 : params == 0 ? 1 : 8),
		"fresh record fields govern separate vararg and reserved register windows, including maxStack zero");
	for (int index = 0; index < params; ++index) require(spare->registers[index] == (index < args && !alias ? payloads[index] : valueNil()),
		"fixed arguments retain raw Value bits and missing or overlapping cleared arguments are nil");
	for (int index = params; index < spare->stackCapacity; ++index) require(spare->registers[index] == valueNil(), "new reserved locals are nil");
	for (int index = 0; index < count; ++index) require(thread->stack[spare->varargBase + index] == payloads[params + index],
		"varargs retain their own raw Value window rather than borrowing caller storage");
}

void nativeReturnRouting(int produced, int wanted, int base, bool coldTarget, bool exceptionFrame) {
	// The protected target repeatedly calls an ordinary child. A separate live
	// translation writes a marker without changing top or any frame register.
	test::Blua32TestImage image;
	image.text.resize(3 * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETSYS), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 1, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 2, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 17, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(image.text, 18, static_cast<u8>(OpCode::MOV), 0, 4, 0);
	writeInstruction(image.text, 19, static_cast<u8>(OpCode::CALL), 0, 1, 0);
	writeInstruction(image.text, 20, static_cast<u8>(OpCode::JMP), 0, 0, 0);
	writeInstruction(image.text, 21, static_cast<u8>(OpCode::RET), 0, 0, 0);
	writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::RET), 1, 0, 0);
	writeInstruction(image.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::SETGL), 7, 0, 0);
	writeInstruction(image.text, 2 * DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8},
		{.firstWord = 16, .wordCount = 6, .maxStack = 8},
		{.firstWord = DECODED_PAGE_WORDS, .wordCount = 1, .maxStack = 8}};
	image.systemGlobalNames = {"pcall"}; image.globalNames = {"nativeReturnMarker"};
	image.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)},
		{17, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};
	CpuMachine machine(image, false);
	machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("pcall"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::PCall));
	const u32 markerPc = machine.rom.textAddress + 2 * MAPPED_PAGE_BYTE_SIZE;
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], markerPc);
	machine.cpu.runUntilDepth(0, 4096);
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
	machine.cpu.runUntilDepth(0, 4096);
	while (machine.cpu.getFrameDepth() != 3) machine.cpu.runUntilDepth(0, 1);
	auto* thread = machine.cpu.activeThread();
	auto* callee = thread->currentFrame;
	auto* caller = callee->previous;
	require(thread->protectedCallDepth == 1 && caller->protectedContinuationIndex == 0
		&& callee->protectedContinuationIndex == -1, "native return admission concerns the target activation, not its protected subtree");
	const std::array<Value, 6> payloads{valueNil(), valueBool(false), valueNumber(-0.0),
		valueString(machine.cpu.stringPool().intern("native-return-payload")), caller->registers[4], VALUE_QNAN_MASK | 0x2au};
	for (int index = 0; index < produced; ++index) callee->registers[1 + index] = payloads[index];
	callee->top = 1 + produced;
	callee->returnBase = base; callee->returnCount = wanted;
	callee->isExceptionFrame = exceptionFrame; callee->isNonMaskableExceptionFrame = exceptionFrame;
	caller->registers[6] = valueNumber(-7);
	caller->registers[7] = valueNumber(99);
	const auto marker = machine.cpu.stringPool().intern("nativeReturnMarker");
	machine.cpu.setGlobalByKey(marker, valueNil());
	const auto& lookup = *caller->executionImage->nativeCodeLookup;
	auto* continuation = lookup.find(caller->pc, 0);
	auto* alternate = lookup.find(markerPc, 0);
	const u32 word = (caller->pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const u32 markerWord = (markerPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	require(continuation->nativeCode && continuation->nativeCode[word] && alternate->nativeCode && alternate->nativeCode[markerWord],
		"both ordinary continuation and independent marker have live native dispatch entries");
	// Redirect only the raw code word, not the descriptor. A C++ RET dispatcher
	// still selects the ordinary descriptor and cannot execute this marker.
	// This disposable fixture never resumes or reuses the redirected cache.
	continuation->nativeBlocks->code[word] = coldTarget ? nullptr : alternate->nativeCode[markerWord];
	const int copied = wanted == 0 ? produced : std::min(produced, wanted);
	const int count = wanted == 0 ? produced : wanted;
	const bool grows = count != 0 && base + count > caller->stackCapacity;
	require(machine.cpu.runUntilDepth(0, 3) == RunResult::Yielded && thread->currentFrame == caller
		&& thread->frameDepth == 2 && thread->protectedCallDepth == 1, "ordinary native return retains its protected parent and exact grant boundary");
	require(caller->top == base + count, "fixed, open and empty returns assign exact caller top even after a late cold exit");
	for (int index = 0; index < copied; ++index) require(caller->registers[base + index] == payloads[index],
		"native and late-cold result movement preserve every raw tagged and numeric bit");
	for (int index = copied; index < count; ++index) require(caller->registers[base + index] == valueNil(), "fixed results nil-pad only the requested suffix");
	if (base + count <= 6 || count == 0) require(caller->registers[6] == valueNumber(-7) && caller->registers[7] == valueNumber(99),
		"return does not overwrite retained caller registers outside its result range");
	require(machine.cpu.getGlobalByKey(marker) == ((!coldTarget && !grows) ? valueNumber(99) : valueNil()),
		"warm RET branches through the raw native code word without executeReturn or the C++ descriptor dispatcher");
	require(callee->registers == nullptr && callee->executionImage == nullptr && callee->closure == nullptr
		&& callee->protectedContinuationIndex == -1 && !callee->isExceptionFrame && !callee->isNonMaskableExceptionFrame,
		"native retirement clears the same inactive owner fields as an ordinary return, including unusual exception flags");
}
#endif

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
		const auto capacity = machine->cpu.activeThread()->stackCapacity;
		const auto* caller = machine->cpu.activeThread()->currentFrame;
		const auto* spare = caller->next;
		require(spare != nullptr, "warm calls have a reusable callee node");
		machine->memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, 1024);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 2u * INSTRUCTION_BYTES);
		const auto heap = machine->cpu.luaHeap().captureState();
		const std::string garbage(heap.nextCollectionBytes - heap.trackedBytes - 1, 'g');
		machine->cpu.stringPool().intern(garbage);
		require(machine->cpu.runUntilDepth(0, 9) == RunResult::Yielded && machine->cpu.activeThread()->frameDepth == 1
			&& machine->cpu.activeThread()->stackCapacity > capacity && machine->cpu.readFrameRegister(0, 0) == valueNumber(7),
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
		ownedValueStack();
		reusableFrameChain();
		protectedNestedFrames();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		nativeCallRouting(3, 5, true, true, false, false, false);
		nativeCallRouting(4, 1, false, false, false, false, false);
		nativeCallRouting(0, 0, false, true, false, false, false);
		nativeCallRouting(3, 5, true, false, false, true, false);
		nativeCallRouting(3, 2, false, true, true, false, false);
		nativeCallRouting(1, 1, false, false, false, false, true);
		nativeReturnRouting(6, 0, 0, false, true);
		nativeReturnRouting(2, 4, 0, false, false);
		nativeReturnRouting(6, 2, 0, false, false);
		nativeReturnRouting(0, 0, 10, false, false);
		nativeReturnRouting(6, 0, 0, true, false);
		nativeReturnRouting(6, 0, 6, false, false);
#endif
		returnGrowthCollection();
		failedCallAdmission();
		for (const bool open : {false, true}) for (const u32 offset : {0x1800u, 0x1ff0u}) crossPageCalls(open, offset);
		std::cout << "Compiled call/return tests passed\n"; return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
