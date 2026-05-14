#include "machine/devices/vdp/vdp.h"

#include <utility>

namespace bmsx {

void VDP::captureVisualStateFields(VdpState& state) const {
	state.xf = m_xf.captureState();
	state.vdpRegisterWords = m_vdpRegisters;
	state.buildFrame = captureBuildingFrameState(m_buildFrame);
	state.activeFrame = captureSubmittedFrameState(m_activeFrame);
	state.pendingFrame = captureSubmittedFrameState(m_pendingFrame);
	state.workCarry = m_workCarry;
	state.availableWorkUnits = m_availableWorkUnits;
	state.streamIngress = m_streamIngress.captureState();
	state.readback = m_readback.captureState();
	state.blitterSequence = m_blitterSequence;
	state.skyboxControl = m_sbx.liveControl();
	state.skyboxFaceWords = m_sbx.liveFaceWords();
	state.pmuSelectedBank = m_pmu.selectedBank();
	state.pmuBankWords = m_pmu.captureBankWords();
	state.ditherType = m_vout.liveDitherType();
	state.vdpFaultCode = m_fault.code;
	state.vdpFaultDetail = m_fault.detail;
}

VdpState VDP::captureState() const {
	VdpState state;
	captureVisualStateFields(state);
	return state;
}

void VDP::restoreState(const VdpState& state) {
	m_xf.restoreState(state.xf);
	m_vdpRegisters = state.vdpRegisterWords;
	restoreBuildingFrameState(m_buildFrame, state.buildFrame);
	restoreSubmittedFrameState(m_activeFrame, state.activeFrame);
	restoreSubmittedFrameState(m_pendingFrame, state.pendingFrame);
	reserveBuildFrameStorage(m_buildFrame);
	reserveSubmittedFrameStorage(m_activeFrame);
	reserveSubmittedFrameStorage(m_pendingFrame);
	m_workCarry = state.workCarry;
	m_availableWorkUnits = state.availableWorkUnits;
	m_streamIngress.restoreState(state.streamIngress);
	m_readback.restoreState(state.readback);
	m_blitterSequence = state.blitterSequence;
	for (uint32_t index = 0; index < VDP_REGISTER_COUNT; ++index) {
		m_memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, valueNumber(static_cast<double>(m_vdpRegisters[index])));
	}
	m_sbx.restoreLiveState(state.skyboxControl, state.skyboxFaceWords);
	m_memory.writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(state.ditherType)));
	m_pmu.restoreBankWords(state.pmuSelectedBank, state.pmuBankWords);
	syncPmuRegisterWindow();
	syncSbxRegisterWindow();
	m_fault.restore(0u, state.vdpFaultCode, state.vdpFaultDetail);
	m_fault.setStatusFlag(VDP_STATUS_FAULT, m_fault.code != VDP_FAULT_NONE);
	refreshSubmitBusyStatus();
	m_scheduler.cancelDeviceService(DeviceServiceVdp);
	if (needsImmediateSchedulerService() || hasPendingRenderWork()) {
		scheduleNextService(m_scheduler.currentNowCycles());
	}
	commitLiveVisualState();
}

VdpSaveState VDP::captureSaveState() const {
	VdpSaveState state;
	captureVisualStateFields(state);
	state.vramStaging = m_vramStaging;
	state.surfacePixels = captureSurfacePixels();
	state.displayFrameBufferPixels = m_fbm.captureDisplayReadback();
	return state;
}

void VDP::restoreSaveState(const VdpSaveState& state) {
	restoreState(state);
	m_vramStaging = state.vramStaging;
	for (const VdpSurfacePixelsState& surface : state.surfacePixels) {
		restoreSurfacePixels(surface);
	}
	m_fbm.restoreDisplayReadback(state.displayFrameBufferPixels);
	commitLiveVisualState();
}

std::vector<VdpSurfacePixelsState> VDP::captureSurfacePixels() const {
	std::vector<VdpSurfacePixelsState> surfaces;
	surfaces.reserve(m_vramSlots.size());
	for (const VdpSurfaceUploadSlot& slot : m_vramSlots) {
		VdpSurfacePixelsState state;
		state.surfaceId = slot.surfaceId;
		state.surfaceWidth = slot.surfaceWidth;
		state.surfaceHeight = slot.surfaceHeight;
		state.pixels = slot.cpuReadback;
		surfaces.push_back(std::move(state));
	}
	return surfaces;
}

void VDP::restoreSurfacePixels(const VdpSurfacePixelsState& state) {
	VdpSurfaceUploadSlot* slot = findVramSlotOrFault(state.surfaceId, VDP_FAULT_RD_SURFACE);
	if (slot == nullptr) {
		return;
	}
	setVramSlotLogicalDimensions(*slot, state.surfaceWidth, state.surfaceHeight, state.surfaceWidth | (state.surfaceHeight << 16u));
	slot->cpuReadback = state.pixels;
	m_readback.invalidateSurface(state.surfaceId);
	markVramSlotDirty(*slot, 0, slot->surfaceHeight);
}

} // namespace bmsx
