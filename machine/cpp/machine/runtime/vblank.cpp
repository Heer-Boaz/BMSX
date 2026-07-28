#include "machine/runtime/vblank.h"

#include "spec/bmsx/io.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/runtime/runtime.h"

namespace bmsx {

void VblankState::reset(Runtime& runtime) {
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	m_activeTickCompleted = false;
	runtime.machine.inputController.cancelSampleArm();
	runtime.machine.irqController.postLoad();
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
		runtime.machine.systemController.elapsedMilliseconds(),
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
}

} // namespace bmsx
