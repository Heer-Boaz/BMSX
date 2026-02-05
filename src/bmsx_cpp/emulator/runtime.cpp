#include "runtime.h"
#include "api.h"
#include "io.h"
#include "program_loader.h"
#include "../core/engine_core.h"
#include "../rompack/rompack.h"
#include "../input/input.h"
#include "../render/shared/render_queues.h"
#include "../render/texturemanager.h"
#include "../utils/clamp.h"
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
#include <sstream>
#include <stdexcept>
#include <unordered_set>
#include <vector>

namespace bmsx {
namespace {
inline double to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
}

#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wpedantic"
#elif defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
#endif
using i128 = __int128_t;
#if defined(__clang__)
#pragma clang diagnostic pop
#elif defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

constexpr size_t CART_ROM_HEADER_SIZE = 32;
constexpr std::array<u8, CART_ROM_HEADER_SIZE> CART_ROM_EMPTY_HEADER = {};
}

uint32_t Runtime::RateBudget::calcBytesForCycles(i64 cpuHz, i64 cycles) {
	const i128 numerator = static_cast<i128>(bytesPerSec) * static_cast<i128>(cycles)
		+ static_cast<i128>(carry);
	const i64 out = static_cast<i64>(numerator / cpuHz);
	carry = static_cast<i64>(numerator % cpuHz);
	const i64 maxValue = static_cast<i64>(std::numeric_limits<uint32_t>::max());
	const i64 clamped = out > maxValue ? maxValue : out;
	return static_cast<uint32_t>(clamped);
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

namespace {

constexpr int kBootLogFrames = 8;
int s_updateLogRemaining = 0;
int s_drawLogRemaining = 0;

} // namespace

Runtime& Runtime::createInstance(const RuntimeOptions& options) {
	if (s_instance) {
		throw BMSX_RUNTIME_ERROR("[Runtime] Instance already exists.");
	}
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
	: m_memory()
	, m_vdp(m_memory)
	, m_stringHandles(m_memory)
	, m_cpu(m_memory, &m_stringHandles)
	, m_dmaController(m_memory, [this](uint32_t mask) { raiseIrqFlags(mask); })
	, m_imgDecController(m_memory, m_dmaController, [this](uint32_t mask) { raiseIrqFlags(mask); })
	, m_playerIndex(options.playerIndex)
	, m_viewport(options.viewport)
	, m_canonicalization(options.canonicalization)
	, m_cpuHz(options.cpuHz)
	, m_cycleBudgetPerFrame(options.cycleBudgetPerFrame)
{
	// Initialize I/O memory region
	m_memory.clearIoSlots();
	// Write pointer starts at 0
	m_memory.writeValue(IO_WRITE_PTR_ADDR, valueNumber(0.0));
	// System flags
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_ACK, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_DST, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_DST, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CAP, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(0.0));
	m_dmaController.reset();
	m_imgDecController.reset();
	m_vdp.attachImgDecController(m_imgDecController);
	m_memory.writeValue(IO_VDP_PRIMARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_memory.writeValue(IO_VDP_SECONDARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_memory.writeValue(IO_VDP_RD_SURFACE, valueNumber(0.0));
	m_memory.writeValue(IO_VDP_RD_X, valueNumber(0.0));
	m_memory.writeValue(IO_VDP_RD_Y, valueNumber(0.0));
	m_memory.writeValue(IO_VDP_RD_MODE, valueNumber(static_cast<double>(VDP_RD_MODE_RGBA8888)));
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(0.0));
	m_vdp.initializeRegisters();
	setVblankCycles(options.vblankCycles);
	m_randomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
	refreshMemoryMap();
	m_cpu.setExternalRootMarker([this](GcHeap& heap) {
		for (const auto& entry : m_moduleCache) {
			heap.markValue(entry.second);
		}
		heap.markObject(m_updateFn);
		heap.markObject(m_drawFn);
		heap.markObject(m_initFn);
		heap.markObject(m_newGameFn);
		heap.markObject(m_irqFn);
		heap.markValue(m_ipairsIterator);
	});

	// Create API instance
	m_api = std::make_unique<Api>(*this);

	// Setup builtin functions
	setupBuiltins();
	m_api->registerAllFunctions();
}

Runtime::~Runtime() {
	m_api.reset();
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

void Runtime::boot(Program* program, ProgramMetadata* metadata, int entryProtoIndex) {
	std::cout << "[Runtime] boot: program=" << program << " entryProtoIndex=" << entryProtoIndex << std::endl;
	std::cout << "[Runtime] boot: module protos=" << m_moduleProtos.size()
				<< " aliases=" << m_moduleAliases.size() << std::endl;
	resetFrameState();
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	m_updateFn = nullptr;
	m_drawFn = nullptr;
	m_initFn = nullptr;
	m_newGameFn = nullptr;
	m_irqFn = nullptr;
	m_engineUpdateFn = nullptr;
	m_engineDrawFn = nullptr;
	m_engineResetFn = nullptr;
	m_pendingLifecycleQueue.clear();
	m_pendingLifecycleIndex = 0;
	m_pendingEntryLifecycle.reset();
	m_cpu.globals->clear();
	m_memory.clearIoSlots();
	m_memory.writeValue(IO_WRITE_PTR_ADDR, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_ACK, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_DST, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_DMA_WRITTEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_DST, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CAP, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(0.0));
	m_dmaController.reset();
	m_imgDecController.reset();
	m_memory.writeValue(IO_VDP_PRIMARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_memory.writeValue(IO_VDP_SECONDARY_ATLAS_ID, valueNumber(static_cast<double>(VDP_ATLAS_ID_NONE)));
	m_vdp.initializeRegisters();
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(0.0));
	resetVblankState();
	m_randomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
	setupBuiltins();
	m_api->registerAllFunctions();
	m_program = program;
	m_programMetadata = metadata;
	m_cpu.setProgram(program, metadata);
	runEngineBuiltinPrelude();
	s_updateLogRemaining = kBootLogFrames;
	s_drawLogRemaining = kBootLogFrames;

	// Start execution at entry point
	std::cout << "[Runtime] boot: starting CPU at entry point..." << std::endl;
	m_cpu.start(entryProtoIndex);
	m_pendingCall = PendingCall::Entry;
	queueLifecycleHandlers(true, true);
	m_luaInitialized = true;
	std::cout << "[Runtime] boot: runtime initialized!" << std::endl;
}

void Runtime::setCartBootReadyFlag(bool value) {
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(value ? 1.0 : 0.0));
}

void Runtime::prepareCartBootIfNeeded() {
	if (!isEngineProgramActive()) {
		return;
	}
	const RuntimeAssets& assets = EngineCore::instance().assets();
	if (!assets.programAsset) {
		return;
	}
	if (m_cartBootPrepared) {
		return;
	}
	setCartBootReadyFlag(false);
	m_cartBootPrepared = true;
	setCartBootReadyFlag(true);
}

bool Runtime::pollSystemBootRequest() {
	if (!isEngineProgramActive()) {
		return false;
	}
	if (asNumber(m_memory.readValue(IO_SYS_BOOT_CART)) == 0.0) {
		return false;
	}
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	EngineCore::instance().resetLoadedRom();
	return true;
}

void Runtime::advanceHardware(int cycles) {
	if (cycles <= 0) {
		return;
	}
	// Hardware advances in discrete steps; interrupt sources raised in the same step are observed together.
	const i64 cycleCount = static_cast<i64>(cycles);
	const uint32_t imgBudget = m_imgRate.calcBytesForCycles(m_cpuHz, cycleCount);
	const uint32_t isoBudget = m_dmaIsoRate.calcBytesForCycles(m_cpuHz, cycleCount);
	const uint32_t bulkBudget = m_dmaBulkRate.calcBytesForCycles(m_cpuHz, cycleCount);
	m_imgDecController.setDecodeBudget(imgBudget);
	m_dmaController.setChannelBudgets(isoBudget, bulkBudget);
	m_dmaController.tick();
	m_imgDecController.tick();
	advanceVblank(cycles);
}

void Runtime::advanceVblank(int cycles) {
	int remaining = cycles;
	while (remaining > 0) {
		const int frameRemaining = m_cycleBudgetPerFrame - m_cyclesIntoFrame;
		const int step = remaining < frameRemaining ? remaining : frameRemaining;
		const int previous = m_cyclesIntoFrame;
		m_cyclesIntoFrame += step;
		if (!m_vblankActive && previous < m_vblankStartCycle && m_cyclesIntoFrame >= m_vblankStartCycle) {
			enterVblank();
		}
		remaining -= step;
		if (m_cyclesIntoFrame >= m_cycleBudgetPerFrame) {
			m_cyclesIntoFrame = 0;
			if (m_vblankStartCycle == 0) {
				raiseIrqFlags(IRQ_VBLANK);
			} else if (m_vblankActive) {
				// Defer clear until the VBLANK IRQ handler has a chance to observe the status.
				m_vblankPendingClear = true;
			}
		}
	}
}

void Runtime::resetVblankState() {
	m_cyclesIntoFrame = 0;
	m_vblankActive = false;
	m_vblankPendingClear = false;
	m_vblankClearOnIrqEnd = false;
	m_vdpStatus = 0;
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
	if (m_vblankStartCycle == 0) {
		setVblankStatus(true);
	}
}

void Runtime::setVblankStatus(bool active) {
	if (m_vblankActive == active) {
		return;
	}
	m_vblankActive = active;
	if (active) {
		m_vdpStatus |= VDP_STATUS_VBLANK;
	} else {
		m_vdpStatus &= ~VDP_STATUS_VBLANK;
	}
	m_memory.writeValue(IO_VDP_STATUS, valueNumber(static_cast<double>(m_vdpStatus)));
}

void Runtime::enterVblank() {
	// IRQ flags are level/pending; multiple VBLANK edges while pending coalesce.
	setVblankStatus(true);
	raiseIrqFlags(IRQ_VBLANK);
}

void Runtime::resetTransferCarry() {
	m_imgRate.resetCarry();
	m_dmaIsoRate.resetCarry();
	m_dmaBulkRate.resetCarry();
}

void Runtime::raiseIrqFlags(uint32_t mask) {
	const uint32_t current = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IRQ_FLAGS)));
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(static_cast<double>(current | mask)));
}

