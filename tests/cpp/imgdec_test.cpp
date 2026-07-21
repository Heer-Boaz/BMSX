#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/devices/imgdec/contracts.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/system/controller.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"
#include "machine/scheduler/device.h"

#include <array>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace {

constexpr bmsx::u32 TextureWordCount = 40u;
constexpr bmsx::u32 ClutWordCount = 8u;
constexpr bmsx::u32 PayloadWordCount = TextureWordCount + ClutWordCount;
constexpr bmsx::u32 PatternWordCount = 16u;
constexpr bmsx::u32 StreamWordCount = 3u + 1u + PatternWordCount + 1u;
constexpr bmsx::u32 ImgDecDmaControl = bmsx::DMA_CONTROL_READ_INCREMENT
	| bmsx::DMA_CONTROL_REQUEST_IMGDEC_WRITE
	| bmsx::DMA_CONTROL_BLOCK_WORDS_16;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

struct ImgDecHarness {
	std::array<bmsx::u8, StreamWordCount * 4u> cartRom{};
	std::array<bmsx::u32, PayloadWordCount> payload{};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::DmaController dma;
	bmsx::GeometryController geometry;
	bmsx::GxGpu gpu;
	bmsx::ImgDecController imgDec;
	bmsx::SystemController system;

	ImgDecHarness()
		: memory(bmsx::MemoryInit{ { nullptr, 0u }, { cartRom.data(), cartRom.size() } })
		, irq(memory)
		, cpu(memory, irq)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler)
		, geometry(memory, irq, scheduler)
		, gpu(memory, irq, scheduler, dma)
		, imgDec(memory, cpu, irq, scheduler, dma, gpu, bmsx::PSX_MACHINE_SPEC.imgDecCyclesPerOutputWord)
		, system(memory, cpu, scheduler, irq, dma, geometry, gpu, imgDec) {
		std::array<bmsx::u32, StreamWordCount> stream{};
		stream[0] = bmsx::IMGDEC_STREAM_MAGIC;
		stream[1] = TextureWordCount;
		stream[2] = ClutWordCount;
		stream[3] = (bmsx::IMGDEC_TOKEN_KIND_LITERAL << bmsx::IMGDEC_TOKEN_KIND_SHIFT) | (PatternWordCount - 1u);
		for (bmsx::u32 index = 0u; index < PayloadWordCount; index += 1u) {
			payload[index] = ((index & (PatternWordCount - 1u)) + 1u) * 0x10204081u;
			if (index < PatternWordCount) {
				stream[4u + index] = payload[index];
			}
		}
		stream[4u + PatternWordCount] = (bmsx::IMGDEC_TOKEN_KIND_BACK_REFERENCE << bmsx::IMGDEC_TOKEN_KIND_SHIFT)
			| ((PayloadWordCount - PatternWordCount - bmsx::IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH)
				<< bmsx::IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT)
			| (PatternWordCount - 1u);
		for (size_t index = 0u; index < stream.size(); index += 1u) {
			const bmsx::u32 word = stream[index];
			cartRom[index * 4u] = static_cast<bmsx::u8>(word);
			cartRom[index * 4u + 1u] = static_cast<bmsx::u8>(word >> 8u);
			cartRom[index * 4u + 2u] = static_cast<bmsx::u8>(word >> 16u);
			cartRom[index * 4u + 3u] = static_cast<bmsx::u8>(word >> 24u);
		}
		dma.reset();
		geometry.reset();
		gpu.reset();
		imgDec.reset();
		irq.reset();
		system.reset();
		const bmsx::u32 smode1Address = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW);
		memory.writeMappedU32LE(smode1Address, memory.readMappedU32LE(smode1Address) | bmsx::GX_GPU_PCRTC_SMODE1_SINT);
		gpu.onService(0);
		dma.setTiming(
			bmsx::PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
			bmsx::PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
			bmsx::PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
			bmsx::PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
			bmsx::PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
			scheduler.currentNowCycles()
		);
	}
};

void runNextService(ImgDecHarness& harness) {
	const bmsx::i64 deadline = harness.scheduler.nextDeadline();
	require(deadline != std::numeric_limits<bmsx::i64>::max(), "IMGDEC must retain a service deadline");
	harness.scheduler.advanceTo(deadline);
	while (harness.scheduler.hasDueTimer()) {
		const bmsx::u8 device = static_cast<bmsx::u8>(harness.scheduler.popDueTimer() & 0xffu);
		switch (device) {
		case bmsx::DEVICE_SERVICE_DMA:
			harness.dma.onService(deadline);
			break;
		case bmsx::DEVICE_SERVICE_GPU:
			harness.gpu.onService(deadline);
			break;
		case bmsx::DEVICE_SERVICE_IMGDEC:
			harness.imgDec.onService(deadline);
			break;
		case bmsx::DEVICE_SERVICE_SYSTEM:
			harness.system.onService();
			break;
		}
	}
}

