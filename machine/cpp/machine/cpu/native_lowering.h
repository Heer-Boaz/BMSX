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
		const NativeCodeBindings& bindings, std::span<const NativeIrBlock> ir, NativeRegisterUses& uses);
	~NativeLowering();
	void beginBlock(size_t index);
	void lower(const NativeInstruction& instruction);
	void endBlock();
	void* finish(size_t& codeBytes, std::vector<NativeBlockExitSite>& replaySites);

private:
	using State = NativeRegisterCache::State;
	void lowerOperation(const NativeReplay&, const NativeInstruction&);
	void lowerOperation(const NativeJump&, const NativeInstruction&);
	void lowerOperation(const auto& op, const NativeInstruction&)
		requires requires { op.terminalExit; }
	{
		emitExit(m_blocks[m_current]->terminal, m_ir[m_current].successors[0]);
	}
	void lowerOperation(const NativeLiteral&, const NativeInstruction&);
	void lowerOperation(const NativeMove&, const NativeInstruction&);
	void lowerOperation(const NativeNot&, const NativeInstruction&);
	void lowerOperation(const NativeClearSlots&, const NativeInstruction&);
	void lowerOperation(const NativeArithmetic&, const NativeInstruction&);
	void lowerOperation(const NativeGlobalAccess&, const NativeInstruction&);
	void lowerOperation(const NativePoolRead&, const NativeInstruction&);
	void lowerOperation(const NativeUpvalueAccess&, const NativeInstruction&);
	void lowerOperation(const NativeControlAccess&, const NativeInstruction&);
	void lowerOperation(const NativeLength&, const NativeInstruction&);
	void lowerOperation(const NativeMemoryAccess&, const NativeInstruction&);
	void lowerOperation(const NativeTruthBranch&, const NativeInstruction&);
	void lowerOperation(const NativeComparison&, const NativeInstruction&);
	void lowerOperation(const NativeCallSite&, const NativeInstruction&);
	void lowerOperation(const NativeTableAccess&, const NativeInstruction&);
	void lowerOperation(const NativeVararg&, const NativeInstruction&);

	void emitExit(NativeBlockExitSite& exit, size_t target);
	void emitTop(int extent);
	void emitConstant(int guest, Value value);
	void emitPayload(int selector, sljit_s32 word);
	void emitTag(int selector, sljit_s32 tag);
	void emitRawLoad(int selector, sljit_s32 word, sljit_s32 tag);
	void emitRawStore(int guest, sljit_s32 word, sljit_s32 tag);
	NativeRegisterCache::Operand readTyped(
		int selector, ValueTag tag, sljit_s32 wordScratch = SLJIT_R0, sljit_s32 floatScratch = SLJIT_FR0);
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
	void emitNumericKernel(const NativeArithmetic&, NativeBlockExitSite& invalid, std::optional<ValueTag> resultTag);
	void emitFloatInput(int selector, ValueTag tag, sljit_s32 destination);
	void emitFloatCanonicalization(sljit_s32 reg);
	void emitWordOperand(int selector, NativeWordSource source, NativeBlockExitSite& invalid);
	void emitArrayRead(NativeBlockExitSite&);
	void emitArrayStore(int value, NativeStorePlan store, NativeBlockExitSite&);
	void emitStringSlot(bool load, int value, NativeBlockExitSite&, std::optional<StringId> constantKey,
		std::optional<ValueTag> resultTag, NativeStorePlan store);
	void emitTableSlotOffset(sljit_s32 destination, bool word);
	void emitTableSlotLoad(sljit_s32 destination, bool word);
	void emitTableOverwrite(NativeBlockExitSite&, int value, NativeGcBarrier);
	// scratch cannot address the mark byte; test is first clobbered after the load.
	void emitGuardNoGcMutation(NativeBlockExitSite&, sljit_s32 mark, sljit_sw markArg,
		int source, NativeGcBarrier barrier, sljit_s32 scratch, sljit_s32 test);
	void emitRamWordWriteWatch(NativeBlockExitSite&, sljit_s32 address, sljit_sw addressArg, sljit_s32 bits, sljit_s32 group, u32 wordMask = 1u);
	// R2 is the host address; result is a word in R0 or external binary64 in FR0.
	void emitBackingLoad(MemoryAccessKind kind, bool unaligned);
	void emitRomReads();

	sljit_compiler* m_compiler;
	NativeRegisterCache m_cache;
	ConstValueSpan m_constants;
	std::span<const std::unique_ptr<NativeBlock>> m_blocks;
	const NativeCodeBindings& m_bindings;
	std::span<const NativeIrBlock> m_ir;
	NativeRegisterUses& m_uses;
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
		MemoryAccessKind format;
	};
	std::vector<RomRead> m_romReads;
	size_t m_current = 0, m_instruction = 0;
	bool m_terminal = false;
};

} // namespace bmsx
