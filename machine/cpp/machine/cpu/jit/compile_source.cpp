#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"

#include <algorithm>
#include <array>
#include <chrono>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/source.h"
#include "machine/cpu/jit/compiler.h"
#include "machine/cpu/jit/source_policy.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/jit/worker.h"
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
	~NativeCompilationMeasurement() { finish(); }
	void finish() {
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
		m_profile = nullptr;
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
		static_cast<u64>(m_nativeCode.codeBytes()));
}

NativeCompilationProfile CPU::readNativeCompilationProfile() const {
	auto profile = m_nativeCompilationProfile;
	profile.codeBytes = m_nativeCode.codeBytes();
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

void CPU::prepareNativeSource(Blua32ExecutionImage& image, NativeCompilationSource& source, bool coldImage) {
	if (coldImage && m_nativeCode.full()) return;
	auto& page = source.page;
	const auto& binding = source.binding;
	const u32 pagePc = source.pagePc;
	auto& available = source.available;
	auto& leaders = source.leaders;
	auto* profile = m_nativeCompilationProfiling ? &m_nativeCompilationProfile : nullptr;
	const auto firstRoot = std::find(source.roots.begin(), source.roots.end(), u8{1});
	const u32 rootPc = pagePc + static_cast<u32>(firstRoot - source.roots.begin()) * INSTRUCTION_BYTES;
	NativeCompilationMeasurement measurement(profile, image.executionDomainId, source.slot, rootPc);
	if (!coldImage) discoverNativeSource(image, source, nullptr);
	const bool immutable = binding.readBytes && !binding.writeWatch.groups;
	if (immutable) {
		leaders |= page.nativeSourceLeaders;
		page.nativeSourceLeaders = leaders;
	}
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
			if (instructionCount - first == NATIVE_BLOCK_MAX_INSTRUCTIONS) { leaders.set(successor); break; }
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
		.observesArithmetic = true,
		.immutablePagePc = immutable ? std::optional{pagePc} : std::nullopt,
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
			NativeCodeBindings(m_memory, m_stringPool, this, page.words.data()), options, profile != nullptr, std::move(rejectedFieldProofs));
		return;
	}
#endif
	measurement.phase(&NativeCompilationProfile::compilationNanoseconds);
	auto blocks = NativeCompiler::compile(sources, NativeCodeBindings(m_memory, m_stringPool, this, page.words.data()), options,
		{.rejectedFieldProofs = rejectedFieldProofs});
	if (blocks.empty()) return;
	// Publication owns any capacity retirement and profiles it separately.
	measurement.finish();
	installNativeRegion(image, page, pagePc, source.slot, std::move(blocks),
		coldImage ? NativeCodeAdmission::Warmup : NativeCodeAdmission::Adaptive);
}

} // namespace bmsx
