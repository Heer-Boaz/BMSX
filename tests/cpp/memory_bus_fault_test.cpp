#include "spec/bmsx/io.h"
#include "common/endian.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"

#include <algorithm>
#include <array>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {

constexpr uint32_t UNMAPPED_ADDRESS = 0x06000000u;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void requireBusFault(const bmsx::Memory& memory, uint32_t access, uint32_t address = UNMAPPED_ADDRESS) {
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_CODE) == bmsx::BUS_FAULT_UNMAPPED, "floating mapped access latches an unmapped fault");
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ADDR) == address, "mapped access latches the first faulting cycle address");
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ACCESS) == access, "floating mapped access latches its transaction width");
}

void testRawWordCountersFollowDecodedRegion() {
	using namespace bmsx;
	std::array<u8, 16> system{}, rom{};
	system.fill(0x42u); rom.fill(0x51u);
	auto slots = test::cartridgeSlots(rom);
	slots[0]->ramByteCount = 16u;
	slots[0]->mailboxPresent = true;
	Memory memory(MemoryInit{system, slots}, PSX_MACHINE_SPEC.ramBytes);
	MemoryWordCounters counters;
	u32 ioReads = 0u, ioWrites = 0u;
	memory.mapIoRead(IO_GX_GPU_GP0, &ioReads, [](void* context, u32, MappedBusSignals) -> u32 { ++*static_cast<u32*>(context); return 0u; });
	memory.mapIoWrite(IO_GX_GPU_GP0, &ioWrites, [](void* context, u32, u32, MappedBusSignals) { ++*static_cast<u32*>(context); });
	require(memory.readCountedU32(SYSTEM_ROM_BASE + 1u, counters) == 0x42424242u, "counted raw ROM reads retain unaligned bytes");
	memory.countRawWriteU32(SYSTEM_ROM_BASE, counters);
	memory.writeU32(SYSTEM_ROM_BASE, 0xffffffffu);
	memory.countRawWriteU32(DYNAMIC_RAM_BASE + 1u, counters);
	memory.writeU32(DYNAMIC_RAM_BASE + 1u, 0x87654321u);
	require(memory.readCountedU32(DYNAMIC_RAM_BASE + 1u, counters) == 0x87654321u, "counted raw RAM retains unaligned words");
	memory.countRawWriteU32(IO_GX_GPU_GP0, counters);
	memory.writeU32(IO_GX_GPU_GP0, 0x12345678u);
	require(memory.readCountedU32(IO_GX_GPU_GP0, counters) == 0x12345678u && ioReads + ioWrites == 0u, "raw accounting selects underlying RAM, not the mapped IO overlay");
	require(memory.readCountedU32(CART_ROM_BASE + 1u, counters) == 0x51515151u, "counted cartridge ROM retains its backing");
	memory.countRawWriteU32(CART_RAM_BASE + 1u, counters);
	memory.writeU32(CART_RAM_BASE + 1u, 0x89abcdefu);
	require(memory.readCountedU32(CART_RAM_BASE + 1u, counters) == 0x89abcdefu, "counted card RAM accesses the selected socket");
	memory.countRawWriteU32(CART_MMIO_BASE, counters);
	memory.writeU32(CART_MMIO_BASE, 7u);
	memory.readCountedU32(CART_MMIO_BASE, counters);
	memory.readCountedU32(UNMAPPED_ADDRESS, counters);
	memory.countRawWriteU32(UNMAPPED_ADDRESS, counters);
	memory.writeU32(UNMAPPED_ADDRESS, 0u);
	require(counters.ramWords == 4u && counters.systemRomWords == 2u && counters.cartridgeWords == 5u && counters.otherWords == 2u,
		"word counters follow every admitted or faulting raw decoder branch exactly once");
	counters.ramWords = 0xffffffffu;
	memory.readCountedU32(DYNAMIC_RAM_BASE, counters);
	require(counters.ramWords == 0u, "accounting retains raw counter-word wrapping");
}

