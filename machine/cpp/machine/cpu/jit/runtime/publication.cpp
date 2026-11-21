#include "machine/cpu/cpu.h"

#include <algorithm>
#include <utility>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/compiler.h"
#include "machine/memory/memory.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/runtime/record_constructor.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/jit/worker.h"
#endif

namespace bmsx {

NativeCodeBindings::NativeCodeBindings(Memory& memory, StringPool& pool, CPU* cpu, DecodedInstruction* decodedPage)
	: ramBytes(memory.ramByteCount()), ram(memory.ramData()), ramBusEnd(memory.ramBusEndAddress()),
	  ramWriteGroups(memory.ramWriteWatches().groupData()),
	  ramCodeWatchWords(memory.ramWriteWatches().codeWordMasks()),
	  memory(&memory), strings(&pool), cpu(cpu), decodedPage(decodedPage) {}

NativeBlockPage::~NativeBlockPage() {
	// Images can disappear without individual source invalidation. The
	// region may still be borrowed by an inspector, but is no longer resident.
	for (const auto& block : entries)
		if (block) block->region->withdrawFromCache();
}

void DecodedInstructionPage::retireNativeRegion(const NativeCodeRegion* region, Retirement reason) {
	std::shared_ptr<NativeCodeRegion> retiring;
	for (u32 entry = 0; entry < DECODED_PAGE_WORDS; ++entry) {
		auto& block = nativeBlocks->entries[entry];
		if (!block || block->region.get() != region) continue;
		if (!retiring) retiring = block->region;
		nativeCode[entry] = nullptr;
		block.reset();
		--nativeBlocks->count;
		auto& instruction = words[entry];
		instruction.dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeWarm);
		nativeVisits[entry] = reason == Retirement::Feedback ? NATIVE_BLOCK_COMPILATION_THRESHOLD : 0u;
	}
	retiring->withdrawFromCache();
	if (nativeBlocks->count == 0u) {
		nativeBlocks.reset();
	}
}

void DecodedInstructionPage::retireNativeBlocks(u32 firstWord, u32 endWord, Retirement reason) {
	if (!nativeBlocks) return;
	const u32 firstEntry = firstWord > 2u * (NATIVE_BLOCK_MAX_INSTRUCTIONS + 1u)
		? firstWord - 2u * (NATIVE_BLOCK_MAX_INSTRUCTIONS + 1u) : 0u;
	const u32 endEntry = endWord < DECODED_PAGE_WORDS ? endWord : DECODED_PAGE_WORDS;
	for (u32 word = firstEntry; word < endEntry; ++word) {
		const auto& block = nativeBlocks->entries[word];
		if (!block || word + block->sourceWords <= firstWord) continue;
		retireNativeRegion(block->region.get(), reason);
		if (!nativeBlocks) return;
	}
}

void CPU::retireNativeInstructionUsers(DecodedInstructionPage& page, u32 word) {
	// This operation is reached outside generated code. Withdraw all source
	// users (including an independently published suffix) and preserve the
	// feedback for the next compilation.
	page.retireNativeBlocks(word, word + 1u, DecodedInstructionPage::Retirement::Feedback);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (m_pendingNativeCompilation.page == &page) m_pendingNativeCompilation.invalidated = true;
#endif
}

#if defined(BMSX_NATIVE_COMPILER_WORKER)
void CPU::publishNativeCompilation() {
	if (!m_nativeCompilerWorker || !m_nativeCompilerWorker->ready()) return;
	auto blocks = m_nativeCompilerWorker->take();
	auto& job = m_pendingNativeCompilation;
	if (m_nativeCompilationProfiling) {
		++m_nativeCompilationProfile.backgroundCompleted;
		m_nativeCompilationProfile.backgroundNanoseconds += m_nativeCompilerWorker->compilationNanoseconds();
		m_nativeCompilationProfile.backgroundCancelled += job.invalidated;
	}
	if (job.invalidated) return;
	auto& page = *job.page;
	installNativeRegion(*job.image, page, job.pagePc, job.slot, std::move(blocks), NativeCodeAdmission::Adaptive);
}

