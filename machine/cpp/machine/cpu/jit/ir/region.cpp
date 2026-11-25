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

	Flow operator()(const NativeTableAccess& op) const { return op.readPlan == NativeTableReadPlan::OwnSlot ? Flow::Linear : Flow::Checkpoint; }
	Flow operator()(const NativeVararg& op) const { return op.requested == 0 ? Flow::Linear : Flow::Checkpoint; }
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

struct NativeWindowExtent {
	const NativeSlotAccess& slots;
	bool cpuOwned;

	u32 operator()(const auto&) const { return slots.fixedExtent(); }
	u32 operator()(const auto& op) const requires requires { op.terminalExit; } { return cpuOwned ? slots.fixedExtent() : 0; }
	u32 operator()(const NativeReturnSite&) const { return 0; } // Only the receiving placement selects a source.
	u32 operator()(const NativeClosure&) const { return 0; } // CLOSURE admits its optional Bx register in the owner.
	u32 operator()(const NativeTableIterator& op) const { return op.ownsSkip() || cpuOwned ? slots.fixedExtent() : 0; }
	u32 operator()(const NativeVararg&) const { return 0; } // Placement admits its own range.
	u32 operator()(const NativeControlAccess& op) const {
		return op.mode == NativeControlMode::WriteSemantic ? 0 : slots.fixedExtent();
	}
	u32 operator()(const NativeCallSite& op) const {
		// The shared gate reads the callee. The return owner admits the
		// destination; only an in-region leaf also needs its arguments here.
		return cpuOwned ? u32{op.callee} + 1u : 0u;
	}
};

} // namespace

NativeOperationFlow nativeOperationFlow(const NativeOperation& operation) {
	return std::visit(OperationFlow{}, operation);
}

void NativeIrRegion::build(std::span<const NativeBlockSource> sources, NativeRegisterUses& uses, bool cpuOwned,
	NativeCompilationOptions options, NativeCompileSpecializations specializations) {
	m_blocks.clear();
	m_instructions.clear();
	m_entryTypes.clear();
	m_sideExits.clear();
	m_admissionReplays.clear();
	m_records.clear();
	m_ownFieldAddresses.clear();
	size_t instructionCount = 0;
	for (const auto& source : sources) instructionCount += source.instructions.size();
	m_instructions.reserve(instructionCount);
	m_blocks.reserve(sources.size());
	size_t fixedFieldReads = 0;
	for (const auto& source : sources) {
		for (const auto& inst : source.instructions) {
			auto operation = translateNativeOperation(*inst.decoded);
			if (auto* field = std::get_if<NativeTableAccess>(&operation); field && field->keyKind == NativeTableKey::Field) {
				if (field->readsFixedField()) ++fixedFieldReads;
				else if (field->mode == NativeTableMode::Write) {
					const auto hints = specializations.fieldGrowth;
					const auto hint = std::ranges::lower_bound(hints, inst.pc, {}, &NativeFieldGrowth::pc);
					if (hint != hints.end() && hint->pc == inst.pc) field->extraHashSlots = hint->extraHashSlots;
				}
			}
			if (const auto* load = std::get_if<NativeConstantLoad>(&operation)) {
				if (const auto constant = nativeImageConstant(specializations.imageConstants, load->index))
					operation = NativeLiteral{load->result, *constant};
			}
			m_instructions.emplace_back(std::move(operation));
		}
	}
	// Each fixed read can contribute one address definition. Keep the
	// backing buffer stable while the blocks borrow their address ranges.
	m_ownFieldAddresses.reserve(fixedFieldReads);
	m_values.beginRegion(m_instructions);
	std::array<NativeFieldAddressUse, NATIVE_BLOCK_MAX_INSTRUCTIONS> addressUses;
	size_t first = 0;
	for (const auto& source : sources) {
		const size_t count = source.instructions.size();
		auto operations = std::span(m_instructions).subspan(first, count);
		first += count;
		planNativeFieldReads(operations, source.instructions, m_values, addressUses, specializations);

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
	std::array<u16, DECODED_PAGE_WORDS * NATIVE_VERSION_REGION_MAX_PAGES> byAddress;
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
			else if (block.skippedWidth != 0)
				alternate = entryForPc(final.pc + (u32{final.width} + block.skippedWidth) * INSTRUCTION_BYTES);
		}
		block.successors = {
			block.nativeSuccessor || block.inlineBuiltin ? entryForPc(block.terminal.nextPc) : m_blocks.size(),
			alternate,
		};
		block.inlineBuiltin &= block.successors[0] != m_blocks.size();
	}
	m_flow.reset(m_blocks);
	uses.analyze(m_blocks, m_flow);
	m_types.specializeRegion(m_blocks, uses, m_values, m_entryTypes, specializations.imageConstants, options.observesArithmetic);
	for (auto& block : m_blocks) {
		auto& final = block.instructions.back();
		if (const auto* branch = std::get_if<NativeTruthBranch>(&final.operation);
			branch && branch->sourceTruthy) {
			const bool taken = *branch->sourceTruthy == branch->takeOnTruthy;
			const auto target = block.successors[taken];
			const bool proven = block.provesEntryTo(target);
			if (taken) block.terminal.nextPc = branch->target;
			final.operation = NativeJump{block.terminal.nextPc};
			final.slots = {};
			block.successors = {target, m_blocks.size()};
			block.provesSuccessorTypes = {proven, false};
		}
		finalizeBlockExits(block);
		for (const auto& type : block.entryTypes)
			block.requiredSlots = std::max(block.requiredSlots, u32{type.slot} + 1u);
		for (const auto& instruction : block.instructions) {
			block.requiredSlots = std::max(block.requiredSlots,
				std::visit(NativeWindowExtent{instruction.slots, cpuOwned}, instruction.operation));
			if (const auto* access = std::get_if<NativeUpvalueAccess>(&instruction.operation))
				block.requiredCaptures = std::max(block.requiredCaptures, static_cast<u16>(access->capture + 1u));
		}
		if (block.completedCall)
			block.requiredSlots = std::max(block.requiredSlots, block.instructions.back().slots.fixedExtent());
	}
	// Only local edges inherit a window. Unrelated functions can share an
	// executable allocation, and semantic continuations bind a fresh window.
	m_flow.solve([&](size_t index) {
		auto& block = m_blocks[index];
		const auto slots = block.requiredSlots;
		const auto captures = block.requiredCaptures;
		for (const auto target : block.successors) {
			if (target == m_blocks.size()) continue;
			const auto& successor = m_blocks[target];
			block.requiredSlots = std::max(block.requiredSlots, successor.requiredSlots);
			block.requiredCaptures = std::max(block.requiredCaptures, successor.requiredCaptures);
		}
		return slots != block.requiredSlots || captures != block.requiredCaptures;
	});
	planAdmissionReplays();
	if (options.immutableSource) planRecordConstructors(directory);
}

} // namespace bmsx
