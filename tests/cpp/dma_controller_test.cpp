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

struct DmaGpuHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::IrqController irq;
	bmsx::DmaController dma;
	bmsx::GxGpu gpu;

	DmaGpuHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, cpu(memory)
		, scheduler(cpu)
		, irq(memory)
		, dma(memory, irq, scheduler)
		, gpu(memory, irq, scheduler, dma) {
		dma.reset();
		gpu.reset();
		irq.reset();
		dma.setTiming(1, 64, 0);
	}
};

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void testDmaStreamsRamWordsToGxGp0() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x100u;
	const uint32_t command0 = (bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000003fu;
	const uint32_t command1 = 0x00020010u;
	const uint32_t command2 = 0x00030020u;

	memory.writeMappedU32LE(source, command0);
	memory.writeMappedU32LE(source + 4u, command1);
	memory.writeMappedU32LE(source + 8u, command2);
	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, source);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, 12u);
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START);
	harness.dma.accrueCycles(12, 12);
	harness.dma.onService(12);

	const bmsx::GxGpuCommandBuffer& commands = *harness.gpu.readDeviceOutput().commandBuffer;
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "DMA GP0 stream completes");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 12u, "DMA GP0 stream written count");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA_DONE) == bmsx::IRQ_DMA_DONE, "DMA GP0 stream raises done IRQ");
	require(commands.commandCount == 1u, "GX-GPU DMA GP0 fill command count");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_FILL_RECTANGLE, "GX-GPU DMA GP0 fill command kind");
	require(commands.commandWordCount[0] == 3u, "GX-GPU DMA GP0 fill command word count");
	require(commands.words[commands.commandWordStart[0]] == command0, "GX-GPU DMA GP0 first command word");
	require(commands.words[commands.commandWordStart[0] + 1u] == command1, "GX-GPU DMA GP0 second command word");
	require(commands.words[commands.commandWordStart[0] + 2u] == command2, "GX-GPU DMA GP0 third command word");
}

void testDmaAdmitsOneGp0FifoBlockAndResumesSuffixOnGpuReadyEdge() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x140u;
	harness.dma.setTiming(1, 80, 0);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000003fu);
	harness.gpu.writeGp0(0u);
	harness.gpu.writeGp0((0x1ffu << 16u) | 0x3ffu);
	const int64_t fillDeadline = harness.scheduler.nextDeadline();
	for (uint32_t index = 0u; index < 20u; index += 1u) {
		memory.writeMappedU32LE(source + index * 4u, (bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | index);
	}
	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, source);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, 80u);
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START);
	harness.dma.accrueCycles(80, 1);
	harness.dma.onService(1);

	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA GP0 FIFO block leaves its suffix busy");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 64u, "DMA GP0 FIFO block admits exactly sixteen words");
	require(harness.scheduler.nextDeadline() == fillDeadline, "DMA GP0 FIFO backpressure cancels its own service deadline");

	harness.scheduler.advanceTo(fillDeadline + 15);
	harness.gpu.onService(fillDeadline + 15);
	require(harness.scheduler.nextDeadline() == fillDeadline + 15, "GPU ready edge schedules the retained DMA suffix immediately");
	harness.dma.onService(fillDeadline + 15);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "DMA GP0 FIFO suffix completes on the ready edge");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 80u, "DMA GP0 FIFO suffix publishes the complete byte count");
}

