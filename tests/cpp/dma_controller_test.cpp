#include "machine/devices/dma/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/gx/gp0.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/map.h"
#include "spec/bmsx/memory_map.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"
#include "machine/scheduler/device.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace {

constexpr uint32_t RAM_COPY_CONTROL = 0x00003c03u;
constexpr uint32_t ImgDecGatedRamCopyControl = 0x00003d43u;
constexpr uint32_t GP0_WRITE_CONTROL = 0x00003c41u;
constexpr uint32_t ForcedGp0WriteControl = 0x00003c01u;
constexpr uint32_t GP0_READ_CONTROL = 0x0000000au;
constexpr uint32_t GxCrossRequestControl = 0x00000048u;
constexpr uint32_t DmaDisabledControl = 0x000003fcu;
constexpr uint32_t PortAdvanceControl = 0x00000003u;
constexpr uint32_t SelfDmaTriggerControl = 0x00000001u;

struct DmaGpuHarness {
	std::array<uint8_t, 8> systemRom{{0x04u, 0x03u, 0x02u, 0x01u, 0x08u, 0x07u, 0x06u, 0x05u}};
	std::array<uint8_t, 8> cartRom{{0x44u, 0x33u, 0x22u, 0x11u, 0x88u, 0x77u, 0x66u, 0x55u}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::ExecutionAddressSpace executionAddressSpace;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::DmaController dma;
	bmsx::GxGpu gpu;

	DmaGpuHarness()
		: memory(bmsx::MemoryInit{ { systemRom.data(), systemRom.size() }, bmsx::test::cartridgeSlots(cartRom) })
		, irq(memory)
		, executionAddressSpace(memory)
		, cpu(memory, irq, executionAddressSpace)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler)
		, gpu(memory, cpu, irq, scheduler, dma) {
		memory.cartridgeController().connect(memory, irq, dma);
		dma.reset();
		memory.cartridgeController().reset();
		gpu.reset();
		irq.reset();
		dma.setTiming(0, 1, 0, 0, 0, 0);
		const bmsx::u32 smode1Address = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW);
		memory.writeMappedU32LE(smode1Address, memory.readMappedU32LE(smode1Address) | bmsx::GX_GPU_PCRTC_SMODE1_SINT);
		gpu.onService(0);
	}
};

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void programTransfer(bmsx::Memory& memory, uint32_t readAddress, uint32_t writeAddress, uint32_t wordCount, uint32_t control) {
	memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, readAddress);
	memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, writeAddress);
	memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, wordCount);
	memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, control);
	memory.writeMappedU32LE(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);
}

void runNextDmaService(DmaGpuHarness& harness) {
	const int64_t deadline = harness.scheduler.nextDeadline();
	require(deadline != std::numeric_limits<int64_t>::max(), "DMA service must have a deadline");
	harness.scheduler.advanceTo(deadline);
	harness.dma.onService(deadline);
}

void testRegionAwareBlockTiming() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t ramSource = bmsx::DYNAMIC_RAM_BASE + 0x80u;
	const uint32_t ramDestination = bmsx::DYNAMIC_RAM_BASE + 0xa0u;
	const uint32_t romDestination = bmsx::DYNAMIC_RAM_BASE + 0xc0u;
	memory.writeMappedU32LE(ramSource, 0x99aabbccu);
	memory.writeMappedU32LE(ramSource + 4u, 0xddeeff00u);
	harness.dma.setTiming(
		bmsx::PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		bmsx::PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		harness.scheduler.currentNowCycles());

	programTransfer(memory, ramSource, ramDestination, 2u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 6, "single-ported RAM copy sums two 3-cycle block sides");
	runNextDmaService(harness);
	require(memory.readMappedU32LE(ramDestination) == 0x99aabbccu, "RAM copy transfers word 0");
	require(memory.readMappedU32LE(ramDestination + 4u) == 0xddeeff00u, "RAM copy transfers word 1");

	programTransfer(memory, bmsx::CART_ROM_BASE, romDestination, 2u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 26, "the 20-cycle cartridge side gates the RAM burst");
	runNextDmaService(harness);
	require(memory.readMappedU32LE(romDestination) == 0x11223344u, "cartridge ROM DMA transfers word 0");
	require(memory.readMappedU32LE(romDestination + 4u) == 0x55667788u, "cartridge ROM DMA transfers word 1");
}

