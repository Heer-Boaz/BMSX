#pragma once

#include <algorithm>
#include <array>
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_registers.h"
#include "sljitLir.h"

namespace bmsx {

struct NativeCallScratch {
	const NativeBlockExitSite* exit;
	CallFrame* caller;
	CallFrame* callee;
	Closure* closure;
	void* target;
	int argumentBase;
	u32 functionAddress, codeAddress, numParams, maxStack, flags;
	int argCount, varargBase, varargCount, stackBase, stackTop;
};

// Every linked region shares this one native frame. Only the word/tag bases,
// run state and cycle grant are pinned; the remaining banks own raw payloads.
struct NativeBlockAbi {
	// S0/S1 = slot planes, R0/R1 = signed indices relative to those bases.
	// R2 is the copy count; R3 is the nil tail when padding is requested.
	static void emitFramePlacement(sljit_compiler*, bool moveFormals, bool pad);
	static constexpr sljit_s32 words = SLJIT_S0, tags = SLJIT_S1, state = SLJIT_S2, budget = SLJIT_S3;
	static constexpr int fixedSaved = 4;
	static constexpr int savedWords = std::min(4, SLJIT_NUMBER_OF_SAVED_REGISTERS - fixedSaved);
	static constexpr int scratchWords =
		std::min(4 - savedWords, SLJIT_NUMBER_OF_REGISTERS - SLJIT_NUMBER_OF_SAVED_REGISTERS - 4);
	static constexpr int wordCount = savedWords + scratchWords;
	static constexpr int savedFloats = std::min(4, SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS);
	static constexpr int scratchFloats =
		3 + std::min(4 - savedFloats, SLJIT_NUMBER_OF_FLOAT_REGISTERS - SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS - 3);
	static constexpr int floatCount = savedFloats + scratchFloats - 3;
	static constexpr int registerCacheCapacity = wordCount + floatCount;
	static constexpr int scratches = (4 + scratchWords) | SLJIT_ENTER_FLOAT(scratchFloats);
	static constexpr int saveds = (fixedSaved + savedWords) | SLJIT_ENTER_FLOAT(savedFloats);
	static constexpr int helperResultOffset = registerCacheCapacity * sizeof(u32);
	static constexpr int stackBytes = helperResultOffset + 64;
	static_assert(sizeof(NativeCallScratch) <= stackBytes);
	static constexpr int signature = SLJIT_ARGS2(P, P, P);
	static constexpr auto wordRegisters = [] {
		std::array<NativeRegisterHost, wordCount> result{};
		for (int i = 0; i < wordCount; ++i)
			result[i] = {i < savedWords ? SLJIT_S(fixedSaved + i) : SLJIT_R(4 + i - savedWords), i < savedWords};
		return result;
	}();
	static constexpr auto floatRegisters = [] {
		std::array<NativeRegisterHost, floatCount> result{};
		for (int i = 0; i < floatCount; ++i)
			result[i] = {i < savedFloats ? SLJIT_FS(i) : SLJIT_FR(3 + i - savedFloats), i < savedFloats};
		return result;
	}();
};

// Cold semantic work returns through this stable allocation. A helper may
// retire the region it came from; no return address points into that region.
class NativeBlockGate {
public:
	NativeBlockGate();
	~NativeBlockGate();
	NativeBlockGate(const NativeBlockGate&) = delete;
	NativeBlockGate& operator=(const NativeBlockGate&) = delete;
	void* entry;
	void* exit;
	void* dispatch;
	void* leaveSegment;
private:
	static sljit_label* emitCallGate(sljit_compiler*, sljit_label* cold, sljit_label* returned);
	static sljit_label* emitReturnGate(sljit_compiler*, sljit_label* cold);
	// Input: R0 = PC. Output: R3 = live entry; R2 is scratch.
	static void emitCodeLookup(sljit_compiler*, sljit_label* declined);
	static void emitFrameEntry(sljit_compiler*, sljit_sw targetSlot);

};
const NativeBlockGate& nativeBlockGate();

} // namespace bmsx
