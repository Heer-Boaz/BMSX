#include "machine/devices/dma/controller.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/gx/gpu.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/memory_map.h"
#include "spec/gx/gp0.h"
#include "spec/gx/gp1.h"
#include "spec/gx/pcrtc.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <limits>
#include <stdexcept>

namespace {
using namespace bmsx;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
struct Harness {
	std::array<u8, 8> system{};
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace execution;
	CPU cpu;
	DeviceScheduler scheduler;
	DmaController dma;
	GxGpu gpu;
	Harness() : memory(MemoryInit{{system.data(), system.size()}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		irq(memory), execution(memory), cpu(memory, irq, execution), scheduler(cpu), dma(memory, cpu, irq, scheduler),
		gpu(memory, cpu, irq, scheduler, dma, PSX_MACHINE_SPEC.gxGpuVramBytes) {
		memory.cartridgeController().connect(memory, irq, dma);
		dma.reset(); memory.cartridgeController().reset(); gpu.reset(); irq.reset();
		dma.setTiming(1, 40, 1, 1, 0, 0);
		const u32 mode = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
		memory.writeMappedU32LE(mode, memory.readMappedU32LE(mode) | GX_GPU_PCRTC_SMODE1_SINT);
		gpu.onService(0);
	}
	void enqueue(u32 fills) {
		for (u32 i = 0; i < fills; ++i) for (u32 word : {0x020000ffu, 0u, 0x00010001u}) gpu.writeGp0(word);
		gpu.writeGp0(0x1f000000u);
	}
	void step() {
		const i64 deadline = scheduler.nextDeadline();
		require(deadline != std::numeric_limits<i64>::max(), "required event is scheduled");
		scheduler.advanceTo(deadline);
		while (scheduler.hasDueTimer()) {
			const auto kind = scheduler.popDueTimer();
			if (kind == DEVICE_SERVICE_GPU) gpu.onService(deadline);
			else if (kind == DEVICE_SERVICE_DMA) dma.onService(deadline);
			else throw std::runtime_error("unexpected device event");
		}
	}
	void advance(i64 target) {
		while (scheduler.nextDeadline() <= target) {
			const i64 deadline = scheduler.nextDeadline();
			scheduler.advanceTo(deadline);
			while (scheduler.hasDueTimer()) {
				require(scheduler.popDueTimer() == DEVICE_SERVICE_GPU, "only GPU/PCRTC timer expected");
				const auto edge = gpu.onService(deadline) & GX_GPU_SERVICE_RUNTIME_EDGE_MASK;
				if (edge == GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN) gpu.presentReadyFrameOnVblankEdge();
			}
		}
		scheduler.advanceTo(target);
	}
};
void testIrqTimeline() {
	Harness h; h.enqueue(4);
	require(h.gpu.captureState().gp0FifoWords.size() == 10u, "FIFO credits remain reserved before command starts");
	require(h.scheduler.nextDeadline() == 116, "one GPU timer reaches the exact future IRQ");
	h.scheduler.advanceTo(115);
	require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) == 0u, "IRQ is not early");
	h.step();
	require(h.scheduler.nowCycles() == 116 && (h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) != 0u, "IRQ starts at 116");
}
void testCpuFifoWait() {
	Harness h; h.enqueue(6);
	require(h.gpu.captureState().gp0FifoWords.size() == 16u, "FIFO is physically full");
	require(!h.memory.mappedWriteReady(IO_GX_GPU_GP0), "prepared work retains FIFO credits");
	require(h.scheduler.nextDeadline() == 29, "blocked CPU request needs first release");
	h.scheduler.advanceTo(28); require(!h.memory.mappedWriteReady(IO_GX_GPU_GP0), "not ready before first release");
	h.step();
	require(h.scheduler.nowCycles() == 29 && h.memory.mappedWriteReady(IO_GX_GPU_GP0), "CPU admission wakes at real release");
	require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) == 0u, "IRQ remains in future");
}
void testGp1AndRestore() {
	{
		Harness h; h.enqueue(4); h.scheduler.advanceTo(10);
		h.gpu.readStatus();
		h.gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 7u);
		h.gpu.writeGp1(GX_GPU_GP1_ACK_INTERRUPT << 24);
		require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) == 0u, "GP1 queries do not execute future IRQ");
		require(h.scheduler.nextDeadline() == 116, "query preserves exact IRQ deadline");
		h.step(); require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) != 0u, "IRQ follows query at 116");
	}
	{
		Harness h; h.enqueue(4); h.scheduler.advanceTo(10);
		h.gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
		require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) == 0u, "FIFO reset discards future IRQ");
		require(h.scheduler.nextDeadline() == std::numeric_limits<i64>::max(), "discarded IRQ has no deadline");
	}
	{
		Harness h; h.enqueue(4); h.scheduler.advanceTo(10);
		const auto gpuState = h.gpu.captureState();
		const auto dmaState = h.dma.captureState();
		Harness restored; restored.scheduler.advanceTo(10);
		restored.dma.restoreState(dmaState, 10); restored.gpu.restoreState(gpuState);
		restored.dma.postLoad(); restored.gpu.dependencyStateChanged();
		require(restored.gpu.captureState().gp0FifoWords == gpuState.gp0FifoWords, "restore preserves canonical raw FIFO");
		require(restored.scheduler.nextDeadline() == 116, "restored queue retains future IRQ boundary");
		restored.step(); require((restored.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) != 0u, "restored IRQ is raised");
	}
}
void testDmaWait() {
	Harness h;
	h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	for (u32 word : {0x020000ffu, 0u, 0x00640001u}) h.gpu.writeGp0(word);
	constexpr u32 source = DYNAMIC_RAM_BASE + 0x1000u, count = GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1u;
	for (u32 i = 0; i < count; ++i) h.memory.writeU32(source + 4u * i, 0xe1000000u);
	h.memory.writeMappedU32LE(IO_DMA0_READ_ADDR, source); h.memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, count);
	h.memory.writeMappedU32LE(IO_DMA0_CONTROL, DMA_ROUTE_TO_GPU); h.memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	h.step();
	require(h.memory.readIoU32(IO_DMA0_STATUS) == DMA_STATUS_BUSY && !h.dma.cpuBusHeld(), "DMA waits for occupied GP0 ingress");
	require(h.scheduler.nextDeadline() == 573, "waiting DMA needs the actual GPU progress boundary");
	for (u32 i = 0; i < 300u && h.memory.readIoU32(IO_DMA0_STATUS) == DMA_STATUS_BUSY; ++i) h.step();
	require(h.memory.readIoU32(IO_DMA0_STATUS) == DMA_STATUS_DONE, "DMA tail wakes when ingress frees");
}
void testReadbackTimeline() {
	Harness h;
	for (u32 i = 0; i < 4u; ++i) for (u32 word : {0x020000ffu, 0u, 0x00010001u}) h.gpu.writeGp0(word);
	for (u32 word : {0xc0000000u, 0u, 0x00010001u}) h.gpu.writeGp0(word);
	require(h.gpu.captureState().commandBuffer.readbackPhase == 0u, "readback begins idle");
	require(h.scheduler.nextDeadline() == 117, "readback has one exact future event");
	h.scheduler.advanceTo(116);
	require(h.gpu.captureState().commandBuffer.readbackPhase == 0u, "readback not pending early");
	h.step();
	require(h.scheduler.nowCycles() == 117 && h.gpu.captureState().commandBuffer.readbackPhase == 1u, "readback becomes pending at its edge");
}
void testDmaQueuedIrq() {
	Harness h;
	h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	constexpr u32 source = DYNAMIC_RAM_BASE + 0x1000u, fills = 84u, count = fills * 3u + 1u;
	for (u32 i = 0; i < fills; ++i) {
		h.memory.writeU32(source + 12u * i, 0x020000ffu);
		h.memory.writeU32(source + 12u * i + 4u, 0u);
		h.memory.writeU32(source + 12u * i + 8u, 0x00010001u);
	}
	h.memory.writeU32(source + 4u * (count - 1u), 0x1f000000u);
	h.memory.writeMappedU32LE(IO_DMA0_READ_ADDR, source); h.memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, count);
	h.memory.writeMappedU32LE(IO_DMA0_CONTROL, DMA_ROUTE_TO_GPU); h.memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	h.step();
	require(h.memory.readIoU32(IO_DMA0_STATUS) == DMA_STATUS_DONE, "DMA burst completed");
	const i64 irqCycle = h.scheduler.nowCycles() + fills * 29;
	u32 events = 0;
	while ((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) == 0u && events < fills) { h.step(); ++events; }
	require(h.scheduler.nowCycles() == irqCycle && (h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) != 0u, "deep DMA IRQ at exact cycle");
	require(events < fills, "bounded prepared horizon batches fills");
}
void testBackendSubmissionHorizon() {
	Harness h;
	h.gpu.setBackendSubmissionCommandLimit(3u);
	h.enqueue(4u);
	require(h.scheduler.nextDeadline() == 87, "backend submission is serviced before a later queued IRQ");
	h.step();
	require(h.scheduler.nowCycles() == 87 && h.gpu.backendCommandDrainPending(), "three completed commands establish the host submission boundary");
	require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) == 0u, "submission does not publish the future IRQ");
	h.gpu.retirePublishedCommands();
	h.gpu.completePublishedCommands();
	h.step();
	require(h.scheduler.nowCycles() == 116 && (h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) != 0u,
		"the queued IRQ keeps its logical start after prefix publication and retirement");
}

