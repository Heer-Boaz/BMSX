#include "machine/devices/dma/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"
#include "machine/scheduler/device.h"

#include <array>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace {

constexpr uint32_t RAM_COPY_CONTROL = bmsx::DMA_CONTROL_READ_INCREMENT
	| bmsx::DMA_CONTROL_WRITE_INCREMENT
	| bmsx::DMA_CONTROL_REQUEST_FORCE
	| bmsx::DMA_CONTROL_BLOCK_WORDS_16;
constexpr uint32_t GP0_WRITE_CONTROL = bmsx::DMA_CONTROL_READ_INCREMENT | bmsx::DMA_CONTROL_REQUEST_GX_WRITE | bmsx::DMA_CONTROL_BLOCK_WORDS_16;
constexpr uint32_t GP0_READ_CONTROL = bmsx::DMA_CONTROL_WRITE_INCREMENT | bmsx::DMA_CONTROL_REQUEST_GX_READ;

struct DmaGpuHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	std::array<uint8_t, 8> cartRom{{0x44u, 0x33u, 0x22u, 0x11u, 0x88u, 0x77u, 0x66u, 0x55u}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::DmaController dma;
	bmsx::GxGpu gpu;

	DmaGpuHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { cartRom.data(), cartRom.size() } })
		, irq(memory)
		, cpu(memory, irq)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler)
		, gpu(memory, irq, scheduler, dma) {
		dma.reset();
		gpu.reset();
		irq.reset();
		dma.setTiming(1, 16, 0, 0, 0);
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
	memory.writeMappedU32LE(bmsx::IO_DMA_READ_ADDR, readAddress);
	memory.writeMappedU32LE(bmsx::IO_DMA_WRITE_ADDR, writeAddress);
	memory.writeMappedU32LE(bmsx::IO_DMA_TRANSFER_COUNT, wordCount);
	memory.writeMappedU32LE(bmsx::IO_DMA_CONTROL, control);
	memory.writeMappedU32LE(bmsx::IO_DMA_TRIGGER, bmsx::DMA_TRIGGER_START);
}

void runNextDmaService(DmaGpuHarness& harness) {
	const int64_t deadline = harness.scheduler.nextDeadline();
	require(deadline != std::numeric_limits<int64_t>::max(), "DMA service must have a deadline");
	harness.scheduler.advanceTo(deadline);
	harness.dma.onService(deadline);
}

void setStandardTiming(bmsx::DmaController& dma, bmsx::DeviceScheduler& scheduler) {
	dma.setTiming(
		bmsx::PSX_MACHINE_SPEC.cpuFreqHz,
		bmsx::PSX_MACHINE_SPEC.dmaWordsPerSec,
		bmsx::PSX_MACHINE_SPEC.dmaRamRowReopenCycles,
		bmsx::PSX_MACHINE_SPEC.dmaRomWaitCyclesPerWord,
		scheduler.currentNowCycles());
}

void testFlyByCombinesRamRowsAndRomWaitStates() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t ramSource = bmsx::PROGRAM_STATIC_RAM_BASE + 0x80u;
	const uint32_t ramDestination = bmsx::PROGRAM_STATIC_RAM_BASE + 0xa0u;
	const uint32_t romDestination = bmsx::PROGRAM_STATIC_RAM_BASE + 0xc0u;
	memory.writeMappedU32LE(ramSource, 0x99aabbccu);
	memory.writeMappedU32LE(ramSource + 4u, 0xddeeff00u);
	setStandardTiming(harness.dma, harness.scheduler);

	// RAM<->RAM is the one fly-by exception: a single-ported chip can't serve
	// both addresses in one cycle, so the two sides' costs sum instead of
	// taking the slower one. Word 0 is a cold row on both sides (4 base + 12
	// reopen each = 32); word 1 stays in the same row on both sides (4 + 4 = 8).
	programTransfer(memory, ramSource, ramDestination, 2u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 40, "RAM<->RAM sums both sides' row-aware cost");
	runNextDmaService(harness);
	require(memory.readMappedU32LE(ramDestination) == 0x99aabbccu, "RAM<->RAM DMA copies word 0");
	require(memory.readMappedU32LE(ramDestination + 4u) == 0xddeeff00u, "RAM<->RAM DMA copies word 1");

	// Cartridge ROM has no row locality (flat 10 cycles/word). The RAM write
	// side starts a fresh row here, so word 0's cold RAM cost (16) beats the
	// flat ROM cost (10); word 1's warm RAM cost (4) loses to ROM's flat 10.
	// Fly-by takes the slower side each time: max(10,16)=16, max(10,4)=10.
	programTransfer(memory, bmsx::CART_ROM_BASE, romDestination, 2u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 66, "cartridge-ROM source is fly-by combined with the RAM destination's row cost");
	runNextDmaService(harness);
	require(memory.readMappedU32LE(romDestination) == 0x11223344u, "cartridge-ROM DMA copies word 0");
	require(memory.readMappedU32LE(romDestination + 4u) == 0x55667788u, "cartridge-ROM DMA copies word 1");
}

