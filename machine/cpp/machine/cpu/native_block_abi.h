#pragma once

#include <algorithm>
#include <array>
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_registers.h"
#include "sljitLir.h"

namespace bmsx {

// Every linked region shares this one native frame. Only the word/tag bases,
// run state and cycle grant are pinned; the remaining banks own raw payloads.
struct NativeBlockAbi {
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
};
const NativeBlockGate& nativeBlockGate();

} // namespace bmsx
