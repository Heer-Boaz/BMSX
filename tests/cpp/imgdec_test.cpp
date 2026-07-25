#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/geometry/contracts.h"
#include "machine/devices/gx/gp0.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/devices/imgdec/contracts.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/system/controller.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"
#include "machine/scheduler/device.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <vector>

namespace {

constexpr bmsx::u32 ImgDecInputDmaControl = 0x00003d41u;
constexpr bmsx::u32 ImgDecOutputDmaControl = 0x00003c58u;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

struct ImgDecHarness {
	std::array<bmsx::u8, 4096u> cartRom{};
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
		: memory(bmsx::MemoryInit{ {}, bmsx::test::cartridgeSlots(cartRom) })
		, irq(memory)
		, cpu(memory, irq)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler)
		, geometry(memory, irq, scheduler)
		, gpu(memory, cpu, irq, scheduler, dma)
		, imgDec(memory, cpu, irq, scheduler, dma, bmsx::PSX_MACHINE_SPEC.imgDecCyclesPerOutputWord)
		, system(memory, cpu, scheduler, irq, dma, geometry, gpu, imgDec) {
		memory.cartridgeController().connect(memory, irq, dma);
		dma.reset();
		memory.cartridgeController().reset();
		geometry.reset();
		gpu.reset();
		imgDec.reset();
		system.reset();
		irq.reset();
		dma.setTiming(
			bmsx::PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
			bmsx::PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
			bmsx::PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
			bmsx::PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
			bmsx::PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
			scheduler.currentNowCycles()
		);
		const bmsx::u32 smode1Address = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW);
		memory.writeMappedU32LE(smode1Address, memory.readMappedU32LE(smode1Address) | bmsx::GX_GPU_PCRTC_SMODE1_SINT);
		gpu.onService(0);
	}

	void writeCartWord(bmsx::u32 index, bmsx::u32 word) {
		const size_t offset = static_cast<size_t>(index) * 4u;
		cartRom[offset] = static_cast<bmsx::u8>(word);
		cartRom[offset + 1u] = static_cast<bmsx::u8>(word >> 8u);
		cartRom[offset + 2u] = static_cast<bmsx::u8>(word >> 16u);
		cartRom[offset + 3u] = static_cast<bmsx::u8>(word >> 24u);
	}
};

void armUpload(
	ImgDecHarness& harness,
	bmsx::u32 inputWordCount,
	bmsx::u32 textureWordCount,
	bmsx::u32 clutWordCount,
	bmsx::u32 textureDestination,
	bmsx::u32 textureSize,
	bmsx::u32 clutDestination
) {
	const bmsx::u32 outputWordCount = textureWordCount + 3u
		+ (clutWordCount == 0u ? 0u : clutWordCount + 3u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_INPUT_WORD_COUNT, inputWordCount);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_DESTINATION, textureDestination);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_SIZE, textureSize);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CLUT_DESTINATION, clutDestination);
	harness.gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA1_READ_ADDR, bmsx::IO_IMGDEC_DATA);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA1_WRITE_ADDR, bmsx::IO_GX_GPU_GP0);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA1_TRANSFER_COUNT, outputWordCount);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA1_CONTROL, ImgDecOutputDmaControl);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA1_TRIGGER, bmsx::DMA_TRIGGER_START);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, bmsx::CART_ROM_BASE);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, bmsx::IO_IMGDEC_DATA);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, inputWordCount);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, ImgDecInputDmaControl);
	harness.memory.writeMappedU32LE(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);
}

void runNextService(ImgDecHarness& harness) {
	const bmsx::i64 deadline = harness.scheduler.nextDeadline();
	require(deadline != std::numeric_limits<bmsx::i64>::max(), "IMGDEC pipeline must retain a service deadline");
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
		case bmsx::DEVICE_SERVICE_GEO:
			harness.geometry.onService(deadline);
			break;
		case bmsx::DEVICE_SERVICE_SYSTEM:
			harness.system.onService();
			break;
		default:
			throw std::runtime_error("Unexpected device service in IMGDEC test.");
		}
	}
}

