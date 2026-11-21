#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"

#include <algorithm>
#include <array>
#include <chrono>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_compilation_source.h"
#include "machine/cpu/native_compiler.h"
#include "machine/cpu/native_source_policy.h"
#include "machine/cpu/native_table_constructor.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/native_compiler_worker.h"
#endif
#include "machine/memory/memory.h"

namespace bmsx {

namespace {
// Compilation may return early or raise while decoding/generating. This scope
// measures the complete owning operation, including its unfinished phase.
class NativeCompilationMeasurement {
public:
	NativeCompilationMeasurement(NativeCompilationProfile* profile, i32 domain, u32 slot, u32 rootPc)
		: m_profile(profile), m_domain(domain), m_slot(slot), m_rootPc(rootPc) {
		if (m_profile) {
			++m_profile->prepareRequests;
			m_start = m_phaseStart = Clock::now();
		}
	}
	~NativeCompilationMeasurement() {
		if (!m_profile) return;
		const auto now = Clock::now();
		m_profile->*m_phase += static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(now - m_phaseStart).count());
		const u64 elapsed = static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(now - m_start).count());
		m_profile->prepareNanoseconds += elapsed;
		if (elapsed > m_profile->maxPrepareNanoseconds) {
			m_profile->maxPrepareNanoseconds = elapsed;
			m_profile->maxPrepareDomain = m_domain;
			m_profile->maxPrepareCartridgeSlot = m_slot;
			m_profile->maxPrepareRootPc = m_rootPc;
			m_profile->maxPreparePagePc = m_rootPc & ~MAPPED_PAGE_BYTE_MASK;
		}
	}
	void phase(u64 NativeCompilationProfile::* next) {
		if (!m_profile) return;
		const auto now = Clock::now();
		m_profile->*m_phase += static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(now - m_phaseStart).count());
		m_phaseStart = now;
		m_phase = next;
	}
private:
	using Clock = std::chrono::steady_clock;
	NativeCompilationProfile* m_profile;
	i32 m_domain;
	u32 m_slot, m_rootPc;
	Clock::time_point m_start, m_phaseStart;
	u64 NativeCompilationProfile::* m_phase = &NativeCompilationProfile::discoveryNanoseconds;
};
}

void CPU::setNativeCompilationProfiling(bool enabled) {
	m_nativeCompilationProfiling = enabled;
	if (enabled) m_nativeCompilationProfile.peakCodeBytes = std::max(m_nativeCompilationProfile.peakCodeBytes,
		static_cast<u64>(m_nativeCodeBytes));
}

NativeCompilationProfile CPU::readNativeCompilationProfile() const {
	auto profile = m_nativeCompilationProfile;
	profile.codeBytes = m_nativeCodeBytes;
	return profile;
}

void CPU::prepareNativeBlock(Blua32ExecutionImage& image, DecodedInstructionPage& page,
	u32 pc, MappedBusSignals busSignals) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	publishNativeCompilation();
	const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	if (page.nativeBlocks && page.nativeBlocks->entries[word]) return;
	if (!m_nativeCompilerWorker) m_nativeCompilerWorker = std::make_unique<NativeCompilerWorker>();
	if (!m_nativeCompilerWorker->idle()) return;
#endif
	const u32 pagePc = pc & ~MAPPED_PAGE_BYTE_MASK;
	MappedPageBinding binding;
	m_memory.bindMappedPage(pagePc, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, binding);
	NativeCompilationSource source(page, binding, pagePc, busSignals,
		m_memory.cartridgeController().selectedSlot(busSignals));
	source.enqueue(pc, true, nullptr, true);
	prepareNativeSource(image, source, false);
}

void CPU::observeNativeArithmeticReplay(DecodedInstructionPage& page, u32 word,
	NativeArithmeticFeedback assumption, Value left, Value right) {
	auto& decoded = page.words[word];
	decoded.observeNativeNumericTypes(left, right);
	const auto observed = decoded.nativeNumericTypes();
	if (observed.stable && observed.left == assumption.left && observed.right == assumption.right) return;

	retireNativeInstructionUsers(page, word);
}

