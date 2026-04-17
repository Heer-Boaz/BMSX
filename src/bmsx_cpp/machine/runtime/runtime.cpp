#include "machine/runtime/runtime.h"
#include "machine/firmware/firmware_api.h"
#include "machine/bus/io.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/program/program_loader.h"
#include "machine/runtime/resource_usage_detector.h"
#include "machine/runtime/runtime_engine_irq.h"
#include "machine/runtime/runtime_timing_config.h"
#include "core/engine_core.h"
#include "rompack/rompack.h"
#include "input/input.h"
#include "render/texturemanager.h"
#include <array>
#include <cctype>
#include <stdexcept>

namespace bmsx {
namespace {
inline std::runtime_error runtimeFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("Runtime fault: " + message);
}

constexpr size_t CART_ROM_HEADER_SIZE = 72;
constexpr std::array<u8, CART_ROM_HEADER_SIZE> CART_ROM_EMPTY_HEADER = {};

}

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
	: timing(options.ufpsScaled, options.cpuHz, options.cycleBudgetPerFrame)
	, m_api(std::make_unique<Api>(*this))
	, m_machine(*m_api, *EngineCore::instance().soundMaster())
	, m_viewport(options.viewport)
	, m_canonicalization(options.canonicalization)
	{
	timing.vdpWorkUnitsPerSec = options.vdpWorkUnitsPerSec;
	timing.geoWorkUnitsPerSec = options.geoWorkUnitsPerSec;
	m_api->initializeRuntimeKeys();
	m_machine.memory().clearIoSlots();
	m_machine.initializeSystemIo();
	m_machine.resetDevices();
	vblank.setVblankCycles(*this, options.vblankCycles);
	setVdpWorkUnitsPerSec(*this, options.vdpWorkUnitsPerSec);
	setGeoWorkUnitsPerSec(*this, options.geoWorkUnitsPerSec);
	m_randomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
	refreshMemoryMap();
	m_machine.cpu().setExternalRootMarker([this](GcHeap& heap) {
		for (const auto& entry : m_moduleCache) {
			heap.markValue(entry.second);
		}
		heap.markValue(m_pairsIterator);
		heap.markValue(m_ipairsIterator);
		m_api->markRoots(heap);
	});

	configureLuaHeapUsage({
		.collect = [this]() {
			m_machine.cpu().collectHeap();
		},
		.getBaseRamUsedBytes = [this]() {
			return static_cast<size_t>(m_machine.resourceUsageDetector().baseRamUsedBytes());
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
	frameLoop.resetFrameState(*this);
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	cartBoot.reset(*this);
	m_hostFaultMessage.reset();
	m_moduleCache.clear();
	m_machine.cpu().clearGlobalSlots();
	m_machine.cpu().globals->clear();
	m_machine.memory().clearIoSlots();
	m_machine.initializeSystemIo();
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
		m_machine.cpu().setProgram(program, metadata);
		runEngineBuiltinPrelude();
		enforceLuaHeapBudget();

		m_machine.cpu().start(entryProtoIndex);
		enforceLuaHeapBudget();
		m_pendingCall = PendingCall::Entry;
		queueLifecycleHandlers(true, true);
		m_luaInitialized = true;
	} catch (const std::exception& e) {
		handleLuaError(e.what());
	}
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
		raiseEngineIrq(*this, mask);
	}
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
	m_machine.vdp().flushAssetEdits();
}

void Runtime::tickTerminalModeDraw() {
	// Terminal mode draw - stub for now
}

void Runtime::requestProgramReload() {
	// Reboot is executed on the next update boundary so the active Lua call can unwind first.
	m_rebootRequested = true;
	m_luaInitialized = false;
	frameLoop.resetFrameState(*this);
}

RuntimeState Runtime::captureCurrentState() const {
	RuntimeState state;
	state.machine = m_machine.captureState();
	const_cast<CPU&>(m_machine.cpu()).syncGlobalSlotsToTable();
	state.globals = m_machine.cpu().globals->entries();
	state.cartDataNamespace = m_api->cartDataNamespace();
	state.persistentData = m_api->persistentData();
	state.randomSeed = m_randomSeedValue;
	state.pendingEntryCall = m_pendingCall == PendingCall::Entry;
	state.cyclesIntoFrame = vblank.capture(*this).cyclesIntoFrame;
	return state;
}

void Runtime::applyState(const RuntimeState& state) {
	m_machine.restoreState(state.machine);
	vblank.restore(*this, RuntimeVblankSnapshot{state.cyclesIntoFrame});
	m_api->restorePersistentData(state.cartDataNamespace, state.persistentData);
	m_randomSeedValue = state.randomSeed;
	m_pendingCall = state.pendingEntryCall ? PendingCall::Entry : PendingCall::None;

	// Restore globals
	m_machine.cpu().globals->clear();
	m_machine.cpu().clearGlobalSlots();
	m_machine.cpu().setProgram(m_program, m_programMetadata);
	for (const auto& [key, value] : state.globals) {
		m_machine.cpu().setGlobalByKey(key, value);
	}
	m_machine.vdp().flushAssetEdits();
	m_machine.resetRenderBuffers();
}

Value Runtime::getGlobal(std::string_view name) {
	return m_machine.cpu().getGlobalByKey(canonicalizeIdentifier(name));
}

void Runtime::setGlobal(std::string_view name, const Value& value) {
	m_machine.cpu().setGlobalByKey(canonicalizeIdentifier(name), value);
}

void Runtime::registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost) {
	auto nativeFn = m_machine.cpu().createNativeFunction(name, std::move(fn), cost);
	m_machine.cpu().setGlobalByKey(canonicalizeIdentifier(name), nativeFn);
}

void Runtime::setCanonicalization(CanonicalizationType canonicalization) {
	m_canonicalization = canonicalization;
}

void Runtime::resetHardwareState() {
	m_machine.resetDevices();
	vblank.reset(*this);
	m_machine.resetRenderBuffers();
}

uint32_t Runtime::trackedRamUsedBytes() const {
	return m_machine.resourceUsageDetector().ramUsedBytes();
}

uint32_t Runtime::trackedVramUsedBytes() const {
	return m_machine.resourceUsageDetector().vramUsedBytes();
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
		m_machine.memory().setEngineRom(engineRom.data, engineRom.size);
	}
	const auto cartRom = EngineCore::instance().cartRomView();
	if (cartRom.size > 0) {
		m_machine.memory().setCartRom(cartRom.data, cartRom.size);
	} else {
		m_machine.memory().setCartRom(CART_ROM_EMPTY_HEADER.data(), CART_ROM_EMPTY_HEADER.size());
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

void Runtime::restoreVramSlotTextures() {
	m_machine.vdp().restoreVramSlotTextures();
}

void Runtime::captureVramTextureSnapshots() {
	m_machine.vdp().captureVramTextureSnapshots();
}

Value Runtime::canonicalizeIdentifier(std::string_view value) {
	if (m_canonicalization == CanonicalizationType::None) {
		return valueString(m_machine.cpu().internString(value));
	}
	std::string result(value);
	if (m_canonicalization == CanonicalizationType::Upper) {
		for (char& ch : result) {
			ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
		}
		return valueString(m_machine.cpu().internString(result));
	}
	for (char& ch : result) {
		ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
	}
	return valueString(m_machine.cpu().internString(result));
}

} // namespace bmsx