void testSystemRomTiming() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t firmwareDestination = bmsx::DYNAMIC_RAM_BASE + 0x1000u;
	harness.dma.setTiming(
		bmsx::PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		bmsx::PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		harness.scheduler.currentNowCycles());

	programTransfer(memory, bmsx::SYSTEM_ROM_BASE, firmwareDestination, 2u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 3, "the RAM destination gates a two-cycle local firmware read");
	runNextDmaService(harness);
	require(memory.readMappedU32LE(firmwareDestination) == 0x01020304u, "firmware DMA transfers word 0");
	require(memory.readMappedU32LE(firmwareDestination + 4u) == 0x05060708u, "firmware DMA transfers word 1");
}

void testTimingAcrossMemoryRegionBoundaries() {
	DmaGpuHarness cartRomToRam;
	cartRomToRam.dma.setTiming(5, 7, 2, 11, 13, 0);
	programTransfer(
		cartRomToRam.memory,
		bmsx::CART_ROM_END - bmsx::IO_WORD_SIZE,
		bmsx::IO_GX_GPU_GP0,
		2u,
		ForcedGp0WriteControl);
	require(
		cartRomToRam.scheduler.nextDeadline() == 48,
		"cartridge ROM and RAM each pay their physical bus setup and word timing");

	DmaGpuHarness cartRamToMmio;
	cartRamToMmio.dma.setTiming(5, 7, 2, 11, 13, 0);
	programTransfer(
		cartRamToMmio.memory,
		bmsx::CART_RAM_END - bmsx::IO_WORD_SIZE,
		bmsx::IO_GX_GPU_GP0,
		2u,
		ForcedGp0WriteControl);
	require(
		cartRamToMmio.scheduler.nextDeadline() == 48,
		"cartridge RAM and MMIO each begin a physical bus transaction");

	DmaGpuHarness ioToRam;
	ioToRam.dma.setTiming(5, 7, 2, 11, 13, 0);
	programTransfer(
		ioToRam.memory,
		bmsx::IO_BASE + bmsx::IO_SLOT_COUNT * bmsx::IO_WORD_SIZE - bmsx::IO_WORD_SIZE,
		bmsx::IO_GX_GPU_GP0,
		2u,
		ForcedGp0WriteControl);
	require(
		ioToRam.scheduler.nextDeadline() == 12,
		"the first RAM word after the IO aperture pays RAM setup and word timing");
}

void testCartRomBurstSetupIsBlockLocal() {
	DmaGpuHarness harness;
	const uint32_t destination = bmsx::DYNAMIC_RAM_BASE + 0x1800u;
	harness.dma.setTiming(
		bmsx::PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		bmsx::PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		harness.scheduler.currentNowCycles());

	programTransfer(harness.memory, bmsx::CART_ROM_BASE, destination, 17u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 132, "sixteen cartridge words cost four setup cycles plus eight cycles per word");
	runNextDmaService(harness);
	require(harness.scheduler.nextDeadline() == 144, "the final one-word block pays a new cartridge setup");
}

void testRamBurstSetupIsBlockLocal() {
	DmaGpuHarness harness;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x2000u;
	const uint32_t destination = bmsx::DYNAMIC_RAM_BASE + 0x2100u;
	harness.dma.setTiming(
		bmsx::PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		bmsx::PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		harness.scheduler.currentNowCycles());

	programTransfer(harness.memory, source, destination, 1u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 4, "one-word RAM copy pays two block setups");
	runNextDmaService(harness);

	programTransfer(harness.memory, source, destination, 1u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 8, "a later block pays its own setup at identical addresses");
}

void testPortSideAddsNoMemoryWait() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x3000u;
	memory.writeMappedU32LE(source, 0x01020304u);
	memory.writeMappedU32LE(source + 4u, 0x05060708u);
	harness.dma.setTiming(
		bmsx::PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		bmsx::PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		bmsx::PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		harness.scheduler.currentNowCycles());

	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 2u, GP0_WRITE_CONTROL);
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_FIFO);
	require(harness.scheduler.nextDeadline() == 3, "fixed MMIO contributes no memory wait beside RAM");
}

