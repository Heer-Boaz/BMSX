#pragma once

#include <array>
#include <optional>
#include <vector>
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_block_registers.h"
#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_liveness.h"
#include "machine/cpu/native_ir_optimize.h"
#include "spec/blua32/memory_access_kind.h"
#include "sljitLir.h"

namespace bmsx {

class NativeLowering {
public:
	NativeLowering(ConstValueSpan constants, std::span<const std::unique_ptr<NativeBlock>> blocks,
		const NativeCodeBindings& bindings, std::span<const NativeIrBlock> ir);
	~NativeLowering();
	void beginBlock(size_t index);
	void lower(const NativeInstruction& instruction);
	void endBlock();
	void* finish(size_t& codeBytes);

private:
	using State = NativeRegisterCache::State;
	void emitExit(NativeBlockExitSite& exit, size_t target);
	void emitScalarBoundary(NativeResumePoint point);
	void emitTop(int extent);
	void emitBuiltinCall(const NativeOperands& instruction);
	void emitConstant(int guest, Value value);
	void emitRawLoad(int selector, sljit_s32 word, sljit_s32 tag);
	void emitRawStore(int guest, sljit_s32 word, sljit_s32 tag);
	NativeRegisterCache::Operand readTyped(
		int selector, ValueTag tag, sljit_s32 wordScratch = SLJIT_R0, sljit_s32 floatScratch = SLJIT_FR0);
	int knownTag(int selector) const;
	enum class Charge : u8 { Pending, Paid };
	struct SemanticExit {
		NativeBlockExitSite* site;
		Charge charge;
		bool operator==(const SemanticExit&) const = default;
	};
	using ExitTarget = std::variant<NativeResumePoint, SemanticExit>;
	void fault(sljit_jump* jump, NativeBlockExitSite& site, const State& state, Charge charge = Charge::Pending);
	void deferColdExit(sljit_jump* jump, ExitTarget target, const State& state);
	void emitLeave(NativeBlockExitSite& exit, Charge charge);
	void emitWordMove(const NativeOperands& instruction, NativeBlockExitSite* invalid);
	void emitNumeric(const NativeInstruction& instruction);
	void emitNumericKernel(const NativeOperands& instruction, NativeBlockExitSite& invalid, std::optional<ValueTag> resultTag);
	void emitFloatInput(int selector, ValueTag tag, sljit_s32 destination);
	void emitFloatCanonicalization(sljit_s32 reg);
	void emitVararg(const NativeOperands&, NativeBlockExitSite& growth);
	void emitContext(const NativeOperands& instruction, NativeBlockExitSite* watched);
	void emitNilRange(int first, int count);
	void emitWordOperand(int selector, NativeBlockExitSite& invalid);
	void emitConstantIndex(const NativeOperands&, NativeBlockExitSite&);
	void emitUpvalue(const NativeOperands&, NativeBlockExitSite*);
	void emitControl(const NativeOperands&, NativeBlockExitSite*, NativeControlAccess);
	void emitTableAccess(const NativeOperands&, NativeBlockExitSite&, ValueTag fieldValueTag);
	std::array<sljit_jump*, 2> emitArrayRead();
	void emitArrayStore(int value, NativeBlockExitSite&);
	void emitIndexRead(int key, NativeBlockExitSite&);
	sljit_jump* emitStringSlot(bool load, int value, NativeBlockExitSite&, std::optional<StringId> constantKey = std::nullopt, ValueTag loadTag = ValueTag::Nil);
	void emitTableReadLeaf(bool stringKey, NativeBlockExitSite&);
	void emitTableSlotStore(int value);
	void emitTableSlotOffset(sljit_s32 destination, bool word);
	void emitTableSlotLoad(sljit_s32 destination, bool word);
	void emitTableWriteWatch(NativeBlockExitSite&, bool arraySlot, int value);
	std::array<sljit_jump*, 2> emitSkipScalarBarrier(int value, sljit_s32 scratch);
	void emitGrayChange(NativeBlockExitSite&, sljit_s32 offset, sljit_s32 record, u32 link);
	void emitRamWordWriteWatch(NativeBlockExitSite&, sljit_s32 address, sljit_sw addressArg, sljit_s32 bits, sljit_s32 group, u32 wordMask = 1u);
	void emitLength(const NativeOperands&, NativeBlockExitSite&);
	// R2 is the host address; result is a word in R0 or external binary64 in FR0.
	void emitBackingLoad(MemoryAccessKind kind, bool unaligned);
	void emitRomReads();
	void emitMemory(const NativeOperands&, NativeBlockExitSite&);
	void emitComparison(const NativeOperands& instruction, NativeBlockExitSite& taken);

	sljit_compiler* m_compiler;
	NativeRegisterCache m_cache;
	ConstValueSpan m_constants;
	std::span<const std::unique_ptr<NativeBlock>> m_blocks;
	const NativeCodeBindings& m_bindings;
	std::span<const NativeIrBlock> m_ir;
	NativeRegisterUses m_uses;
	NativeTypePropagation m_types;
	struct Entry {
		State registers{};
		sljit_label* guarded = nullptr;
		sljit_label* proven = nullptr;
		bool planned = false;
	};
	std::vector<Entry> m_entries;
	struct Branch {
		sljit_jump* jump;
		size_t target;
	};
	std::vector<Branch> m_branches;
	struct ExternalBranch {
		sljit_jump* jump;
		sljit_label* coldEntry;
		NativeBlockLink* link;
	};
	std::vector<ExternalBranch> m_external;
	struct ColdExit {
		ExitTarget target;
		State state;
		sljit_label* label = nullptr;
	};
	std::vector<ColdExit> m_coldExits;
	std::vector<Branch> m_coldBranches;
	struct RomRead {
		sljit_jump* ramMiss;
		sljit_label* result;
		NativeBlockExitSite* bus;
		State registers;
		u32 width;
	};
	std::vector<RomRead> m_romReads;
	size_t m_current = 0, m_instruction = 0;
	bool m_terminal = false;
};

} // namespace bmsx
