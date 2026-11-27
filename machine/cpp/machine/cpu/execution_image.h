#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/closure.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/value_slots.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"
#include "spec/blua32/execution_domain.h"
#include "spec/bmsx/cartridge.h"
#include "spec/bmsx/memory_map.h"

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include <bitset>

#include "machine/cpu/jit/page_words.h"
#include "machine/cpu/jit/runtime/code_lookup.h"
#include "machine/cpu/jit/runtime/code_cache.h"
#include "machine/cpu/jit/runtime/field_feedback.h"
#endif

#include "spec/bmsx/heap_service.h"

namespace bmsx {

struct Blua32ExecutionImage;
class Memory;

// The directory is scoped to one mounted execution image. A version names a
// checked ROM span, not a latched copy of physical RAM or MMIO code.
struct Blua32RomFunctionVersion {
	FunctionEntry entry;
	u32 endPc, upvalueTableAddress, upvalueCount;
	bool contains(u32 pc) const { return pc >= entry.codeAddress && pc < endPc; }
};

struct Blua32RomFunctionDirectory {
	u32 tableAddress = 0;
	u32 textAddress = 0;
	bool mappedCode = false;
	std::vector<Blua32RomFunctionVersion> versions;
	std::vector<u32> codeOrder;
	std::vector<u32> instructionHeads;
	static Blua32RomFunctionDirectory read(const Memory&, ExecutionDomainId, const u8* imageHeader);
	static constexpr bool ownsAddress(ExecutionDomainId domain, u32 address) {
		return domain == SYSTEM_EXECUTION_DOMAIN_ID
			? address - SYSTEM_ROM_BASE < SYSTEM_ROM_SIZE : address - CART_ROM_BASE < CART_ROM_SIZE;
	}
	const Blua32RomFunctionVersion* find(u32 record) const;
	const Blua32RomFunctionVersion* atPc(u32 pc) const;
	bool instructionHead(u32 pc) const;
};

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

// ROM prototype words and image-owned dispatch cell addresses, never a closure or code pointer.
struct RomCallBinding {
	static constexpr u32 slotCount = 64u;
	std::optional<u32> functionAddress;
	FunctionEntry entry{};
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	std::array<void* const*, CARTRIDGE_SLOT_COUNT> entryCells{};
#endif
};

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
class NativeBlock;
class NativeCodeRegion;
struct DecodedInstructionPage;

struct NativeCodeSourcePage {
	u32 pc;
	DecodedInstructionPage* page;
	u64 key;
	bool immutable = false;
};

struct NativeBlockPage {
	~NativeBlockPage();
	std::array<std::unique_ptr<NativeBlock>, DECODED_PAGE_WORDS> entries{};
	NativePageWords occupied;
	u32 count = 0;
};

// Resident source hints and one-shot cartridge scheduling, never guest or
// saved state. Explicit system preparation does not consume the schedule.
struct NativeImageWarmup {
	std::optional<u32> entryPc;
	bool consumed = false;
};
#endif

struct DecodedInstructionPage {
	explicit DecodedInstructionPage(const MappedPageBinding& binding, bool privateFirmware = false)
		: mapping(binding), privateFirmware(privateFirmware) {
		refreshState.fill(DECODED_REFRESH_DECODE);
	}

	std::array<DecodedInstruction, DECODED_PAGE_WORDS> words{};
	std::array<uint8_t, DECODED_PAGE_WORDS> refreshState{};
	std::array<uint32_t, DECODED_PAGE_WORDS> sourceWords{};
	std::array<uint32_t, DECODED_PAGE_WORDS> bodyWords{};
	MappedPageBinding mapping;
	const bool privateFirmware;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	std::array<u8, DECODED_PAGE_WORDS> nativeVisits{};
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	std::array<std::bitset<DECODED_PAGE_WORDS>, CARTRIDGE_SLOT_COUNT> queuedNativeRoots;
#endif
	// Structural entry points on immutable code outlive a compiled region.
	NativePageWords nativeSourceLeaders;
	NativeFieldProofFeedback fieldProofFeedback;
	// Borrowed image-lifetime dispatch cells. Retiring regions zeros entries,
	// but leaves the cells available to suspended native continuations.
	void** nativeCode = nullptr;
	std::unique_ptr<NativeBlockPage> nativeBlocks;

