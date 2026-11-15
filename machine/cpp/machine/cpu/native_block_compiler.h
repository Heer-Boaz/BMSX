#pragma once

#include <array>
#include <vector>

#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/memory/mapped_page.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"
#include "sljitLir.h"

namespace bmsx {

class NativeBlockCompiler {
public:
	NativeBlockCompiler(const Value* constants, std::span<const std::unique_ptr<NativeBlock>> blocks, const NativeCodeBindings& bindings,
		std::span<const NativeBlockSource> sources, NativeLoweringStats* lowering);
	~NativeBlockCompiler();
	void emit(const DecodedInstruction& instruction, NativeBlockExitSite* slowExit,
		NativeBlockExitSite* takenExit);
	void beginBlock(size_t index, bool inheritRegisters);
	void emitAdmission(size_t index, bool materialize);
	void emitEntryTableFacts(size_t index, bool materialize);
	void endBlock(bool fallthrough);
	void* finish(size_t& codeBytes);

private:
	struct SlowPath;
	void emitBuiltinCall(const DecodedInstruction& instruction);
	void emitControl(const DecodedInstruction& instruction, NativeBlockExitSite* exit);
	void emitExit(NativeBlockExitSite* exit, bool fallthrough = false);
	void emitSegmentCharge(const NativeBlockExitSite& exit);
	void emitTableAccess(const DecodedInstruction& instruction, NativeBlockExitSite* exit);
	void emitArraySlot(bool load, int value, SlowPath& slow);
	void emitStringSlot(bool load, int value, SlowPath& slow);
	void emitLength(const DecodedInstruction& instruction, NativeBlockExitSite* exit);
	void emitComparison(const DecodedInstruction& instruction, NativeBlockExitSite* skipped);
	void emitContext(const DecodedInstruction& instruction, NativeBlockExitSite* exit);
	void emitUpvalue(const DecodedInstruction& instruction, NativeBlockExitSite* exit);
	void emitVararg(const DecodedInstruction& instruction, NativeBlockExitSite* exit);
	void emitMemory(const DecodedInstruction& instruction, NativeBlockExitSite* exit);
	void emitWordStores(const DecodedInstruction& instruction, NativeBlockExitSite* exit);
	void emitScalarLoad(MemoryAccessKind kind, sljit_s32 alignment);
	void emitScalarStore(MemoryAccessKind kind, int source);
	void emitReadMappings();
	sljit_jump* emitRomStorage(const Span<const u8>* storage, u32 width,
		sljit_label* load, sljit_label* done);
	static constexpr int REGISTER_CACHE_CAPACITY = NativeBlockAbi::registerCacheCapacity;
	// A raw definition may have several architectural names, but at most one
	// physical cache location. Entry maps remain independent guest values.
	enum class RegisterValueKind { Unknown, SignedWordNumber, Table, Constant };
	struct RegisterValueFact {
		constexpr RegisterValueFact(RegisterValueKind kind = RegisterValueKind::Unknown, Value constant = 0, int entrySource = -1)
			: kind(kind), constant(constant), entrySource(entrySource) {}
		RegisterValueKind kind;
		Value constant;
		int entrySource;
	};
	struct SlotBinding { int definition = -1; bool dirty = false; };
	struct RawDefinition { RegisterValueFact fact; int home = -1; };
	struct CachedValue { int definition = -1; u32 lastUse = 0; };
	struct EntryRegister {
		int guest = -1;
		bool dirty = false;
		u32 lastUse = 0;
		RegisterValueFact value{};
	};
	using RegisterState = std::array<EntryRegister, REGISTER_CACHE_CAPACITY>;
	enum class ValueLocationKind { Register, Home, Constant };
	struct ValueLocation { ValueLocationKind kind; int index; Value constant = 0; };
	struct SnapshotWrite { int guest; ValueLocation source; };
	struct RegisterSnapshot {
		std::array<int, REGISTER_CACHE_CAPACITY> primary;
		u32 extraFirst = 0, extraCount = 0;
		RegisterSnapshot() { primary.fill(-1); }
	};
	void setExitRegisterMap(NativeBlockExitSite& exit, const RegisterSnapshot& registers);
	void emitSharedExit(NativeBlockExitSite& exit, const RegisterSnapshot& registers);
	size_t bindingIndex(int guest) const;
	int definitionFor(int guest);
	int findValue(int definition) const;
	int findRegister(int guest) const;
	bool hasBindings(int definition) const;
	ValueLocation valueLocation(int definition) const;
	void preserveHome(int guest, sljit_s32 temporary = SLJIT_FR2);
	void preserveRangeHomes(int first, int end);
	void bindRegister(int guest, int definition, bool dirty, sljit_s32 temporary = SLJIT_FR2);
	int allocateValue(int definition, sljit_s32 pinned = 0);
	void resetRegisterState(const RegisterState& registers);
	void copyRegister(int guest, int source);
	void bindConstant(int guest, Value value);
	void emitValueStore(int guest, const ValueLocation& source, NativeLoweringPhase phase);
	void emitSnapshotExtras(const RegisterSnapshot& snapshot, NativeLoweringPhase phase);
	void publishRegisterRange(int first, int end);
	sljit_s32 cachedFloatRegister(int slot) const;
	RegisterValueFact operandFact(int selector) const;
	sljit_s32 readOperand(int selector, sljit_s32 temporary, sljit_s32 pinned = 0);
	std::array<sljit_s32, 2> readOperands(int left, int right);
	sljit_s32 destinationRegister(int guest, RegisterValueFact fact = {});
	void writeRegister(int guest, sljit_s32 source = SLJIT_FR0, RegisterValueFact fact = {});
	size_t regionEntryIndex(u32 pc) const;
	struct RegisterAccess {
		u8 scalarReads = 0;
		int readFirst = 0, readEnd = 0;
		int writeFirst = 0, writeEnd = 0;
	};
	static RegisterAccess registerAccess(const DecodedInstruction& instruction);
	void planRegisterEntries(std::span<const NativeBlockSource> sources);
	void emitInternalBranches();
	void emitRegisterTransfer(const RegisterState& target, NativeBlockExitSite& exit, size_t targetIndex);
	void discardRegisterRange(int first, int end);
	RegisterSnapshot registerSnapshot();
	void emitRegisterSnapshot(const RegisterSnapshot& snapshot);
	void emitCallSpills(bool reload);
	std::array<sljit_jump*, 2> falseyJumps(int index);
	void loadOperand(int selector, sljit_s32 floatingRegister);
	void loadHeader(int selector, sljit_s32 target);
	void loadPayload(int selector, sljit_s32 target, sljit_s32 scratch);
	void canonicalizeNumber(sljit_s32 target = SLJIT_FR0);
	void convertWord(int selector);

