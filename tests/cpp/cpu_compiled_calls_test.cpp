#include "common/endian.h"
#include "machine/cpu/cpu.h"
#include "machine/common/numeric.h"
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
		require(a.readControl(bmsx::FrameField::Pc) == b.readControl(bmsx::FrameField::Pc) && static_cast<bmsx::i32>(a.readControl(bmsx::FrameField::Top)) == static_cast<bmsx::i32>(b.readControl(bmsx::FrameField::Top)) && a.readControl(FrameField::Function) == b.readControl(FrameField::Function) && a.stackCapacity() == b.stackCapacity()
			&& a.stackBase() == b.stackBase() && static_cast<bmsx::i32>(a.readControl(bmsx::FrameField::VarargBase)) == static_cast<bmsx::i32>(b.readControl(bmsx::FrameField::VarargBase)) && static_cast<bmsx::i32>(a.readControl(bmsx::FrameField::VarargCount)) == static_cast<bmsx::i32>(b.readControl(bmsx::FrameField::VarargCount))
			&& static_cast<bmsx::i32>(a.readControl(bmsx::FrameField::ReturnBase)) == static_cast<bmsx::i32>(b.readControl(bmsx::FrameField::ReturnBase)) && static_cast<bmsx::i32>(a.readControl(bmsx::FrameField::ReturnCount)) == static_cast<bmsx::i32>(b.readControl(bmsx::FrameField::ReturnCount)) && a.readControl(FrameField::CallSite) == b.readControl(FrameField::CallSite),
			"both executions retain the same caller, callee and result ranges after stack growth");
		for (int reg = 0; reg < a.stackCapacity(); ++reg) {
			const Value left = a.registers.get(reg), right = b.registers.get(reg);
			if (valueIsClosure(left)) require(valueIsClosure(right) && asClosure(left, native.cpu.gcHeap())->prototype->functionAddress == asClosure(right, scalar.cpu.gcHeap())->prototype->functionAddress,
				"corresponding closures retain the same raw function address");
			else require(left == right, "every retained numeric/tagged register agrees across call transitions");
		}
	}
}

void ownedValueStack() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	auto& thread = *cpu.rootThread();
	require(thread.stackCapacity == 8, "a thread owns the initial eight Value slots");
	for (size_t index = 0; index < thread.stackCapacity; ++index)
		require(thread.stack.get(index) == valueNil(), "new stack slots contain the guest nil representation");
	const Value words[]{valueFloatBits(0x80000000), valueBool(true), valueNil(), valueFloatBits(0x7fc0002a)};
	for (size_t i = 0; i < std::size(words); ++i) thread.stack.set(i, words[i]);
	thread.stack.set(7, valueInteger(63));
	thread.stackTop = 4;
	thread.resizeStack(32);
	require(thread.stackCapacity == 32 && thread.stackTop == 4, "capacity growth does not activate any stack slots");
	for (size_t index = 0; index < std::size(words); ++index)
		require(thread.stack.get(index) == words[index], "stack relocation preserves raw Value bits");
	require(thread.stack.get(7) == valueInteger(63), "relocation preserves allocated argument storage beyond the active prefix");
	for (size_t index = 8; index < thread.stackCapacity; ++index)
		require(thread.stack.get(index) == valueNil(), "growth initializes only the added allocation");
	auto storage = thread.stack;
	thread.resizeStack(32);
	require(thread.stack.words() == storage.words() && thread.stack.tags() == storage.tags(), "unchanged capacity retains the existing allocation");
	thread.stackTop = 0;
	thread.stack.clear(0, thread.stackCapacity);
	thread.resizeStack(8);
	for (size_t index = 0; index < thread.stackCapacity; ++index)
		require(thread.stack.get(index) == valueNil(), "a cleared root can restore a smaller empty backing");
}

void reusableFrameChain() {
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	IrqController irq(memory);
	ExecutionAddressSpace addresses(memory);
	CPU cpu(memory, irq, addresses);
	auto& thread = *cpu.rootThread();
	auto* root = thread.acquireFrame();
	require(thread.currentFrame == nullptr && thread.frameDepth == 0, "preparing a node does not expose an active frame");
	thread.enterFrame(root);
	root->addControlFlags(FRAME_EXCEPTION);
	for (int depth = 1; depth <= 8; ++depth) {
		auto* previous = thread.currentFrame;
		auto* frame = thread.acquireFrame();
		thread.reserveFrame(thread.stackCapacity);
		frame->initializeControl(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
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
		require(frame->controlOffset == root->controlOffset + retained * FRAME_CONTROL_BYTES,
			"surviving inactive views are rebound to their new physical depth");
		previous = frame;
		++retained;
	}
	require(retained == 5, "collection halves the inactive tail while preserving the active root");
	thread.enterFrame(prepared);
	prepared->writeControl(FrameField::Protected, 3);
	thread.leaveFrame();
	require(thread.currentFrame == root && thread.frameDepth == 1, "the retired protected slot is not active");
	thread.leaveFrame();
	require(thread.currentFrame == nullptr && thread.frameDepth == 0, "retirement leaves an empty activation chain");
	thread.trimFrames();
	require(thread.acquireFrame() == root, "an empty thread retains its first prepared node through collection");
}

void inactiveFrameMetadata() {
	test::Blua32TestImage image;
	image.text.resize(2 * MAPPED_PAGE_BYTE_SIZE + 2 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CLOSURE), 1, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
	writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::NEWT), 0, 0, 0);
	writeInstruction(image.text, DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::RET), 0, 1, 0);
	writeInstruction(image.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::KSMI), 0, 0, 27);
	writeInstruction(image.text, 2 * DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord=0, .wordCount=5, .maxStack=8},
		{.firstWord=DECODED_PAGE_WORDS, .wordCount=2, .maxStack=8, .staticClosure=false},
		{.firstWord=2 * DECODED_PAGE_WORDS, .wordCount=2, .maxStack=128, .staticClosure=false}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)},
		{3, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};
	CpuMachine generated(image, false), scalar(image, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	generated.cpu.prepareSystemNativeCode();
#endif
	test::runCpuParity(generated.cpu, scalar.cpu, 2 * BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)]);
	for (auto* machine : {&generated, &scalar}) {
		auto& cpu = machine->cpu;
		auto* root = cpu.activeThread()->currentFrame;
		cpu.beginCompletionCall(*asClosure(root->registers.get(0), cpu.gcHeap()));
	}
	test::runCpuParity(generated.cpu, scalar.cpu, 1, 1);
	auto* spare = generated.cpu.activeThread()->currentFrame;
	auto oldRegisters = spare->registers;
	const u32 oldClosure = spare->readControl(bmsx::FrameField::Closure);
	auto* oldImage = spare->executionImage;
	const u32 oldPageAddress = spare->decodedPageAddress;
	require(oldPageAddress != 0, "the reused node carries a real nonzero prior decode-page address");
	test::runCpuParity(generated.cpu, scalar.cpu, 1, 1);
	for (auto* machine : {&generated, &scalar}) machine->cpu.activeThread()->currentFrame->registers.set(0, valueNil());
	// Populate the inactive node with its genuine previous activation bits even
	// when the retirement implementation clears them. Neither collection nor
	// capture may follow these non-roots; the next activation overwrites them.
	spare->executionImage = oldImage;
	spare->writeControl(bmsx::FrameField::Closure, oldClosure);
	spare->registers = oldRegisters;
	spare->decodedPageAddress = oldPageAddress;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	auto* page = oldImage->nativeCodeLookup->find(generated.rom.textAddress, 0);
	const u32 word = (generated.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	require(page && page->nativeCode && page->nativeCode[word], "inactive hints can name a real published entry cell");
	spare->nativeContinuationCells = {&page->nativeCode[word], &page->nativeCode[word]};
#endif
	const auto before = generated.cpu.captureRuntimeState(), reference = scalar.cpu.captureRuntimeState();
	require(std::ranges::equal(before.snapshot.words(), reference.snapshot.words())
		&& std::ranges::equal(before.snapshot.objectWords(), reference.snapshot.objectWords()),
		"inactive activation bits are not part of the checkpoint value graph");
	generated.cpu.collectHeap(); scalar.cpu.collectHeap();
	require(generated.cpu.luaHeap().usedBytes() == scalar.cpu.luaHeap().usedBytes(),
		"inactive closure and register pointers do not retain their retired table or closure");
	for (auto* machine : {&generated, &scalar}) {
		auto& cpu = machine->cpu;
		auto* thread = cpu.activeThread();
		auto* reused = thread->currentFrame->next;
		auto* closure = asClosure(thread->currentFrame->registers.get(1), cpu.gcHeap());
		const auto capacity = thread->stackCapacity;
		cpu.beginCompletionCall(*closure);
		require(thread->currentFrame == reused && thread->stackCapacity > capacity
			&& reused->attachedClosure() == closure && reused->registers.words() == thread->stack.words() + reused->stackBase()
			&& reused->registers.tags() == thread->stack.tags() + reused->stackBase()
			&& reused->executionImage == reused->previous->executionImage,
			"a real activation reuses the node and rebinds all pointers after Value-stack growth");
		require(reused->decodedPage == nullptr && reused->compilationEntry
			&& reused->readControl(FrameField::Protected) == static_cast<u32>(-1) && !reused->hasControlFlag(FRAME_EXCEPTION) && !reused->hasControlFlag(FRAME_NMI),
			"reuse retains the required decode, protected-return and exception admission state");
		cpu.restoreRuntimeState(cpu.captureRuntimeState());
	}
	test::runCpuParity(generated.cpu, scalar.cpu, BASE_CYCLES[static_cast<u8>(OpCode::KSMI)] + BASE_CYCLES[static_cast<u8>(OpCode::RET)] + 1, 1);
	requireParity(generated, scalar);
	for (auto* machine : {&generated, &scalar}) {
		const auto values = machine->cpu.readCompletionValues();
		require(values.size() == 1 && values.get(0) == valueInteger(27), "restored reused activations return their own result once");
	}
}