	void publishNativeEntry(size_t regionPage, u32 word, std::unique_ptr<NativeBlock> block);
	void retireNativeBlocks(u32 firstWord = 0, u32 endWord = DECODED_PAGE_WORDS + 1u, NativeRetirement = NativeRetirement::SourceChanged);

#endif
};

// Physical source pages, including separate cartridge apertures. Decoded
// words have stable addresses across later fetches and native publication.
class DecodedPageDirectory {
public:
	explicit DecodedPageDirectory(bool privateFirmware = false) : m_privateFirmware(privateFirmware) {}
	struct Entry {
		Entry(const MappedPageBinding& binding, bool privateFirmware)
			: key(binding.key), page(binding, privateFirmware) {}
		const u64 key;
		DecodedInstructionPage page;
	};

	DecodedInstructionPage* find(u64 key) const {
		const auto& group = m_groups[key >> GROUP_SHIFT];
		return group ? (*group)[pageIndex(key)] : nullptr;
	}
	DecodedInstructionPage& bind(const MappedPageBinding&);
	std::span<const std::unique_ptr<Entry>> entries() const { return m_entries; }

private:
	static constexpr u32 GROUP_PAGE_BITS = 12u;
	static constexpr u32 GROUP_PAGES = 1u << GROUP_PAGE_BITS;
	static constexpr u32 GROUP_SHIFT = MAPPED_PAGE_BYTE_SHIFT + GROUP_PAGE_BITS;
	static constexpr u32 GROUPS_PER_APERTURE = 1u << (ADDRESS_BITS - GROUP_SHIFT);
	using Group = std::array<DecodedInstructionPage*, GROUP_PAGES>;
	static constexpr u32 pageIndex(u64 key) {
		return (static_cast<u32>(key) >> MAPPED_PAGE_BYTE_SHIFT) & (GROUP_PAGES - 1u);
	}

	std::array<std::unique_ptr<Group>, (1u + CARTRIDGE_SLOT_COUNT) * GROUPS_PER_APERTURE> m_groups{};
	// Invalidate all published pages without walking empty directory slots.
	std::vector<std::unique_ptr<Entry>> m_entries;
	const bool m_privateFirmware;
};

struct Blua32ExecutionImage {
	ExecutionDomainId executionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 irqFunctionAddress = 0;
	u32 staticEnd = 0;
	HeapServiceFunctions heapServiceFunctions{};
	u32 constantBase = 0;
	ConstValueSpan constPool;
	// Derived from the immutable pool, including during restore. Only a
	// String resolved to a RAM record is an edge to the language heap.
	std::vector<StringId> constantStringRoots;
	u32 globalMapBase = 0;
	u32 globalNameCount = 0, systemNameCount = 0;
	Blua32RomFunctionDirectory romFunctions{};
	std::array<RomCallBinding, RomCallBinding::slotCount> romCallBindings{};
	RomCallBinding* bindRomFunction(const Memory& memory, u32 address) {
		auto& binding = romCallBindings[(address / BLUA32_FUNCTION_RECORD_SIZE) % RomCallBinding::slotCount];
		return binding.functionAddress == address ? &binding : loadRomFunction(memory, address, binding);
	}
	u32 globalMapBytes() const { return 4u * (globalNameCount + systemNameCount); }
	bool admitsFunctionPc(u32 record, u32 pc) const;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	NativeImageWarmup nativeWarmup;
	// Dispatch storage outlives the decoded descriptors which borrow its cells.
	std::unique_ptr<NativeCodeLookup> nativeCodeLookup;
	std::unique_ptr<NativeCodeLookup>& nativeLookup(bool privateFirmware);
#endif
	// An ordinary System activation and a fixed BIOS activation can share the
	// same physical ROM PC. Their links and decoded dispatch metadata cannot.
	struct PrivateFirmwareCode {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		std::unique_ptr<NativeCodeLookup> lookup;
#endif
		DecodedPageDirectory decoded{true};
	};
	std::unique_ptr<PrivateFirmwareCode> privateFirmwareCode;
	DecodedPageDirectory& decodedDirectory(bool privateFirmware);
	DecodedPageDirectory decodedPages;
private:
	RomCallBinding* loadRomFunction(const Memory&, u32 address, RomCallBinding&);
};

} // namespace bmsx
