#include "machine/runtime/runtime.h"
#include "common/utf8.h"
#include "machine/bus/io.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/memory/map.h"
#include "machine/model_registry.h"
#include "machine/program/linker.h"
#include "machine/runtime/input.h"
#include "machine/runtime/timing/config.h"
#include "rompack/format.h"
#include "rompack/loader.h"
#include <array>
#include <iostream>
#include <stdexcept>
#include <utility>

namespace bmsx {
namespace {
constexpr std::array<u8, CART_ROM_HEADER_SIZE> CART_ROM_EMPTY_HEADER = {};

} // namespace

Runtime::Runtime(
	const RuntimeOptions& options,
	RuntimeInputSource& input,
	MicrotaskQueue& microtasks
)
	: timing(
		options.ufpsScaled,
		options.cpuHz,
		options.cycleBudgetPerFrame,
		options.machineRegionWord,
		getMachineRegionTimingForWord(options.machineRegionWord).totalScanlines,
		options.imgDecBytesPerSec,
		options.dmaBytesPerSecIso,
		options.dmaBytesPerSecBulk,
		options.vdpWorkUnitsPerSec,
		options.geoWorkUnitsPerSec
	)
	, m_systemRomBytes(options.systemRomBytes)
	, m_cartRomBytes(options.cartRomBytes)
	, m_input(input)
	, m_machineManifest(options.machineManifest)
	, m_memory(MemoryInit{
		{ options.systemRomBytes.data, options.systemRomBytes.size },
		options.cartRomBytes.size > 0
			? MemoryInit::RomSpan{ options.cartRomBytes.data, options.cartRomBytes.size }
			: MemoryInit::RomSpan{ CART_ROM_EMPTY_HEADER.data(), CART_ROM_EMPTY_HEADER.size() },
		{}
	})
	, machine(
		m_memory,
		VdpFrameBufferSize{ static_cast<uint32_t>(options.viewport.x), static_cast<uint32_t>(options.viewport.y) },
		input,
		microtasks
	)
	, hostFault(*this)
{
	configureLuaHeapUsage({});
	resetTrackedLuaHeapBytes();
	input.setRuntimeInputFrameDurationMs(timing.frameDurationMs);
	machine.memory.clearIoSlots();
	machine.memory.mapIoRead(IO_SYS_TIME_MS, this, &Runtime::onTimeMsReadThunk);
	machine.memory.mapIoRead(IO_SYS_FRAME_MS, this, &Runtime::onFrameMsReadThunk);
	machine.memory.mapIoRead(IO_SYS_REGION, this, &Runtime::onMachineRegionReadThunk);
	machine.memory.mapIoRead(IO_SYS_CYCLES_PER_FRAME, this, &Runtime::onCyclesPerFrameReadThunk);
	machine.memory.mapIoWrite(IO_SYS_REGION, this, &Runtime::onMachineRegionWriteThunk);
	machine.memory.mapIoWrite(IO_SYS_PRINT_CHAR, this, &Runtime::onLuaOutputCodepointWriteThunk);
	machine.memory.mapIoWrite(IO_SYS_PRINT_FLUSH, this, &Runtime::onLuaOutputFlushWriteThunk);
	machine.memory.mapIoWrite(IO_VDP_MODE, this, &Runtime::onVdpModeWriteThunk);
	machine.initializeSystemIo();
	machine.resetDevices();
	vblank.setVblankCycles(*this, options.vblankCycles);
	refreshDeviceTimings(*this, machine.scheduler.currentNowCycles());
	machine.cpu.setExternalRootMarker([this](GcHeap& heap) {
		for (const auto& entry : m_moduleCache) {
			heap.markValue(entry.second);
		}
	});

	configureLuaHeapUsage({
		.collect = [this]() {
			machine.cpu.collectHeap();
		},
		.getBaseRamUsedBytes = [this]() {
			return static_cast<size_t>(baseRamUsedBytes());
		},
	});

}

Runtime::~Runtime() {
	configureLuaHeapUsage({});
	resetTrackedLuaHeapBytes();
}

auto Runtime::machineTimeMs() const -> uint32_t {
	const uint64_t cycles = static_cast<uint64_t>(machine.scheduler.currentNowCycles());
	const uint64_t cpuHz = static_cast<uint64_t>(timing.cpuHz);
	return static_cast<uint32_t>((cycles / cpuHz) * 1000ULL + ((cycles % cpuHz) * 1000ULL) / cpuHz);
}

auto Runtime::machineElapsedMs() const -> f64 {
	return static_cast<f64>(machine.scheduler.currentNowCycles()) * 1000.0 / static_cast<f64>(timing.cpuHz);
}

Value Runtime::onTimeMsReadThunk(void* context, uint32_t addr) {
	const auto* runtime = static_cast<Runtime*>(context);
	return runtime->onTimeMsRead(addr);
}

Value Runtime::onTimeMsRead([[maybe_unused]] uint32_t addr) const {
	return valueNumber(static_cast<double>(machineTimeMs()));
}

Value Runtime::onFrameMsReadThunk(void* context, uint32_t addr) {
	const auto* runtime = static_cast<Runtime*>(context);
	return runtime->onFrameMsRead(addr);
}

Value Runtime::onFrameMsRead([[maybe_unused]] uint32_t addr) const {
	return valueNumber(timing.frameDurationMs);
}

Value Runtime::onMachineRegionReadThunk(void* context, uint32_t addr) {
	const auto* runtime = static_cast<Runtime*>(context);
	return runtime->onMachineRegionRead(addr);
}

Value Runtime::onMachineRegionRead([[maybe_unused]] uint32_t addr) const {
	return valueNumber(static_cast<double>(timing.regionWord));
}

Value Runtime::onCyclesPerFrameReadThunk(void* context, uint32_t addr) {
	const auto* runtime = static_cast<Runtime*>(context);
	return runtime->onCyclesPerFrameRead(addr);
}

Value Runtime::onCyclesPerFrameRead([[maybe_unused]] uint32_t addr) const {
	return valueNumber(static_cast<double>(timing.cycleBudgetPerFrame));
}

void Runtime::onMachineRegionWriteThunk(void* context, uint32_t addr, Value value) {
	auto* runtime = static_cast<Runtime*>(context);
	(void)addr;
	runtime->applyMachineRegionWord(toU32(value));
}

void Runtime::onVdpModeWriteThunk(void* context, uint32_t addr, Value value) {
	auto* runtime = static_cast<Runtime*>(context);
	(void)addr;
	runtime->applyVdpModeWord(toU32(value));
}

void Runtime::onLuaOutputCodepointWriteThunk(void* context, uint32_t addr, Value value) {
	auto* runtime = static_cast<Runtime*>(context);
	(void)addr;
	appendUtf8Codepoint(runtime->luaOutputLineBuffer, toU32(value));
}

void Runtime::onLuaOutputFlushWriteThunk(void* context, uint32_t addr, Value value) {
	auto* runtime = static_cast<Runtime*>(context);
	runtime->onLuaOutputFlushWrite(addr, value);
}

void Runtime::onLuaOutputFlushWrite([[maybe_unused]] uint32_t addr, [[maybe_unused]] Value value) {
	luaOutputLines.push_back(luaOutputLineBuffer);
	luaOutputLineBuffer.clear();
}

void Runtime::applyUfpsScaled(i64 ufpsScaled) {
	timing.ufpsScaled = ufpsScaled;
	timing.ufps = static_cast<f64>(ufpsScaled) / static_cast<f64>(HZ_SCALE);
	timing.frameDurationMs = 1000.0 / timing.ufps;
	m_input.setRuntimeInputFrameDurationMs(timing.frameDurationMs);
}

void Runtime::applyMachineRegionWord(uint32_t regionWord) {
	const MachineRegionTiming regionTiming = getMachineRegionTimingForWord(regionWord);
	timing.regionWord = regionWord;
	timing.totalScanlines = regionTiming.totalScanlines;
	applyUfpsScaled(regionTiming.refreshUfpsScaled);
	setFrameTiming(
		*this,
		timing.cpuHz,
		static_cast<int>(calcCyclesPerFrameScaled(timing.cpuHz, regionTiming.refreshUfpsScaled)),
		static_cast<int>(resolveVblankCycles(timing.cpuHz, regionTiming.refreshUfpsScaled, regionTiming.totalScanlines, machine.vdp.frameBufferHeight()))
	);
}

void Runtime::applyVdpModeWord(uint32_t modeWord) {
	machine.vdp.writeModeWord(modeWord);
	const MachineRegionTiming regionTiming = getMachineRegionTimingForWord(timing.regionWord);
	setFrameTiming(
		*this,
		timing.cpuHz,
		timing.cycleBudgetPerFrame,
		static_cast<int>(resolveVblankCycles(timing.cpuHz, regionTiming.refreshUfpsScaled, regionTiming.totalScanlines, machine.vdp.frameBufferHeight()))
	);
}

uint32_t Runtime::baseRamUsedBytes() const {
	return BASE_RAM_USED_SIZE;
}

uint32_t Runtime::ramUsedBytes() const {
	return baseRamUsedBytes() + static_cast<uint32_t>(trackedLuaHeapBytes());
}

uint32_t Runtime::ramTotalBytes() const {
	return RAM_SIZE;
}

uint32_t Runtime::vramUsedBytes() const {
	return machine.vdp.trackedUsedVramBytes();
}

uint32_t Runtime::vramTotalBytes() const {
	return machine.vdp.trackedTotalVramBytes();
}

const CartManifest* Runtime::cartManifest() const {
	if (!m_cartRomPackage || !m_cartRomPackage->cartManifest) {
		return nullptr;
	}
	return &*m_cartRomPackage->cartManifest;
}

const std::string* Runtime::cartEntryPath() const {
	if (!m_cartRomPackage || m_cartRomBytes.size == 0) {
		return nullptr;
	}
	return &m_cartRomPackage->entryPoint;
}

const std::string* Runtime::cartProjectRootPath() const {
	if (!m_cartRomPackage || m_cartRomBytes.size == 0) {
		return nullptr;
	}
	return &m_cartRomPackage->projectRootPath;
}

RuntimeRomPackage& Runtime::activeRom() {
	return *m_activeRomPackage;
}

const RuntimeRomPackage& Runtime::activeRom() const {
	return *m_activeRomPackage;
}

RuntimeRomPackage& Runtime::systemRom() {
	return *m_systemRomPackage;
}

const RuntimeRomPackage& Runtime::systemRom() const {
	return *m_systemRomPackage;
}

RuntimeRomPackage* Runtime::cartRom() {
	return m_cartRomPackage;
}

const RuntimeRomPackage* Runtime::cartRom() const {
	return m_cartRomPackage;
}

void Runtime::setRuntimeEnvironment(
	const MachineManifest& machineManifest,
	RuntimeOptions::RomSpan systemRomBytes,
	RuntimeOptions::RomSpan cartRomBytes,
	RuntimeRomPackage& activeRom,
	RuntimeRomPackage& systemRom,
	RuntimeRomPackage* cartRom
) {
	m_machineManifest = &machineManifest;
	m_systemRomBytes = systemRomBytes;
	m_cartRomBytes = cartRomBytes;
	m_activeRomPackage = &activeRom;
	m_systemRomPackage = &systemRom;
	m_cartRomPackage = cartRom;
}

void Runtime::setLinkedCartVectors(ProgramVectorTable vectors, uint32_t dataBaseAddress, uint32_t bssBaseAddress, std::vector<std::string> staticModulePaths) {
	m_cartVectors = vectors;
	m_cartDataBaseAddress = dataBaseAddress;
	m_cartBssBaseAddress = bssBaseAddress;
	m_cartStaticModulePaths = std::move(staticModulePaths);
}

void Runtime::enterSystemFirmware() {
	m_cartProgramStarted = false;
	m_activeRomPackage = m_systemRomPackage;
}

void Runtime::enterCartProgram() {
	if (!m_cartRomPackage) {
		throw std::runtime_error("cannot enter cart program: cart ROM is not configured.");
	}
	m_cartProgramStarted = true;
	m_activeRomPackage = m_cartRomPackage;
}

void Runtime::startCartProgram() {
	if (!m_cartVectors) {
		throw std::runtime_error("cannot start cart: no cart vector table is loaded.");
	}
	if (!m_cartDataBaseAddress) {
		throw std::runtime_error("cannot start cart: no cart data base is loaded.");
	}
	if (!m_cartBssBaseAddress) {
		throw std::runtime_error("cannot start cart: no cart bss base is loaded.");
	}
	enterCartProgram();
	startLoadedProgram(*m_cartVectors, std::span<const std::string>{}, m_cartStaticModulePaths);
}

void Runtime::boot(const ProgramImage& image, ProgramMetadata* metadata, ProgramVectorTable vectors, uint32_t dataBaseAddress, uint32_t bssBaseAddress, std::span<const std::string> systemStaticModulePaths, std::span<const std::string> cartStaticModulePaths) {
	m_moduleCache.clear();
	m_programStorage = inflateExecutableProgramImage(image, metadata, dataBaseAddress, bssBaseAddress);
	try {
		setupBuiltins();
		enforceLuaHeapBudget();
		m_program = m_programStorage.get();
		m_programMetadata = metadata;
		machine.cpu.setProgram(m_program, metadata);
		startLoadedProgram(vectors, systemStaticModulePaths, cartStaticModulePaths);
	} catch (const std::exception& e) {
		handleLuaError(e.what());
	}
}

void Runtime::startLoadedProgram(ProgramVectorTable vectors, std::span<const std::string> systemStaticModulePaths, std::span<const std::string> cartStaticModulePaths) {
	m_programVectors = vectors;
	NativeResults sectionResults;
	callLuaFunctionInto(machine.cpu.rootClosure(vectors.sectionInitProtoIndex), NativeArgsView(), sectionResults);
	runStaticModuleInitializers(systemStaticModulePaths);
	clearLuaBootPrimitives();
	runStaticModuleInitializers(cartStaticModulePaths);
	machine.cpu.syncGlobalSlotsToTable();
	enforceLuaHeapBudget();
	machine.cpu.start(vectors.resetProtoIndex);
	enforceLuaHeapBudget();
	m_pendingCall = PendingCall::Entry;
	m_luaInitialized = true;
}

void Runtime::runStaticModuleInitializer(const std::string& path) {
	if (m_moduleCache.find(path) != m_moduleCache.end()) {
		return;
	}
	const auto protoIt = m_program->moduleProtoMap.find(path);
	if (protoIt == m_program->moduleProtoMap.end()) {
		throw BMSX_RUNTIME_ERROR("static module init failed: module '" + path + "' is not compiled.");
	}
	m_moduleCache[path] = valueBool(true);
	Closure& closure = machine.cpu.rootClosure(protoIt->second);
	NativeResults results;
	try {
		callLuaFunctionInto(closure, NativeArgsView(), results);
	} catch (...) {
		m_moduleCache.erase(path);
		throw;
	}
	m_moduleCache.erase(path);
}

void Runtime::runStaticModuleInitializers(std::span<const std::string> paths) {
	for (const std::string& path : paths) {
		runStaticModuleInitializer(path);
	}
}

void Runtime::logLuaCallStack() const {
	const ProgramMetadata* metadata = m_programMetadata;
	if (!metadata) {
		return;
	}
	auto stack = machine.cpu.getCallStack();
	if (stack.empty()) {
		auto range = machine.cpu.getDebugRange(machine.cpu.lastPc);
		if (range.has_value()) {
			std::cout << "  at <current> (" << range->path << ":" << range->startLine << ":" << range->startColumn << ")"
						<< std::endl;
		} else {
			std::cout << "  at <current> (pc=" << machine.cpu.lastPc << ")" << std::endl;
		}
		return;
	}
	for (const auto& [protoIndex, pc] : stack) {
		const std::string& protoId = metadata->protoIds[protoIndex];
		auto range = machine.cpu.getDebugRange(pc);
		if (range.has_value()) {
			std::cout << "  at " << protoId << " (" << range->path << ":" << range->startLine << ":" << range->startColumn << ")"
						<< std::endl;
		} else {
			std::cout << "  at " << protoId << " (pc=" << pc << ")" << std::endl;
		}
	}
}

void Runtime::handleLuaError(const std::string& message) {
	hostFault.publishStartup();
	std::cout << "[Runtime] Error: " << message << std::endl;
	logDebugState();
	logLuaCallStack();
	machine.cpu.clearHaltUntilIrq();
	machine.inputController.cancelSampleArm();
	m_pendingCall = PendingCall::None;
	frameLoop.frameActive = false;
	m_runtimeFailed = true;
}


void Runtime::resetRuntimeForProgramReload() {
	frameLoop.resetFrameState(*this);
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	m_programVectors.reset();
	m_cartVectors.reset();
	m_cartDataBaseAddress.reset();
	m_cartBssBaseAddress.reset();
	m_cartStaticModulePaths.clear();
	luaOutputLineBuffer.clear();
	hostFault.clear();
	m_moduleCache.clear();
	machine.cpu.clearGlobalSlots();
	machine.cpu.globals->clear();
	machine.memory.clearIoSlots();
	machine.initializeSystemIo();
	resetHardwareState();
}

void Runtime::requestProgramReload() {
	// Reboot is executed on the next update boundary so the active Lua call can unwind first.
	m_rebootRequested = true;
	m_luaInitialized = false;
	frameLoop.resetFrameState(*this);
}

// disable-next-line single_line_method_pattern -- runtime global writes keep CPU string-key encoding inside Runtime.
void Runtime::setGlobal(std::string_view name, const Value& value) {
	machine.cpu.setGlobalByKey(valueString(machine.cpu.stringPool().intern(name)), value);
}

void Runtime::registerNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost) {
	const auto nativeFn = machine.cpu.createNativeFunction(name, std::move(fn), cost);
	machine.cpu.setGlobalByKey(valueString(machine.cpu.stringPool().intern(name)), nativeFn);
}

void Runtime::resetHardwareState() {
	luaOutputLineBuffer.clear();
	machine.resetDevices();
	vblank.reset(*this);
}

} // namespace bmsx