void protectedNestedFrames() {
	test::Blua32TestImage image;
	image.text.resize(11 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETSYS), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 1, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 2, 3);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 3, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::CALL), 0, 1, 2);
	writeInstruction(image.text, 8, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, 9, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 10, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8},
		{.firstWord = 5, .wordCount = 4, .maxStack = 8}, {.firstWord = 9, .wordCount = 2, .maxStack = 8}};
	image.constants = {7};
	image.systemGlobalNames = {"pcall"};
	image.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)},
		{6, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};
	for (const bool scalar : {false, true}) {
		CpuMachine machine(image, scalar);
		machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("pcall"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::PCall));
		for (int grant = 0; grant < 20 && machine.cpu.getFrameDepth() != 3; ++grant) machine.cpu.runUntilDepth(0, 1);
		require(machine.cpu.getFrameDepth() == 3, "protected body invokes an ordinary child activation");
		auto* thread = machine.cpu.activeThread();
		require(thread->protectedDepth() == 1 && thread->currentFrame->readControl(FrameField::Protected) == static_cast<u32>(-1)
			&& thread->currentFrame->previous->readControl(FrameField::Protected) == 0, "only the protected target owns its return obligation");
		const auto state = machine.cpu.captureRuntimeState();
		const auto ram = machine.cpu.memory().captureSaveState();
		const auto originalStack = thread->stackOffset();
		thread->resizeStack(80);
		require(thread->stackOffset() != originalStack && thread->protectedWord(0, ProtectedField::Wanted) == 3
			&& thread->protectedWord(0, ProtectedField::Caller) == 0,
			"a live protected call relocates with its stack");
		machine.cpu.memory().restoreSaveState(ram);
		require(thread->frameAtDepth(1)->readControl(FrameField::Protected) == 0, "the target frame stores a continuation index");
		machine.cpu.restoreRuntimeState(state);
		thread = machine.cpu.activeThread();
		require(thread->currentFrame->readControl(FrameField::Protected) == static_cast<u32>(-1)
			&& thread->currentFrame->previous->readControl(FrameField::Protected) == 0, "restore installs protection on the target rather than its subtree");
		require(machine.cpu.runUntilDepth(2, 100) == RunResult::Halted && thread->protectedDepth() == 1,
			"ordinary child return must not finish protection");
		require(machine.cpu.runUntilDepth(0, 100) == RunResult::Halted && thread->protectedDepth() == 0,
			"only the protected target completes its continuation");
		const auto values = machine.cpu.readCompletionValues();
		require(values.size() == 2 && values.get(0) == valueBool(true) && values.get(1) == valueInteger(7), "protected result prefix remains exact");
		require(thread->protectedDepth() == 0, "the retired target leaves no pending obligation");
	}
}

void valueRangePlacementCycles() {
	for (const bool scalar : {true, false}) for (const auto op : {OpCode::LOADNIL, OpCode::VARARG})
	for (const int operand : {0, 1, 3, 129}) {
		test::Blua32TestImage image;
		image.text.resize(5 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
		writeInstruction(image.text, 3, static_cast<u8>(op), 2, operand, 0, (operand >> 6) << 3);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 1, 0);
		image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8},
			{.firstWord = 3, .wordCount = 2, .maxStack = 160, .isVararg = true}};
		image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		CpuMachine machine(image, scalar);
		machine.cpu.runUntilDepth(0, 1);
		auto* closure = asClosure(machine.cpu.readFrameRegister(0, 0), machine.cpu.gcHeap());
		const std::array args{valueInteger(17), valueInteger(29), valueInteger(31)};
		const int placed = op == OpCode::LOADNIL ? operand : operand == 0 ? 3 : operand - 1;
		for (int call = 0; call < 20; ++call) {
			machine.cpu.beginCompletionCall(*closure, BuiltinArgsView(args.data(), args.size()));
			const int base = machine.cpu.activeThread()->currentFrame->stackBase();
			require(machine.cpu.runUntilDepth(1, 1000) == RunResult::Halted
				&& machine.cpu.instructionBudgetRemaining == 1000 - BASE_CYCLES[static_cast<u8>(op)] - BASE_CYCLES[static_cast<u8>(OpCode::RET)] - placed,
				"cold and warm LOADNIL/VARARG charge each written slot, not reserved capacity");
			for (int index = 0; index < placed; ++index)
				require(machine.cpu.activeThread()->stack.get(base + 2 + index) == (op == OpCode::VARARG && index < 3 ? args[index] : valueNil()),
					"charged ranges contain copied arguments or explicit nil padding");
		}
	}
}

void closureBindingAndClosingCycles() {
	test::Blua32TestImage image;
	image.text.resize(8 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::LOADK), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 2, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::CLOSURE), 3, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::RET), 2, 3, 0);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::GETUP), 0, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 8},
		{.firstWord = 6, .wordCount = 2, .maxStack = 2, .staticClosure = false, .upvalues = {{true, 0}, {true, 1}}}};
	image.constants = {17};
	image.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)},
		{4, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	for (const bool scalar : {true, false}) {
		CpuMachine machine(image, scalar);
		machine.cpu.runUntilDepth(0, 1);
		for (int call = 0; call < 2; ++call) require(machine.cpu.runUntilDepth(0, 1) == RunResult::Yielded
			&& machine.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::CLOSURE)] - 2, "every descriptor costs one even when an earlier closure already opened its cell");
		auto* first = asClosure(machine.cpu.readFrameRegister(0, 2), machine.cpu.gcHeap());
		auto* second = asClosure(machine.cpu.readFrameRegister(0, 3), machine.cpu.gcHeap());
		require(first->captureAddress(0) == second->captureAddress(0) && first->captureAddress(1) == second->captureAddress(1),
			"successive closures share both captured cells");
		require(machine.cpu.runUntilDepth(0, 1) == RunResult::Halted && machine.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::RET)] - 2 - 2,
			"RET charges two distinct open cells, not four descriptors, and two received values");
		require(!static_cast<Upvalue*>(machine.cpu.gcHeap().cellAt(first->captureAddress(0)))->isOpen() && !static_cast<Upvalue*>(machine.cpu.gcHeap().cellAt(first->captureAddress(1)))->isOpen(), "both charged captures are closed");
	}
}

void protectedBuiltinPlacementCycles() {
	for (const bool scalar : {true, false}) for (const int wanted : {0, 1, 5}) {
		test::Blua32TestImage image;
		image.text.resize(5 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETSYS), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETSYS), 1, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::GETSYS), 2, 0, 1);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 3, wanted);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
		image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8}};
		image.systemGlobalNames = {"pcall", "isyieldable"};
		CpuMachine machine(image, scalar);
		machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("pcall"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::PCall));
		machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("isyieldable"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::CoroutineIsYieldable));
		machine.cpu.runUntilDepth(0, 3 * BASE_CYCLES[static_cast<u8>(OpCode::GETSYS)]);
		require(machine.cpu.runUntilDepth(0, 1) == RunResult::Yielded
			&& machine.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::CALL)] - 4 - 4 - 4 - 2 - (wanted == 0 ? 3 : wanted - 1),
			"nested builtin protection pays each completed receiving range exactly once");
	}
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
void haltedReceivingFrame() {
	test::Blua32TestImage image;
	image.text.resize(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 0, 1, 2);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 4},
		{.firstWord = 4, .wordCount = 2, .numParams = 1}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	const int call = BASE_CYCLES[static_cast<u8>(OpCode::CALL)] + 1; // One missing formal.
	const int ret = BASE_CYCLES[static_cast<u8>(OpCode::RET)] + 1; // One result.
	for (bool scalar : {true, false}) for (bool returning : {false, true}) {
		CpuMachine machine(image, scalar);
		auto& cpu = machine.cpu;
		cpu.runUntilDepth(0, 1); // Bind the closure.
		if (returning) cpu.runUntilDepth(0, call + BASE_CYCLES[static_cast<u8>(OpCode::K1)]);
		auto state = cpu.captureRuntimeState();
		state.haltedUntilIrqThreadRef = state.activeThreadRef;
		state.haltedUntilIrqFrameDepth = returning ? 1 : 2;
		cpu.restoreRuntimeState(state);
		cpu.activeThread()->reserveFrame(cpu.activeThread()->stackCapacity);
		cpu.activeThread()->acquireFrame(); // The call gate can reuse an admitted node without allocating.
		if (!scalar) {
			cpu.prepareSystemNativeCode();
			const auto& lookup = *cpu.activeThread()->currentFrame->executionImage->nativeCodeLookup;
			for (int offset : {2, 3, 4}) {
				const u32 pc = machine.rom.textAddress + offset * INSTRUCTION_BYTES;
				const auto* page = lookup.find(pc, 0);
				require(page && page->nativeCode && page->nativeCode[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES],
					"both frame destinations and CALL must have published code");
			}
		}
		require(cpu.runUntilDepth(0, 100) == RunResult::Halted && cpu.isHaltedUntilIrq()
			&& cpu.instructionBudgetRemaining == 100 - (returning ? ret : call),
			"frame transition completes and charges placement before the matching HALT, without entering the receiver");
		const int depth = returning ? 0 : 1;
		require(cpu.getFrameDepth() == depth + 1
			&& cpu.readFramePc(depth) == machine.rom.textAddress + (returning ? 3 : 4) * INSTRUCTION_BYTES
			&& cpu.readFrameRegister(depth, 0) == (returning ? valueInteger(1) : valueNil()),
			"HALT retains the exact receiver PC and initialized result or formal");
		cpu.clearHaltUntilIrq();
		require(cpu.runUntilDepth(0, 100) == RunResult::Halted && cpu.getFrameDepth() == 0
			&& cpu.readCompletionValues().get(0) == valueInteger(1),
			"waking resumes the receiving instruction without replaying the frame transition");
	}
}

