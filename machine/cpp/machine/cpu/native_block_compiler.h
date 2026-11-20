#pragma once

#include <array>
#include <optional>
#include <vector>
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_block_registers.h"
#include "spec/blua32/memory_access_kind.h"
#include "sljitLir.h"

namespace bmsx {

class NativeBlockCompiler {
public:
	NativeBlockCompiler(ConstValueSpan constants, std::span<const std::unique_ptr<NativeBlock>> blocks,
		const NativeCodeBindings& bindings, std::span<const NativeBlockSource> sources);
	~NativeBlockCompiler();
	void beginBlock(size_t index);
	void emit(const DecodedInstruction& instruction, NativeBlockExitSite* slow, NativeBlockExitSite* taken);
	void endBlock();
	void* finish(size_t& codeBytes);

private:
	using State = NativeRegisterCache::State;
	void emitExit(NativeBlockExitSite& exit);
	void emitScalarBoundary(u32 pc, int cycles, int top);
	void emitTop(int extent);
	void emitBuiltinCall(const DecodedInstruction& instruction);
	void emitConstant(int guest, Value value);
	void emitRawLoad(int selector, sljit_s32 word, sljit_s32 tag);
	void emitRawStore(int guest, sljit_s32 word, sljit_s32 tag);
	NativeRegisterCache::Operand readTyped(
		int selector, ValueTag tag, sljit_s32 wordScratch = SLJIT_R0, sljit_s32 floatScratch = SLJIT_FR0);
	int knownTag(int selector) const;
	void fault(sljit_jump* jump, NativeBlockExitSite& exit, const State& state, bool charged = false);
	void emitLeave(NativeBlockExitSite& exit, bool charged);
	void emitWordMove(const DecodedInstruction& instruction, NativeBlockExitSite* invalid);
	void emitNumeric(const DecodedInstruction& instruction, NativeBlockExitSite& invalid);
	void emitNumericKernel(const DecodedInstruction& instruction, NativeBlockExitSite& invalid, int resultTag);
	void emitFloatInput(int selector, sljit_s32 destination);
	void emitFloatCanonicalization(sljit_s32 reg);
	void emitVararg(const DecodedInstruction&, NativeBlockExitSite& growth);
	void emitContext(const DecodedInstruction& instruction, NativeBlockExitSite* watched);
	void emitNilRange(int first, int count);
	void emitWordOperand(int selector, NativeBlockExitSite& invalid);
	void emitConstantIndex(const DecodedInstruction&, NativeBlockExitSite&);
	void emitUpvalue(const DecodedInstruction&, NativeBlockExitSite*);
	void emitControl(const DecodedInstruction&, NativeBlockExitSite*);
	void emitTableAccess(const DecodedInstruction&, NativeBlockExitSite&);
	std::array<sljit_jump*, 2> emitArrayRead();
	void emitArrayStore(int value, NativeBlockExitSite&);
	void emitIndexRead(int key, NativeBlockExitSite&);
	void emitStringSlot(bool load, int value, NativeBlockExitSite&, std::optional<StringId> constantKey = std::nullopt);
	void emitTableReadLeaf(bool stringKey, NativeBlockExitSite&);
	void emitTableSlotStore(int value);
	void emitTableSlotOffset(sljit_s32 destination, bool word);
	void emitTableSlotLoad(sljit_s32 destination, bool word);
	void emitTableWriteWatch(NativeBlockExitSite&, bool arraySlot);
	void emitGrayChange(NativeBlockExitSite&, sljit_s32 offset, sljit_sw offsetArg, sljit_s32 record,
		sljit_s32 scratch, sljit_s32 link, u32 linkOffset, u32 watchedWords);
	void emitRamWordWriteWatch(NativeBlockExitSite&, sljit_s32 address, sljit_sw addressArg, sljit_s32 bits, sljit_s32 group, u32 wordMask = 1u);
	void emitLength(const DecodedInstruction&, NativeBlockExitSite&);
	// R2 is the host address; result is a word in R0 or external binary64 in FR0.
	void emitBackingLoad(MemoryAccessKind kind, bool unaligned);
	void emitRomReads();
	void emitMemory(const DecodedInstruction&, NativeBlockExitSite&);
	void emitComparison(const DecodedInstruction& instruction, NativeBlockExitSite& taken);
	size_t regionEntryIndex(u32 pc) const;
	void analyzeEntryLiveness();
	bool entryReads(size_t entry, int guest) const;

	sljit_compiler* m_compiler;
	NativeRegisterCache m_cache;
	ConstValueSpan m_constants;
	std::span<const std::unique_ptr<NativeBlock>> m_blocks;
	const NativeCodeBindings& m_bindings;
	std::span<const NativeBlockSource> m_sources;
	struct Entry {
		State registers{};
		sljit_label* guarded = nullptr;
		sljit_label* proven = nullptr;
		bool planned = false;
		bool hasForwardPredecessor = false;
	};
	std::vector<Entry> m_entries;
	size_t m_liveWordCount = 0;
	std::vector<u64> m_entryLive;
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
		bool charged;
	};
	std::vector<SlowPath> m_slow;
	struct RomRead {
		sljit_jump* ramMiss;
		sljit_label* result;
		NativeBlockExitSite* bus;
		State registers;
		u32 width;
	};
	std::vector<RomRead> m_romReads;
	struct Admission {
		sljit_jump* jump;
		u32 pc;
		State state;
	};
	std::vector<Admission> m_admissions;
	size_t m_current = 0, m_instruction = 0;
	int m_prefixCycles = 0, m_prefixTop = 0;
	bool m_terminal = false;
	bool m_controlPrivilegeGuarded = false;
};

} // namespace bmsx