void testMappedReadViewsRespectPhysicalBoundaries() {
	using namespace bmsx;
	std::array<u8, 67> system{}, rom0{}, rom1{};
	rom0.fill(0x31u); rom1.fill(0x72u);
	auto slots = test::cartridgeSlots(rom0, rom1);
	slots[0]->ramByteCount = 67u; slots[1]->ramByteCount = 67u;
	Memory memory(MemoryInit{system, slots}, PSX_MACHINE_SPEC.ramBytes);
	Span<const u8> view;
	require(memory.bindMappedReadView(SYSTEM_ROM_BASE + 35u, 32u, MAPPED_BUS_MASTER_CPU, view), "a ROM tail admits its exactly backed record span");
	require(view.data() == system.data() + 35u && view.size() == 32u, "ROM view contains precisely the admitted bytes");
	memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 3u, 0x12345678u);
	require(memory.bindMappedReadView(DYNAMIC_RAM_BASE + 3u, 32u, MAPPED_BUS_MASTER_CPU, view), "ordinary unaligned RAM spans are directly readable");
	require(view.data()[0] == 0x78u && view.data()[1] == 0x56u
		&& view.data()[2] == 0x34u && view.data()[3] == 0x12u,
		"unaligned word stores publish the four little-endian bytes in address order");
	require(readLE32(view.data()) == 0x12345678u, "RAM view keeps raw little-endian word bytes");
	memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 3u, 0x87654321u);
	require(readLE32(view.data()) == 0x87654321u, "a RAM view is live backing, not a captured copy");
	for (const u32 slot : {0u, 1u}) {
		const auto signals = static_cast<MappedBusSignals>(MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END | mappedBusSignalsForCartridgeSlot(slot));
		require(memory.bindMappedReadView(CART_ROM_BASE + 35u, 32u, signals, view), "both sockets admit backed ROM spans with raw bus strobes");
		require(view.data()[0] == (slot == 0u ? 0x31u : 0x72u), "direct ROM reads obey physical chip select");
		memory.cartridgeController().writeU32(CART_RAM_BASE + 3u, slot + 11u, signals);
		require(memory.bindMappedReadView(CART_RAM_BASE + 3u, 32u, signals, view), "both sockets admit card RAM without exposing device words");
		require(readLE32(view.data()) == slot + 11u, "card RAM view obeys the same raw socket signals");
	}
	require(memory.bindMappedReadView(CART_ROM_BASE, 32u, MAPPED_BUS_MASTER_CPU, view) && view.data()[0] == 0x31u, "ordinary CPU reads use the default selected socket without an override");
	u32 ioReads = 0u;
	memory.mapIoRead(IO_GX_GPU_GP0, &ioReads, [](void* context, u32, MappedBusSignals) -> u32 { ++*static_cast<u32*>(context); return 0u; });
	const u32 ioEnd = IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE;
	for (const auto [address, length] : std::array<std::pair<u32, u32>, 10>{{
		{IO_BASE - 4u, 8u}, {IO_GX_GPU_GP0, 4u}, {ioEnd - 4u, 8u},
		{RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 4u, 8u}, {SYSTEM_ROM_BASE + 36u, 32u},
		{CART_ROM_BASE + 36u, 32u}, {CART_RAM_BASE + 36u, 32u},
		{CART_MMIO_BASE, 4u}, {UNMAPPED_ADDRESS, 4u}, {0xfffffff0u, 32u}}}) {
		require(!memory.bindMappedReadView(address, length, MAPPED_BUS_MASTER_CPU, view), "direct views exclude IO overlaps, unbacked tails and unmapped ranges");
	}
	require(ioReads == 0u && memory.readBusFaultSequence() == 0u, "span admission neither invokes IO nor fabricates a bus transaction");
	for (const u32 address : {SYSTEM_ROM_BASE, DYNAMIC_RAM_BASE, CART_ROM_BASE, CART_RAM_BASE})
		require(!memory.bindMappedReadView(address, 0u, MAPPED_BUS_MASTER_CPU, view), "a zero-byte request admits no direct read");
	Memory empty(MemoryInit{system, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	require(!empty.bindMappedReadView(CART_ROM_BASE, 32u, MAPPED_BUS_MASTER_CPU, view), "an absent socket supplies no direct ROM backing");
}

void testPublicRamBusAperture() {
	using namespace bmsx;
	std::array<u8, 1> empty{};
	Memory memory(MemoryInit{{empty.data(), 0u}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	const u32 end = DYNAMIC_RAM_BASE + 2u * MAPPED_PAGE_BYTE_SIZE;
	memory.setRamBusEnd(end);
	memory.writeRamRecordWord(end - 4u, 0x12345678u);
	require(memory.readMappedU8(end - 1u) == 0x12u && memory.readMappedU16LE(end - 2u) == 0x1234u
		&& memory.readMappedU32LE(end - 4u) == 0x12345678u, "every public scalar width reaches assigned RAM");
	require(memory.readMappedBusU32LE(end - 4u, MAPPED_BUS_INSTRUCTION_FETCH) == 0x12345678u,
		"public DATA/BSS remains executable");
	memory.writeMappedU8(end - 1u, 0x91u); memory.writeMappedU16LE(end - 2u, 0x8765u);
	require(memory.readRamRecordWord(end - 4u) == 0x87655678u, "public subword writes retain their lanes");
	Span<const u8> view;
	MappedPageBinding binding{};
	for (const MappedBusSignals signals : std::array<MappedBusSignals, 3>{MAPPED_BUS_MASTER_CPU, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY, MAPPED_BUS_INSTRUCTION_FETCH}) {
		require(memory.bindMappedReadView(end - 4u, 4u, signals, view), "direct views admit the complete public final word");
		require(!memory.bindMappedReadView(end - 4u, 5u, signals, view), "a direct view cannot cross the aperture");
		memory.bindMappedPage(end - MAPPED_PAGE_BYTE_SIZE, signals, binding);
		require(binding.readBytes != nullptr, "the last public page supplies backing");
		memory.bindMappedPage(end, signals, binding);
		require(binding.readBytes == nullptr && !memory.bindMappedReadView(end, 4u, signals, view), "private pages supply no direct bus backing");
	}
	for (const u32 address : {end, RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 0x4000u, RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 4u}) {
		memory.writeRamRecordWord(address, 0x89abcdefu);
		for (const u32 width : {BUS_FAULT_ACCESS_U8, BUS_FAULT_ACCESS_U16, BUS_FAULT_ACCESS_U32, BUS_FAULT_ACCESS_WORD, BUS_FAULT_ACCESS_F32, BUS_FAULT_ACCESS_F64}) {
			memory.clearBusFault(); const u32 sequence = memory.readBusFaultSequence();
			double result = 1;
			switch (width) {
			case BUS_FAULT_ACCESS_U8: result = memory.readMappedU8(address); break;
			case BUS_FAULT_ACCESS_U16: result = memory.readMappedU16LE(address); break;
			case BUS_FAULT_ACCESS_U32: result = memory.readMappedU32LE(address); break;
			case BUS_FAULT_ACCESS_WORD: result = memory.readMappedWord(address); break;
			case BUS_FAULT_ACCESS_F32: result = memory.readMappedF32LE(address); break;
			case BUS_FAULT_ACCESS_F64: result = memory.readMappedF64LE(address); break;
			}
			require(result == 0, "private scalar reads supply the fault bus value");
			requireBusFault(memory, BUS_FAULT_ACCESS_READ | width, address);
			require(memory.readBusFaultSequence() == sequence + 1u, "a rejected scalar issues one faulting bus cycle");
			memory.clearBusFault();
			switch (width) {
			case BUS_FAULT_ACCESS_U8: memory.writeMappedU8(address, 0u); break;
			case BUS_FAULT_ACCESS_U16: memory.writeMappedU16LE(address, 0u); break;
			case BUS_FAULT_ACCESS_U32: memory.writeMappedU32LE(address, 0u); break;
			case BUS_FAULT_ACCESS_WORD: memory.writeMappedWord(address, 0u); break;
			case BUS_FAULT_ACCESS_F32: memory.writeMappedF32LE(address, 0.0f); break;
			case BUS_FAULT_ACCESS_F64: memory.writeMappedF64LE(address, 0.0); break;
			}
			requireBusFault(memory, BUS_FAULT_ACCESS_WRITE | width, address);
			require(memory.readRamRecordWord(address) == 0x89abcdefu, "ordinary stores cannot modify CPU-private bytes");
		}
		memory.clearBusFault();
		require(memory.readMappedBusU32LE(address, MAPPED_BUS_INSTRUCTION_FETCH) == 0u, "private RAM supplies no instruction word");
		requireBusFault(memory, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32, address);
	}
	memory.clearBusFault(); memory.writeMappedU32LE(end - 3u, 0u);
	requireBusFault(memory, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32, end - 3u);
	require(memory.readRamRecordWord(end - 4u) == 0x87655678u, "a crossing U32 commits no partial bytes");
	memory.clearBusFault(); memory.writeMappedF64LE(end - 4u, 1.0);
	requireBusFault(memory, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F64, end);
	require(memory.readRamRecordWord(end - 4u) == 0u && memory.readRamRecordWord(end) == 0x89abcdefu,
		"F64 retains its admitted first cycle but cannot write its private second cycle");
	memory.setRamBusEnd(end + MAPPED_PAGE_BYTE_SIZE); memory.clearBusFault();
	require(memory.readMappedU32LE(end) == 0x89abcdefu, "a larger live end exposes newly assigned static RAM");
	memory.setRamBusEnd(end); memory.clearBusFault();
	require(memory.readMappedU32LE(end) == 0u, "shrinking the end revokes ordinary RAM access");
	requireBusFault(memory, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32, end);
	memory.writeRamRecordWord(end, 0x76543210u);
	require(memory.readRamRecordWord(end) == 0x76543210u, "the physical record port is independent of the public aperture");
}

void testDmaPublicRamBusAperture() {
	using namespace bmsx;
	std::array<u8, 1> empty{};
	Memory memory(MemoryInit{{empty.data(), 0u}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	const u32 end = DYNAMIC_RAM_BASE + 2u * MAPPED_PAGE_BYTE_SIZE, publicWords = DYNAMIC_RAM_BASE + 0x80u;
	const MappedBusSignals signals = MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY;
	memory.setRamBusEnd(end);
	memory.writeRamRecordWord(end - 4u, 0x12345678u); memory.writeRamRecordWord(end, 0x89abcdefu);
	memory.transferDmaBlock(end - 4u, publicWords, 2u, 4u, 4u, signals, signals);
	require(memory.readRamRecordWord(publicWords) == 0x12345678u && memory.readRamRecordWord(publicWords + 4u) == 0u,
		"DMA preserves the public source prefix and cannot leak private bytes");
	requireBusFault(memory, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32, end);
	memory.clearBusFault(); memory.writeRamRecordWord(publicWords + 4u, 0x76543210u);
	memory.transferDmaBlock(publicWords, end - 4u, 2u, 4u, 4u, signals, signals);
	require(memory.readRamRecordWord(end - 4u) == 0x12345678u && memory.readRamRecordWord(end) == 0x89abcdefu,
		"DMA preserves its public destination prefix without modifying a private destination");
	requireBusFault(memory, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32, end);
	memory.clearBusFault(); memory.setRamBusEnd(end + MAPPED_PAGE_BYTE_SIZE);
	memory.transferDmaBlock(publicWords, end - 4u, 2u, 4u, 4u, signals, signals);
	require(memory.readRamRecordWord(end) == 0x76543210u && memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_NONE,
		"the DMA span fast path uses the current enlarged public aperture");
}

void testFloatingMappedTransactionsKeepTheirBusWidth() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(
		bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
		bmsx::PSX_MACHINE_SPEC.ramBytes);

	memory.readMappedF32LE(UNMAPPED_ADDRESS);
	requireBusFault(memory, bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_F32);
	memory.writeMappedU32LE(bmsx::IO_SYS_BUS_FAULT_ACK, 1u);

	memory.writeMappedF32LE(UNMAPPED_ADDRESS, 1.0f);
	requireBusFault(memory, bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_F32);
	memory.writeMappedU32LE(bmsx::IO_SYS_BUS_FAULT_ACK, 1u);

	uint32_t faultSequence = memory.readBusFaultSequence();
	memory.readMappedF64LE(UNMAPPED_ADDRESS);
	require(memory.readBusFaultSequence() == faultSequence + 1u, "faulting F64 read does not issue its second bus cycle");
	requireBusFault(memory, bmsx::BUS_FAULT_ACCESS_READ | bmsx::BUS_FAULT_ACCESS_F64);
	memory.writeMappedU32LE(bmsx::IO_SYS_BUS_FAULT_ACK, 1u);

	faultSequence = memory.readBusFaultSequence();
	memory.writeMappedF64LE(UNMAPPED_ADDRESS, 1.0);
	require(memory.readBusFaultSequence() == faultSequence + 1u, "faulting F64 write does not issue its second bus cycle");
	requireBusFault(memory, bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_F64);
}

void testMappedWordBurstPreflightStopsWhenBurstCrossesPhysicalIoRegisterfileBoundary() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(
		bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
		bmsx::PSX_MACHINE_SPEC.ramBytes);
	const uint32_t firstRamWordAfterIo = bmsx::IO_BASE + bmsx::IO_SLOT_COUNT * bmsx::IO_WORD_SIZE;
	const uint32_t lastIoWord = firstRamWordAfterIo - bmsx::IO_WORD_SIZE;

	require(memory.firstBlockedMappedWordWrite(lastIoWord, 2u) == bmsx::NO_BLOCKED_MAPPED_WRITE, "mapped burst preflight stops when crossing the physical IO registerfile boundary");
}

void testSystemStatusRejectsMappedWrites() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(
		bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
		bmsx::PSX_MACHINE_SPEC.ramBytes);

	memory.writeMappedU32LE(bmsx::IO_SYS_STATUS, 0xffffffffu);
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_CODE) == bmsx::BUS_FAULT_READ_ONLY, "SYS_STATUS is a read-only register");
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ADDR) == bmsx::IO_SYS_STATUS, "SYS_STATUS write faults at the status word");
	require(
		memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ACCESS)
			== (bmsx::BUS_FAULT_ACCESS_WRITE | bmsx::BUS_FAULT_ACCESS_U32),
		"SYS_STATUS write retains its mapped transaction width"
	);
}