void nativeCallRouting(int params, int args, bool vararg, bool open, bool coldTarget, bool ramRecord, bool alias, int maxStack = 8, int grant = -1) {
	test::Blua32TestImage image;
	image.text.resize(3 * MAPPED_PAGE_BYTE_SIZE);
	const int base = alias ? 7 : 8;
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 6, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), base, 6, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), base, open ? 0 : args + 1, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::RET), 0, 2, 0);
	writeInstruction(image.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::SETGL), 0, 0, 0);
	writeInstruction(image.text, 2 * DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 16u},
		{.firstWord = DECODED_PAGE_WORDS, .wordCount = 1, .numParams = static_cast<u32>(params),
			.maxStack = params == 0 ? 0u : static_cast<u32>(maxStack), .isVararg = vararg}};
	image.globalNames = {"nativeCallMarker"};
	const u32 record = DYNAMIC_RAM_BASE + 0x1ff0u;
	image.closureRelocations = {{1, ramRecord ? record : test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	CpuMachine machine(image, false);
	if (ramRecord) {
		machine.memory.writeBytes(record, machine.rom.bytes.data() + machine.rom.functionAddresses[1], BLUA32_FUNCTION_RECORD_SIZE);
		machine.memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, 7);
	}
	const u32 markerPc = machine.rom.textAddress + 2 * MAPPED_PAGE_BYTE_SIZE;
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], markerPc);
	machine.cpu.runUntilDepth(0, 4096);
	test::waitForNativeEntry(machine.cpu, *machine.cpu.activeThread()->currentFrame->decodedPage,
		(markerPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
	machine.cpu.runUntilDepth(0, 12000);
	test::waitForNativeEntry(machine.cpu, *machine.cpu.activeThread()->frameAtDepth(0)->decodedPage,
		((machine.rom.textAddress + 2u * INSTRUCTION_BYTES) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	machine.cpu.runUntilDepth(0, 12000);
#endif
	const u32 calleePc = machine.rom.textAddress + MAPPED_PAGE_BYTE_SIZE;
	const auto& decodedCallee = machine.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages.at(calleePc & ~MAPPED_PAGE_BYTE_MASK);
	test::waitForNativeEntry(machine.cpu, decodedCallee, (calleePc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	machine.cpu.runUntilDepth(1, 100);
	auto* thread = machine.cpu.activeThread();
	auto* caller = thread->currentFrame;
	auto* spare = caller->next;
	require(spare && thread->frameDepth == 1, "warm CALL owns a spare frame and adequate retained Value backing");
	const int count = vararg ? std::max(args - params, 0) : 0;
	const int capacity = std::max({ramRecord ? 7 : params == 0 ? 0 : maxStack, params, 1});
	const int calleeBase = base + 1 + (vararg ? args : 0);
	const int initializedExtent = std::max(params, capacity);
	require(static_cast<size_t>(calleeBase + initializedExtent + (alias ? 0 : 1)) <= thread->stackCapacity,
		"raw formals and a following sentinel remain inside the retained allocation");
	for (int i = 0; i < (vararg ? args : 0) + initializedExtent; ++i) thread->stack.set(base + 1 + i, valueInteger(63));
	const std::array<Value, 5> payloads{valueInteger(99), valueString(machine.cpu.stringPool().intern("native-call-payload")),
		valueFloatBits(0xffa12345), valueBool(true), valueFloatBits(0x80000000)};
	for (int index = 0; index < args; ++index) caller->registers.set(base + 1 + index, payloads[index]);

	caller->writeControl(bmsx::FrameField::Top, open ? base + 1 + args : caller->stackCapacity());
	if (ramRecord) {
		// The cross-page record can change after closure creation without
		// changing the reserved frame or native call target.
		machine.memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, 1024);
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
	calleePage->nativeCode[word] = coldTarget ? nullptr : alternate->nativeCode[markerWord];
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress + 2 * INSTRUCTION_BYTES);
	const int callerTop = static_cast<bmsx::i32>(caller->readControl(bmsx::FrameField::Top));
	const int placed = vararg ? params : std::max(params - args, 0);
	const int callPrefix = BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)];
	if (grant < 0) grant = callPrefix + placed + 1;
	require(machine.cpu.runUntilDepth(0, grant) == RunResult::Yielded, "CALL placements and its first callee instruction retain grant accounting");
	if (grant <= BASE_CYCLES[static_cast<u8>(OpCode::MOV)]) {
		require(machine.cpu.instructionBudgetRemaining == grant - BASE_CYCLES[static_cast<u8>(OpCode::MOV)]
			&& thread->currentFrame == caller && caller->readControl(bmsx::FrameField::Pc) == machine.rom.textAddress + 3 * INSTRUCTION_BYTES
			&& caller->registers.get(base) == caller->registers.get(6)
			&& machine.cpu.getGlobalByKey(marker) == valueBool(false),
			"a grant exhausted by MOV stops before CALL and frame placement");
		return;
	}
	if (grant <= callPrefix + placed) {
		require(machine.cpu.instructionBudgetRemaining == grant - callPrefix - placed
			&& machine.cpu.getGlobalByKey(marker) == valueBool(false)
			&& thread->currentFrame == spare && spare->readControl(bmsx::FrameField::Pc) == calleePc,
			"an exhausting CALL completes placement once without entering its raw callee body");
		return;
	}
	if (coldTarget) {
		require(machine.cpu.getGlobalByKey(marker) == valueBool(false) && thread->currentFrame == caller,
			"missing raw target dispatches the original semantic call and return before any native activation writes");
		return;
	}
	const Value first = params > 0 ? (args > 0 ? payloads[0] : valueNil()) : valueInteger(63);
	require(machine.cpu.getGlobalByKey(marker) == first && thread->currentFrame == spare && thread->frameDepth == 2,
		"warm CALL tail-jumps through the raw native entry without the C++ CALL handler");
	require(caller->readControl(bmsx::FrameField::Pc) == machine.rom.textAddress + 4 * INSTRUCTION_BYTES && static_cast<bmsx::i32>(caller->readControl(bmsx::FrameField::Top)) == callerTop
		&& spare->readControl(FrameField::CallSite) == machine.rom.textAddress + 3 * INSTRUCTION_BYTES
		&& static_cast<bmsx::i32>(spare->readControl(bmsx::FrameField::ReturnBase)) == base && static_cast<bmsx::i32>(spare->readControl(bmsx::FrameField::ReturnCount)) == 2 && !spare->hasControlFlag(FRAME_COMPLETION),
		"native CALL publishes exact caller continuation and callee result obligations");
	require(static_cast<bmsx::i32>(spare->readControl(bmsx::FrameField::VarargBase)) == base + 1 + params && static_cast<bmsx::i32>(spare->readControl(bmsx::FrameField::VarargCount)) == count
		&& spare->stackBase() == calleeBase && static_cast<bmsx::i32>(spare->readControl(bmsx::FrameField::Top)) == params
		&& spare->stackCapacity() == capacity,
		"bound record fields govern shared argument and working windows, including formal parameters beyond maxStack");
	for (int index = 0; index < params; ++index) require(spare->registers.get(index) == (index < args ? payloads[index] : valueNil()),
		"fixed arguments retain raw Value bits and missing arguments are nil");
	for (int index = 0; index < count; ++index) require(thread->stack.get(static_cast<bmsx::i32>(spare->readControl(bmsx::FrameField::VarargBase)) + index) == payloads[params + index],
		"varargs retain their ordered original argument slots below the working frame");
}

void nativeReturnRouting(int produced, int wanted, int base, bool coldTarget, bool exceptionFrame, int grant = -1) {
	// The protected target repeatedly calls an ordinary child. A separate live
	// translation writes a marker without changing top or any frame register.
	test::Blua32TestImage image;
	image.text.resize(3 * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETSYS), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 1, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 2, 3);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
	writeInstruction(image.text, 16, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 17, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(image.text, 18, static_cast<u8>(OpCode::MOV), 8, 4, 0);
	writeInstruction(image.text, 19, static_cast<u8>(OpCode::CALL), 8, 1, 0);
	writeInstruction(image.text, 20, static_cast<u8>(OpCode::JMP), 0, 0, 0);
	writeInstruction(image.text, 21, static_cast<u8>(OpCode::RET), 0, 0, 0);
	writeInstruction(image.text, DECODED_PAGE_WORDS, static_cast<u8>(OpCode::RET), 1, 0, 0);
	writeInstruction(image.text, 2 * DECODED_PAGE_WORDS, static_cast<u8>(OpCode::SETGL), 7, 0, 0);
	writeInstruction(image.text, 2 * DECODED_PAGE_WORDS + 1, static_cast<u8>(OpCode::JMP), 0, 63, 62, 255);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 8},
		{.firstWord = 16, .wordCount = 6, .maxStack = 16},
		{.firstWord = DECODED_PAGE_WORDS, .wordCount = 1, .maxStack = 8}};
	image.systemGlobalNames = {"pcall"}; image.globalNames = {"nativeReturnMarker"};
	image.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)},
		{17, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};
	CpuMachine machine(image, false);
	// The raw RET proof requires the callee itself, not just its caller and
	// alternate continuation, to have a published generated body.
	machine.cpu.prepareSystemNativeCode();
	machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("pcall"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::PCall));
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	machine.cpu.setNativeCompilationProfiling(true);
#endif
	const u32 markerPc = machine.rom.textAddress + 2 * MAPPED_PAGE_BYTE_SIZE;
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], markerPc);
	machine.cpu.runUntilDepth(0, 4096);
	test::waitForNativeEntry(machine.cpu, *machine.cpu.activeThread()->currentFrame->decodedPage,
		(markerPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
	machine.cpu.runUntilDepth(0, 4096);
	auto& decoded = *machine.cpu.activeThread()->frameAtDepth(0)->decodedPage;
	test::waitForNativeEntry(machine.cpu, decoded, (machine.rom.textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	machine.cpu.runUntilDepth(0, 4096);
	test::waitForFixtureWorkerRequests(machine.cpu);
	const u32 continuationWord = ((machine.rom.textAddress + 20u * INSTRUCTION_BYTES) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	for (int pass = 0; pass < 4 && (!decoded.nativeBlocks || !decoded.nativeBlocks->entries[continuationWord]); ++pass) {
		machine.cpu.runUntilDepth(0, 4096);
		test::waitForFixtureWorkerRequests(machine.cpu);
	}
#endif
	test::waitForNativeEntry(machine.cpu, decoded, ((machine.rom.textAddress + 20u * INSTRUCTION_BYTES) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	while (machine.cpu.getFrameDepth() != 3) machine.cpu.runUntilDepth(0, 1);
	auto* thread = machine.cpu.activeThread();
	auto* callee = thread->currentFrame;
	auto* caller = callee->previous;
	auto* closure = callee->attachedClosure();
	require(thread->protectedDepth() == 1 && caller->readControl(FrameField::Protected) == 0
		&& callee->readControl(FrameField::Protected) == static_cast<u32>(-1), "native return admission concerns the target activation, not its protected subtree");
	const std::array<Value, 6> payloads{valueNil(), valueBool(false), valueFloatBits(0x80000000),
		valueString(machine.cpu.stringPool().intern("native-return-payload")), caller->registers.get(4), valueFloatBits(0xffa12345)};
	for (int index = 0; index < produced; ++index) callee->registers.set(1 + index, payloads[index]);
	const u32 control = RAM_BASE + callee->controlOffset;
	machine.memory.writeMappedU32LE(control + static_cast<u32>(FrameField::Top), 0xab000000u | static_cast<u32>(1 + produced));
	machine.memory.writeMappedU32LE(control + static_cast<u32>(FrameField::ReturnBase), 0xc0000000u | static_cast<u32>(base));
	machine.memory.writeMappedU32LE(control + static_cast<u32>(FrameField::ReturnCount), 0xd0000000u | static_cast<u32>(wanted == 0 ? 0 : wanted + 1));
	if (exceptionFrame) callee->addControlFlags(FRAME_EXCEPTION | FRAME_NMI);
	caller->registers.set(6, valueInteger(-7));
	caller->registers.set(7, valueInteger(99));
	const auto marker = machine.cpu.stringPool().intern("nativeReturnMarker");
	machine.cpu.setGlobalByKey(marker, valueNil());
	const auto& lookup = *caller->executionImage->nativeCodeLookup;
	auto* continuation = lookup.find(caller->readControl(bmsx::FrameField::Pc), 0);
	auto* alternate = lookup.find(markerPc, 0);
	const u32 word = (caller->readControl(bmsx::FrameField::Pc) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	const u32 markerWord = (markerPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	require(continuation->nativeCode && continuation->nativeCode[word] && alternate->nativeCode && alternate->nativeCode[markerWord],
		"both ordinary continuation and independent marker have live native dispatch entries");
	// Redirect only the raw code word, not the descriptor. A C++ RET dispatcher
	// still selects the ordinary descriptor and cannot execute this marker.
	// This disposable fixture never resumes or reuses the redirected cache.
	continuation->nativeCode[word] = coldTarget ? nullptr : alternate->nativeCode[markerWord];
	const int copied = wanted == 0 ? produced : std::min(produced, wanted);
	const int count = wanted == 0 ? produced : wanted;
	const bool grows = count != 0 && base + count > caller->stackCapacity();
	const int returnBase = BASE_CYCLES[static_cast<u8>(OpCode::RET)];
	const int markerAdmission = BASE_CYCLES[static_cast<u8>(OpCode::SETGL)];
	require(alternate->nativeBlocks->entries[markerWord]->admissionCycles == markerAdmission
		&& alternate->nativeBlocks->entries[markerWord]->terminal.cycles == markerAdmission + BASE_CYCLES[static_cast<u8>(OpCode::JMP)],
		"the independent marker admits its SETGL prefix before its terminal JMP");
	if (grant < 0) grant = count + returnBase;
	const auto* calleePublished = lookup.find(callee->readControl(bmsx::FrameField::Pc), 0);
	require(calleePublished && calleePublished->nativeCode
		&& calleePublished->nativeCode[(callee->readControl(bmsx::FrameField::Pc) & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES],
		"the RET under test has a real published native entry before redirecting its caller");

	const auto routeResult = machine.cpu.runUntilDepth(0, grant);
	require(routeResult == RunResult::Yielded && thread->currentFrame == caller
		&& thread->frameDepth == 2 && thread->protectedDepth() == 1, "ordinary native return retains its protected parent and exact grant boundary");
	require(static_cast<bmsx::i32>(caller->readControl(bmsx::FrameField::Top)) == base + count, "fixed, open and empty returns assign exact caller top even after a late cold exit");
	for (int index = 0; index < copied; ++index) require(caller->registers.get(base + index) == payloads[index],
		"native and late-cold result movement preserve every raw tagged and numeric bit");
	for (int index = copied; index < count; ++index) require(caller->registers.get(base + index) == valueNil(), "fixed results nil-pad only the requested suffix");
	if (base + count <= 6 || count == 0) require(caller->registers.get(6) == valueInteger(-7) && caller->registers.get(7) == valueInteger(99),
		"return does not overwrite retained caller registers outside its result range");
	require(machine.cpu.getGlobalByKey(marker) == ((!coldTarget && !grows && grant > returnBase + count + markerAdmission) ? caller->registers.get(7) : valueNil()),
		"warm RET branches through the raw native code word without executeReturn or the C++ descriptor dispatcher");
	if (grant <= returnBase + count) require(machine.cpu.instructionBudgetRemaining == grant - returnBase - count,
		"native RET charges the receiving range once and cannot execute the next body with an exhausted grant");
	require(callee->decodedPage == nullptr && callee->compilationEntry && thread->currentFrame == caller,
		"native retirement keeps the inactive record out of the live window");
	machine.cpu.beginCompletionCall(*closure);
	require(thread->currentFrame == callee && callee->attachedClosure() == closure && callee->executionImage == caller->executionImage
		&& callee->registers.words() == thread->stack.words() + callee->stackBase()
			&& callee->registers.tags() == thread->stack.tags() + callee->stackBase() && callee->hasControlFlag(FRAME_COMPLETION)
		&& callee->readControl(FrameField::Protected) == static_cast<u32>(-1) && !callee->hasControlFlag(FRAME_EXCEPTION) && !callee->hasControlFlag(FRAME_NMI),
		"a real activation rebinds the retired native node without inheriting protection or exception state");
	callee->registers.set(1, valueInteger(17)); callee->writeControl(bmsx::FrameField::Top, 2);
	require(machine.cpu.runUntilDepth(2, returnBase + 1) == RunResult::Halted && thread->currentFrame == caller
		&& thread->protectedDepth() == 1 && machine.cpu.instructionBudgetRemaining == 0,
		"the reused node returns once without completing its protected parent or resuming the redirected continuation");
	const auto results = machine.cpu.readCompletionValues();
	require(results.size() == 1 && results.get(0) == valueInteger(17), "reused native nodes return the new activation's own value");
}
#endif

void callFrameInitialization(int params, int maxStack, int args, bool vararg, bool alias) {
	const u32 record = DYNAMIC_RAM_BASE + 0x1800u;
	const int base = alias ? 7 : 8;
	test::Blua32TestImage image;
	image.text.resize(6 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 6, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), base, 6, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), base, args + 1, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 5, .maxStack = 16u},
		{.firstWord = 5, .wordCount = 1, .numParams = static_cast<u32>(params), .maxStack = 32, .isVararg = vararg}};
	image.closureRelocations = {{1, record}};
	CpuMachine native(image, false), scalar(image, true);
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(record, machine->rom.bytes.data() + machine->rom.functionAddresses[1], BLUA32_FUNCTION_RECORD_SIZE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 12000);
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
	for (auto* machine : {&native, &scalar}) {
		auto* thread = machine->cpu.activeThread();
		auto* caller = thread->currentFrame;
		machine->memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, static_cast<u32>(maxStack));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress);
		machine->cpu.runUntilDepth(0, 1);
		require(thread->stackCapacity >= 40, "an actual earlier call retained backing beyond the smaller raw frame reservation");
		for (size_t i = thread->stackTop; i < thread->stackCapacity; ++i) thread->stack.set(i, valueInteger(63));
		const std::array<Value, 5> payloads{valueFloatBits(0x80000000), valueFloatBits(0xffa12345), valueBool(true),
			valueString(machine->cpu.stringPool().intern("frame-argument")), valueInteger(99)};
		for (int index = 0; index < args; ++index) caller->registers.set(base + 1 + index, alias ? valueInteger(71 + index) : payloads[index]);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 2 * INSTRUCTION_BYTES);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 3);
	requireParity(native, scalar);
	for (auto* machine : {&native, &scalar}) {
		auto* thread = machine->cpu.activeThread();
		auto* callee = thread->currentFrame;
		const int count = vararg ? std::max(args - params, 0) : 0;
		const int capacity = std::max({maxStack, params, 1});
		require(thread->frameDepth == 2 && callee->readControl(bmsx::FrameField::Pc) == machine->rom.textAddress + 5 * INSTRUCTION_BYTES
			&& callee->stackCapacity() == capacity && static_cast<bmsx::i32>(callee->readControl(bmsx::FrameField::Top)) == params && static_cast<bmsx::i32>(callee->readControl(bmsx::FrameField::VarargCount)) == count,
			"CALL exposes exact fixed-parameter and reserved-capacity counts at its exhausted grant");
		const std::array<Value, 5> payloads{valueFloatBits(0x80000000), valueFloatBits(0xffa12345), valueBool(true),
			valueString(machine->cpu.stringPool().intern("frame-argument")), valueInteger(99)};
		for (int index = 0; index < params; ++index) require(callee->registers.get(index)
			== (index < args ? alias ? valueInteger(71 + index) : payloads[index] : valueNil()),
			"supplied raw arguments survive and missing fixed formals are nil, inside the owned formal reservation");
		for (int index = 0; index < count; ++index) require(thread->stack.get(static_cast<bmsx::i32>(callee->readControl(bmsx::FrameField::VarargBase)) + index)
			== (alias ? valueInteger(71 + params + index) : payloads[params + index]),
			"saved varargs remain in their original slots below relocated fixed parameters");
	}
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
	requireParity(native, scalar);
	if (alias) return;
	// Exercise the raw-argument owner as well, with the same reused storage and
	// unnormalized function record, rather than only bytecode CALL admission.
	for (auto* machine : {&native, &scalar}) {
		auto* thread = machine->cpu.activeThread();
		auto* caller = thread->currentFrame;
		for (size_t i = thread->stackTop; i < thread->stackCapacity; ++i) thread->stack.set(i, valueInteger(63));
		const std::array<Value, 5> payloads{valueFloatBits(0x80000000), valueFloatBits(0xffa12345), valueBool(true),
			valueString(machine->cpu.stringPool().intern("frame-argument")), valueInteger(99)};
		machine->cpu.beginCompletionCall(*asClosure(caller->registers.get(6), machine->cpu.gcHeap()), BuiltinArgsView(payloads.data(), args));
		auto* callee = thread->currentFrame;
		require(callee->stackCapacity() == std::max({maxStack, params, 1}) && static_cast<bmsx::i32>(callee->readControl(bmsx::FrameField::Top)) == params && callee->hasControlFlag(FRAME_COMPLETION),
			"raw argument calls retain the same frame sizing and completion owner");
		for (int index = 0; index < params; ++index) require(callee->registers.get(index) == (index < args ? payloads[index] : valueNil()),
			"raw argument admission preserves supplied bits and initializes only the missing formal tail");
		for (int index = 0; index < static_cast<bmsx::i32>(callee->readControl(bmsx::FrameField::VarargCount)); ++index) require(thread->stack.get(static_cast<bmsx::i32>(callee->readControl(bmsx::FrameField::VarargBase)) + index) == payloads[params + index],
			"raw argument varargs retain their separate ordered window");
	}
	requireParity(native, scalar);
}

void returnGrowthCollection() {
	test::Blua32TestImage image;
	image.text.resize(6 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 0, 1, 63);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 4, .maxStack = 8},
		{.firstWord = 4, .wordCount = 1, .maxStack = 8}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	for (const bool scalar : {false, true}) {
		CpuMachine machine(image, scalar);
		while (machine.cpu.activeThread()->frameDepth != 2) machine.cpu.runUntilDepth(0, 1);
		auto* caller = machine.cpu.activeThread()->firstFrame;
		auto* callee = machine.cpu.activeThread()->currentFrame;
		const Value result = valueString(machine.cpu.stringPool().intern("retained-only-by-returning-frame"));
		callee->registers.set(0, result);
		callee->writeControl(bmsx::FrameField::Top, 1);
		const auto heap = machine.cpu.luaHeap().captureState();
		machine.cpu.luaHeap().restoreState({heap.trackedBytes, heap.trackedBytes});
		require(machine.cpu.runUntilDepth(1, 100) == RunResult::Halted, "return stops at the caller depth after growing its window");
		require(machine.cpu.collecting(), "return window growth triggers an allocation assist");
		require(machine.cpu.stringPool().find("retained-only-by-returning-frame") == asStringId(result)
			&& caller->registers.get(0) == result && caller->stackCapacity() == 64 && static_cast<bmsx::i32>(caller->readControl(bmsx::FrameField::Top)) == 62,
			"return values remain rooted across collection and caller/callee window relocation");
		for (int index = 1; index < 62; ++index) require(caller->registers.get(index) == valueNil(), "missing fixed returns are nil");
		require(machine.cpu.activeThread()->currentFrame == caller && caller->next == callee,
			"return retires the same callee only after result transfer completes");
	}
}

void failedCallAdmission() {
	test::Blua32TestImage image;
	image.text.resize(6 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::CALL), 0, 1, 2);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::RET), 0, 2, 0);
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
			try { machine.cpu.beginCompletionCall(*asClosure(caller->registers.get(0), machine.cpu.gcHeap())); }
			catch (const LuaOutOfMemorySignal&) { rejected = true; }
			require(rejected && thread->frameDepth == 1 && thread->stackTop == 8,
				"failed completion admission never publishes an unallocated stack extent");
			require(caller->next->executionImage == nullptr,
				"the unadmitted reusable node retains no callee references");
		} else {
			machine.cpu.runUntilDepth(0, 2);
			require(machine.cpu.readLuaFaultReasonWord() == LUA_FAULT_REASON_OUT_OF_MEMORY
				&& thread->frameDepth == 2 && thread->stackTop == 16 && thread->currentFrame->stackBase() == 8,
				"failed guest CALL enters its fault handler above the real caller, not a phantom callee window");
		}
		require(thread->firstFrame == caller && caller->stackBase() == 0 && caller->stackCapacity() == 8,
			"call admission preserves the caller's live register extent");
	}
}