void runUntilImgDecStatus(ImgDecHarness& harness, bmsx::u32 expectedStatus) {
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 2000u && harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) != expectedStatus;
		serviceCount += 1u) {
		runNextService(harness);
	}
	require(harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) == expectedStatus, "IMGDEC did not reach the expected terminal status");
}

void runUntilGpuCommandCount(ImgDecHarness& harness, bmsx::u32 expectedCommandCount) {
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 2000u && harness.gpu.readDeviceOutput().commandBuffer.commandCount != expectedCommandCount;
		serviceCount += 1u) {
		runNextService(harness);
	}
	require(harness.gpu.readDeviceOutput().commandBuffer.commandCount == expectedCommandCount, "GX did not consume the expected IMGDEC packets");
}

void testCompressedTextureAndClutUpload() {
	constexpr bmsx::u32 textureWordCount = 80u;
	constexpr bmsx::u32 clutWordCount = 8u;
	constexpr bmsx::u32 payloadWordCount = textureWordCount + clutWordCount;
	constexpr bmsx::u32 patternWordCount = 16u;
	constexpr bmsx::u32 backReferenceWordCount = payloadWordCount - patternWordCount;
	constexpr bmsx::u32 streamWordCount = 3u + 1u + patternWordCount + 1u;
	std::array<bmsx::u32, payloadWordCount> payload{};
	ImgDecHarness harness;
	harness.writeCartWord(0u, bmsx::IMGDEC_STREAM_MAGIC);
	harness.writeCartWord(1u, textureWordCount);
	harness.writeCartWord(2u, clutWordCount);
	harness.writeCartWord(3u, (bmsx::IMGDEC_TOKEN_KIND_LITERAL << bmsx::IMGDEC_TOKEN_KIND_SHIFT) | (patternWordCount - 1u));
	for (bmsx::u32 index = 0u; index < payloadWordCount; index += 1u) {
		payload[index] = ((index & (patternWordCount - 1u)) + 1u) * 0x10204081u;
		if (index < patternWordCount) {
			harness.writeCartWord(4u + index, payload[index]);
		}
	}
	harness.writeCartWord(
		4u + patternWordCount,
		(bmsx::IMGDEC_TOKEN_KIND_BACK_REFERENCE << bmsx::IMGDEC_TOKEN_KIND_SHIFT)
			| ((backReferenceWordCount - bmsx::IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH)
				<< bmsx::IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT)
			| (patternWordCount - 1u)
	);
	constexpr bmsx::u32 textureDestination = 0x00200040u;
	constexpr bmsx::u32 textureSize = 160u | (1u << 16u);
	constexpr bmsx::u32 clutDestination = 0x00400100u;
	armUpload(harness, streamWordCount, textureWordCount, clutWordCount, textureDestination, textureSize, clutDestination);
	require(harness.scheduler.nextDeadline() == std::numeric_limits<bmsx::i64>::max(), "both DMA channels arm while IMGDEC DREQ is low");
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CONTROL, bmsx::IMGDEC_CONTROL_START);
	bool cpuReadInterleaved = false;
	for (bmsx::u32 serviceCount = 0u; serviceCount < 2000u && !cpuReadInterleaved; serviceCount += 1u) {
		runNextService(harness);
		const bmsx::DmaControllerState dmaState = harness.dma.captureState();
		if (dmaState.activeChannel == 1u && dmaState.scheduledReadAddressWord == bmsx::IO_IMGDEC_DATA) {
			const bmsx::ImgDecControllerState before = harness.imgDec.captureState();
			harness.memory.readMappedU32LE(bmsx::IO_IMGDEC_DATA);
			const bmsx::ImgDecControllerState after = harness.imgDec.captureState();
			require(after.outputWordsRead == before.outputWordsRead, "CPU DATA read cannot advance DMA-owned output");
			require(after.outputWords == before.outputWords, "CPU DATA read cannot pop the DMA-owned output FIFO");
			cpuReadInterleaved = true;
		}
	}
	require(cpuReadInterleaved, "test must interleave a CPU DATA read with an admitted output block");
	runUntilImgDecStatus(harness, bmsx::IMGDEC_STATUS_DONE);
	runUntilGpuCommandCount(harness, 2u);

	require(harness.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "input DMA completes");
	require(harness.memory.readIoU32(bmsx::IO_DMA1_STATUS) == bmsx::DMA_STATUS_DONE, "output DMA completes");
	require((harness.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & (bmsx::IRQ_DMA0_DONE | bmsx::IRQ_DMA1_DONE | bmsx::IRQ_IMGDEC))
		== (bmsx::IRQ_DMA0_DONE | bmsx::IRQ_DMA1_DONE | bmsx::IRQ_IMGDEC), "pipeline raises both DMA IRQs and IMGDEC IRQ");
	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "texture uses the normal GP0 upload command");
	require(commands.commandKind[1] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "CLUT uses the normal GP0 upload command");
	require(commands.words[commands.commandWordStart[0] + 1u] == textureDestination, "texture destination reaches GP0 unchanged");
	require(commands.words[commands.commandWordStart[0] + 2u] == textureSize, "texture dimensions reach GP0 unchanged");
	for (bmsx::u32 index = 0u; index < textureWordCount; index += 1u) {
		require(commands.words[commands.commandWordStart[0] + 3u + index] == payload[index], "texture payload reaches GP0 unchanged");
	}
	require(commands.words[commands.commandWordStart[1] + 1u] == clutDestination, "CLUT destination reaches GP0 unchanged");
	require(commands.words[commands.commandWordStart[1] + 2u] == (16u | (1u << 16u)), "CLUT dimensions use one sixteen-word row");
	for (bmsx::u32 index = 0u; index < clutWordCount; index += 1u) {
		require(commands.words[commands.commandWordStart[1] + 3u + index] == payload[textureWordCount + index], "CLUT payload reaches GP0 unchanged");
	}
}

