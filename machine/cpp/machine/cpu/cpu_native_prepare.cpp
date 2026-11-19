#include "machine/cpu/cpu.h"

#include "common/endian.h"
#include "machine/cpu/native_compilation_source.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/native_compiler_worker.h"
#endif
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"

#include <map>

namespace bmsx {

void CPU::prepareSystemNativeCode() {
	prepareNativeImageCode(*m_systemImage, m_executionAddressSpace.resolveSystemDomain());
}

void CPU::prepareNativeImageCode(Blua32ExecutionImage& image, const Blua32ExecutionBoot& boot) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (m_nativeCompilerWorker) {
		m_nativeCompilerWorker->wait();
		publishNativeCompilation();
	}
#endif
	const bool system = image.executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID;
	const u32 slot = system ? 0u : static_cast<u32>(image.executionDomainId);
	const auto busSignals = executionBusSignalsForDomain(image.executionDomainId);
	Span<const u8> header;
	m_executionAddressSpace.bindReadOnlyView(image.executionDomainId,
		boot.imageAddress, BLUA32_IMAGE_HEADER_SIZE, header);
	const u32 functionTable = readLE32(header.data() + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET);
	const u32 functionCount = readLE32(header.data() + BLUA32_IMAGE_FUNCTION_COUNT_OFFSET);
	if (functionCount == 0u) return;
	Span<const u8> records;
	if (!m_memory.bindRomByteView(functionTable,
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
			image, decoded, binding, pagePc, busSignals, slot).first->second;
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
		discoverNativeSource(source, &outgoing);
		for (const u32 pc : outgoing) enqueue(pc);
	}
	for (auto& [key, source] : pages) prepareNativeSource(source, true, false);
}

} // namespace bmsx
