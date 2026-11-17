#include "machine/cpu/cpu.h"

#include <algorithm>
#include <array>
#include <chrono>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_compilation_source.h"
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
	m_memory.bindMappedPage(pagePc, busSignals, binding);
	NativeCompilationSource source(image, page, binding, pagePc, busSignals,
		m_memory.cartridgeController().selectedSlot(busSignals));
	source.enqueue(pc, true, nullptr, true);
	prepareNativeSource(source, false, true);
}

void CPU::discoverNativeSource(NativeCompilationSource& source, std::vector<u32>* outgoing) {
	auto& image = source.image;
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
			|| !source.canEmit(instruction)) continue;
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
					if (skipped.op == static_cast<u8>(OpCode::JMP)
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
		else if (nativeBlockHasContinuation(instruction.op, instruction.b)) enqueue(successorPc, true);
	}
}

void CPU::prepareNativeSource(NativeCompilationSource& source, bool immediate, bool discover) {
	auto& image = source.image;
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
	if (discover) discoverNativeSource(source, nullptr);
	for (u32 word = 0; word < DECODED_PAGE_WORDS; ++word) {
		if (source.roots[word] && !available[word]
			&& page.words[word].dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeWarm))
			page.words[word].dispatchOp = page.words[word].op;
	}
	if (std::none_of(available.begin(), available.end(), [](u8 value) { return value != 0; })) return;
	std::array<NativeBlockInstruction, DECODED_PAGE_WORDS> instructions;
	std::vector<NativeBlockSource> sources;
	std::vector<u32> entries;
	sources.reserve(source.pendingCount);
	entries.reserve(source.pendingCount);
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
		// Keep the bounded linear span (plus a fused following JMP), while
		// exposing each returning helper's successor as an entry.
		size_t segmentFirst = first;
		for (size_t index = first; index < instructionCount; ++index) {
			const bool final = index + 1u == instructionCount;
			const auto& instruction = *instructions[index].decoded;
			if (!final && !nativeBlockHasContinuation(instruction.op, instruction.b)) continue;
			sources.push_back({std::span(instructions.data() + segmentFirst, index + 1u - segmentFirst),
				final ? skippedInstruction : nullptr, !final});
			entries.push_back((instructions[segmentFirst].pc - pagePc) / INSTRUCTION_BYTES);
			segmentFirst = index + 1u;
		}
	}
	NativeBlockExitHandlers handlers{};
	handlers[static_cast<size_t>(NativeBlockExit::ReadField)] = &CPU::compiledReadFieldExit;
	handlers[static_cast<size_t>(NativeBlockExit::WriteField)] = &CPU::compiledWriteFieldExit;
	handlers[static_cast<size_t>(NativeBlockExit::ReadIndex)] = &CPU::compiledReadIndexExit;
	handlers[static_cast<size_t>(NativeBlockExit::WriteIndex)] = &CPU::compiledWriteIndexExit;
	handlers[static_cast<size_t>(NativeBlockExit::ReadInteger)] = &CPU::compiledReadIntegerExit;
	handlers[static_cast<size_t>(NativeBlockExit::WriteInteger)] = &CPU::compiledWriteIntegerExit;
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (!immediate) {
		auto& pendingJob = m_pendingNativeCompilation;
		pendingJob.image = &image;
		pendingJob.page = &page;
		pendingJob.key = binding.key;
		pendingJob.pagePc = pagePc;
		pendingJob.slot = source.slot;
		pendingJob.instructionCount = static_cast<u32>(instructionCount);
		pendingJob.invalidated = false;
		pendingJob.entries.assign(entries.begin(), entries.end());
		m_nativeCompilerWorker->submit(sources, image.constPool.view(), NativeCodeBindings(m_memory, m_stringPool, asStringId(m_indexKey), this), handlers, profile != nullptr);
		return;
	}
#else
	(void)immediate;