void testRamRowHitIsCheaperThanReopen() {
	DmaGpuHarness harness;
	const uint32_t readAddr = bmsx::PROGRAM_STATIC_RAM_BASE + 0x2000u;
	const uint32_t writeAddr = bmsx::PROGRAM_STATIC_RAM_BASE + 0x2100u;
	setStandardTiming(harness.dma, harness.scheduler);

	programTransfer(harness.memory, readAddr, writeAddr, 1u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 32, "first touch of a fresh row on both sides pays the reopen tax twice");
	runNextDmaService(harness);

	programTransfer(harness.memory, readAddr, writeAddr, 1u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 40, "revisiting the same row on both sides is a hit: only the base cost is charged");
}

void testRamRowJumpRepaysReopenTax() {
	DmaGpuHarness harness;
	const uint32_t readAddr = bmsx::PROGRAM_STATIC_RAM_BASE + 0x2000u;
	const uint32_t writeAddr = bmsx::PROGRAM_STATIC_RAM_BASE + 0x2100u;
	const uint32_t nextRowReadAddr = readAddr + 0x40u; // one PSX_DMA_RAM_ROW_WORDS row further
	setStandardTiming(harness.dma, harness.scheduler);

	programTransfer(harness.memory, readAddr, writeAddr, 1u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 32, "first touch of a fresh row on both sides pays the reopen tax twice");
	runNextDmaService(harness);

	// Read side jumps to a new row (cold again: 16); write side repeats the
	// same address as before (still warm: 4).
	programTransfer(harness.memory, nextRowReadAddr, writeAddr, 1u, RAM_COPY_CONTROL);
	require(harness.scheduler.nextDeadline() == 52, "a row jump on one side repays its reopen tax even while the other side stays warm");
}

void testPortSideAddsNoWaitCostBesideRam() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x3000u;
	memory.writeMappedU32LE(source, 0x01020304u);
	memory.writeMappedU32LE(source + 4u, 0x05060708u);
	setStandardTiming(harness.dma, harness.scheduler);

	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 2u, GP0_WRITE_CONTROL);
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_FIFO);
	// A fixed GX FIFO port classifies as neither RAM nor ROM and contributes
	// zero wait cost of its own; fly-by leaves only the RAM read side's cost:
	// word 0 cold (16), word 1 warm (4).
	require(harness.scheduler.nextDeadline() == 20, "a fixed MMIO port never adds its own wait cost beside the RAM side");
}

void testRomAndRamSidesEachWinTheFlyByOnDifferentWords() {
	DmaGpuHarness harness;
	const uint32_t destination = bmsx::PROGRAM_STATIC_RAM_BASE + 0x4000u;
	setStandardTiming(harness.dma, harness.scheduler);

	programTransfer(harness.memory, bmsx::CART_ROM_BASE, destination, 2u, RAM_COPY_CONTROL);
	// word 0: cold RAM (16) beats flat ROM (10) -- RAM gates the word.
	// word 1: warm RAM (4) loses to flat ROM (10) -- ROM gates the word.
	// This proves the combine is a genuine per-word max(), not "source wins"
	// or "destination wins" or a flat sum (10+16=26 for word 0 alone would
	// already differ from the correct max of 16).
	require(harness.scheduler.nextDeadline() == 26, "fly-by lets either side gate a given word depending on which is slower");
}

void testRowMemorySurvivesSaveRestore() {
	DmaGpuHarness sourceHarness;
	const uint32_t readAddr = bmsx::PROGRAM_STATIC_RAM_BASE + 0x5000u;
	const uint32_t writeAddr = bmsx::PROGRAM_STATIC_RAM_BASE + 0x5100u;
	setStandardTiming(sourceHarness.dma, sourceHarness.scheduler);
	programTransfer(sourceHarness.memory, readAddr, writeAddr, 1u, RAM_COPY_CONTROL);
	require(sourceHarness.scheduler.nextDeadline() == 32, "first touch of a fresh row on both sides pays the reopen tax twice");
	runNextDmaService(sourceHarness);
	const bmsx::DmaControllerState state = sourceHarness.dma.captureState();

	DmaGpuHarness restoredHarness;
	setStandardTiming(restoredHarness.dma, restoredHarness.scheduler);
	restoredHarness.dma.restoreState(state, restoredHarness.scheduler.currentNowCycles());
	restoredHarness.dma.postLoad();

	programTransfer(restoredHarness.memory, readAddr, writeAddr, 1u, RAM_COPY_CONTROL);
	require(restoredHarness.scheduler.nextDeadline() == 8, "restored row memory turns the next same-row access into a hit, not a cold reopen");
}