void testSupervisorPausesImgDecBetweenPackets() {
	constexpr bmsx::u32 textureWordCount = 13u;
	constexpr bmsx::u32 clutWordCount = 8u;
	constexpr bmsx::u32 payloadWordCount = textureWordCount + clutWordCount;
	constexpr bmsx::u32 streamWordCount = 4u;
	ImgDecHarness harness;
	harness.writeCartWord(0u, bmsx::IMGDEC_STREAM_MAGIC);
	harness.writeCartWord(1u, textureWordCount);
	harness.writeCartWord(2u, clutWordCount);
	harness.writeCartWord(3u, (bmsx::IMGDEC_TOKEN_KIND_ZERO << bmsx::IMGDEC_TOKEN_KIND_SHIFT) | (payloadWordCount - 1u));
	armUpload(harness, streamWordCount, textureWordCount, clutWordCount, 0u, 26u | (1u << 16u), 0x00000100u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CONTROL, bmsx::IMGDEC_CONTROL_START);

	bool betweenPackets = false;
	for (bmsx::u32 serviceCount = 0u; serviceCount < 2000u && !betweenPackets; serviceCount += 1u) {
		runNextService(harness);
		const bmsx::DmaControllerState dmaState = harness.dma.captureState();
		const bmsx::GxGpuState gpuState = harness.gpu.captureState();
		betweenPackets = harness.gpu.readDeviceOutput().commandBuffer.commandCount == 1u
			&& dmaState.activeChannel == bmsx::IO_DMA_CHANNEL_COUNT
			&& gpuState.gp0IngressPhase == bmsx::GX_GPU_GP0_INGRESS_COMMAND
			&& (harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) & bmsx::IMGDEC_STATUS_BUSY) != 0u
			&& (harness.memory.readIoU32(bmsx::IO_DMA1_STATUS) & bmsx::DMA_STATUS_BUSY) != 0u;
	}
	require(betweenPackets, "test must reach the DMA gap between texture and CLUT packets");

	harness.system.requestSupervisorLineEdge();
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 2000u
			&& harness.system.captureState().supervisorPhase != bmsx::SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE;
		serviceCount += 1u) {
		runNextService(harness);
	}
	require(harness.system.captureState().supervisorPhase == bmsx::SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE, "supervisor entry reaches the GPU fence after pausing IMGDEC");
	require((harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) & bmsx::IMGDEC_STATUS_BUSY) != 0u, "the paused IMGDEC stream remains active");
	require(harness.memory.readIoU32(bmsx::IO_DMA1_STATUS) == bmsx::DMA_STATUS_BUSY, "the paused output DMA remains armed");
	require(harness.gpu.readDeviceOutput().commandBuffer.commandCount == 1u, "GX receives only the completed packet before its fence closes");
	const bmsx::ImgDecControllerState pausedImgDec = harness.imgDec.captureState();
	require(pausedImgDec.supervisorQuiesceRequested, "IMGDEC retains its pause latch");
	require(pausedImgDec.scheduledDecodeWords == 0u, "IMGDEC pauses at a completed decode batch boundary");

	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 2000u
			&& harness.gpu.readDeviceOutput().commandBuffer.executedCommandCount
				!= harness.gpu.readDeviceOutput().commandBuffer.commandCount;
		serviceCount += 1u) {
		runNextService(harness);
	}
	harness.gpu.presentReadyFrameOnVblankEdge();
	harness.gpu.retirePresentedCommands();
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 2000u
			&& harness.system.captureState().supervisorPhase != bmsx::SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
		serviceCount += 1u) {
		runNextService(harness);
	}
	require(harness.system.captureState().supervisorPhase == bmsx::SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR, "the completed GPU fence raises the supervisor vector");
	const bmsx::ImgDecControllerState vectorImgDec = harness.imgDec.captureState();
	require(vectorImgDec.inputWordsReceived == pausedImgDec.inputWordsReceived, "IMGDEC input position stays frozen through supervisor vectoring");
	require(vectorImgDec.decodedWordCount == pausedImgDec.decodedWordCount, "IMGDEC decode position stays frozen through supervisor vectoring");
	require(vectorImgDec.outputWordsRead == pausedImgDec.outputWordsRead, "IMGDEC output position stays frozen through supervisor vectoring");
	require(vectorImgDec.inputWords == pausedImgDec.inputWords, "IMGDEC input FIFO stays frozen through supervisor vectoring");
	require(vectorImgDec.outputWords == pausedImgDec.outputWords, "IMGDEC output FIFO stays frozen through supervisor vectoring");
	require(vectorImgDec.historyWords == pausedImgDec.historyWords, "IMGDEC history stays frozen through supervisor vectoring");
}

