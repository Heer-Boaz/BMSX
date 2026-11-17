#pragma once

#include <array>
#include <vector>
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_block_registers.h"
#include "sljitLir.h"

namespace bmsx {

class NativeBlockCompiler {
public:
	NativeBlockCompiler(ConstValueSpan constants, std::span<const std::unique_ptr<NativeBlock>> blocks,
		const NativeCodeBindings& bindings, std::span<const NativeBlockSource> sources);
	~NativeBlockCompiler();
	void beginBlock(size_t index, bool inheritRegisters);
	void emit(const DecodedInstruction& instruction, NativeBlockExitSite* slow, NativeBlockExitSite* taken);
	void endBlock(bool fallthrough);
	void* finish(size_t& codeBytes);

private:
	using State = NativeRegisterCache::State;
	void emitExit(NativeBlockExitSite& exit);
	void emitScalarBoundary(u32 pc, int cycles, int top);
	void emitTop(int extent);
	void emitConstant(int guest, Value value);
	void emitRawLoad(int selector, sljit_s32 word, sljit_s32 tag);
	void emitRawStore(int guest, sljit_s32 word, sljit_s32 tag);
	NativeRegisterCache::Operand readTyped(
		int selector, ValueTag tag, sljit_s32 wordScratch = SLJIT_R0, sljit_s32 floatScratch = SLJIT_FR0);
	int knownTag(int selector) const;
	void fault(sljit_jump* jump, NativeBlockExitSite& exit, const State& state);
	void emitWordMove(const DecodedInstruction& instruction, NativeBlockExitSite* invalid);
	void emitNumeric(const DecodedInstruction& instruction, NativeBlockExitSite& invalid);
	void emitNumericKernel(const DecodedInstruction& instruction, NativeBlockExitSite& invalid, int resultTag);
	void emitFloatInput(int selector, sljit_s32 destination);
	void emitFloatCanonicalization(sljit_s32 reg);
	void emitContext(const DecodedInstruction& instruction);
	void emitNilRange(int first, int count);
	void emitComparison(const DecodedInstruction& instruction, NativeBlockExitSite& taken);
	size_t regionEntryIndex(u32 pc) const;

	sljit_compiler* m_compiler;
	NativeRegisterCache m_cache;
	ConstValueSpan m_constants;
	std::span<const std::unique_ptr<NativeBlock>> m_blocks;
	const NativeCodeBindings& m_bindings;
	std::span<const NativeBlockSource> m_sources;
	std::vector<sljit_label*> m_entries;
	struct Branch {
		sljit_jump* jump;
		size_t target;
	};
	std::vector<Branch> m_branches;
	struct ExternalBranch {
		sljit_jump* jump;
		NativeBlockLink* link;
	};
	std::vector<ExternalBranch> m_external;
	struct SlowPath {
		sljit_jump* jump;
		NativeBlockExitSite* exit;
		State state;
	};
	std::vector<SlowPath> m_slow;
	struct Admission {
		sljit_jump* jump;
		u32 pc;
	};
	std::vector<Admission> m_admissions;
	size_t m_current = 0, m_instruction = 0;
	int m_prefixCycles = 0, m_prefixTop = 0;
	bool m_terminal = false;
};

} // namespace bmsx
