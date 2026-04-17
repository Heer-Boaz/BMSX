#include "machine/machine.h"

#include "audio/soundmaster.h"
#include "core/engine.h"
#include "input/manager.h"
#include "machine/firmware/api.h"
#include "render/shared/queues.h"
#include "rompack/format.h"

#include <stdexcept>

namespace bmsx {
namespace {
inline std::runtime_error runtimeFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("Runtime fault: " + message);
}
}

Machine::Machine(Api& api, SoundMaster& soundMaster)
	: m_memory()
	, m_stringHandles(m_memory)
	, m_cpu(m_memory, &m_stringHandles)
	, m_deviceScheduler(m_cpu)
	, m_vdp(m_memory, m_cpu, api, m_deviceScheduler)
	, m_irqController(m_memory)
	, m_dmaController(m_memory, m_irqController, m_vdp, m_deviceScheduler)
	, m_geometryController(m_memory, m_irqController, m_deviceScheduler)
	, m_imgDecController(m_memory, m_dmaController, m_irqController, m_deviceScheduler)
	, m_inputController(m_memory, Input::instance(), m_cpu.stringPool())
	, m_audioController(m_memory, soundMaster, m_irqController)
	, m_resourceUsageDetector(m_memory, m_stringHandles, m_vdp) {
	m_vdp.attachImgDecController(m_imgDecController);
}

void Machine::initializeSystemIo() {
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_HOST_FAULT_STAGE, valueNumber(static_cast<double>(HOST_FAULT_STAGE_NONE)));
}

void Machine::resetDevices() {
	m_irqController.reset();
	m_dmaController.reset();
	m_geometryController.reset();
	m_imgDecController.reset();
	m_inputController.reset();
	m_audioController.reset();
	m_vdp.initializeRegisters();
}

void Machine::refreshDeviceTimings(const MachineTiming& timing, i64 nowCycles) {
	m_dmaController.setTiming(timing.cpuHz, timing.dmaBytesPerSecIso, timing.dmaBytesPerSecBulk, nowCycles);
	m_imgDecController.setTiming(timing.cpuHz, timing.imgDecBytesPerSec, nowCycles);
	m_geometryController.setTiming(timing.cpuHz, timing.geoWorkUnitsPerSec, nowCycles);
	m_vdp.setTiming(timing.cpuHz, timing.vdpWorkUnitsPerSec, nowCycles);
}

void Machine::advanceDevices(int cycles) {
	const i64 nextNow = m_deviceScheduler.nowCycles() + cycles;
	m_dmaController.accrueCycles(cycles, nextNow);
	m_imgDecController.accrueCycles(cycles, nextNow);
	m_geometryController.accrueCycles(cycles, nextNow);
	m_vdp.accrueCycles(cycles, nextNow);
	m_deviceScheduler.advanceTo(nextNow);
}

void Machine::runDeviceService(uint8_t deviceKind) {
	const i64 nowCycles = m_deviceScheduler.nowCycles();
	switch (deviceKind) {
		case DeviceServiceGeo:
			m_geometryController.onService(nowCycles);
			return;
		case DeviceServiceDma:
			m_dmaController.onService(nowCycles);
			return;
		case DeviceServiceImg:
			m_imgDecController.onService(nowCycles);
			return;
		case DeviceServiceVdp:
			m_vdp.onService(nowCycles);
			return;
		default:
			throw runtimeFault("unknown device service kind " + std::to_string(deviceKind) + ".");
	}
}

void Machine::resetRenderBuffers() {
	RenderQueues::clearBackQueues();
}

MachineState Machine::captureState() const {
	MachineState state;
	state.memory = m_memory.captureState();
	state.input = m_inputController.captureState();
	state.vdp = m_vdp.captureState();
	return state;
}

void Machine::restoreState(const MachineState& state) {
	m_memory.restoreState(state.memory);
	m_geometryController.postLoad();
	m_irqController.postLoad();
	m_inputController.restoreState(state.input);
	m_vdp.restoreState(state.vdp);
	m_vdp.flushAssetEdits();
}

} // namespace bmsx