	NativeLoweringStats* m_lowering;
	NativeLoweringPhase m_loweringPhase = NativeLoweringPhase::Body;
	sljit_compiler* m_compiler;
	std::span<const std::unique_ptr<NativeBlock>> m_blocks;
	std::span<const NativeBlockSource> m_sources;
	std::span<const NativeBlockInstruction> m_remainingInstructions;
	const u32 m_entryPagePc;
	std::array<u16, MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES> m_entryByWord;
	struct EntryPoint {
		sljit_label* guarded = nullptr;
		sljit_label* external = nullptr;
		sljit_label* linked = nullptr;
		sljit_label* body = nullptr;
		RegisterState registers;
		std::array<bool, REGISTER_CACHE_CAPACITY> tableGuards{};
		std::array<int, REGISTER_CACHE_CAPACITY> tableParents{};
		bool inherited = false;
	};
	std::vector<EntryPoint> m_entries;
	size_t m_currentEntry = 0;
	struct InternalBranch { sljit_jump* jump; size_t target; };
	std::vector<InternalBranch> m_internalBranches;
	struct ExternalBranch { sljit_jump* jump; NativeBlockLink* link; };
	std::vector<ExternalBranch> m_externalBranches;
	std::vector<sljit_jump*> m_shortGrants;
	struct AdmissionFallback { sljit_jump* jump; size_t index; RegisterSnapshot registers; bool materialize; };
	std::vector<AdmissionFallback> m_admissionFallbacks;
	const Value* m_constants;
	NativeBlock* m_block = nullptr;
	const NativeCodeBindings& m_bindings;
	bool m_hasTerminal = false;
	bool m_controlPrivilegeGuarded = false;
	struct SlowPath {
		std::array<sljit_jump*, 16> jumps;
		size_t count = 0;
		NativeBlockExitSite* exit;
		RegisterSnapshot registers;
	};
	std::vector<SlowPath> m_slowPaths;
	struct ReadMapping {
		std::array<sljit_jump*, 2> ramMisses;
		NativeBlockExitSite* exit;
		sljit_label* done;
		u32 width;
		RegisterSnapshot registers;
	};
	std::vector<ReadMapping> m_readMappings;
	std::vector<int> m_guestSlots;
	std::vector<SlotBinding> m_slotBindings;
	std::vector<RawDefinition> m_definitions;
	std::vector<SnapshotWrite> m_snapshotWrites;
	std::array<CachedValue, REGISTER_CACHE_CAPACITY> m_registers;
	int m_registerCount;
	bool m_useSavedFloats;
	u32 m_registerClock = 0;
};

} // namespace bmsx
