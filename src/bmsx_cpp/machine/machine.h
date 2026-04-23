#pragma once

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/devices/input/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/memory.h"
#include "machine/runtime/resource_usage_detector.h"
#include "machine/scheduler/device.h"

namespace bmsx {

class Api;
class SoundMaster;

struct MachineTiming {
	i64 cpuHz = 0;
	i64 dmaBytesPerSecIso = 0;
	i64 dmaBytesPerSecBulk = 0;
	i64 imgDecBytesPerSec = 0;
	int geoWorkUnitsPerSec = 0;
	int vdpWorkUnitsPerSec = 0;
};

struct MachineState {
	MemoryState memory;
	InputControllerState input;
	VdpState vdp;
};

class Machine {
public:
	Machine(Api& api, SoundMaster& soundMaster, VdpFrameBufferSize frameBufferSize);

	Memory& memory() { return m_memory; }
	const Memory& memory() const { return m_memory; }
	StringHandleTable& stringHandles() { return m_stringHandles; }
	const StringHandleTable& stringHandles() const { return m_stringHandles; }
	CPU& cpu() { return m_cpu; }
	const CPU& cpu() const { return m_cpu; }
	DeviceScheduler& scheduler() { return m_deviceScheduler; }
	const DeviceScheduler& scheduler() const { return m_deviceScheduler; }
	VDP& vdp() { return m_vdp; }
	const VDP& vdp() const { return m_vdp; }
	IrqController& irqController() { return m_irqController; }
	const IrqController& irqController() const { return m_irqController; }
	DmaController& dmaController() { return m_dmaController; }
	const DmaController& dmaController() const { return m_dmaController; }
	GeometryController& geometryController() { return m_geometryController; }
	const GeometryController& geometryController() const { return m_geometryController; }
	ImgDecController& imgDecController() { return m_imgDecController; }
	const ImgDecController& imgDecController() const { return m_imgDecController; }
	InputController& inputController() { return m_inputController; }
	const InputController& inputController() const { return m_inputController; }
	AudioController& audioController() { return m_audioController; }
	const AudioController& audioController() const { return m_audioController; }
	ResourceUsageDetector& resourceUsageDetector() { return m_resourceUsageDetector; }
	const ResourceUsageDetector& resourceUsageDetector() const { return m_resourceUsageDetector; }

	void initializeSystemIo();
	void resetDevices();
	void refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles);
	void advanceDevices(int cycles);
	void runDeviceService(uint8_t deviceKind);
	void resetRenderBuffers();
	MachineState captureState() const;
	void restoreState(const MachineState& state);

private:
	Memory m_memory;
	StringHandleTable m_stringHandles;
	CPU m_cpu;
	DeviceScheduler m_deviceScheduler;
	VDP m_vdp;
	IrqController m_irqController;
	DmaController m_dmaController;
	GeometryController m_geometryController;
	ImgDecController m_imgDecController;
	InputController m_inputController;
	AudioController m_audioController;
	ResourceUsageDetector m_resourceUsageDetector;
};

} // namespace bmsx
