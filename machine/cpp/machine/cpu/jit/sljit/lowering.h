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
	struct Workspace;
	NativeLowering(Workspace&, std::span<const std::unique_ptr<NativeBlock>> blocks,
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
	void lowerOperation(const NativeTableIterator&, const NativeInstruction&);
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
	void emitDynamicNumeric(const NativeArithmetic&, const NativeInstruction&, const NativeNumericPlan&);
	void emitFloatInput(int selector, ValueTag tag, sljit_s32 destination);
	void emitFloatCanonicalization(sljit_s32 reg);
	void emitWordOperand(int selector, NativeWordSource source, NativeBlockExitSite& invalid);
	sljit_jump* emitArrayRead(NativeBlockExitSite&, bool routeOutside = false);
	sljit_jump* emitArrayStore(int value, NativeStorePlan store, NativeBlockExitSite&, bool routeOutside);
	void emitOwnIndexRead(int base, NativeBlockExitSite&, std::optional<ValueTag> keyTag = {});
	void emitOwnIndexStore(int value, NativeNilValue, NativeBlockExitSite&, NativeHashStore key);
	enum class StoreBarrierRecord : u8 { Table, ClosedUpvalue };
	void emitStoreBarrier(int value, NativeGcBarrier, StoreBarrierRecord, NativeBlockExitSite&);
	void emitStoreBarriers();
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
	void emitStringStoreMisses();
	void admitTableValueWrite(NativeBlockExitSite&);
	void emitTableValueWrite(int value);
	void emitRamWordWriteWatch(NativeBlockExitSite&, sljit_s32 address, sljit_sw addressArg,
		sljit_s32 bits, sljit_s32 group, std::optional<u32> codeWords = 1u);
	// R2 is the host address; result is a word in R0 or external binary64 in FR0.
	void emitBackingLoad(MemoryAccessKind kind, bool unaligned);
	void emitRomReads();

	sljit_compiler* m_compiler;
	NativeRegisterCache m_cache;
	Workspace& m_workspace;
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
	struct Branch {
		sljit_jump* jump;
		size_t target;
	};
	struct ExternalBranch {
		sljit_jump* jump;
		sljit_label* coldEntry;
		NativeBlockLink* link;
	};
	struct ColdExit {
		SemanticExit target;
		State state;
		sljit_label* label = nullptr;
	};
	struct RomRead {
		sljit_jump* ramMiss;
		sljit_label* result;
		NativeBlockExitSite* bus;
		State registers;
		u32 width;
		MemoryAccessKind format;
	};
	struct StoreBarrier {
		sljit_jump* mutation;
		State registers;
		sljit_label* resumeStore;
		StoreBarrierRecord record;
		NativeBlockExitSite* exit;
	};
	struct SingleStringRead {
		std::array<sljit_jump*, 4> ownMisses;
		std::optional<StringId> fixedKey;
		State registers;
		NativeBlockExitSite* exit;
		sljit_label* result;
		i32* ownPrediction;
	};
	struct StringStoreMiss {
		std::array<sljit_jump*, 5> misses;
		State registers;
		NativeBlockExitSite* exit;
		sljit_label* resume;
		int value;
		std::optional<u16> keyIndex;
	};
	std::array<u8, NATIVE_BLOCK_MAX_INSTRUCTIONS> m_fieldAddressSpills;
	size_t m_current = 0, m_instruction = 0;
	bool m_terminal = false;
};

// Compiler-owned relocation and slow-path scratch. Labels and borrowed
// exit descriptors belong to one emission only; only their capacities persist.
struct NativeLowering::Workspace {
	std::vector<Entry> entries;
	std::vector<Branch> branches;
	std::vector<ExternalBranch> external;
	std::vector<ColdExit> coldExits;
	std::vector<Branch> coldBranches;
	std::vector<RomRead> romReads;
	std::vector<StoreBarrier> storeBarriers;
	std::vector<SingleStringRead> singleStringReads;
	std::vector<StringStoreMiss> stringStoreMisses;

	void prepare(std::span<const std::unique_ptr<NativeBlock>> blocks);
	void clear();
};

} // namespace bmsx