void testIoPermissionsApplyToCpuAndDmaWordWrites() {
	using namespace bmsx;
	std::array<u8, 1> emptyRom{{0}};
	Memory memory(MemoryInit{{emptyRom.data(), 0u}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	for (const bool dma : {false, true}) {
		for (const u32 address : {IO_SYS_STATUS, IO_IRQ_FLAGS, IO_DMA0_STATUS, IO_DMA1_STATUS,
			IO_IMGDEC_STATUS, IO_IMGDEC_INPUT_WORDS_RECEIVED, IO_IMGDEC_DECODED_WORD_COUNT,
			IO_GEO_STATUS, IO_INP_STATUS, IO_APU_EVENT_SEQ, IO_CART_STATUS,
			IO_SYS_SUPERVISOR_FAULT_DOMAIN, IO_INP_KEYS, IO_INP_OUTPUT_PORT - IO_WORD_SIZE}) {
			memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1u);
			memory.writeIoU32(address, 0x81234567u);
			if (dma) memory.writeMappedBusU32LE(address, 0xffffffffu, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END);
			else memory.writeMappedU32LE(address, 0xffffffffu);
			require(memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_READ_ONLY, "CPU and DMA reject read-only IO words");
			require(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == address, "read-only fault retains the actual register address");
			require(memory.readIoU32(address) == 0x81234567u, "a rejected write retains the device register's raw bits");
		}
		for (const u32 address : {IO_DMA0_CONTROL, IO_IMGDEC_DATA, IO_INP_OUTPUT_PORT}) {
			memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1u);
			if (dma) memory.writeMappedBusU32LE(address, 0x81234567u, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END);
			else memory.writeMappedU32LE(address, 0x81234567u);
			require(memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_NONE, "writable IO words remain writable for both bus masters");
			require(memory.readIoU32(address) == 0x81234567u, "writable IO words retain all supplied bits");
		}
	}
}