void CPU::retireNativeInstructionUsers(DecodedInstructionPage& page, u32 word) {
	// This operation is reached outside generated code. Withdraw all source
	// users (including an independently published suffix) and preserve the
	// feedback for the next compilation.
	page.retireNativeBlocks(word, word + 1u);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (m_pendingNativeCompilation.page == &page) m_pendingNativeCompilation.invalidated = true;
#endif
}

bool NativeFieldProofFeedback::contradict(u32 word, ValueTag tag) {
	const auto sameWord = std::ranges::equal_range(m_sites, word, {}, &Site::word);
	const auto site = std::ranges::find(sameWord, tag, &Site::tag);
	if (site != sameWord.end()) return ++site->misses == RETIRE_AFTER;
	m_sites.insert(sameWord.end(), {static_cast<u16>(word), tag, 1});
	return false;
}

void NativeFieldProofFeedback::forget(u32 word) {
	const auto sites = std::ranges::equal_range(m_sites, word, {}, &Site::word);
	m_sites.erase(sites.begin(), sites.end());
}

std::vector<NativeRejectedFieldProof> NativeFieldProofFeedback::snapshot(u32 pagePc) const {
	std::vector<NativeRejectedFieldProof> rejected;
	for (const auto& site : m_sites)
		if (site.misses == RETIRE_AFTER) rejected.push_back({pagePc + site.word * INSTRUCTION_BYTES, site.tag});
	return rejected;
}

void CPU::discoverNativeSource(Blua32ExecutionImage& image, NativeCompilationSource& source, std::vector<u32>* outgoing) {
	auto& page = source.page;
	const auto& binding = source.binding;
	const u32 pagePc = source.pagePc;
	auto& roots = source.roots;
	auto& available = source.available;
	const auto enqueue = [&](u32 pc, bool leader) { source.enqueue(pc, leader, outgoing); };
	for (; source.discoveredCount < source.pendingCount; ++source.discoveredCount) {
		const u32 cursor = source.pending[source.discoveredCount];
		const u32 pc = pagePc + cursor * INSTRUCTION_BYTES;
		// Existing entry points retain their region; an edge to one becomes an
		// ordinary external link. Interior entries compile a separate suffix.
		if (page.nativeBlocks && page.nativeBlocks->entries[cursor]) continue;
		if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u) {
			if (!decodeBackedInstruction(image, page, cursor, pc, source.busSignals)) continue;
		}
		const auto& instruction = page.words[cursor];
		if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u
			|| instruction.dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)
			|| !nativeSourceCanEmit(instruction, image.constPool.size())) continue;
		if (instruction.op >= static_cast<u8>(OpCode::GETSYS) && instruction.op <= static_cast<u8>(OpCode::SETGL)) {
			const auto& bank = instruction.op <= static_cast<u8>(OpCode::SETSYS) ? m_systemGlobalBank : m_globalBank;
			if (instruction.bx >= bank.capacity()) continue; // The general mirror port is scalar.
		}
		if (!roots[cursor] && binding.writeWatch.groups
			&& page.nativeVisits[cursor] + 1u < NATIVE_BLOCK_COMPILATION_THRESHOLD) continue;
		available[cursor] = 1;
		const auto op = static_cast<OpCode>(instruction.op);
		const u32 successor = cursor + instruction.width;
		const u32 successorPc = pc + static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
		if (nativeBlockComparison(instruction.op)) {
			if (binding.readBytes && successor < DECODED_PAGE_WORDS) {
				if ((page.refreshState[successor] & DECODED_REFRESH_DECODE) != 0u && successor < DECODED_PAGE_WORDS - 1u
					&& !decodeBackedInstruction(image, page, successor, successorPc, source.busSignals)) continue;
				if ((page.refreshState[successor] & DECODED_REFRESH_DECODE) == 0u
					&& successor + page.words[successor].width <= DECODED_PAGE_WORDS) {
					enqueue(successorPc + static_cast<u32>(page.words[successor].width) * INSTRUCTION_BYTES, true);
					const auto& skipped = page.words[successor];
					if (skipped.op == static_cast<u8>(OpCode::JMP) && skipped.a == 0
						&& skipped.dispatchOp != static_cast<u8>(DecodedDispatchOp::Observe)) {
						// This edge executes the fused JMP, not a separate entry.
						// An independent predecessor can still enqueue the JMP itself.
						enqueue(skipped.bx, true);
						continue;
					}
				}
			}
			enqueue(successorPc, true);
		} else if (op == OpCode::JMP || op == OpCode::JMPIF || op == OpCode::JMPIFNOT) {
			enqueue(instruction.bx, true);
			if (op != OpCode::JMP) enqueue(successorPc, true);
		} else if (!nativeBlockEndsBlock(instruction.op, instruction.b)) enqueue(successorPc, false);
		else if (nativeBlockHasTerminalContinuation(instruction.op, instruction.b)) enqueue(successorPc, true);
	}
}

