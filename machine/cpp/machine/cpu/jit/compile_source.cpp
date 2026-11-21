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
#include "spec/blua32/instruction_format.h"

namespace bmsx {

namespace {
std::vector<NativeImageConstant> captureImageConstants(
	std::span<const NativeBlockInstruction> instructions, ConstValueSpan pool) {
	std::vector<NativeImageConstant> constants;
	const auto add = [&](u32 index) {
		if (constants.empty()) constants.reserve(instructions.size());
		constants.push_back({index, {}});
	};
	for (const auto& instruction : instructions) {
		const auto& decoded = *instruction.decoded;
		const u8 rk = OPCODE_RK_OPERANDS[decoded.op];
		if ((rk & RK_OPERAND_B) && decoded.b < 0) add(-1 - decoded.b);
		if ((rk & RK_OPERAND_C) && decoded.c < 0) add(-1 - decoded.c);
		switch (static_cast<OpCode>(decoded.op)) {
		case OpCode::LOADK: add(decoded.bx()); break;
		case OpCode::GETFIELD: case OpCode::SELF: add(decoded.c); break;
		case OpCode::SETFIELD: add(decoded.b); break;
		default: break;
		}
	}
	std::ranges::sort(constants, {}, &NativeImageConstant::index);
	constants.erase(std::ranges::unique(constants, {}, &NativeImageConstant::index).begin(), constants.end());
	for (auto& constant : constants) constant.value = pool.get(constant.index);
	return constants;
}

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

void CPU::prepareNativeBlock(CallFrame& frame, DecodedInstructionPage& page,
	u32 pc, MappedBusSignals busSignals) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	publishNativeCompilation();
	const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	if (page.nativeBlocks && page.nativeBlocks->entries[word]) return;
	if (!m_nativeCompilerWorker) m_nativeCompilerWorker = std::make_unique<NativeCompilerWorker>();
	if (!m_nativeCompilerWorker->idle()) return;
#endif
	auto& image = *frame.executionImage;
	const auto version = image.romFunctions.find(m_memory, image.executionDomainId, frame.readControl(FrameField::Function));
	if (version && version->contains(pc)
		&& prepareNativeFunction(image, *version, pc, busSignals, NATIVE_VERSION_REGION_MAX_PAGES, false)) return;
	const u32 pagePc = pc & ~MAPPED_PAGE_BYTE_MASK;
	MappedPageBinding binding;
	m_memory.bindMappedPage(pagePc, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, binding);
	NativeCompilationSource source(page, binding, pagePc, busSignals,
		m_memory.cartridgeController().selectedSlot(busSignals));
	source.enqueue(pc, true, nullptr, true);
	NativeCompilationSource* pages[] = {&source};
	prepareNativeSources(image, pages, false);
}

void CPU::prepareNativeSources(Blua32ExecutionImage& image, std::span<NativeCompilationSource* const> pages, bool coldImage) {
	if (coldImage && m_nativeCode.full()) return;
	const auto& first = *pages.front();
	const auto firstRoot = std::find(first.roots.begin(), first.roots.end(), u8{1});
	const u32 rootPc = first.pagePc + static_cast<u32>(firstRoot - first.roots.begin()) * INSTRUCTION_BYTES;
	auto* profile = m_nativeCompilationProfiling ? &m_nativeCompilationProfile : nullptr;
	NativeCompilationMeasurement measurement(profile, image.executionDomainId, first.slot, rootPc);
	if (!coldImage) discoverNativeSource(image, *pages.front(), nullptr);

	std::array<NativeBlockInstruction, DECODED_PAGE_WORDS> singlePage;
	std::vector<NativeBlockInstruction> functionInstructions;
	if (pages.size() > 1u) functionInstructions.resize(pages.size() * DECODED_PAGE_WORDS);
	const auto instructions = pages.size() == 1u ? std::span<NativeBlockInstruction>(singlePage)
		: std::span<NativeBlockInstruction>(functionInstructions);
	std::vector<NativeBlockSource> sources;
	size_t pendingCount = 0;
	for (auto* source : pages) pendingCount += source->pendingCount;
	sources.reserve(pendingCount);
	std::array<NativeCodeSourcePage, NATIVE_VERSION_REGION_MAX_PAGES> codePages;
	size_t codePageCount = 0, instructionCount = 0;
	bool immutableSource = true;
	std::vector<NativeRejectedFieldProof> rejectedFieldProofs;
	for (auto* source : pages) {
		auto& page = source->page;
		const auto& binding = source->binding;
		const u32 pagePc = source->pagePc;
		const auto& available = source->available;
		auto& leaders = source->leaders;
		const bool immutable = binding.readBytes && !binding.writeWatch.groups;
		if (immutable) {
			leaders |= page.nativeSourceLeaders;
			page.nativeSourceLeaders = leaders;
		}
		for (u32 word = 0; word < DECODED_PAGE_WORDS; ++word) {
			if (source->roots[word] && !available[word]
				&& page.words[word].dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeWarm))
				page.words[word].dispatchOp = page.words[word].op;
		}
		const auto firstInstruction = instructionCount;
		for (u32 entry = 0; entry < DECODED_PAGE_WORDS; ++entry) {
			if (!leaders[entry] || !available[entry]) continue;
			const size_t start = instructionCount;
			u32 cursor = entry;
			for (;;) {
				const auto& instruction = page.words[cursor];
				instructions[instructionCount++] = {&instruction, pagePc + cursor * INSTRUCTION_BYTES};
				const u32 successor = cursor + instruction.width;
				if (nativeBlockEndsBlock(instruction.op, instruction.b) || successor >= DECODED_PAGE_WORDS
					|| !available[successor] || leaders[successor]) break;
				if (instructionCount - start == NATIVE_BLOCK_MAX_INSTRUCTIONS) { leaders.set(successor); break; }
				cursor = successor;
			}
			const DecodedInstruction* skippedInstruction = nullptr;
			if (binding.readBytes && nativeBlockComparison(page.words[cursor].op)) {
				const u32 successor = cursor + page.words[cursor].width;
				if (successor < DECODED_PAGE_WORDS && (page.refreshState[successor] & DECODED_REFRESH_DECODE) == 0u
					&& successor + page.words[successor].width <= DECODED_PAGE_WORDS
					&& pagePc + (successor + page.words[successor].width - 1u) * INSTRUCTION_BYTES <= source->lastPc)
					skippedInstruction = &page.words[successor];
			}
			sources.push_back({instructions.subspan(start, instructionCount - start), skippedInstruction});
		}
		if (instructionCount != firstInstruction) {
			codePages[codePageCount++] = {pagePc, &page, binding.key};
			immutableSource &= immutable;
			auto rejected = page.fieldProofFeedback.snapshot(pagePc);
			if (rejectedFieldProofs.empty()) rejectedFieldProofs = std::move(rejected);
			else rejectedFieldProofs.insert(rejectedFieldProofs.end(), rejected.begin(), rejected.end());
		}
	}
	if (sources.empty()) return;
	const NativeCompilationOptions options{.observesArithmetic = true, .immutableSource = immutableSource};
	// Capture on the CPU thread. Save-state restore does not modify job inputs.
	auto constants = captureImageConstants(instructions.first(instructionCount), image.constPool);
	const auto bindingsPages = std::span(codePages).first(codePageCount);
	const NativeCodeBindings bindings(m_memory, m_stringPool, this, bindingsPages);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (!coldImage) {
		auto& pendingJob = m_pendingNativeCompilation;
		pendingJob.image = &image;
		std::ranges::copy(bindingsPages, pendingJob.pages.begin());
		pendingJob.pageCount = static_cast<u32>(codePageCount);
		pendingJob.slot = first.slot;
		pendingJob.invalidated = false;
		m_nativeCompilerWorker->submit(sources, bindings, options, profile != nullptr,
			std::move(rejectedFieldProofs), std::move(constants));
		return;
	}
#endif
	measurement.phase(&NativeCompilationProfile::compilationNanoseconds);
	auto blocks = NativeCompiler::compile(sources, bindings, options,
		{.rejectedFieldProofs = rejectedFieldProofs, .imageConstants = constants});
	if (blocks.empty()) return;
	measurement.finish();
	installNativeRegion(image, bindingsPages, first.slot, std::move(blocks),
		coldImage ? NativeCodeAdmission::Warmup : NativeCodeAdmission::Adaptive);
}

} // namespace bmsx
