#include "machine/cpu/cpu.h"

#include "common/endian.h"
#include "machine/cpu/jit/limits.h"
#include "machine/cpu/jit/source.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/jit/worker.h"
#endif
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"

#include <algorithm>
#include <chrono>
#include <map>

namespace bmsx {

void CPU::prepareSystemNativeCode() {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	// An explicit host request is synchronous. Resolve any existing snapshot
	// before selecting missing system roots; cartridge grants never wait.
	if (m_nativeCompilerWorker) {
		m_nativeCompilerWorker->wait();
		publishNativeCompilation();
	}
#endif
	prepareNativeImageCode(*m_systemImage, std::nullopt);
}

void CPU::prepareNativeImageCode(Blua32ExecutionImage& image, std::optional<u32> entryPc) {
	const auto& warmup = image.nativeWarmup;
	if (m_nativeCode.full() || warmup.functionCount == 0u) return;
	const u32 functionCount = std::min(warmup.functionCount, NATIVE_IMAGE_WARMUP_MAX_HINTS);
	const bool system = image.executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID;
	const u32 slot = system ? 0u : static_cast<u32>(image.executionDomainId);
	const auto busSignals = executionBusSignalsForDomain(image.executionDomainId);
	Span<const u8> records;
	if (!m_memory.bindRomByteView(warmup.functionTable,
		static_cast<size_t>(functionCount) * BLUA32_FUNCTION_RECORD_SIZE, slot, records)) return;

	// Limit candidate pages before allocating either the worklist node or its
	// decoded page. Source outside the initial batch retains the hot compiler.
	using Clock = std::chrono::steady_clock;
	const auto discoveryStart = m_nativeCompilationProfiling ? Clock::now() : Clock::time_point{};
	std::map<u64, NativeCompilationSource> pages;
	std::vector<NativeCompilationSource*> pending;
	std::vector<u32> outgoing;
	const auto enqueue = [&](u32 pc) -> NativeCompilationSource* {
		if ((pc & (INSTRUCTION_BYTES - 1u)) != 0u) return nullptr;
		if (system ? m_memory.mappedRegion(pc) != MemoryRegionKind::SystemRom
			: pc < CART_ROM_BASE || pc >= CART_RAM_BASE) return nullptr;
		const u32 pagePc = pc & ~MAPPED_PAGE_BYTE_MASK;
		MappedPageBinding binding;
		m_memory.bindMappedPage(pagePc, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, binding);
		if (!binding.cacheable || !binding.readBytes) return nullptr;
		if (pages.size() == NATIVE_IMAGE_WARMUP_MAX_PAGES && !pages.contains(binding.key)) return nullptr;
		auto& decoded = decodedPageForAddress(image, binding);
		const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		if (decoded.nativeBlocks && decoded.nativeBlocks->entries[word]) return nullptr;
		auto& source = pages.try_emplace(binding.key,
			decoded, binding, pagePc, busSignals, slot).first->second;
		source.enqueue(pc, true, nullptr, true);
		if (!source.discoveryQueued && source.discoveredCount < source.pendingCount) {
			source.discoveryQueued = true;
			pending.push_back(&source);
		}
		return &source;
	};
	auto* entrySource = entryPc ? enqueue(*entryPc) : nullptr;
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
	if (m_nativeCompilationProfiling) {
		const auto elapsed = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now() - discoveryStart).count());
		m_nativeCompilationProfile.discoveryNanoseconds += elapsed;
		m_nativeCompilationProfile.prepareNanoseconds += elapsed;
	}
	if (entrySource) prepareNativeSource(image, *entrySource, true);
	for (auto& [key, source] : pages)
		if (&source != entrySource) prepareNativeSource(image, source, true);
}

} // namespace bmsx