bool runUntilComplete(ImgDecHarness& harness) {
	bool outputBlocked = false;
	bmsx::u32 status = harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS);
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 1000u && status != bmsx::IMGDEC_STATUS_DONE;
		serviceCount += 1u) {
		runNextService(harness);
		status = harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS);
		outputBlocked = outputBlocked || (status & bmsx::IMGDEC_STATUS_OUTPUT_BLOCKED) != 0u;
	}
	require(status == bmsx::IMGDEC_STATUS_DONE, "IMGDEC must complete the stream");
	return outputBlocked;
}

void runUntilGpuCommandCount(ImgDecHarness& harness, bmsx::u32 commandCount) {
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 1000u && harness.gpu.readDeviceOutput().commandBuffer.commandCount < commandCount;
		serviceCount += 1u) {
		runNextService(harness);
	}
	require(harness.gpu.readDeviceOutput().commandBuffer.commandCount == commandCount, "GX must consume every IMGDEC packet");
}

void configureUpload(
	ImgDecHarness& harness,
	bmsx::u32 textureDestination,
	bmsx::u32 textureSize,
	bmsx::u32 clutDestination
) {
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_INPUT_WORD_COUNT, StreamWordCount);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_DESTINATION, textureDestination);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_SIZE, textureSize);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CLUT_DESTINATION, clutDestination);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CONTROL, bmsx::IMGDEC_CONTROL_START);
}

void prepareImgDecDma(ImgDecHarness& harness, bmsx::u32 sourceAddress, bmsx::u32 wordCount) {
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_READ_ADDR, sourceAddress);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_WRITE_ADDR, bmsx::IO_IMGDEC_DATA);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRANSFER_COUNT, wordCount);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_CONTROL, ImgDecDmaControl);
}

void startImgDecDma(ImgDecHarness& harness) {
	prepareImgDecDma(harness, bmsx::CART_ROM_BASE, StreamWordCount);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRIGGER, bmsx::DMA_TRIGGER_START);
}

void prepareGxDma(ImgDecHarness& harness, bmsx::u32 sourceAddress, bmsx::u32 wordCount) {
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_FIFO);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_READ_ADDR, sourceAddress);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_WRITE_ADDR, bmsx::IO_GX_GPU_GP0);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRANSFER_COUNT, wordCount);
	harness.memory.writeMappedU32LE(
		bmsx::IO_DMA_CONTROL,
		bmsx::DMA_CONTROL_READ_INCREMENT | bmsx::DMA_CONTROL_REQUEST_GX_WRITE | bmsx::DMA_CONTROL_BLOCK_WORDS_16
	);
}

void testCompressedTextureAndClutUpload() {
	ImgDecHarness harness;
	constexpr bmsx::u32 textureDestination = 0x00200040u;
	constexpr bmsx::u32 textureSize = 80u | (1u << 16u);
	constexpr bmsx::u32 clutDestination = 0x00400100u;
	configureUpload(harness, textureDestination, textureSize, clutDestination);
	startImgDecDma(harness);
	runUntilComplete(harness);
	runUntilGpuCommandCount(harness, 2u);

	require(harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) == bmsx::IMGDEC_STATUS_DONE, "IMGDEC completes the stream");
	require((harness.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_IMGDEC) != 0u, "IMGDEC raises its completion IRQ");
	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;
	require(commands.commandCount == 2u, "IMGDEC emits separate texture and CLUT uploads");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "texture command uses native GP0 upload");
	require(commands.commandKind[1] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "CLUT command uses native GP0 upload");
	require(commands.words[commands.commandWordStart[0] + 1u] == textureDestination, "texture destination reaches GP0 unchanged");
	require(commands.words[commands.commandWordStart[0] + 2u] == textureSize, "texture dimensions reach GP0 unchanged");
	for (bmsx::u32 index = 0u; index < TextureWordCount; index += 1u) {
		require(commands.words[commands.commandWordStart[0] + 3u + index] == harness.payload[index], "texture payload reaches GP0 unchanged");
	}
	require(commands.words[commands.commandWordStart[1] + 1u] == clutDestination, "CLUT destination reaches GP0 unchanged");
	require(commands.words[commands.commandWordStart[1] + 2u] == (16u | (1u << 16u)), "CLUT dimensions use one 16-word row");
	for (bmsx::u32 index = 0u; index < ClutWordCount; index += 1u) {
		require(commands.words[commands.commandWordStart[1] + 3u + index] == harness.payload[TextureWordCount + index], "CLUT payload reaches GP0 unchanged");
	}
	for (bmsx::u32 commandIndex = 0u; commandIndex < 5u; commandIndex += 1u) {
		harness.gpu.writeGp0(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u);
		harness.gpu.writeGp0(0u);
		harness.gpu.writeGp0(0x01ff03ffu);
	}
	require(harness.memory.mappedWriteReady(bmsx::IO_IMGDEC_CONTROL), "a queued complete GP0 packet does not block the next IMGDEC start");
	configureUpload(harness, textureDestination, textureSize, clutDestination);
	startImgDecDma(harness);
	require(runUntilComplete(harness), "IMGDEC must retain and resume GX FIFO backpressure");
	runUntilGpuCommandCount(harness, 9u);
}

