#include "spec/bmsx/io.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <stdexcept>

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

} // namespace

int main() {
	testFloatingMappedTransactionsKeepTheirBusWidth();
	testMappedWordBurstPreflightStopsWhenBurstCrossesPhysicalIoRegisterfileBoundary();
	testSystemStatusRejectsMappedWrites();
	testIoPermissionsApplyToCpuAndDmaWordWrites();
	return 0;
}