void testAdmittedRegisterState() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x100u;
	const uint32_t destination = bmsx::DYNAMIC_RAM_BASE + 0x200u;
	const uint32_t replacementDestination = bmsx::DYNAMIC_RAM_BASE + 0x240u;
	memory.writeMappedU32LE(source, 0x11223344u);
	memory.writeMappedU32LE(source + 4u, 0x55667788u);
	memory.writeMappedU32LE(source + 8u, 0x99aabbccu);

	programTransfer(memory, source, destination, 3u, RAM_COPY_CONTROL);
	require(memory.readIoU32(bmsx::IO_DMA0_TRIGGER) == 0u, "DMA trigger self-clears");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA trigger sets BUSY");
	memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, bmsx::CART_ROM_BASE);
	memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, replacementDestination);
	memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, 0u);
	memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, DmaDisabledControl);
	runNextDmaService(harness);

	require(memory.readMappedU32LE(destination) == 0x11223344u, "DMA copies word 0");
	require(memory.readMappedU32LE(destination + 4u) == 0x55667788u, "DMA copies word 1");
	require(memory.readMappedU32LE(destination + 8u) == 0x99aabbccu, "DMA copies word 2");
	require(memory.readMappedU32LE(replacementDestination) == 0u, "live address writes do not redirect the admitted block");
	require(memory.readIoU32(bmsx::IO_DMA0_READ_ADDR) == source + 12u, "DMA advances read address");
	require(memory.readIoU32(bmsx::IO_DMA0_WRITE_ADDR) == destination + 12u, "DMA advances write address");
	require(memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 0u, "DMA decrements transfer count");
	require(memory.readIoU32(bmsx::IO_DMA0_CONTROL) == DmaDisabledControl, "live control writes program only the next admission");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "DMA completes");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA0_DONE) != 0u, "DMA raises completion IRQ");
}

void testGxWriteRequestAndPortOwnership() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x300u;
	const uint32_t command0 = (bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x3fu;
	memory.writeMappedU32LE(source, command0);
	memory.writeMappedU32LE(source + 4u, 0x00020010u);
	memory.writeMappedU32LE(source + 8u, 0x00030020u);

	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 3u, GP0_WRITE_CONTROL);
	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "GP1 direction gates GX write DREQ");
	require(!memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "an armed DMA channel reserves its GP0 endpoint");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "GX DMA remains armed while DREQ is low");

	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_FIFO);
	require(!memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "the first admitted DMA block acquires GP0");
	runNextDmaService(harness);

	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;
	require(commands.commandCount == 1u, "DMA emits one GX command");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_FILL_RECTANGLE, "DMA emits the fill command");
	require(commands.words[commands.commandWordStart[0]] == command0, "DMA emits the first command word");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "GX DMA completes");
	require(memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "DMA completion releases GP0");
}

void testSupervisorBanksUnadmittedGxDma() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x340u;
	const uint32_t command0 = (bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x3fu;
	memory.writeMappedU32LE(source, command0);
	memory.writeMappedU32LE(source + 4u, 0x00020010u);
	memory.writeMappedU32LE(source + 8u, 0x00030020u);

	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 3u, GP0_WRITE_CONTROL);
	require(!harness.dma.hasAdmittedWriteBlock(bmsx::IO_GX_GPU_GP0), "low DREQ leaves the GX block unadmitted");
	require(!memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "the armed user channel still reserves GP0 from the CPU");

	harness.gpu.beginSupervisorQuiesce();
	harness.dma.beginSupervisorQuiesce();
	require(harness.gpu.supervisorQuiescent(), "an unadmitted GX transfer does not hold the GPU fence");
	require(harness.dma.supervisorQuiescent(), "an unadmitted GX transfer does not hold the DMA fence");
	harness.dma.enterSupervisorContext();
	harness.gpu.enterSupervisorContext();

	harness.gpu.leaveSupervisorContext();
	harness.dma.leaveSupervisorContext();
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "supervisor leave restores the armed user channel");
	require(!harness.dma.hasAdmittedWriteBlock(bmsx::IO_GX_GPU_GP0), "the restored channel still waits for GX DREQ");
	require(!memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "the restored user channel reserves GP0 from the CPU");

	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_FIFO);
	runNextDmaService(harness);
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "the restored channel completes after GX raises DREQ");
}

