#include "machine/runtime/runtime.h"
#include "machine/firmware/firmware_api.h"
#include "machine/bus/io.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/program/program_loader.h"
#include "machine/runtime/resource_usage_detector.h"
#include "core/engine_core.h"
#include "rompack/rompack.h"
#include "input/input.h"
#include "render/shared/render_queues.h"
#include "render/texturemanager.h"
#include <array>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <ctime>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <unordered_set>
#include <vector>

namespace bmsx {
namespace {
inline double to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
}

inline std::runtime_error runtimeFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("Runtime fault: " + message);
}

constexpr size_t CART_ROM_HEADER_SIZE = 72;
constexpr std::array<u8, CART_ROM_HEADER_SIZE> CART_ROM_EMPTY_HEADER = {};

}

// Button actions for standard gamepad/keyboard mapping
const std::vector<std::string> BUTTON_ACTIONS = {
	"left",
	"right",
	"up",
	"down",
	"b",
	"a",
	"x",
	"y",
	"start",
	"select",
	"rt",
	"lt",
	"rb",
	"lb",
};

// Static instance pointer
Runtime* Runtime::s_instance = nullptr;

Runtime& Runtime::createInstance(const RuntimeOptions& options) {
	if (s_instance) {
		throw runtimeFault("instance already exists.");
	}
	configureLuaHeapUsage({});
	resetTrackedLuaHeapBytes();
	s_instance = new Runtime(options);
	return *s_instance;
}

Runtime& Runtime::instance() {
	return *s_instance;
}

bool Runtime::hasInstance() {
	return s_instance != nullptr;
}

void Runtime::destroy() {
	delete s_instance;
	s_instance = nullptr;
}

Runtime::Runtime(const RuntimeOptions& options)
	: timing(options.ufpsScaled)
	, m_memory()
	, m_stringHandles(m_memory)
	, m_cpu(m_memory, &m_stringHandles)
	, m_deviceScheduler(m_cpu)
	, m_api(std::make_unique<Api>(*this))
	, m_vdp(
			m_memory,
			m_cpu,
			*m_api,
			m_deviceScheduler
		)
	, m_irqController(m_memory)
	, m_dmaController(
			m_memory,
			m_irqController,
			m_vdp,
			m_deviceScheduler
		)
	, m_geometryController(
			m_memory,
			m_irqController,
			m_deviceScheduler
		)
	, m_imgDecController(
			m_memory,
			m_dmaController,
			m_irqController,
			m_deviceScheduler
		)
	, m_inputController(
			m_memory,
			Input::instance(),
			m_cpu.stringPool()
		)
	, m_audioController(
			m_memory,
			*EngineCore::instance().soundMaster(),
			m_irqController
		)
	, m_viewport(options.viewport)
	, m_canonicalization(options.canonicalization)
	, m_cpuHz(options.cpuHz)
	, m_vdpWorkUnitsPerSec(options.vdpWorkUnitsPerSec)
	, m_geoWorkUnitsPerSec(options.geoWorkUnitsPerSec)
	, m_cycleBudgetPerFrame(options.cycleBudgetPerFrame)
	{
		// Initialize I/O memory region
		m_memory.clearIoSlots();
		// System flags
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_HOST_FAULT_STAGE, valueNumber(static_cast<double>(HOST_FAULT_STAGE_NONE)));
	m_irqController.reset();
	m_dmaController.reset();
	m_geometryController.reset();
	m_imgDecController.reset();
	m_inputController.reset();
	m_audioController.reset();
	m_vdp.attachImgDecController(m_imgDecController);
	m_vdp.initializeRegisters();
	setVblankCycles(options.vblankCycles);
	setVdpWorkUnitsPerSec(options.vdpWorkUnitsPerSec);
	setGeoWorkUnitsPerSec(options.geoWorkUnitsPerSec);
	m_randomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
	refreshMemoryMap();
	m_cpu.setExternalRootMarker([this](GcHeap& heap) {
		for (const auto& entry : m_moduleCache) {
			heap.markValue(entry.second);
		}
		heap.markValue(m_pairsIterator);
		heap.markValue(m_ipairsIterator);
		m_api->markRoots(heap);
	});

	m_resourceUsageDetector = std::make_unique<ResourceUsageDetector>(
		m_memory,
		m_stringHandles,
		m_vdp
	);
	configureLuaHeapUsage({
		.collect = [this]() {
			m_cpu.collectHeap();
		},
		.getBaseRamUsedBytes = [this]() {
			return static_cast<size_t>(m_resourceUsageDetector->baseRamUsedBytes());
		},
	});

}

Runtime::~Runtime() {
	configureLuaHeapUsage({});
	resetTrackedLuaHeapBytes();
}

Api& Runtime::api() {
	return *m_api;
}

