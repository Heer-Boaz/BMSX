#include "machine/devices/dma/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

#include <array>
#include <cstdint>
#include <stdexcept>

namespace {

struct DmaGpuHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::IrqController irq;
	bmsx::VDP vdp;
	bmsx::DmaController dma;
	bmsx::GxGpu gpu;

	DmaGpuHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, cpu(memory)
		, scheduler(cpu)
		, irq(memory)
		, vdp(memory, scheduler, bmsx::VdpFrameBufferSize{16u, 16u})
		, dma(memory, irq, vdp, scheduler)
		, gpu(memory, scheduler) {
		dma.reset();
		gpu.reset();
		irq.reset();
		dma.setTiming(1, 64, 64, 0);
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

void testDmaClipsNonStrictGxGp0StreamToWholeWords() {
	DmaGpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	const uint32_t source = bmsx::PROGRAM_STATIC_RAM_BASE + 0x140u;

	memory.writeMappedU32LE(source, (bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000123u);
	memory.writeMappedU32LE(source + 4u, (bmsx::GX_GPU_GP0_SET_MASK_BIT << 24u) | 0x000003u);
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

	memory.writeMappedU32LE(source, (bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000456u);
	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, source);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, 6u);
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START | bmsx::DMA_CTRL_STRICT);

	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == (bmsx::DMA_STATUS_DONE | bmsx::DMA_STATUS_ERROR | bmsx::DMA_STATUS_CLIPPED), "DMA strict GP0 stream rejects non-word length");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 0u, "DMA strict GP0 stream writes zero bytes");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_DMA_ERROR) == bmsx::IRQ_DMA_ERROR, "DMA strict GP0 stream raises error IRQ");
	require(harness.gpu.readDrawModeWord() == 0u, "GX-GPU GP0 strict rejected stream issues no command word");
}

} // namespace

int main() {
	testDmaStreamsRamWordsToGxGp0();
	testDmaClipsNonStrictGxGp0StreamToWholeWords();
	testDmaStrictRejectsNonWordGxGp0StreamLength();
	return 0;
}