void testGp0GrantWaitsForActiveCpuPacket() {
	ImgDecHarness harness;
	constexpr bmsx::u32 fillHeader = (bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x123456u;
	harness.gpu.writeGp0(fillHeader);
	configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
	require(!harness.gpu.captureState().imgDecGp0Active, "IMGDEC request must not steal a partial CPU packet");
	require(!harness.gpu.captureState().imgDecGp0DmaContinuation,
		"IMGDEC request must not grant continuation to a later GX DMA trigger");
	require(harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "CPU must finish the accepted GP0 packet before IMGDEC grant");
	for (bmsx::u32 index = 0u; index < 16u; index += 1u) {
		harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + index * 4u, 0u);
	}
	prepareGxDma(harness, bmsx::PROGRAM_STATIC_RAM_BASE, 16u);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRIGGER, bmsx::DMA_TRIGGER_START);
	require(!harness.dma.hasAdmittedGxGpuWriteBlock(), "a pending IMGDEC request must lower GX-write DREQ before DMA admission");
	require(!harness.gpu.captureState().imgDecGp0DmaContinuation,
		"a later GX DMA trigger must not rewrite the latched IMGDEC arbitration owner");
	harness.gpu.writeGp0(0x00100020u);
	harness.gpu.writeGp0(0x00040008u);
	require(harness.gpu.captureState().imgDecGp0Active, "GX must grant IMGDEC at the completed CPU packet boundary");
	require(!harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "IMGDEC grant must gate later CPU GP0 stores");
	for (bmsx::u32 index = 0u; index < StreamWordCount; index += 1u) {
		harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_DATA, harness.memory.readMappedU32LE(bmsx::CART_ROM_BASE + index * 4u));
	}

	runUntilComplete(harness);
	runUntilGpuCommandCount(harness, 3u);
	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_FILL_RECTANGLE, "the accepted CPU fill must remain ahead of IMGDEC uploads");
	require(commands.words[commands.commandWordStart[0]] == fillHeader, "the CPU fill header must remain intact");
	require(commands.words[commands.commandWordStart[0] + 1u] == 0x00100020u, "the CPU fill position must remain intact");
	require(commands.words[commands.commandWordStart[0] + 2u] == 0x00040008u, "the CPU fill size must remain intact");
	require(commands.commandKind[1] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "IMGDEC texture upload must follow the CPU packet");
	require(commands.commandKind[2] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "IMGDEC CLUT upload must follow the texture upload");
}

void testGp0AbortGrantsImgDec() {
	for (bmsx::u32 resetOpcode : { bmsx::GX_GPU_GP1_CLEAR_FIFO, bmsx::GX_GPU_GP1_RESET }) {
		ImgDecHarness harness;
		harness.gpu.writeGp0(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u);
		configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
		require(!harness.gpu.captureState().imgDecGp0Active, "IMGDEC request must wait behind the partial CPU packet");

		harness.gpu.writeGp1(resetOpcode << 24u);
		require(harness.gpu.captureState().imgDecGp0Active, "GP1 packet abort must grant pending IMGDEC ingress");
		for (bmsx::u32 index = 0u; index < StreamWordCount; index += 1u) {
			harness.memory.writeMappedU32LE(
				bmsx::IO_IMGDEC_DATA,
				harness.memory.readMappedU32LE(bmsx::CART_ROM_BASE + index * 4u)
			);
		}

		runUntilComplete(harness);
		runUntilGpuCommandCount(harness, 2u);
		const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;
		require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
			"aborted CPU packet must not precede the IMGDEC texture upload");
		require(commands.commandKind[1] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
			"IMGDEC CLUT upload must follow the texture upload after GP1 abort");
	}
}

