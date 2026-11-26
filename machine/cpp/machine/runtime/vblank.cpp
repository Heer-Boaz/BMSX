#include "machine/runtime/vblank.h"

#include "spec/bmsx/io.h"
#include "spec/bmsx/heap_service.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/runtime/runtime.h"

namespace bmsx {

static_assert(HEAP_SERVICE_RESULT_OFFSET + sizeof(u32) <= HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET);
static_assert(HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET + sizeof(u32) <= HEAP_SERVICE_FRAME_OFFSET);

namespace {
u32 deferredPressureAddress(const Runtime& runtime) {
	return runtime.machine.cpu.heapAllocator().managementOffset() + HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET;
}
}

bool VblankState::hasDeferredPressure(const Runtime& runtime) const {
	return runtime.machine.memory.readRamRecordWord(deferredPressureAddress(runtime)) != 0u;
}

bool VblankState::stepDeferredPressure(Runtime& runtime) {
	auto& cpu = runtime.machine.cpu;
	auto& memory = runtime.machine.memory;
	const u32 address = deferredPressureAddress(runtime);
	const u32 pending = memory.readRamRecordWord(address);
	if (pending == 0u) return false;
	cpu.gcHeap().assistPhysicalPressureAtTick();
	memory.writeRamRecordWord(address, pending - 1u);
	return true;
}

void VblankState::reset(Runtime& runtime) {
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	m_activeTickCompleted = false;
	runtime.machine.inputController.cancelSampleArm();
	runtime.machine.irqController.postLoad();
	runtime.machine.memory.writeRamRecordWord(deferredPressureAddress(runtime), 0u);
}

void VblankState::prepareRestore() {
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	m_activeTickCompleted = false;
}

void VblankState::beginTick() {
	m_activeTickCompleted = false;
}

void VblankState::abandonTick() {
	m_activeTickCompleted = false;
}

void VblankState::handleGpuRuntimeEdge(Runtime& runtime, u32 edge) {
	if (edge == GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN) {
		enterVblank(runtime);
		return;
	}
	if (edge == GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END) return;
}

void VblankState::enterVblank(Runtime& runtime) {
	m_vblankSequence += 1u;
	runtime.machine.gxGpu.presentReadyFrameOnVblankEdge();
	runtime.machine.inputController.onVblankEdge(
		static_cast<u32>(runtime.machine.scheduler.nowCycles())
	);
	runtime.machine.irqController.raise(IRQ_VBLANK);
	if (runtime.frameLoop.frameActive) {
		completeTickIfPending(runtime, runtime.frameLoop.frameState, m_vblankSequence);
	}
}

void VblankState::completeTickIfPending(Runtime& runtime, FrameState& frameState, u64 vblankSequence) {
	if (m_lastCompletedVblankSequence == vblankSequence) return;
	m_activeTickCompleted = true;
	runtime.frameScheduler.enqueueTickCompletion(runtime, frameState);
	m_lastCompletedVblankSequence = vblankSequence;
	auto& cpu = runtime.machine.cpu;
	auto& memory = runtime.machine.memory;
	const u32 address = deferredPressureAddress(runtime);
	const u32 pending = memory.readRamRecordWord(address);
	// A service can stop between allocator writes. Keep one legacy
	// pressure opportunity per tick, not a sample of the torn arena.
	if (cpu.heapServiceActive() || pending != 0u) memory.writeRamRecordWord(address, pending + 1u);
	else cpu.gcHeap().assistPhysicalPressureAtTick();
}

} // namespace bmsx