void Runtime::boot(const ProgramAsset& asset, ProgramMetadata* metadata) {
	m_moduleProtos.clear();
	for (const auto& [path, protoIndex] : asset.moduleProtos) {
		m_moduleProtos[path] = protoIndex;
	}
	m_moduleAliases.clear();
	for (const auto& [alias, path] : asset.moduleAliases) {
		m_moduleAliases[alias] = path;
	}
	m_moduleCache.clear();
	boot(asset.program.get(), metadata, asset.entryProtoIndex);
}

void Runtime::resetRuntimeForProgramReload() {
	resetFrameState();
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	m_cartBootPrepared = false;
	m_pendingCartBoot = false;
	setCartBootReadyFlag(false);
	m_hostFaultMessage.reset();
	m_moduleCache.clear();
	m_cpu.clearGlobalSlots();
	m_cpu.globals->clear();
	m_memory.clearIoSlots();
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_HOST_FAULT_STAGE, valueNumber(static_cast<double>(HOST_FAULT_STAGE_NONE)));
	resetHardwareState();
	m_randomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
}

void Runtime::boot(Program* program, ProgramMetadata* metadata, int entryProtoIndex) {
	try {
		setupBuiltins();
		m_api->registerAllFunctions();
		enforceLuaHeapBudget();
		m_program = program;
		m_programMetadata = metadata;
		m_cpu.setProgram(program, metadata);
		runEngineBuiltinPrelude();
		enforceLuaHeapBudget();

		m_cpu.start(entryProtoIndex);
		enforceLuaHeapBudget();
		m_pendingCall = PendingCall::Entry;
		queueLifecycleHandlers(true, true);
		m_luaInitialized = true;
	} catch (const std::exception& e) {
		handleLuaError(e.what());
	}
}

void Runtime::setCartBootReadyFlag(bool value) {
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(value ? 1.0 : 0.0));
}

void Runtime::prepareCartBootIfNeeded() {
	if (!isEngineProgramActive()) {
		return;
	}
	if (!EngineCore::instance().hasLoadedCartProgram()) {
		return;
	}
	if (m_cartBootPrepared) {
		return;
	}
	m_cartBootPrepared = true;
	setCartBootReadyFlag(true);
}

bool Runtime::pollSystemBootRequest() {
	if (!isEngineProgramActive()) {
		return false;
	}
	if (m_memory.readIoU32(IO_SYS_BOOT_CART) == 0u) {
		return false;
	}
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	machineScheduler.clearQueuedTime();
	m_pendingCartBoot = true;
	return true;
}

bool Runtime::processPendingCartBoot() {
	if (!m_pendingCartBoot) {
		return false;
	}
	if (m_frameActive) {
		resetFrameState();
	}
	if (hasEntryContinuation()) {
		m_pendingCall = PendingCall::None;
		clearHaltUntilIrq();
	}
	machineScheduler.clearQueuedTime();
	m_pendingCartBoot = false;
	try {
		if (!EngineCore::instance().bootLoadedCart()) {
			setCartBootReadyFlag(false);
			EngineCore::instance().log(LogLevel::Error,
				"Runtime fault: deferred cart boot request failed while leaving system boot screen active.\n");
		}
	} catch (const std::exception& error) {
		setCartBootReadyFlag(false);
		EngineCore::instance().log(LogLevel::Error,
			"Runtime fault: deferred cart boot request failed while leaving system boot screen active: %s\n",
			error.what());
	}
	return true;
}

void Runtime::refreshDeviceTimings(i64 nowCycles) {
	m_dmaController.setTiming(m_cpuHz, m_dmaBytesPerSecIso, m_dmaBytesPerSecBulk, nowCycles);
	m_imgDecController.setTiming(m_cpuHz, m_imgDecBytesPerSec, nowCycles);
	m_geometryController.setTiming(m_cpuHz, m_geoWorkUnitsPerSec, nowCycles);
	m_vdp.setTiming(m_cpuHz, m_vdpWorkUnitsPerSec, nowCycles);
}

void Runtime::advanceTime(int cycles) {
	if (cycles <= 0) {
		return;
	}
	const i64 nextNow = m_deviceScheduler.nowCycles() + cycles;
	m_dmaController.accrueCycles(cycles, nextNow);
	m_imgDecController.accrueCycles(cycles, nextNow);
	m_geometryController.accrueCycles(cycles, nextNow);
	m_vdp.accrueCycles(cycles, nextNow);
	m_deviceScheduler.advanceTo(nextNow);
	runDueTimers();
}

int Runtime::getCyclesIntoFrame() const {
	return static_cast<int>(m_deviceScheduler.nowCycles() - m_frameStartCycle);
}

void Runtime::resetSchedulerState() {
	m_deviceScheduler.reset();
	m_frameStartCycle = 0;
}

void Runtime::runDueTimers() {
	while (m_deviceScheduler.hasDueTimer()) {
		const uint16_t event = m_deviceScheduler.popDueTimer();
		dispatchTimer(static_cast<uint8_t>(event >> 8u), static_cast<uint8_t>(event & 0xffu));
	}
}

