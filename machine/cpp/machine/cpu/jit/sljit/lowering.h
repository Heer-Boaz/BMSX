#pragma once

#include <array>
#include <optional>
#include <vector>
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/sljit/abi.h"
#include "machine/cpu/jit/sljit/register_cache.h"
#include "machine/cpu/jit/compiler.h"
#include "machine/cpu/jit/ir/region.h"
#include "machine/cpu/jit/ir/liveness.h"
#include "machine/cpu/jit/ir/type_propagation.h"
#include "spec/blua32/memory_access_kind.h"
#include "sljitLir.h"

namespace bmsx {

class NativeLowering {
public:
	NativeLowering(std::span<const std::unique_ptr<NativeBlock>> blocks,
		const NativeCodeBindings& bindings, std::span<const NativeIrBlock> ir, std::span<NativeBlockExitSite> replays,
		NativeRegisterUses& uses, std::span<const NativeImageConstant> constants);
	~NativeLowering();
	void beginBlock(size_t index);
	void lower(const NativeInstruction& instruction);
	void endBlock();
	void* finish(size_t& codeBytes);

private:
	using State = NativeRegisterCache::State;
	NativeBlockExitSite* sideExit(NativeIrSideExit id) {
		return id ? &m_blocks[m_current]->sideExits[*id] : nullptr;
	}
	void lowerOperation(const NativeReplay&, const NativeInstruction&);
	void lowerOperation(const NativeJump&, const NativeInstruction&);
	void lowerOperation(const auto& op, const NativeInstruction&)
		requires requires { op.terminalExit; }
	{
		emitExit(m_blocks[m_current]->terminal);
	}
	void lowerOperation(const NativeLiteral&, const NativeInstruction&);
	void lowerOperation(const NativeConstantLoad&, const NativeInstruction&);
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

	void emitExit(NativeBlockExitSite& exit, size_t edge = 0, sljit_label** sharedExternal = nullptr);
	void emitTop(int extent);
	void emitConstant(int guest, Value value);
	void emitPoolWord(u32 index, sljit_s32 word);
	void emitPoolTag(u32 index, sljit_s32 tag);
	sljit_jump* guardTag(int selector, ValueTag tag, sljit_s32 scratch);
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
	void fault(sljit_jump* jump, NativeBlockExitSite& site, const State& state, Charge charge = Charge::Pending);
	void emitLeave(NativeBlockExitSite& exit, Charge charge);
	void emitNumericKernel(const NativeArithmetic&, const NativeInstruction&, const NativeNumericPlan&);
	void emitFloatInput(int selector, ValueTag tag, sljit_s32 destination);
	void emitFloatCanonicalization(sljit_s32 reg);
	void emitWordOperand(int selector, NativeWordSource source, NativeBlockExitSite& invalid);
	sljit_jump* emitArrayRead(NativeBlockExitSite&, bool routeOutside = false);
	void emitArrayStore(int value, NativeStorePlan store, NativeBlockExitSite&);
	void emitTableStoreBarrier(int value, NativeGcBarrier);
	void emitTableStoreBarriers();
	void assignFieldAddressSpills(std::span<const NativeOwnFieldAddress>);
	std::array<sljit_jump*, 3> emitStringValueAddress(NativeBlockExitSite&, bool load,
		std::optional<StringId> fixedKey, std::optional<u8> temporary);
	sljit_jump* emitStringValueTag(bool load, std::optional<ValueTag> resultTag);
	void emitStringPayload();
	void emitStringSlot(bool load, int value, NativeBlockExitSite&, std::optional<u16> keyIndex,
		std::optional<ValueTag> resultTag, NativeStorePlan store, NativeTableReadPlan,
		std::optional<u8> temporary = {});
	void emitReusedFieldAddress(u8 temporary, u16 keyIndex, NativeBlockExitSite&, std::optional<ValueTag> resultTag);
	void emitFieldResult(int slot, std::optional<ValueTag> resultTag);
	void emitSingleStringReads();
	void admitTableValueWrite(NativeBlockExitSite&);
	void emitTableValueWrite(int value);
	// flags cannot address the mark byte; test is first clobbered after the load.
	sljit_jump* emitGcMutationBranch(sljit_s32 mark, sljit_sw markArg,
		int source, NativeGcBarrier, sljit_s32 flags, sljit_s32 test);
	void emitGuardNoGcMutation(NativeBlockExitSite&, sljit_s32 mark, sljit_sw markArg,
		int source, NativeGcBarrier barrier, sljit_s32 scratch, sljit_s32 test);
	void emitRamWordWriteWatch(NativeBlockExitSite&, sljit_s32 address, sljit_sw addressArg,
		sljit_s32 bits, sljit_s32 group, std::optional<u32> codeWords = 1u);
	// R2 is the host address; result is a word in R0 or external binary64 in FR0.
	void emitBackingLoad(MemoryAccessKind kind, bool unaligned);
	void emitRomReads();

	sljit_compiler* m_compiler;
	NativeRegisterCache m_cache;
	std::span<const std::unique_ptr<NativeBlock>> m_blocks;
	const NativeCodeBindings& m_bindings;
	DecodedInstruction* m_decodedPage = nullptr;
	std::span<const NativeIrBlock> m_ir;
	std::span<NativeBlockExitSite> m_admissionReplays;
	NativeRegisterUses& m_uses;
	std::span<const NativeImageConstant> m_constants;
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
		SemanticExit target;
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
	struct TableStoreBarrier {
		sljit_jump* mutation;
		State registers;
		sljit_label* resumeStore;
	};
	std::vector<TableStoreBarrier> m_tableStoreBarriers;
	struct SingleStringRead {
		std::array<sljit_jump*, 4> ownMisses;
		std::optional<StringId> fixedKey;
		State registers;
		NativeBlockExitSite* exit;
		sljit_label* result;
		i32* ownPrediction;
	};
	std::vector<SingleStringRead> m_singleStringReads;
	std::array<u8, NATIVE_BLOCK_MAX_INSTRUCTIONS> m_fieldAddressSpills;
	size_t m_current = 0, m_instruction = 0;
	bool m_terminal = false;
};

} // namespace bmsx