void returnPlacementCycles() {
	for (const bool scalar : {false, true}) for (const int producedOperand : {0, 1, 3}) for (const int wantedOperand : {0, 1, 2, 5}) {
		test::Blua32TestImage image;
		image.text.resize(8 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 4, 0, 0);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::LOADK), 5, 0, 0);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::LOADK), 6, 0, 1);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::CALL), 4, 3, wantedOperand);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 59, 255);
		writeInstruction(image.text, 7, static_cast<u8>(OpCode::RET), 0, producedOperand, 0);
		image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 16}, {.firstWord = 7, .wordCount = 1, .numParams = 2, .maxStack = 2}};
		image.constants = {17, 29};
		image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		CpuMachine machine(image, scalar);
		machine.cpu.runUntilDepth(0, 1000);
		const int produced = producedOperand == 0 ? 2 : producedOperand - 1;
		const int placed = wantedOperand == 0 ? produced : wantedOperand - 1;
		for (const int grant : {1, 2, 3, 2 + placed}) {
			machine.cpu.runUntilDepth(1, 100);
			machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress + 2 * INSTRUCTION_BYTES);
			while (machine.cpu.getFrameDepth() != 2) machine.cpu.runUntilDepth(0, 1);
			require(machine.cpu.runUntilDepth(1, grant) == RunResult::Halted, "RET finishes at the caller depth");
			require(machine.cpu.instructionBudgetRemaining == grant - BASE_CYCLES[static_cast<u8>(OpCode::RET)] - placed, "RET charges base plus selected range, even beyond the grant");
			const auto* caller = machine.cpu.activeThread()->currentFrame;
			require(caller->readControl(bmsx::FrameField::Pc) == machine.rom.textAddress + 6 * INSTRUCTION_BYTES && static_cast<bmsx::i32>(caller->readControl(bmsx::FrameField::Top)) == 4 + placed,
				"RET consumes no receiving instruction and selects the exact top");
			for (int i = 0; i < placed; ++i) require(caller->registers.get(4 + i) == (i < produced ? valueInteger(i == 0 ? 17 : 29) : valueNil()),
				"copied and nil-filled receiving slots are both charged");
		}
	}
}