bool Runtime::dispatchIrqFlags() {
	const uint32_t ack = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IRQ_ACK)));
	uint32_t flags = static_cast<uint32_t>(asNumber(m_memory.readValue(IO_IRQ_FLAGS)));
	if (ack != 0) {
		flags &= ~ack;
		m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(static_cast<double>(flags)));
		m_memory.writeValue(IO_IRQ_ACK, valueNumber(0.0));
		if ((ack & IRQ_VBLANK) != 0 && m_vblankPendingClear) {
			setVblankStatus(false);
			m_vblankPendingClear = false;
			m_vblankClearOnIrqEnd = false;
		}
	}
	if (flags == 0) {
		return false;
	}
	if ((flags & IRQ_VBLANK) != 0 && m_vblankPendingClear) {
		m_vblankClearOnIrqEnd = true;
	}
	m_cpu.call(m_irqFn, { valueNumber(static_cast<double>(flags)) }, 0);
	m_pendingCall = PendingCall::Irq;
	RunResult result = runWithBudget();
	processIOCommands();
	if (result == RunResult::Halted) {
		m_pendingCall = PendingCall::None;
		if (m_vblankClearOnIrqEnd) {
			setVblankStatus(false);
			m_vblankPendingClear = false;
			m_vblankClearOnIrqEnd = false;
		}
	}
	return m_pendingCall == PendingCall::Irq;
}

