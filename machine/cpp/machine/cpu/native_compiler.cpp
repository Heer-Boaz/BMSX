#include "machine/cpu/native_compiler.h"

#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_liveness.h"
#include "machine/cpu/native_lowering.h"
#include "machine/cpu/native_table_constructor.h"
#include "machine/memory/memory.h"

namespace bmsx {
namespace {

NativeBlockExitSite materializeExit(const NativeIrExit& exit) {
	NativeBlockExitSite site{
		.exit = exit.exit, .operands = exit.operands,
		.cycles = exit.cycles, .registerTop = exit.registerTop,
		.nextPc = exit.nextPc, .currentPc = exit.currentPc, .lastPc = exit.lastPc,
		.link = {},
	};
	switch (exit.exit) {
	case NativeBlockExit::ReadField:
	case NativeBlockExit::ReadIndex:
		std::construct_at(&site.tableReadCache, TableStringReadCache{
			.receiverSlot = exit.tableSlotSeed, .holderSlot = -1, .holderDepth = 0, .indexSlots = {-1, -1, -1}});
		break;
	case NativeBlockExit::WriteField:
	case NativeBlockExit::WriteIndex:
		std::construct_at(&site.tableStore, NativeTableStorePrediction{exit.tableSlotSeed, nullptr});
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

NativeCodeBindings::NativeCodeBindings(Memory& memory, StringPool& pool, CPU* cpu)
	: ramBytes(memory.ramByteCount()), ram(memory.ramData()), ramBusEnd(memory.ramBusEndAddress()),
	  ramWriteGroups(memory.ramWriteWatches().groupData()),
	  ramCodeWatchWords(memory.ramWriteWatches().codeWordMasks()),
	  memory(&memory), strings(&pool), cpu(cpu) {}

std::vector<std::unique_ptr<NativeBlock>> NativeCompiler::compile(
	std::span<const NativeBlockSource> sources, ConstValueSpan constants,
	const NativeCodeBindings& bindings, NativeCompilationOptions options
) {
	NativeIrRegion ir(sources, constants, bindings.cpu != nullptr, options);
	const auto plans = ir.blocks();
	if (plans.empty()) return {};
	NativeRegisterUses uses;
	ir.optimize(constants, uses);

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
		block->terminal = materializeExit(plan.terminal);
		const auto sideExits = ir.sideExits(plan);
		block->sideExits.reserve(sideExits.size());
		for (const auto& exit : sideExits) block->sideExits.push_back(materializeExit(exit));
		if (const auto* allocation = std::get_if<NativeTableAllocation>(&plan.instructions.back().operation);
			allocation && allocation->record)
			block->terminal.recordConstructor = new NativeTableConstructor(ir.recordPlans()[*allocation->record]);
		entries.push_back(std::move(block));
	}
	NativeLowering compiler(constants, entries, bindings, plans, uses);
	for (size_t index = 0; index < plans.size(); ++index) {
		compiler.beginBlock(index);
		for (const auto& instruction : plans[index].instructions)
			compiler.lower(instruction);
		compiler.endBlock();
	}
	region->m_code = compiler.finish(region->codeBytes, region->m_replaySites);
	return entries;
}

} // namespace bmsx
