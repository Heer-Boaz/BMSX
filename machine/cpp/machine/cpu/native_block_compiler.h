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
	NativeBlockCompiler(const Value* constants, std::span<const std::unique_ptr<NativeBlock>> blocks, Memory& memory, StringPool& strings,
		std::span<const NativeBlockSource> sources);
	~NativeBlockCompiler();
	void emit(const DecodedInstruction& instruction, NativeBlockExitSite* slowExit,
		NativeBlockExitSite* takenExit);
	void beginBlock(size_t index, bool inheritRegisters);
	void endBlock(bool fallthrough);
	void* finish(size_t& codeBytes);

private:
	struct SlowPath;
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
	using RegisterSnapshot = std::array<int, REGISTER_CACHE_CAPACITY>;
	void setExitRegisterMap(NativeBlockExitSite& exit, const RegisterSnapshot& registers);
	void emitSharedExit(NativeBlockExitSite& exit, const RegisterSnapshot& registers);
	int findRegister(int guest) const;
	int allocateRegister(int guest, sljit_s32 pinned = 0);
	sljit_s32 cachedFloatRegister(int slot) const;
	// Facts describe the current raw Value, not a different guest encoding.
	// They are local to one externally enterable body.
	enum class RegisterValueKind { Unknown, SignedWordNumber, Constant };
	struct RegisterValueFact { RegisterValueKind kind; Value constant; };
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
	void discardRegisterRange(int first, int end);
	RegisterSnapshot registerSnapshot(bool dirtyOnly = true) const;
	void emitRegisterSnapshot(const RegisterSnapshot& snapshot);
	void emitCallSpills(bool reload);
	std::array<sljit_jump*, 2> falseyJumps(int index);
	void loadOperand(int selector, sljit_s32 floatingRegister);
	void loadHeader(int selector, sljit_s32 target);
	void loadPayload(int selector, sljit_s32 target, sljit_s32 scratch);
	void canonicalizeNumber(sljit_s32 target = SLJIT_FR0);
	void convertWord(int selector);

	sljit_compiler* m_compiler;
	std::span<const std::unique_ptr<NativeBlock>> m_blocks;
	std::span<const NativeBlockSource> m_sources;
	std::span<const NativeBlockInstruction> m_remainingInstructions;
	const u32 m_entryPagePc;
	std::array<u16, MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES> m_entryByWord;
	struct CachedRegister {
		int guest = -1;
		bool dirty = false;
		u32 lastUse = 0;
		RegisterValueFact value{};
	};
	using RegisterState = std::array<CachedRegister, REGISTER_CACHE_CAPACITY>;
	bool emitRegisterTransfer(const RegisterState& source, const RegisterState& target, NativeBlockExitSite& exit);
	struct EntryPoint {
		sljit_label* guarded = nullptr;
		sljit_label* external = nullptr;
		sljit_label* linked = nullptr;
		sljit_label* body = nullptr;
		RegisterState registers;
		bool inherited = false;
	};
	std::vector<EntryPoint> m_entries;
	struct InternalBranch {
		sljit_jump* jump;
		size_t target;
		NativeBlockExitSite* exit;
		RegisterState registers;
		bool transferDeferred;
	};
	std::vector<InternalBranch> m_internalBranches;
	struct ExternalBranch { sljit_jump* jump; NativeBlockLink* link; };
	std::vector<ExternalBranch> m_externalBranches;
	std::vector<sljit_jump*> m_shortGrants;
	const Value* m_constants;
	NativeBlock* m_block = nullptr;
	Memory& m_memory;
	StringPool& m_strings;
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
	RegisterState m_registers;
	int m_registerCount;
	bool m_useSavedFloats;
	u32 m_registerClock = 0;
};

} // namespace bmsx