void testGp1YGate() {
	Harness h;
	auto initial = h.gpu.captureState();
	initial.drawingAreaBottomRightWord = (1023u << 10) | 1023u;
	h.gpu.restoreState(initial);
	for (u32 word : {0x020000ffu, 0u, 0x00010001u, 0x600000ffu, 512u << 16u, 0x00020004u,
		0x0200ff00u, 0u, 0x00010001u, 0x1f000000u}) h.memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
	h.advance(10);
	h.gpu.writeGp1((GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24) | 1u);
	require(h.gpu.captureState().commandBuffer.commandVramYAddressExtensionWord[0] == 0u, "running fill retains old Y gate");
	h.advance(69); require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) == 0u, "Y-adjusted IRQ not early");
	h.advance(70); require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) != 0u, "Y-adjusted IRQ starts at 70");
	const auto state = h.gpu.captureState();
	require(state.commandBuffer.commandVramYAddressExtensionWord.size() == 3u
		&& state.commandBuffer.commandVramYAddressExtensionWord[1] == 1u
		&& state.commandBuffer.commandVramYAddressExtensionWord[2] == 1u, "queued commands latch updated Y gate");
}
void testPcrtcFieldEdge() {
	Harness h;
	auto initial = h.gpu.captureState(); initial.drawingAreaBottomRightWord = (1023u << 10) | 1023u; h.gpu.restoreState(initial);
	h.gpu.setTiming(1000000, 0);
	const u32 mode = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	h.memory.writeMappedU32LE(mode, h.memory.readMappedU32LE(mode) & ~GX_GPU_PCRTC_SMODE1_SINT);
	h.memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE2_LOW), GX_GPU_PCRTC_SMODE2_INT);
	const u32 syncv = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCV_LOW);
	h.memory.writeMappedU32LE(syncv, (h.memory.readMappedU32LE(syncv) & ~0x3ffu) | 5u);
	h.gpu.onService(0); h.gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x24u);
	for (u32 word : {0x020000ffu, 0u, 0x01ff03ffu, 0x600000ffu, 0u, 0x00050004u, 0x1f000000u}) h.memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
	h.advance(40000);
	const auto state = h.gpu.captureState();
	require(state.commandBuffer.commandSkippedLineParity.size() >= 2u
		&& state.commandBuffer.commandSkippedLineParity[0] != state.commandBuffer.commandSkippedLineParity[1], "PCRTC field edge updates future packet only");
	require((h.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) != 0u, "IRQ follows updated packet timing");
}
}
int main() {
	testBackendSubmissionHorizon();
	testIrqTimeline(); testCpuFifoWait(); testGp1AndRestore(); testDmaWait(); testReadbackTimeline(); testDmaQueuedIrq(); testGp1YGate(); testPcrtcFieldEdge();
}