void protectedReturnPlacementCycles() {
	for (const bool scalar : {false, true}) for (const int wanted : {0, 1, 2, 6, static_cast<int>(PSX_MACHINE_SPEC.ramBytes), static_cast<int>(PSX_MACHINE_SPEC.ramBytes + 1)}) {
		test::Blua32TestImage image;
		image.text.resize(7 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETSYS), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::GETSYS), 1, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::CLOSURE), 2, 0, 0);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::CALL), 0, 3, 0);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::RET), 0, 3, 0);
		image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 8}, {.firstWord = 6, .wordCount = 1, .maxStack = 2}};
		image.systemGlobalNames = {"pcall"};
		image.closureRelocations = {{3, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		CpuMachine machine(image, scalar);
		machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("pcall"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::PCall));
		while (machine.cpu.getFrameDepth() != 2) machine.cpu.runUntilDepth(0, 1);
		auto* thread = machine.cpu.activeThread();
		require(thread->protectedDepth() == 2, "nested builtin pcall owns two result ranges");
		thread->currentFrame->registers.set(0, valueInteger(17)); thread->currentFrame->registers.set(1, valueInteger(29));
		const bool failFirst = wanted == static_cast<int>(PSX_MACHINE_SPEC.ramBytes + 1);
		const u32 frames = machine.cpu.memory().readRamRecordWord(thread->address + static_cast<u32>(ThreadField::FrameCapacity));
		const u32 controls = thread->stackOffset() + ((thread->stackByteLength() + 3u) & ~3u) + frames * FRAME_CONTROL_BYTES;
		machine.cpu.memory().writeRamRecordWord(controls + (failFirst ? PROTECTED_CALL_BYTES : 0)
			+ static_cast<u32>(ProtectedField::Wanted), failFirst ? PSX_MACHINE_SPEC.ramBytes : wanted);
		const bool fault = wanted >= static_cast<int>(PSX_MACHINE_SPEC.ramBytes);
		// The failed success-range admission is followed by protected error-range admission, which also fails.
		// Both emergency collections scan/reclaim the compact five-byte stack slots.
		// Completing the inner return drops its closure before the first scan: three fewer mark words.
		// Each collection also visits 16 intern buckets and marks/visits the 14 RAM roots.
		// Four reserved frame slots and two continuation records are examined on all four visits.
		const int extraWords = (heapAllocationBytes(8 * 5 + 4 * FRAME_CONTROL_BYTES + 2 * PROTECTED_CALL_BYTES) - heapAllocationBytes(8 * 5)) / 4;
		const int gcCycles = fault ? (failFirst ? 242 : 239) + 2 * (16 + 2 * 14 + 4 * extraWords) : 0;
		bool rejected = false;
		try { require(machine.cpu.runUntilDepth(1, 2) == RunResult::Halted, "protected return completes at caller"); }
		catch (const LuaOutOfMemorySignal&) { rejected = true; }
		require(rejected == fault, "only unadmitted outer range raises allocation failure");
		const int outer = wanted == 0 ? 4 : wanted - 1;
		require(machine.cpu.instructionBudgetRemaining == 2 - BASE_CYCLES[static_cast<u8>(OpCode::RET)] - (failFirst ? 0 : 3) - (fault ? 0 : outer) - gcCycles,
			"completed inner status/value range and pre-admission GC stay charged when outer admission fails");
		if (!fault) {
			const Value values[]{valueBool(true), valueBool(true), valueInteger(17), valueInteger(29), valueNil()};
			for (int i = 0; i < outer; ++i) require(thread->currentFrame->registers.get(i) == values[i], "protected return retains result order and padding");
		}
	}
}