void testDmaPreservesCpuToVramPacketAcrossServiceSlices() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x1c0u;
	const uint32_t command0 = bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u;
	const uint32_t command1 = 0x00020010u;
	const uint32_t command2 = 0x00020003u;
	const uint32_t payload0 = 0x22221111u;
	const uint32_t payload1 = 0x44443333u;
	const uint32_t payload2 = 0x66665555u;

	harness.dma.setTiming(1, 8, 0);
	memory.writeMappedU32LE(source, command0);
	memory.writeMappedU32LE(source + 4u, command1);
	memory.writeMappedU32LE(source + 8u, command2);
	memory.writeMappedU32LE(source + 12u, payload0);
	memory.writeMappedU32LE(source + 16u, payload1);
	memory.writeMappedU32LE(source + 20u, payload2);
	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, source);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, 24u);
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START);

	const bmsx::GxGpuCommandBuffer& commands = *harness.gpu.readDeviceOutput().commandBuffer;
	harness.dma.accrueCycles(1, 1);
	harness.dma.onService(1);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA CPU-to-VRAM stream remains busy after first slice");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 8u, "DMA CPU-to-VRAM first slice written count");
	require(commands.commandCount == 0u, "GX-GPU CPU-to-VRAM header slice emits no command");

	harness.dma.accrueCycles(1, 2);
	harness.dma.onService(2);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA CPU-to-VRAM stream remains busy after payload starts");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 16u, "DMA CPU-to-VRAM second slice written count");
	require(commands.commandCount == 0u, "GX-GPU partial CPU-to-VRAM payload emits no command");
	require(commands.wordCount == 4u, "GX-GPU CPU-to-VRAM command buffer holds header plus first payload word");

	harness.dma.accrueCycles(1, 3);
	harness.dma.onService(3);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "DMA CPU-to-VRAM stream completes");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 24u, "DMA CPU-to-VRAM final written count");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA_DONE) == bmsx::IRQ_DMA_DONE, "DMA CPU-to-VRAM stream raises done IRQ");
	require(commands.commandCount == 1u, "GX-GPU CPU-to-VRAM command count");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "GX-GPU CPU-to-VRAM command kind");
	require(commands.commandWordCount[0] == 6u, "GX-GPU CPU-to-VRAM command word count");
	const uint32_t wordStart = commands.commandWordStart[0];
	require(commands.words[wordStart] == command0, "GX-GPU CPU-to-VRAM command word 0");
	require(commands.words[wordStart + 1u] == command1, "GX-GPU CPU-to-VRAM command word 1");
	require(commands.words[wordStart + 2u] == command2, "GX-GPU CPU-to-VRAM command word 2");
	require(commands.words[wordStart + 3u] == payload0, "GX-GPU CPU-to-VRAM payload word 0");
	require(commands.words[wordStart + 4u] == payload1, "GX-GPU CPU-to-VRAM payload word 1");
	require(commands.words[wordStart + 5u] == payload2, "GX-GPU CPU-to-VRAM payload word 2");
}

