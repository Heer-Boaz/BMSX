#include "machine/cpu/jit/runtime/execution.h"

#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/sljit/gate.h"

namespace bmsx {

NativeCpuRunState::NativeCpuRunState(CPU& owner, int depth)
	: cpu(&owner), targetDepth(depth) {
	state.heap = &owner.m_heap;
	state.globalValues = &owner.m_globalBank.values();
	state.systemGlobalValues = &owner.m_systemGlobalBank.values();
	state.cop0Words = owner.m_cop0Words.data();
	state.ram = owner.m_memory.ramData();
}

// Entry from scalar execution. A native-to-native edge already has the
// grant and transfers only the activation state affected by that edge.
void NativeCpuRunState::enterFrame(CallFrame& frame, int budget) {
	auto& thread = *frame.thread;
	const auto& image = *frame.executionImage;
	thread.recordNativeWrites(cpu->m_memory.ramWriteWatches());
	frameBank = frameBankWord(image.executionDomainId);
	closureCallHeader = ClosureRecord::fixedCallHeader(image.executionDomainId);
	nativeStackCapacity = thread.stackCapacity;
	nativeFrameLimit = thread.retainedFrameLimit();
	haltedCallDepth = cpu->m_haltedUntilIrqThreadAddress == thread.address ? cpu->m_haltedUntilIrqFrameDepth : -1;
	cartridgeSlot = cpu->m_memory.cartridgeController().selectedSlot(cpu->m_executionBusSignals);
	codeRoot = image.nativeCodeLookup->root(cartridgeSlot);
	state.constants = image.constPool;
	state.frame = &frame;
	state.remainingCycles = budget;
	state.registerTop = frame.readWindow(FrameField::Top);
	state.closure = frame.closureAddress();
	state.stackBase = frame.stackBase();
	state.frameDepth = thread.frameDepth();
	state.exitCode = nativeBlockGate().dispatch;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	state.diagnosticOpcodes = {};
#endif
}

} // namespace bmsx