void coroutineReturnPlacementCycles() {
	for (const bool scalar : {false, true}) for (const int wanted : {0, 1, 2, 6}) {
		test::Blua32TestImage image;
		image.text.resize(9 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETSYS), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 1, 0, 0);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 2, 2);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::GETSYS), 4, 0, 1);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::MOV), 5, 0, 0);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::CALL), 4, 2, wanted);
		writeInstruction(image.text, 7, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
		writeInstruction(image.text, 8, static_cast<u8>(OpCode::RET), 0, 3, 0);
		image.functions = {{.firstWord = 0, .wordCount = 8, .maxStack = 12}, {.firstWord = 8, .wordCount = 1, .maxStack = 2}};
		image.systemGlobalNames = {"create", "resume"};
		image.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		CpuMachine machine(image, scalar);
		machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("create"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::CoroutineCreate));
		machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("resume"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::CoroutineResume));
		auto* root = machine.cpu.activeThread();
		while (machine.cpu.activeThread() == root) machine.cpu.runUntilDepth(0, 1);
		machine.cpu.activeThread()->currentFrame->registers.set(0, valueInteger(17)); machine.cpu.activeThread()->currentFrame->registers.set(1, valueInteger(29));
		require(machine.cpu.runUntilDepth(0, 2) == RunResult::Yielded, "coroutine RET ends the current execution slice");
		const int placed = wanted == 0 ? 3 : wanted - 1;
		require(machine.cpu.instructionBudgetRemaining == 2 - BASE_CYCLES[static_cast<u8>(OpCode::RET)] - placed && machine.cpu.activeThread() == root,
			"coroutine RET charges status, results and nil padding in its resumer");
		const Value values[]{valueBool(true), valueInteger(17), valueInteger(29), valueNil(), valueNil()};
		for (int i = 0; i < placed; ++i) require(root->currentFrame->registers.get(4 + i) == values[i], "resumer receives the selected range");
	}
}

void rootReturnPlacementCycles() {
	for (const bool scalar : {false, true}) for (const int producedOperand : {0, 1, 3}) {
		test::Blua32TestImage image;
		image.text.resize(INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::RET), 0, producedOperand, 0);
		image.functions = {{.firstWord = 0, .wordCount = 1, .maxStack = 2}};
		CpuMachine machine(image, scalar);
		auto* frame = machine.cpu.activeThread()->currentFrame;
		frame->registers.set(0, valueInteger(17)); frame->registers.set(1, valueInteger(29)); frame->writeControl(bmsx::FrameField::Top, 2);
		require(machine.cpu.runUntilDepth(0, 1) == RunResult::Halted, "root RET completes");
		const int count = producedOperand == 0 ? 2 : producedOperand - 1;
		require(machine.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::RET)] - count && machine.cpu.readCompletionValues().size() == static_cast<size_t>(count),
			"root completion range charges the produced slot count");
	}
	for (const bool scalar : {false, true}) {
		test::Blua32TestImage image;
		image.text.resize(4 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::RET), 0, 0, 0);
		image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 8}, {.firstWord = 3, .wordCount = 1, .numParams = 2, .maxStack = 2}};
		image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
		CpuMachine machine(image, scalar);
		machine.cpu.runUntilDepth(0, 1);
		auto* closure = asClosure(machine.cpu.activeThread()->currentFrame->registers.get(0), machine.cpu.gcHeap());
		const Value args[]{valueInteger(17), valueInteger(29)};
		for (int call = 0; call < 16; ++call) {
			machine.cpu.beginCompletionCall(*closure, BuiltinArgsView(args, 2));
			require(machine.cpu.runUntilDepth(1, 1) == RunResult::Halted && machine.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::RET)] - 2,
				"completion-latch RET charges its two produced slots even with an exhausted grant");
			require(machine.cpu.readCompletionValues().size() == 2 && machine.cpu.readCompletionValues().get(0) == args[0]
				&& machine.cpu.readCompletionValues().get(1) == args[1], "completion latch preserves its value range");
		}
	}
}

void errorHandlerReturnPlacementCycles() {
	for (const bool scalar : {false, true}) {
		test::Blua32TestImage image;
		image.text.resize(12 * INSTRUCTION_BYTES);
		writeInstruction(image.text, 0, static_cast<u8>(OpCode::GETSYS), 0, 0, 0);
		writeInstruction(image.text, 1, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 2, static_cast<u8>(OpCode::CLOSURE), 1, 0, 0);
		writeInstruction(image.text, 3, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, 4, static_cast<u8>(OpCode::CLOSURE), 2, 0, 0);
		writeInstruction(image.text, 5, static_cast<u8>(OpCode::CALL), 0, 3, 6);
		writeInstruction(image.text, 6, static_cast<u8>(OpCode::JMP), 0, 63, 63, 255);
		writeInstruction(image.text, 7, static_cast<u8>(OpCode::GETSYS), 0, 0, 1);
		writeInstruction(image.text, 8, static_cast<u8>(OpCode::LOADK), 1, 0, 0);
		writeInstruction(image.text, 9, static_cast<u8>(OpCode::CALL), 0, 2, 1);
		writeInstruction(image.text, 10, static_cast<u8>(OpCode::RET), 0, 1, 0);
		writeInstruction(image.text, 11, static_cast<u8>(OpCode::RET), 0, 2, 0);
		image.functions = {{.firstWord = 0, .wordCount = 7, .maxStack = 8}, {.firstWord = 7, .wordCount = 4, .maxStack = 4},
			{.firstWord = 11, .wordCount = 1, .numParams = 1, .maxStack = 1}};
		image.constants = {17}; image.systemGlobalNames = {"xpcall", "error"};
		image.closureRelocations = {{2, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}, {4, test::blua32TestFunctionAddress(RomImageDomain::System, 2)}};
		CpuMachine machine(image, scalar);
		machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("xpcall"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::XPCall));
		machine.cpu.setSystemGlobalByKey(machine.cpu.stringPool().intern("error"), machine.cpu.createBuiltinFunction(BuiltinFunctionId::Error));
		while (machine.cpu.activeThread()->currentFrame->readControl(FrameField::Function) != machine.rom.functionAddresses[2]) machine.cpu.runUntilDepth(0, 1);
		require(machine.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::CALL)] - 2 - 1, "error CALL and primitive plus one placed handler argument");
		require(machine.cpu.runUntilDepth(1, 1) == RunResult::Halted && machine.cpu.instructionBudgetRemaining == 1 - BASE_CYCLES[static_cast<u8>(OpCode::RET)] - 5,
			"handler RET charges the selected error receiving range");
		const Value values[]{valueBool(false), valueInteger(17), valueNil(), valueNil(), valueNil()};
		for (int i = 0; i < 5; ++i) require(machine.cpu.activeThread()->currentFrame->registers.get(i) == values[i], "handler result prefix and padding are preserved");
	}
}

void weakCanonicalClosuresAndStaticEntry() {
	const u32 record = DYNAMIC_RAM_BASE + 0x5000u;
	test::Blua32TestImage image;
	image.text.resize(4 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::JMP), 0, 63, 61, 255);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::RET), 0, 1, 0);
	image.functions = {{.firstWord = 0, .wordCount = 3, .maxStack = 2},
		{.firstWord = 3, .wordCount = 1, .maxStack = 2}};
	image.closureRelocations = {{1, record}};
	for (bool scalar : {false, true}) {
		CpuMachine machine(image, scalar);
		machine.memory.writeBytes(record, machine.rom.bytes.data() + machine.rom.functionAddresses[1], BLUA32_FUNCTION_RECORD_SIZE);
		for (u32 version = 1; version <= 64; ++version) {
			machine.memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, version);
			machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine.rom.functionAddresses[0], machine.rom.textAddress);
			machine.cpu.runUntilDepth(0, 1);
		}
		auto countVersions = [&](const CpuRuntimeState& state) {
			size_t count = 0;
			for (u32 offset : state.snapshot.objectWords()) {
				if (state.snapshot.word(offset + SNAP_CLOSURE_KIND) == static_cast<u32>(CpuSnapshotObjectKind::Closure)
					&& state.snapshot.word(offset + SNAP_CLOSURE_FUNCTION_ADDRESS) == record
					&& state.snapshot.word(offset + SNAP_CLOSURE_CANONICAL) != 0) ++count;
			}
			return count;
		};
		const auto before = machine.cpu.captureRuntimeState();
		require(countVersions(before) == 64, "snapshot retains uncollected weak canonical entries");
		machine.cpu.restoreRuntimeState(before);
		require(countVersions(machine.cpu.captureRuntimeState()) == 64, "restore retains the uncollected interning state");
		const size_t bytesBefore = machine.cpu.luaHeap().usedBytes();
		machine.cpu.collectHeap();
		require(countVersions(machine.cpu.captureRuntimeState()) == 1 && machine.cpu.luaHeap().usedBytes() < bytesBefore,
			"guest GC removes unreachable record versions from the weak index and heap");
		const auto last = asClosure(machine.cpu.readFrameRegister(0, 0), machine.cpu.gcHeap());
		require(last->prototype->maxStack == 64, "the live closure survives guest GC");
		machine.memory.writeMappedU32LE(record + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, 3);
		machine.memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, 4096);
		const auto pressure = machine.cpu.luaHeap().captureState();
		machine.cpu.luaHeap().restoreState({pressure.trackedBytes, pressure.trackedBytes + 32});
		machine.cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, record);
		require(machine.cpu.luaHeap().captureState().nextCollectionBytes > pressure.trackedBytes + 32,
			"callee stack growth collected while admitting a freshly created canonical closure");
		const auto direct = machine.cpu.activeThread()->currentFrame->attachedClosure();
		require(direct->prototype->recordUpvalueCount == 3 && direct->upvalueCount == 0,
			"direct STATIC entry binds raw descriptor count but has no captured slots");
		const auto directState = machine.cpu.captureRuntimeState();
		machine.cpu.restoreRuntimeState(directState);
		const auto restored = machine.cpu.activeThread()->currentFrame->attachedClosure();
		require(restored->prototype->recordUpvalueCount == 3 && restored->upvalueCount == 0,
			"snapshot preserves the distinction without reading nonexistent upvalues");
	}
}

