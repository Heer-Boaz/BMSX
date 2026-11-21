#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_liveness.h"
#include "machine/cpu/native_ir_optimize.h"

#include <algorithm>
#include <numeric>
#include "machine/cpu/execution_image.h"
#include "spec/blua32/cop0.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {
namespace {

struct OperationFlow {
	using Flow = NativeOperationFlow;
	Flow operator()(const auto&) const { return Flow::Linear; }
	Flow operator()(const auto& op) const requires requires { op.terminalExit; } { return Flow::Terminal; }
	Flow operator()(const NativeJump&) const { return Flow::Terminal; }
	Flow operator()(const NativeTruthBranch&) const { return Flow::Terminal; }
	Flow operator()(const NativeComparison&) const { return Flow::Terminal; }
	Flow operator()(const NativeReplay&) const { return Flow::LeavesNative; }

	Flow operator()(const NativeTableAccess& op) const { return op.resultTag ? Flow::Linear : Flow::Checkpoint; }
	Flow operator()(const NativeVararg&) const { return Flow::Checkpoint; }
	Flow operator()(const NativeLength&) const { return Flow::Checkpoint; }
	Flow operator()(const NativeMemoryAccess&) const { return Flow::Checkpoint; }
	Flow operator()(const NativeUpvalueAccess& op) const {
		return op.access == NativeAccess::Write ? Flow::Checkpoint : Flow::Linear;
	}
	Flow operator()(const NativeControlAccess& op) const {
		switch (op.mode) {
		case NativeControlMode::ReadWord: case NativeControlMode::ReadZero: return Flow::Linear;
		case NativeControlMode::WriteWord: return op.field == COP0_STATUS ? Flow::Terminal : Flow::Checkpoint;
		case NativeControlMode::ConsumeWord: return Flow::Checkpoint;
		case NativeControlMode::ReadFault: case NativeControlMode::WriteSemantic: return Flow::LeavesNative;
		}
		BMSX_UNREACHABLE();
	}
};

} // namespace

NativeOperationFlow nativeOperationFlow(const NativeOperation& operation) {
	return std::visit(OperationFlow{}, operation);
}

NativeIrRegion::NativeIrRegion(std::span<const NativeBlockSource> sources, ConstValueSpan constants,
	bool cpuOwned, NativeCompilationOptions options) {
	size_t instructionCount = 0;
	for (const auto& source : sources) instructionCount += source.instructions.size();
	m_instructions.reserve(instructionCount);
	m_blocks.reserve(sources.size());
	entries.reserve(sources.size());
	for (const auto& source : sources) {
		const size_t first = m_instructions.size();
		for (const auto& inst : source.instructions)
			m_instructions.emplace_back(translateNativeOperation(*inst.decoded, constants));
		auto operations = std::span(m_instructions).subspan(first);
		const size_t count = planNativeFieldReads(operations, options.tier);
		const bool completeRun = count == operations.size();
		operations = operations.first(count);
		if (!completeRun) m_instructions.erase(m_instructions.begin() + first + count, m_instructions.end());

		const size_t firstEntry = entries.size();
		size_t segment = 0;
		for (size_t index = 0; index < count; ++index) {
			const bool last = index + 1 == count;
			if (!last && nativeOperationFlow(operations[index].operation) == NativeOperationFlow::Linear) continue;
			const size_t length = index - segment + 1;
			const NativeBlockSource slice{source.instructions.subspan(segment, length),
				last && completeRun ? source.skippedInstruction : nullptr};
			buildBlock(slice, operations.subspan(segment, length), cpuOwned);
			segment = index + 1;
		}
		u16 coveredWords = 0;
		// Source dependencies cover only this physical run, including
		// compiler-created continuation entries and any fused following word.
		for (size_t index = entries.size(); index-- > firstEntry;) {
			coveredWords += entries[index]->sourceWords;
			entries[index]->sourceWords = coveredWords;
		}
	}

	// Emission order can differ from guest address order. Only a published
	// entry at the exact PC is a local successor.
	std::array<u16, DECODED_PAGE_WORDS> byAddress;
	const auto directory = std::span(byAddress).first(entries.size());
	std::iota(directory.begin(), directory.end(), u16{0});
	std::ranges::sort(directory, {}, [&](u16 index) { return entries[index]->firstPc; });
	const auto entryForPc = [&](u32 pc) -> size_t {
		const auto entry = std::ranges::lower_bound(directory, pc, {}, [&](u16 index) { return entries[index]->firstPc; });
		return entry != directory.end() && entries[*entry]->firstPc == pc ? *entry : entries.size();
	};
	for (size_t index = entries.size(); index-- > 0;) {
		auto& entry = *entries[index];
		const auto& primary = entry.terminal;
		auto& block = m_blocks[index];
		const auto* alternate = block.taken;
		block.successors = {
			block.nativeSuccessor || block.completedCall ? entryForPc(primary.nextPc) : entries.size(),
			block.nativeSuccessor && alternate && alternate->exit == NativeBlockExit::Continue
				? entryForPc(alternate->nextPc) : entries.size(),
		};
	}
	if (options.immutablePagePc) planRecordConstructors(directory, *options.immutablePagePc, constants);
}

void NativeIrRegion::optimize(ConstValueSpan constants, NativeRegisterUses& uses) {
	uses.analyze(m_blocks);
	NativeTypePropagation{}.specializeRegion(m_blocks, constants, uses, m_entryTypes);
}

} // namespace bmsx