void testPausedImgDecResumesExactStream() {
	constexpr bmsx::u32 textureWordCount = 24u;
	constexpr std::array<bmsx::u32, 4> streamWords{
		bmsx::IMGDEC_STREAM_MAGIC,
		textureWordCount,
		0u,
		(bmsx::IMGDEC_TOKEN_KIND_ZERO << bmsx::IMGDEC_TOKEN_KIND_SHIFT) | (textureWordCount - 1u),
	};
	ImgDecHarness harness;
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_INPUT_WORD_COUNT, static_cast<bmsx::u32>(streamWords.size()));
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_DESTINATION, 0x00200040u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_TEXTURE_SIZE, 48u | (1u << 16u));
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CLUT_DESTINATION, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CONTROL, bmsx::IMGDEC_CONTROL_START);
	for (size_t index = 0u; index < streamWords.size(); index += 1u) {
		const bmsx::MappedBusSignals signals = bmsx::MAPPED_BUS_MASTER_DMA
			| (index + 1u == streamWords.size() ? bmsx::MAPPED_BUS_DMA_BLOCK_END : 0u);
		harness.memory.writeMappedDmaU32LE(bmsx::IO_IMGDEC_DATA, streamWords[index], signals);
	}
	require(harness.imgDec.captureState().scheduledDecodeWords != 0u, "the stream has an admitted decode batch before pause");

	harness.imgDec.beginSupervisorQuiesce();
	for (bmsx::u32 serviceCount = 0u; serviceCount < 10u && !harness.imgDec.supervisorQuiescent(); serviceCount += 1u) {
		runNextService(harness);
	}
	const bmsx::ImgDecControllerState paused = harness.imgDec.captureState();
	require(harness.imgDec.supervisorQuiescent(), "IMGDEC reaches a finite pause boundary");
	require((paused.statusWord & bmsx::IMGDEC_STATUS_BUSY) != 0u, "pause preserves the active stream");
	require(paused.scheduledDecodeWords == 0u, "pause completes only the admitted batch");
	require(paused.outputWords == std::vector<bmsx::u32>{0xa0000000u, 0x00200040u, 48u | (1u << 16u)}, "pause preserves the first native GP0 header");

	harness.imgDec.leaveSupervisorContext();
	std::vector<bmsx::u32> outputWords;
	for (bmsx::u32 serviceCount = 0u;
		serviceCount < 100u && harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) != bmsx::IMGDEC_STATUS_DONE;
		serviceCount += 1u) {
		if (!harness.imgDec.captureState().outputWords.empty()) {
			outputWords.push_back(harness.memory.readMappedU32LE(bmsx::IO_IMGDEC_DATA));
		} else {
			runNextService(harness);
		}
	}
	require(harness.memory.readIoU32(bmsx::IO_IMGDEC_STATUS) == bmsx::IMGDEC_STATUS_DONE, "resumed IMGDEC stream completes");
	require(outputWords.size() == textureWordCount + 3u, "resumed IMGDEC stream keeps its complete word count");
	require(outputWords[0] == 0xa0000000u && outputWords[1] == 0x00200040u && outputWords[2] == (48u | (1u << 16u)), "resumed IMGDEC stream keeps its GP0 header");
	for (size_t index = 3u; index < outputWords.size(); index += 1u) {
		require(outputWords[index] == 0u, "resumed IMGDEC stream keeps its zero-run payload");
	}
}