void testSupervisorClosesDmaAdmissionAfterControl() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x360u;
	const uint32_t destination = bmsx::DYNAMIC_RAM_BASE + 0x460u;
	for (uint32_t index = 0u; index < 17u; index += 1u) {
		memory.writeMappedU32LE(source + index * 4u, index + 1u);
	}

	programTransfer(memory, source, destination, 17u, ImgDecGatedRamCopyControl);
	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "low producer DREQ leaves the channel armed");
	harness.dma.beginSupervisorControlQuiesce();
	require(!harness.dma.supervisorQuiescent(), "closing trigger writes alone does not claim the bus fence");

	harness.dma.setRequestLines(1u << bmsx::DMA_REQUEST_IMGDEC_WRITE, 1u << bmsx::DMA_REQUEST_IMGDEC_WRITE);
	require(harness.scheduler.nextDeadline() != std::numeric_limits<int64_t>::max(), "an existing channel may admit while producers drain");
	harness.dma.beginSupervisorQuiesce();
	runNextDmaService(harness);

	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "the unadmitted tail remains bankable");
	require(memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 1u, "only the admitted block drains");
	require(harness.dma.captureState().activeChannel == bmsx::IO_DMA_CHANNEL_COUNT, "the admission gate prevents a second block");
	require(harness.dma.supervisorQuiescent(), "the DMA fence is reached after the admitted block");
}

void testSupervisorControlGateRejectsAdmittedSelfDmaTrigger() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x370u;
	memory.writeMappedU32LE(source, bmsx::DMA_TRIGGER_START);
	memory.writeMappedU32LE(bmsx::IO_DMA1_READ_ADDR, source);
	memory.writeMappedU32LE(bmsx::IO_DMA1_WRITE_ADDR, bmsx::DYNAMIC_RAM_BASE + 0x470u);
	memory.writeMappedU32LE(bmsx::IO_DMA1_TRANSFER_COUNT, 1u);
	memory.writeMappedU32LE(bmsx::IO_DMA1_CONTROL, RAM_COPY_CONTROL);

	programTransfer(memory, source, bmsx::IO_DMA1_TRIGGER, 1u, SelfDmaTriggerControl);
	harness.dma.beginSupervisorControlQuiesce();
	harness.dma.beginSupervisorQuiesce();
	runNextDmaService(harness);

	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "the admitted source block completes");
	require(memory.readIoU32(bmsx::IO_DMA1_STATUS) == 0u, "the closed target trigger cannot arm DMA1");
	require(memory.readIoU32(bmsx::IO_DMA1_TRIGGER) == 0u, "the rejected trigger does not enter the raw registerfile");
	require(harness.dma.supervisorQuiescent(), "the rejected self-DMA trigger cannot reopen the fence");
}

void testCpuToGp0ImagePayloadCrossesBlocks() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x380u;
	memory.writeMappedU32LE(source, bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	memory.writeMappedU32LE(source + 4u, 0u);
	memory.writeMappedU32LE(source + 8u, (1u << 16u) | 34u);
	for (uint32_t index = 0u; index < 17u; index += 1u) {
		memory.writeMappedU32LE(source + 12u + index * 4u, 0x55000000u | index);
	}

	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 20u, GP0_WRITE_CONTROL);
	runNextDmaService(harness);
	require(memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 4u, "the first programmed block transfers sixteen A0 words");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "the A0 transfer remains active between blocks");
	require((harness.gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) != 0u, "A0 payload streaming keeps the command front end ready");
	runNextDmaService(harness);

	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "the final partial A0 block completes DMA");
	require(commands.commandCount == 1u, "A0 DMA emits one upload command");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "A0 DMA retains the upload command kind");
}