RunResult Runtime::runWithBudget() {
	const int budgetBefore = m_frameState.cycleBudgetRemaining;
	RunResult result = m_cpu.run(budgetBefore);
	const int remaining = m_cpu.instructionBudgetRemaining;
	const int consumed = budgetBefore - remaining;
	m_frameState.cycleBudgetRemaining = remaining;
	if (consumed > 0) {
		advanceHardware(consumed);
	}
	return result;
}

void Runtime::cacheLifecycleHandlers() {
	// Cache callback functions (use Lua-style names: update, draw, init, new_game)
	Value updateVal = m_cpu.globals->get(canonicalizeIdentifier("update"));
	if (valueIsClosure(updateVal)) {
		m_updateFn = asClosure(updateVal);
		std::cout << "[Runtime] boot: found update" << std::endl;
	}

	Value drawVal = m_cpu.globals->get(canonicalizeIdentifier("draw"));
	if (valueIsClosure(drawVal)) {
		m_drawFn = asClosure(drawVal);
		std::cout << "[Runtime] boot: found draw" << std::endl;
	}

	Value initVal = m_cpu.globals->get(canonicalizeIdentifier("init"));
	if (valueIsClosure(initVal)) {
		m_initFn = asClosure(initVal);
		std::cout << "[Runtime] boot: found init" << std::endl;
	}

	Value newGameVal = m_cpu.globals->get(canonicalizeIdentifier("new_game"));
	if (valueIsClosure(newGameVal)) {
		m_newGameFn = asClosure(newGameVal);
		std::cout << "[Runtime] boot: found new_game" << std::endl;
	}
	Value irqVal = m_cpu.globals->get(canonicalizeIdentifier("irq"));
	if (valueIsClosure(irqVal)) {
		m_irqFn = asClosure(irqVal);
		std::cout << "[Runtime] boot: found irq" << std::endl;
	}
	auto* engineModule = asTable(requireModule("engine"));
	Value engineUpdateVal = engineModule->get(canonicalizeIdentifier("update"));
	if (valueIsClosure(engineUpdateVal)) {
		m_engineUpdateFn = asClosure(engineUpdateVal);
	}
	Value engineDrawVal = engineModule->get(canonicalizeIdentifier("draw"));
	if (valueIsClosure(engineDrawVal)) {
		m_engineDrawFn = asClosure(engineDrawVal);
	}
	Value engineResetVal = engineModule->get(canonicalizeIdentifier("reset"));
	if (valueIsClosure(engineResetVal)) {
		m_engineResetFn = asClosure(engineResetVal);
	}
}

void Runtime::queueLifecycleHandlers(bool runInit, bool runNewGame) {
	m_pendingLifecycleQueue.clear();
	m_pendingLifecycleIndex = 0;
	m_pendingEntryLifecycle.reset();
	if (m_pendingCall == PendingCall::Entry) {
		m_pendingEntryLifecycle = PendingEntryLifecycle{runInit, runNewGame};
		return;
	}
	if (runInit) {
		if (!m_initFn) {
			throw BMSX_RUNTIME_ERROR("[Runtime] Runtime lifecycle handler 'init' is not defined.");
		}
		m_pendingLifecycleQueue.push_back(PendingCall::Init);
	}
	if (runNewGame) {
		if (!m_engineResetFn) {
			throw BMSX_RUNTIME_ERROR("[Runtime] Runtime lifecycle handler 'engine.reset' is not defined.");
		}
		if (!m_newGameFn) {
			throw BMSX_RUNTIME_ERROR("[Runtime] Runtime lifecycle handler 'new_game' is not defined.");
		}
		m_pendingLifecycleQueue.push_back(PendingCall::NewGameReset);
		m_pendingLifecycleQueue.push_back(PendingCall::NewGame);
	}
	if (m_pendingCall == PendingCall::None) {
		startNextLifecycleCall();
	}
}

void Runtime::startNextLifecycleCall() {
	if (m_pendingCall != PendingCall::None) {
		return;
	}
	if (m_pendingLifecycleIndex >= m_pendingLifecycleQueue.size()) {
		return;
	}
	const PendingCall next = m_pendingLifecycleQueue[m_pendingLifecycleIndex++];
	if (next == PendingCall::Init) {
		m_cpu.call(m_initFn, {}, 0);
		m_pendingCall = PendingCall::Init;
		return;
	}
	if (next == PendingCall::NewGameReset) {
		m_cpu.call(m_engineResetFn, {}, 0);
		m_pendingCall = PendingCall::NewGameReset;
		return;
	}
	m_cpu.call(m_newGameFn, {}, 0);
	m_pendingCall = PendingCall::NewGame;
}

