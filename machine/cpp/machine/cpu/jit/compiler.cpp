#include "machine/cpu/jit/compiler.h"

#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/execution_image.h"
#if defined(BMSX_NATIVE_IR_TRACE)
#include "machine/cpu/jit/ir/dump.h"
#endif
#include "machine/cpu/jit/sljit/gate.h"
#include "machine/cpu/jit/ir/region.h"
#include "machine/cpu/jit/ir/liveness.h"
#include "machine/cpu/jit/sljit/lowering.h"
#include "machine/cpu/jit/runtime/record_constructor.h"

namespace bmsx {

DecodedInstruction* NativeCodeBindings::decodedPageFor(u32 pc) const {
	if (sourcePages.empty()) return nullptr; // Standalone compilation.
	const u32 pagePc = pc & ~MAPPED_PAGE_BYTE_MASK;
	return std::ranges::lower_bound(sourcePages, pagePc, {}, &NativeCodeSourcePage::pc)->page->words.data();
}

namespace {

NativeBlockExitSite materializeExit(const NativeIrExit& exit, const NativeCodeBindings& bindings) {
	NativeBlockExitSite site{
		.exit = exit.exit, .operands = exit.operands,
		.cycles = exit.cycles, .registerTop = exit.registerTop,
		.nextPc = exit.nextPc, .currentPc = exit.currentPc, .lastPc = exit.lastPc,
		.link = {},
	};
	const auto tableSlot = [&] {
		const u32 word = (exit.currentPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		auto* decodedPage = bindings.decodedPageFor(exit.currentPc);
		return decodedPage
			? NativeTableSlotBinding{.decoded = &decodedPage[word].tableCacheSlot()}
			: NativeTableSlotBinding{.standalone = exit.tableSlotSeed};
	};
	switch (exit.exit) {
	case NativeBlockExit::ReadField:
	case NativeBlockExit::ReadIndex:
		std::construct_at(&site.tableRead, NativeTableReadPrediction{tableSlot(), {-1, 0, {-1, -1, -1}}});
		break;
	case NativeBlockExit::WriteField:
	case NativeBlockExit::WriteIndex:
		std::construct_at(&site.tableStore, tableSlot());
		break;
	case NativeBlockExit::AllocateTable:
		site.recordConstructor = nullptr;
		break;
	case NativeBlockExit::Call:
		if (site.operands.call.strategy == NativeCallStrategy::Observe) {
			const u32 word = (exit.currentPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
			site.observingCall = &bindings.decodedPageFor(exit.currentPc)[word];
		}
		break;
	default:
		break;
	}
	return site;
}

} // namespace

std::vector<std::unique_ptr<NativeBlock>> NativeCompiler::compile(
	std::span<const NativeBlockSource> sources,
	const NativeCodeBindings& bindings, NativeCompilationOptions options, NativeCompileSpecializations specializations
) {
	NativeRegisterUses uses;
	NativeIrRegion ir(sources, uses, bindings.cpu != nullptr, options, specializations);
	const auto plans = ir.blocks();
	if (plans.empty()) return {};
#if defined(BMSX_NATIVE_IR_TRACE)
	traceNativeIr(ir);
#endif

	auto region = std::make_shared<NativeCodeRegion>();
	region->ram = bindings.ram;
	region->sourceInstructions = static_cast<u32>(ir.instructionCount());
	const auto& gate = nativeBlockGate();
	std::vector<std::unique_ptr<NativeBlock>> entries;
	entries.reserve(plans.size());
	for (const auto& plan : plans) {
		auto block = std::unique_ptr<NativeBlock>(new NativeBlock());
		block->region = region;
		block->m_gate = &gate;
		block->firstPc = plan.firstPc;
		block->admissionCycles = plan.admissionCycles;
		block->sourceWords = plan.sourceWords;
		block->hasFusedJump = plan.hasFusedJump;
		block->terminal = materializeExit(plan.terminal, bindings);
		const auto sideExits = ir.sideExits(plan);
		block->sideExits.reserve(sideExits.size());
		for (const auto& exit : sideExits) block->sideExits.push_back(materializeExit(exit, bindings));
		if (const auto* allocation = std::get_if<NativeTableAllocation>(&plan.instructions.back().operation);
			allocation && allocation->record)
			block->terminal.recordConstructor = new NativeTableConstructor(ir.recordPlans()[*allocation->record]);
		if (const auto* call = std::get_if<NativeCallSite>(&plan.instructions.back().operation); call && call->fixed)
			block->terminal.fixedCall = {*call->fixed, {}};
		entries.push_back(std::move(block));
	}
	const auto replays = ir.admissionReplays();
	region->m_replaySites.reserve(replays.size());
	for (const auto& replay : replays)
		region->m_replaySites.push_back(materializeExit(replay, bindings));
	NativeLowering compiler(entries, bindings, plans, region->m_replaySites, uses, specializations.imageConstants);
	for (size_t index = 0; index < plans.size(); ++index) {
		compiler.beginBlock(index);
		for (const auto& instruction : plans[index].instructions)
			compiler.lower(instruction);
		compiler.endBlock();
	}
	region->m_code = compiler.finish(region->codeBytes);
	return entries;
}

} // namespace bmsx
