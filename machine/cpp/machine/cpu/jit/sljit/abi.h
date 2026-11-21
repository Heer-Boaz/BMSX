#pragma once

#include <algorithm>
#include <array>
#include "machine/cpu/jit/runtime/block.h"
#include "machine/cpu/jit/sljit/register_cache.h"
#include "sljitLir.h"

namespace bmsx {

// Word registers left for the value cache when `fixedSaved` saved registers are pinned.
inline constexpr int nativeWordCacheRegisters(int fixedSaved) {
	const int saved = std::min(4, SLJIT_NUMBER_OF_SAVED_REGISTERS - fixedSaved);
	return saved + std::min(4 - saved, SLJIT_NUMBER_OF_REGISTERS - SLJIT_NUMBER_OF_SAVED_REGISTERS - 4);
}

// Every linked region shares this one native frame. Only the word/tag bases,
// run state, cycle grant and, where it is free, the main-RAM base are pinned;
// the remaining banks own raw payloads.
struct NativeBlockAbi {
	// destination = host address of the main-RAM byte offset in `offset`.
	// The only way generated code reaches the RAM base.
	static void emitRamAddress(sljit_compiler*, sljit_s32 destination, sljit_s32 offset);
	// The physical frame control can lag behind admitted control latches.
	// Return the branch taken when this RAM footprint can observe it.
	static sljit_jump* emitFrameControlOverlap(sljit_compiler*, sljit_s32 offset, u32 bytes, sljit_s32 scratch);
	// Publish the next sequential PC and before-operation top for a RAM observer.
	// Uses R1/R2; R0 remains available to carry a record address.
	static void emitPublishFrameControl(sljit_compiler*, u32 nextPc);
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
	static constexpr int fieldAddressOffset = registerCacheCapacity * sizeof(u32);
	static constexpr int fieldAddressBytes = 4 * sizeof(u32);
	static constexpr int helperResultOffset = fieldAddressOffset + NATIVE_OWN_FIELD_TEMPORARIES * fieldAddressBytes;
	static constexpr int stackBytes = helperResultOffset + 64;
	static constexpr int signature = SLJIT_ARGS3(P, P, P, P);
	static constexpr auto wordRegisters = [] {
		std::array<NativeRegisterHost, wordCount> result{};
		for (int i = 0; i < wordCount; ++i)
			result[i] = {i < savedWords ? SLJIT_S(fixedSaved + i) : SLJIT_R(4 + i - savedWords), i < savedWords};
		return result;
	}();
	// A transfer can call C++ after materializing the register cache. Keep
	// its exit only until the helper either admits the transfer or declines.
	static_assert(wordRegisters[0].calleeSaved);
	static constexpr sljit_s32 transitionExit = wordRegisters[0].reg;
	static constexpr auto floatRegisters = [] {
		std::array<NativeRegisterHost, floatCount> result{};
		for (int i = 0; i < floatCount; ++i)
			result[i] = {i < savedFloats ? SLJIT_FS(i) : SLJIT_FR(3 + i - savedFloats), i < savedFloats};
		return result;
	}();
};

} // namespace bmsx
