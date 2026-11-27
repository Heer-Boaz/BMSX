#include "machine/cpu/cpu.h"

#include <algorithm>
#include <utility>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/compiler.h"
#include "machine/cpu/jit/source_policy.h"
#include "machine/memory/memory.h"
#include "machine/cpu/jit/runtime/block.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/jit/worker.h"
#endif

namespace bmsx {

NativeCodeBindings::NativeCodeBindings(Memory& memory, StringPool& pool, CPU* cpu,
	std::span<const NativeCodeSourcePage> sourcePages, bool historyWriteWatches)
	: ramBytes(memory.ramByteCount()), ram(memory.ramData()), ramBusEnd(memory.ramBusEndAddress()),
	  ramWriteGroups(memory.ramWriteWatches().groupData()),
	  ramCodeWatchWords(memory.ramWriteWatches().codeWordMasks()),
	  systemRom(&memory.systemRomStorage()),
	  cartridgeRom(&memory.cartridgeController().cpuRomStorage()),
	  strings(&pool), cpu(cpu), sourcePages(sourcePages), historyWriteWatches(historyWriteWatches) {}

void CPU::synchronizeNativeHistoryWrites() {
	const bool armed = m_memory.ramWriteWatches().historyWritesArmed();
	if (armed == m_nativeHistoryWrites) return;
	// History arms/disarms outside CPU execution. Re-arming pages at a
	// checkpoint changes their epoch, not the session's compilation mode.
	// Withdraw every entry cell before another grant can enter native code.
	m_nativeCode.clear();
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	m_pendingNativeCompilation.invalidated = true;
#endif
	m_nativeHistoryWrites = armed;
}

NativeBlockPage::~NativeBlockPage() {
	// Images can disappear without individual source invalidation. The
	// region may still be borrowed by an inspector, but is no longer resident.
	if (!count) return;
	occupied.forEach([&](u32 word) { entries[word]->region->withdrawFromCache(); });
}

void DecodedInstructionPage::publishNativeEntry(size_t regionPage, u32 word, std::unique_ptr<NativeBlock> block) {
	static_assert(DECODED_PAGE_WORDS <= UINT16_MAX);
	if (!nativeBlocks) nativeBlocks = std::make_unique<NativeBlockPage>();
	auto& head = block->region->m_pageEntries[regionPage];
	block->m_nextPageEntry = head;
	head = static_cast<u16>(word + 1u);
	nativeCode[word] = block->m_body;
	nativeBlocks->entries[word] = std::move(block);
	nativeBlocks->occupied.set(word);
	++nativeBlocks->count;
	words[word].dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeBlock);
	refreshState[word] &= static_cast<u8>(~DECODED_REFRESH_FUSION);
}

void NativeCodeRegion::retire(NativeRetirement reason) {
	std::shared_ptr<NativeCodeRegion> retiring;
	for (u32 index = 0; index < m_pageCount; ++index) {
		u16 member = std::exchange(m_pageEntries[index], 0u);
		if (!member) continue;
		auto* page = m_pages[index];
		while (member) {
			const u32 entry = member - 1u;
			auto& block = page->nativeBlocks->entries[entry];
			member = block->m_nextPageEntry;
			if (!retiring) retiring = block->region;
			page->nativeCode[entry] = nullptr;
			block.reset();
			page->nativeBlocks->occupied.reset(entry);
			--page->nativeBlocks->count;
			page->words[entry].dispatchOp = nativeWarmDispatch(page->words[entry], page->privateFirmware);
			page->nativeVisits[entry] = reason == NativeRetirement::Feedback ? NATIVE_BLOCK_COMPILATION_THRESHOLD : 0u;
		}
		if (page->nativeBlocks->count == 0u) page->nativeBlocks.reset();
	}
	retiring->withdrawFromCache();
}

void DecodedInstructionPage::retireNativeBlocks(u32 firstWord, u32 endWord, NativeRetirement reason) {
	if (!nativeBlocks) return;
	const u32 firstEntry = firstWord > 2u * (NATIVE_BLOCK_MAX_INSTRUCTIONS + 1u)
		? firstWord - 2u * (NATIVE_BLOCK_MAX_INSTRUCTIONS + 1u) : 0u;
	const u32 endEntry = endWord < DECODED_PAGE_WORDS ? endWord : DECODED_PAGE_WORDS;
	for (u32 word = nativeBlocks->occupied.next(firstEntry, endEntry); word < endEntry;
		word = nativeBlocks->occupied.next(word + 1u, endEntry)) {
		const auto& block = nativeBlocks->entries[word];
		if (word + block->sourceWords <= firstWord) continue;
		block->region->retire(reason);
		if (!nativeBlocks) return;
	}
}

void CPU::retireNativeInstructionUsers(DecodedInstructionPage& page, u32 word) {
	// This operation is reached outside generated code. Withdraw all source
	// users (including an independently published suffix) and preserve the
	// feedback for the next compilation.
	page.retireNativeBlocks(word, word + 1u, NativeRetirement::Feedback);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	auto& pending = m_pendingNativeCompilation;
	const auto sources = pending.sources();
	const auto source = std::ranges::find(sources, &page, &NativeCodeSourcePage::page);
	if (source != sources.end() && pending.feedbackHeads[source - sources.begin()][word]) pending.invalidated = true;
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
	if (!job.invalidated && !blocks.empty())
		installNativeRegion(*job.image, job.sources(), job.slot, std::move(blocks), NativeCodeAdmission::Adaptive);
	job.pageCount = 0u;
}

