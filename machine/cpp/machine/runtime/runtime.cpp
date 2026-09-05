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

auto Runtime::callClosure(Closure& fn, BuiltinArgsView args) -> std::span<const Value> {
	CPU& cpu = machine.cpu;
	if (machine.scheduler.isCpuSliceActive()) {
		throw std::runtime_error("External Lua closure execution requires a suspended CPU.");
	}
	history.stop();
	const int depthBefore = cpu.getFrameDepth();
	const int previousBudget = cpu.instructionBudgetRemaining;
	try {
		cpu.beginCompletionCall(fn, args);
		cpuExecution.runSuspendedUntilDepth(*this, depthBefore);
	} catch (...) {
		cpu.instructionBudgetRemaining = previousBudget;
		throw;
	}
	cpu.instructionBudgetRemaining = previousBudget;
	return readCompletionValues();
}

auto Runtime::readCompletionValues() const -> std::span<const Value> {
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
	machine.cpu.installBootPrimitives();
	finishSystemBoot();
}

void Runtime::finishSystemBoot() {
	m_pendingCall = PendingCall::Entry;
}

void Runtime::rebootSystem() {
	resetForSystemBoot();
	machine.cpu.reset();
	machine.cpu.installBootPrimitives();
	finishSystemBoot();
}

void Runtime::suspendExecution() {
	m_pendingCall = PendingCall::None;
	frameLoop.abandonFrameState(*this);
	frameScheduler.clearQueuedTime();
}

void Runtime::resetForSystemBoot() {
	cpuExecution.reset();
	frameLoop.resetFrameState(*this);
	m_pendingCall = PendingCall::None;
	machine.cpu.clearExecutionEnvironment();
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
