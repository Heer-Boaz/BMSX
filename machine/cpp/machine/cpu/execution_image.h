#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <unordered_map>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/value_slots.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"
#include "spec/blua32/execution_domain.h"

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include <bitset>

#include "machine/cpu/closure.h"
#include "machine/cpu/jit/runtime/code_lookup.h"
#include "machine/cpu/jit/runtime/field_feedback.h"
#endif

namespace bmsx {

struct Blua32ExecutionImage;

struct Blua32FunctionRecordLatch {
	Blua32ExecutionImage* image = nullptr;
	MappedBusSignals busSignals = MAPPED_BUS_MASTER_CPU;
	bool romBacked = false; // True when the function data is backed by immutable ROM.
	u32 address = 0;
	u32 codeAddress = 0;
	u32 numParams = 0;
	u32 maxStack = 0;
	u32 flags = 0;
	u32 upvalueTableAddress = 0;
	u32 upvalueCount = 0;
};

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
class NativeBlock;
class NativeCodeRegion;

// ROM prototype words and image-owned dispatch cell addresses, never a closure or code pointer.
struct NativeRomCallBinding {
	static constexpr u32 slotCount = 64u;
	std::optional<u32> functionAddress;
	FunctionEntry entry{};
	std::array<void* const*, CARTRIDGE_SLOT_COUNT> entryCells{};
};

struct NativeBlockPage {
	~NativeBlockPage();
	std::array<std::unique_ptr<NativeBlock>, DECODED_PAGE_WORDS> entries{};
	u32 count = 0;
};

// Resident source hints and one-shot cartridge scheduling, never guest or
// saved state. Explicit system preparation does not consume the schedule.
struct NativeImageWarmup {
	u32 functionTable = 0, functionCount = 0;
	std::optional<u32> entryPc;
	bool consumed = false;
};
#endif

struct DecodedInstructionPage {
	explicit DecodedInstructionPage(bool isCacheable, MappedPageWriteWatch pageWriteWatch)
		: cacheable(isCacheable)
		, writeWatch(pageWriteWatch) {
		refreshState.fill(DECODED_REFRESH_DECODE);
	}

	std::array<DecodedInstruction, DECODED_PAGE_WORDS> words{};
	std::array<uint8_t, DECODED_PAGE_WORDS> refreshState{};
	std::array<uint32_t, DECODED_PAGE_WORDS> sourceWords{};
	std::array<uint32_t, DECODED_PAGE_WORDS> bodyWords{};
	bool cacheable;
	MappedPageWriteWatch writeWatch;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	std::array<u8, DECODED_PAGE_WORDS> nativeVisits{};
	// Structural entry points on immutable code outlive a compiled region.
	std::bitset<DECODED_PAGE_WORDS> nativeSourceLeaders;
	NativeFieldProofFeedback fieldProofFeedback;
	// Borrowed image-lifetime dispatch cells. Retiring regions zeros entries,
	// but leaves the cells available to suspended native continuations.
	void** nativeCode = nullptr;
	std::unique_ptr<NativeBlockPage> nativeBlocks;

	enum class Retirement : u8 { SourceChanged, Feedback, Capacity };
	void retireNativeRegion(const NativeCodeRegion*, Retirement);
	void retireNativeBlocks(u32 firstWord = 0, u32 endWord = DECODED_PAGE_WORDS + 1u, Retirement = Retirement::SourceChanged);

#endif
};

struct Blua32ExecutionImage {
	ExecutionDomainId executionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 irqFunctionAddress = 0;
	u32 staticEnd = 0;
	u32 constantBase = 0;
	ConstValueSpan constPool;
	u32 globalMapBase = 0;
	u32 globalNameCount = 0, systemNameCount = 0;
	u32 globalMapBytes() const { return 4u * (globalNameCount + systemNameCount); }
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	NativeImageWarmup nativeWarmup;
	// Dispatch storage outlives the decoded descriptors which borrow its cells.
	std::unique_ptr<NativeCodeLookup> nativeCodeLookup;
	std::array<NativeRomCallBinding, NativeRomCallBinding::slotCount> nativeRomCallBindings{};
#endif
	std::unordered_map<u64, DecodedInstructionPage> decodedPages;
};

} // namespace bmsx