void testLiveRegisterChannel() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x100u;
	const uint32_t destination = bmsx::PROGRAM_STATIC_RAM_BASE + 0x200u;
	memory.writeMappedU32LE(source, 0x11223344u);
	memory.writeMappedU32LE(source + 4u, 0x55667788u);
	memory.writeMappedU32LE(source + 8u, 0x99aabbccu);

	programTransfer(memory, source, destination, 3u, RAM_COPY_CONTROL);
	require(memory.readIoU32(bmsx::IO_DMA_TRIGGER) == 0u, "DMA trigger self-clears");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA trigger sets BUSY");
	runNextDmaService(harness);

	require(memory.readMappedU32LE(destination) == 0x11223344u, "DMA copies word 0");
	require(memory.readMappedU32LE(destination + 4u) == 0x55667788u, "DMA copies word 1");
	require(memory.readMappedU32LE(destination + 8u) == 0x99aabbccu, "DMA copies word 2");
	require(memory.readIoU32(bmsx::IO_DMA_READ_ADDR) == source + 12u, "DMA advances read address");
	require(memory.readIoU32(bmsx::IO_DMA_WRITE_ADDR) == destination + 12u, "DMA advances write address");
	require(memory.readIoU32(bmsx::IO_DMA_TRANSFER_COUNT) == 0u, "DMA decrements transfer count");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "DMA completes");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA_DONE) != 0u, "DMA raises completion IRQ");
}

void testGxWriteRequestAndPortOwnership() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x300u;
	const uint32_t command0 = (bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x3fu;
	memory.writeMappedU32LE(source, command0);
	memory.writeMappedU32LE(source + 4u, 0x00020010u);
	memory.writeMappedU32LE(source + 8u, 0x00030020u);

	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 3u, GP0_WRITE_CONTROL);
	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "GP1 direction gates GX write DREQ");
	require(!memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "BUSY DMA owns the GP0 port");
	memory.writeMappedU32LE(bmsx::IO_DMA_TRIGGER, bmsx::DMA_TRIGGER_START);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "busy retrigger is ignored");

	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_FIFO);
	runNextDmaService(harness);

	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;
	require(commands.commandCount == 1u, "DMA emits one GX command");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_FILL_RECTANGLE, "DMA emits the fill command");
	require(commands.words[commands.commandWordStart[0]] == command0, "DMA emits the first command word");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "GX DMA completes");
	require(memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "DMA completion releases GP0");
}

void testCpuToGp0ImagePayloadCrossesBlocks() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x380u;
	memory.writeMappedU32LE(source, bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	memory.writeMappedU32LE(source + 4u, 0u);
	memory.writeMappedU32LE(source + 8u, (1u << 16u) | 34u);
	for (uint32_t index = 0u; index < 17u; index += 1u) {
		memory.writeMappedU32LE(source + 12u + index * 4u, 0x55000000u | index);
	}

	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 20u, GP0_WRITE_CONTROL);
	runNextDmaService(harness);
	require(memory.readIoU32(bmsx::IO_DMA_TRANSFER_COUNT) == 4u, "the first programmed block transfers sixteen A0 words");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "the A0 transfer remains active between blocks");
	require((harness.gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) != 0u, "A0 payload streaming keeps the command front end ready");
	runNextDmaService(harness);

	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "the final partial A0 block completes DMA");
	require(commands.commandCount == 1u, "A0 DMA emits one upload command");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "A0 DMA retains the upload command kind");
}

void testAdmittedBlockSurvivesRequestDropAndRestore() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x400u;
	memory.writeMappedU32LE(source, 0xe1000000u);
	memory.writeMappedU32LE(source + 4u, 0xe1000001u);
	harness.dma.setTiming(4, 1, 0, 0, 0);
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 2u, GP0_WRITE_CONTROL);
	require(harness.scheduler.nextDeadline() == 8, "DMA blocks two words after eight cycles");

	harness.scheduler.advanceTo(3);
	harness.dma.setTiming(8, 1, 0, 0, 3);
	require(harness.scheduler.nextDeadline() == 8, "timing changes apply after the admitted block completion edge");
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_OFF);
	require(harness.scheduler.nextDeadline() == 8, "DREQ low does not cancel an admitted block");
	const bmsx::DmaControllerState state = harness.dma.captureState();
	harness.dma.restoreState(state, harness.scheduler.nowCycles());
	harness.dma.postLoad();
	require(harness.scheduler.nextDeadline() == 8, "restore preserves an admitted block while DREQ is low");
	runNextDmaService(harness);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "the admitted block completes while DREQ remains low");
}