void testGp1AbortsActiveImgDecOutput() {
	for (bmsx::u32 resetOpcode : { bmsx::GX_GPU_GP1_CLEAR_FIFO, bmsx::GX_GPU_GP1_RESET }) {
		ImgDecHarness harness;
		configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
		for (bmsx::u32 index = 0u; index < StreamWordCount; index += 1u) {
			harness.memory.writeMappedU32LE(
				bmsx::IO_IMGDEC_DATA,
				harness.memory.readMappedU32LE(bmsx::CART_ROM_BASE + index * 4u)
			);
		}
		runNextService(harness);
		bmsx::GxGpuState gpuState = harness.gpu.captureState();
		require(gpuState.gp0IngressPhase == bmsx::GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD,
			"IMGDEC must own an active GX image packet before GP1 abort");
		require(gpuState.imgDecGp0Active, "IMGDEC must retain the active GX grant before GP1 abort");

		harness.gpu.writeGp1(resetOpcode << 24u);
		require(harness.gpu.captureState().imgDecGp0AbortPending,
			"GP1 must latch the active IMGDEC output abort at the GX owner");
		runNextService(harness);
		require(harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) == bmsx::IMGDEC_STATUS_OUTPUT_ABORTED,
			"IMGDEC must publish the GX output abort instead of completing a corrupt stream");
		require((harness.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_IMGDEC) != 0u,
			"IMGDEC must raise its IRQ for a GX output abort");
		gpuState = harness.gpu.captureState();
		require(gpuState.gp0IngressPhase == bmsx::GX_GPU_GP0_INGRESS_COMMAND,
			"GP1 abort must restore the GX packet boundary");
		require(!gpuState.imgDecGp0Active && !gpuState.imgDecGp0AbortPending,
			"IMGDEC fault publication must release the GX grant and abort latch");

		configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
		for (bmsx::u32 index = 0u; index < StreamWordCount; index += 1u) {
			harness.memory.writeMappedU32LE(
				bmsx::IO_IMGDEC_DATA,
				harness.memory.readMappedU32LE(bmsx::CART_ROM_BASE + index * 4u)
			);
		}
		runUntilComplete(harness);
		runUntilGpuCommandCount(harness, 2u);
		require(harness.gpu.readDeviceOutput().commandBuffer.commandKind[0]
			== bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
			"the next IMGDEC stream must start on a reusable GX packet boundary");
	}
}

void testGp0GrantWaitsForAdmittedDmaBlock() {
	ImgDecHarness harness;
	harness.gpu.writeGp0(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u);
	harness.gpu.writeGp0(0u);
	harness.gpu.writeGp0(1023u | (511u << 16u));
	for (bmsx::u32 index = 0u; index < 15u; index += 1u) {
		harness.gpu.writeGp0(0x03000000u);
	}
	require(harness.gpu.captureState().gp0FifoWordCount == 15u, "the active fill must retain the queued GP0 words");
	for (bmsx::u32 index = 0u; index < 16u; index += 1u) {
		harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + index * 4u, 0x03000000u);
	}
	prepareGxDma(harness, bmsx::PROGRAM_STATIC_RAM_BASE, 16u);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRIGGER, bmsx::DMA_TRIGGER_START);
	require(harness.dma.hasAdmittedGxGpuWriteBlock(), "GX DMA must admit the raw block before IMGDEC requests ingress");

	configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
	require(!harness.gpu.captureState().imgDecGp0Active, "IMGDEC request must wait behind the admitted GX DMA block");
	runNextService(harness);
	const bmsx::GxGpuState gpuState = harness.gpu.captureState();
	require(gpuState.gp0FifoWordCount == 31u, "the admitted DMA block must remain retained beyond the physical FIFO threshold");
	require(gpuState.imgDecGp0Active, "GX must grant IMGDEC on the admitted DMA block-end edge");
	require(harness.gpu.imgDecGp0WritableWordCount(harness.scheduler.currentNowCycles()) == 0u,
		"IMGDEC must wait until the retained GX words fall below physical FIFO capacity");

	startImgDecDma(harness);
	runUntilComplete(harness);
	runUntilGpuCommandCount(harness, 3u);
}

void testAdmittedGxDmaFinishesPartialPacketBeforeImgDec() {
	ImgDecHarness harness;
	constexpr bmsx::u32 payloadWordCount = 32u;
	constexpr bmsx::u32 packetWordCount = payloadWordCount + 3u;
	harness.memory.writeMappedU32LE(
		bmsx::PROGRAM_STATIC_RAM_BASE,
		bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u
	);
	harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + 4u, 0x00100020u);
	harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + 8u, 64u | (1u << 16u));
	for (bmsx::u32 index = 0u; index < payloadWordCount; index += 1u) {
		harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + 12u + index * 4u, index + 1u);
	}
	prepareGxDma(harness, bmsx::PROGRAM_STATIC_RAM_BASE, packetWordCount);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRIGGER, bmsx::DMA_TRIGGER_START);
	require(harness.dma.hasAdmittedGxGpuWriteBlock(),
		"GX DMA must admit its first image block before IMGDEC requests ingress");
	configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
	require(harness.gpu.captureState().imgDecGp0DmaContinuation,
		"IMGDEC request must retain the pre-existing GX DMA transfer owner");

	runNextService(harness);
	const bmsx::GxGpuState blockedGpuState = harness.gpu.captureState();
	require(blockedGpuState.gp0IngressPhase == bmsx::GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD,
		"the first GX DMA block must end inside the image payload");
	require(!blockedGpuState.imgDecGp0Active,
		"IMGDEC must wait while the admitted GX DMA transfer owns a partial packet");
	require(blockedGpuState.imgDecGp0DmaContinuation,
		"the pre-existing GX DMA continuation latch must survive its partial block boundary");
	require(harness.dma.hasAdmittedGxGpuWriteBlock(),
		"the active GX DMA transfer must admit its continuation block despite the IMGDEC request");
	for (bmsx::u32 index = 0u; index < StreamWordCount; index += 1u) {
		harness.memory.writeMappedU32LE(
			bmsx::IO_IMGDEC_DATA,
			harness.memory.readMappedU32LE(bmsx::CART_ROM_BASE + index * 4u)
		);
	}

	runUntilComplete(harness);
	runUntilGpuCommandCount(harness, 3u);
	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		"the admitted GX DMA image upload must remain first");
	require(commands.commandWordCount[0] == packetWordCount,
		"the admitted GX DMA image packet must complete without truncation");
	require(commands.commandKind[1] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		"the IMGDEC texture upload must follow the completed GX DMA packet");
}