void testDmaConsumesGpureadOnlyWhileReadbackReady() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	bmsx::GxGpu& gpu = harness.gpu;
	const uint32_t destination = bmsx::PROGRAM_STATIC_RAM_BASE + 0x300u;
	constexpr uint32_t sentinel = 0xa5a5a5a5u;
	memory.writeMappedU32LE(destination, sentinel);
	memory.writeMappedU32LE(destination + 4u, sentinel);
	memory.writeMappedU32LE(destination + 8u, sentinel);

	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 3u);
	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, destination);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, 12u);
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START);
	harness.dma.accrueCycles(12, 12);
	harness.dma.onService(12);
	harness.scheduler.advanceTo(1);
	gpu.onService(1);

	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "DMA GPUREAD source has no service deadline while readback is pending");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA GPUREAD source remains busy while readback is pending");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 0u, "DMA GPUREAD source makes no pending progress");
	require(memory.readMappedU32LE(destination) == sentinel, "DMA GPUREAD pending transfer preserves destination word 0");
	require(memory.readMappedU32LE(destination + 4u) == sentinel, "DMA GPUREAD pending transfer preserves destination word 1");
	require(memory.readMappedU32LE(destination + 8u) == sentinel, "DMA GPUREAD pending transfer preserves destination word 2");

	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& firstOutput = gpu.readDeviceOutput();
	bmsx::GxGpuReadbackPort& firstReadback = *firstOutput.readbackPort;
	firstReadback.pixelBytes()[0u] = 0x11u;
	firstReadback.pixelBytes()[1u] = 0x11u;
	firstReadback.pixelBytes()[2u] = 0x22u;
	firstReadback.pixelBytes()[3u] = 0x22u;
	firstReadback.pixelBytes()[4u] = 0x33u;
	firstReadback.pixelBytes()[5u] = 0x33u;
	require(firstReadback.claimReadback(firstOutput.commandBuffer->presentCommandCount), "DMA GPUREAD first backend request claims its fence");
	harness.scheduler.advanceTo(12);
	firstReadback.completeReadback(firstReadback.token());
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) != 0u, "DMA GPUREAD first backend completion asserts ready-to-send");
	require(harness.scheduler.nextDeadline() == 12, "DMA GPUREAD ready edge schedules service immediately");
	const bmsx::DmaControllerState readyDmaState = harness.dma.captureState();
	const bmsx::GxGpuState readyGpuState = gpu.captureState();
	harness.dma.onService(12);

	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA GPUREAD source pauses when the finite readback is exhausted");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 8u, "DMA GPUREAD source publishes only real readback bytes");
	require(memory.readMappedU32LE(destination) == 0x22221111u, "DMA GPUREAD source writes packed pixel word 0");
	require(memory.readMappedU32LE(destination + 4u) == 0x00003333u, "DMA GPUREAD source writes odd zero-filled pixel word");
	require(memory.readMappedU32LE(destination + 8u) == sentinel, "DMA GPUREAD source does not copy the retained latch after exhaustion");
	require(gpu.readGpuReadWord() == 0x00003333u, "DMA GPUREAD source leaves the final word latched");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "DMA GPUREAD source drops ready-to-send after the final real word");
	require(harness.scheduler.nextDeadline() == std::numeric_limits<int64_t>::max(), "DMA GPUREAD exhausted source cancels service instead of polling");
	harness.dma.restoreState(readyDmaState, 12);
	gpu.restoreState(readyGpuState);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) != 0u, "DMA GPUREAD restore republishes the ready line from port state");
	require(harness.scheduler.nextDeadline() == 12, "DMA GPUREAD restored ready state re-arms service");
	harness.dma.onService(12);
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 8u, "DMA GPUREAD restored ready state consumes real words again");
	require(memory.readMappedU32LE(destination + 8u) == sentinel, "DMA GPUREAD restored ready state still stops before the retained latch");
	const bmsx::DmaControllerState stalledState = harness.dma.captureState();
	const bmsx::DmaJobState& stalled = stalledState.queue[0u];
	require(stalled.src == bmsx::IO_GX_GPU_GP0, "DMA GPUREAD source port address remains fixed");
	require(stalled.dst == destination + 8u, "DMA GPUREAD destination advances by consumed words");
	require(stalled.remaining == 4u, "DMA GPUREAD exhausted request retains remaining length");
	require(stalled.written == 8u, "DMA GPUREAD exhausted request retains written length");

	gpu.retirePresentedCommands();
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 2u);
	harness.scheduler.advanceTo(13);
	gpu.onService(13);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& secondOutput = gpu.readDeviceOutput();
	bmsx::GxGpuReadbackPort& secondReadback = *secondOutput.readbackPort;
	secondReadback.pixelBytes()[0u] = 0x55u;
	secondReadback.pixelBytes()[1u] = 0x55u;
	secondReadback.pixelBytes()[2u] = 0x66u;
	secondReadback.pixelBytes()[3u] = 0x66u;
	require(secondReadback.claimReadback(secondOutput.commandBuffer->presentCommandCount), "DMA GPUREAD second backend request claims its fence");
	harness.scheduler.advanceTo(13);
	secondReadback.completeReadback(secondReadback.token());
	require(harness.scheduler.nextDeadline() == 13, "DMA GPUREAD second ready edge resumes the retained job");
	harness.dma.onService(13);

	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "DMA GPUREAD source completes across ready requests");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 12u, "DMA GPUREAD source publishes final written count");
	require(memory.readMappedU32LE(destination + 8u) == 0x66665555u, "DMA GPUREAD resumed source writes the next real word");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA_DONE) == bmsx::IRQ_DMA_DONE, "DMA GPUREAD source raises done IRQ");
}

void testDmaClipsGpureadSourceLengthToWholeWords() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t destination = bmsx::PROGRAM_STATIC_RAM_BASE + 0x380u;
	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, destination);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, 6u);
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START);

	const bmsx::DmaControllerState state = harness.dma.captureState();
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == (bmsx::DMA_STATUS_BUSY | bmsx::DMA_STATUS_CLIPPED), "DMA GPUREAD source clips non-word length before waiting");
	require(state.queue.size() == 1u, "DMA GPUREAD clipped source queues one job");
	require(state.queue[0u].remaining == 4u, "DMA GPUREAD clipped source retains one complete word");
}

void testDmaStrictRejectsNonWordGpureadSourceLength() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t destination = bmsx::PROGRAM_STATIC_RAM_BASE + 0x3c0u;
	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, destination);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, 6u);
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START | bmsx::DMA_CTRL_STRICT);

	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == (bmsx::DMA_STATUS_DONE | bmsx::DMA_STATUS_ERROR | bmsx::DMA_STATUS_CLIPPED), "DMA strict GPUREAD source rejects non-word length");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 0u, "DMA strict GPUREAD source consumes zero bytes");
	require(harness.dma.captureState().queue.empty(), "DMA strict GPUREAD source queues no job");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA_ERROR) == bmsx::IRQ_DMA_ERROR, "DMA strict GPUREAD source raises error IRQ");
}