void testForcedGp0DmaSaturatesPhysicalFifos() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x1000u;
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	harness.gpu.writeGp0(0u);
	harness.gpu.writeGp0((511u << 16u) | 0x03f1u);
	for (uint32_t index = 0u; index < 48u; index += 1u) {
		memory.writeMappedU32LE(source + index * 4u, 0x03000000u | index);
	}

	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 48u, ForcedGp0WriteControl);
	runNextDmaService(harness);
	bmsx::GxGpuState state = harness.gpu.captureState();
	require(state.gp0FifoWords.size() == bmsx::GX_GPU_COMMAND_FIFO_WORD_CAPACITY, "the first forced block occupies the command FIFO");
	require(state.gp0DmaIngressWords.empty(), "the first forced block drains out of DMA ingress");
	runNextDmaService(harness);
	state = harness.gpu.captureState();
	require(state.gp0FifoWords.size() == bmsx::GX_GPU_COMMAND_FIFO_WORD_CAPACITY, "the command FIFO remains physically bounded");
	require(state.gp0DmaIngressWords.size() == bmsx::GX_GPU_DMA_INGRESS_WORD_CAPACITY, "the second forced block occupies DMA ingress");
	runNextDmaService(harness);

	state = harness.gpu.captureState();
	require(state.gp0Word == 0x0300002fu, "every forced DMA word reaches the GP0 data latch");
	require(state.gp0FifoWords[bmsx::GX_GPU_COMMAND_FIFO_WORD_CAPACITY - 1u] == 0x0300000fu, "forced overflow preserves the first command-FIFO block");
	require(state.gp0DmaIngressWords[bmsx::GX_GPU_DMA_INGRESS_WORD_CAPACITY - 1u] == 0x0300001fu, "forced overflow preserves the first ingress block");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "forced overflow does not stall DMA completion");
}

void testAdmittedBlockSurvivesRequestDropAndRestore() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x400u;
	memory.writeMappedU32LE(source, 0xe1000000u);
	memory.writeMappedU32LE(source + 4u, 0xe1000001u);
	harness.dma.setTiming(4, 0, 4, 0, 0, 0);
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 2u, GP0_WRITE_CONTROL);
	require(harness.scheduler.nextDeadline() == 8, "DMA blocks two words after eight cycles");

	harness.scheduler.advanceTo(3);
	harness.dma.setTiming(8, 0, 8, 0, 0, 3);
	require(harness.scheduler.nextDeadline() == 8, "timing changes apply after the admitted block completion edge");
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_OFF);
	require(harness.scheduler.nextDeadline() == 8, "DREQ low does not cancel an admitted block");
	const bmsx::DmaControllerState state = harness.dma.captureState();
	require(state.scheduledReadAddressWord == source, "save state retains the admitted read address");
	require(state.scheduledWriteAddressWord == bmsx::IO_GX_GPU_GP0, "save state retains the admitted write address");
	require(state.scheduledTransferCountWord == 2u, "save state retains the admitted transfer count");
	require(state.scheduledControlWord == GP0_WRITE_CONTROL, "save state retains the admitted control word");
	harness.dma.restoreState(state, harness.scheduler.nowCycles());
	harness.dma.postLoad();
	require(harness.scheduler.nextDeadline() == 8, "restore preserves an admitted block while DREQ is low");
	runNextDmaService(harness);
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "the admitted block completes while DREQ remains low");
}