void testImgDecContinuationEndsWithGxDmaTransfer() {
	ImgDecHarness harness;
	constexpr bmsx::u32 payloadWordCount = 16u;
	constexpr bmsx::u32 packetWordCount = payloadWordCount + 3u;
	constexpr bmsx::u32 dmaWordCount = 16u;
	harness.memory.writeMappedU32LE(
		bmsx::PROGRAM_STATIC_RAM_BASE,
		bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u
	);
	harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + 4u, 0x00100020u);
	harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + 8u, 32u | (1u << 16u));
	for (bmsx::u32 index = 0u; index < dmaWordCount - 3u; index += 1u) {
		harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + 12u + index * 4u, index + 1u);
	}
	prepareGxDma(harness, bmsx::PROGRAM_STATIC_RAM_BASE, dmaWordCount);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRIGGER, bmsx::DMA_TRIGGER_START);
	configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
	require(harness.gpu.captureState().imgDecGp0DmaContinuation,
		"IMGDEC request must retain the pre-existing GX DMA transfer epoch");
	runNextService(harness);
	require(harness.gpu.captureState().gp0IngressPhase == bmsx::GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD,
		"the pre-existing GX DMA transfer must end inside its image payload");
	require(!harness.gpu.captureState().imgDecGp0DmaContinuation,
		"the final DMA transfer strobe must close IMGDEC continuation ownership");
	require(!harness.dma.captureState().transferStarted,
		"DMA completion must release physical port ownership");

	for (bmsx::u32 index = 0u; index < 16u; index += 1u) {
		harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + index * 4u, 0u);
	}
	prepareGxDma(harness, bmsx::PROGRAM_STATIC_RAM_BASE, 16u);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRIGGER, bmsx::DMA_TRIGGER_START);
	require(!harness.dma.hasAdmittedGxGpuWriteBlock(),
		"a later GX DMA transfer must not inherit the closed continuation epoch");
	require(harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0),
		"an armed but unadmitted DMA transfer must not own the CPU GP0 port");
	for (bmsx::u32 index = dmaWordCount - 3u; index < payloadWordCount; index += 1u) {
		harness.memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP0, index + 1u);
	}
	require(harness.gpu.captureState().imgDecGp0Active,
		"IMGDEC must take ingress when the CPU completes the abandoned DMA packet");
	for (bmsx::u32 index = 0u; index < StreamWordCount; index += 1u) {
		harness.memory.writeMappedU32LE(
			bmsx::IO_IMGDEC_DATA,
			harness.memory.readMappedU32LE(bmsx::CART_ROM_BASE + index * 4u)
		);
	}

	runUntilComplete(harness);
	runUntilGpuCommandCount(harness, 3u);
	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		"the completed mixed DMA/CPU upload must remain first");
	require(commands.commandWordCount[0] == packetWordCount,
		"the mixed DMA/CPU image packet must preserve its physical boundary");
	require(commands.commandKind[1] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		"IMGDEC texture output must follow the completed prior packet");
}