void testSupervisorControlGatesRejectDmaWrites() {
	ImgDecHarness harness;
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_INPUT_WORD_COUNT, 7u);
	const bmsx::u32 gp1Word = harness.gpu.captureState().gp1Word;
	const bmsx::GeometryControllerState geometryState = harness.geometry.captureState();
	const bmsx::MappedBusSignals busSignals = bmsx::MAPPED_BUS_MASTER_DMA | bmsx::MAPPED_BUS_DMA_BLOCK_END;
	harness.gpu.beginSupervisorControlQuiesce();
	harness.imgDec.beginSupervisorQuiesce();
	harness.geometry.beginSupervisorQuiesce();

	harness.memory.writeMappedDmaU32LE(
		bmsx::IO_GX_GPU_GP1,
		(bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
		busSignals
	);
	harness.memory.writeMappedDmaU32LE(bmsx::IO_IMGDEC_INPUT_WORD_COUNT, 99u, busSignals);
	harness.memory.writeMappedDmaU32LE(bmsx::IO_IMGDEC_CONTROL, bmsx::IMGDEC_CONTROL_START, busSignals);
	harness.memory.writeMappedDmaU32LE(bmsx::IO_GEO_CMD, bmsx::IO_CMD_GEO_XFORM2_BATCH, busSignals);

	require(harness.gpu.captureState().gp1Word == gp1Word, "closed GP1 does not latch a DMA command");
	require(harness.memory.readIoU32(bmsx::IO_IMGDEC_INPUT_WORD_COUNT) == 7u, "closed IMGDEC config keeps its raw word");
	require(harness.memory.readIoU32(bmsx::IO_IMGDEC_CONTROL) == 0u, "closed IMGDEC START does not latch");
	const bmsx::GeometryControllerState closedGeometryState = harness.geometry.captureState();
	require(closedGeometryState.phase == geometryState.phase, "closed geometry doorbell does not start a job");
	require(closedGeometryState.registerWords == geometryState.registerWords, "closed geometry doorbell does not enter the registerfile");
}