void testDmaClipsNonStrictGxGp0StreamToWholeWords() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x140u;

	memory.writeMappedU32LE(source, (bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000123u);
	memory.writeMappedU32LE(source + 4u, (bmsx::GX_GPU_GP0_MASK_BIT << 24u) | 0x000003u);
	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, source);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, 6u);
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START);
	harness.dma.accrueCycles(6, 6);
	harness.dma.onService(6);

	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == (bmsx::DMA_STATUS_DONE | bmsx::DMA_STATUS_CLIPPED), "DMA GP0 stream clips non-word length");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 4u, "DMA GP0 clipped stream written count");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA_DONE) == bmsx::IRQ_DMA_DONE, "DMA GP0 clipped stream raises done IRQ");
	require(harness.gpu.readDrawModeWord() == 0x000123u, "GX-GPU GP0 executes only the complete clipped word");
	require(harness.gpu.readMaskBitModeWord() == 0u, "GX-GPU GP0 clipped tail word is not executed");
}

void testDmaStrictRejectsNonWordGxGp0StreamLength() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x180u;

	memory.writeMappedU32LE(source, (bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000456u);
	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, source);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, 6u);
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START | bmsx::DMA_CTRL_STRICT);

	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == (bmsx::DMA_STATUS_DONE | bmsx::DMA_STATUS_ERROR | bmsx::DMA_STATUS_CLIPPED), "DMA strict GP0 stream rejects non-word length");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 0u, "DMA strict GP0 stream writes zero bytes");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA_ERROR) == bmsx::IRQ_DMA_ERROR, "DMA strict GP0 stream raises error IRQ");
	require(harness.gpu.readDrawModeWord() == 0u, "GX-GPU GP0 strict rejected stream issues no command word");
}

void testDmaFullFifoRejectionPreservesQueuedProgressLatch() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x240u;
	bmsx::DmaControllerState restored;
	restored.queue.resize(bmsx::DMA_JOB_QUEUE_CAPACITY);
	for (size_t index = 0u; index < restored.queue.size(); index += 1u) {
		restored.queue[index].src = source + static_cast<uint32_t>(index * 4u);
		restored.queue[index].dst = bmsx::IO_GX_GPU_GP0;
		restored.queue[index].remaining = 4u;
	}
	restored.writtenValue = 37u;
	restored.sourceRegisterWord = source;
	restored.destinationRegisterWord = bmsx::IO_GX_GPU_GP0;
	restored.lengthRegisterWord = 4u;
	restored.statusRegisterWord = bmsx::DMA_STATUS_BUSY;
	restored.writtenRegisterWord = 37u;
	harness.dma.restoreState(restored, 0);

	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, source);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, 4u);
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START);

	const bmsx::DmaControllerState state = harness.dma.captureState();
	require(state.queue.size() == bmsx::DMA_JOB_QUEUE_CAPACITY, "DMA full-FIFO rejection should retain the existing jobs");
	require(state.writtenValue == 37u, "DMA full-FIFO rejection should preserve the queued progress latch value");
	require(!state.writtenDirty, "DMA full-FIFO rejection should preserve the queued progress latch dirty bit");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == (bmsx::DMA_STATUS_DONE | bmsx::DMA_STATUS_ERROR), "DMA full-FIFO rejection should publish an error");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 0u, "DMA full-FIFO rejection should publish zero bytes for the rejected request");
}

} // namespace

int main() {
	testDmaStreamsRamWordsToGxGp0();
	testDmaAdmitsOneGp0FifoBlockAndResumesSuffixOnGpuReadyEdge();
	testDmaPreservesCpuToVramPacketAcrossServiceSlices();
	testDmaConsumesGpureadOnlyWhileReadbackReady();
	testDmaClipsGpureadSourceLengthToWholeWords();
	testDmaStrictRejectsNonWordGpureadSourceLength();
	testDmaClipsNonStrictGxGp0StreamToWholeWords();
	testDmaStrictRejectsNonWordGxGp0StreamLength();
	testDmaFullFifoRejectionPreservesQueuedProgressLatch();
	return 0;
}