void testFiniteGxReadRequest() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	bmsx::GxGpu& gpu = harness.gpu;
	const uint32_t destination = bmsx::DYNAMIC_RAM_BASE + 0x500u;
	constexpr uint32_t sentinel = 0xa5a5a5a5u;
	memory.writeMappedU32LE(destination, sentinel);
	memory.writeMappedU32LE(destination + 4u, sentinel);
	memory.writeMappedU32LE(destination + 8u, sentinel);
	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 3u);
	programTransfer(memory, bmsx::IO_GX_GPU_GP0, destination, 3u, GP0_READ_CONTROL);

	harness.scheduler.advanceTo(1);
	gpu.onService(1);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& firstOutput = gpu.readDeviceOutput();
	bmsx::GxGpuReadbackPort& firstReadback = firstOutput.readbackPort;
	firstReadback.pixelBytes()[0u] = 0x11u;
	firstReadback.pixelBytes()[1u] = 0x11u;
	firstReadback.pixelBytes()[2u] = 0x22u;
	firstReadback.pixelBytes()[3u] = 0x22u;
	firstReadback.pixelBytes()[4u] = 0x33u;
	firstReadback.pixelBytes()[5u] = 0x33u;
	require(firstReadback.claimReadback(firstOutput.commandBuffer.presentCommandCount), "first readback claims its fence");
	firstReadback.completeReadback(firstReadback.token());
	require(memory.readMappedU32LE(bmsx::IO_GX_GPU_GP0) == 0u, "CPU GPUREAD retains its latch while DMA owns the read port");
	runNextDmaService(harness);
	runNextDmaService(harness);

	require(memory.readMappedU32LE(destination) == 0x22221111u, "DMA reads packed pixel word 0");
	require(memory.readMappedU32LE(destination + 4u) == 0x00003333u, "DMA reads the odd final pixel");
	require(memory.readMappedU32LE(destination + 8u) == sentinel, "DMA stops when finite DREQ falls");
	require(memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 1u, "DMA retains one requested word");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA remains busy between requests");
	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "DMA does not poll low DREQ");

	gpu.retirePresentedCommands();
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 2u);
	const bmsx::i64 readbackDeadline = harness.scheduler.nextDeadline();
	harness.scheduler.advanceTo(readbackDeadline);
	gpu.onService(readbackDeadline);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& secondOutput = gpu.readDeviceOutput();
	bmsx::GxGpuReadbackPort& secondReadback = secondOutput.readbackPort;
	secondReadback.pixelBytes()[0u] = 0x55u;
	secondReadback.pixelBytes()[1u] = 0x55u;
	secondReadback.pixelBytes()[2u] = 0x66u;
	secondReadback.pixelBytes()[3u] = 0x66u;
	require(secondReadback.claimReadback(secondOutput.commandBuffer.presentCommandCount), "second readback claims its fence");
	secondReadback.completeReadback(secondReadback.token());
	runNextDmaService(harness);
	require(memory.readMappedU32LE(destination + 8u) == 0x66665555u, "DMA resumes on the next read request");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "finite read DMA completes");
}

void testGxDirectionPublishesOneRequestEdge() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	bmsx::GxGpu& gpu = harness.gpu;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x580u;
	const uint32_t crossDestination = bmsx::DYNAMIC_RAM_BASE + 0x5c0u;
	const uint32_t readDestination = bmsx::DYNAMIC_RAM_BASE + 0x600u;
	memory.writeMappedU32LE(source, 0x12345678u);

	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 2u);
	const bmsx::i64 readbackDeadline = harness.scheduler.nextDeadline();
	harness.scheduler.advanceTo(readbackDeadline);
	gpu.onService(readbackDeadline);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	bmsx::GxGpuReadbackPort& readback = output.readbackPort;
	readback.pixelBytes()[0u] = 0x11u;
	readback.pixelBytes()[1u] = 0x11u;
	readback.pixelBytes()[2u] = 0x22u;
	readback.pixelBytes()[3u] = 0x22u;
	require(readback.claimReadback(output.commandBuffer.presentCommandCount), "direction test claims its readback fence");
	readback.completeReadback(readback.token());
	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_FIFO);

	programTransfer(memory, source, crossDestination, 1u, GxCrossRequestControl);
	memory.writeMappedU32LE(bmsx::IO_DMA1_READ_ADDR, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA1_WRITE_ADDR, readDestination);
	memory.writeMappedU32LE(bmsx::IO_DMA1_TRANSFER_COUNT, 1u);
	memory.writeMappedU32LE(bmsx::IO_DMA1_CONTROL, GP0_READ_CONTROL);
	memory.writeMappedU32LE(bmsx::IO_DMA1_TRIGGER, bmsx::DMA_TRIGGER_START);
	require(harness.dma.captureState().activeChannel == bmsx::IO_DMA_CHANNEL_COUNT, "opposite GX requests keep both channels waiting");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	const bmsx::DmaControllerState dmaState = harness.dma.captureState();
	require(dmaState.activeChannel == 1u, "the final GX read request admits channel one");
	require(dmaState.scheduledReadAddressWord == bmsx::IO_GX_GPU_GP0, "the direction edge does not admit the transient cross-request channel");
	require(memory.readMappedU32LE(crossDestination) == 0u, "the transient cross-request channel transfers no data");
}