void testForcedDmaInputFifoOverflow() {
	ImgDecHarness harness;
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_INPUT_WORD_COUNT, 48u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_DESTINATION, 0x00200040u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_SIZE, 256u | (8u << 16u));
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CLUT_DESTINATION, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CONTROL, bmsx::IMGDEC_CONTROL_START);
	harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE, bmsx::IMGDEC_STREAM_MAGIC);
	harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + 4u, 1024u);
	harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + 8u, 0u);
	harness.memory.writeMappedU32LE(
		bmsx::PROGRAM_STATIC_RAM_BASE + 12u,
		(bmsx::IMGDEC_TOKEN_KIND_ZERO << bmsx::IMGDEC_TOKEN_KIND_SHIFT) | 1023u
	);
	for (bmsx::u32 index = 4u; index < 48u; index += 1u) {
		harness.memory.writeMappedU32LE(bmsx::PROGRAM_STATIC_RAM_BASE + index * 4u, 0x03000000u);
	}
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_READ_ADDR, bmsx::PROGRAM_STATIC_RAM_BASE);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_WRITE_ADDR, bmsx::IO_IMGDEC_DATA);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRANSFER_COUNT, 48u);
	harness.memory.writeMappedU32LE(
		bmsx::IO_DMA_CONTROL,
		bmsx::DMA_CONTROL_READ_INCREMENT | bmsx::DMA_CONTROL_REQUEST_FORCE | bmsx::DMA_CONTROL_BLOCK_WORDS_16
	);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRIGGER, bmsx::DMA_TRIGGER_START);
	while (harness.memory.readIoU32(bmsx::IO_IMGDEC_INPUT_WORDS_RECEIVED) != 48u) {
		runNextService(harness);
	}
	const bmsx::ImgDecControllerState state = harness.imgDec.captureState();
	require(state.inputWordsReceived == 48u, "forced DMA must count every DATA bus word");
	require(state.inputWords.size() == bmsx::IMGDEC_INPUT_FIFO_WORD_CAPACITY,
		"the full input FIFO must drop later forced-DMA words without corrupting its count");
}

void testFormatFaultAbortsPartialGp0Packet() {
	ImgDecHarness harness;
	constexpr std::array<bmsx::u32, 5u> malformedWords = {
		bmsx::IMGDEC_STREAM_MAGIC,
		2u,
		0u,
		bmsx::IMGDEC_TOKEN_KIND_LITERAL << bmsx::IMGDEC_TOKEN_KIND_SHIFT,
		0x12345678u,
	};
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_INPUT_WORD_COUNT, malformedWords.size());
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_DESTINATION, 0x00200040u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_SIZE, 4u | (1u << 16u));
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CLUT_DESTINATION, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CONTROL, bmsx::IMGDEC_CONTROL_START);
	for (bmsx::u32 word : malformedWords) {
		harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_DATA, word);
	}
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 1000u && harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) != bmsx::IMGDEC_STATUS_FORMAT_FAULT;
		serviceCount += 1u) {
		runNextService(harness);
	}
	require(harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) == bmsx::IMGDEC_STATUS_FORMAT_FAULT,
		"truncated literal must latch an IMGDEC format fault");
	require((harness.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_IMGDEC) != 0u,
		"IMGDEC must raise its IRQ for a format fault");
	const bmsx::GxGpuState faultedGpuState = harness.gpu.captureState();
	require(faultedGpuState.gp0IngressPhase == bmsx::GX_GPU_GP0_INGRESS_COMMAND,
		"format fault must restore the GX packet boundary");
	require(faultedGpuState.gp0ImageLoadWordsRemaining == 0u,
		"format fault must discard decoder-owned partial image payload state");
	require(faultedGpuState.gp0CommandWordCount == 0u,
		"format fault must discard decoder-owned partial command words");

	configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
	for (bmsx::u32 index = 0u; index < StreamWordCount; index += 1u) {
		harness.memory.writeMappedU32LE(
			bmsx::IO_IMGDEC_DATA,
			harness.memory.readMappedU32LE(bmsx::CART_ROM_BASE + index * 4u)
		);
	}
	runUntilComplete(harness);
	runUntilGpuCommandCount(harness, 2u);
	const bmsx::GxGpuCommandBuffer& commandBuffer = harness.gpu.readDeviceOutput().commandBuffer;
	require(commandBuffer.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		"the next IMGDEC texture upload must start at a fresh GP0 boundary");
	require(commandBuffer.words[commandBuffer.commandWordStart[0] + 3u] == harness.payload[0],
		"the next IMGDEC upload must retain its first payload word");
	while (commandBuffer.executedCommandCount < commandBuffer.commandCount) {
		runNextService(harness);
	}
	harness.gpu.presentReadyFrameOnVblankEdge();
	harness.gpu.retirePresentedCommands();
	harness.system.requestSupervisorLineEdge();
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 1000u && harness.system.captureState().supervisorPhase != bmsx::SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
		serviceCount += 1u) {
		runNextService(harness);
	}
	require(harness.system.captureState().supervisorPhase == bmsx::SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR,
		"supervisor entry must cross the post-fault GX boundary");
}

