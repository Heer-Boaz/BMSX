#pragma once

#include "machine/cpu/cpu.h"
#include "machine/bus/io.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/memory/memory.h"
#include "machine/memory/map.h"
#include "machine/scheduler/device.h"
#include "machine/devices/device_status.h"
#include "machine/devices/vdp/device_output.h"
#include "machine/devices/vdp/fbm.h"
#include "machine/devices/vdp/frame.h"
#include "machine/devices/vdp/ingress.h"
#include "machine/devices/vdp/jtu.h"
#include "machine/devices/vdp/lpu.h"
#include "machine/devices/vdp/mfu.h"
#include "machine/devices/vdp/readback.h"
#include "machine/devices/vdp/registers.h"
#include "machine/devices/vdp/save_state.h"
#include "machine/devices/vdp/vout.h"
#include "machine/devices/vdp/vram.h"
#include "machine/devices/vdp/xf.h"
#include "machine/devices/vdp/unit_register_port.h"
#include "machine/model_registry.h"
#include <array>
#include <vector>

namespace bmsx {

class VDP;

class VDP : public Memory::VramWriter {
public:
	VDP(
		Memory& memory,
		DeviceScheduler& scheduler,
		VdpFrameBufferSize frameBufferSize,
		VdpEntropySeeds entropySeeds = {}
	);

	void initializeRegisters();
	void resetIngressState();
	void resetStatus();
	void setScanoutTiming(bool vblankActive, int cyclesIntoFrame, int cyclesPerFrame, int vblankStartCycle);
	void acceptSubmitAttempt();
	void rejectSubmitAttempt();
	void beginDmaSubmit();
	void endDmaSubmit();
	void sealDmaTransfer(uint32_t src, size_t byteLength);
	void writeVdpFifoBytes(const u8* data, size_t length);
	void writeVram(uint32_t addr, const u8* data, size_t srcOffset, size_t length) override;
	void readVram(uint32_t addr, u8* out, size_t length) const override;
	void beginFrame();
	void setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	void onService(int64_t nowCycles);
	void advanceWork(int workUnits);
	void presentReadyFrameOnVblankEdge();
	uint32_t frameBufferWidth() const { return m_fbm.width(); }
	uint32_t frameBufferHeight() const { return m_fbm.height(); }
	const std::vector<u8>& frameBufferRenderReadback() const { return m_vram.frameBufferSurface().cpuReadback; }
	const std::vector<u8>& frameBufferDisplayReadback() const { return m_fbm.displayReadback(); }
	uint32_t readVdpData();

	void initializeVramSurfaces();
	void setDecodedVramSurfaceDimensions(uint32_t baseAddr, uint32_t width, uint32_t height);
	void captureVisualStateFields(VdpState& state) const;
	VdpState captureState() const;
	void restoreState(const VdpState& state);
	VdpSaveState captureSaveState() const;
	void restoreSaveState(const VdpSaveState& state);
	uint32_t trackedUsedVramBytes() const;
	uint32_t trackedTotalVramBytes() const;
	bool lastFrameCommitted() const { return m_lastFrameCommitted; }
	int lastFrameCost() const { return m_lastFrameCost; }
	bool lastFrameHeld() const { return m_lastFrameHeld; }
	bool needsImmediateSchedulerService() const {
		return m_activeFrame.state == VdpSubmittedFrameState::Empty && m_pendingFrame.state != VdpSubmittedFrameState::Empty;
	}
	bool hasPendingRenderWork() const {
		if (m_activeFrame.state == VdpSubmittedFrameState::Empty) {
			return m_pendingFrame.state == VdpSubmittedFrameState::Queued;
		}
		return m_activeFrame.state == VdpSubmittedFrameState::Executing;
	}
	int getPendingRenderWorkUnits() const;

	using SubmittedFrame = VdpSubmittedFrame;
	using BuildingFrame = VdpBuildingFrame;