void CPU::prepareNativeSource(Blua32ExecutionImage& image, NativeCompilationSource& source, bool coldImage) {
	auto& page = source.page;
	const auto& binding = source.binding;
	const u32 pagePc = source.pagePc;
	auto& available = source.available;
	auto& leaders = source.leaders;
	auto* profile = m_nativeCompilationProfiling ? &m_nativeCompilationProfile : nullptr;
	const auto firstRoot = std::find(source.roots.begin(), source.roots.end(), u8{1});
	const u32 rootPc = pagePc + static_cast<u32>(firstRoot - source.roots.begin()) * INSTRUCTION_BYTES;
	NativeCompilationMeasurement measurement(profile, image.executionDomainId, source.slot, rootPc);
	if (m_nativeCodeBytes >= NATIVE_CODE_CACHE_MAX_BYTES) {
		measurement.phase(&NativeCompilationProfile::retirementNanoseconds);
		const auto before = m_nativeCodeBytes;
		for (auto& installed : m_executionImagesByDomain) {
			if (!installed) continue;
			for (auto& [key, decodedPage] : installed->decodedPages) decodedPage.retireNativeBlocks();
		}
		if (profile) {
			++profile->capacityFlushes;
			profile->capacityRetiredCodeBytes += before - m_nativeCodeBytes;
		}
		measurement.phase(&NativeCompilationProfile::discoveryNanoseconds);
	}
	if (!coldImage) discoverNativeSource(image, source, nullptr);
	for (u32 word = 0; word < DECODED_PAGE_WORDS; ++word) {
		if (source.roots[word] && !available[word]
			&& page.words[word].dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeWarm))
			page.words[word].dispatchOp = page.words[word].op;
	}
	if (std::none_of(available.begin(), available.end(), [](u8 value) { return value != 0; })) return;
	std::array<NativeBlockInstruction, DECODED_PAGE_WORDS> instructions;
	std::vector<NativeBlockSource> sources;
	sources.reserve(source.pendingCount);
	size_t instructionCount = 0;
	for (u32 entry = 0; entry < DECODED_PAGE_WORDS; ++entry) {
		if (!leaders[entry] || !available[entry]) continue;
		const size_t first = instructionCount;
		u32 cursor = entry;
		for (;;) {
			const auto& instruction = page.words[cursor];
			instructions[instructionCount++] = {&instruction, pagePc + cursor * INSTRUCTION_BYTES};
			const u32 successor = cursor + instruction.width;
			if (nativeBlockEndsBlock(instruction.op, instruction.b) || successor >= DECODED_PAGE_WORDS
				|| !available[successor] || leaders[successor]) break;
			if (instructionCount - first == NATIVE_BLOCK_MAX_INSTRUCTIONS) { leaders[successor] = 1; break; }
			cursor = successor;
		}
		const DecodedInstruction* skippedInstruction = nullptr;
		if (binding.readBytes && nativeBlockComparison(page.words[cursor].op)) {
			const u32 successor = cursor + page.words[cursor].width;
			if (successor < DECODED_PAGE_WORDS && (page.refreshState[successor] & DECODED_REFRESH_DECODE) == 0u
				&& successor + page.words[successor].width <= DECODED_PAGE_WORDS) skippedInstruction = &page.words[successor];
		}
		sources.push_back({std::span(instructions.data() + first, instructionCount - first), skippedInstruction});
	}
	if (sources.empty()) return;
	const NativeCompilationOptions options{
		.tier = coldImage ? NativeCompilationTier::ColdImage : NativeCompilationTier::OnDemand,
		.immutablePagePc = binding.readBytes && !binding.writeWatch.groups ? std::optional{pagePc} : std::nullopt,
	};
	auto rejectedFieldProofs = page.fieldProofFeedback.snapshot(pagePc);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (!coldImage) {
		auto& pendingJob = m_pendingNativeCompilation;
		pendingJob.image = &image;
		pendingJob.page = &page;
		pendingJob.key = binding.key;
		pendingJob.pagePc = pagePc;
		pendingJob.slot = source.slot;
		pendingJob.invalidated = false;
		m_nativeCompilerWorker->submit(sources,
			NativeCodeBindings(m_memory, m_stringPool, this), options, profile != nullptr, std::move(rejectedFieldProofs));
		return;
	}