void testImgDecDmaContinuationDuringSupervisorQuiesce() {
	ImgDecHarness blockedStart;
	blockedStart.system.requestSupervisorLineEdge();
	require(!blockedStart.memory.mappedWriteReady(bmsx::IO_IMGDEC_CONTROL),
		"supervisor quiesce must close the IMGDEC start gate");

	ImgDecHarness harness;
	configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
	harness.system.requestSupervisorLineEdge();
	prepareImgDecDma(harness, bmsx::CART_ROM_BASE, StreamWordCount);
	require(harness.memory.mappedWriteReady(bmsx::IO_DMA_TRIGGER),
		"supervisor quiesce must admit the DMA continuation of an active IMGDEC stream");
	harness.memory.writeMappedU32LE(bmsx::IO_DMA_TRIGGER, bmsx::DMA_TRIGGER_START);
	runUntilComplete(harness);
	while (harness.gpu.readDeviceOutput().commandBuffer.executedCommandCount
		< harness.gpu.readDeviceOutput().commandBuffer.commandCount) {
		runNextService(harness);
	}
	harness.gpu.presentReadyFrameOnVblankEdge();
	harness.gpu.retirePresentedCommands();
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 1000u && harness.system.captureState().supervisorPhase != bmsx::SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
		serviceCount += 1u) {
		runNextService(harness);
	}
	require(harness.system.captureState().supervisorPhase == bmsx::SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR,
		"supervisor entry must wait for and then cross the IMGDEC boundary");
}

void testDecodeBatchDeadlinePublication() {
	ImgDecHarness harness;
	configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
	startImgDecDma(harness);
	bmsx::Memory& memory = harness.memory;
	bmsx::ImgDecControllerState state = harness.imgDec.captureState();
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 100u && state.scheduledDecodeWords != bmsx::IMGDEC_DECODE_BATCH_WORDS;
		serviceCount += 1u) {
		runNextService(harness);
		state = harness.imgDec.captureState();
	}
	require(state.scheduledDecodeWords == bmsx::IMGDEC_DECODE_BATCH_WORDS, "IMGDEC must retain one bounded decode batch");
	const bmsx::u32 decodedWordCount = memory.readIoU32(bmsx::IO_IMGDEC_DECODED_WORD_COUNT);
	require(decodedWordCount == state.decodedWordCount, "scheduled words must not publish before their decode deadline");
	const bmsx::i64 decodeDeadline = harness.scheduler.currentNowCycles() + state.scheduledDecodeCycles;
	require(harness.scheduler.nextDeadline() == decodeDeadline, "the decoder must retain the cumulative batch deadline");
	harness.scheduler.advanceTo(decodeDeadline - 1);
	require(!harness.scheduler.hasDueTimer(), "the decode batch must remain latent before its deadline");
	require(memory.readIoU32(bmsx::IO_IMGDEC_DECODED_WORD_COUNT) == decodedWordCount, "decoded progress must remain latent before the deadline");
	runNextService(harness);
	require(memory.readIoU32(bmsx::IO_IMGDEC_DECODED_WORD_COUNT)
		== decodedWordCount + bmsx::IMGDEC_DECODE_BATCH_WORDS, "the due decode batch must publish atomically");
	runUntilComplete(harness);
}

void testGp0ReadbackReadinessWake() {
	ImgDecHarness harness;
	harness.gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	harness.gpu.writeGp0(0u);
	harness.gpu.writeGp0(1u | (1u << 16u));
	const bmsx::GxGpuDeviceOutput& output = harness.gpu.readDeviceOutput();
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 100u && output.readbackPort.phase() != bmsx::GX_GPU_READBACK_PENDING;
		serviceCount += 1u) {
		runNextService(harness);
		harness.gpu.readDeviceOutput();
	}
	require(output.readbackPort.phase() == bmsx::GX_GPU_READBACK_PENDING, "the readback command must activate before IMGDEC starts");
	require(output.readbackPort.claimReadback(output.commandBuffer.executedCommandCount), "the backend must claim the executed readback fence");
	output.readbackPort.pixelBytes()[0] = 0x34u;
	output.readbackPort.pixelBytes()[1] = 0x12u;
	output.readbackPort.completeReadback(output.readbackPort.token());

	configureUpload(harness, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
	startImgDecDma(harness);
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 1000u
			&& (harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) & bmsx::IMGDEC_STATUS_OUTPUT_BLOCKED) == 0u;
		serviceCount += 1u) {
		runNextService(harness);
	}
	require((harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) & bmsx::IMGDEC_STATUS_OUTPUT_BLOCKED) != 0u, "GPUREAD must apply physical FIFO backpressure");
	const bmsx::i64 blockedDeadline = harness.scheduler.nextDeadline();
	require(blockedDeadline == std::numeric_limits<bmsx::i64>::max()
		|| blockedDeadline > harness.scheduler.currentNowCycles(), "GPUREAD backpressure must not schedule a current or past retry");
	require(harness.gpu.readGp0() == 0x1234u, "the GPUREAD word must remain intact");
	runUntilComplete(harness);
	runUntilGpuCommandCount(harness, 3u);
}