struct PrefixMappingTrace {
	bmsx::u32 reads = 0u, readyCalls = 0u, writes = 0u;
	std::vector<bmsx::MappedBusSignals> readSignals, writeSignals;
	static bmsx::u32 read(void* context, bmsx::u32, bmsx::MappedBusSignals signals) {
		auto& t = *static_cast<PrefixMappingTrace*>(context); t.readSignals.push_back(signals); return ++t.reads;
	}
	static bool ready(void* context, bmsx::u32, bmsx::MappedBusSignals) {
		return ++static_cast<PrefixMappingTrace*>(context)->readyCalls % 3u != 0u;
	}
	static void write(void* context, bmsx::u32, bmsx::u32, bmsx::MappedBusSignals signals) {
		auto& t = *static_cast<PrefixMappingTrace*>(context); ++t.writes; t.writeSignals.push_back(signals);
	}
	static void readPrefix(void*, bmsx::u32, bmsx::u32*, bmsx::u32, bmsx::MappedBusSignals) { throw std::runtime_error("revoked/readonly prefix read cannot run"); }
	static void writePrefix(void*, bmsx::u32, const bmsx::u32*, bmsx::u32, bmsx::MappedBusSignals) { throw std::runtime_error("revoked/readonly prefix write cannot run"); }
};

