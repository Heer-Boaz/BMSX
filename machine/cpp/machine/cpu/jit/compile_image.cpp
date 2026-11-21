#include "machine/cpu/cpu.h"

#include "common/endian.h"
#include "machine/cpu/jit/source.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/jit/worker.h"
#endif
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"

#include <map>

namespace bmsx {

void CPU::prepareSystemNativeCode() {
	prepareNativeImageCode(*m_systemImage);
}

void CPU::prepareNativeImageCode(Blua32ExecutionImage& image) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (m_nativeCompilerWorker) {
		m_nativeCompilerWorker->wait();
		publishNativeCompilation();
	}
#endif
	const bool system = image.executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID;
	const u32 slot = system ? 0u : static_cast<u32>(image.executionDomainId);
	const auto busSignals = executionBusSignalsForDomain(image.executionDomainId);
	const u32 functionCount = image.nativeFunctionCount;
	if (functionCount == 0u) return;
	Span<const u8> records;
	if (!m_memory.bindRomByteView(image.nativeFunctionTable,
		static_cast<size_t>(functionCount) * BLUA32_FUNCTION_RECORD_SIZE, slot, records)) return;

	// These records are cold compilation hints, never fetch bounds. Only backed
	// immutable ROM pages of this image enter this worklist. Instructions elsewhere keep
	// their ordinary execution-time decoding and exception boundaries.
	std::map<u64, NativeCompilationSource> pages;
	std::vector<NativeCompilationSource*> pending;
	std::vector<u32> outgoing;
	const auto enqueue = [&](u32 pc) {
		if ((pc & (INSTRUCTION_BYTES - 1u)) != 0u) return;
		if (system ? m_memory.mappedRegion(pc) != MemoryRegionKind::SystemRom
			: pc < CART_ROM_BASE || pc >= CART_RAM_BASE) return;
		const u32 pagePc = pc & ~MAPPED_PAGE_BYTE_MASK;
		MappedPageBinding binding;
		m_memory.bindMappedPage(pagePc, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, binding);
		if (!binding.cacheable || !binding.readBytes) return;
		auto& decoded = decodedPageForAddress(image, binding);
		const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		if (decoded.nativeBlocks && decoded.nativeBlocks->entries[word]) return;
		auto& source = pages.try_emplace(binding.key,
			decoded, binding, pagePc, busSignals, slot).first->second;
		source.enqueue(pc, true, nullptr, true);
		if (!source.discoveryQueued && source.discoveredCount < source.pendingCount) {
			source.discoveryQueued = true;
			pending.push_back(&source);
		}
	};
	for (u32 function = 0; function < functionCount; ++function)
		enqueue(readLE32(records.data() + static_cast<size_t>(function) * BLUA32_FUNCTION_RECORD_SIZE
			+ BLUA32_FUNCTION_CODE_ADDRESS_OFFSET));

	// Discover before emitting so all incoming function and cross-page roots
	// split one shared physical-page graph instead of compiling duplicate suffixes.
	for (size_t index = 0; index < pending.size(); ++index) {
		auto& source = *pending[index];
		source.discoveryQueued = false;
		outgoing.clear();
		discoverNativeSource(image, source, &outgoing);
		for (const u32 pc : outgoing) enqueue(pc);
	}
	for (auto& [key, source] : pages) prepareNativeSource(image, source, true);
}

} // namespace bmsx