void Runtime::dispatchTimer(uint8_t kind, uint8_t payload) {
	switch (kind) {
		case TimerKindVblankBegin:
			handleVblankBeginTimer();
			return;
		case TimerKindVblankEnd:
			handleVblankEndTimer();
			return;
		case TimerKindDeviceService:
			runDeviceService(payload);
			return;
		default:
			throw runtimeFault("unknown timer kind " + std::to_string(kind) + ".");
	}
}

void Runtime::scheduleCurrentFrameTimers() {
	m_deviceScheduler.scheduleVblankEnd(m_frameStartCycle + m_cycleBudgetPerFrame);
	if (m_vblankStartCycle > 0 && getCyclesIntoFrame() < m_vblankStartCycle) {
		m_deviceScheduler.scheduleVblankBegin(m_frameStartCycle + m_vblankStartCycle);
	}
}

void Runtime::handleVblankBeginTimer() {
	if (!m_vblankActive) {
		enterVblank();
	}
}

void Runtime::handleVblankEndTimer() {
	if (m_vblankActive) {
		leaveVblank();
	}
	m_frameStartCycle = m_deviceScheduler.nowCycles();
	scheduleCurrentFrameTimers();
	if (m_vblankStartCycle == 0) {
		enterVblank();
	}
}

void Runtime::runDeviceService(uint8_t deviceKind) {
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

void Runtime::resetVblankState() {
	resetSchedulerState();
	m_vblankActive = false;
	m_vblankSequence = 0;
	m_lastCompletedVblankSequence = 0;
	m_inputController.restoreSampleArmed(false);
	m_irqController.postLoad();
	resetHaltIrqWait();
	m_vdp.resetStatus();
	if (m_vblankStartCycle == 0) {
		setVblankStatus(true);
	}
	scheduleCurrentFrameTimers();
	refreshDeviceTimings(m_deviceScheduler.nowCycles());
}

void Runtime::setVblankStatus(bool active) {
	m_vblankActive = active;
	m_vdp.setVblankStatus(active);
}

void Runtime::enterVblank() {
	m_vblankSequence += 1;
	commitFrameOnVblankEdge();
	m_inputController.onVblankEdge();
	setVblankStatus(true);
	m_irqController.raise(IRQ_VBLANK);
	if (m_frameActive && m_cpu.isHaltedUntilIrq() && m_pendingCall == PendingCall::Entry && m_cpu.getFrameDepth() == 1) {
		completeTickIfPending(m_frameState, m_vblankSequence);
		m_clearBackQueuesAfterIrqWake = true;
	}
}

void Runtime::leaveVblank() {
	setVblankStatus(false);
}

void Runtime::commitFrameOnVblankEdge() {
	m_vdp.syncRegisters();
	m_vdp.presentReadyFrameOnVblankEdge();
	m_vdp.commitViewSnapshot(*EngineCore::instance().view());
}

void Runtime::completeTickIfPending(FrameState& frameState, uint64_t vblankSequence) {
	if (m_lastCompletedVblankSequence == vblankSequence) {
		return;
	}
	m_activeTickCompleted = true;
	m_lastCompletedVblankSequence = vblankSequence;
	machineScheduler.enqueueTickCompletion(*this, frameState);
}

void Runtime::clearHaltUntilIrq() {
	m_cpu.clearHaltUntilIrq();
	resetHaltIrqWait();
	m_clearBackQueuesAfterIrqWake = false;
}

void Runtime::resetHaltIrqWait() {
	m_haltIrqWaitArmed = false;
	m_haltIrqSignalSequence = 0;
}

bool Runtime::tryCompleteTickOnPendingVblankIrq(FrameState& frameState) {
	if (!(m_cpu.getFrameDepth() == 1 && m_pendingCall == PendingCall::Entry && m_cpu.isHaltedUntilIrq())) {
		return false;
	}
	if (m_vblankSequence == 0) {
		return false;
	}
	const uint32_t pendingFlags = m_irqController.pendingFlags();
	if ((pendingFlags & IRQ_VBLANK) == 0u) {
		return false;
	}
	if (m_lastCompletedVblankSequence == m_vblankSequence) {
		return false;
	}
	completeTickIfPending(frameState, m_vblankSequence);
	m_clearBackQueuesAfterIrqWake = true;
	m_cpu.clearHaltUntilIrq();
	resetHaltIrqWait();
	return true;
}

bool Runtime::runHaltedUntilIrq(FrameState& frameState) {
	runDueTimers();
	if (!m_cpu.isHaltedUntilIrq()) {
		resetHaltIrqWait();
		return false;
	}
	if (tryCompleteTickOnPendingVblankIrq(frameState)) {
		return true;
	}
	if (!m_haltIrqWaitArmed) {
		const uint32_t pendingFlags = m_irqController.pendingFlags();
		if (pendingFlags != 0u) {
			m_cpu.clearHaltUntilIrq();
			return m_activeTickCompleted;
		}
		m_haltIrqSignalSequence = m_irqController.signalSequence();
		m_haltIrqWaitArmed = true;
	}
	while (true) {
		if (m_irqController.signalSequence() != m_haltIrqSignalSequence) {
			m_cpu.clearHaltUntilIrq();
			resetHaltIrqWait();
			return m_activeTickCompleted;
		}
		if (frameState.cycleBudgetRemaining > 0) {
			const i64 cyclesToTarget = m_deviceScheduler.nextDeadline() - m_deviceScheduler.nowCycles();
			if (cyclesToTarget <= 0) {
				runDueTimers();
				continue;
			}
			const int idleCycles = static_cast<int>(std::min<i64>(frameState.cycleBudgetRemaining, cyclesToTarget));
			frameState.cycleBudgetRemaining -= idleCycles;
			advanceTime(idleCycles);
				if (tryCompleteTickOnPendingVblankIrq(frameState)) {
					return true;
				}
				continue;
			}
		return true;
	}
}

void Runtime::raiseEngineIrq(uint32_t mask) {
	constexpr uint32_t kAllowedMask = IRQ_REINIT | IRQ_NEWGAME;
	if (mask == 0) {
		throw runtimeFault("engine IRQ mask must be non-zero.");
	}
	const uint32_t unsupported = mask & ~kAllowedMask;
	if (unsupported != 0u) {
		throw runtimeFault("unsupported engine IRQ mask " + std::to_string(unsupported) + ".");
	}
	m_irqController.raise(mask);
}

RunResult Runtime::runWithBudget() {
	int remaining = m_frameState.cycleBudgetRemaining;
	RunResult result = RunResult::Yielded;
	runDueTimers();
	while (remaining > 0) {
		int sliceBudget = remaining;
		const i64 nextDeadline = m_deviceScheduler.nextDeadline();
		if (nextDeadline != std::numeric_limits<i64>::max()) {
			const i64 deadlineBudget = nextDeadline - m_deviceScheduler.nowCycles();
			if (deadlineBudget <= 0) {
				runDueTimers();
				continue;
			}
			if (deadlineBudget < sliceBudget) {
				sliceBudget = static_cast<int>(deadlineBudget);
			}
		}
		m_deviceScheduler.beginCpuSlice(sliceBudget);
		result = m_cpu.run(sliceBudget);
		m_deviceScheduler.endCpuSlice();
		const int sliceRemaining = m_cpu.instructionBudgetRemaining;
		const int consumed = sliceBudget - sliceRemaining;
		if (consumed > 0) {
			remaining -= consumed;
			m_frameState.activeCpuUsedCycles += consumed;
			advanceTime(consumed);
		}
		if (m_cpu.isHaltedUntilIrq() || result == RunResult::Halted) {
			break;
		}
		if (consumed <= 0) {
			throw runtimeFault("CPU yielded without consuming cycles.");
		}
	}
	m_frameState.cycleBudgetRemaining = remaining;
	return result;
}

void Runtime::queueLifecycleHandlers(bool runInit, bool runNewGame) {
	uint32_t mask = 0;
	if (runInit) {
		mask |= IRQ_REINIT;
	}
	if (runNewGame) {
		mask |= IRQ_NEWGAME;
	}
	if (mask != 0) {
		raiseEngineIrq(mask);
	}
}

void Runtime::beginFrameState() {
	m_frameActive = true;
	m_lastTickCompleted = false;
	m_activeTickCompleted = false;
	m_frameState = FrameState{};
	m_frameState.cycleBudgetRemaining = m_cycleBudgetPerFrame;
	m_frameState.cycleBudgetGranted = m_cycleBudgetPerFrame;
	m_frameState.cycleCarryGranted = 0;
	m_frameDeltaMs = timing.frameDurationMs;
	m_vdp.beginFrame();
	auto key = [this](std::string_view text) {
		return valueString(m_cpu.internString(text));
	};
	auto* gameTable = asTable(m_cpu.getGlobalByKey(key("game")));
	auto* viewportTable = asTable(gameTable->get(key("viewportsize")));
	auto viewSize = EngineCore::instance().view()->viewportSize;
	viewportTable->set(key("x"), valueNumber(static_cast<double>(viewSize.x)));
	viewportTable->set(key("y"), valueNumber(static_cast<double>(viewSize.y)));
	auto* viewTable = asTable(gameTable->get(key("view")));
	auto* view = EngineCore::instance().view();
	viewTable->set(key("crt_postprocessing_enabled"), valueBool(view->crt_postprocessing_enabled));
	viewTable->set(key("enable_noise"), valueBool(view->applyNoise));
	viewTable->set(key("enable_colorbleed"), valueBool(view->applyColorBleed));
	viewTable->set(key("enable_scanlines"), valueBool(view->applyScanlines));
	viewTable->set(key("enable_blur"), valueBool(view->applyBlur));
	viewTable->set(key("enable_glow"), valueBool(view->applyGlow));
	viewTable->set(key("enable_fringing"), valueBool(view->applyFringing));
	viewTable->set(key("enable_aperture"), valueBool(view->applyAperture));
}

void Runtime::finalizeUpdateSlice() {
	if (hasEntryContinuation() && !m_activeTickCompleted) {
		return;
	}
	m_frameActive = false;
	m_activeTickCompleted = false;
}

bool Runtime::tickUpdate() {
	if (m_rebootRequested) {
		m_rebootRequested = false;
		machineScheduler.clearQueuedTime();
		if (!EngineCore::instance().rebootLoadedRom()) {
			EngineCore::instance().log(LogLevel::Error, "Runtime fault: reboot to bootrom failed.\n");
		}
		return true;
	}
	if (!m_luaInitialized || !m_tickEnabled || m_runtimeFailed) {
		return false;
	}

	prepareCartBootIfNeeded();
	if (pollSystemBootRequest()) {
		return true;
	}
	if (processPendingCartBoot()) {
		return true;
	}

	FrameState* const previousState = m_frameActive ? &m_frameState : nullptr;
	const int previousRemaining = previousState != nullptr ? previousState->cycleBudgetRemaining : -1;
	const bool previousPending = hasEntryContinuation();
	const i64 previousSequence = m_lastTickSequence;
	bool startedFrame = false;
	if (m_frameActive) {
		if (m_frameState.cycleBudgetRemaining <= 0 && !machineScheduler.refillFrameBudget(*this, m_frameState)) {
			return false;
		}
	} else {
		if (!machineScheduler.startScheduledFrame(*this)) {
			return false;
		}
		startedFrame = true;
	}

	if (hasEntryContinuation()) {
		executeUpdateCallback();
	}

	if (startedFrame) {
		auto key = [this](std::string_view text) {
			return valueString(m_cpu.internString(text));
		};
		auto* gameTable = asTable(m_cpu.getGlobalByKey(key("game")));
		auto* viewTable = asTable(gameTable->get(key("view")));
		auto* view = EngineCore::instance().view();
		auto readViewBool = [](Value value, const char* field) -> bool {
			if (!valueIsBool(value)) {
				throw BMSX_RUNTIME_ERROR(std::string("game.view.") + field + " must be boolean.");
			}
			return valueToBool(value);
		};
		view->crt_postprocessing_enabled = readViewBool(viewTable->get(key("crt_postprocessing_enabled")), "crt_postprocessing_enabled");
		view->applyNoise = readViewBool(viewTable->get(key("enable_noise")), "enable_noise");
		view->applyColorBleed = readViewBool(viewTable->get(key("enable_colorbleed")), "enable_colorbleed");
		view->applyScanlines = readViewBool(viewTable->get(key("enable_scanlines")), "enable_scanlines");
		view->applyBlur = readViewBool(viewTable->get(key("enable_blur")), "enable_blur");
		view->applyGlow = readViewBool(viewTable->get(key("enable_glow")), "enable_glow");
		view->applyFringing = readViewBool(viewTable->get(key("enable_fringing")), "enable_fringing");
		view->applyAperture = readViewBool(viewTable->get(key("enable_aperture")), "enable_aperture");
		m_debugUpdateCountTotal += 1;
	}

	m_frameState.updateExecuted = !hasEntryContinuation();
	flushAssetEdits();
	finalizeUpdateSlice();
	FrameState* const nextState = m_frameActive ? &m_frameState : nullptr;
	if (nextState != previousState) {
		return true;
	}
	if (nextState != nullptr && nextState->cycleBudgetRemaining != previousRemaining) {
		return true;
	}
	if (hasEntryContinuation() != previousPending) {
		return true;
	}
	return m_lastTickSequence != previousSequence;
}

void Runtime::tickIdeInput() {
}

void Runtime::tickIDE() {
}

void Runtime::tickIDEDraw() {
}

void Runtime::tickTerminalInput() {
	// Terminal input handling - stub for now
}

void Runtime::tickTerminalMode() {
	// Terminal mode update - stub for now
	flushAssetEdits();
}

void Runtime::tickTerminalModeDraw() {
	// Terminal mode draw - stub for now
}

void Runtime::requestProgramReload() {
	// Reboot is executed on the next update boundary so the active Lua call can unwind first.
	m_rebootRequested = true;
	m_luaInitialized = false;
	resetFrameState();
}

void Runtime::resetFrameState() {
	m_frameActive = false;
	m_activeTickCompleted = false;
	m_inputController.restoreSampleArmed(false);
	m_frameState = FrameState{};
	clearHaltUntilIrq();
	machineScheduler.reset(*this);
	screen.reset();
	m_lastTickBudgetGranted = 0;
	m_lastTickCpuBudgetGranted = 0;
	m_lastTickCpuUsedCycles = 0;
	m_lastTickCompleted = false;
	m_lastTickBudgetRemaining = 0;
	m_lastTickSequence = 0;
	m_lastTickConsumedSequence = 0;
	resetVblankState();
}

void Runtime::resetCartBootState() {
	m_cartBootPrepared = false;
	m_pendingCartBoot = false;
	setCartBootReadyFlag(false);
}

RuntimeState Runtime::captureCurrentState() const {
	RuntimeState state;
	state.ioMemory = m_memory.ioSlots();
	const_cast<CPU&>(m_cpu).syncGlobalSlotsToTable();
	state.globals = m_cpu.globals->entries();
	state.cartDataNamespace = m_api->cartDataNamespace();
	state.persistentData = m_api->persistentData();
	state.randomSeed = m_randomSeedValue;
	state.pendingEntryCall = m_pendingCall == PendingCall::Entry;
	state.assetMemory = m_memory.dumpAssetMemory();
	state.atlasSlots = m_vdp.atlasSlots();
	state.skyboxFaceIds = m_vdp.skyboxFaceIds();
	state.vdpDitherType = m_vdp.getDitherType();
	state.cyclesIntoFrame = getCyclesIntoFrame();
	state.inputSampleArmed = m_inputController.sampleArmed();
	return state;
}

void Runtime::applyState(const RuntimeState& state) {
	// Restore memory
	m_memory.loadIoSlots(state.ioMemory);
	m_geometryController.postLoad();
	m_irqController.postLoad();
	m_vdp.syncRegisters();
	clearHaltUntilIrq();
	m_inputController.restoreSampleArmed(state.inputSampleArmed);
	machineScheduler.reset(*this);
	screen.reset();
	resetSchedulerState();
	m_deviceScheduler.setNowCycles(state.cyclesIntoFrame);
	m_frameStartCycle = 0;
	m_vdp.resetStatus();
	m_vblankActive = false;
	m_activeTickCompleted = false;
	const bool vblankActive = (m_vblankStartCycle == 0)
		|| (getCyclesIntoFrame() >= m_vblankStartCycle);
	setVblankStatus(vblankActive);
	scheduleCurrentFrameTimers();
	refreshDeviceTimings(m_deviceScheduler.nowCycles());
	if (!state.assetMemory.empty()) {
		m_memory.restoreAssetMemory(state.assetMemory.data(), state.assetMemory.size());
	}
	m_api->restorePersistentData(state.cartDataNamespace, state.persistentData);
	m_randomSeedValue = state.randomSeed;
	m_pendingCall = state.pendingEntryCall ? PendingCall::Entry : PendingCall::None;
	applyAtlasSlotMapping(state.atlasSlots);
	if (state.skyboxFaceIds.has_value()) {
		m_vdp.setSkyboxImages(*state.skyboxFaceIds);
	} else {
		m_vdp.clearSkybox();
	}
	m_vdp.setDitherType(state.vdpDitherType);
	m_vdp.commitLiveVisualState();
	m_vdp.commitViewSnapshot(*EngineCore::instance().view());

	// Restore globals
	m_cpu.globals->clear();
	m_cpu.clearGlobalSlots();
	m_cpu.setProgram(m_program, m_programMetadata);
	for (const auto& [key, value] : state.globals) {
		m_cpu.setGlobalByKey(key, value);
	}
	flushAssetEdits();
	resetRenderBuffers();
}

void Runtime::applyAtlasSlotMapping(const std::array<i32, 2>& slots) {
	m_vdp.applyAtlasSlotMapping(slots);
}

void Runtime::setSkyboxImages(const SkyboxImageIds& ids) {
	m_vdp.setSkyboxImages(ids);
}

void Runtime::clearSkybox() {
	m_vdp.clearSkybox();
}

Value Runtime::getGlobal(std::string_view name) {
	return m_cpu.getGlobalByKey(canonicalizeIdentifier(name));
}

void Runtime::setGlobal(std::string_view name, const Value& value) {
	m_cpu.setGlobalByKey(canonicalizeIdentifier(name), value);
}

void Runtime::registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost) {
	auto nativeFn = m_cpu.createNativeFunction(name, std::move(fn), cost);
	m_cpu.setGlobalByKey(canonicalizeIdentifier(name), nativeFn);
}

