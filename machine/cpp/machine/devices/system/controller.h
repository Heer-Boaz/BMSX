#pragma once

#include "spec/bmsx/io.h"
#include "machine/memory/memory.h"

#include <array>

namespace bmsx {

class CPU;
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
	std::array<u8, SYS_PRINT_BUFFER_BYTES> printBuffer{};
	u32 printReadIndex = 0u;
	u32 printByteCount = 0u;
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
	bool takeResetRequest();
	SystemControllerState captureState() const;
	void restoreState(const SystemControllerState& state);
	void postLoad();
	u32 hostOutputAvailableByteCount() const { return m_hostOutputCompleteByteCount; }
	u8 readHostOutputByte();

private:
	u32 readStatus(u32 address);
	u32 readTimeMilliseconds(u32 address) const;
	u32 readFrameMillisecondsQ16(u32 address) const;
	u32 readCyclesPerFrame(u32 address) const;
	u32 readPrintChar(u32 address);
	u32 readPrintByteCount(u32 address) const;
	void writeControl(u32 address, u32 value);
	void writePrintChar(u32 address, u32 value);
	void flushPrintLine(u32 address, u32 value);
	bool reserveHostOutputBytes(u32 byteCount);
	void clearHostOutput();
	void appendHostOutputByte(u8 value);
	void appendRingByte(u8 value);
	void activateSupervisorContext();
	void enterSupervisorFault();
	void beginSupervisorLeave();
	u32 statusWord() const;
	void writeStatusIo();

	Memory& m_memory;
	CPU& m_cpu;
	DeviceScheduler& m_scheduler;
	IrqController& m_irq;
	DmaController& m_dma;
	GeometryController& m_geometry;
	GxGpu& m_gpu;
	ImgDecController& m_imgDec;
	bool m_resetRequested = false;
	u8 m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	u8 m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
	bool m_supervisorResumable = false;
	bool m_supervisorExitRequested = false;
	std::array<u8, SYS_PRINT_BUFFER_BYTES> m_printBuffer{};
	u32 m_printReadIndex = 0u;
	u32 m_printByteCount = 0u;
	std::array<u8, SYS_PRINT_BUFFER_BYTES> m_hostOutputBuffer{};
	u32 m_hostOutputReadIndex = 0u;
	u32 m_hostOutputByteCount = 0u;
	u32 m_hostOutputCompleteByteCount = 0u;
	bool m_hostOutputLineOverflowed = false;
	std::array<u8, 4> m_printEncodingBytes{};
	i64 m_cpuHz;
};

} // namespace bmsx
