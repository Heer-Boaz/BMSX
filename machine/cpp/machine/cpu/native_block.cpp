#include "machine/cpu/native_block.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_execution.h"
#include "machine/cpu/native_lowering.h"
#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_liveness.h"
#include "machine/cpu/native_table_constructor.h"

#if defined(BMSX_NATIVE_PERF_MAP)
#include <cstdio>
#include "machine/cpu/native_perf_map.h"
#endif

#include "machine/memory/memory.h"

namespace bmsx {

NativeCodeBindings::NativeCodeBindings(Memory& memory, StringPool& pool, StringId indexKey, CPU* cpu)
	: ramBytes(memory.ramByteCount()), ram(memory.ramData()), ramBusEnd(memory.ramBusEndAddress()),
	  ramWriteGroups(memory.ramWriteWatches().groupData()),
	  ramCodeWatchWords(memory.ramWriteWatches().codeWordMasks()),
	  cartridgeSelection(&memory.cartridgeController().selectionWord()),
	  cartridgeRom{memory.cartridgeController().romStorage(0), memory.cartridgeController().romStorage(1)},
	  systemRom(&memory.systemRomStorage()), strings(&pool), indexKey(indexKey), cpu(cpu) {}

void NativeCodeRegion::publish(size_t& cacheBytes) {
#if defined(BMSX_NATIVE_COMPILER_WORKER) && defined(SLJIT_CONFIG_ARM)
	// Emission flushed the worker's instruction stream. Synchronize the
	// executing core before any entry from this allocation becomes reachable.
	auto address = reinterpret_cast<sljit_uw>(m_code);
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
	address &= ~sljit_uw{1}; // SLJIT's executable handle includes the Thumb bit.
#endif
	SLJIT_CACHE_FLUSH(reinterpret_cast<void*>(address), reinterpret_cast<void*>(address + codeBytes));
#endif
	m_cacheBytes = &cacheBytes;
	cacheBytes += codeBytes;
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

std::vector<std::unique_ptr<NativeBlock>> NativeBlock::compileRegion(
	std::span<const NativeBlockSource> sources, ConstValueSpan constants,
	const NativeCodeBindings& bindings, const NativeBlockExitHandlers& exitHandlers, NativeCompilationTier tier
) {
	NativeIrRegion ir(sources, exitHandlers, constants, bindings.cpu != nullptr, tier);
	if (ir.entries.empty()) return {};
	auto region = std::make_shared<NativeCodeRegion>();
	region->ram = bindings.ram;
	region->sourceInstructions = static_cast<u32>(ir.instructionCount());
	const auto& gate = nativeBlockGate();
	for (auto& block : ir.entries) {
		block->region = region;
		block->m_gate = &gate;
	}
	NativeRegisterUses uses;
	ir.optimize(constants, uses);
	NativeLowering compiler(constants, ir.entries, bindings, ir.blocks(), uses);
	for (size_t index = 0; index < ir.blocks().size(); ++index) {
		compiler.beginBlock(index);
		for (const auto& instruction : ir.blocks()[index].instructions)
			compiler.lower(instruction);
		compiler.endBlock();
	}
	region->m_code = compiler.finish(region->codeBytes, region->m_replaySites);
	return std::move(ir.entries);
}

NativeCodeRegion::~NativeCodeRegion() {
	if (m_code) sljit_free_code(m_code, nullptr);
	if (m_cacheBytes) *m_cacheBytes -= codeBytes;
}

NativeBlock::~NativeBlock() {
	if (terminal.exit == NativeBlockExit::Continue) terminal.link.disconnect();
	else if (terminal.exit == NativeBlockExit::AllocateTable) delete terminal.recordConstructor;
	for (auto& exit : sideExits)
		if (exit.exit == NativeBlockExit::Continue) exit.link.disconnect();
	while (m_incoming) m_incoming->disconnect();

}

const NativeBlockExitSite* NativeBlock::run(const ValueSpan& registers, NativeBlockRunState& state) const {
	state.exitCode = m_gate->exit;
	state.ram = region->ram;
	return reinterpret_cast<NativeBlockGate::Entry>(m_gate->entry)(&state, m_body, &registers);
}

void NativeBlock::execute(NativeCpuRunState& state) const {
	state.state.exitCode = m_gate->dispatch;
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
	sljit_set_jump_addr(link.patchAddress, reinterpret_cast<sljit_uw>(m_linkEntry), link.executableOffset);
	link.target = this;
	link.next = m_incoming;
	if (m_incoming) m_incoming->previous = &link;
	m_incoming = &link;
}

} // namespace bmsx
