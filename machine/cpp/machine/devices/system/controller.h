#pragma once

#include "spec/bmsx/io.h"
#include "machine/memory/memory.h"

#include <array>

namespace bmsx {

class CPU;
class AudioController;
class DeviceScheduler;
class DmaController;
class GeometryController;
class GxGpu;
class IrqController;
class ImgDecController;

constexpr u8 SYSTEM_SUPERVISOR_PHASE_USER = 0u;
constexpr u8 SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE = 1u;
constexpr u8 SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR = 2u;
constexpr u8 SYSTEM_SUPERVISOR_PHASE_ACTIVE = 3u;
constexpr u8 SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE = 4u;
constexpr u8 SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE = 5u;

constexpr u8 SYSTEM_SUPERVISOR_TARGET_USER = 0u;
constexpr u8 SYSTEM_SUPERVISOR_TARGET_SUPERVISOR = 1u;
constexpr u8 SYSTEM_SUPERVISOR_TARGET_FAULT = 2u;

struct SystemControllerState {
	bool resetRequested = false;
	u8 supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	u8 supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
	bool supervisorResumable = false;
	bool supervisorExitRequested = false;
	u32 supervisorFaultSequenceWord = 0u;
	u32 supervisorFaultCauseWord = 0u;
	u32 supervisorFaultEpcWord = 0u;
	u32 supervisorFaultBadAddressWord = 0u;
	u32 supervisorFaultLuaReasonWord = 0u;
	u32 supervisorFaultDomainWord = 0u;
};

class SystemController {
public:
	SystemController(
		Memory& memory,
		CPU& cpu,
		DeviceScheduler& scheduler,
		IrqController& irq,
		DmaController& dma,
		GeometryController& geometry,
		GxGpu& gpu,
		ImgDecController& imgDec,
		AudioController& audio,
		i64 cpuHz);
	void reset();
	void setTiming(i64 cpuHz) { m_cpuHz = cpuHz; }
	f64 elapsedMilliseconds() const;
	void requestSupervisorLineEdge();
	void onService();
	bool cpuHeld() const {
		return m_supervisorTransitionTarget != SYSTEM_SUPERVISOR_TARGET_SUPERVISOR
			&& (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE
				|| m_supervisorPhase >= SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE);
	}
	bool supervisorContextActive() const {
		return m_supervisorPhase != SYSTEM_SUPERVISOR_PHASE_USER;
	}
	bool takeResetRequest();
	SystemControllerState captureState() const;
	void restoreState(const SystemControllerState& state);
	void postLoad();

private:
	u32 readStatus(u32 address);
	u32 readTimeMilliseconds(u32 address) const;
	u32 readFrameMillisecondsQ16(u32 address) const;
	u32 readCyclesPerFrame(u32 address) const;
	void writeControl(u32 address, u32 value);
	void activateSupervisorContext();
	void enterSupervisorFault();
	void publishSupervisorFault();
	void beginSupervisorLeave();
	u32 statusWord() const;
	void writeStatusIo();
	void writeSupervisorFaultIo();

	Memory& m_memory;
	CPU& m_cpu;
	DeviceScheduler& m_scheduler;
	IrqController& m_irq;
	DmaController& m_dma;
	GeometryController& m_geometry;
	GxGpu& m_gpu;
	ImgDecController& m_imgDec;
	AudioController& m_audio;
	bool m_resetRequested = false;
	u8 m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	u8 m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
	bool m_supervisorResumable = false;
	bool m_supervisorExitRequested = false;
	std::array<u32, IO_SYS_SUPERVISOR_FAULT_WORD_COUNT> m_supervisorFaultRegisterWords{};
	i64 m_cpuHz;
};

} // namespace bmsx
