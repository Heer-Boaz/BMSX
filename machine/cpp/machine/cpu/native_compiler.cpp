#include "machine/cpu/native_compiler.h"

#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_liveness.h"
#include "machine/cpu/native_lowering.h"
#include "machine/memory/memory.h"

namespace bmsx {

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
	if (ir.entries.empty()) return {};
	auto region = std::make_shared<NativeCodeRegion>();
	region->ram = bindings.ram;
	region->sourceInstructions = static_cast<u32>(ir.instructionCount());
	const auto& gate = nativeBlockGate();
	for (auto& block : ir.entries) {
		block->region = region;
		block->m_gate = &gate;
	}
	NativeRegisterUses uses;
	ir.optimize(constants, uses);
	NativeLowering compiler(constants, ir.entries, bindings, ir.blocks(), uses);
	for (size_t index = 0; index < ir.blocks().size(); ++index) {
		compiler.beginBlock(index);
		for (const auto& instruction : ir.blocks()[index].instructions)
			compiler.lower(instruction);
		compiler.endBlock();
	}
	region->m_code = compiler.finish(region->codeBytes, region->m_replaySites);
	return std::move(ir.entries);
}

} // namespace bmsx