void testForcedDmaPresentsWordsToFullInputFifo() {
	ImgDecHarness harness;
	for (bmsx::u32 index = 0u; index <= bmsx::IMGDEC_INPUT_FIFO_WORD_CAPACITY; index += 1u) {
		const bmsx::MappedBusSignals busSignals = bmsx::MAPPED_BUS_MASTER_DMA
			| (index == bmsx::IMGDEC_INPUT_FIFO_WORD_CAPACITY ? bmsx::MAPPED_BUS_DMA_BLOCK_END : 0u);
		harness.memory.writeMappedDmaU32LE(bmsx::IO_IMGDEC_DATA, index + 1u, busSignals);
	}

	const bmsx::ImgDecControllerState state = harness.imgDec.captureState();
	require(state.inputWordsReceived == bmsx::IMGDEC_INPUT_FIFO_WORD_CAPACITY + 1u, "forced DMA advances the physical input counter");
	require(state.inputWords.size() == bmsx::IMGDEC_INPUT_FIFO_WORD_CAPACITY, "the full FIFO drops the extra presented word");
	require(state.inputWords.back() == bmsx::IMGDEC_INPUT_FIFO_WORD_CAPACITY, "the full FIFO retains its last accepted word");
}

void testFormatFaultLeavesAdmittedGp0Block() {
	constexpr bmsx::u32 textureWordCount = 24u;
	ImgDecHarness harness;
	harness.writeCartWord(0u, bmsx::IMGDEC_STREAM_MAGIC);
	harness.writeCartWord(1u, textureWordCount);
	harness.writeCartWord(2u, 0u);
	harness.writeCartWord(3u, (bmsx::IMGDEC_TOKEN_KIND_REPEAT << bmsx::IMGDEC_TOKEN_KIND_SHIFT) | 19u);
	harness.writeCartWord(4u, 0x12345678u);
	harness.writeCartWord(5u, (bmsx::IMGDEC_TOKEN_KIND_BACK_REFERENCE << bmsx::IMGDEC_TOKEN_KIND_SHIFT) | 20u);
	armUpload(harness, 6u, textureWordCount, 0u, 0u, 48u | (1u << 16u), 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CONTROL, bmsx::IMGDEC_CONTROL_START);
	runUntilImgDecStatus(harness, bmsx::IMGDEC_STATUS_FORMAT_FAULT);

	require(harness.memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "faulting stream input DMA completes");
	require(harness.memory.readIoU32(bmsx::IO_DMA1_STATUS) == bmsx::DMA_STATUS_BUSY, "faulting stream leaves output DMA armed");
	require(harness.memory.readIoU32(bmsx::IO_DMA1_TRANSFER_COUNT) == 11u, "the admitted GP0 block remains committed");
	require(!harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "the armed output channel retains GP0 ownership");
	const bmsx::GxGpuState gpuState = harness.gpu.captureState();
	require(gpuState.gp0IngressPhase == bmsx::GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD, "GX retains the partial native packet");
	require(gpuState.gp0IngressWordsRemaining == 11u, "GX retains the exact partial payload position");
	require(harness.gpu.readDeviceOutput().commandBuffer.commandCount == 0u, "GX does not publish an incomplete command");
	require((harness.memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_IMGDEC) != 0u, "format fault raises IMGDEC IRQ");
}