#endif
	measurement.phase(&NativeCompilationProfile::compilationNanoseconds);
	auto blocks = NativeCompiler::compile(sources, NativeCodeBindings(m_memory, m_stringPool, this), options,
		{.rejectedFieldProofs = rejectedFieldProofs});
	if (!blocks.empty()) installNativeRegion(image, page, pagePc, source.slot, std::move(blocks));
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
	installNativeRegion(*job.image, page, job.pagePc, job.slot, std::move(blocks));
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
	std::vector<std::unique_ptr<NativeBlock>> blocks) {
	// This is the only publication boundary for either compilation policy.
	// All source retirement and emitted-code ownership transfers run on the CPU.
	if (!page.nativeBlocks) page.nativeBlocks = std::make_unique<NativeBlockPage>();
	auto& lookup = image.nativeCodeLookup;
	if (!lookup) lookup = std::make_unique<NativeCodeLookup>();
	page.nativeCode = lookup->install(pagePc, slot, page);
	// Cartridge execution images pin instruction fetch to their physical bank.
	// Only system code needs cells for both selectable cartridge mappings.
	const u32 firstBank = image.executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID ? 0u : slot;
	const u32 endBank = image.executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID ? CARTRIDGE_SLOT_COUNT : slot + 1u;
	const auto& region = *blocks.front()->region;
	blocks.front()->region->publish(m_nativeCodeBytes);
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
			if (side.exit == NativeBlockExit::WriteField || side.exit == NativeBlockExit::WriteIndex)
				side.tableStore.sourceEntry = &page.nativeCode[entry];
			if (side.exit == NativeBlockExit::Call || nativeBlockExitResumesFrame(side.exit)) {
				for (u32 bank = firstBank; bank < endBank; ++bank)
					side.continuationCells[bank] = lookup->entrySlot(side.nextPc, bank);
			}
		}
		page.nativeBlocks->entries[entry] = std::move(block);
		page.nativeCode[entry] = page.nativeBlocks->entries[entry]->m_body;
		++page.nativeBlocks->count;
		page.words[entry].dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeBlock);
		page.words[entry].dispatchCycles = page.words[entry].baseCycles;
		page.refreshState[entry] &= static_cast<u8>(~DECODED_REFRESH_FUSION);
	}
	if (m_nativeCompilationProfiling) {
		auto& profile = m_nativeCompilationProfile;
		++profile.regionsPublished;
		profile.entriesPublished += blocks.size();
		profile.sourceInstructions += region.sourceInstructions;
		profile.emittedCodeBytes += region.codeBytes;
		profile.peakCodeBytes = std::max(profile.peakCodeBytes, static_cast<u64>(m_nativeCodeBytes));
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
