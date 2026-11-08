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

} // namespace

int main() {
	testFloatingMappedTransactionsKeepTheirBusWidth();
	testMappedWordBurstPreflightStopsWhenBurstCrossesPhysicalIoRegisterfileBoundary();
	testSystemStatusRejectsMappedWrites();
	testIoPermissionsApplyToCpuAndDmaWordWrites();
	testDmaPrefixesAreRevokedByScalarRebindingAndRespectPermissions();
	return 0;
}