void testDmaMemoryWordsOverlappingIoFaultBeforeHandlers() {
	using namespace bmsx;
	Memory memory(MemoryInit{{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	PrefixMappingTrace trace;
	memory.mapIoRead(IO_IMGDEC_DATA, &trace, PrefixMappingTrace::read);
	memory.mapIoWrite(IO_GX_GPU_GP0, &trace, PrefixMappingTrace::write);
	memory.mapIoWriteReady(IO_GX_GPU_GP0, PrefixMappingTrace::ready);
	const u32 end = IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE;
	for (const u32 address : {IO_BASE,
		IO_IMGDEC_DATA, IO_GX_GPU_GP0, IO_SYS_STATUS, IO_GX_GPU_GP0 + 1u, end - 4u}) {
		for (const bool write : {false, true}) {
			memory.clearBusFault();
			const MappedBusSignals signals = MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY | MAPPED_BUS_DMA_BLOCK_END;
			if (write) memory.writeMappedBusU32LE(address, 0x81234567u, signals);
			else require(memory.readMappedBusU32LE(address, signals) == 0u, "DMA memory IO fault returns zero");
			require(memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED, "memory-selected IO reports unmapped before permissions");
			require(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == address, "memory-selected IO retains exact address");
			require(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS) == ((write ? BUS_FAULT_ACCESS_WRITE : BUS_FAULT_ACCESS_READ) | BUS_FAULT_ACCESS_U32),
				"memory-selected IO retains direction and access width");
		}
	}
	require(trace.reads == 0u && trace.writes == 0u && trace.readyCalls == 0u, "memory-selected IO never reaches device or ready handler");
	// Partially crossing words retain ordinary memory decoding on each edge.
	Memory cpu(MemoryInit{{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	for (const u32 address : {IO_BASE - 3u, IO_BASE - 2u, IO_BASE - 1u, end - 3u, end - 2u, end - 1u}) {
		for (const bool write : {false, true}) {
			memory.clearBusFault(); cpu.clearBusFault();
			const MappedBusSignals signals = MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY;
			if (write) {
				memory.writeMappedBusU32LE(address, 0x81234567u, signals);
				cpu.writeMappedU32LE(address, 0x81234567u);
			} else require(memory.readMappedBusU32LE(address, signals) == cpu.readMappedU32LE(address), "partially overlapping DMA read keeps ordinary decoding");
			for (const u32 fault : {IO_SYS_BUS_FAULT_CODE, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_ACCESS})
				require(memory.readIoU32(fault) == cpu.readIoU32(fault), "partially overlapping DMA fault keeps ordinary decoding");
		}
	}
}

void testDmaPrefixesAreRevokedByScalarRebindingAndRespectPermissions() {
	using namespace bmsx;
	for (u32 rebind = 0u; rebind < 4u; ++rebind) {
		Memory memory(MemoryInit{{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		PrefixMappingTrace trace;
		const u32 target = rebind == 3u ? IO_SYS_STATUS : IO_GX_GPU_GP0;
		memory.mapIoRead(IO_IMGDEC_DATA, &trace, PrefixMappingTrace::read);
		memory.mapIoWrite(target, &trace, PrefixMappingTrace::write);
		memory.mapIoWriteReady(target, PrefixMappingTrace::ready);
		memory.mapIoDmaReadPrefix(IO_IMGDEC_DATA, PrefixMappingTrace::readPrefix);
		memory.mapIoDmaWritePrefix(target, PrefixMappingTrace::writePrefix);
		if (rebind == 0u) memory.mapIoRead(IO_IMGDEC_DATA, &trace, PrefixMappingTrace::read);
		if (rebind == 1u) memory.mapIoWrite(target, &trace, PrefixMappingTrace::write);
		if (rebind == 2u) memory.mapIoWriteReady(target, PrefixMappingTrace::ready);
		memory.writeIoU32(target, 0x24681357u);
		memory.transferDmaBlock(IO_IMGDEC_DATA, target, 4u, 0u, 0u,
			MAPPED_BUS_MASTER_DMA | mappedBusSignalsForCartridgeSlot(0u), MAPPED_BUS_MASTER_DMA | mappedBusSignalsForCartridgeSlot(1u));
		require(trace.reads == 4u && trace.readSignals == std::vector<MappedBusSignals>({5u, 5u, 5u, 7u}), "scalar rebinding retains all reads and raw source strobes");
		if (rebind == 3u) {
			require(trace.writes == 0u && trace.readyCalls == 0u && memory.readBusFaultSequence() == 4u, "readonly ports fault on every write and never invoke prefixes or gates");
			require(memory.readIoU32(target) == 0x24681357u, "readonly latch stays intact");
		} else require(trace.readyCalls == 4u && trace.writes == 3u && trace.writeSignals == std::vector<MappedBusSignals>({13u, 13u, 15u}), "readiness remains per word after rebinding with the final write strobe");
	}
}

void testIncrementingDmaIoDoesNotReuseFixedPort() {
	using namespace bmsx;
	Memory memory(MemoryInit{{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	PrefixMappingTrace trace;
	memory.mapIoRead(IO_IMGDEC_DATA, &trace, PrefixMappingTrace::read);
	memory.mapIoWrite(IO_GX_GPU_GP0, &trace, PrefixMappingTrace::write);
	memory.mapIoDmaReadPrefix(IO_IMGDEC_DATA, PrefixMappingTrace::readPrefix);
	memory.mapIoDmaWritePrefix(IO_GX_GPU_GP0, PrefixMappingTrace::writePrefix);
	memory.transferDmaBlock(IO_IMGDEC_DATA, IO_GX_GPU_GP0, 4u, 4u, 4u,
		MAPPED_BUS_MASTER_DMA, MAPPED_BUS_MASTER_DMA);
	require(trace.reads == 1u && trace.writes == 1u,
		"incrementing addresses leave the original IO ports after the first word");
	require(trace.readSignals == std::vector<MappedBusSignals>({MAPPED_BUS_MASTER_DMA})
		&& trace.writeSignals == std::vector<MappedBusSignals>({MAPPED_BUS_MASTER_DMA}),
		"incrementing IO does not reuse fixed-port prefix bindings or final strobes");
}

void testDmaMemorySpansRetainOrderedWords() {
	using namespace bmsx;
	std::array<u8, 67> system{}, rom0{}, rom1{};
	for (size_t i = 0; i < system.size(); ++i) {
		system[i] = static_cast<u8>(i * 13u + 5u);
		rom0[i] = static_cast<u8>(i * 7u + 3u);
		rom1[i] = static_cast<u8>(i * 11u + 9u);
	}
	struct Transfer { u32 source, destination, slot; };
	const u32 base = DYNAMIC_RAM_BASE;
	const Transfer transfers[]{
		{base + 32, base + 64, 0}, {base + 32, base + 33, 0},
		{base + 32, base + 34, 0}, {base + 32, base + 35, 0},
		{base + 32, base + 36, 0}, {base + 32, base + 37, 0},
		{base + 33, base + 32, 0}, {base + 36, base + 32, 0},
		{SYSTEM_ROM_BASE + 3, base + 64, 0}, {SYSTEM_ROM_BASE + 59, base + 64, 0},
		{CART_ROM_BASE + 3, base + 64, 0}, {CART_ROM_BASE + 3, base + 64, 1},
		{CART_RAM_BASE + 3, base + 64, 0}, {CART_RAM_BASE + 3, base + 64, 1},
		{CART_RAM_BASE + 59, base + 64, 1}, {UNMAPPED_ADDRESS, base + 125, 0},
		{base + 32, base + 125, 0},
	};
	for (const auto transfer : transfers) for (const u32 count : {0u, 1u, 5u, 16u}) {
		auto slots = test::cartridgeSlots(rom0, rom1);
		slots[0]->ramByteCount = 67u; slots[1]->ramByteCount = 67u;
		Memory scalar(MemoryInit{system, slots}, base - RAM_BASE + 128u);
		Memory block(MemoryInit{system, slots}, base - RAM_BASE + 128u);
		for (Memory* memory : {&scalar, &block}) for (const u32 slot : {0u, 1u}) {
			const MappedBusSignals signals = MAPPED_BUS_MASTER_DMA | mappedBusSignalsForCartridgeSlot(slot);
			for (u32 i = 0; i < 16u; ++i) memory->cartridgeController().writeU32(CART_RAM_BASE + i * 4u, 0x91820000u + slot * 0x100u + i, signals);
		}
		const size_t ramOffset = base - RAM_BASE;
		for (size_t i = 0; i < 128u; ++i) {
			const u8 value = static_cast<u8>(i * 17u + 1u);
			scalar.ramData()[ramOffset + i] = value;
			block.ramData()[ramOffset + i] = value;
		}
		const MappedBusSignals readSignals = MAPPED_BUS_MASTER_DMA | mappedBusSignalsForCartridgeSlot(transfer.slot);
		const MappedBusSignals writeSignals = MAPPED_BUS_MASTER_DMA;
		for (u32 i = 0; i < count; ++i) {
			const MappedBusSignals end = i + 1u == count ? MAPPED_BUS_DMA_BLOCK_END : 0u;
			const u32 word = scalar.readMappedBusU32LE(transfer.source + i * 4u, readSignals | end);
			scalar.writeMappedBusU32LE(transfer.destination + i * 4u, word, writeSignals | end);
		}
		block.transferDmaBlock(transfer.source, transfer.destination, count, 4u, 4u, readSignals, writeSignals);
		require(std::equal(scalar.ramData() + ramOffset, scalar.ramData() + ramOffset + 128u, block.ramData() + ramOffset),
			"bound DMA spans preserve forward word ordering and physical tails");
		require(block.readBusFaultSequence() == scalar.readBusFaultSequence(), "bound DMA spans preserve bus fault count");
		for (const u32 address : {IO_SYS_BUS_FAULT_CODE, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_ACCESS}) {
			require(block.readIoU32(address) == scalar.readIoU32(address), "bound DMA spans preserve fault latches");
		}
	}
}

struct MemoryInvalidationTrace final : bmsx::MappedPageInvalidator {
	std::vector<std::array<bmsx::u64, 3>> words;
	void invalidateMappedWords(bmsx::u64 key, bmsx::u32 first, bmsx::u32 end) override {
		words.push_back({key, first, end});
	}
	void invalidateMappedRange(bmsx::u64, bmsx::u64) override {}
};

void testCpuRecordWordsMirrorWithoutUsingTheBus() {
	using namespace bmsx;
	Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
	constexpr u32 end = RAM_BASE + PSX_MACHINE_SPEC.ramBytes;
	constexpr u32 page = end - MAPPED_PAGE_BYTE_SIZE;
	constexpr u32 last = MAPPED_PAGE_BYTE_SIZE / sizeof(u32) - 1u;
	MemoryInvalidationTrace trace;
	memory.attachMappedPageInvalidator(trace);
	MappedPageBinding binding{};
	memory.bindMappedPage(page, MAPPED_BUS_MASTER_CPU, binding);
	binding.writeWatch.armWord(last);
	u32 ioWrites = 0u;
	memory.mapIoWrite(IO_GX_GPU_GP0, &ioWrites, [](void* count, u32, u32, MappedBusSignals) {
		++*static_cast<u32*>(count);
	});
	const u32 sequence = memory.readBusFaultSequence();
	memory.writeRamRecordWord(0xffffffffu, 0x89abcdefu);
	memory.writeRamRecordWord(end, 0x40302010u);
	memory.writeRamRecordWord(IO_GX_GPU_GP0 + PSX_MACHINE_SPEC.ramBytes + 3u, 0x12345678u);
	require(memory.readRamRecordWord(end - 1u) == 0x89abcdefu, "record word decoding aligns the last byte");
	require(memory.readRamRecordWord(RAM_BASE) == 0x40302010u, "the next record word mirrors to RAM offset zero");
	require(memory.readRamRecordWord(IO_GX_GPU_GP0) == 0x12345678u, "record writes can reach the RAM under MMIO");
	require(memory.readMappedU32LE(end - sizeof(u32)) == 0x89abcdefu, "the bus and record port share physical RAM");
	require(ioWrites == 0u && memory.readBusFaultSequence() == sequence, "record accesses bypass registers and bus faults");
	const std::vector<std::array<u64, 3>> expected{{page, last, last + 1u}};
	require(trace.words == expected, "record stores notify the watch at the physical destination");
	binding.writeWatch.armWord(last - 1u);
	binding.writeWatch.armWord(last);
	memory.writeRamRecordPair(0xffffffffu, 0xa1b2c3d4u, 0x11223344u);
	require(memory.readRamRecordWord(end - 8u) == 0xa1b2c3d4u
		&& memory.readRamRecordWord(end - 4u) == 0x11223344u
		&& memory.readRamRecordWord(RAM_BASE) == 0x40302010u,
		"the last mirrored pair stays in its aligned eight-byte extent");
	require(trace.words.size() == 2u && trace.words.back() == (std::array<u64, 3>{page, last - 1u, last + 1u}),
		"a physical pair retires the exact two written words");
	memory.readMappedU32LE(end);
	require(memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_UNMAPPED, "only the record port mirrors RAM");
}

void testDmaMemorySpansInvalidateWatchedCode() {
	using namespace bmsx;
	std::array<u8, 16> rom{};
	rom.fill(0x5a);
	Memory memory(MemoryInit{rom, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	MemoryInvalidationTrace trace;
	memory.attachMappedPageInvalidator(trace);
	const u32 page = DYNAMIC_RAM_BASE, destination = page + MAPPED_PAGE_BYTE_SIZE - 4u;
	MappedPageBinding binding{};
	memory.bindMappedPage(page, MAPPED_BUS_MASTER_CPU, binding);
	binding.writeWatch.armWord(255u);
	memory.bindMappedPage(page + MAPPED_PAGE_BYTE_SIZE, MAPPED_BUS_MASTER_CPU, binding);
	binding.writeWatch.armWord(0u);
	binding.writeWatch.armWord(1u);
	memory.transferDmaBlock(SYSTEM_ROM_BASE, destination, 3u, 4u, 4u, MAPPED_BUS_MASTER_DMA, MAPPED_BUS_MASTER_DMA);
	const std::vector<std::array<u64, 3>> expected{{page, 255u, 256u}, {page + MAPPED_PAGE_BYTE_SIZE, 0u, 2u}};
	require(trace.words == expected, "DMA memory span invalidates watched code on both pages");
	for (u32 i = 0; i < 3u; ++i) require(memory.readMappedU32LE(destination + i * 4u) == 0x5a5a5a5au, "DMA memory span writes the full source");
}

} // namespace

int main() {
	testRawWordCountersFollowDecodedRegion();
	testMappedReadViewsRespectPhysicalBoundaries();
	testPublicRamBusAperture();
	testDmaPublicRamBusAperture();
	testFloatingMappedTransactionsKeepTheirBusWidth();
	testMappedWordBurstPreflightStopsWhenBurstCrossesPhysicalIoRegisterfileBoundary();
	testSystemStatusRejectsMappedWrites();
	testIoPermissionsApplyToCpuAndDmaWordWrites();
	testDmaMemoryWordsOverlappingIoFaultBeforeHandlers();
	testDmaPrefixesAreRevokedByScalarRebindingAndRespectPermissions();
	testIncrementingDmaIoDoesNotReuseFixedPort();
	testDmaMemorySpansRetainOrderedWords();
	testCpuRecordWordsMirrorWithoutUsingTheBus();
	testDmaMemorySpansInvalidateWatchedCode();
	return 0;
}