void testBusFaultProgress() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t destination = bmsx::DYNAMIC_RAM_BASE + 0x600u;
	memory.writeMappedU32LE(destination, 0xdeadbeefu);
	programTransfer(memory, bmsx::RAM_END - 2u, destination, 1u, RAM_COPY_CONTROL);
	runNextDmaService(harness);

	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_CODE) == bmsx::BUS_FAULT_UNMAPPED, "Memory owns DMA bus faults");
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ADDR) == bmsx::RAM_END - 2u, "Memory latches the fault address");
	require(memory.readMappedU32LE(destination) == 0u, "faulting read supplies the bus value");
	require(memory.readIoU32(bmsx::IO_DMA0_READ_ADDR) == bmsx::RAM_END + 2u, "faulting DMA advances read address");
	require(memory.readIoU32(bmsx::IO_DMA0_WRITE_ADDR) == destination + 4u, "faulting DMA advances write address");
	require(memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 0u, "faulting DMA decrements count");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "faulting DMA completes normally");
}

void testSelfDmaControlAffectsNextAdmission() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x700u;
	const uint32_t runningControl = 0x00003c01u;
	memory.writeMappedU32LE(source, DmaDisabledControl);
	memory.writeMappedU32LE(source + 4u, runningControl);
	programTransfer(memory, source, bmsx::IO_DMA0_CONTROL, 2u, runningControl);
	runNextDmaService(harness);

	require(memory.readIoU32(bmsx::IO_DMA0_CONTROL) == runningControl, "both self-DMA control writes execute inside the admitted block");
	require(memory.readIoU32(bmsx::IO_DMA0_READ_ADDR) == source + 8u, "channel writes back the admitted read address");
	require(memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 0u, "the admitted block consumes both words");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "self-DMA completes");
	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "completed self-DMA has no service deadline");
}

void testZeroCountTrigger() {
	DmaGpuHarness harness;
	programTransfer(harness.memory, 0u, 0u, 0u, DmaDisabledControl);
	require(harness.memory.readIoU32(bmsx::IO_DMA0_TRIGGER) == 0u, "zero-count trigger self-clears");
	require(harness.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "zero-count trigger completes synchronously");
	require((harness.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA0_DONE) != 0u, "zero-count trigger raises completion IRQ");
}

void testClearingCountCompletesWaitingChannel() {
	DmaGpuHarness harness;
	programTransfer(harness.memory, 0u, bmsx::IO_GX_GPU_GP0, 1u, DmaDisabledControl);
	require(harness.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "DREQ-gated DMA remains armed");
	require(!harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "armed DMA reserves its destination port");
	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "DREQ-gated DMA has no service deadline");

	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, 0u);
	require(harness.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "clearing count completes the waiting channel");
	require(harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "completion releases the destination port");
	require((harness.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA0_DONE) != 0u, "completion raises the channel IRQ");
}

void testPortAddressAdvanceReleasesCpuWrite() {
	DmaGpuHarness harness;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x780u;
	harness.memory.writeMappedU32LE(source, 0u);
	harness.memory.writeMappedU32LE(source + 4u, 0u);
	programTransfer(harness.memory, source, bmsx::IO_GX_GPU_GP0, 2u, PortAdvanceControl);
	require(!harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "active DMA block owns the GP0 write port");

	runNextDmaService(harness);
	require(harness.memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 1u, "one transfer remains after the first block");
	require(harness.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "channel remains busy after releasing GP0");
	require(harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "advancing the channel address releases GP0");
	runNextDmaService(harness);
}

