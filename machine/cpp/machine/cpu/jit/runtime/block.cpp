#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/jit/sljit/gate.h"
#include "machine/cpu/jit/runtime/execution.h"
#include "machine/cpu/thread.h"

#if defined(BMSX_NATIVE_PERF_MAP)
#include <cstdio>
#include "machine/cpu/jit/runtime/perf_map.h"
#endif

namespace bmsx {

void NativeCodeRegion::synchronizeInstructionStream() const {
#if defined(BMSX_NATIVE_COMPILER_WORKER) && defined(SLJIT_CONFIG_ARM)
	// Emission flushed the worker's instruction stream. Synchronize the
	// executing core before any entry from this allocation becomes reachable.
	auto address = reinterpret_cast<sljit_uw>(m_code);
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
	address &= ~sljit_uw{1}; // SLJIT's executable handle includes the Thumb bit.
#endif
	SLJIT_CACHE_FLUSH(reinterpret_cast<void*>(address), reinterpret_cast<void*>(address + codeBytes));
#endif
}

#if defined(BMSX_NATIVE_PERF_MAP)
void NativeCodeRegion::recordPerfMap(ExecutionDomainId domain, u32 slot, u32 firstPc) const {
	char symbol[96];
	std::snprintf(symbol, sizeof(symbol), "bmsx_native_region_domain%d_slot%u_pc%08x", domain, slot, firstPc);
	auto address = static_cast<std::uintptr_t>(SLJIT_FUNC_ADDR(m_code));
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
	address &= ~std::uintptr_t{1};
#endif
	const NativePerfMapRange range{address, codeBytes, symbol};
	recordNativePerfMap(std::span(&range, 1));
}
#endif

NativeCodeRegion::NativeCodeRegion() = default;

NativeCodeRegion::~NativeCodeRegion() {
	withdrawFromCache();
	if (m_code) sljit_free_code(m_code, nullptr);
}

NativeBlock::~NativeBlock() {
	if (terminal.exit == NativeBlockExit::Continue) terminal.link.disconnect();
	for (auto& exit : sideExits)
		if (exit.exit == NativeBlockExit::Continue) exit.link.disconnect();
	while (m_incoming) m_incoming->disconnect();

}

const NativeBlockExitSite* NativeBlock::run(const ValueSpan& registers, NativeBlockRunState& state) const {
	state.exitCode = m_gate->exit;
	state.ram = region->ram;
	if (state.frame) {
		state.closure = state.frame->closureAddress();
		state.stackOrigin = state.frame->readWindow(FrameField::StackBase);
		state.registerBase = state.frame->registerBase();
	}
	state.windowWidth = static_cast<u32>(registers.size()) + static_cast<u32>(state.registerBase);
	return reinterpret_cast<NativeBlockGate::Entry>(m_gate->entry)(&state, m_body, &registers);
}

void NativeBlock::execute(NativeCpuRunState& state) const {
	reinterpret_cast<NativeBlockGate::Entry>(m_gate->entry)(&state.state, m_body, &state.state.frame->registers);
}

void NativeBlockLink::disconnect() {
	if (!target) return;
	sljit_set_jump_addr(patchAddress, coldEntry, executableOffset);
	if (previous) previous->next = next;
	else target->m_incoming = next;
	if (next) next->previous = previous;
	target = nullptr;
	previous = next = nullptr;
}

void NativeBlock::linkFrom(const NativeBlockExitSite& source) {
	auto& link = source.link;
	link.disconnect();
	sljit_set_jump_addr(link.patchAddress, reinterpret_cast<sljit_uw>(m_body), link.executableOffset);
	link.target = this;
	link.next = m_incoming;
	if (m_incoming) m_incoming->previous = &link;
	m_incoming = &link;
}

} // namespace bmsx
