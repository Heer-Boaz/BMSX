#include "machine/runtime/runtime.h"
#include "machine/bus/io.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/memory/map.h"
#include "machine/runtime/input.h"
#include "machine/scheduler/device.h"
#include "machine/runtime/timing/config.h"
#include <iostream>
#include <limits>
#include <stdexcept>
#include <utility>

namespace bmsx {

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
		{ options.systemRomBytes.data, options.systemRomBytes.size },
		{ options.cartRomBytes.data, options.cartRomBytes.size }
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
	machine.cpu.setExternalRootMarker([this](GcHeap& heap) {
		for (const auto& entry : m_moduleCache) {
			heap.markValue(entry.second);
		}
	});

	configureLuaHeapUsage(this, &Runtime::getBaseRamUsedBytesThunk, &Runtime::collectTrackedHeapBytesThunk);

}

Runtime::~Runtime() {
	resetLuaHeapUsageHooks();
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

void Runtime::enterSystemFirmware() {
	cartProgramStarted = false;
}

void Runtime::enterCartProgram() {
	cartProgramStarted = true;
}

void Runtime::startCartProgram() {
	enterCartProgram();
	startLoadedProgram(m_cartVectors, std::span<const std::string>{}, m_cartStaticModulePaths);
}

void Runtime::boot(
	const ProgramImage& systemImage,
	std::unique_ptr<ProgramMetadata> systemMetadata,
	const ProgramImage* cartImage,
	std::unique_ptr<ProgramMetadata> cartMetadata,
	ProgramBootTarget bootTarget
) {
	m_moduleCache.clear();
	const ProgramImage& activeImage = bootTarget == ProgramBootTarget::Cart ? *cartImage : systemImage;
	const ProgramImage& runtimeImage = cartImage ? *cartImage : systemImage;
	m_systemVectors = systemImage.vectors;
	m_systemStaticModulePaths = systemImage.sections.rodata.staticModulePaths;
	cartEntryAvailable = cartImage != nullptr;
	m_cartVectors = cartImage ? cartImage->vectors : systemImage.vectors;
	if (cartImage) {
		m_cartStaticModulePaths = cartImage->sections.rodata.staticModulePaths;
	} else {
		m_cartStaticModulePaths.clear();
	}
	cartProgramStarted = bootTarget == ProgramBootTarget::Cart;
	m_programStorage = assembleProgramImages(systemImage, cartImage);
	try {
		m_program = m_programStorage.get();
		m_programRuntimeSymbols = runtimeImage.symbols;
		m_programMetadataStorage = cartImage ? std::move(cartMetadata) : std::move(systemMetadata);
		m_programMetadata = m_programMetadataStorage.get();
		machine.cpu.setProgram(
			m_program,
			m_programRuntimeSymbols,
			m_programMetadata,
			m_systemVectors.irqProtoIndex,
			m_cartVectors.irqProtoIndex,
			m_systemVectors.exceptionProtoIndex
		);
		setupBuiltins();
		enforceLuaHeapBudget();
		startLoadedProgram(
			activeImage.vectors,
			m_systemStaticModulePaths,
			cartProgramStarted ? std::span<const std::string>{ m_cartStaticModulePaths } : std::span<const std::string>{}
		);
	} catch (const std::exception& e) {
		handleLuaError(e.what());
	}
}

void Runtime::startLoadedProgram(ProgramVectorTable vectors, std::span<const std::string> systemStaticModulePaths, std::span<const std::string> cartStaticModulePaths) {
	m_programVectorsStorage = vectors;
	programVectors = &m_programVectorsStorage;
	const u32 statusWord = cartProgramStarted ? CPU_STATUS_CART_ENTRY : CPU_STATUS_SYSTEM_ENTRY;
	runSectionInitializer(vectors.sectionInitProtoIndex, statusWord);
	runStaticModuleInitializers(systemStaticModulePaths);
	clearLuaBootPrimitives();
	runStaticModuleInitializers(cartStaticModulePaths);
	machine.cpu.syncGlobalSlotsToTable();
	enforceLuaHeapBudget();
	machine.cpu.start(vectors.resetProtoIndex, NativeArgsView(), statusWord);
	enforceLuaHeapBudget();
	m_pendingCall = PendingCall::Entry;
	m_luaInitialized = true;
}

void Runtime::rebootSystemProgram() {
	enterSystemFirmware();
	m_runtimeFailed = false;
	m_luaInitialized = false;
	m_pendingCall = PendingCall::None;
	programVectors = nullptr;
	hostFault.clear();
	m_moduleCache.clear();
	machine.cpu.clearProgramEnvironment();
	machine.memory.clearIoSlots();
	machine.initializeSystemIo();
	resetHardwareState();
	machine.cpu.setProgram(
		m_program,
		m_programRuntimeSymbols,
		m_programMetadata,
		m_systemVectors.irqProtoIndex,
		m_cartVectors.irqProtoIndex,
		m_systemVectors.exceptionProtoIndex
	);
	setupBuiltins();
	enforceLuaHeapBudget();
	startLoadedProgram(m_systemVectors, m_systemStaticModulePaths, std::span<const std::string>{});
}

void Runtime::runSectionInitializer(int protoIndex, u32 statusWord) {
	machine.cpu.start(protoIndex, NativeArgsView(), statusWord);
	machine.cpu.runUntilDepth(0, std::numeric_limits<int>::max());
	if (machine.cpu.hasFrames()) {
		throw BMSX_RUNTIME_ERROR("section initializer did not return.");
	}
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
		callClosureInto(closure, NativeArgsView(), results);
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
	programVectors = nullptr;
	cartEntryAvailable = false;
	m_cartStaticModulePaths.clear();
	hostFault.clear();
	m_moduleCache.clear();
	machine.cpu.clearProgramEnvironment();
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
