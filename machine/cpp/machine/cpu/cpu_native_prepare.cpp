#include "machine/cpu/cpu.h"

#include "common/endian.h"
#include "machine/cpu/native_compilation_source.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/native_compiler_worker.h"
#endif
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"

#include <map>

namespace bmsx {

void CPU::prepareSystemNativeCode() {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (m_nativeCompilerWorker) {
		m_nativeCompilerWorker->wait();
		publishNativeCompilation();
	}
#endif
	const auto boot = m_executionAddressSpace.resolveSystemDomain();
	Span<const u8> header;
	m_executionAddressSpace.bindReadOnlyView(SYSTEM_EXECUTION_DOMAIN_ID,
		boot.imageAddress, BLUA32_IMAGE_HEADER_SIZE, header);
	const u32 functionTable = readLE32(header.data() + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET);
	const u32 functionCount = readLE32(header.data() + BLUA32_IMAGE_FUNCTION_COUNT_OFFSET);
	if (functionCount == 0u) return;
	Span<const u8> records;
	if (!m_memory.bindRomByteView(functionTable,
		static_cast<size_t>(functionCount) * BLUA32_FUNCTION_RECORD_SIZE, 0u, records)) return;

	// These records are cold compilation hints, never fetch bounds. Only backed
	// immutable system-ROM pages enter this worklist. Instructions elsewhere keep
	// their ordinary execution-time decoding and exception boundaries.
	std::map<u64, NativeCompilationSource> pages;
	std::vector<NativeCompilationSource*> pending;
	std::vector<u32> outgoing;
	const auto enqueue = [&](u32 pc) {
		if ((pc & (INSTRUCTION_BYTES - 1u)) != 0u
			|| m_memory.mappedRegion(pc) != MemoryRegionKind::SystemRom) return;
		const u32 pagePc = pc & ~MAPPED_PAGE_BYTE_MASK;
		MappedPageBinding binding;
		m_memory.bindMappedPage(pagePc, MAPPED_BUS_MASTER_CPU, binding);
		if (!binding.cacheable || !binding.readBytes) return;
		auto& decoded = decodedPageForAddress(*m_systemImage, binding);
		const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		if (decoded.nativeBlocks && decoded.nativeBlocks->entries[word]) return;
		auto& source = pages.try_emplace(binding.key,
			*m_systemImage, decoded, binding, pagePc, MAPPED_BUS_MASTER_CPU, 0u).first->second;
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