bool Runtime::runLifecyclePhase() {
	const bool lifecyclePending = (m_pendingCall == PendingCall::Init)
		|| (m_pendingCall == PendingCall::NewGameReset)
		|| (m_pendingCall == PendingCall::NewGame);
	if (!lifecyclePending && m_pendingLifecycleIndex >= m_pendingLifecycleQueue.size()) {
		return false;
	}
	if (!lifecyclePending && m_pendingCall != PendingCall::None) {
		return false;
	}
	bool ranLifecycle = false;
	while (true) {
		if (m_pendingCall == PendingCall::None) {
			startNextLifecycleCall();
			if (m_pendingCall == PendingCall::None) {
				break;
			}
		}
		ranLifecycle = true;
		RunResult result = runWithBudget();
		processIOCommands();
		if (result != RunResult::Halted) {
			break;
		}
		m_pendingCall = PendingCall::None;
	}
	return ranLifecycle;
}

void Runtime::tickUpdate() {
	if (!m_luaInitialized || !m_tickEnabled || m_runtimeFailed) {
		return;
	}

	prepareCartBootIfNeeded();
	if (pollSystemBootRequest()) {
		return;
	}

	const auto isUpdatePhasePending = [this]() {
		const bool lifecycleQueued = m_pendingLifecycleIndex < m_pendingLifecycleQueue.size();
		return m_pendingCall == PendingCall::Entry
			|| m_pendingCall == PendingCall::Update
			|| m_pendingCall == PendingCall::EngineUpdate
			|| m_pendingCall == PendingCall::Init
			|| m_pendingCall == PendingCall::NewGameReset
			|| m_pendingCall == PendingCall::NewGame
			|| m_pendingCall == PendingCall::Irq
			|| lifecycleQueued;
	};

	if (m_frameActive) {
		if (isUpdatePhasePending()) {
			executeUpdateCallback(m_frameState.deltaSeconds);
			flushAssetEdits();
			m_frameState.updateExecuted = !isUpdatePhasePending();
		}
		return;
	}

	const auto frameNow = std::chrono::steady_clock::now();
	if (!m_debugFrameReportInitialized) {
		m_debugFrameReportInitialized = true;
		m_debugFrameReportAt = frameNow;
	}
	m_debugTickYieldsBefore = m_debugRunYieldsTotal;

	m_frameActive = true;
	m_lastTickCompleted = false;
	m_lastTickBudgetRemaining = 0;

	const int carryBudget = m_pendingCarryBudget;
	m_pendingCarryBudget = 0;
	m_frameState.updateExecuted = false;
	m_frameState.cycleBudgetRemaining = m_cycleBudgetPerFrame + carryBudget;
	m_frameState.cycleBudgetGranted = m_cycleBudgetPerFrame + carryBudget;
	m_frameState.cycleCarryGranted = carryBudget;
	m_frameState.deltaSeconds = static_cast<float>(EngineCore::instance().deltaTime());
	m_vdp.beginFrame();
	auto* gameTable = asTable(m_cpu.globals->get(canonicalizeIdentifier("game")));
	gameTable->set(canonicalizeIdentifier("deltatime_seconds"), valueNumber(static_cast<double>(m_frameState.deltaSeconds)));
	gameTable->set(canonicalizeIdentifier("deltatime"), valueNumber(static_cast<double>(m_frameState.deltaSeconds) * 1000.0));
	auto* viewportTable = asTable(gameTable->get(canonicalizeIdentifier("viewportsize")));
	auto viewSize = EngineCore::instance().view()->viewportSize;
	viewportTable->set(canonicalizeIdentifier("x"), valueNumber(static_cast<double>(viewSize.x)));
	viewportTable->set(canonicalizeIdentifier("y"), valueNumber(static_cast<double>(viewSize.y)));
	auto* viewTable = asTable(gameTable->get(canonicalizeIdentifier("view")));
	auto* view = EngineCore::instance().view();
	const Value viewCrtKey = canonicalizeIdentifier("crt_postprocessing_enabled");
	const Value viewNoiseKey = canonicalizeIdentifier("enable_noise");
	const Value viewColorBleedKey = canonicalizeIdentifier("enable_colorbleed");
	const Value viewScanlinesKey = canonicalizeIdentifier("enable_scanlines");
	const Value viewBlurKey = canonicalizeIdentifier("enable_blur");
	const Value viewGlowKey = canonicalizeIdentifier("enable_glow");
	const Value viewFringingKey = canonicalizeIdentifier("enable_fringing");
	const Value viewApertureKey = canonicalizeIdentifier("enable_aperture");
	viewTable->set(viewCrtKey, valueBool(view->crt_postprocessing_enabled));
	viewTable->set(viewNoiseKey, valueBool(view->applyNoise));
	viewTable->set(viewColorBleedKey, valueBool(view->applyColorBleed));
	viewTable->set(viewScanlinesKey, valueBool(view->applyScanlines));
	viewTable->set(viewBlurKey, valueBool(view->applyBlur));
	viewTable->set(viewGlowKey, valueBool(view->applyGlow));
	viewTable->set(viewFringingKey, valueBool(view->applyFringing));
	viewTable->set(viewApertureKey, valueBool(view->applyAperture));

	// Call _update if present
	executeUpdateCallback(m_frameState.deltaSeconds);

	auto readViewBool = [](Value value, const char* field) -> bool {
		if (!valueIsBool(value)) {
			throw BMSX_RUNTIME_ERROR(std::string("game.view.") + field + " must be boolean.");
		}
		return valueToBool(value);
	};
	view->crt_postprocessing_enabled = readViewBool(viewTable->get(viewCrtKey), "crt_postprocessing_enabled");
	view->applyNoise = readViewBool(viewTable->get(viewNoiseKey), "enable_noise");
	view->applyColorBleed = readViewBool(viewTable->get(viewColorBleedKey), "enable_colorbleed");
	view->applyScanlines = readViewBool(viewTable->get(viewScanlinesKey), "enable_scanlines");
	view->applyBlur = readViewBool(viewTable->get(viewBlurKey), "enable_blur");
	view->applyGlow = readViewBool(viewTable->get(viewGlowKey), "enable_glow");
	view->applyFringing = readViewBool(viewTable->get(viewFringingKey), "enable_fringing");
	view->applyAperture = readViewBool(viewTable->get(viewApertureKey), "enable_aperture");

	m_debugUpdateCountTotal += 1;
	m_frameState.updateExecuted = !isUpdatePhasePending();
	flushAssetEdits();
}