void testFiniteGxReadRequest() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	bmsx::GxGpu& gpu = harness.gpu;
	const uint32_t destination = bmsx::PROGRAM_STATIC_RAM_BASE + 0x500u;
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
	runNextDmaService(harness);
	runNextDmaService(harness);

	require(memory.readMappedU32LE(destination) == 0x22221111u, "DMA reads packed pixel word 0");
	require(memory.readMappedU32LE(destination + 4u) == 0x00003333u, "DMA reads the odd final pixel");
	require(memory.readMappedU32LE(destination + 8u) == sentinel, "DMA stops when finite DREQ falls");
	require(memory.readIoU32(bmsx::IO_DMA_TRANSFER_COUNT) == 1u, "DMA retains one requested word");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA remains busy between requests");
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
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "finite read DMA completes");
}

void testBusFaultProgress() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t destination = bmsx::PROGRAM_STATIC_RAM_BASE + 0x600u;
	memory.writeMappedU32LE(destination, 0xdeadbeefu);
	programTransfer(memory, bmsx::RAM_END - 2u, destination, 1u, RAM_COPY_CONTROL);
	runNextDmaService(harness);

	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_CODE) == bmsx::BUS_FAULT_UNMAPPED, "Memory owns DMA bus faults");
	require(memory.readIoU32(bmsx::IO_SYS_BUS_FAULT_ADDR) == bmsx::RAM_END - 2u, "Memory latches the fault address");
	require(memory.readMappedU32LE(destination) == 0u, "faulting read supplies the bus value");
	require(memory.readIoU32(bmsx::IO_DMA_READ_ADDR) == bmsx::RAM_END + 2u, "faulting DMA advances read address");
	require(memory.readIoU32(bmsx::IO_DMA_WRITE_ADDR) == destination + 4u, "faulting DMA advances write address");
	require(memory.readIoU32(bmsx::IO_DMA_TRANSFER_COUNT) == 0u, "faulting DMA decrements count");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "faulting DMA completes normally");
}

void testSelfDmaWritebackOrder() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x700u;
	const uint32_t runningControl = bmsx::DMA_CONTROL_READ_INCREMENT | bmsx::DMA_CONTROL_REQUEST_FORCE;
	memory.writeMappedU32LE(source, bmsx::DMA_CONTROL_REQUEST_DISABLED);
	memory.writeMappedU32LE(source + 4u, runningControl);
	programTransfer(memory, source, bmsx::IO_DMA_CONTROL, 2u, runningControl);
	runNextDmaService(harness);

	require(memory.readIoU32(bmsx::IO_DMA_CONTROL) == bmsx::DMA_CONTROL_REQUEST_DISABLED, "self-DMA control write takes effect");
	require(memory.readIoU32(bmsx::IO_DMA_READ_ADDR) == source + 4u, "channel writes back the latched read address");
	require(memory.readIoU32(bmsx::IO_DMA_TRANSFER_COUNT) == 1u, "channel writes back the latched count");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "disabled request leaves channel busy");
	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "disabled request has no service deadline");

	memory.writeMappedU32LE(bmsx::IO_DMA_CONTROL, runningControl);
	runNextDmaService(harness);
	require(memory.readIoU32(bmsx::IO_DMA_TRANSFER_COUNT) == 0u, "re-enabled self-DMA consumes the second word");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "self-DMA completes");
}

void testZeroCountTrigger() {
	DmaGpuHarness harness;
	programTransfer(harness.memory, 0u, 0u, 0u, bmsx::DMA_CONTROL_REQUEST_DISABLED);
	require(harness.memory.readIoU32(bmsx::IO_DMA_TRIGGER) == 0u, "zero-count trigger self-clears");
	require(harness.memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "zero-count trigger completes synchronously");
	require((harness.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA_DONE) != 0u, "zero-count trigger raises completion IRQ");
}

} // namespace

int main() {
	testFlyByCombinesRamRowsAndRomWaitStates();
	testRamRowHitIsCheaperThanReopen();
	testRamRowJumpRepaysReopenTax();
	testPortSideAddsNoWaitCostBesideRam();
	testRomAndRamSidesEachWinTheFlyByOnDifferentWords();
	testRowMemorySurvivesSaveRestore();
	testLiveRegisterChannel();
	testGxWriteRequestAndPortOwnership();
	testCpuToGp0ImagePayloadCrossesBlocks();
	testAdmittedBlockSurvivesRequestDropAndRestore();
	testFiniteGxReadRequest();
	testBusFaultProgress();
	testSelfDmaWritebackOrder();
	testZeroCountTrigger();
	return 0;
}
