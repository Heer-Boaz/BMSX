#include "machine/runtime/runtime.h"
#include "machine/firmware/api.h"
#include "machine/firmware/devtools.h"
#include "machine/runtime/game/view_state.h"
#include "machine/bus/io.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/program/loader.h"
#include "machine/runtime/resource_usage_detector.h"
#include "machine/runtime/engine_irq.h"
#include "render/runtime/state.h"
#include "render/shared/queues.h"
#include "machine/runtime/timing/config.h"
#include "core/engine.h"
#include "rompack/format.h"
#include "input/manager.h"
#include <array>
#include <stdexcept>

namespace bmsx {
namespace {
constexpr size_t CART_ROM_HEADER_SIZE = 72;
constexpr std::array<u8, CART_ROM_HEADER_SIZE> CART_ROM_EMPTY_HEADER = {};

}

// Static instance pointer
Runtime* Runtime::s_instance = nullptr;

Runtime& Runtime::createInstance(const RuntimeOptions& options) {
	if (s_instance) {
		throw BMSX_RUNTIME_ERROR("instance already exists.");
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
	, m_systemAssets(options.systemAssets)
	, m_activeAssets(options.activeAssets)
	, m_cartAssets(options.cartAssets)
	, m_engineRom(options.engineRom)
	, m_cartRom(options.cartRom)
	, m_machineManifest(options.machineManifest)
	, m_clock(EngineCore::instance().clock())
	, m_api(std::make_unique<Api>(*this))
	, m_machine(*m_api, *EngineCore::instance().soundMaster(), *EngineCore::instance().platform()->microtaskQueue(), VdpFrameBufferSize{
		static_cast<uint32_t>(options.viewport.x),
		static_cast<uint32_t>(options.viewport.y)
	})
	, m_viewport(options.viewport)
	{
	initializeGameViewStateFromHost(m_gameViewState, *EngineCore::instance().view());
	m_api->initializeRuntimeKeys();
	m_machine.memory().clearIoSlots();
	m_machine.initializeSystemIo();
	m_machine.resetDevices();
	vblank.setVblankCycles(*this, options.vblankCycles);
	setRenderWorkUnitsPerSec(*this, options.vdpWorkUnitsPerSec, options.geoWorkUnitsPerSec);
	m_randomSeedValue = static_cast<uint32_t>(m_clock->now());
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
			const auto& usage = m_machine.resourceUsageDetector();
			return static_cast<size_t>(
				IO_REGION_SIZE
					+ (STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE)
					+ usage.m_stringHandles.usedHeapBytes()
					+ usage.m_memory.usedAssetTableBytes()
					+ usage.m_memory.usedAssetDataBytes()
			);
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

const CartManifest* Runtime::cartManifest() const {
	if (!m_cartAssets || !m_cartAssets->cartManifest) {
		return nullptr;
	}
	return &*m_cartAssets->cartManifest;
}

const std::string* Runtime::cartEntryPath() const {
	if (!m_cartAssets) {
		return nullptr;
	}
	return &m_cartAssets->entryPoint;
}

const std::string* Runtime::cartProjectRootPath() const {
	if (!m_cartAssets) {
		return nullptr;
	}
	return &m_cartAssets->projectRootPath;
}

void Runtime::setRuntimeEnvironment(
	RuntimeAssets& systemAssets,
	RuntimeAssets& activeAssets,
	const MachineManifest& machineManifest,
	RuntimeAssets* cartAssets,
	RuntimeOptions::RomSpan engineRom,
	RuntimeOptions::RomSpan cartRom
) {
	m_systemAssets = &systemAssets;
	m_activeAssets = &activeAssets;
	m_machineManifest = &machineManifest;
	m_cartAssets = cartAssets;
	m_engineRom = engineRom;
	m_cartRom = cartRom;
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
	boot(asset.program.get(), metadata, asset.entryProtoIndex, &asset.staticModulePaths);
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
	m_randomSeedValue = static_cast<uint32_t>(m_clock->now());
}

void Runtime::boot(Program* program, ProgramMetadata* metadata, int entryProtoIndex, const std::vector<std::string>* staticModulePaths) {
	try {
		setupBuiltins();
		m_api->registerAllFunctions();
		registerRuntimeDevtoolsTable(*this);
		enforceLuaHeapBudget();
		m_program = program;
		m_programMetadata = metadata;
		m_machine.cpu().setProgram(program, metadata);
		runEngineBuiltinPrelude();
		if (staticModulePaths) {
			runStaticModuleInitializers(*staticModulePaths);
		}
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
	const uint32_t mask = (runInit ? IRQ_REINIT : 0u) | (runNewGame ? IRQ_NEWGAME : 0u);
	if (mask != 0) {
		raiseEngineIrq(*this, mask);
	}
}

void Runtime::requestProgramReload() {
	// Reboot is executed on the next update boundary so the active Lua call can unwind first.
	m_rebootRequested = true;
	m_luaInitialized = false;
	frameLoop.resetFrameState(*this);
}

// disable-next-line single_line_method_pattern -- runtime global writes keep CPU string-key encoding inside Runtime.
void Runtime::setGlobal(std::string_view name, const Value& value) {
	m_machine.cpu().setGlobalByKey(valueString(m_machine.cpu().internString(name)), value);
}

void Runtime::registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost) {
	const auto nativeFn = m_machine.cpu().createNativeFunction(name, std::move(fn), cost);
	m_machine.cpu().setGlobalByKey(valueString(m_machine.cpu().internString(name)), nativeFn);
}

void Runtime::resetHardwareState() {
	m_machine.resetDevices();
	vblank.reset(*this);
	resetRuntimeRenderState();
	RenderQueues::clearBackQueues();
}

void Runtime::refreshMemoryMap() {
	if (m_engineRom.size > 0) {
		m_machine.memory().setEngineRom(m_engineRom.data, m_engineRom.size);
	}
	if (m_cartRom.size > 0) {
		m_machine.memory().setCartRom(m_cartRom.data, m_cartRom.size);
	} else {
		m_machine.memory().setCartRom(CART_ROM_EMPTY_HEADER.data(), CART_ROM_EMPTY_HEADER.size());
		InputMap emptyMapping;
		Input::instance().getPlayerInput(DEFAULT_KEYBOARD_PLAYER_INDEX)->setInputMap(emptyMapping);
	}
	refreshMemoryMapGlobals();
}

void Runtime::refreshMemoryMapGlobals() {
	setGlobal("sys_vram_system_textpage_base", valueNumber(static_cast<double>(VRAM_SYSTEM_TEXTPAGE_BASE)));
	setGlobal("sys_vram_primary_textpage_base", valueNumber(static_cast<double>(VRAM_PRIMARY_TEXTPAGE_BASE)));
	setGlobal("sys_vram_secondary_textpage_base", valueNumber(static_cast<double>(VRAM_SECONDARY_TEXTPAGE_BASE)));
	setGlobal("sys_vram_framebuffer_base", valueNumber(static_cast<double>(VRAM_FRAMEBUFFER_BASE)));
	setGlobal("sys_vram_staging_base", valueNumber(static_cast<double>(VRAM_STAGING_BASE)));
	setGlobal("sys_vram_system_textpage_size", valueNumber(static_cast<double>(VRAM_SYSTEM_TEXTPAGE_SIZE)));
	setGlobal("sys_vram_primary_textpage_size", valueNumber(static_cast<double>(VRAM_PRIMARY_TEXTPAGE_SIZE)));
	setGlobal("sys_vram_secondary_textpage_size", valueNumber(static_cast<double>(VRAM_SECONDARY_TEXTPAGE_SIZE)));
	setGlobal("sys_vram_framebuffer_size", valueNumber(static_cast<double>(VRAM_FRAMEBUFFER_SIZE)));
	setGlobal("sys_vram_staging_size", valueNumber(static_cast<double>(VRAM_STAGING_SIZE)));
	setGlobal("sys_vram_size", valueNumber(static_cast<double>(m_machine.vdp().trackedTotalVramBytes())));
}

} // namespace bmsx