	const VdpDeviceOutput& readDeviceOutput();

private:
	static Value readVdpStatusThunk(void* context, uint32_t addr);
	static Value readVdpDataThunk(void* context, uint32_t addr);
	static void onFifoWriteThunk(void* context, uint32_t addr, Value value);
	static void onFifoCtrlWriteThunk(void* context, uint32_t addr, Value value);
	static void onCommandWriteThunk(void* context, uint32_t addr, Value value);
	static void onDitherWriteThunk(void* context, uint32_t addr, Value value);
	static void onRegisterWriteThunk(void* context, uint32_t addr, Value value);

	struct RegnPacket {
		u32 firstRegister = 0;
		u32 count = 0;
	};

	void writeVdpRegister(uint32_t index, u32 value);
	void consumeDirectVdpCommand(u32 cmd);
	void rejectBusySubmitAttempt(uint32_t detail);

	Memory& m_memory;
	DeviceStatusLatch m_fault;
	VdpVramUnit m_vram;
	VdpReadbackUnit m_readback;
	VdpXfUnit m_xf;
	VdpLpuUnit m_lpu;
	VdpMfuUnit m_mfu;
	VdpJtuUnit m_jtu;
	VdpRpuUnit m_rpu;
	VdpVoutUnit m_vout;
	int64_t m_cpuHz = 1;
	int64_t m_workUnitsPerSec = 1;
	int64_t m_workCarry = 0;
	int m_availableWorkUnits = 0;
	std::array<u32, VDP_CMD_ARG_COUNT> m_vdpRegisters{};
	VdpStreamIngressUnit m_streamIngress;
	BuildingFrame m_buildFrame;
	SubmittedFrame m_activeFrame;
	SubmittedFrame m_pendingFrame;
	// Scratch buffers used to avoid per-call temporaries (parity with TS runtime)
	bool m_lastFrameCommitted = true;
	int m_lastFrameCost = 0;
	bool m_lastFrameHeld = false;
	VdpFbmUnit m_fbm;
	DeviceScheduler& m_scheduler;
	VdpUnitRegisterPort m_unitRegisterPort;

	void bindVramSurfaces();
	void applyFixedPsxDisplayGeometry();
	void resizeFrameBufferSurface(uint32_t width, uint32_t height);
	void resetQueuedFrameState();
	bool canAcceptSubmittedFrame() const {
		return m_pendingFrame.state == VdpSubmittedFrameState::Empty;
	}
	bool beginSubmittedFrame(VdpDexFrameState state);
	void cancelSubmittedFrame();
	bool sealSubmittedFrame();
	void promotePendingFrame();
	void scheduleNextService(int64_t nowCycles);
	bool hasBlockedSubmitPath() const;
	void refreshSubmitBusyStatus();
	void resetVdpRegisters();
	void onVdpRegisterWrite(uint32_t addr);
	void pushVdpFifoWord(u32 word);
	void consumeSealedVdpStream(uint32_t baseAddr, size_t byteLength);
	void consumeSealedVdpWordStream(const u32* words, u32 wordCount);
	void sealVdpFifoTransfer();
	u32 consumeReplayPacketFromMemory(u32 word, u32 cursor, u32 end);
	u32 consumeUnitRegisterPacketFromMemory(u32 word, u32 cursor, u32 end);
	u32 consumeReplayPacketFromWords(const u32* words, u32 word, u32 cursor, u32 wordCount);
	u32 consumeUnitRegisterPacketFromWords(const u32* words, u32 word, u32 cursor, u32 wordCount);
	void decodeRegnPacket(u32 word, RegnPacket& packet) const;
	bool consumeReplayCommandPacket(u32 word);
	void onVdpFifoWrite();
	void onVdpFifoCtrlWrite();
	void onVdpCommandWrite();
	void finishCommittedFrameOnVblankEdge();

};

} // namespace bmsx
