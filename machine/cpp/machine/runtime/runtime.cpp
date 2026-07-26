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

int runHaltedClosureUntilInterrupt(Runtime& runtime) {
	CPU& cpu = runtime.machine.cpu;
	DeviceScheduler& scheduler = runtime.machine.scheduler;
	int consumed = 0;
	bool advancedDeadline = false;
	while (cpu.isHaltedUntilIrq()) {
		if (cpu.peekPendingInterrupt() != AcceptedInterruptKind::None) {
			cpu.clearHaltUntilIrq();
			return consumed;
		}
		if (advancedDeadline) {
			return consumed;
		}
		const i64 nextDeadline = scheduler.nextDeadline();
		if (nextDeadline == std::numeric_limits<i64>::max()) {
			return consumed;
		}
		const i64 idleCycles = nextDeadline - scheduler.nowCycles();
		if (idleCycles <= 0) {
			if (runDueRuntimeTimers(runtime)) {
				return consumed;
			}
			continue;
		}
		advanceRuntimeTime(runtime, static_cast<int>(idleCycles));
		consumed += static_cast<int>(idleCycles);
		advancedDeadline = true;
	}
	return consumed;
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
	, hostFault(*this)
{
	resetLuaHeapUsageHooks();
	resetTrackedLuaHeapBytes();
	machine.memory.clearIoSlots();
	machine.memory.mapIoRead(IO_SYS_TIME_MS, this, &Runtime::onTimeMsReadThunk);
	machine.memory.mapIoRead(IO_SYS_FRAME_MS, this, &Runtime::onFrameMsReadThunk);
	machine.memory.mapIoRead(IO_SYS_CYCLES_PER_FRAME, this, &Runtime::onCyclesPerFrameReadThunk);
	machine.memory.mapIoWrite(IO_GX_GPU_GP1, this, &Runtime::onGxGpuGp1WriteThunk);
	machine.initializeSystemIo();
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

void Runtime::callClosureInto(Closure& fn, NativeArgsView args, NativeResults& out) {
	CPU& cpu = machine.cpu;
	if (machine.scheduler.isCpuSliceActive() || cpu.isHostExternalCallActive()) {
		throw std::runtime_error("External Lua closure execution requires a suspended CPU.");
	}
	const int depthBefore = cpu.getFrameDepth();
	const int previousBudget = cpu.instructionBudgetRemaining;
	const int budgetSentinel = std::numeric_limits<int>::max();
	NativeResults* previousSink = cpu.swapExternalReturnSink(&out);
	int spentBudget = 0;
	int activeBudget = 0;
	out.clear();
	cpu.enterHostExternalCall();
	try {
		cpu.callExternal(fn, args);
		while (cpu.getFrameDepth() > depthBefore) {
			activeBudget = budgetSentinel;
			const RunResult result = cpu.runUntilDepth(depthBefore, budgetSentinel);
			spentBudget += activeBudget - cpu.instructionBudgetRemaining;
			activeBudget = 0;
			if (cpu.getFrameDepth() > depthBefore && result == RunResult::Halted) {
				spentBudget += runHaltedClosureUntilInterrupt(*this);
				if (cpu.isHaltedUntilIrq()) {
					break;
				}
			}
		}
	} catch (...) {
		if (activeBudget > 0) {
			spentBudget += activeBudget - cpu.instructionBudgetRemaining;
		}
		cpu.unwindToDepth(depthBefore);
		cpu.instructionBudgetRemaining = previousBudget - spentBudget;
		cpu.swapExternalReturnSink(previousSink);
		cpu.leaveHostExternalCall();
		throw;
	}
	cpu.instructionBudgetRemaining = previousBudget - spentBudget;
	cpu.swapExternalReturnSink(previousSink);
	cpu.leaveHostExternalCall();
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

void Runtime::onGxGpuGp1WriteThunk(void* context, uint32_t addr, Value value, MappedBusSignals) {
	auto* runtime = static_cast<Runtime*>(context);
	(void)addr;
	runtime->machine.gxGpu.writeGp1(toU32(value));
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
	machine.cpu.mountExecutionImages();
	setupBuiltins();
	startSystemFirmware();
}

void Runtime::startSystemFirmware() {
	machine.cpu.start(
		machine.cpu.systemStartupFunctionAddress(),
		NativeArgsView(),
		CPU_STATUS_SYSTEM_ENTRY
	);
	enforceLuaHeapBudget();
	m_pendingCall = PendingCall::Entry;
	m_luaInitialized = true;
}

void Runtime::rebootSystem() {
	resetForSystemBoot();
	machine.cpu.mountExecutionImages();
	setupBuiltins();
	startSystemFirmware();
}

void Runtime::enterFaultState() {
	hostFault.publishStartup();
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
	hostFault.clear();
	machine.cpu.clearExecutionEnvironment();
	machine.memory.clearIoSlots();
	machine.initializeSystemIo();
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
