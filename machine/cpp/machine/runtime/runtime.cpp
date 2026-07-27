#include "machine/runtime/runtime.h"
#include "machine/bus/io.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/memory/map.h"
#include "machine/runtime/input.h"
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
	RuntimeInputSource& input
	)
	: timing(
		options.pcrtcRunning,
		options.ufpsScaled,
		options.cpuHz,
		options.cycleBudgetPerFrame,
		options.totalHalfLines,
		options.activeDisplayHalfLines,
		options.geoWorkUnitsPerSec
	)
	, m_input(input)
	, m_memory(MemoryInit{
		options.systemRomBytes,
		options.cartridgeSlots
	})
	, machine(m_memory, input)
{
	resetLuaHeapUsageHooks();
	resetTrackedLuaHeapBytes();
	machine.memory.clearIoSlots();
	machine.memory.mapIoRead(IO_SYS_TIME_MS, this, &Runtime::onTimeMsReadThunk);
	machine.memory.mapIoRead(IO_SYS_FRAME_MS, this, &Runtime::onFrameMsReadThunk);
	machine.memory.mapIoRead(IO_SYS_CYCLES_PER_FRAME, this, &Runtime::onCyclesPerFrameReadThunk);
	machine.resetDevices();
	refreshDeviceTimings(*this, machine.scheduler.currentNowCycles());
	machine.runDeviceService(DEVICE_SERVICE_GPU);
	applyPublishedGxGpuPcrtcTiming(machine.gxGpu.readDeviceOutput().pcrtcTiming);

	configureLuaHeapUsage(this, &Runtime::getBaseRamUsedBytesThunk, &Runtime::collectTrackedHeapBytesThunk);

}

Runtime::~Runtime() {
	resetLuaHeapUsageHooks();
	resetTrackedLuaHeapBytes();
}

auto Runtime::callClosure(Closure& fn, NativeArgsView args) -> std::span<const Value> {
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
	return std::span<const Value>(cpu.completionValues);
}

auto Runtime::machineTimeMs() const -> uint32_t {
	const uint64_t cycles = static_cast<uint64_t>(machine.scheduler.currentNowCycles());
	const uint64_t cpuHz = static_cast<uint64_t>(timing.cpuHz);
	return static_cast<uint32_t>((cycles / cpuHz) * 1000ULL + ((cycles % cpuHz) * 1000ULL) / cpuHz);
}

auto Runtime::machineElapsedMs() const -> f64 {
	return static_cast<f64>(machine.scheduler.currentNowCycles()) * 1000.0 / static_cast<f64>(timing.cpuHz);
}

Value Runtime::onTimeMsReadThunk(void* context, uint32_t addr, MappedBusSignals) {
	const auto* runtime = static_cast<Runtime*>(context);
	return runtime->onTimeMsRead(addr);
}

Value Runtime::onTimeMsRead([[maybe_unused]] uint32_t addr) const {
	return valueNumber(static_cast<double>(machineTimeMs()));
}

Value Runtime::onFrameMsReadThunk(void* context, uint32_t addr, MappedBusSignals) {
	const auto* runtime = static_cast<Runtime*>(context);
	return runtime->onFrameMsRead(addr);
}

Value Runtime::onFrameMsRead([[maybe_unused]] uint32_t addr) const {
	return valueNumber(timing.frameDurationMs);
}

Value Runtime::onCyclesPerFrameReadThunk(void* context, uint32_t addr, MappedBusSignals) {
	const auto* runtime = static_cast<Runtime*>(context);
	return runtime->onCyclesPerFrameRead(addr);
}

Value Runtime::onCyclesPerFrameRead([[maybe_unused]] uint32_t addr) const {
	return valueNumber(static_cast<double>(timing.cycleBudgetPerFrame));
}

void Runtime::applyUfpsScaled(i64 ufpsScaled) {
	timing.ufpsScaled = ufpsScaled;
	timing.ufps = static_cast<f64>(ufpsScaled) / static_cast<f64>(HZ_SCALE);
	timing.frameDurationMs = 1000.0 / timing.ufps;
	m_input.setRuntimeInputFrameDurationMs(timing.frameDurationMs);
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
		m_input.setRuntimeInputFrameDurationMs(0.0);
		return;
	}
	timing.cycleBudgetPerFrame = pcrtcTiming.nextVblankCycleBudget;
	applyUfpsScaled(pcrtcTiming.refreshUfpsScaled);
}

uint32_t Runtime::baseRamUsedBytes() const {
	return BASE_RAM_USED_SIZE;
}

size_t Runtime::getBaseRamUsedBytesThunk([[maybe_unused]] void* context) {
	return BASE_RAM_USED_SIZE;
}

size_t Runtime::collectTrackedHeapBytesThunk(void* context) {
	auto& runtime = *static_cast<Runtime*>(context);
	runtime.machine.cpu.collectHeap();
	return trackedLuaHeapBytes();
}

uint32_t Runtime::ramUsedBytes() const {
	return baseRamUsedBytes() + static_cast<uint32_t>(trackedLuaHeapBytes());
}

uint32_t Runtime::ramTotalBytes() const {
	return RAM_SIZE;
}

uint32_t Runtime::vramUsedBytes() const {
	return static_cast<uint32_t>(GX_GPU_VRAM_BYTE_COUNT);
}

uint32_t Runtime::vramTotalBytes() const {
	return static_cast<uint32_t>(GX_GPU_VRAM_BYTE_COUNT);
}

void Runtime::boot() {
	machine.cpu.reset();
	setupBuiltins();
	finishSystemBoot();
}

void Runtime::finishSystemBoot() {
	enforceLuaHeapBudget();
	m_pendingCall = PendingCall::Entry;
	m_luaInitialized = true;
}

void Runtime::rebootSystem() {
	resetForSystemBoot();
	machine.cpu.reset();
	setupBuiltins();
	finishSystemBoot();
}

void Runtime::enterFaultState() {
	machine.cpu.clearHaltUntilIrq();
	machine.inputController.cancelSampleArm();
	m_pendingCall = PendingCall::None;
	frameLoop.abandonFrameState(*this);
	m_runtimeFailed = true;
}


void Runtime::resetForSystemBoot() {
	frameLoop.resetFrameState(*this);
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	machine.cpu.clearExecutionEnvironment();
	machine.memory.clearIoSlots();
	resetHardwareState();
}

// disable-next-line single_line_method_pattern -- runtime global writes keep CPU string-key encoding inside Runtime.
void Runtime::setGlobal(std::string_view name, const Value& value) {
	machine.cpu.setGlobalByKey(valueString(machine.cpu.stringPool().intern(name)), value);
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