// The caller executes from writable RAM; its callee and function record stay in ROM.
void rewriteActiveReturnAddress() {
	const u32 callerPc = DYNAMIC_RAM_BASE + 2 * MAPPED_PAGE_BYTE_SIZE;
	test::Blua32TestImage image; image.text.resize(8 * INSTRUCTION_BYTES);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 4, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 0, 4, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::CALL), 0, 1, 2);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::MOV), 6, 0, 0);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::JMP), 0, 63, 60, 255);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::K1), 0, 0, 0);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::RET), 0, 2, 0);
	image.functions = {{.firstWord = 0, .wordCount = 6, .maxStack = 8}, {.firstWord = 6, .wordCount = 2}};
	image.closureRelocations = {{1, test::blua32TestFunctionAddress(RomImageDomain::System, 1)}};
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// Precompile the immutable callee. The single warm-up job under test is
	// the writable caller and its continuation; do not race two submissions.
	native.cpu.prepareSystemNativeCode();
#endif
	for (auto* m : {&native, &scalar}) {
		m->memory.writeBytes(callerPc, m->rom.bytes.data() + m->rom.textAddress, 6 * INSTRUCTION_BYTES);
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], callerPc);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 20000);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const auto& pages = native.cpu.activeThread()->firstFrame->executionImage->decodedPages;
	const auto& ramPage = pages.at(callerPc);
	const u32 calleePc = native.rom.textAddress + 6 * INSTRUCTION_BYTES;
	const auto& romPage = pages.at(calleePc & ~MAPPED_PAGE_BYTE_MASK);
	test::waitForNativeEntry(native.cpu, ramPage, 4);
	test::waitForNativeEntry(native.cpu, romPage, (calleePc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
	require(romPage.nativeBlocks->entries[(calleePc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]->terminal.exit == NativeBlockExit::Return,
		"callee has a generated return while the original RAM continuation is still live");
#endif
	test::runCpuParity(native.cpu, scalar.cpu, 100, 1);
	const u32 returnPc = callerPc + 4 * INSTRUCTION_BYTES;
	std::vector<u8> replacement(INSTRUCTION_BYTES);
	writeInstruction(replacement, 0, static_cast<u8>(OpCode::HALT), 0, 0, 0);
	for (auto* m : {&native, &scalar}) {
		m->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, m->rom.functionAddresses[0], callerPc + 2 * INSTRUCTION_BYTES);
		m->cpu.activeThread()->firstFrame->registers.set(6, valueInteger(73));
	}
	test::runCpuParity(native.cpu, scalar.cpu, BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + BASE_CYCLES[static_cast<u8>(OpCode::CALL)]);
	for (auto* m : {&native, &scalar}) {
		require(m->cpu.activeThread()->frameDepth == 2 && m->cpu.activeThread()->firstFrame->readControl(bmsx::FrameField::Pc) == returnPc,
			"the original caller is suspended at its generated return address");
		m->memory.writeMappedWord(returnPc, readLE32(replacement.data()));
	}
	require(test::runCpuParity(native.cpu, scalar.cpu, 100) == RunResult::Halted,
		"RET executes the replacement HALT rather than the retired MOV and backedge");
	for (auto* m : {&native, &scalar}) {
		require(m->cpu.activeThread()->frameDepth == 1 && m->cpu.readFramePc(0) == returnPc + INSTRUCTION_BYTES
			&& m->cpu.readFrameRegister(0, 0) == valueInteger(1) && m->cpu.readFrameRegister(0, 6) == valueInteger(73),
			"RET transfers the result once without executing the obsolete caller instruction");
	}
	requireParity(native, scalar);
}

void crossPageCalls(bool open, u32 recordOffset) {
	const int callPrefix = BASE_CYCLES[static_cast<u8>(OpCode::MOV)] + 2 * BASE_CYCLES[static_cast<u8>(OpCode::LOADK)]
		+ BASE_CYCLES[static_cast<u8>(OpCode::CALL)];
	const u32 record = DYNAMIC_RAM_BASE + recordOffset;
	const u32 largeRecord = record + 0x40u, secondRecord = record + 0x80u, unalignedEntryRecord = record + 0xc0u;
	test::Blua32TestImage image; image.text.resize(2 * MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(image.text, 0, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
	writeInstruction(image.text, 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	writeInstruction(image.text, 2, static_cast<u8>(OpCode::MOV), 4, 0, 0);
	writeInstruction(image.text, 3, static_cast<u8>(OpCode::LOADK), 5, 0, 0);
	writeInstruction(image.text, 4, static_cast<u8>(OpCode::LOADK), 6, 0, 1);
	writeInstruction(image.text, 5, static_cast<u8>(OpCode::CALL), 4, open ? 0 : 3, open ? 0 : 3);
	writeInstruction(image.text, 6, static_cast<u8>(OpCode::ADD), 3, 4, 5);
	writeInstruction(image.text, 7, static_cast<u8>(OpCode::JMP), 0, 63, 58, 255);
	for (const u32 start : {DECODED_PAGE_WORDS, DECODED_PAGE_WORDS + 32u}) {
		writeInstruction(image.text, start, static_cast<u8>(start == DECODED_PAGE_WORDS ? OpCode::ADD : OpCode::SUB), 2, 0, 1);
		writeInstruction(image.text, start + 1u, static_cast<u8>(OpCode::MOV), 3, start == DECODED_PAGE_WORDS ? 0 : 1, 0);
		writeInstruction(image.text, start + 2u, static_cast<u8>(OpCode::RET), 2, open ? 0 : 3, 0);
	}
	for (const u32 site : {16u, 18u, 20u}) {
		writeInstruction(image.text, site, static_cast<u8>(OpCode::WIDE), 0, 0, 0);
		writeInstruction(image.text, site + 1, static_cast<u8>(OpCode::CLOSURE), 0, 0, 0);
	}
	image.functions = {{.firstWord = 0, .wordCount = 22, .maxStack = 8},
		{.firstWord = DECODED_PAGE_WORDS, .wordCount = 3, .numParams = 2, .maxStack = 8},
		{.firstWord = DECODED_PAGE_WORDS + 32u, .wordCount = 3, .numParams = 2, .maxStack = 1024}};
	image.constants = {3, 4}; image.closureRelocations = {{1, record}, {17, largeRecord}, {19, secondRecord}, {21, unalignedEntryRecord}};
	CpuMachine native(image, false), scalar(image, true);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	native.cpu.setNativeCompilationProfiling(true);
#endif
	for (auto* machine : {&native, &scalar}) {
		machine->memory.writeBytes(record, machine->rom.bytes.data() + machine->rom.functionAddresses[1], BLUA32_FUNCTION_RECORD_SIZE);
	}
	test::runCpuParity(native.cpu, scalar.cpu, 20000);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	for (int pass = 0; pass < 4; ++pass) {
		test::waitForFixtureWorkerRequests(native.cpu);
		bool call = false, ret = false;
		for (const auto& [key, page] : native.cpu.activeThread()->frameAtDepth(0)->executionImage->decodedPages) if (page.nativeBlocks)
			for (const auto& block : page.nativeBlocks->entries) if (block) {
				call |= block->terminal.exit == NativeBlockExit::Call;
				ret |= block->terminal.exit == NativeBlockExit::Return;
			}
		if (call && ret) break;
		test::runCpuParity(native.cpu, scalar.cpu, 20000);
	}
	test::waitForFixtureWorkerRequests(native.cpu);
#endif
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
		machine->cpu.activeThread()->frameAtDepth(0)->registers.set(3, valueInteger(99));
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 2u * INSTRUCTION_BYTES);
		require(machine->cpu.runUntilDepth(0, callPrefix) == RunResult::Yielded && machine->cpu.activeThread()->frameDepth == 2,
			"CALL cannot consume a callee instruction without a further cycle grant");
		require(machine->cpu.runUntilDepth(1, 50) == RunResult::Halted && machine->cpu.instructionBudgetRemaining == 50 - BASE_CYCLES[static_cast<u8>(OpCode::ADD)] - BASE_CYCLES[static_cast<u8>(OpCode::MOV)] - BASE_CYCLES[static_cast<u8>(OpCode::RET)] - 2
			&& machine->cpu.readFrameRegister(0, 3) == valueInteger(99),
			"a hot RET respects target depth before a hot caller continuation executes");
	}
	requireParity(native, scalar);
	for (auto* machine : {&native, &scalar}) {
		const auto capacity = machine->cpu.activeThread()->stackCapacity;
		const auto* caller = machine->cpu.activeThread()->currentFrame;
		const auto* spare = caller->next;
		require(spare != nullptr, "warm calls have a reusable callee node");
		machine->memory.writeBytes(largeRecord, machine->rom.bytes.data() + machine->rom.functionAddresses[1], BLUA32_FUNCTION_RECORD_SIZE);
		machine->memory.writeMappedU32LE(largeRecord + BLUA32_FUNCTION_MAX_STACK_OFFSET, 1024);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 16u * INSTRUCTION_BYTES);
		machine->cpu.runUntilDepth(0, 1);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 2u * INSTRUCTION_BYTES);
		const auto heap = machine->cpu.luaHeap().captureState();
		machine->cpu.luaHeap().restoreState({heap.trackedBytes, heap.trackedBytes});
		require(machine->cpu.runUntilDepth(0, callPrefix) == RunResult::Yielded && machine->cpu.activeThread()->frameDepth == 2,
			"the allocation assist completes CALL but not a callee instruction in its exhausted grant");
		require(machine->cpu.runUntilDepth(1, 50) == RunResult::Halted && machine->cpu.activeThread()->frameDepth == 1
			&& machine->cpu.activeThread()->stackCapacity > capacity && machine->cpu.readFrameRegister(0, 4) == valueInteger(7),
			"a hot call relocates the stack before a hot callee and return use the new register bases");
		require(machine->cpu.collecting(), "callee stack growth triggers an allocation assist");
		require(machine->cpu.activeThread()->currentFrame == caller && caller->next == spare,
			"collection during call preparation preserves the inactive callee and active caller identities");
	}
	requireParity(native, scalar);
	for (auto* machine : {&native, &scalar}) {
		const u32 entry = machine->rom.textAddress + 2u * INSTRUCTION_BYTES;
		machine->cpu.activeThread()->currentFrame->registers.set(1, machine->cpu.activeThread()->currentFrame->registers.get(0));
		machine->memory.writeBytes(secondRecord, machine->rom.bytes.data() + machine->rom.functionAddresses[2], BLUA32_FUNCTION_RECORD_SIZE);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], entry);
		machine->cpu.runUntilDepth(0, callPrefix); machine->cpu.runUntilDepth(1, 100);
		require(machine->cpu.readFrameRegister(0, 4) == valueInteger(7), "publishing a separate prototype leaves the original callable");
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 18u * INSTRUCTION_BYTES);
		machine->cpu.runUntilDepth(0, 1);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], entry);
		machine->cpu.runUntilDepth(0, 20000); machine->cpu.runUntilDepth(1, 100);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], entry);
		machine->cpu.runUntilDepth(0, callPrefix);
		auto* active = machine->cpu.activeThread()->currentFrame;
		require(active->readControl(bmsx::FrameField::Pc) == machine->rom.textAddress + (DECODED_PAGE_WORDS + 32u) * INSTRUCTION_BYTES,
			"the rebound closure reached its new callee");
		const auto activeSnapshot = machine->cpu.captureRuntimeState();
		machine->cpu.restoreRuntimeState(activeSnapshot);
		active = machine->cpu.activeThread()->currentFrame;
		require(active->readControl(bmsx::FrameField::Pc) == machine->rom.textAddress + (DECODED_PAGE_WORDS + 32u) * INSTRUCTION_BYTES
			&& active->executionImage->executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID,
			"snapshot restores an active frame and its published prototype");
		machine->cpu.runUntilDepth(1, 100);
		require(machine->cpu.readFrameRegister(0, 4) == valueInteger(-1), "the new closure calls its separate prototype");
		const auto oldFunction = machine->cpu.readFrameRegister(0, 1);
		const auto newFunction = machine->cpu.readFrameRegister(0, 0);
		require(oldFunction != newFunction && asClosure(oldFunction, machine->cpu.gcHeap())->prototype != asClosure(newFunction, machine->cpu.gcHeap())->prototype
			&& asClosure(oldFunction, machine->cpu.gcHeap())->prototype->codeAddress != asClosure(newFunction, machine->cpu.gcHeap())->prototype->codeAddress,
			"different static prototypes have distinct canonical closures");
		const u32 oldCode = asClosure(oldFunction, machine->cpu.gcHeap())->prototype->codeAddress;
		const u32 newCode = asClosure(newFunction, machine->cpu.gcHeap())->prototype->codeAddress;
		const auto snapshot = machine->cpu.captureRuntimeState();
		machine->cpu.restoreRuntimeState(snapshot);
		const auto restoredOld = machine->cpu.readFrameRegister(0, 1);
		const auto restoredNew = machine->cpu.readFrameRegister(0, 0);
		require(restoredOld != restoredNew && asClosure(restoredOld, machine->cpu.gcHeap())->prototype->codeAddress == oldCode
			&& asClosure(restoredNew, machine->cpu.gcHeap())->prototype->codeAddress == newCode,
			"snapshot restores both distinct canonical prototypes");
		// A hot-resume relocation can bind two previously distinct closures to
		// identical records. Their identities and hash keys must still survive.
		auto relocatedSnapshot = snapshot;
		u32 oldOffset = 0, newOffset = 0;
		for (const u32 offset : relocatedSnapshot.snapshot.objectWords()) {
			if (relocatedSnapshot.snapshot.word(offset + SNAP_CLOSURE_KIND) != static_cast<u32>(CpuSnapshotObjectKind::Closure)) continue;
			const u32 address = relocatedSnapshot.snapshot.word(offset + SNAP_CLOSURE_FUNCTION_ADDRESS);
			if (address == largeRecord) oldOffset = offset;
			if (address == secondRecord) newOffset = offset;
		}
		for (const u32 field : {SNAP_CLOSURE_FUNCTION_ADDRESS, SNAP_CLOSURE_CODE_ADDRESS, SNAP_CLOSURE_NUM_PARAMS, SNAP_CLOSURE_MAX_STACK,
			SNAP_CLOSURE_FLAGS, SNAP_CLOSURE_UPVALUE_TABLE_ADDRESS, SNAP_CLOSURE_EXECUTION_DOMAIN_ID})
			relocatedSnapshot.snapshot.setWord(oldOffset + field, relocatedSnapshot.snapshot.word(newOffset + field));
		machine->cpu.restoreRuntimeState(relocatedSnapshot);
		const auto relocatedOld = asClosure(machine->cpu.readFrameRegister(0, 1), machine->cpu.gcHeap());
		const auto relocatedNew = asClosure(machine->cpu.readFrameRegister(0, 0), machine->cpu.gcHeap());
		require(relocatedOld != relocatedNew && relocatedOld->prototype == relocatedNew->prototype
			&& relocatedOld->hashId != relocatedNew->hashId,
			"restore preserves distinct canonical identities even when bound records coincide");
		relocatedSnapshot.snapshot.setWord(oldOffset + SNAP_CLOSURE_HASH_ID,
			relocatedSnapshot.snapshot.word(newOffset + SNAP_CLOSURE_HASH_ID));
		machine->cpu.restoreRuntimeState(relocatedSnapshot);
		const auto collidedOld = asClosure(machine->cpu.readFrameRegister(0, 1), machine->cpu.gcHeap());
		const auto collidedNew = asClosure(machine->cpu.readFrameRegister(0, 0), machine->cpu.gcHeap());
		require(collidedOld != collidedNew && collidedOld->prototype == collidedNew->prototype
			&& collidedOld->hashId == collidedNew->hashId,
			"canonical closure identity also survives object hash collisions");
		const auto collidedSnapshot = machine->cpu.captureRuntimeState();
		machine->cpu.restoreRuntimeState(collidedSnapshot);
		require(machine->cpu.readFrameRegister(0, 1) != machine->cpu.readFrameRegister(0, 0),
			"canonical closure collision remains distinct across a second snapshot");
		machine->cpu.restoreRuntimeState(snapshot);
		machine->memory.writeBytes(unalignedEntryRecord, machine->rom.bytes.data() + machine->rom.functionAddresses[1], BLUA32_FUNCTION_RECORD_SIZE);
		machine->memory.writeMappedU32LE(unalignedEntryRecord + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, machine->rom.textAddress + DECODED_PAGE_WORDS * INSTRUCTION_BYTES + 1u);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], machine->rom.textAddress + 20u * INSTRUCTION_BYTES);
		machine->cpu.runUntilDepth(0, 1);
		machine->cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, machine->rom.functionAddresses[0], entry);
		require(machine->cpu.runUntilDepth(0, callPrefix) == RunResult::Yielded && machine->cpu.readBadAddressWord() == 0u,
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
		rewriteActiveReturnAddress();
		ownedValueStack();
		reusableFrameChain();
		inactiveFrameMetadata();
		protectedNestedFrames();
		valueRangePlacementCycles();
		closureBindingAndClosingCycles();
		weakCanonicalClosuresAndStaticEntry();
		protectedBuiltinPlacementCycles();
		returnPlacementCycles();
		protectedReturnPlacementCycles();
		coroutineReturnPlacementCycles();
		rootReturnPlacementCycles();
		errorHandlerReturnPlacementCycles();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		haltedReceivingFrame();
		for (const int grant : {1, 3, 5}) {
			nativeCallRouting(3, 1, false, false, false, false, false, 8, grant);
			nativeCallRouting(3, 1, true, false, false, false, false, 8, grant);
		}
		nativeCallRouting(3, 5, true, true, false, false, false);
		nativeCallRouting(4, 1, false, false, false, false, false);
		nativeCallRouting(0, 0, false, true, false, false, false);
		nativeCallRouting(3, 5, true, false, false, true, false);
		nativeCallRouting(3, 2, false, true, true, false, false);
		nativeCallRouting(1, 1, false, false, false, false, true);
		nativeCallRouting(10, 1, false, false, false, false, false, 2);
		nativeCallRouting(6, 4, false, false, false, false, false, 2);
		nativeCallRouting(3, 1, false, false, false, false, false, 0);
		nativeReturnRouting(6, 0, 0, false, true);
		nativeReturnRouting(2, 4, 0, false, false);
		nativeReturnRouting(6, 2, 0, false, false);
		nativeReturnRouting(0, 0, 10, false, false);
		nativeReturnRouting(6, 0, 0, true, false);
		nativeReturnRouting(6, 0, 6, false, false);
		nativeReturnRouting(2, 4, 0, false, false, BASE_CYCLES[static_cast<u8>(OpCode::RET)] + 4 + BASE_CYCLES[static_cast<u8>(OpCode::SETGL)] + 1);
		nativeReturnRouting(6, 2, 0, false, false, BASE_CYCLES[static_cast<u8>(OpCode::RET)] + 2 + BASE_CYCLES[static_cast<u8>(OpCode::SETGL)] + 1);
		for (const int grant : {1, 2, 3}) {
			nativeReturnRouting(2, 4, 0, false, false, grant);
			nativeReturnRouting(6, 2, 0, false, false, grant);
			nativeReturnRouting(6, 0, 0, true, false, grant);
		}
#endif
		callFrameInitialization(4, 8, 1, false, false);
		callFrameInitialization(8, 8, 0, false, false);
		callFrameInitialization(6, 2, 1, false, false);
		callFrameInitialization(6, 2, 4, false, false);
		callFrameInitialization(3, 0, 1, false, false);
		callFrameInitialization(0, 0, 0, false, false);
		callFrameInitialization(2, 4, 5, true, false);
		callFrameInitialization(1, 4, 3, true, true);
		returnGrowthCollection();
		failedCallAdmission();
		for (const bool open : {false, true}) for (const u32 offset : {0x1800u, 0x1ff0u}) crossPageCalls(open, offset);
		std::cout << "Compiled call/return tests passed\n"; return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