void CPU::serviceNativeDemand() {
	if (m_nativeDemand.empty() || !m_nativeCompilerWorker->idle()) return;
	// At most one discovery per polling point. Other regions may already
	// have covered this root; mutable code must still be a decoded warm head.
	const auto demand = m_nativeDemand.pop();
	const u32 word = (demand.pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	if (!(demand.page->refreshState[word] & DECODED_REFRESH_DECODE)
		&& isNativeWarmDispatch(demand.page->words[word].dispatchOp))
		compileNativeRoot(*demand.image, demand.functionAddress, *demand.page, demand.pc, mappedBusSignalsForCartridgeSlot(demand.slot));
}

void CPU::discardNativeCompilation() {
	m_nativeDemand.clear();
	if (!m_nativeCompilerWorker || m_nativeCompilerWorker->idle()) return;
	m_nativeCompilerWorker->wait();
	// Retire unpublished code and surface compiler errors on the owning thread.
	m_nativeCompilerWorker->take();
	m_pendingNativeCompilation.pageCount = 0u;
	if (m_nativeCompilationProfiling) {
		++m_nativeCompilationProfile.backgroundCompleted;
		++m_nativeCompilationProfile.backgroundCancelled;
		m_nativeCompilationProfile.backgroundNanoseconds += m_nativeCompilerWorker->compilationNanoseconds();
	}
}
#endif

bool CPU::installNativeRegion(Blua32ExecutionImage& image, std::span<const NativeCodeSourcePage> sources, u32 slot,
	std::vector<std::unique_ptr<NativeBlock>> blocks, NativeCodeAdmission admission) {
	// This is the only publication boundary for either compilation policy.
	// All source retirement and emitted-code ownership transfers run on the CPU.
	auto& region = *blocks.front()->region;
	std::array<DecodedInstructionPage*, NATIVE_VERSION_REGION_MAX_PAGES> pages;
	std::ranges::transform(sources, pages.begin(), &NativeCodeSourcePage::page);
	if (!m_nativeCode.tryInstall(region, std::span(pages).first(sources.size()), admission,
		m_nativeCompilationProfiling ? &m_nativeCompilationProfile : nullptr)) return false;
	const bool privateFirmware = sources.front().page->privateFirmware;
	auto& lookup = image.nativeLookup(privateFirmware);
	if (!lookup) lookup = std::make_unique<NativeCodeLookup>();
	for (const auto& source : sources) {
		auto& page = *source.page;
		page.nativeCode = lookup->install(source.pc, slot, page);
	}
	// Cartridge execution images pin instruction fetch to their physical bank.
	// Only system code needs cells for both selectable cartridge mappings.
	const u32 firstBank = image.executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID ? 0u : slot;
	const u32 endBank = image.executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID ? CARTRIDGE_SLOT_COUNT : slot + 1u;
#if defined(BMSX_NATIVE_PERF_MAP)
	blocks.front()->region->recordPerfMap(image.executionDomainId, slot, blocks.front()->firstPc);
#endif
	for (auto& block : blocks) {
		const u32 pagePc = block->firstPc & ~MAPPED_PAGE_BYTE_MASK;
		const auto& source = *std::ranges::lower_bound(sources, pagePc, {}, &NativeCodeSourcePage::pc);
		auto& page = *source.page;
		const u32 entry = (block->firstPc - pagePc) / INSTRUCTION_BYTES;
		auto& exit = block->terminal;
		if (exit.exit == NativeBlockExit::Call || nativeBlockExitResumesFrame(exit.exit)) {
			for (u32 bank = firstBank; bank < endBank; ++bank)
				exit.continuationCells[bank] = lookup->entrySlot(exit.nextPc, bank);
		}
		if (exit.exit == NativeBlockExit::Call && exit.operands.call.supplied >= 0 && source.immutable
			&& Blua32RomFunctionDirectory::ownsAddress(image.executionDomainId, exit.currentPc)) {
			// Only the CPU reads live call feedback. A worker may have emitted
			// this body before the first observation, or before a contradiction.
			auto& decoded = page.words[(exit.currentPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
			const auto prototype = decoded.nativeCallTarget();
			if (prototype == DecodedInstruction::CALL_TARGET_UNSEEN) {
				exit.observingCall = &decoded;
				exit.callStrategy = NativeCallStrategy::Observe;
			} else if (prototype != DecodedInstruction::CALL_TARGET_DISABLED) {
				if (const auto plan = captureNativeFixedCall(image, prototype, exit.operands.call.supplied)) {
					std::construct_at(&exit.fixedCall, NativeFixedCallBinding{*plan, {}});
					for (u32 bank = firstBank; bank < endBank; ++bank)
						exit.fixedCall.entryCells[bank] = lookup->entrySlot(plan->entryPc, bank);
					exit.callStrategy = NativeCallStrategy::Fixed;
				}
			}
		}
		for (auto& side : block->sideExits) {
			if (side.exit == NativeBlockExit::Call || nativeBlockExitResumesFrame(side.exit)) {
				for (u32 bank = firstBank; bank < endBank; ++bank)
					side.continuationCells[bank] = lookup->entrySlot(side.nextPc, bank);
			}
		}
		page.publishNativeEntry(&source - sources.data(), entry, std::move(block));
	}
	if (m_nativeCompilationProfiling) {
		auto& profile = m_nativeCompilationProfile;
		++profile.regionsPublished;
		profile.entriesPublished += blocks.size();
		profile.sourceInstructions += region.sourceInstructions;
		profile.emittedCodeBytes += region.codeBytes;
		profile.peakCodeBytes = std::max(profile.peakCodeBytes, static_cast<u64>(m_nativeCode.codeBytes()));
	}
	return true;
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