#endif
	measurement.phase(&NativeCompilationProfile::compilationNanoseconds);
	auto blocks = NativeBlock::compileRegion(sources, image.constPool.view(),
		NativeCodeBindings(m_memory, m_stringPool, asStringId(m_indexKey), this), handlers);
	installNativeRegion(image, page, pagePc, source.slot, entries, std::move(blocks), static_cast<u32>(instructionCount));
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
	installNativeRegion(*job.image, page, job.pagePc, job.slot, job.entries, std::move(blocks), job.instructionCount);
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
	std::span<const u32> entries, std::vector<std::unique_ptr<NativeBlock>> blocks, u32 instructionCount) {
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
	const auto codeBytes = blocks.front()->region->codeBytes;
	blocks.front()->region->publish(m_nativeCodeBytes);
#if defined(BMSX_NATIVE_PERF_MAP)
	blocks.front()->region->recordPerfMap(image.executionDomainId, slot, blocks.front()->firstPc);
#endif
	for (size_t index = 0; index < entries.size(); ++index) {
		auto& exit = blocks[index]->terminal;
		if (exit.exit == NativeBlockExit::Call || nativeBlockExitResumesFrame(exit.exit)) {
			for (u32 bank = firstBank; bank < endBank; ++bank)
				exit.continuationCells[bank] = lookup->entrySlot(exit.nextPc, bank);
		}
		for (auto& side : blocks[index]->sideExits) {
			if (side.exit == NativeBlockExit::Call || nativeBlockExitResumesFrame(side.exit)) {
				for (u32 bank = firstBank; bank < endBank; ++bank)
					side.continuationCells[bank] = lookup->entrySlot(side.nextPc, bank);
			}
		}
		const u32 entry = entries[index];
		page.nativeBlocks->entries[entry] = std::move(blocks[index]);
		page.nativeCode[entry] = page.nativeBlocks->entries[entry]->m_body;
		++page.nativeBlocks->count;
		page.words[entry].dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeBlock);
		page.words[entry].dispatchCycles = page.words[entry].baseCycles;
		page.refreshState[entry] &= static_cast<u8>(~DECODED_REFRESH_FUSION);
	}
	if (m_nativeCompilationProfiling) {
		auto& profile = m_nativeCompilationProfile;
		++profile.regionsPublished;
		profile.entriesPublished += entries.size();
		profile.sourceInstructions += instructionCount;
		profile.emittedCodeBytes += codeBytes;
		profile.peakCodeBytes = std::max(profile.peakCodeBytes, static_cast<u64>(m_nativeCodeBytes));
	}
}

void CPU::clearNativeContinuationBindings() {
	// Include suspended coroutines, exception activations and pooled nodes;
	// clearing only the running resumer chain would leave borrowed entry cells.
	m_heap.visitThreads([](Thread& thread) {
		for (auto* frame = thread.firstFrame; frame; frame = frame->next)
			frame->nativeContinuationCells = {};
	});
}

NativeBlockTransition CPU::compiledReadFieldExit(CPU* owner, CallFrame* frame, const NativeBlockExitSite* exit) {
	frame->registers.set(exit->exitA, owner->loadTableFieldIndexCached(exit->tableCacheSlot,
		frame->registers.get(exit->exitB), asStringId(frame->executionImage->constPool.get(exit->exitC))));
	frame->top = std::max(frame->top, static_cast<int>(exit->exitA) + 1);
	return NativeBlockTransition::NextInstruction;
}

NativeBlockTransition CPU::compiledWriteFieldExit(CPU* owner, CallFrame* frame, const NativeBlockExitSite* exit) {
	owner->storeTableFieldIndexCached(exit->tableCacheSlot, frame->registers.get(exit->exitA),
		asStringId(frame->executionImage->constPool.get(exit->exitB)), owner->readRK(*frame->executionImage, frame->registers, exit->exitC));
	return NativeBlockTransition::NextInstruction;
}

NativeBlockTransition CPU::compiledReadIndexExit(CPU* owner, CallFrame* frame, const NativeBlockExitSite* exit) {
	const Value base = frame->registers.get(exit->exitB);
	const Value key = owner->readRK(*frame->executionImage, frame->registers, exit->exitC);
	frame->registers.set(exit->exitA, valueIsString(key)
		? owner->loadTableFieldIndexCached(exit->tableCacheSlot, base, asStringId(key))
		: owner->loadTableIndex(base, key));
	frame->top = std::max(frame->top, static_cast<int>(exit->exitA) + 1);
	return NativeBlockTransition::NextInstruction;
}

NativeBlockTransition CPU::compiledWriteIndexExit(CPU* owner, CallFrame* frame, const NativeBlockExitSite* exit) {
	const Value base = frame->registers.get(exit->exitA);
	const Value key = owner->readRK(*frame->executionImage, frame->registers, exit->exitB);
	const Value value = owner->readRK(*frame->executionImage, frame->registers, exit->exitC);
	if (valueIsString(key)) owner->storeTableFieldIndexCached(exit->tableCacheSlot, base, asStringId(key), value);
	else owner->storeTableIndex(base, key, value);
	return NativeBlockTransition::NextInstruction;
}

NativeBlockTransition CPU::compiledReadIntegerExit(CPU* owner, CallFrame* frame, const NativeBlockExitSite* exit) {
	frame->registers.set(exit->exitA, owner->loadTableIntegerIndex(frame->registers.get(exit->exitB), exit->exitC));
	frame->top = std::max(frame->top, static_cast<int>(exit->exitA) + 1);
	return NativeBlockTransition::NextInstruction;
}

NativeBlockTransition CPU::compiledWriteIntegerExit(CPU* owner, CallFrame* frame, const NativeBlockExitSite* exit) {
	owner->storeTableIntegerIndex(frame->registers.get(exit->exitA), exit->exitB,
		owner->readRK(*frame->executionImage, frame->registers, exit->exitC));
	return NativeBlockTransition::NextInstruction;
}

} // namespace bmsx
