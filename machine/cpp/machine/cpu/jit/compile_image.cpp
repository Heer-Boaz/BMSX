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
#include <array>
#include <bit>
#include <chrono>
#include <map>

namespace bmsx {

namespace {
u32 functionPageCount(const Blua32RomFunctionVersion& version) {
	return ((version.endPc - 1u) >> MAPPED_PAGE_BYTE_SHIFT) - (version.entry.codeAddress >> MAPPED_PAGE_BYTE_SHIFT) + 1u;
}
} // namespace

bool CPU::prepareNativeFunction(Blua32ExecutionImage& image, const Blua32RomFunctionVersion& version,
	u32 rootPc, MappedBusSignals busSignals, NativeWarmupAdmission* warmup) {
	// Only a bound function in immutable ROM may unite physical pages.
	// Page indexes are entry directories and dependencies, not IR boundaries.
	using Clock = std::chrono::steady_clock;
	const u32 slot = m_memory.cartridgeController().selectedSlot(busSignals);
	if (image.executionDomainId != SYSTEM_EXECUTION_DOMAIN_ID && static_cast<u32>(image.executionDomainId) != slot) return false;
	const auto& functions = image.romFunctions;
	const bool verified = !functions.mappedCode;
	const u32 bodyFirst = version.entry.codeAddress & ~MAPPED_PAGE_BYTE_MASK;
	const u32 bodyLast = (version.endPc - 1u) & ~MAPPED_PAGE_BYTE_MASK;
	const u32 bodyPages = functionPageCount(version);
	constexpr u32 limit = NATIVE_VERSION_REGION_MAX_PAGES;
	if (warmup && m_nativeCode.full()) return false;
	// Keep the amortized per-page cold batch for small functions and cold
	// demand for long bodies. The adaptive compiler alone can request a
	// clipped window when the whole verified function exceeds the limit.
	if ((!verified || warmup) && (bodyPages <= 1u || bodyPages > limit)) return false;
	const u32 first = bodyPages <= limit ? bodyFirst : rootPc & ~MAPPED_PAGE_BYTE_MASK;
	const u32 count = std::min(limit, (bodyLast - first) / MAPPED_PAGE_BYTE_SIZE + 1u);
	const u32 firstPc = std::max(first, version.entry.codeAddress);
	u32 endPc = std::min(version.endPc, first + count * MAPPED_PAGE_BYTE_SIZE);
	// The body word of a WIDE is not a new entry. Stop before the prefix
	// when the cap splits its encoding; a later request at the prefix
	// starts a window in which both words fit.
	if (endPc < version.endPc && !functions.instructionHead(endPc)) endPc -= INSTRUCTION_BYTES;
	const u32 rootPage = (rootPc - first) / MAPPED_PAGE_BYTE_SIZE;
	const auto discoveryStart = m_nativeCompilationProfiling ? Clock::now() : Clock::time_point{};
	std::array<std::optional<NativeCompilationSource>, NATIVE_VERSION_REGION_MAX_PAGES> sources;
	std::array<NativeCompilationSource*, NATIVE_VERSION_REGION_MAX_PAGES> region;
	auto* requested = warmup ? &warmup->requested : nullptr;
	const auto bindSource = [&](u32 index) -> NativeCompilationSource* {
		auto& source = sources[index];
		if (!source) {
			const u32 address = first + index * MAPPED_PAGE_BYTE_SIZE;
			MappedPageBinding binding;
			m_memory.bindMappedPage(address, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, binding);
			if (!binding.cacheable || binding.writeWatch.groups || (!verified && !binding.readBytes)) return nullptr;
			if (requested && !requested->include(address)) return nullptr;
			auto& page = decodedPageForAddress(image, binding);
			source.emplace(page, binding, address, busSignals, slot, verified);
			source->firstPc = firstPc;
			source->lastPc = endPc - INSTRUCTION_BYTES;
		}
		return &*source;
	};
	// Mapped ROM hints still require a fully backed immutable span.
	if (!verified) for (u32 index = 0; index < count; ++index)
		if (!bindSource(index)) return false;
	auto* root = bindSource(rootPage);
	if (!root || (root->page.nativeBlocks
		&& root->page.nativeBlocks->entries[(rootPc - root->pagePc) / INSTRUCTION_BYTES])) return false;
	root->enqueue(rootPc, true, nullptr, true);
	u32 ready = 1u << rootPage;
	if (version.entry.codeAddress >= firstPc) {
		if (auto* entry = bindSource(0)) {
			entry->enqueue(version.entry.codeAddress, true, nullptr, true);
			ready |= 1u;
		}
	}
	std::vector<u32> outgoing;
	while (ready) {
		const u32 index = static_cast<u32>(std::countr_zero(ready));
		ready &= ready - 1u;
		outgoing.clear();
		discoverNativeSource(image, *sources[index], &outgoing, requested);
		for (const u32 pc : outgoing) {
			const u32 target = (pc - first) / MAPPED_PAGE_BYTE_SIZE;
			if (auto* source = bindSource(target)) {
				source->enqueue(pc, true);
				if (source->discoveredCount < source->pendingCount) ready |= 1u << target;
			}
		}
	}
	size_t sourceCount = 0;
	for (u32 index = 0; index < count; ++index)
		if (sources[index]) region[sourceCount++] = &*sources[index];
	if (m_nativeCompilationProfiling) {
		const auto elapsed = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(
			Clock::now() - discoveryStart).count());
		m_nativeCompilationProfile.discoveryNanoseconds += elapsed;
		m_nativeCompilationProfile.prepareNanoseconds += elapsed;
	}
	prepareNativeSources(image, std::span(region).first(sourceCount), warmup ? &warmup->published : nullptr);
	return true;
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
	const auto* startup = m_systemImage->romFunctions.find(m_executionAddressSpace.resolveSystemDomain().startupFunctionAddress);
	prepareNativeImageCode(*m_systemImage, startup ? std::optional{startup->entry.codeAddress} : std::nullopt);
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
	std::array<NativeCompilationSource*, NATIVE_IMAGE_WARMUP_MAX_PAGES> publicationOrder;
	size_t publicationCount = 0, discovered = 0;
	std::vector<NativeCompilationSource*> pending;
	std::vector<u32> outgoing;
	NativeWarmupAdmission warmup;
	// A real activation outranks every descriptive root. Its bounded body can
	// use one cross-page region; short roots keep the shared page batch below.
	if (entryPc) {
		if (const auto* entry = functions.atPc(*entryPc))
			prepareNativeFunction(image, *entry, *entryPc, busSignals, &warmup);
	}
	const auto discoveryStart = m_nativeCompilationProfiling ? Clock::now() : Clock::time_point{};
	const auto enqueue = [&](u32 pc) -> NativeCompilationSource* {
		if ((pc & (INSTRUCTION_BYTES - 1u)) != 0u
			|| (!functions.mappedCode && !functions.instructionHead(pc))) return nullptr;
		if (system ? m_memory.mappedRegion(pc) != MemoryRegionKind::SystemRom
			: pc < CART_ROM_BASE || pc >= CART_RAM_BASE) return nullptr;
		const u32 pagePc = pc & ~MAPPED_PAGE_BYTE_MASK;
		MappedPageBinding binding;
		m_memory.bindMappedPage(pagePc, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, binding);
		if (!binding.cacheable || (functions.mappedCode && !binding.readBytes)) return nullptr;
		if (!warmup.requested.include(pagePc)) return nullptr;
		auto& decoded = decodedPageForAddress(image, binding);
		const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		if (decoded.nativeBlocks && decoded.nativeBlocks->entries[word]) return nullptr;
		const auto [entry, added] = pages.try_emplace(binding.key,
			decoded, binding, pagePc, busSignals, slot, !functions.mappedCode);
		auto& source = entry->second;
		if (added) publicationOrder[publicationCount++] = &source;
		source.enqueue(pc, true, nullptr, true);
		if (!source.discoveryQueued && source.discoveredCount < source.pendingCount) {
			source.discoveryQueued = true;
			pending.push_back(&source);
		}
		return &source;
	};
	const auto discover = [&] {
		for (; discovered < pending.size(); ++discovered) {
			auto& source = *pending[discovered];
			source.discoveryQueued = false;
			outgoing.clear();
			discoverNativeSource(image, source, &outgoing, &warmup.requested);
			for (const u32 pc : outgoing) enqueue(pc);
		}
	};
	if (entryPc) {
		enqueue(*entryPc);
		// Reserve the actual entry graph before optional directory roots can
		// spend its page budget. Both phases still share the page sources.
		discover();
	}
	for (const auto& version : versions) {
		const u32 count = functionPageCount(version);
		if (count == 1u || count > NATIVE_VERSION_REGION_MAX_PAGES) enqueue(version.entry.codeAddress);
	}

	// Discover before emitting so all incoming function and cross-page roots
	// split one shared physical-page graph instead of compiling duplicate suffixes.
	discover();
	if (m_nativeCompilationProfiling) {
		const auto elapsed = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now() - discoveryStart).count());
		m_nativeCompilationProfile.discoveryNanoseconds += elapsed;
		m_nativeCompilationProfile.prepareNanoseconds += elapsed;
	}
	for (size_t index = 0; index < publicationCount; ++index)
		prepareNativeSources(image, std::span(publicationOrder).subspan(index, 1), &warmup.published);
	for (const auto& version : versions)
		prepareNativeFunction(image, version, version.entry.codeAddress, busSignals, &warmup);
}

} // namespace bmsx
