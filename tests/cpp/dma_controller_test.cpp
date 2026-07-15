#include "machine/devices/dma/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

#include <array>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace {

constexpr uint32_t RAM_COPY_CONTROL = bmsx::DMA_CONTROL_READ_INCREMENT
	| bmsx::DMA_CONTROL_WRITE_INCREMENT
	| bmsx::DMA_CONTROL_REQUEST_FORCE;
constexpr uint32_t GP0_WRITE_CONTROL = bmsx::DMA_CONTROL_READ_INCREMENT | bmsx::DMA_CONTROL_REQUEST_GX_WRITE;
constexpr uint32_t GP0_READ_CONTROL = bmsx::DMA_CONTROL_WRITE_INCREMENT | bmsx::DMA_CONTROL_REQUEST_GX_READ;

struct DmaGpuHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::DmaController dma;
	bmsx::GxGpu gpu;

	DmaGpuHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, irq(memory)
		, cpu(memory, irq)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler)
		, gpu(memory, irq, scheduler, dma) {
		dma.reset();
		gpu.reset();
		irq.reset();
		dma.setTiming(1, 16, 0);
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

void testRequestEdgeRestartsTiming() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x400u;
	memory.writeMappedU32LE(source, 0xe1000000u);
	memory.writeMappedU32LE(source + 4u, 0xe1000001u);
	harness.dma.setTiming(4, 1, 0);
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	programTransfer(memory, source, bmsx::IO_GX_GPU_GP0, 2u, GP0_WRITE_CONTROL);
	require(harness.scheduler.nextDeadline() == 8, "DMA grants two words after eight cycles");

	harness.scheduler.advanceTo(3);
	harness.dma.setTiming(4, 1, 3);
	require(harness.scheduler.nextDeadline() == 8, "unchanged clock programming preserves the active DMA phase");
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_OFF);
	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "DREQ low cancels the grant");
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	require(harness.scheduler.nextDeadline() == 11, "new DREQ edge starts a fresh timing interval");
	runNextDmaService(harness);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "rearmed DMA completes");
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
	harness.scheduler.advanceTo(3);
	gpu.onService(3);
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
	testLiveRegisterChannel();
	testGxWriteRequestAndPortOwnership();
	testRequestEdgeRestartsTiming();
	testFiniteGxReadRequest();
	testBusFaultProgress();
	testSelfDmaWritebackOrder();
	testZeroCountTrigger();
	return 0;
}