void testActivePipelineRestore() {
	constexpr bmsx::u32 textureWordCount = 128u;
	constexpr bmsx::u32 streamWordCount = 3u + 1u + textureWordCount;
	ImgDecHarness harness;
	harness.writeCartWord(0u, bmsx::IMGDEC_STREAM_MAGIC);
	harness.writeCartWord(1u, textureWordCount);
	harness.writeCartWord(2u, 0u);
	harness.writeCartWord(3u, (bmsx::IMGDEC_TOKEN_KIND_LITERAL << bmsx::IMGDEC_TOKEN_KIND_SHIFT) | (textureWordCount - 1u));
	for (bmsx::u32 index = 0u; index < textureWordCount; index += 1u) {
		harness.writeCartWord(4u + index, (index + 7u) * 0x045d9f3bu);
	}
	armUpload(harness, streamWordCount, textureWordCount, 0u, 0x00010020u, 256u | (1u << 16u), 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_IMGDEC_CONTROL, bmsx::IMGDEC_CONTROL_START);

	bmsx::DmaControllerState dmaState;
	bmsx::GxGpuState gpuState;
	bmsx::ImgDecControllerState imgDecState;
	bmsx::IrqControllerState irqState;
	bool snapshotCaptured = false;
	for (bmsx::u32 serviceCount = 0u; serviceCount < 2000u && !snapshotCaptured; serviceCount += 1u) {
		runNextService(harness);
		const bmsx::ImgDecControllerState progress = harness.imgDec.captureState();
		if (progress.outputWordsRead != 0u && progress.outputWordsRead < textureWordCount + 3u) {
			gpuState = harness.gpu.captureState();
			dmaState = harness.dma.captureState();
			irqState = harness.irq.captureState();
			imgDecState = harness.imgDec.captureState();
			snapshotCaptured = true;
		}
	}
	require(snapshotCaptured, "test must capture a live bidirectional IMGDEC pipeline");
	require(dmaState.channels[0].statusWord == bmsx::DMA_STATUS_BUSY, "snapshot retains input DMA");
	require(dmaState.channels[1].statusWord == bmsx::DMA_STATUS_BUSY, "snapshot retains output DMA");
	runUntilImgDecStatus(harness, bmsx::IMGDEC_STATUS_DONE);
	runUntilGpuCommandCount(harness, 1u);
	const bmsx::GxGpuCommandBuffer& firstCommands = harness.gpu.readDeviceOutput().commandBuffer;
	const bmsx::u32 firstStart = firstCommands.commandWordStart[0];
	const std::vector<bmsx::u32> firstWords(
		firstCommands.words.begin() + firstStart,
		firstCommands.words.begin() + firstStart + firstCommands.commandWordCount[0]
	);

	harness.dma.restoreState(dmaState, harness.scheduler.currentNowCycles());
	harness.irq.restoreState(irqState);
	harness.gpu.restoreState(gpuState);
	harness.imgDec.restoreState(imgDecState);
	harness.dma.postLoad();
	runUntilImgDecStatus(harness, bmsx::IMGDEC_STATUS_DONE);
	runUntilGpuCommandCount(harness, 1u);
	const bmsx::GxGpuCommandBuffer& restoredCommands = harness.gpu.readDeviceOutput().commandBuffer;
	const bmsx::u32 restoredStart = restoredCommands.commandWordStart[0];
	const std::vector<bmsx::u32> restoredWords(
		restoredCommands.words.begin() + restoredStart,
		restoredCommands.words.begin() + restoredStart + restoredCommands.commandWordCount[0]
	);
	require(restoredWords == firstWords, "restored pipeline emits the identical native GP0 packet");
}

} // namespace

int main() {
	testCompressedTextureAndClutUpload();
	testSupervisorPausesImgDecBetweenPackets();
	testPausedImgDecResumesExactStream();
	testSupervisorControlGatesRejectDmaWrites();
	testForcedDmaPresentsWordsToFullInputFifo();
	testFormatFaultLeavesAdmittedGp0Block();
	testActivePipelineRestore();
	return 0;
}
