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
		std::construct_at(&site.tableRead, tableSlot());
		break;
	case NativeBlockExit::WriteField:
	case NativeBlockExit::WriteIndex:
		std::construct_at(&site.tableStore, tableSlot());
		break;
	case NativeBlockExit::AllocateTable:
		site.recordConstructor = nullptr;
		break;
	default:
		break;
	}
	return site;
}

} // namespace

struct NativeCompiler::Workspace {
	NativeRegisterUses uses;
	NativeIrRegion ir;
	NativeLowering::Workspace lowering;
};

NativeCompiler::NativeCompiler() = default;
NativeCompiler::~NativeCompiler() = default;

std::vector<std::unique_ptr<NativeBlock>> NativeCompiler::compile(
	std::span<const NativeBlockSource> sources,
	const NativeCodeBindings& bindings, NativeCompilationOptions options, NativeCompileSpecializations specializations
) {
	if (!m_workspace) m_workspace = std::make_unique<Workspace>();
	auto& [uses, ir, lowering] = *m_workspace;
	ir.build(sources, uses, bindings.cpu != nullptr, options, specializations);
	const auto plans = ir.blocks();
	if (plans.empty()) return {};
#if defined(BMSX_NATIVE_IR_TRACE)
	traceNativeIr(ir);
#endif

	auto region = std::make_shared<NativeCodeRegion>();
	region->ram = bindings.ram;
	region->sourceInstructions = static_cast<u32>(ir.instructionCount());
	// Generated code embeds exit addresses. Finalize the region's contiguous
	// storage before binding any block view or passing addresses to SLJIT.
	const auto sideExits = ir.sideExits(), replays = ir.admissionReplays();
	auto& sites = region->m_exitSites;
	sites.reserve(sideExits.size() + replays.size());
	for (const auto& exit : sideExits) sites.push_back(materializeExit(exit, bindings));
	for (const auto& replay : replays) sites.push_back(materializeExit(replay, bindings));
	const auto published = std::span(sites);
	region->m_constructors.reserve(ir.recordPlans().size());
	for (const auto& record : ir.recordPlans()) region->m_constructors.emplace_back(record);
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
		block->sideExits = published.subspan(plan.firstSideExit, plan.sideExitCount);
		if (const auto* allocation = std::get_if<NativeTableAllocation>(&plan.instructions.back().operation);
			allocation && allocation->record)
			block->terminal.recordConstructor = &region->m_constructors[*allocation->record];
		entries.push_back(std::move(block));
	}
	lowering.prepare(entries);
	NativeLowering compiler(lowering, entries, bindings, plans, published.subspan(sideExits.size()), uses, specializations.imageConstants);
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