void testPendingGp1OutputAbortRestore() {
	ImgDecHarness original;
	configureUpload(original, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
	for (bmsx::u32 index = 0u; index < StreamWordCount; index += 1u) {
		original.memory.writeMappedU32LE(
			bmsx::IO_IMGDEC_DATA,
			original.memory.readMappedU32LE(bmsx::CART_ROM_BASE + index * 4u)
		);
	}
	runNextService(original);
	original.gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	const bmsx::GxGpuState gpuState = original.gpu.captureState();
	const bmsx::ImgDecControllerState imgDecState = original.imgDec.captureState();
	const bmsx::DmaControllerState dmaState = original.dma.captureState();
	const bmsx::IrqControllerState irqState = original.irq.captureState();
	require(gpuState.imgDecGp0Requested, "save state must retain the active IMGDEC request line");
	require(gpuState.imgDecGp0AbortPending, "save state must retain the pending GP1 output-abort edge");

	ImgDecHarness restored;
	restored.scheduler.reset();
	restored.scheduler.setNowCycles(original.scheduler.nowCycles());
	restored.dma.restoreState(dmaState, restored.scheduler.nowCycles());
	restored.gpu.restoreState(gpuState);
	restored.imgDec.restoreState(imgDecState);
	restored.irq.restoreState(irqState);
	restored.dma.postLoad();
	require(restored.scheduler.nextDeadline() == restored.scheduler.nowCycles(),
		"restore must republish the pending GP1 output-abort service edge");
	runNextService(restored);
	require(restored.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) == bmsx::IMGDEC_STATUS_OUTPUT_ABORTED,
		"restored IMGDEC must publish the retained GP1 output abort");
	require(!restored.gpu.captureState().imgDecGp0AbortPending,
		"restored output-abort publication must release the GX abort latch");
}

void testActiveBackReferenceRestore() {
	ImgDecHarness original;
	configureUpload(original, 0x00200040u, 80u | (1u << 16u), 0x00400100u);
	startImgDecDma(original);
	bmsx::ImgDecControllerState imgDecState;
	for (bmsx::u32 serviceCount = 0u; serviceCount < 1000u; serviceCount += 1u) {
		runNextService(original);
		imgDecState = original.imgDec.captureState();
		if (imgDecState.historyWords.size() >= PatternWordCount) {
			break;
		}
	}
	require(!imgDecState.historyWords.empty(), "active IMGDEC state must retain back-reference history");
	require(original.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) != bmsx::IMGDEC_STATUS_DONE, "IMGDEC restore vector must capture an active stream");

	const bmsx::GxGpuState gpuState = original.gpu.captureState();
	const bmsx::DmaControllerState dmaState = original.dma.captureState();
	imgDecState = original.imgDec.captureState();
	const bmsx::IrqControllerState irqState = original.irq.captureState();
	ImgDecHarness restored;
	restored.scheduler.reset();
	restored.scheduler.setNowCycles(original.scheduler.nowCycles());
	restored.dma.restoreState(dmaState, restored.scheduler.nowCycles());
	restored.gpu.restoreState(gpuState);
	restored.imgDec.restoreState(imgDecState);
	restored.irq.restoreState(irqState);
	restored.dma.postLoad();
	runUntilComplete(original);
	runUntilComplete(restored);
	runUntilGpuCommandCount(original, 2u);
	runUntilGpuCommandCount(restored, 2u);

	const bmsx::GxGpuCommandBufferState originalCommands = original.gpu.captureState().commandBuffer;
	const bmsx::GxGpuCommandBufferState restoredCommands = restored.gpu.captureState().commandBuffer;
	require(restoredCommands.commandCount == originalCommands.commandCount, "IMGDEC restore must not replay GP0 commands");
	require(restoredCommands.commandKind == originalCommands.commandKind, "IMGDEC restore must preserve GP0 command kinds");
	require(restoredCommands.commandWordStart == originalCommands.commandWordStart, "IMGDEC restore must preserve GP0 command boundaries");
	require(restoredCommands.commandWordCount == originalCommands.commandWordCount, "IMGDEC restore must preserve GP0 command lengths");
	require(restoredCommands.words == originalCommands.words, "IMGDEC restore must preserve GP0 payload words");
}

} // namespace

int main() {
	testCompressedTextureAndClutUpload();
	testGp0GrantWaitsForActiveCpuPacket();
	testGp0AbortGrantsImgDec();
	testGp1AbortsActiveImgDecOutput();
	testGp0GrantWaitsForAdmittedDmaBlock();
	testAdmittedGxDmaFinishesPartialPacketBeforeImgDec();
	testImgDecContinuationEndsWithGxDmaTransfer();
	testForcedDmaInputFifoOverflow();
	testFormatFaultAbortsPartialGp0Packet();
	testImgDecDmaContinuationDuringSupervisorQuiesce();
	testDecodeBatchDeadlinePublication();
	testGp0ReadbackReadinessWake();
	testPendingGp1OutputAbortRestore();
	testActiveBackReferenceRestore();
	return 0;
}
