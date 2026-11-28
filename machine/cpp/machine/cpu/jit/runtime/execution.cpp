#include "machine/cpu/jit/runtime/execution.h"

#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/sljit/gate.h"

namespace bmsx {

void NativeBlockRunState::readWindow(const CallFrame& frame) noexcept {
	physicalTop = frame.readAdmittedWindow(FrameField::Top);
	registerBase = frame.registerBase();
	stackOrigin = frame.readAdmittedWindow(FrameField::StackBase);
	windowWidth = frame.readAdmittedWindow(FrameField::StackCapacity);
}

void NativeBlockRunState::publishRegisterBase() const noexcept {
	if (registerBase == frame->registerBase()) return;
	frame->m_registerBase = registerBase;
	frame->registers = frame->thread->stack.linearSubspan(stackOrigin + registerBase, windowWidth - static_cast<size_t>(registerBase));
	if (!frame->pendingNativeCall) frame->writeAdmittedControl(FrameField::RegisterBase, registerBase);
}

NativeCpuRunState::NativeCpuRunState(CPU& owner, int depth)
	: cpu(&owner), targetDepth(depth) {
	state.memory = &owner.m_memory;
	state.globalValues = &owner.m_globalBank.values();
	state.systemGlobalValues = &owner.m_systemGlobalBank.values();
	state.cop0Words = owner.m_cop0Words.data();
	state.ram = owner.m_memory.ramData();
}

#if defined(BMSX_NATIVE_GATE_PROFILE)
NativeCpuRunState::~NativeCpuRunState() {
	auto& profile = cpu->m_nativeGateProfile;
	auto& jumps = profile.exits[static_cast<size_t>(NativeBlockExit::RegisterJump)];
	jumps.entries += directRegisterJumpResumes;
	jumps.resumes += directRegisterJumpResumes;
	profile.directRegisterJumpResumes += directRegisterJumpResumes;
}
#endif

void NativeCpuRunState::bindRamAliases(const Thread& thread) noexcept {
	if (thread.address == CPU_RESET_BANK_ADDRESS) {
		// The fixed backing is entirely inside the architecturally unmapped interval.
		ramAliases.first = MAIN_RAM_SIZE;
		return;
	}
	auto& aliases = ramAliases;
	aliases.threadOffset = thread.address & RAM_RECORD_WORD_MASK;
	aliases.values = {thread.stackOffset(), thread.stackByteLength()};
	aliases.frames = {thread.boundFrameOffset, thread.boundFrameCapacity * FRAME_CONTROL_BYTES};
	aliases.end = std::max({aliases.threadOffset + static_cast<u32>(THREAD_HEAP_BYTES),
		aliases.values.offset + aliases.values.bytes, aliases.frames.offset + aliases.frames.bytes});
	aliases.first = aliases.end > MAIN_RAM_SIZE ? 0u
		: std::min({aliases.threadOffset, aliases.values.offset, aliases.frames.offset});
}

// Entry from scalar execution. A native-to-native edge already has the
// grant and transfers only the activation state affected by that edge.
void NativeCpuRunState::enterFrame(CallFrame& frame, Blua32ExecutionImage& image, int budget) {
	auto& thread = *frame.thread;
	const auto domain = frame.executionImage->executionDomainId;
	thread.recordNativeWrites(cpu->m_memory.ramWriteWatches());
	frameBank = frameBankWord(domain);
	bindRamAliases(thread);
	closureCallHeader = ClosureRecord::fixedCallHeader(domain);
	nativeStackCapacity = thread.stackCapacity;
	nativeFrameLimit = thread.retainedFrameLimit();
	haltedCallDepth = cpu->m_haltedUntilIrqThreadAddress == thread.address ? cpu->m_haltedUntilIrqFrameDepth : -1;
	cartridgeSlot = cpu->m_memory.cartridgeController().selectedSlot(cpu->m_executionBusSignals);
	codeImage = &image;
	codeRoot = image.nativeCodeLookup->root(cartridgeSlot);
	static_assert(SYSTEM_ROM_BASE == 0u);
	// With aligned destinations, all 32-bit PCs are below UINT32_MAX.
	registerJumpLimit = thread.address == CPU_RESET_BANK_ADDRESS ? SYSTEM_ROM_SIZE : UINT32_MAX;
	state.constants = image.constPool;
	state.frame = &frame;
	state.remainingCycles = budget;
	state.readWindow(frame);
	state.closure = frame.closureAddress();
	state.frameDepth = thread.frameDepth();
	state.exitCode = nativeBlockGate().dispatch;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	state.diagnosticOpcodes = {};
#endif
}

} // namespace bmsx
