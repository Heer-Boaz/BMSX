#pragma once

#include <algorithm>
#include <array>
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_registers.h"
#include "sljitLir.h"

namespace bmsx {

struct NativeCallScratch {
	int argumentBase;
	u32 closureAddress, functionAddress, codeAddress, numParams, maxStack;
	// These phases are disjoint. The ABI slot is overwritten at each handoff.
	union {
		u32 closureBindingFlags;
		u32 prototypeFlags;
		i32 placementCycles;
	};
	u32 frameDepth;
	int argCount, varargBase, varargCount, stackBase, stackTop;
	void* romBinding;
};

// Word registers left for the value cache when `fixedSaved` saved registers are pinned.
inline constexpr int nativeWordCacheRegisters(int fixedSaved) {
	const int saved = std::min(4, SLJIT_NUMBER_OF_SAVED_REGISTERS - fixedSaved);
	return saved + std::min(4 - saved, SLJIT_NUMBER_OF_REGISTERS - SLJIT_NUMBER_OF_SAVED_REGISTERS - 4);
}

// Every linked region shares this one native frame. Only the word/tag bases,
// run state, cycle grant and, where it is free, the main-RAM base are pinned;
// the remaining banks own raw payloads.
struct NativeBlockAbi {
	// Test the builtin ID against the nonallocating leaf repertoire; clobbers R1.
	static sljit_jump* emitNonleafBuiltinJump(sljit_compiler*, sljit_s32 id);
	// S0/S1 = slot planes, R0/R1 = signed indices relative to those bases.
	// R2 is the copy count; R3 is the nil tail when padding is requested.
	static void emitFramePlacement(sljit_compiler*, bool moveFormals, bool pad);
	// destination = host address of the main-RAM byte offset in `offset`.
	// The only way generated code reaches the RAM base.
	static void emitRamAddress(sljit_compiler*, sljit_s32 destination, sljit_s32 offset);
	static constexpr sljit_s32 words = SLJIT_S0, tags = SLJIT_S1, state = SLJIT_S2, budget = SLJIT_S3;
	// The main-RAM base is pinned in S4 only where the value cache keeps all of
	// its word registers (x86-64, AArch64). ARMv7 reads it from the run state at
	// each RAM access instead of giving up a cached register.
	static constexpr bool pinnedRam = nativeWordCacheRegisters(5) == nativeWordCacheRegisters(4);
	static constexpr int fixedSaved = pinnedRam ? 5 : 4;
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
	static constexpr int signature = SLJIT_ARGS3(P, P, P, P);
	static constexpr auto wordRegisters = [] {
		std::array<NativeRegisterHost, wordCount> result{};
		for (int i = 0; i < wordCount; ++i)
			result[i] = {i < savedWords ? SLJIT_S(fixedSaved + i) : SLJIT_R(4 + i - savedWords), i < savedWords};
		return result;
	}();
	// All cached values have been materialized before CALL/RET enter the
	// stable gate. Its four word registers are free until the next body.
	static_assert(wordCount == 4);
	static_assert(wordRegisters[0].calleeSaved);
	static constexpr sljit_s32 transitionExit = wordRegisters[0].reg;
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
	using Entry = const NativeBlockExitSite* (SLJIT_FUNC *)(NativeBlockRunState*, void*, const ValueSpan*);
	NativeBlockGate();
	~NativeBlockGate();
	NativeBlockGate(const NativeBlockGate&) = delete;
	NativeBlockGate& operator=(const NativeBlockGate&) = delete;
	void* entry;
	void* exit;
	void* dispatch;
	void* publishSegment;
	void* leaveSegment;
private:
	static sljit_label* emitCallGate(sljit_compiler*, sljit_label* cold);
	static sljit_label* emitReturnGate(sljit_compiler*, sljit_label* cold);
	// Input: R0 = PC. Outputs: R3 = live entry; optionally R2 = its stable cell.
	static void emitCodeLookup(sljit_compiler*, sljit_label* declined, bool keepCell = false);
	static void emitPublishFrameTop(sljit_compiler*, sljit_s32 control, sljit_s32 top, sljit_s32 scratch);
	static void emitFrameEntry(sljit_compiler*, sljit_s32 frame, sljit_s32 target);

};
const NativeBlockGate& nativeBlockGate();

} // namespace bmsx