void CPU::discardNativeCompilation() {
	if (!m_nativeCompilerWorker || m_nativeCompilerWorker->idle()) return;
	m_nativeCompilerWorker->wait();
	// Retire unpublished code and surface compiler errors on the owning thread.
	m_nativeCompilerWorker->take();
	if (m_nativeCompilationProfiling) {
		++m_nativeCompilationProfile.backgroundCompleted;
		++m_nativeCompilationProfile.backgroundCancelled;
		m_nativeCompilationProfile.backgroundNanoseconds += m_nativeCompilerWorker->compilationNanoseconds();
	}
}
#endif

void CPU::installNativeRegion(Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pagePc, u32 slot,
	std::vector<std::unique_ptr<NativeBlock>> blocks, NativeCodeAdmission admission) {
	// This is the only publication boundary for either compilation policy.
	// All source retirement and emitted-code ownership transfers run on the CPU.
	auto& region = *blocks.front()->region;
	if (!m_nativeCode.tryInstall(region, page, admission, m_nativeCompilationProfiling ? &m_nativeCompilationProfile : nullptr)) return;
	if (!page.nativeBlocks) page.nativeBlocks = std::make_unique<NativeBlockPage>();
	auto& lookup = image.nativeCodeLookup;
	if (!lookup) lookup = std::make_unique<NativeCodeLookup>();
	page.nativeCode = lookup->install(pagePc, slot, page);
	// Cartridge execution images pin instruction fetch to their physical bank.
	// Only system code needs cells for both selectable cartridge mappings.
	const u32 firstBank = image.executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID ? 0u : slot;
	const u32 endBank = image.executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID ? CARTRIDGE_SLOT_COUNT : slot + 1u;
#if defined(BMSX_NATIVE_PERF_MAP)
	blocks.front()->region->recordPerfMap(image.executionDomainId, slot, blocks.front()->firstPc);
#endif
	for (auto& block : blocks) {
		const u32 entry = (block->firstPc - pagePc) / INSTRUCTION_BYTES;
		auto& exit = block->terminal;
		if (exit.exit == NativeBlockExit::AllocateTable && exit.recordConstructor) {
			auto& recipe = *exit.recordConstructor;
			for (u32 bank = firstBank; bank < endBank; ++bank)
				recipe.continuation[bank] = lookup->entrySlot(recipe.nextPc, bank);
		}
		if (exit.exit == NativeBlockExit::Call || nativeBlockExitResumesFrame(exit.exit)) {
			for (u32 bank = firstBank; bank < endBank; ++bank)
				exit.continuationCells[bank] = lookup->entrySlot(exit.nextPc, bank);
		}
		for (auto& side : block->sideExits) {
			if (side.exit == NativeBlockExit::Call || nativeBlockExitResumesFrame(side.exit)) {
				for (u32 bank = firstBank; bank < endBank; ++bank)
					side.continuationCells[bank] = lookup->entrySlot(side.nextPc, bank);
			}
		}
		page.nativeBlocks->entries[entry] = std::move(block);
		page.nativeCode[entry] = page.nativeBlocks->entries[entry]->m_body;
		++page.nativeBlocks->count;
		page.words[entry].dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeBlock);
		page.refreshState[entry] &= static_cast<u8>(~DECODED_REFRESH_FUSION);
	}
	if (m_nativeCompilationProfiling) {
		auto& profile = m_nativeCompilationProfile;
		++profile.regionsPublished;
		profile.entriesPublished += blocks.size();
		profile.sourceInstructions += region.sourceInstructions;
		profile.emittedCodeBytes += region.codeBytes;
		profile.peakCodeBytes = std::max(profile.peakCodeBytes, static_cast<u64>(m_nativeCode.codeBytes()));
	}
}

void CPU::clearNativeContinuationBindings() {
	// Include suspended coroutines, exception activations and pooled nodes;
	// clearing only the running resumer chain would leave borrowed entry cells.
	visitThreadViews([](Thread& thread) {
		for (auto* frame = thread.firstFrame; frame; frame = frame->next)
			frame->nativeContinuationCells = {};
	});
}

} // namespace bmsx
