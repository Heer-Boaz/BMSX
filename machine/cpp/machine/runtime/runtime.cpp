#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"
#include "machine/runtime/timing/config.h"
#include <limits>
#include <stdexcept>
#include <utility>

namespace bmsx {

namespace {

void runHaltedClosureUntilInterrupt(Runtime& runtime) {
	Machine& machine = runtime.machine;
	CPU& cpu = machine.cpu;
	DeviceScheduler& scheduler = machine.scheduler;
	bool advancedDeadline = false;
	while (cpu.isHaltedUntilIrq()) {
		if (machine.gxGpu.backendReadbackBlocksMachine()) {
			return;
		}
		const bool cpuHeld = machine.systemController.cpuHeld();
		if (!cpuHeld && cpu.enterPendingInterrupt()) {
			return;
		}
		if (!cpuHeld && advancedDeadline) {
			return;
		}
		const i64 nextDeadline = scheduler.nextDeadline();
		if (nextDeadline == std::numeric_limits<i64>::max()) {
			return;
		}
		const i64 cyclesToDeadline = nextDeadline - scheduler.nowCycles();
		if (cyclesToDeadline <= 0) {
			if (runDueRuntimeTimers(runtime)) {
				return;
			}
			continue;
		}
		const int idleCycles = static_cast<int>(
			cyclesToDeadline < MAX_CPU_SLICE_CYCLES
				? cyclesToDeadline
				: MAX_CPU_SLICE_CYCLES
		);
		advanceRuntimeTime(runtime, idleCycles);
		advancedDeadline = idleCycles == cyclesToDeadline;
	}
}

} // namespace

Runtime::Runtime(
	const RuntimeOptions& options,
	InputControllerInputSource& input
	)
	: timing(options.machineModel)
	, m_memory(MemoryInit{
		options.systemRomBytes,
		options.cartridgeSlots
	}, options.machineModel.ramBytes)
	, machine(m_memory, input, options.machineModel)
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
	DeviceScheduler& scheduler = machine.scheduler;
	if (scheduler.isCpuSliceActive()) {
		throw std::runtime_error("External Lua closure execution requires a suspended CPU.");
	}
	const int depthBefore = cpu.getFrameDepth();
	const int previousBudget = cpu.instructionBudgetRemaining;
	try {
		cpu.beginCompletionCall(fn, args);
		runDueRuntimeTimers(*this);
		while (cpu.getFrameDepth() > depthBefore) {
			if (machine.gxGpu.backendReadbackBlocksMachine()) {
				break;
			}
			if (machine.systemController.cpuHeld()) {
				const i64 nextDeadline = scheduler.nextDeadline();
				if (nextDeadline == std::numeric_limits<i64>::max()) {
					break;
				}
				const i64 waitBudget = nextDeadline - scheduler.nowCycles();
				if (waitBudget <= 0) {
					runDueRuntimeTimers(*this);
					continue;
				}
				const int waitCycles = static_cast<int>(
					waitBudget < MAX_CPU_SLICE_CYCLES
						? waitBudget
						: MAX_CPU_SLICE_CYCLES
				);
				advanceRuntimeTime(*this, waitCycles);
				continue;
			}
			if (cpu.isMemoryWriteBlocked()) {
				const i64 nextDeadline = scheduler.nextDeadline();
				const i64 waitBudget = nextDeadline - scheduler.nowCycles();
				if (waitBudget <= 0) {
					runDueRuntimeTimers(*this);
					continue;
				}
				// External closures obey the same hardware wait contract as the
				// frame executor: only the scheduled device edge releases the store.
				const int waitCycles = static_cast<int>(
					waitBudget < MAX_CPU_SLICE_CYCLES
						? waitBudget
						: MAX_CPU_SLICE_CYCLES
				);
				advanceRuntimeTime(*this, waitCycles);
				continue;
			}
			int sliceBudget = MAX_CPU_SLICE_CYCLES;
			const i64 nextDeadline = scheduler.nextDeadline();
			if (nextDeadline != std::numeric_limits<i64>::max()) {
				const i64 deadlineBudget = nextDeadline - scheduler.nowCycles();
				if (deadlineBudget <= 0) {
					runDueRuntimeTimers(*this);
					continue;
				}
				if (deadlineBudget < sliceBudget) {
					sliceBudget = static_cast<int>(deadlineBudget);
				}
			}
			scheduler.beginCpuSlice(sliceBudget);
			RunResult result = RunResult::Yielded;
			int consumed = 0;
			try {
				result = cpu.runUntilDepth(depthBefore, sliceBudget);
			} catch (...) {
				scheduler.endCpuSlice();
				consumed = sliceBudget - cpu.instructionBudgetRemaining;
				if (consumed > 0) {
					advanceRuntimeTime(*this, consumed);
				}
				throw;
			}
			scheduler.endCpuSlice();
			consumed = sliceBudget - cpu.instructionBudgetRemaining;
			if (consumed > 0) {
				advanceRuntimeTime(*this, consumed);
			}
			if (cpu.getFrameDepth() <= depthBefore) {
				break;
			}
			if (cpu.isMemoryWriteBlocked()) {
				continue;
			}
			if (result == RunResult::Halted) {
				if (!cpu.isHaltedUntilIrq()) {
					break;
				}
				runHaltedClosureUntilInterrupt(*this);
				if (cpu.isHaltedUntilIrq()) {
					break;
				}
				continue;
			}
			if (consumed <= 0) {
				runDueRuntimeTimers(*this);
			}
		}
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
	installLuaBootPrimitives();
	finishSystemBoot();
}

void Runtime::finishSystemBoot() {
	m_pendingCall = PendingCall::Entry;
}

void Runtime::rebootSystem() {
	resetForSystemBoot();
	machine.cpu.reset();
	installLuaBootPrimitives();
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
	machine.scheduler.reset();
	machine.resetDevices();
	vblank.reset(*this);
	refreshDeviceTimings(*this, machine.scheduler.nowCycles());
	machine.runDeviceService(DEVICE_SERVICE_GPU);
	applyPublishedGxGpuPcrtcTiming(machine.gxGpu.readDeviceOutput().pcrtcTiming);
}

} // namespace bmsx
