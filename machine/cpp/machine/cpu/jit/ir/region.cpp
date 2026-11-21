#include "machine/cpu/jit/ir/region.h"
#include "machine/cpu/jit/ir/liveness.h"
#include "machine/cpu/jit/ir/type_propagation.h"
#include "machine/cpu/jit/ir/value_flow.h"

#include <algorithm>
#include <numeric>
#include "machine/cpu/decoded_instruction.h"
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

	Flow operator()(const NativeTableAccess& op) const { return op.ownFieldOnly ? Flow::Linear : Flow::Checkpoint; }
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

NativeIrRegion::NativeIrRegion(std::span<const NativeBlockSource> sources, NativeRegisterUses& uses, bool cpuOwned,
	NativeCompilationOptions options, NativeCompileSpecializations specializations) {
	size_t instructionCount = 0;
	for (const auto& source : sources) instructionCount += source.instructions.size();
	m_instructions.reserve(instructionCount);
	m_blocks.reserve(sources.size());
	for (const auto& source : sources)
		for (const auto& inst : source.instructions)
			m_instructions.emplace_back(translateNativeOperation(*inst.decoded));
	NativeSlotValues values(m_instructions);
	std::array<NativeFieldAddressUse, NATIVE_BLOCK_MAX_INSTRUCTIONS> addressUses;
	size_t first = 0;
	for (const auto& source : sources) {
		const size_t count = source.instructions.size();
		auto operations = std::span(m_instructions).subspan(first, count);
		first += count;
		planNativeFieldReads(operations, source.instructions, values, addressUses, specializations);

		const size_t firstEntry = m_blocks.size();
		size_t segment = 0;
		for (size_t index = 0; index < count; ++index) {
			const bool last = index + 1 == count;
			if (!last && nativeOperationFlow(operations[index].operation) == NativeOperationFlow::Linear) continue;
			const size_t length = index - segment + 1;
			const NativeBlockSource slice{source.instructions.subspan(segment, length),
				last ? source.skippedInstruction : nullptr};
			buildBlock(slice, operations.subspan(segment, length), cpuOwned);
			m_blocks.back().sourcePc = source.instructions.front().pc;
			bindOwnFieldAddresses(m_blocks.back(), std::span(addressUses).subspan(segment, length), segment);
			segment = index + 1;
		}
		u16 coveredWords = 0;
		// Source dependencies cover only this physical run, including
		// compiler-created continuation entries and any fused following word.
		for (size_t index = m_blocks.size(); index-- > firstEntry;) {
			coveredWords += m_blocks[index].sourceWords;
			m_blocks[index].sourceWords = coveredWords;
		}
	}

	// Emission order can differ from guest address order. Only a published
	// entry at the exact PC is a local successor.
	std::array<u16, DECODED_PAGE_WORDS> byAddress;
	const auto directory = std::span(byAddress).first(m_blocks.size());
	std::iota(directory.begin(), directory.end(), u16{0});
	std::ranges::sort(directory, {}, [&](u16 index) { return m_blocks[index].firstPc; });
	const auto entryForPc = [&](u32 pc) -> size_t {
		const auto entry = std::ranges::lower_bound(directory, pc, {}, [&](u16 index) { return m_blocks[index].firstPc; });
		return entry != directory.end() && m_blocks[*entry].firstPc == pc ? *entry : m_blocks.size();
	};
	for (auto& block : m_blocks) {
		const auto& final = block.instructions.back();
		size_t alternate = m_blocks.size();
		if (block.nativeSuccessor) {
			if (const auto* branch = std::get_if<NativeTruthBranch>(&final.operation))
				alternate = entryForPc(branch->target);
			else if (block.skippedWidth != 0 && std::holds_alternative<NativeComparison>(final.operation))
				alternate = entryForPc(final.pc + (u32{final.width} + block.skippedWidth) * INSTRUCTION_BYTES);
		}
		block.successors = {
			block.nativeSuccessor || block.inlineBuiltin ? entryForPc(block.terminal.nextPc) : m_blocks.size(),
			alternate,
		};
		block.inlineBuiltin &= block.successors[0] != m_blocks.size();
	}
	uses.analyze(m_blocks);
	NativeTypePropagation{}.specializeRegion(m_blocks, uses, values, m_entryTypes);
	for (auto& block : m_blocks) finalizeBlockExits(block, options.observesArithmetic);
	if (options.immutablePagePc) planRecordConstructors(directory, *options.immutablePagePc);
}

} // namespace bmsx
