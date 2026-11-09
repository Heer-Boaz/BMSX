#pragma once

#include <array>
#include <vector>

#include "machine/cpu/native_block.h"
#include "sljitLir.h"

namespace bmsx {

class NativeBlockCompiler {
public:
	NativeBlockCompiler(const Value* constants, const NativeBlock* block, Memory& memory);
	~NativeBlockCompiler();
	void emit(const DecodedInstruction& instruction, const NativeBlockExitSite* slowExit,
		const NativeBlockExitSite* takenExit);
	void* finish(size_t& codeBytes);

private:
	void emitTableField(const DecodedInstruction& instruction, const NativeBlockExitSite* exit);
	void emitMemory(const DecodedInstruction& instruction, const NativeBlockExitSite* exit);
	void commitRegister();
	void flushRegister();
	std::array<sljit_jump*, 2> falseyJumps(int index);
	void loadOperand(int selector, sljit_s32 floatingRegister);
	void canonicalizeNumber();
	void convertWord(int selector);

	sljit_compiler* m_compiler;
	const Value* m_constants;
	const NativeBlock* m_block;
	Memory& m_memory;
	struct SlowPath {
		std::array<sljit_jump*, 7> jumps;
		size_t count = 0;
		const NativeBlockExitSite* exit;
	};
	std::vector<SlowPath> m_slowPaths;
	// FR0 holds this raw Value until eviction, a helper call or an execution exit.
	int m_pendingRegister = -1;
};

} // namespace bmsx
