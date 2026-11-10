#pragma once

#include <array>
#include <vector>

#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_abi.h"
#include "spec/blua32/memory_access_kind.h"
#include "sljitLir.h"

namespace bmsx {

class NativeBlockCompiler {
public:
	NativeBlockCompiler(const Value* constants, std::span<const std::unique_ptr<NativeBlock>> blocks, Memory& memory, StringPool& strings,
		std::span<const NativeBlockSource> sources);
	~NativeBlockCompiler();
	void emit(const DecodedInstruction& instruction, const NativeBlockExitSite* slowExit,
		const NativeBlockExitSite* takenExit);
	void beginBlock(size_t index, bool inheritRegisters);
	void endBlock(bool fallthrough);
	void* finish(size_t& codeBytes);

private:
	struct SlowPath;
	void emitControl(const DecodedInstruction& instruction, const NativeBlockExitSite* exit);
	void emitExit(const NativeBlockExitSite* exit, bool fallthrough = false);
	void emitTableAccess(const DecodedInstruction& instruction, const NativeBlockExitSite* exit);
	void emitArraySlot(bool load, int value, SlowPath& slow);
	void emitStringSlot(bool load, int value, SlowPath& slow);
	void emitLength(const DecodedInstruction& instruction, const NativeBlockExitSite* exit);
	void emitComparison(const DecodedInstruction& instruction, const NativeBlockExitSite* skipped);
	void emitContext(const DecodedInstruction& instruction, const NativeBlockExitSite* exit);
	void emitUpvalue(const DecodedInstruction& instruction, const NativeBlockExitSite* exit);
	void emitVararg(const DecodedInstruction& instruction, const NativeBlockExitSite* exit);
	void emitMemory(const DecodedInstruction& instruction, const NativeBlockExitSite* exit);
	void emitWordStores(const DecodedInstruction& instruction, const NativeBlockExitSite* exit);
	void emitScalarLoad(MemoryAccessKind kind, sljit_s32 alignment);
	void emitScalarStore(MemoryAccessKind kind, int source);
	void emitReadMappings();
	sljit_jump* emitRomStorage(const Span<const u8>* storage, u32 width,
		sljit_label* load, sljit_label* done);
	static constexpr int REGISTER_CACHE_CAPACITY = NativeBlockAbi::registerCacheCapacity;
	using RegisterSnapshot = std::array<int, REGISTER_CACHE_CAPACITY>;
	int findRegister(int guest) const;
	int allocateRegister(int guest, sljit_s32 pinned = 0);
	sljit_s32 cachedFloatRegister(int slot) const;
	sljit_s32 readOperand(int selector, sljit_s32 temporary, sljit_s32 pinned = 0);
	std::array<sljit_s32, 2> readOperands(int left, int right);
	sljit_s32 destinationRegister(int guest);
	void writeRegister(int guest, sljit_s32 source = SLJIT_FR0);
	void flushRegisters();
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
	struct EntryPoint {
		sljit_label* guarded = nullptr;
		sljit_label* external = nullptr;
		sljit_label* body = nullptr;
		RegisterSnapshot registers;
		bool inherited = false;
	};
	std::vector<EntryPoint> m_entries;
	struct InternalBranch { sljit_jump* jump; size_t target; };
	std::vector<InternalBranch> m_internalBranches;
	std::vector<sljit_jump*> m_shortGrants;
	const Value* m_constants;
	const NativeBlock* m_block = nullptr;
	Memory& m_memory;
	StringPool& m_strings;
	bool m_hasTerminal = false;
	bool m_controlPrivilegeGuarded = false;
	struct SlowPath {
		std::array<sljit_jump*, 16> jumps;
		size_t count = 0;
		const NativeBlockExitSite* exit;
		RegisterSnapshot registers;
	};
	std::vector<SlowPath> m_slowPaths;
	struct ReadMapping {
		std::array<sljit_jump*, 2> ramMisses;
		const NativeBlockExitSite* exit;
		sljit_label* done;
		u32 width;
		RegisterSnapshot registers;
	};
	std::vector<ReadMapping> m_readMappings;
	struct CachedRegister {
		int guest = -1;
		bool dirty = false;
		u32 lastUse = 0;
	};
	std::array<CachedRegister, REGISTER_CACHE_CAPACITY> m_registers;
	int m_registerCount;
	bool m_useSavedFloats;
	u32 m_registerClock = 0;
};

} // namespace bmsx