void Runtime::tickDraw() {
	if (!m_luaInitialized || !m_tickEnabled || m_runtimeFailed) {
		return;
	}

	if (!m_frameActive) {
		api().playbackRenderQueue(m_preservedRenderQueue);
		return;
	}

	// Call _draw if present
	m_vdp.commitViewSnapshot(*EngineCore::instance().view());
	executeDrawCallback();
	if (m_pendingCall != PendingCall::None) {
		return;
	}

	m_lastTickBudgetRemaining = m_frameState.cycleBudgetRemaining;
	m_lastTickCompleted = true;
	m_lastTickSequence += 1;

	m_frameActive = false;
}

void Runtime::tickIdeInput() {
	// IDE input handling - stub for now
}

void Runtime::tickIDE() {
	// IDE update - stub for now
	flushAssetEdits();
}

void Runtime::tickIDEDraw() {
	// IDE draw - stub for now
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

void Runtime::processIOCommands() {
	// Get write pointer
	m_vdp.syncRegisters();
	int writePtr = static_cast<int>(asNumber(m_memory.readValue(IO_WRITE_PTR_ADDR)));
	if (writePtr <= 0) {
		return;
	}

	// Process each command
	for (int i = 0; i < writePtr && i < IO_COMMAND_CAPACITY; ++i) {
		int cmdBase = IO_BUFFER_BASE + i * IO_COMMAND_STRIDE;
		int cmd = static_cast<int>(asNumber(m_memory.readValue(cmdBase)));

		switch (cmd) {
			case IO_CMD_PRINT: {
				Value arg = m_memory.readValue(cmdBase + IO_ARG0_OFFSET);
				std::cout << valueToString(arg) << '\n';
				break;
			}
			default:
				throw BMSX_RUNTIME_ERROR("Unknown IO command: " + std::to_string(cmd) + ".");
		}
	}

	// Reset write pointer
	m_memory.writeValue(IO_WRITE_PTR_ADDR, valueNumber(0.0));
}

void Runtime::requestProgramReload() {
	// Mark for reload - actual reload happens in the appropriate phase
	m_luaInitialized = false;
	resetFrameState();
}

void Runtime::resetFrameState() {
	m_frameActive = false;
	m_frameState = FrameState{};
	m_pendingCarryBudget = 0;
	m_lastTickCompleted = false;
	m_lastTickBudgetRemaining = 0;
	m_lastTickSequence = 0;
	m_lastTickConsumedSequence = 0;
	resetVblankState();
}

void Runtime::resetCartBootState() {
	m_cartBootPrepared = false;
	setCartBootReadyFlag(false);
}

RuntimeState Runtime::captureCurrentState() const {
	RuntimeState state;
	state.ioMemory = m_memory.ioSlots();
	state.globals = m_cpu.globals->entries();
	state.assetMemory = m_memory.dumpAssetMemory();
	state.atlasSlots = m_vdp.atlasSlots();
	state.skyboxFaceIds = m_vdp.skyboxFaceIds();
	state.cyclesIntoFrame = m_cyclesIntoFrame;
	state.vblankPendingClear = m_vblankPendingClear;
	state.vblankClearOnIrqEnd = m_vblankClearOnIrqEnd;
	return state;
}

void Runtime::applyState(const RuntimeState& state) {
	// Restore memory
	m_memory.loadIoSlots(state.ioMemory);
	m_vdp.syncRegisters();
	m_cyclesIntoFrame = state.cyclesIntoFrame;
	m_vblankPendingClear = state.vblankPendingClear;
	m_vblankClearOnIrqEnd = state.vblankClearOnIrqEnd;
	const bool vblankActive = (m_vblankStartCycle == 0)
		|| m_vblankPendingClear
		|| (m_cyclesIntoFrame >= m_vblankStartCycle);
	setVblankStatus(vblankActive);
	if (!state.assetMemory.empty()) {
		m_memory.restoreAssetMemory(state.assetMemory.data(), state.assetMemory.size());
	}
	applyAtlasSlotMapping(state.atlasSlots);
	if (state.skyboxFaceIds.has_value()) {
		m_vdp.setSkyboxImages(*state.skyboxFaceIds);
	} else {
		m_vdp.clearSkybox();
	}

	// Restore globals
	m_cpu.globals->clear();
	for (const auto& [key, value] : state.globals) {
		m_cpu.globals->set(key, value);
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
	return m_cpu.globals->get(canonicalizeIdentifier(name));
}

void Runtime::setGlobal(std::string_view name, const Value& value) {
	m_cpu.globals->set(canonicalizeIdentifier(name), value);
}

void Runtime::registerNativeFunction(std::string_view name, NativeFunctionInvoke fn) {
	auto nativeFn = m_cpu.createNativeFunction(name, std::move(fn));
	m_cpu.globals->set(canonicalizeIdentifier(name), nativeFn);
}

void Runtime::setCanonicalization(CanonicalizationType canonicalization) {
	m_canonicalization = canonicalization;
}

void Runtime::setCpuHz(i64 hz) {
	m_cpuHz = hz;
	resetTransferCarry();
}

void Runtime::setVblankCycles(int cycles) {
	if (cycles <= 0) {
		throw BMSX_RUNTIME_ERROR("[Runtime] vblank_cycles must be greater than 0.");
	}
	if (cycles > m_cycleBudgetPerFrame) {
		throw BMSX_RUNTIME_ERROR("[Runtime] vblank_cycles must be less than or equal to cycles_per_frame.");
	}
	m_vblankCycles = cycles;
	m_vblankStartCycle = m_cycleBudgetPerFrame - m_vblankCycles;
	resetVblankState();
}

void Runtime::resetHardwareState() {
	m_memory.writeValue(IO_IRQ_FLAGS, valueNumber(0.0));
	m_memory.writeValue(IO_IRQ_ACK, valueNumber(0.0));
	m_dmaController.reset();
	m_imgDecController.reset();
	resetVblankState();
	resetRenderBuffers();
}

void Runtime::resetRenderBuffers() {
	RenderQueues::clearBackQueues();
	RenderQueues::beginSpriteQueue();
	RenderQueues::beginMeshQueue();
	RenderQueues::beginParticleQueue();
}

void Runtime::setTransferRates(i64 imgDecBytesPerSec, i64 dmaBytesPerSecIso, i64 dmaBytesPerSecBulk) {
	m_imgDecBytesPerSec = imgDecBytesPerSec;
	m_dmaBytesPerSecIso = dmaBytesPerSecIso;
	m_dmaBytesPerSecBulk = dmaBytesPerSecBulk;
	m_imgRate.setBytesPerSec(imgDecBytesPerSec);
	m_dmaIsoRate.setBytesPerSec(dmaBytesPerSecIso);
	m_dmaBulkRate.setBytesPerSec(dmaBytesPerSecBulk);
	resetTransferCarry();
}

void Runtime::setCycleBudgetPerFrame(int budget) {
	if (budget == m_cycleBudgetPerFrame) {
		return;
	}
	m_cycleBudgetPerFrame = budget;
	setGlobal("sys_max_cycles_per_frame", valueNumber(static_cast<double>(budget)));
	resetTransferCarry();
	if (m_vblankCycles > 0) {
		if (m_vblankCycles > m_cycleBudgetPerFrame) {
			throw BMSX_RUNTIME_ERROR("[Runtime] vblank_cycles must be less than or equal to cycles_per_frame.");
		}
		m_vblankStartCycle = m_cycleBudgetPerFrame - m_vblankCycles;
		resetVblankState();
	}
}

void Runtime::grantCycleBudget(int baseBudget, int carryBudget) {
	setCycleBudgetPerFrame(baseBudget);
	const int totalBudget = baseBudget + carryBudget;
	if (hasActiveTick()) {
		m_frameState.cycleBudgetRemaining += totalBudget;
		m_frameState.cycleBudgetGranted += totalBudget;
		return;
	}
	if (carryBudget != 0) {
		m_pendingCarryBudget = carryBudget;
	}
}

bool Runtime::hasActiveTick() const {
	return m_frameActive && m_luaInitialized && m_tickEnabled && !m_runtimeFailed;
}

bool Runtime::consumeLastTickCompletion(i64& outSequence, int& outRemaining) {
	if (!m_lastTickCompleted) {
		return false;
	}
	if (m_lastTickSequence == m_lastTickConsumedSequence) {
		return false;
	}
	m_lastTickConsumedSequence = m_lastTickSequence;
	outSequence = m_lastTickSequence;
	outRemaining = m_lastTickBudgetRemaining;
	return true;
}

bool Runtime::isDrawPending() const {
	const bool lifecycleQueued = m_pendingLifecycleIndex < m_pendingLifecycleQueue.size();
	return m_pendingCall == PendingCall::Entry
		|| m_pendingCall == PendingCall::Update
		|| m_pendingCall == PendingCall::EngineUpdate
		|| m_pendingCall == PendingCall::Init
		|| m_pendingCall == PendingCall::NewGameReset
		|| m_pendingCall == PendingCall::NewGame
		|| m_pendingCall == PendingCall::Irq
		|| m_pendingCall == PendingCall::Draw
		|| m_pendingCall == PendingCall::EngineDraw
		|| lifecycleQueued
		|| m_runtimeFailed;
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
	setGlobal("sys_vram_staging_base", valueNumber(static_cast<double>(VRAM_STAGING_BASE)));
	setGlobal("sys_vram_system_atlas_size", valueNumber(static_cast<double>(VRAM_SYSTEM_ATLAS_SIZE)));
	setGlobal("sys_vram_primary_atlas_size", valueNumber(static_cast<double>(VRAM_PRIMARY_ATLAS_SIZE)));
	setGlobal("sys_vram_secondary_atlas_size", valueNumber(static_cast<double>(VRAM_SECONDARY_ATLAS_SIZE)));
	setGlobal("sys_vram_staging_size", valueNumber(static_cast<double>(VRAM_STAGING_SIZE)));
}

void Runtime::buildAssetMemory(RuntimeAssets& assets, bool keepDecodedData, AssetBuildMode mode) {
	if (mode == AssetBuildMode::Cart) {
		m_memory.resetCartAssets();
	} else {
		m_memory.resetAssetMemory();
	}
	m_vdp.registerImageAssets(assets, keepDecodedData);
	const RuntimeAssets* fallback = assets.fallback;
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
		if (audioAsset->bytes.empty()) {
			m_memory.registerAudioMeta(
				id,
				static_cast<uint32_t>(audioAsset->sampleRate),
				static_cast<uint32_t>(audioAsset->channels),
				static_cast<uint32_t>(audioAsset->bitsPerSample),
				static_cast<uint32_t>(audioAsset->frames),
				static_cast<uint32_t>(audioAsset->dataOffset),
				static_cast<uint32_t>(audioAsset->dataSize)
			);
			continue;
		}
		m_memory.registerAudioBuffer(
			id,
			audioAsset->bytes.data(),
			audioAsset->bytes.size(),
			static_cast<uint32_t>(audioAsset->sampleRate),
			static_cast<uint32_t>(audioAsset->channels),
			static_cast<uint32_t>(audioAsset->bitsPerSample),
			static_cast<uint32_t>(audioAsset->frames),
			static_cast<uint32_t>(audioAsset->dataOffset),
			static_cast<uint32_t>(audioAsset->dataSize)
		);
	}
	if (fallback) {
		std::vector<const AudioAsset*> fallbackAssets;
		fallbackAssets.reserve(fallback->audio.size());
		for (const auto& entry : fallback->audio) {
			const auto& audioAsset = entry.second;
			if (audioIdSet.find(audioAsset.id) != audioIdSet.end()) {
				continue;
			}
			fallbackAssets.push_back(&audioAsset);
		}
		std::sort(fallbackAssets.begin(), fallbackAssets.end(), [](const AudioAsset* lhs, const AudioAsset* rhs) {
			return lhs->id < rhs->id;
		});
		for (const auto* audioAsset : fallbackAssets) {
			const std::string& id = audioAsset->id;
			if (m_memory.hasAsset(id)) {
				continue;
			}
			if (audioAsset->bytes.empty()) {
				m_memory.registerAudioMeta(
					id,
					static_cast<uint32_t>(audioAsset->sampleRate),
					static_cast<uint32_t>(audioAsset->channels),
					static_cast<uint32_t>(audioAsset->bitsPerSample),
					static_cast<uint32_t>(audioAsset->frames),
					static_cast<uint32_t>(audioAsset->dataOffset),
					static_cast<uint32_t>(audioAsset->dataSize)
				);
				continue;
			}
			m_memory.registerAudioBuffer(
				id,
				audioAsset->bytes.data(),
				audioAsset->bytes.size(),
				static_cast<uint32_t>(audioAsset->sampleRate),
				static_cast<uint32_t>(audioAsset->channels),
				static_cast<uint32_t>(audioAsset->bitsPerSample),
				static_cast<uint32_t>(audioAsset->frames),
				static_cast<uint32_t>(audioAsset->dataOffset),
				static_cast<uint32_t>(audioAsset->dataSize)
			);
		}
	}

	m_memory.finalizeAssetTable();
	m_memory.markAllAssetsDirty();
}

void Runtime::uploadAtlasTextures() {
	m_vdp.uploadAtlasTextures();
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



void Runtime::executeUpdateCallback(double deltaSeconds) {
	bool shouldRunEngineUpdate = (m_updateFn == nullptr);
	if (m_pendingCall == PendingCall::Entry) {
		RunResult result = runWithBudget();
		processIOCommands();
		if (result == RunResult::Halted) {
			m_pendingCall = PendingCall::None;
			cacheLifecycleHandlers();
			const auto pendingLifecycle = m_pendingEntryLifecycle;
			m_pendingEntryLifecycle.reset();
			if (pendingLifecycle.has_value()) {
				queueLifecycleHandlers(pendingLifecycle->runInit, pendingLifecycle->runNewGame);
			}
		}
		return;
	}
	if (m_pendingCall == PendingCall::EngineUpdate) {
		RunResult result = runWithBudget();
		processIOCommands();
		if (result == RunResult::Halted) {
			m_pendingCall = PendingCall::None;
		}
		return;
	}
	if (m_pendingCall == PendingCall::Irq) {
		RunResult result = runWithBudget();
		processIOCommands();
		if (result == RunResult::Halted) {
			m_pendingCall = PendingCall::None;
			if (m_vblankClearOnIrqEnd) {
				setVblankStatus(false);
				m_vblankPendingClear = false;
				m_vblankClearOnIrqEnd = false;
			}
		}
		return;
	}
	const bool lifecycleQueued = m_pendingLifecycleIndex < m_pendingLifecycleQueue.size();
	if (m_pendingCall == PendingCall::Init
		|| m_pendingCall == PendingCall::NewGameReset
		|| m_pendingCall == PendingCall::NewGame
		|| (m_pendingCall == PendingCall::None && lifecycleQueued)) {
		if (runLifecyclePhase()) {
			return;
		}
	}
	if (m_pendingCall != PendingCall::None && m_pendingCall != PendingCall::Update) {
		return;
	}

	double runMs = 0.0;
	double engineMs = 0.0;
	double ioMs = 0.0;

	try {
		if (m_pendingCall == PendingCall::None) {
			if (dispatchIrqFlags()) {
				return;
			}
		}
		if (m_updateFn) {
			if (m_pendingCall == PendingCall::None) {
				m_cpu.call(m_updateFn, {valueNumber(deltaSeconds)}, 0);
				m_pendingCall = PendingCall::Update;
			}
			const auto runStart = std::chrono::steady_clock::now();
			RunResult result = runWithBudget();
			const auto runEnd = std::chrono::steady_clock::now();
			runMs += to_ms(runEnd - runStart);
			const auto ioStart = std::chrono::steady_clock::now();
			processIOCommands();
			const auto ioEnd = std::chrono::steady_clock::now();
			ioMs += to_ms(ioEnd - ioStart);
			if (result == RunResult::Halted) {
				m_pendingCall = PendingCall::None;
				shouldRunEngineUpdate = true;
			}
		}
		if (shouldRunEngineUpdate) {
			const double deltaMs = deltaSeconds * 1000.0;
			m_cpu.call(m_engineUpdateFn, {valueNumber(deltaMs)}, 0);
			m_pendingCall = PendingCall::EngineUpdate;
			const auto engineStart = std::chrono::steady_clock::now();
			RunResult result = runWithBudget();
			const auto engineEnd = std::chrono::steady_clock::now();
			engineMs += to_ms(engineEnd - engineStart);
			const auto ioStart = std::chrono::steady_clock::now();
			processIOCommands();
			const auto ioEnd = std::chrono::steady_clock::now();
			ioMs += to_ms(ioEnd - ioStart);
			if (result == RunResult::Halted) {
				m_pendingCall = PendingCall::None;
			}
		}
	} catch (const std::exception& e) {
		std::cerr << "[Runtime] Error in update: " << e.what() << std::endl;
		logLuaCallStack();
		m_pendingCall = PendingCall::None;
		m_pendingLifecycleQueue.clear();
		m_pendingLifecycleIndex = 0;
		m_pendingEntryLifecycle.reset();
		m_frameActive = false;
		m_runtimeFailed = true;
	}
}

void Runtime::executeDrawCallback() {
	bool shouldRunEngineDraw = (m_drawFn == nullptr);
	const bool lifecycleQueued = m_pendingLifecycleIndex < m_pendingLifecycleQueue.size();
	if (lifecycleQueued) {
		api().playbackRenderQueue(m_preservedRenderQueue);
		return;
	}
	if (m_pendingCall == PendingCall::Irq) {
		api().playbackRenderQueue(m_preservedRenderQueue);
		return;
	}
	if (m_pendingCall == PendingCall::EngineDraw) {
		if (!api().isFrameCaptureActive()) {
			api().beginFrameCapture();
		}
		RunResult result = runWithBudget();
		processIOCommands();
		if (result == RunResult::Halted) {
			m_pendingCall = PendingCall::None;
			api().commitFrameCapture();
			const auto& captured = RenderQueues::copyRenderQueueForPlayback();
			m_preservedRenderQueue.assign(captured.begin(), captured.end());
		} else {
			api().playbackRenderQueue(m_preservedRenderQueue);
		}
		return;
	}
	if (m_pendingCall != PendingCall::None && m_pendingCall != PendingCall::Draw) {
		api().playbackRenderQueue(m_preservedRenderQueue);
		return;
	}

	// const auto drawStart = std::chrono::steady_clock::now();
	double runMs = 0.0;
	double engineMs = 0.0;
	double ioMs = 0.0;

	try {
		if (!api().isFrameCaptureActive()) {
			api().beginFrameCapture();
		}
		if (m_drawFn) {
			if (m_pendingCall == PendingCall::None) {
				m_cpu.call(m_drawFn, {}, 0);
				m_pendingCall = PendingCall::Draw;
			}
			const auto runStart = std::chrono::steady_clock::now();
			RunResult result = m_cpu.run(m_frameState.cycleBudgetRemaining);
			m_frameState.cycleBudgetRemaining = m_cpu.instructionBudgetRemaining;
			const auto runEnd = std::chrono::steady_clock::now();
			runMs += to_ms(runEnd - runStart);
			const auto ioStart = std::chrono::steady_clock::now();
			processIOCommands();
			const auto ioEnd = std::chrono::steady_clock::now();
			ioMs += to_ms(ioEnd - ioStart);
			if (result == RunResult::Halted) {
				m_pendingCall = PendingCall::None;
				shouldRunEngineDraw = true;
			}
		}
		if (shouldRunEngineDraw) {
			m_cpu.call(m_engineDrawFn, {}, 0);
			m_pendingCall = PendingCall::EngineDraw;
			const auto engineStart = std::chrono::steady_clock::now();
			RunResult result = runWithBudget();
			const auto engineEnd = std::chrono::steady_clock::now();
			engineMs += to_ms(engineEnd - engineStart);
			const auto ioStart = std::chrono::steady_clock::now();
			processIOCommands();
			const auto ioEnd = std::chrono::steady_clock::now();
			ioMs += to_ms(ioEnd - ioStart);
			if (result == RunResult::Halted) {
				m_pendingCall = PendingCall::None;
			}
		}
		if (m_pendingCall == PendingCall::None) {
			api().commitFrameCapture();
			const auto& captured = RenderQueues::copyRenderQueueForPlayback();
			m_preservedRenderQueue.assign(captured.begin(), captured.end());
		} else {
			api().playbackRenderQueue(m_preservedRenderQueue);
		}
	} catch (const std::exception& e) {
		api().abandonFrameCapture();
		api().playbackRenderQueue(m_preservedRenderQueue);
		std::cerr << "[Runtime] Error in draw: " << e.what() << std::endl;
		logLuaCallStack();
		m_pendingCall = PendingCall::None;
		m_pendingLifecycleQueue.clear();
		m_pendingLifecycleIndex = 0;
		m_pendingEntryLifecycle.reset();
		m_frameActive = false;
		m_runtimeFailed = true;
	}
}

} // namespace bmsx
