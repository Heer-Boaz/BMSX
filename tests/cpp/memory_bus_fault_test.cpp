#include "spec/bmsx/io.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <stdexcept>
#include <vector>

namespace {

constexpr uint32_t UNMAPPED_ADDRESS = 0x06000000u;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void requireBusFault(const bmsx::Memory& memory, uint32_t access) {
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_CODE) == bmsx::BUS_FAULT_UNMAPPED, "floating mapped access latches an unmapped fault");
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ADDR) == UNMAPPED_ADDRESS, "floating mapped access latches the first cycle address");
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ACCESS) == access, "floating mapped access latches its transaction width");
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
			if (dma) memory.writeMappedDmaU32LE(address, 0xffffffffu, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END);
			else memory.writeMappedU32LE(address, 0xffffffffu);
			require(memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_READ_ONLY, "CPU and DMA reject read-only IO words");
			require(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR) == address, "read-only fault retains the actual register address");
			require(memory.readIoU32(address) == 0x81234567u, "a rejected write retains the device register's raw bits");
		}
		for (const u32 address : {IO_DMA0_CONTROL, IO_IMGDEC_DATA, IO_INP_OUTPUT_PORT}) {
			memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1u);
			if (dma) memory.writeMappedDmaU32LE(address, 0x81234567u, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END);
			else memory.writeMappedU32LE(address, 0x81234567u);
			require(memory.readIoU32(IO_SYS_BUS_FAULT_CODE) == BUS_FAULT_NONE, "writable IO words remain writable for both bus masters");
			require(memory.readIoU32(address) == 0x81234567u, "writable IO words retain all supplied bits");
		}
	}
}

struct DmaBusTrace {
	bmsx::Memory& memory;
	std::vector<std::array<bmsx::u32, 4>> calls{};
	bmsx::u32 reads = 0;
	bmsx::u32 readiness = 0;

	static bmsx::u32 read(void* context, bmsx::u32 address, bmsx::MappedBusSignals signals) {
		auto& trace = *static_cast<DmaBusTrace*>(context);
		const bmsx::u32 word = 0x81234560u + trace.reads++;
		trace.calls.push_back({0u, address, word, signals});
		if (trace.reads == 2u) trace.memory.mapIoWrite(bmsx::IO_GX_GPU_GP0, &trace, writeRebound);
		return word;
	}
	static bool ready(void* context, bmsx::u32 address, bmsx::MappedBusSignals signals) {
		auto& trace = *static_cast<DmaBusTrace*>(context);
		const bmsx::u32 ready = ++trace.readiness % 3u != 0u;
		trace.calls.push_back({1u, address, ready, signals});
		return ready != 0u;
	}
	static void write(void* context, bmsx::u32 address, bmsx::u32 word, bmsx::MappedBusSignals signals) {
		static_cast<DmaBusTrace*>(context)->calls.push_back({2u, address, word, signals});
	}
	static void writeRebound(void* context, bmsx::u32 address, bmsx::u32 word, bmsx::MappedBusSignals signals) {
		static_cast<DmaBusTrace*>(context)->calls.push_back({3u, address, word, signals});
	}
};

void testDmaBlockPreservesScalarBusOrderAndFaults() {
	using namespace bmsx;
	constexpr u32 source = DYNAMIC_RAM_BASE + 0x100u;
	constexpr u32 destination = DYNAMIC_RAM_BASE + 0x200u;
	struct Route { u32 read, write, readStep, writeStep; };
	for (const Route& route : {
		Route{IO_IMGDEC_DATA, IO_GX_GPU_GP0, 0, 0}, Route{source, IO_GX_GPU_GP0, 4, 0},
		Route{IO_IMGDEC_DATA, destination, 0, 4}, Route{source, destination, 4, 4},
		Route{source, source + 4u, 4, 4}, Route{IO_IMGDEC_DATA, IO_SYS_STATUS, 0, 0},
		Route{IO_IMGDEC_DATA + 1u, IO_GX_GPU_GP0, 0, 0}, Route{UNMAPPED_ADDRESS, IO_GX_GPU_GP0, 0, 0},
		Route{0xfffffffcu, destination, 4, 4}, Route{IO_IMGDEC_DATA, IO_GX_GPU_GP0, 4, 4},
		Route{IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE - IO_WORD_SIZE, destination, 4, 4},
	}) for (const u32 count : {0u, 1u, 5u, 16u}) {
		Memory scalar(MemoryInit{{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		Memory block(MemoryInit{{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
		DmaBusTrace scalarTrace{scalar}, blockTrace{block};
		for (DmaBusTrace* trace : {&scalarTrace, &blockTrace}) {
			for (u32 i = 0; i < 32u; ++i) trace->memory.writeMappedU32LE(source + 4u * i, 0xf1234500u + i);
			trace->memory.mapIoRead(IO_IMGDEC_DATA, trace, DmaBusTrace::read);
			trace->memory.mapIoWrite(IO_GX_GPU_GP0, trace, DmaBusTrace::write);
			trace->memory.mapIoWriteReady(IO_GX_GPU_GP0, DmaBusTrace::ready);
			trace->memory.writeIoU32(IO_SYS_STATUS, 0x89abcdefu);
		}
		const MappedBusSignals readSignals = MAPPED_BUS_MASTER_DMA | mappedBusSignalsForCartridgeSlot(0);
		const MappedBusSignals writeSignals = MAPPED_BUS_MASTER_DMA | mappedBusSignalsForCartridgeSlot(1);
		u32 read = route.read, write = route.write;
		for (u32 i = 0; i < count; ++i) {
			const MappedBusSignals end = i + 1u == count ? MAPPED_BUS_DMA_BLOCK_END : 0u;
			const u32 word = scalar.readMappedDmaU32LE(read, readSignals | end);
			scalar.writeMappedDmaU32LE(write, word, writeSignals | end);
			read += route.readStep; write += route.writeStep;
		}
		block.transferDmaBlock(route.read, route.write, count, route.readStep, route.writeStep, readSignals, writeSignals);
		require(blockTrace.calls == scalarTrace.calls, "DMA block retains read/ready/write order, raw strobes and live rebound handlers");
		require(blockTrace.reads == scalarTrace.reads && blockTrace.readiness == scalarTrace.readiness, "DMA reads precede even rejected writes");
		require(block.readBusFaultSequence() == scalar.readBusFaultSequence(), "DMA block retains every fault cycle");
		for (const u32 address : {IO_SYS_BUS_FAULT_CODE, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_ACCESS, IO_SYS_STATUS})
			require(block.readIoU32(address) == scalar.readIoU32(address), "DMA block retains fault metadata and read-only latches");
		for (u32 i = 0; i < 32u; ++i) {
			require(block.readMappedU32LE(source + 4u * i) == scalar.readMappedU32LE(source + 4u * i), "DMA overlap retains forward word semantics");
			require(block.readMappedU32LE(destination + 4u * i) == scalar.readMappedU32LE(destination + 4u * i), "DMA block preserves destination words");
		}
	}
	Memory memory(MemoryInit{{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes);
	memory.writeMappedWord(IO_SYS_STATUS, 0xffffffffu);
	require(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS) == (BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_WORD), "shared IO write boundary retains CPU Word access format");
}

} // namespace

int main() {
	testFloatingMappedTransactionsKeepTheirBusWidth();
	testMappedWordBurstPreflightStopsWhenBurstCrossesPhysicalIoRegisterfileBoundary();
	testSystemStatusRejectsMappedWrites();
	testIoPermissionsApplyToCpuAndDmaWordWrites();
	testDmaBlockPreservesScalarBusOrderAndFaults();
	return 0;
}
