#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"
#include "machine/runtime/timing/config.h"
#include <stdexcept>

namespace bmsx {

Runtime::Runtime(
	const RuntimeOptions& options,
	InputControllerInputSource& input
	)
	: timing(options.machineModel)
	, history(*this, input)
	, m_memory(MemoryInit{
		options.systemRomBytes,
		options.cartridgeSlots
	}, options.machineModel.ramBytes)
	, machine(m_memory, history.input, options.machineModel)
{
	machine.memory.clearIoSlots();
	machine.resetDevices();
	refreshDeviceTimings(*this, machine.scheduler.currentNowCycles());
	machine.runDeviceService(DEVICE_SERVICE_GPU);
	applyPublishedGxGpuPcrtcTiming(machine.gxGpu.readDeviceOutput().pcrtcTiming);

}

Runtime::~Runtime() = default;

auto Runtime::callClosure(u32 fn, BuiltinArgsView args) -> ConstValueSpan {
	const auto& scheduler = machine.scheduler;
	if (scheduler.acceptedCpuCycles() != 0 || scheduler.isCpuSliceActive() || machine.gxGpu.backendServiceBlocksMachine()
		|| machine.cpu.fixedInterruptActive()) {
		throw std::runtime_error("External Lua closure execution requires a settled CPU and device frontier.");
	}
	CPU& cpu = machine.cpu;
	const int depth = cpu.getFrameDepth();
	cpu.beginCompletionCall(fn, args);
	history.stop();
	cpuExecution.runSuspendedUntilDepth(*this, depth);
	return readCompletionValues();
}

auto Runtime::readCompletionValues() const -> ConstValueSpan {
	return machine.cpu.readCompletionValues();
}

bool Runtime::completionCallPending() const {
	return machine.cpu.completionCallPending();
}

void Runtime::applyPublishedGxGpuPcrtcTiming(const GxGpuPcrtcTiming& pcrtcTiming) {
	if (timing.pcrtcRevision == pcrtcTiming.revision
		&& timing.pcrtcRunning == pcrtcTiming.running
		&& timing.ufpsScaled == pcrtcTiming.refreshUfpsScaled
		&& timing.cycleBudgetPerFrame == pcrtcTiming.nextVblankCycleBudget
		&& timing.totalHalfLines == pcrtcTiming.totalHalfLines
		&& timing.activeDisplayHalfLines == pcrtcTiming.activeDisplayHalfLines) {
		return;
	}
	timing.pcrtcRevision = pcrtcTiming.revision;
	timing.pcrtcRunning = pcrtcTiming.running;
	timing.totalHalfLines = pcrtcTiming.totalHalfLines;
	timing.activeDisplayHalfLines = pcrtcTiming.activeDisplayHalfLines;
	if (!pcrtcTiming.running) {
		timing.ufpsScaled = 0;
		timing.ufps = 0.0;
		timing.frameDurationMs = 0.0;
		timing.cycleBudgetPerFrame = 0;
		return;
	}
	timing.cycleBudgetPerFrame = pcrtcTiming.nextVblankCycleBudget;
	timing.ufpsScaled = pcrtcTiming.refreshUfpsScaled;
	timing.ufps = static_cast<f64>(pcrtcTiming.refreshUfpsScaled) / static_cast<f64>(HZ_SCALE);
	timing.frameDurationMs = pcrtcTiming.frameDurationMs;
}

void Runtime::boot() {
	machine.cpu.reset();
	finishSystemBoot();
}

void Runtime::finishSystemBoot() {
	m_pendingCall = PendingCall::Entry;
	if (onStateReset) onStateReset();
}

void Runtime::rebootSystem() {
	resetForSystemBoot();
	machine.cpu.reset();
	finishSystemBoot();
}

void Runtime::suspendExecution() {
	m_pendingCall = PendingCall::None;
	frameLoop.abandonFrameState(*this);
	frameScheduler.clearQueuedTime();
}

void Runtime::resetForSystemBoot() {
	if (machine.cpu.fixedInterruptDefersReset()) throw BMSX_RUNTIME_ERROR("System IRQ must retire before reset.");
	frameLoop.resetFrameState(*this);
	m_pendingCall = PendingCall::None;
	machine.memory.clearIoSlots();
	resetHardwareState();
}

void Runtime::resetHardwareState() {
	history.stop();
	machine.scheduler.reset();
	machine.resetDevices();
	vblank.reset(*this);
	refreshDeviceTimings(*this, machine.scheduler.nowCycles());
	machine.runDeviceService(DEVICE_SERVICE_GPU);
	applyPublishedGxGpuPcrtcTiming(machine.gxGpu.readDeviceOutput().pcrtcTiming);
}

} // namespace bmsx
