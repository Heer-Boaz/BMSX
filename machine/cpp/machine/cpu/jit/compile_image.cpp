#include "machine/cpu/cpu.h"

#include "machine/cpu/jit/limits.h"
#include "machine/cpu/jit/source.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/jit/worker.h"
#endif
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"

#include <algorithm>
#include <bit>
#include <chrono>
#include <map>

namespace bmsx {

u32 CPU::prepareNativeFunction(Blua32ExecutionImage& image, const Blua32RomFunctionVersion& version,
	u32 rootPc, MappedBusSignals busSignals, size_t pageBudget, bool coldImage) {
	// Only a bound function in immutable ROM may unite physical pages.
	// Page indexes are entry directories and dependencies, not IR boundaries.
	using Clock = std::chrono::steady_clock;
	const u32 slot = m_memory.cartridgeController().selectedSlot(busSignals);
	if (image.executionDomainId != SYSTEM_EXECUTION_DOMAIN_ID && static_cast<u32>(image.executionDomainId) != slot) return 0u;
	const u32 first = version.entry.codeAddress & ~MAPPED_PAGE_BYTE_MASK;
	const u32 last = (version.endPc - 1u) & ~MAPPED_PAGE_BYTE_MASK;
	const u32 count = (last - first) / MAPPED_PAGE_BYTE_SIZE + 1u;
	if (count <= 1u || count > NATIVE_VERSION_REGION_MAX_PAGES || count > pageBudget || (coldImage && m_nativeCode.full())) return 0;
	const u32 rootPage = (rootPc - first) / MAPPED_PAGE_BYTE_SIZE;
	const auto discoveryStart = m_nativeCompilationProfiling ? Clock::now() : Clock::time_point{};
	std::array<std::optional<NativeCompilationSource>, NATIVE_VERSION_REGION_MAX_PAGES> sources;
	std::array<NativeCompilationSource*, NATIVE_VERSION_REGION_MAX_PAGES> region;
	for (u32 index = 0; index < count; ++index) {
		const u32 address = first + index * MAPPED_PAGE_BYTE_SIZE;
		MappedPageBinding binding;
		m_memory.bindMappedPage(address, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, binding);
		if (!binding.readBytes || binding.writeWatch.groups) return 0;
		auto& page = decodedPageForAddress(image, binding);
		if (index == rootPage && page.nativeBlocks && page.nativeBlocks->entries[(rootPc - address) / INSTRUCTION_BYTES]) return 0u;
		auto& source = sources[index].emplace(page, binding, address, busSignals, slot);
		source.firstPc = version.entry.codeAddress;
		source.lastPc = version.endPc - INSTRUCTION_BYTES;
		region[index] = &source;
	}
	region.front()->enqueue(version.entry.codeAddress, true, nullptr, true);
	region[rootPage]->enqueue(rootPc, true, nullptr, true);
	std::vector<u32> outgoing;
	u32 ready = 1u | (1u << rootPage);
	while (ready) {
		const u32 index = static_cast<u32>(std::countr_zero(ready));
		ready &= ready - 1u;
		outgoing.clear();
		discoverNativeSource(image, *region[index], &outgoing);
		for (const u32 pc : outgoing) {
			const u32 target = (pc - first) / MAPPED_PAGE_BYTE_SIZE;
			auto& source = *region[target];
			source.enqueue(pc, true);
			if (source.discoveredCount < source.pendingCount) ready |= 1u << target;
		}
	}
	if (m_nativeCompilationProfiling) {
		const auto elapsed = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(
			Clock::now() - discoveryStart).count());
		m_nativeCompilationProfile.discoveryNanoseconds += elapsed;
		m_nativeCompilationProfile.prepareNanoseconds += elapsed;
	}
	prepareNativeSources(image, std::span(region).first(count), coldImage);
	return count;
}

void CPU::prepareSystemNativeCode() {
	if (m_unpublishedRomMask & SYSTEM_EXECUTION_DOMAIN_MASK)
		throw BMSX_RUNTIME_ERROR("Installed system ROM must be published before native preparation.");
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
	const auto& functions = image.romFunctions;
	if (m_nativeCode.full() || functions.versions.empty()) return;
	const auto versions = std::span(functions.versions).first(std::min<size_t>(functions.versions.size(), NATIVE_IMAGE_WARMUP_MAX_HINTS));
	const bool system = image.executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID;
	const u32 slot = system ? 0u : static_cast<u32>(image.executionDomainId);
	const auto busSignals = executionBusSignalsForDomain(image.executionDomainId);

	// Limit candidate pages before allocating either the worklist node or its
	// decoded page. Source outside the initial batch retains the hot compiler.
	using Clock = std::chrono::steady_clock;
	std::map<u64, NativeCompilationSource> pages;
	std::vector<NativeCompilationSource*> pending;
	std::vector<u32> outgoing;
	size_t pageBudget = NATIVE_IMAGE_WARMUP_MAX_PAGES;
	for (const auto& version : versions)
		pageBudget -= prepareNativeFunction(image, version, version.entry.codeAddress, busSignals, pageBudget, true);
	const auto discoveryStart = m_nativeCompilationProfiling ? Clock::now() : Clock::time_point{};
	const auto enqueue = [&](u32 pc) -> NativeCompilationSource* {
		if ((pc & (INSTRUCTION_BYTES - 1u)) != 0u) return nullptr;
		if (system ? m_memory.mappedRegion(pc) != MemoryRegionKind::SystemRom
			: pc < CART_ROM_BASE || pc >= CART_RAM_BASE) return nullptr;
		const u32 pagePc = pc & ~MAPPED_PAGE_BYTE_MASK;
		MappedPageBinding binding;
		m_memory.bindMappedPage(pagePc, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, binding);
		if (!binding.cacheable || !binding.readBytes) return nullptr;
		if (pages.size() == pageBudget && !pages.contains(binding.key)) return nullptr;
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
	for (const auto& version : versions) enqueue(version.entry.codeAddress);

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
	if (entrySource) prepareNativeSources(image, std::span(&entrySource, 1), true);
	for (auto& [key, source] : pages)
		if (&source != entrySource) {
			NativeCompilationSource* page = &source;
			prepareNativeSources(image, std::span(&page, 1), true);
		}
}

} // namespace bmsx