void Runtime::setCanonicalization(CanonicalizationType canonicalization) {
	m_canonicalization = canonicalization;
}

void Runtime::setCpuHz(i64 hz) {
	m_cpuHz = hz;
	refreshDeviceTimings(m_deviceScheduler.currentNowCycles());
}

void Runtime::applyActiveMachineTiming(i64 cpuHz) {
	const MachineManifest& manifest = EngineCore::instance().machineManifest();
	const int cycleBudget = calcCyclesPerFrame(cpuHz, timing.ufpsScaled);
	const i64 vblankCycles = resolveVblankCycles(cpuHz, timing.ufpsScaled, manifest.viewportHeight);
	setCpuHz(cpuHz);
	setCycleBudgetPerFrame(cycleBudget);
	setVblankCycles(static_cast<int>(vblankCycles));
	setVdpWorkUnitsPerSec(static_cast<int>(manifest.vdpWorkUnitsPerSec.value_or(DEFAULT_VDP_WORK_UNITS_PER_SEC)));
	setGeoWorkUnitsPerSec(static_cast<int>(manifest.geoWorkUnitsPerSec.value_or(DEFAULT_GEO_WORK_UNITS_PER_SEC)));
}

void Runtime::setVblankCycles(int cycles) {
	if (cycles <= 0) {
		throw runtimeFault("vblank_cycles must be greater than 0.");
	}
	if (cycles > m_cycleBudgetPerFrame) {
		throw runtimeFault("vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	m_vblankCycles = cycles;
	m_vblankStartCycle = m_cycleBudgetPerFrame - m_vblankCycles;
	resetVblankState();
}

void Runtime::resetHardwareState() {
	m_irqController.reset();
	m_dmaController.reset();
	m_geometryController.reset();
	m_imgDecController.reset();
	m_inputController.reset();
	m_audioController.reset();
	m_vdp.initializeRegisters();
	resetVblankState();
	resetRenderBuffers();
}

void Runtime::resetRenderBuffers() {
	RenderQueues::clearBackQueues();
}

void Runtime::setVdpWorkUnitsPerSec(int workUnitsPerSec) {
	if (workUnitsPerSec <= 0) {
		throw runtimeFault("work_units_per_sec must be greater than 0.");
	}
	m_vdpWorkUnitsPerSec = workUnitsPerSec;
	m_vdp.setTiming(m_cpuHz, m_vdpWorkUnitsPerSec, m_deviceScheduler.currentNowCycles());
}

void Runtime::setGeoWorkUnitsPerSec(int workUnitsPerSec) {
	if (workUnitsPerSec <= 0) {
		throw runtimeFault("geo_work_units_per_sec must be greater than 0.");
	}
	m_geoWorkUnitsPerSec = workUnitsPerSec;
	m_geometryController.setTiming(m_cpuHz, m_geoWorkUnitsPerSec, m_deviceScheduler.currentNowCycles());
}

void Runtime::setTransferRates(i64 imgDecBytesPerSec, i64 dmaBytesPerSecIso, i64 dmaBytesPerSecBulk, int vdpWorkUnitsPerSec, int geoWorkUnitsPerSec) {
	m_imgDecBytesPerSec = imgDecBytesPerSec;
	m_dmaBytesPerSecIso = dmaBytesPerSecIso;
	m_dmaBytesPerSecBulk = dmaBytesPerSecBulk;
	setVdpWorkUnitsPerSec(vdpWorkUnitsPerSec);
	setGeoWorkUnitsPerSec(geoWorkUnitsPerSec);
	refreshDeviceTimings(m_deviceScheduler.currentNowCycles());
}

void Runtime::setCycleBudgetPerFrame(int budget) {
	if (budget == m_cycleBudgetPerFrame) {
		return;
	}
	m_cycleBudgetPerFrame = budget;
	setGlobal("sys_max_cycles_per_frame", valueNumber(static_cast<double>(budget)));
	refreshDeviceTimings(m_deviceScheduler.currentNowCycles());
	if (m_vblankCycles > 0) {
		if (m_vblankCycles > m_cycleBudgetPerFrame) {
			throw runtimeFault("vblank_cycles must be less than or equal to cycles_per_frame.");
		}
		m_vblankStartCycle = m_cycleBudgetPerFrame - m_vblankCycles;
		resetVblankState();
	}
}

bool Runtime::hasActiveTick() const {
	return m_frameActive && m_luaInitialized && m_tickEnabled && !m_runtimeFailed;
}

uint32_t Runtime::trackedRamUsedBytes() const {
	return m_resourceUsageDetector->ramUsedBytes();
}

uint32_t Runtime::trackedVramUsedBytes() const {
	return m_resourceUsageDetector->vramUsedBytes();
}

bool Runtime::isDrawPending() const {
	return hasEntryContinuation()
		|| m_runtimeFailed;
}

bool Runtime::hasEntryContinuation() const {
	return m_pendingCall == PendingCall::Entry;
}

void Runtime::refreshMemoryMap() {
	const auto engineRom = EngineCore::instance().engineRomView();
	if (engineRom.size > 0) {
		m_memory.setEngineRom(engineRom.data, engineRom.size);
	}
	const auto cartRom = EngineCore::instance().cartRomView();
	if (cartRom.size > 0) {
		m_memory.setCartRom(cartRom.data, cartRom.size);
	} else {
		m_memory.setCartRom(CART_ROM_EMPTY_HEADER.data(), CART_ROM_EMPTY_HEADER.size());
		InputMap emptyMapping;
		Input::instance().getPlayerInput(DEFAULT_KEYBOARD_PLAYER_INDEX)->setInputMap(emptyMapping);
	}
	refreshMemoryMapGlobals();
}

void Runtime::refreshMemoryMapGlobals() {
	setGlobal("sys_vram_system_atlas_base", valueNumber(static_cast<double>(VRAM_SYSTEM_ATLAS_BASE)));
	setGlobal("sys_vram_primary_atlas_base", valueNumber(static_cast<double>(VRAM_PRIMARY_ATLAS_BASE)));
	setGlobal("sys_vram_secondary_atlas_base", valueNumber(static_cast<double>(VRAM_SECONDARY_ATLAS_BASE)));
	setGlobal("sys_vram_framebuffer_base", valueNumber(static_cast<double>(VRAM_FRAMEBUFFER_BASE)));
	setGlobal("sys_vram_staging_base", valueNumber(static_cast<double>(VRAM_STAGING_BASE)));
	setGlobal("sys_vram_system_atlas_size", valueNumber(static_cast<double>(VRAM_SYSTEM_ATLAS_SIZE)));
	setGlobal("sys_vram_primary_atlas_size", valueNumber(static_cast<double>(VRAM_PRIMARY_ATLAS_SIZE)));
	setGlobal("sys_vram_secondary_atlas_size", valueNumber(static_cast<double>(VRAM_SECONDARY_ATLAS_SIZE)));
	setGlobal("sys_vram_framebuffer_size", valueNumber(static_cast<double>(VRAM_FRAMEBUFFER_SIZE)));
	setGlobal("sys_vram_staging_size", valueNumber(static_cast<double>(VRAM_STAGING_SIZE)));
	setGlobal("sys_vram_size", valueNumber(static_cast<double>(trackedVramTotalBytes())));
}

void Runtime::buildAssetMemory(RuntimeAssets& assets, bool keepDecodedData, AssetBuildMode mode) {
	if (mode == AssetBuildMode::Cart) {
		m_memory.resetCartAssets();
	} else {
		m_memory.resetAssetMemory();
	}
	m_vdp.registerImageAssets(assets, keepDecodedData);
	std::vector<const AudioAsset*> audioAssets;
	audioAssets.reserve(assets.audio.size());
	std::unordered_set<std::string> audioIdSet;
	audioIdSet.reserve(assets.audio.size());
	for (const auto& entry : assets.audio) {
		const auto& audioAsset = entry.second;
		audioAssets.push_back(&audioAsset);
		audioIdSet.insert(audioAsset.id);
	}
	std::sort(audioAssets.begin(), audioAssets.end(), [](const AudioAsset* lhs, const AudioAsset* rhs) {
		return lhs->id < rhs->id;
	});
	for (const auto* audioAsset : audioAssets) {
		const std::string& id = audioAsset->id;
		if (m_memory.hasAsset(id)) {
			continue;
		}
		m_memory.registerAudioMeta(
			id,
			static_cast<uint32_t>(audioAsset->sampleRate),
			static_cast<uint32_t>(audioAsset->channels),
			static_cast<uint32_t>(audioAsset->bitsPerSample),
			static_cast<uint32_t>(audioAsset->frames),
			static_cast<uint32_t>(audioAsset->dataOffset),
			static_cast<uint32_t>(audioAsset->dataSize)
		);
	}

	m_memory.finalizeAssetTable();
	m_memory.markAllAssetsDirty();
}

void Runtime::restoreVramSlotTextures() {
	m_vdp.restoreVramSlotTextures();
}

void Runtime::captureVramTextureSnapshots() {
	m_vdp.captureVramTextureSnapshots();
}

void Runtime::flushAssetEdits() {
	m_vdp.flushAssetEdits();
}

Value Runtime::canonicalizeIdentifier(std::string_view value) {
	if (m_canonicalization == CanonicalizationType::None) {
		return valueString(m_cpu.internString(value));
	}
	std::string result(value);
	if (m_canonicalization == CanonicalizationType::Upper) {
		for (char& ch : result) {
			ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
		}
		return valueString(m_cpu.internString(result));
	}
	for (char& ch : result) {
		ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
	}
	return valueString(m_cpu.internString(result));
}

std::vector<Value> Runtime::acquireValueScratch() {
	if (!m_valueScratchPool.empty()) {
		auto scratch = std::move(m_valueScratchPool.back());
		m_valueScratchPool.pop_back();
		scratch.clear();
		return scratch;
	}
	return {};
}

void Runtime::releaseValueScratch(std::vector<Value>&& values) {
	values.clear();
	if (m_valueScratchPool.size() < MAX_POOLED_RUNTIME_SCRATCH) {
		m_valueScratchPool.push_back(std::move(values));
	}
}



void Runtime::executeUpdateCallback() {
	try {
		while (true) {
			if (m_cpu.isHaltedUntilIrq() && runHaltedUntilIrq(m_frameState)) {
				return;
			}
			if (m_clearBackQueuesAfterIrqWake) {
				RenderQueues::clearBackQueues();
				m_clearBackQueuesAfterIrqWake = false;
			}
			if (!hasEntryContinuation()) {
				return;
			}
			RunResult result = runWithBudget();
			if (m_cpu.isHaltedUntilIrq()) {
				if (runHaltedUntilIrq(m_frameState)) {
					return;
				}
				continue;
			}
			if (result == RunResult::Halted) {
				m_pendingCall = PendingCall::None;
			}
			return;
		}
	} catch (const std::exception& e) {
		handleLuaError(e.what());
	}
}

} // namespace bmsx