void testDirectionalRequestsGateAdmission() {
	DmaGpuHarness harness;
	const uint32_t source = bmsx::DYNAMIC_RAM_BASE + 0x800u;
	const uint32_t destination = bmsx::DYNAMIC_RAM_BASE + 0x900u;
	harness.memory.writeMappedU32LE(source, 0x12345678u);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, source);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, destination);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, 0x0000015bu);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);

	harness.dma.setRequestLines(1u << bmsx::DMA_REQUEST_IMGDEC_WRITE, 1u << bmsx::DMA_REQUEST_IMGDEC_WRITE);
	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "one directional DREQ must not admit a block");
	harness.dma.setRequestLines(1u << bmsx::DMA_REQUEST_IMGDEC_READ, 1u << bmsx::DMA_REQUEST_IMGDEC_READ);
	runNextDmaService(harness);

	require(harness.memory.readMappedU32LE(destination) == 0x12345678u, "both directional DREQs admit the transfer");
	require(harness.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "directionally gated transfer completes");
}

void testChannelsArbitrateBlocksRoundRobin() {
	DmaGpuHarness harness;
	const uint32_t source0 = bmsx::DYNAMIC_RAM_BASE + 0xa00u;
	const uint32_t destination0 = bmsx::DYNAMIC_RAM_BASE + 0xb00u;
	const uint32_t source1 = bmsx::DYNAMIC_RAM_BASE + 0xc00u;
	const uint32_t destination1 = bmsx::DYNAMIC_RAM_BASE + 0xd00u;
	for (uint32_t index = 0u; index < 17u; index += 1u) {
		harness.memory.writeMappedU32LE(source0 + index * 4u, index + 1u);
	}
	harness.memory.writeMappedU32LE(source1, 0x89abcdefu);
	programTransfer(harness.memory, source0, destination0, 17u, RAM_COPY_CONTROL);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA1_READ_ADDR, source1);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA1_WRITE_ADDR, destination1);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA1_TRANSFER_COUNT, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA1_CONTROL, RAM_COPY_CONTROL);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA1_TRIGGER, bmsx::DMA_TRIGGER_START);

	runNextDmaService(harness);
	require(harness.memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 1u, "channel zero yields after one block");
	require(harness.memory.readMappedU32LE(destination1) == 0u, "channel one waits for the shared bus");
	runNextDmaService(harness);
	require(harness.memory.readMappedU32LE(destination1) == 0x89abcdefu, "round-robin arbitration runs channel one next");
	require(harness.memory.readIoU32(bmsx::IO_DMA1_STATUS) == bmsx::DMA_STATUS_DONE, "channel one completes before channel zero's tail");
	require(harness.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "channel zero retains its remaining word");
	runNextDmaService(harness);
	require(harness.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "channel zero resumes after channel one");
	require(harness.memory.readMappedU32LE(destination0 + 16u * 4u) == 17u, "channel zero transfers its final word");
	require((harness.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & (bmsx::IRQ_DMA0_DONE | bmsx::IRQ_DMA1_DONE))
		== (bmsx::IRQ_DMA0_DONE | bmsx::IRQ_DMA1_DONE), "both channels raise their own completion IRQ");
}

} // namespace

int main() {
	testRegionAwareBlockTiming();
	testSystemRomTiming();
	testTimingAcrossMemoryRegionBoundaries();
	testCartRomBurstSetupIsBlockLocal();
	testRamBurstSetupIsBlockLocal();
	testPortSideAddsNoMemoryWait();
	testAdmittedRegisterState();
	testGxWriteRequestAndPortOwnership();
	testSupervisorBanksUnadmittedGxDma();
	testSupervisorClosesDmaAdmissionAfterControl();
	testSupervisorControlGateRejectsAdmittedSelfDmaTrigger();
	testCpuToGp0ImagePayloadCrossesBlocks();
	testForcedGp0DmaSaturatesPhysicalFifos();
	testAdmittedBlockSurvivesRequestDropAndRestore();
	testFiniteGxReadRequest();
	testGxDirectionPublishesOneRequestEdge();
	testBusFaultProgress();
	testSelfDmaControlAffectsNextAdmission();
	testZeroCountTrigger();
	testClearingCountCompletesWaitingChannel();
	testPortAddressAdvanceReleasesCpuWrite();
	testDirectionalRequestsGateAdmission();
	testChannelsArbitrateBlocksRoundRobin();
	return 0;
}
