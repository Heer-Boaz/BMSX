#include "vm_runtime.h"
#include "vm_api.h"
#include "vm_io.h"
#include "program_loader.h"
#include "number_format.h"
#include "../core/engine.h"
#include "../core/rompack.h"
#include "../input/input.h"
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
#include <iomanip>
#include <iostream>
#include <limits>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <unordered_set>

namespace bmsx {
namespace {
inline double to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
}

constexpr uint32_t CART_ROM_MAGIC = 0x58534D42u;
constexpr size_t CART_ROM_HEADER_SIZE = 32;
constexpr std::array<u8, CART_ROM_HEADER_SIZE> CART_ROM_EMPTY_HEADER = {};
}

// Button actions for standard gamepad/keyboard mapping
const std::vector<std::string> VM_BUTTON_ACTIONS = {
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
VMRuntime* VMRuntime::s_instance = nullptr;

namespace {

constexpr int kBootLogFrames = 8;
int s_updateLogRemaining = 0;
int s_drawLogRemaining = 0;

size_t utf8_next_index(const std::string& text, size_t index) {
	unsigned char c0 = static_cast<unsigned char>(text[index]);
	if (c0 < 0x80) {
		return index + 1;
	}
	if ((c0 & 0xE0) == 0xC0) {
		return index + 2;
	}
	if ((c0 & 0xF0) == 0xE0) {
		return index + 3;
	}
	return index + 4;
}

size_t utf8_byte_index_from_codepoint(const std::string& text, int codepointIndex) {
	if (codepointIndex <= 1) {
		return 0;
	}
	size_t index = 0;
	int current = 1;
	while (index < text.size()) {
		if (current == codepointIndex) {
			return index;
		}
		index = utf8_next_index(text, index);
		current += 1;
	}
	return index;
}

int utf8_codepoint_index_from_byte(const std::string& text, size_t byteIndex) {
	size_t index = 0;
	int current = 1;
	while (index < text.size()) {
		if (index >= byteIndex) {
			return current;
		}
		index = utf8_next_index(text, index);
		current += 1;
	}
	return current;
}

uint32_t utf8_codepoint_at(const std::string& text, size_t index) {
	unsigned char c0 = static_cast<unsigned char>(text[index]);
	if (c0 < 0x80) {
		return c0;
	}
	if ((c0 & 0xE0) == 0xC0) {
		unsigned char c1 = static_cast<unsigned char>(text[index + 1]);
		return ((c0 & 0x1F) << 6) | (c1 & 0x3F);
	}
	if ((c0 & 0xF0) == 0xE0) {
		unsigned char c1 = static_cast<unsigned char>(text[index + 1]);
		unsigned char c2 = static_cast<unsigned char>(text[index + 2]);
		return ((c0 & 0x0F) << 12) | ((c1 & 0x3F) << 6) | (c2 & 0x3F);
	}
	unsigned char c1 = static_cast<unsigned char>(text[index + 1]);
	unsigned char c2 = static_cast<unsigned char>(text[index + 2]);
	unsigned char c3 = static_cast<unsigned char>(text[index + 3]);
	return ((c0 & 0x07) << 18) | ((c1 & 0x3F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
}

void utf8_append_codepoint(std::string& out, uint32_t codepoint) {
	if (codepoint <= 0x7F) {
		out.push_back(static_cast<char>(codepoint));
		return;
	}
	if (codepoint <= 0x7FF) {
		out.push_back(static_cast<char>(0xC0 | ((codepoint >> 6) & 0x1F)));
		out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
		return;
	}
	if (codepoint <= 0xFFFF) {
		out.push_back(static_cast<char>(0xE0 | ((codepoint >> 12) & 0x0F)));
		out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
		out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
		return;
	}
	out.push_back(static_cast<char>(0xF0 | ((codepoint >> 18) & 0x07)));
	out.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F)));
	out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
	out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
}

std::string utf8_to_upper(const std::string& text) {
	std::string out;
	out.reserve(text.size());
	size_t index = 0;
	while (index < text.size()) {
		uint32_t codepoint = utf8_codepoint_at(text, index);
		if (codepoint < 0x80) {
			char c = static_cast<char>(codepoint);
			char mapped = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
			out.push_back(mapped);
		} else {
			utf8_append_codepoint(out, codepoint);
		}
		index = utf8_next_index(text, index);
	}
	return out;
}

std::string utf8_to_lower(const std::string& text) {
	std::string out;
	out.reserve(text.size());
	size_t index = 0;
	while (index < text.size()) {
		uint32_t codepoint = utf8_codepoint_at(text, index);
		if (codepoint < 0x80) {
			char c = static_cast<char>(codepoint);
			char mapped = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
			out.push_back(mapped);
		} else {
			utf8_append_codepoint(out, codepoint);
		}
		index = utf8_next_index(text, index);
	}
	return out;
}

Table* buildArrayTable(VMCPU& cpu, const std::array<f32, 12>& values) {
	auto* table = cpu.createTable(static_cast<int>(values.size()), 0);
	for (size_t index = 0; index < values.size(); ++index) {
		table->set(valueNumber(static_cast<double>(index + 1)), valueNumber(static_cast<double>(values[index])));
	}
	return table;
}

template <typename KeyFn>
Table* buildBoundingBoxTable(VMCPU& cpu, const ImgMeta& meta, const KeyFn& key) {
	auto* table = cpu.createTable(0, 4);
	const double left = static_cast<double>(meta.boundingbox.x);
	const double top = static_cast<double>(meta.boundingbox.y);
	const double right = static_cast<double>(meta.boundingbox.x + meta.boundingbox.width);
	const double bottom = static_cast<double>(meta.boundingbox.y + meta.boundingbox.height);
	const double width = static_cast<double>(meta.width);
	const double height = static_cast<double>(meta.height);

	auto* original = cpu.createTable(0, 6);
	original->set(key("left"), valueNumber(left));
	original->set(key("right"), valueNumber(right));
	original->set(key("top"), valueNumber(top));
	original->set(key("bottom"), valueNumber(bottom));
	original->set(key("width"), valueNumber(static_cast<double>(meta.boundingbox.width)));
	original->set(key("height"), valueNumber(static_cast<double>(meta.boundingbox.height)));

	auto* fliph = cpu.createTable(0, 6);
	fliph->set(key("left"), valueNumber(width - right));
	fliph->set(key("right"), valueNumber(width - left));
	fliph->set(key("top"), valueNumber(top));
	fliph->set(key("bottom"), valueNumber(bottom));
	fliph->set(key("width"), valueNumber(static_cast<double>(meta.boundingbox.width)));
	fliph->set(key("height"), valueNumber(static_cast<double>(meta.boundingbox.height)));

	auto* flipv = cpu.createTable(0, 6);
	flipv->set(key("left"), valueNumber(left));
	flipv->set(key("right"), valueNumber(right));
	flipv->set(key("top"), valueNumber(height - bottom));
	flipv->set(key("bottom"), valueNumber(height - top));
	flipv->set(key("width"), valueNumber(static_cast<double>(meta.boundingbox.width)));
	flipv->set(key("height"), valueNumber(static_cast<double>(meta.boundingbox.height)));

	auto* fliphv = cpu.createTable(0, 6);
	fliphv->set(key("left"), valueNumber(width - right));
	fliphv->set(key("right"), valueNumber(width - left));
	fliphv->set(key("top"), valueNumber(height - bottom));
	fliphv->set(key("bottom"), valueNumber(height - top));
	fliphv->set(key("width"), valueNumber(static_cast<double>(meta.boundingbox.width)));
	fliphv->set(key("height"), valueNumber(static_cast<double>(meta.boundingbox.height)));

	table->set(key("original"), valueTable(original));
	table->set(key("fliph"), valueTable(fliph));
	table->set(key("flipv"), valueTable(flipv));
	table->set(key("fliphv"), valueTable(fliphv));
	return table;
}

template <typename KeyFn>
Table* buildImgMetaTable(VMCPU& cpu, const ImgMeta& meta, const KeyFn& key) {
	auto* table = cpu.createTable(0, 12);
	table->set(key("atlassed"), valueBool(meta.atlassed));
	if (meta.atlassed) {
		table->set(key("atlasid"), valueNumber(static_cast<double>(meta.atlasid)));
	}
	table->set(key("width"), valueNumber(static_cast<double>(meta.width)));
	table->set(key("height"), valueNumber(static_cast<double>(meta.height)));
	table->set(key("texcoords"), valueTable(buildArrayTable(cpu, meta.texcoords)));
	table->set(key("texcoords_fliph"), valueTable(buildArrayTable(cpu, meta.texcoords_fliph)));
	table->set(key("texcoords_flipv"), valueTable(buildArrayTable(cpu, meta.texcoords_flipv)));
	table->set(key("texcoords_fliphv"), valueTable(buildArrayTable(cpu, meta.texcoords_fliphv)));
	table->set(key("boundingbox"), valueTable(buildBoundingBoxTable(cpu, meta, key)));

	auto* centerpoint = cpu.createTable(2, 0);
	centerpoint->set(valueNumber(1.0), valueNumber(static_cast<double>(meta.centerX)));
	centerpoint->set(valueNumber(2.0), valueNumber(static_cast<double>(meta.centerY)));
	table->set(key("centerpoint"), valueTable(centerpoint));
	return table;
}

Value binValueToVmValue(VMCPU& cpu, const BinValue& value) {
	if (value.isNull()) {
		return valueNil();
	}
	if (value.isBool()) {
		return valueBool(value.asBool());
	}
	if (value.isNumber()) {
		return valueNumber(static_cast<double>(value.toNumber()));
	}
	if (value.isString()) {
		return valueString(cpu.internString(value.asString()));
	}
	if (value.isArray()) {
		const auto& arr = value.asArray();
		auto* table = cpu.createTable(static_cast<int>(arr.size()), 0);
		for (size_t index = 0; index < arr.size(); ++index) {
			table->set(valueNumber(static_cast<double>(index + 1)), binValueToVmValue(cpu, arr[index]));
		}
		return valueTable(table);
	}
	if (value.isObject()) {
		const auto& obj = value.asObject();
		auto* table = cpu.createTable(0, static_cast<int>(obj.size()));
		for (const auto& [key, entry] : obj) {
			table->set(valueString(cpu.internString(key)), binValueToVmValue(cpu, entry));
		}
		return valueTable(table);
	}
	const auto& bin = value.asBinary();
	auto* table = cpu.createTable(static_cast<int>(bin.size()), 0);
	for (size_t index = 0; index < bin.size(); ++index) {
		table->set(valueNumber(static_cast<double>(index + 1)), valueNumber(static_cast<double>(bin[index])));
	}
	return valueTable(table);
}

} // namespace

VMRuntime& VMRuntime::createInstance(const VMRuntimeOptions& options) {
	if (s_instance) {
		throw BMSX_RUNTIME_ERROR("[VMRuntime] Instance already exists.");
	}
	s_instance = new VMRuntime(options);
	return *s_instance;
}

VMRuntime& VMRuntime::instance() {
	return *s_instance;
}

bool VMRuntime::hasInstance() {
	return s_instance != nullptr;
}

void VMRuntime::destroy() {
	delete s_instance;
	s_instance = nullptr;
}

VMRuntime::VMRuntime(const VMRuntimeOptions& options)
	: m_memory()
	, m_vdp(m_memory)
	, m_stringHandles(m_memory)
	, m_cpu(m_memory, &m_stringHandles)
	, m_playerIndex(options.playerIndex)
	, m_viewport(options.viewport)
	, m_canonicalization(options.canonicalization)
{
	// Initialize I/O memory region
	m_memory.clearIoSlots();
	// Write pointer starts at 0
	m_memory.writeValue(IO_WRITE_PTR_ADDR, valueNumber(0.0));
	// System flags
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
	m_vdp.initializeRegisters();
	m_vmRandomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
	refreshMemoryMap();
	m_cpu.setExternalRootMarker([this](VMHeap& heap) {
		for (const auto& entry : m_vmModuleCache) {
			heap.markValue(entry.second);
		}
		heap.markObject(m_updateFn);
		heap.markObject(m_drawFn);
		heap.markObject(m_initFn);
		heap.markObject(m_newGameFn);
		heap.markValue(m_ipairsIterator);
	});

	// Create API instance
	m_api = std::make_unique<VMApi>(*this);

	// Setup builtin functions
	setupBuiltins();
	m_api->registerAllFunctions();
}

VMRuntime::~VMRuntime() {
	m_api.reset();
}

VMApi& VMRuntime::api() {
	return *m_api;
}

void VMRuntime::boot(const VmProgramAsset& asset, ProgramMetadata* metadata) {
	m_vmModuleProtos.clear();
	for (const auto& [path, protoIndex] : asset.moduleProtos) {
		m_vmModuleProtos[path] = protoIndex;
	}
	m_vmModuleAliases.clear();
	for (const auto& [alias, path] : asset.moduleAliases) {
		m_vmModuleAliases[alias] = path;
	}
	m_vmModuleCache.clear();
	boot(asset.program.get(), metadata, asset.entryProtoIndex);
}

void VMRuntime::boot(Program* program, ProgramMetadata* metadata, int entryProtoIndex) {
	std::cout << "[VMRuntime] boot: program=" << program << " entryProtoIndex=" << entryProtoIndex << std::endl;
	std::cout << "[VMRuntime] boot: module protos=" << m_vmModuleProtos.size()
				<< " aliases=" << m_vmModuleAliases.size() << std::endl;
	m_runtimeFailed = false;
	m_vmInitialized = false;
	m_pendingVmCall = PendingCall::None;
	m_updateFn = nullptr;
	m_drawFn = nullptr;
	m_initFn = nullptr;
	m_newGameFn = nullptr;
	m_cpu.instructionBudgetRemaining = std::nullopt;
	m_cpu.globals->clear();
	m_memory.clearIoSlots();
	m_memory.writeValue(IO_WRITE_PTR_ADDR, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_BOOT_CART, valueNumber(0.0));
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(0.0));
	m_vdp.initializeRegisters();
	m_vmRandomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
	setupBuiltins();
	m_api->registerAllFunctions();
	m_program = program;
	m_programMetadata = metadata;
	m_cpu.setProgram(program, metadata);
	runEngineBuiltinPrelude();
	s_updateLogRemaining = kBootLogFrames;
	s_drawLogRemaining = kBootLogFrames;

	// Start execution at entry point
	std::cout << "[VMRuntime] boot: starting CPU at entry point..." << std::endl;
	m_cpu.start(entryProtoIndex);

	// Run until halted to execute top-level code
	std::cout << "[VMRuntime] boot: running top-level code..." << std::endl;
	m_cpu.run();
	processIOCommands();
	std::cout << "[VMRuntime] boot: top-level code executed" << std::endl;

	// Cache callback functions (use Lua-style names: update, draw, init, new_game)
	Value updateVal = m_cpu.globals->get(canonicalizeIdentifier("update"));
	if (valueIsClosure(updateVal)) {
		m_updateFn = asClosure(updateVal);
		std::cout << "[VMRuntime] boot: found update" << std::endl;
	}

	Value drawVal = m_cpu.globals->get(canonicalizeIdentifier("draw"));
	if (valueIsClosure(drawVal)) {
		m_drawFn = asClosure(drawVal);
		std::cout << "[VMRuntime] boot: found draw" << std::endl;
	}

	Value initVal = m_cpu.globals->get(canonicalizeIdentifier("init"));
	if (valueIsClosure(initVal)) {
		m_initFn = asClosure(initVal);
		std::cout << "[VMRuntime] boot: found init" << std::endl;
	}

	Value newGameVal = m_cpu.globals->get(canonicalizeIdentifier("new_game"));
	if (valueIsClosure(newGameVal)) {
		m_newGameFn = asClosure(newGameVal);
		std::cout << "[VMRuntime] boot: found new_game" << std::endl;
	}

	if (!m_initFn) {
		throw BMSX_RUNTIME_ERROR("[VMRuntime] VM lifecycle handler 'init' is not defined.");
	}
	if (!m_newGameFn) {
		throw BMSX_RUNTIME_ERROR("[VMRuntime] VM lifecycle handler 'new_game' is not defined.");
	}
	std::cout << "[VMRuntime] boot: calling init..." << std::endl;
	callLuaFunction(m_initFn, {});
	std::cout << "[VMRuntime] boot: calling new_game..." << std::endl;
	callEngineModuleMember("reset", {});
	callLuaFunction(m_newGameFn, {});

	m_vmInitialized = true;
	std::cout << "[VMRuntime] boot: VM initialized!" << std::endl;
}

void VMRuntime::setCartBootReadyFlag(bool value) {
	m_memory.writeValue(IO_SYS_CART_BOOTREADY, valueNumber(value ? 1.0 : 0.0));
}

void VMRuntime::prepareCartBootIfNeeded() {
	if (!isEngineProgramActive()) {
		return;
	}
	const RuntimeAssets& assets = EngineCore::instance().assets();
	if (!assets.vmProgram) {
		return;
	}
	if (m_cartBootPrepared) {
		return;
	}
	setCartBootReadyFlag(false);
	EngineCore::instance().prepareLoadedRomAssets();
	m_cartBootPrepared = true;
	setCartBootReadyFlag(true);
}

bool VMRuntime::pollSystemBootRequest() {
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

void VMRuntime::tickUpdate() {
	if (!m_vmInitialized || !m_tickEnabled || m_runtimeFailed) {
		// if (s_updateLogRemaining > 0) {
		// 	std::cerr << "[VMRuntime] update: skipped (initialized=" << (m_vmInitialized ? "true" : "false")
		// 			  << " tick=" << (m_tickEnabled ? "true" : "false")
		// 			  << " failed=" << (m_runtimeFailed ? "true" : "false") << ")" << std::endl;
		// 	--s_updateLogRemaining;
		// }
		return;
	}

	prepareCartBootIfNeeded();
	if (pollSystemBootRequest()) {
		return;
	}

	m_frameState.updateExecuted = false;
	m_frameState.deltaSeconds = static_cast<float>(EngineCore::instance().deltaTime());
	auto* gameTable = asTable(m_cpu.globals->get(canonicalizeIdentifier("game")));
	gameTable->set(canonicalizeIdentifier("deltatime_seconds"), valueNumber(static_cast<double>(m_frameState.deltaSeconds)));
	gameTable->set(canonicalizeIdentifier("deltatime"), valueNumber(static_cast<double>(m_frameState.deltaSeconds) * 1000.0));
	auto* viewportTable = asTable(gameTable->get(canonicalizeIdentifier("viewportsize")));
	auto viewSize = EngineCore::instance().view()->viewportSize;
	viewportTable->set(canonicalizeIdentifier("x"), valueNumber(static_cast<double>(viewSize.x)));
	viewportTable->set(canonicalizeIdentifier("y"), valueNumber(static_cast<double>(viewSize.y)));

	// Call _update if present
	executeUpdateCallback(m_frameState.deltaSeconds);

	m_frameState.updateExecuted = true;
	flushAssetEdits();
}

void VMRuntime::tickDraw() {
	if (!m_vmInitialized || !m_tickEnabled || m_runtimeFailed) {
		// if (s_drawLogRemaining > 0) {
		// 	std::cerr << "[VMRuntime] draw: skipped (initialized=" << (m_vmInitialized ? "true" : "false")
		// 			  << " tick=" << (m_tickEnabled ? "true" : "false")
		// 			  << " failed=" << (m_runtimeFailed ? "true" : "false") << ")" << std::endl;
		// 	--s_drawLogRemaining;
		// }
		return;
	}

	// Call _draw if present
	m_vdp.commitViewSnapshot(*EngineCore::instance().view());
	executeDrawCallback();
}

void VMRuntime::tickIdeInput() {
	// IDE input handling - stub for now
}

void VMRuntime::tickIDE() {
	// IDE update - stub for now
	flushAssetEdits();
}

void VMRuntime::tickIDEDraw() {
	// IDE draw - stub for now
}

void VMRuntime::tickTerminalInput() {
	// Terminal input handling - stub for now
}

void VMRuntime::tickTerminalMode() {
	// Terminal mode update - stub for now
	flushAssetEdits();
}

void VMRuntime::tickTerminalModeDraw() {
	// Terminal mode draw - stub for now
}

void VMRuntime::processIOCommands() {
	// Get write pointer
	m_vdp.syncRegisters();
	int writePtr = static_cast<int>(asNumber(m_memory.readValue(IO_WRITE_PTR_ADDR)));
	if (writePtr <= 0) {
		return;
	}

	// Process each command
	for (int i = 0; i < writePtr && i < VM_IO_COMMAND_CAPACITY; ++i) {
		int cmdBase = IO_BUFFER_BASE + i * IO_COMMAND_STRIDE;
		int cmd = static_cast<int>(asNumber(m_memory.readValue(cmdBase)));

		switch (cmd) {
			case IO_CMD_PRINT: {
				Value arg = m_memory.readValue(cmdBase + IO_ARG0_OFFSET);
				std::cout << vmToString(arg) << '\n';
				break;
			}
			default:
				throw BMSX_RUNTIME_ERROR("Unknown VM IO command: " + std::to_string(cmd) + ".");
		}
	}

	// Reset write pointer
	m_memory.writeValue(IO_WRITE_PTR_ADDR, valueNumber(0.0));
}

void VMRuntime::requestProgramReload() {
	// Mark for reload - actual reload happens in the appropriate phase
	m_vmInitialized = false;
}

void VMRuntime::resetCartBootState() {
	m_cartBootPrepared = false;
	setCartBootReadyFlag(false);
}

VMState VMRuntime::captureCurrentState() const {
	VMState state;
	state.ioMemory = m_memory.ioSlots();
	state.globals = m_cpu.globals->entries();
	state.assetMemory = m_memory.dumpAssetMemory();
	state.atlasSlots = m_vdp.atlasSlots();
	return state;
}

void VMRuntime::applyState(const VMState& state) {
	// Restore memory
	m_memory.loadIoSlots(state.ioMemory);
	m_vdp.syncRegisters();
	if (!state.assetMemory.empty()) {
		m_memory.restoreAssetMemory(state.assetMemory.data(), state.assetMemory.size());
	}
	applyAtlasSlotMapping(state.atlasSlots);

	// Restore globals
	m_cpu.globals->clear();
	for (const auto& [key, value] : state.globals) {
		m_cpu.globals->set(key, value);
	}
	flushAssetEdits();
}

void VMRuntime::applyAtlasSlotMapping(const std::array<i32, 2>& slots) {
	m_vdp.applyAtlasSlotMapping(slots);
}

std::vector<Value> VMRuntime::callLuaFunction(Closure* fn, const std::vector<Value>& args) {
	int depthBefore = m_cpu.getFrameDepth();
	m_cpu.callExternal(fn, args);
	std::optional<int> previousBudget = m_cpu.instructionBudgetRemaining;
	m_cpu.instructionBudgetRemaining = std::nullopt;
	m_cpu.runUntilDepth(depthBefore);
	m_cpu.instructionBudgetRemaining = previousBudget;
	return m_cpu.lastReturnValues;
}

Value VMRuntime::getGlobal(std::string_view name) {
	return m_cpu.globals->get(canonicalizeIdentifier(name));
}

void VMRuntime::setGlobal(std::string_view name, const Value& value) {
	m_cpu.globals->set(canonicalizeIdentifier(name), value);
}

void VMRuntime::registerNativeFunction(std::string_view name, NativeFunctionInvoke fn) {
	auto nativeFn = m_cpu.createNativeFunction(name, std::move(fn));
	m_cpu.globals->set(canonicalizeIdentifier(name), nativeFn);
}

void VMRuntime::setCanonicalization(CanonicalizationType canonicalization) {
	m_canonicalization = canonicalization;
}

void VMRuntime::refreshMemoryMap() {
	const auto engineRom = EngineCore::instance().engineRomView();
	if (engineRom.size > 0) {
		m_memory.setEngineRom(engineRom.data, engineRom.size);
	}
	const auto cartRom = EngineCore::instance().cartRomView();
	if (cartRom.size > 0) {
		m_memory.setCartRom(cartRom.data, cartRom.size);
	} else {
		m_memory.setCartRom(CART_ROM_EMPTY_HEADER.data(), CART_ROM_EMPTY_HEADER.size());
	}
}

void VMRuntime::buildAssetMemory(RuntimeAssets& assets, bool keepDecodedData) {
	m_memory.resetAssetMemory();
	m_vdp.registerImageAssets(assets, keepDecodedData);
	const RuntimeAssets* fallback = assets.fallback;
	for (auto& [id, audioAsset] : assets.audio) {
		if (audioAsset.bytes.empty()) {
			throw BMSX_RUNTIME_ERROR("[VMRuntime] Audio asset '" + id + "' missing encoded bytes.");
		}
		m_memory.registerAudioBuffer(
			id,
			audioAsset.bytes.data(),
			audioAsset.bytes.size(),
			static_cast<uint32_t>(audioAsset.sampleRate),
			static_cast<uint32_t>(audioAsset.channels),
			static_cast<uint32_t>(audioAsset.bitsPerSample),
			static_cast<uint32_t>(audioAsset.frames),
			static_cast<uint32_t>(audioAsset.dataOffset),
			static_cast<uint32_t>(audioAsset.dataSize)
		);
	}
	if (fallback) {
		for (const auto& [id, audioAsset] : fallback->audio) {
			if (assets.audio.find(id) != assets.audio.end()) {
				continue;
			}
			if (audioAsset.bytes.empty()) {
				throw BMSX_RUNTIME_ERROR("[VMRuntime] Audio asset '" + id + "' missing encoded bytes.");
			}
			m_memory.registerAudioBuffer(
				id,
				audioAsset.bytes.data(),
				audioAsset.bytes.size(),
				static_cast<uint32_t>(audioAsset.sampleRate),
				static_cast<uint32_t>(audioAsset.channels),
				static_cast<uint32_t>(audioAsset.bitsPerSample),
				static_cast<uint32_t>(audioAsset.frames),
				static_cast<uint32_t>(audioAsset.dataOffset),
				static_cast<uint32_t>(audioAsset.dataSize)
			);
		}
	}

	m_memory.finalizeAssetTable();
	m_memory.markAllAssetsDirty();
}

void VMRuntime::flushAssetEdits() {
	m_vdp.flushAssetEdits();
}

Value VMRuntime::requireVmModule(const std::string& moduleName) {
	const auto aliasIt = m_vmModuleAliases.find(moduleName);
	if (aliasIt == m_vmModuleAliases.end()) {
		throw BMSX_RUNTIME_ERROR("require('" + moduleName + "') failed: module not found.");
	}
	const std::string& path = aliasIt->second;
	const auto cachedIt = m_vmModuleCache.find(path);
	if (cachedIt != m_vmModuleCache.end()) {
		return cachedIt->second;
	}
	const auto protoIt = m_vmModuleProtos.find(path);
	if (protoIt == m_vmModuleProtos.end()) {
		throw BMSX_RUNTIME_ERROR("require('" + moduleName + "') failed: module not compiled.");
	}
	m_vmModuleCache[path] = valueBool(true);
	auto* closure = m_cpu.createRootClosure(protoIt->second);
	std::vector<Value> results = callLuaFunction(closure, {});
	Value value = results.empty() ? valueNil() : results[0];
	Value cachedValue = isNil(value) ? valueBool(true) : value;
	m_vmModuleCache[path] = cachedValue;
	return cachedValue;
}

std::vector<Value> VMRuntime::callEngineModuleMember(const std::string& name, const std::vector<Value>& args) {
	auto* engineModule = asTable(requireVmModule("engine"));
	Value key = canonicalizeIdentifier(name);
	auto* member = asClosure(engineModule->get(key));
	return callLuaFunction(member, args);
}

void VMRuntime::logVmCallStack() const {
	const ProgramMetadata* metadata = m_programMetadata;
	if (!metadata) {
		return;
	}
	auto stack = m_cpu.getCallStack();
	for (const auto& [protoIndex, pc] : stack) {
		const std::string& protoId = metadata->protoIds[protoIndex];
		auto range = m_cpu.getDebugRange(pc);
		if (range.has_value()) {
			std::cerr << "  at " << protoId << " (" << range->path << ":" << range->startLine << ":" << range->startColumn << ")"
						<< std::endl;
		} else {
			std::cerr << "  at " << protoId << " (pc=" << pc << ")" << std::endl;
		}
	}
}

void VMRuntime::runEngineBuiltinPrelude() {
	std::cerr << "[VMRuntime] prelude: binding engine builtins" << std::endl;
	static const std::array<const char*, 21> engineBuiltins = {
		"define_fsm",
		"define_world_object",
		"define_service",
		"define_component",
		"define_effect",
		"new_timeline",
		"timeline_range",
		"new_timeline_range",
		"spawn_object",
		"spawn_sprite",
		"spawn_textobject",
		"create_service",
		"service",
		"object",
		"attach_component",
		"configure_ecs",
		"apply_default_pipeline",
		"enlist",
		"delist",
		"grant_effect",
		"trigger_effect",
	};
	auto* engineModule = asTable(requireVmModule("engine"));
	for (const char* name : engineBuiltins) {
		Value key = canonicalizeIdentifier(name);
		m_cpu.globals->set(key, engineModule->get(key));
	}
	processIOCommands();
	std::cerr << "[VMRuntime] prelude: engine builtins bound" << std::endl;
}

std::string VMRuntime::formatVmString(const std::string& templateStr, const std::vector<Value>& args, size_t argStart) const {
	size_t argumentIndex = argStart;
	std::string output;

	auto takeArgument = [&]() -> Value {
		Value value = argumentIndex < args.size() ? args[argumentIndex] : valueNil();
		argumentIndex += 1;
		return value;
	};

	struct ParsedInt {
		bool found = false;
		int value = 0;
		size_t nextIndex = 0;
	};

	auto readInteger = [&](size_t startIndex) -> ParsedInt {
		size_t cursor = startIndex;
		while (cursor < templateStr.size()) {
			const unsigned char code = static_cast<unsigned char>(templateStr[cursor]);
			if (!std::isdigit(code)) {
				break;
			}
			cursor += 1;
		}
		if (cursor == startIndex) {
			return ParsedInt{false, 0, startIndex};
		}
		return ParsedInt{true, std::stoi(templateStr.substr(startIndex, cursor - startIndex)), cursor};
	};

	for (size_t index = 0; index < templateStr.size(); ++index) {
		const char current = templateStr[index];
		if (current != '%') {
			output.push_back(current);
			continue;
		}
		if (index == templateStr.size() - 1) {
			throw BMSX_RUNTIME_ERROR("string.format incomplete format specifier.");
		}
		if (templateStr[index + 1] == '%') {
			output.push_back('%');
			index += 1;
			continue;
		}

		size_t cursor = index + 1;
		struct {
			bool leftAlign = false;
			bool plus = false;
			bool space = false;
			bool zeroPad = false;
			bool alternate = false;
		} flags;

		while (cursor < templateStr.size()) {
			const char flag = templateStr[cursor];
			if (flag == '-') { flags.leftAlign = true; cursor += 1; continue; }
			if (flag == '+') { flags.plus = true; cursor += 1; continue; }
			if (flag == ' ') { flags.space = true; cursor += 1; continue; }
			if (flag == '0') { flags.zeroPad = true; cursor += 1; continue; }
			if (flag == '#') { flags.alternate = true; cursor += 1; continue; }
			break;
		}

		if (cursor >= templateStr.size()) {
			throw BMSX_RUNTIME_ERROR("string.format incomplete format specifier.");
		}

		std::optional<int> width;
		if (templateStr[cursor] == '*') {
			int widthArg = static_cast<int>(asNumber(takeArgument()));
			if (widthArg < 0) {
				flags.leftAlign = true;
				width = -widthArg;
			} else {
				width = widthArg;
			}
			cursor += 1;
		} else {
			const ParsedInt parsedWidth = readInteger(cursor);
			if (parsedWidth.found) {
				width = parsedWidth.value;
				cursor = parsedWidth.nextIndex;
			}
		}

		std::optional<int> precision;
		if (cursor < templateStr.size() && templateStr[cursor] == '.') {
			cursor += 1;
			if (cursor >= templateStr.size()) {
				throw BMSX_RUNTIME_ERROR("string.format incomplete format specifier.");
			}
			if (templateStr[cursor] == '*') {
				int precisionArg = static_cast<int>(asNumber(takeArgument()));
				if (precisionArg >= 0) {
					precision = precisionArg;
				} else {
					precision.reset();
				}
				cursor += 1;
			} else {
				const ParsedInt parsedPrecision = readInteger(cursor);
				precision = parsedPrecision.found ? parsedPrecision.value : 0;
				cursor = parsedPrecision.nextIndex;
			}
		}

		while (cursor < templateStr.size()) {
			const char mod = templateStr[cursor];
			if (mod != 'l' && mod != 'L' && mod != 'h') {
				break;
			}
			cursor += 1;
		}

		const char specifier = cursor < templateStr.size() ? templateStr[cursor] : '\0';
		if (specifier == '\0') {
			throw BMSX_RUNTIME_ERROR("string.format incomplete format specifier.");
		}

		auto signPrefix = [&](double value) -> std::string {
			if (value < 0) {
				return "-";
			}
			if (flags.plus) {
				return "+";
			}
			if (flags.space) {
				return " ";
			}
			return "";
		};

		auto applyPadding = [&](const std::string& content, const std::string& sign, const std::string& prefix, bool allowZeroPadding) -> std::string {
			const size_t totalLength = sign.size() + prefix.size() + content.size();
			if (width.has_value() && totalLength < static_cast<size_t>(*width)) {
				const size_t paddingLength = static_cast<size_t>(*width) - totalLength;
				if (flags.leftAlign) {
					return sign + prefix + content + std::string(paddingLength, ' ');
				}
				const char padChar = allowZeroPadding ? '0' : ' ';
				if (padChar == '0') {
					return sign + prefix + std::string(paddingLength, '0') + content;
				}
				return std::string(paddingLength, ' ') + sign + prefix + content;
			}
			return sign + prefix + content;
		};

		auto toBase = [](uint64_t value, int base) -> std::string {
			if (value == 0) {
				return "0";
			}
			std::string digits;
			while (value > 0) {
				int digit = static_cast<int>(value % base);
				char c = digit < 10 ? static_cast<char>('0' + digit) : static_cast<char>('a' + (digit - 10));
				digits.push_back(c);
				value /= base;
			}
			std::reverse(digits.begin(), digits.end());
			return digits;
		};

		switch (specifier) {
			case 's': {
				Value value = takeArgument();
				std::string text = vmToString(value);
				if (precision.has_value() && static_cast<size_t>(*precision) < text.size()) {
					text = text.substr(0, static_cast<size_t>(*precision));
				}
				output += applyPadding(text, "", "", false);
				break;
			}
			case 'c': {
				double value = asNumber(takeArgument());
				char character = static_cast<char>(static_cast<int>(std::floor(value)));
				output += applyPadding(std::string(1, character), "", "", false);
				break;
			}
			case 'd':
			case 'i':
			case 'u':
			case 'o':
			case 'x':
			case 'X': {
				double number = asNumber(takeArgument());
				int64_t integerValue = static_cast<int64_t>(std::trunc(number));
				const bool isUnsigned = specifier == 'u' || specifier == 'o' || specifier == 'x' || specifier == 'X';
				if (isUnsigned) {
					integerValue = static_cast<uint32_t>(integerValue);
				}
				const bool negative = !isUnsigned && integerValue < 0;
				const std::string sign = negative ? "-" : (specifier == 'd' || specifier == 'i') ? signPrefix(static_cast<double>(integerValue)) : "";
				uint64_t magnitude = negative ? static_cast<uint64_t>(-integerValue) : static_cast<uint64_t>(integerValue);
				int base = 10;
				if (specifier == 'o') base = 8;
				if (specifier == 'x' || specifier == 'X') base = 16;
				std::string digits = toBase(magnitude, base);
				if (specifier == 'X') {
					for (char& c : digits) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
				}
				if (precision.has_value()) {
					const int required = std::max(0, *precision);
					if (static_cast<int>(digits.size()) < required) {
						digits = std::string(static_cast<size_t>(required) - digits.size(), '0') + digits;
					}
					if (*precision == 0 && magnitude == 0) {
						digits.clear();
					}
				}
				std::string prefix;
				if (flags.alternate) {
					if ((specifier == 'x' || specifier == 'X') && magnitude != 0) {
						prefix = specifier == 'x' ? "0x" : "0X";
					}
					if (specifier == 'o') {
						if (digits.empty()) {
							digits = "0";
						} else if (digits[0] != '0') {
							digits = "0" + digits;
						}
					}
				}
				const bool allowZeroPad = flags.zeroPad && !flags.leftAlign && !precision.has_value();
				output += applyPadding(digits, sign, prefix, allowZeroPad);
				break;
			}
			case 'f':
			case 'F': {
				double number = asNumber(takeArgument());
				const std::string sign = signPrefix(number);
				const int fractionDigits = precision.has_value() ? std::max(0, *precision) : 6;
				std::ostringstream stream;
				stream << std::fixed << std::setprecision(fractionDigits) << std::abs(number);
				std::string text = stream.str();
				if (flags.alternate && fractionDigits == 0 && text.find('.') == std::string::npos) {
					text += '.';
				}
				const bool allowZeroPad = flags.zeroPad && !flags.leftAlign;
				output += applyPadding(text, sign, "", allowZeroPad);
				break;
			}
			case 'e':
			case 'E': {
				double number = asNumber(takeArgument());
				const std::string sign = signPrefix(number);
				const int fractionDigits = precision.has_value() ? std::max(0, *precision) : 6;
				std::ostringstream stream;
				stream << std::scientific << std::setprecision(fractionDigits) << std::abs(number);
				std::string text = stream.str();
				if (specifier == 'E') {
					for (char& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
				}
				const bool allowZeroPad = flags.zeroPad && !flags.leftAlign;
				output += applyPadding(text, sign, "", allowZeroPad);
				break;
			}
			case 'g':
			case 'G': {
				double number = asNumber(takeArgument());
				const std::string sign = signPrefix(number);
				const int significant = precision.has_value() ? (*precision == 0 ? 1 : *precision) : 6;
				std::ostringstream stream;
				stream << std::setprecision(significant) << std::defaultfloat << std::abs(number);
				std::string text = stream.str();
				if (!flags.alternate) {
					const size_t expPos = text.find_first_of("eE");
					if (expPos != std::string::npos) {
						std::string mantissa = text.substr(0, expPos);
						const std::string exponent = text.substr(expPos + 1);
						const size_t dotPos = mantissa.find('.');
						if (dotPos != std::string::npos) {
							while (!mantissa.empty() && mantissa.back() == '0') {
								mantissa.pop_back();
							}
							if (!mantissa.empty() && mantissa.back() == '.') {
								mantissa.pop_back();
							}
						}
						text = mantissa + "e" + exponent;
					} else if (text.find('.') != std::string::npos) {
						while (!text.empty() && text.back() == '0') {
							text.pop_back();
						}
						if (!text.empty() && text.back() == '.') {
							text.pop_back();
						}
					}
				}
				if (specifier == 'G') {
					for (char& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
				}
				const bool allowZeroPad = flags.zeroPad && !flags.leftAlign;
				output += applyPadding(text, sign, "", allowZeroPad);
				break;
			}
			case 'q': {
				Value value = takeArgument();
				std::string raw = vmToString(value);
				std::string escaped = "\"";
				for (size_t charIndex = 0; charIndex < raw.size(); ++charIndex) {
					const unsigned char code = static_cast<unsigned char>(raw[charIndex]);
					switch (code) {
						case 10: escaped += "\\n"; break;
						case 13: escaped += "\\r"; break;
						case 9: escaped += "\\t"; break;
						case 92: escaped += "\\\\"; break;
						case 34: escaped += "\\\""; break;
						default:
							if (code < 32 || code == 127) {
								std::ostringstream oss;
								oss << std::setw(3) << std::setfill('0') << static_cast<int>(code);
								escaped += "\\" + oss.str();
							} else {
								escaped.push_back(raw[charIndex]);
							}
							break;
					}
				}
				escaped += "\"";
				output += applyPadding(escaped, "", "", false);
				break;
			}
			default:
				throw BMSX_RUNTIME_ERROR(std::string("string.format unsupported format specifier '%") + specifier + "'.");
		}

		index = cursor;
	}

	return output;
}

Value VMRuntime::canonicalizeIdentifier(std::string_view value) {
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

const std::regex& VMRuntime::buildLuaPatternRegex(const std::string& pattern) {
	auto it = m_luaPatternRegexCache.find(pattern);
	if (it != m_luaPatternRegexCache.end()) {
		return *it->second;
	}

	std::string output;
	output.reserve(pattern.size() * 2);
	bool inClass = false;
	for (size_t index = 0; index < pattern.size(); ++index) {
		char ch = pattern[index];
		if (inClass) {
			if (ch == ']') {
				inClass = false;
				output.push_back(']');
				continue;
			}
			if (ch == '%') {
				++index;
				if (index >= pattern.size()) {
					throw BMSX_RUNTIME_ERROR("string.gmatch invalid pattern.");
				}
				output += translateLuaPatternEscape(pattern[index], true);
				continue;
			}
			if (ch == '\\') {
				output += "\\\\";
				continue;
			}
			output.push_back(ch);
			continue;
		}

		if (ch == '[') {
			inClass = true;
			output.push_back('[');
			continue;
		}
		if (ch == '%') {
			++index;
			if (index >= pattern.size()) {
				throw BMSX_RUNTIME_ERROR("string.gmatch invalid pattern.");
			}
			output += translateLuaPatternEscape(pattern[index], false);
			continue;
		}
		if (ch == '-') {
			output += "*?";
			continue;
		}
		if (ch == '^') {
			output += index == 0 ? "^" : "\\^";
			continue;
		}
		if (ch == '$') {
			output += index == pattern.size() - 1 ? "$" : "\\$";
			continue;
		}
		if (ch == '(' || ch == ')' || ch == '.' || ch == '+' || ch == '*' || ch == '?') {
			output.push_back(ch);
			continue;
		}
		if (ch == '|' || ch == '{' || ch == '}' || ch == '\\') {
			output.push_back('\\');
			output.push_back(ch);
			continue;
		}
		output.push_back(ch);
	}
	if (inClass) {
		throw BMSX_RUNTIME_ERROR("string.gmatch invalid pattern.");
	}
	auto compiled = std::make_unique<std::regex>(
		output,
		std::regex_constants::ECMAScript | std::regex_constants::optimize
	);
	auto insertIt = m_luaPatternRegexCache.emplace(pattern, std::move(compiled)).first;
	return *insertIt->second;
}

std::string VMRuntime::translateLuaPatternEscape(char token, bool inClass) const {
	switch (token) {
		case 'a':
			return inClass ? "A-Za-z" : "[A-Za-z]";
		case 'd':
			return inClass ? "0-9" : "\\d";
		case 'l':
			return inClass ? "a-z" : "[a-z]";
		case 'u':
			return inClass ? "A-Z" : "[A-Z]";
		case 'w':
			return inClass ? "A-Za-z0-9_" : "[A-Za-z0-9_]";
		case 'x':
			return inClass ? "A-Fa-f0-9" : "[A-Fa-f0-9]";
		case 'z':
			return "\\x00";
		case 'c':
			return inClass ? "\\x00-\\x1F\\x7F" : "[\\x00-\\x1F\\x7F]";
		case 'g':
			return inClass ? "\\x21-\\x7E" : "[\\x21-\\x7E]";
		case 's':
			return "\\s";
		case 'p': {
			std::string punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
			std::string escaped;
			escaped.reserve(punctuation.size() * 2);
			for (char ch : punctuation) {
				if (ch == '\\' || ch == '-' || ch == ']') {
					escaped.push_back('\\');
				}
				escaped.push_back(ch);
			}
			return inClass ? escaped : "[" + escaped + "]";
		}
		case '%':
			return "%";
		default:
			return std::string("\\") + token;
	}
}

std::string VMRuntime::vmToString(const Value& value) const {
	if (isNil(value)) {
		return "nil";
	}
	if (valueIsBool(value)) {
		return valueToBool(value) ? "true" : "false";
	}
	if (valueIsNumber(value)) {
		double n = valueToNumber(value);
		if (!std::isfinite(n)) {
			return "nan";
		}
		return formatNumber(n);
	}
	if (valueIsString(value)) {
		return m_cpu.stringPool().toString(asStringId(value));
	}
	if (valueIsTable(value)) {
		return "table";
	}
	if (valueIsNativeFunction(value) || valueIsClosure(value)) {
		return "function";
	}
	if (valueIsNativeObject(value)) {
		return "native";
	}
	return "function";
}

std::vector<Value> VMRuntime::acquireValueScratch() {
	if (!m_valueScratchPool.empty()) {
		auto scratch = std::move(m_valueScratchPool.back());
		m_valueScratchPool.pop_back();
		scratch.clear();
		return scratch;
	}
	return {};
}

void VMRuntime::releaseValueScratch(std::vector<Value>&& values) {
	values.clear();
	if (m_valueScratchPool.size() < MAX_POOLED_VM_RUNTIME_SCRATCH) {
		m_valueScratchPool.push_back(std::move(values));
	}
}

double VMRuntime::nextVmRandom() {
	m_vmRandomSeedValue = static_cast<uint32_t>((static_cast<uint64_t>(m_vmRandomSeedValue) * 1664525u + 1013904223u) & 0xffffffffu);
	return static_cast<double>(m_vmRandomSeedValue) / 4294967296.0;
}

void VMRuntime::setupBuiltins() {
	auto logPcallError = [this](const std::string& message) {
		std::cerr << "[VMRuntime] pcall error: " << message << std::endl;
		logVmCallStack();
	};
	auto callVmValue = [this](const Value& callee, const std::vector<Value>& args, std::vector<Value>& out) {
		if (valueIsNativeFunction(callee)) {
			asNativeFunction(callee)->invoke(args, out);
			return;
		}
		if (valueIsClosure(callee)) {
			int depthBefore = m_cpu.getFrameDepth();
			m_cpu.callExternal(asClosure(callee), args);
			std::optional<int> previousBudget = m_cpu.instructionBudgetRemaining;
			m_cpu.instructionBudgetRemaining = std::nullopt;
			m_cpu.runUntilDepth(depthBefore);
			m_cpu.instructionBudgetRemaining = previousBudget;
			out.clear();
			const auto& results = m_cpu.lastReturnValues;
			out.insert(out.end(), results.begin(), results.end());
			return;
		}
		throw BMSX_RUNTIME_ERROR("Attempted to call a non-function value.");
	};
	auto key = [this](std::string_view name) {
		return canonicalizeIdentifier(name);
	};
	auto str = [this](std::string_view value) {
		return valueString(m_cpu.internString(value));
	};
	auto asText = [this](Value value) -> const std::string& {
		return m_cpu.stringPool().toString(asStringId(value));
	};
	auto clamp01 = [](double value) {
		return clamp(value, 0.0, 1.0);
	};
	auto smoothstep01 = [clamp01](double value) {
		const double x = clamp01(value);
		return x * x * (3.0 - (2.0 * x));
	};
	auto pingpong01 = [](double value) {
		double p = std::fmod(value, 2.0);
		if (p < 0.0) {
			p += 2.0;
		}
		return (p < 1.0) ? p : (2.0 - p);
	};
	const double kPi = 3.14159265358979323846;
	const double radToDeg = 180.0 / kPi;
	const double degToRad = kPi / 180.0;
	const double maxSafeInteger = 9007199254740991.0;

	auto* mathTable = m_cpu.createTable();
	mathTable->set(key("abs"), m_cpu.createNativeFunction("math.abs", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::abs(value)));
	}));
	mathTable->set(key("acos"), m_cpu.createNativeFunction("math.acos", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::acos(value)));
	}));
	mathTable->set(key("asin"), m_cpu.createNativeFunction("math.asin", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::asin(value)));
	}));
	mathTable->set(key("atan"), m_cpu.createNativeFunction("math.atan", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double y = asNumber(args.at(0));
		if (args.size() > 1) {
			double x = asNumber(args.at(1));
			out.push_back(valueNumber(std::atan2(y, x)));
			return;
		}
		out.push_back(valueNumber(std::atan(y)));
	}));
	mathTable->set(key("ceil"), m_cpu.createNativeFunction("math.ceil", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::ceil(value)));
	}));
	mathTable->set(key("cos"), m_cpu.createNativeFunction("math.cos", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::cos(value)));
	}));
	mathTable->set(key("deg"), m_cpu.createNativeFunction("math.deg", [radToDeg](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(value * radToDeg));
	}));
	mathTable->set(key("exp"), m_cpu.createNativeFunction("math.exp", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::exp(value)));
	}));
	mathTable->set(key("floor"), m_cpu.createNativeFunction("math.floor", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::floor(value)));
	}));
	mathTable->set(key("fmod"), m_cpu.createNativeFunction("math.fmod", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		double divisor = asNumber(args.at(1));
		out.push_back(valueNumber(std::fmod(value, divisor)));
	}));
	mathTable->set(key("log"), m_cpu.createNativeFunction("math.log", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		if (args.size() > 1) {
			double base = asNumber(args.at(1));
			out.push_back(valueNumber(std::log(value) / std::log(base)));
			return;
		}
		out.push_back(valueNumber(std::log(value)));
	}));
	mathTable->set(key("max"), m_cpu.createNativeFunction("math.max", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double result = asNumber(args.at(0));
		for (size_t i = 1; i < args.size(); ++i) {
			result = std::max(result, asNumber(args[i]));
		}
		out.push_back(valueNumber(result));
	}));
	mathTable->set(key("min"), m_cpu.createNativeFunction("math.min", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double result = asNumber(args.at(0));
		for (size_t i = 1; i < args.size(); ++i) {
			result = std::min(result, asNumber(args[i]));
		}
		out.push_back(valueNumber(result));
	}));
	mathTable->set(key("modf"), m_cpu.createNativeFunction("math.modf", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		double intPart = 0.0;
		double fracPart = std::modf(value, &intPart);
		out.push_back(valueNumber(intPart));
		out.push_back(valueNumber(fracPart));
	}));
	mathTable->set(key("rad"), m_cpu.createNativeFunction("math.rad", [degToRad](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(value * degToRad));
	}));
	mathTable->set(key("sin"), m_cpu.createNativeFunction("math.sin", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::sin(value)));
	}));
	mathTable->set(key("sqrt"), m_cpu.createNativeFunction("math.sqrt", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::sqrt(value)));
	}));
	mathTable->set(key("tan"), m_cpu.createNativeFunction("math.tan", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::tan(value)));
	}));
	mathTable->set(key("tointeger"), m_cpu.createNativeFunction("math.tointeger", [](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& v = args.empty() ? valueNil() : args.at(0);
		if (!valueIsNumber(v)) {
			out.push_back(valueNil());
			return;
		}
		double value = valueToNumber(v);
		if (!std::isfinite(value)) {
			out.push_back(valueNil());
			return;
		}
		double intPart = std::trunc(value);
		if (intPart == value) {
			out.push_back(valueNumber(intPart));
			return;
		}
		out.push_back(valueNil());
	}));
	mathTable->set(key("type"), m_cpu.createNativeFunction("math.type", [str](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& v = args.empty() ? valueNil() : args.at(0);
		if (!valueIsNumber(v)) {
			out.push_back(valueNil());
			return;
		}
		double value = valueToNumber(v);
		if (std::trunc(value) == value) {
			out.push_back(str("integer"));
			return;
		}
		out.push_back(str("float"));
	}));
	mathTable->set(key("ult"), m_cpu.createNativeFunction("math.ult", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double leftValue = asNumber(args.at(0));
		double rightValue = asNumber(args.at(1));
		uint32_t left = static_cast<uint32_t>(static_cast<int64_t>(std::trunc(leftValue)));
		uint32_t right = static_cast<uint32_t>(static_cast<int64_t>(std::trunc(rightValue)));
		out.push_back(valueBool(left < right));
	}));
	mathTable->set(key("random"), m_cpu.createNativeFunction("math.random", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		double randomValue = nextVmRandom();
		if (args.empty()) {
			out.push_back(valueNumber(randomValue));
			return;
		}
		if (args.size() == 1) {
			int upper = static_cast<int>(std::floor(asNumber(args.at(0))));
			if (upper < 1) {
				throw BMSX_RUNTIME_ERROR("math.random upper bound must be positive.");
			}
			out.push_back(valueNumber(static_cast<double>(static_cast<int>(randomValue * upper) + 1)));
			return;
		}
		int lower = static_cast<int>(std::floor(asNumber(args.at(0))));
		int upper = static_cast<int>(std::floor(asNumber(args.at(1))));
		if (upper < lower) {
			throw BMSX_RUNTIME_ERROR("math.random upper bound must be greater than or equal to lower bound.");
		}
		int span = upper - lower + 1;
		out.push_back(valueNumber(static_cast<double>(lower + static_cast<int>(randomValue * span))));
	}));
	mathTable->set(key("randomseed"), m_cpu.createNativeFunction("math.randomseed", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		double seedValue = args.empty() ? EngineCore::instance().clock()->now() : asNumber(args.at(0));
		uint64_t seed = static_cast<uint64_t>(std::floor(seedValue));
		m_vmRandomSeedValue = static_cast<uint32_t>(seed & 0xffffffffu);
		(void)out;
	}));
	mathTable->set(key("huge"), valueNumber(std::numeric_limits<double>::infinity()));
	mathTable->set(key("maxinteger"), valueNumber(maxSafeInteger));
	mathTable->set(key("mininteger"), valueNumber(-maxSafeInteger));
	mathTable->set(key("pi"), valueNumber(kPi));

	auto* easingTable = m_cpu.createTable();
	easingTable->set(key("linear"), m_cpu.createNativeFunction("easing.linear", [clamp01](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(clamp01(value)));
	}));
	easingTable->set(key("ease_in_quad"), m_cpu.createNativeFunction("easing.ease_in_quad", [clamp01](const std::vector<Value>& args, std::vector<Value>& out) {
		double x = clamp01(asNumber(args.at(0)));
		out.push_back(valueNumber(x * x));
	}));
	easingTable->set(key("ease_out_quad"), m_cpu.createNativeFunction("easing.ease_out_quad", [clamp01](const std::vector<Value>& args, std::vector<Value>& out) {
		double x = clamp01(1.0 - asNumber(args.at(0)));
		out.push_back(valueNumber(1.0 - (x * x)));
	}));
	easingTable->set(key("ease_in_out_quad"), m_cpu.createNativeFunction("easing.ease_in_out_quad", [clamp01](const std::vector<Value>& args, std::vector<Value>& out) {
		double x = clamp01(asNumber(args.at(0)));
		if (x < 0.5) {
			out.push_back(valueNumber(2.0 * x * x));
			return;
		}
		double y = (-2.0 * x) + 2.0;
		out.push_back(valueNumber(1.0 - ((y * y) / 2.0)));
	}));
	easingTable->set(key("ease_out_back"), m_cpu.createNativeFunction("easing.ease_out_back", [clamp01](const std::vector<Value>& args, std::vector<Value>& out) {
		double x = clamp01(asNumber(args.at(0)));
		const double c1 = 1.70158;
		const double c3 = c1 + 1.0;
		out.push_back(valueNumber(1.0 + (c3 * std::pow(x - 1.0, 3.0)) + (c1 * std::pow(x - 1.0, 2.0))));
	}));
	easingTable->set(key("smoothstep"), m_cpu.createNativeFunction("easing.smoothstep", [smoothstep01](const std::vector<Value>& args, std::vector<Value>& out) {
		out.push_back(valueNumber(smoothstep01(asNumber(args.at(0)))));
	}));
	easingTable->set(key("pingpong01"), m_cpu.createNativeFunction("easing.pingpong01", [pingpong01](const std::vector<Value>& args, std::vector<Value>& out) {
		out.push_back(valueNumber(pingpong01(asNumber(args.at(0)))));
	}));
	easingTable->set(key("arc01"), m_cpu.createNativeFunction("easing.arc01", [smoothstep01](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		if (value <= 0.5) {
			out.push_back(valueNumber(smoothstep01(value * 2.0)));
			return;
		}
		out.push_back(valueNumber(smoothstep01((1.0 - value) * 2.0)));
	}));

	setGlobal("math", valueTable(mathTable));
	setGlobal("easing", valueTable(easingTable));
	setGlobal("SYS_BOOT_CART", valueNumber(static_cast<double>(IO_SYS_BOOT_CART)));
	setGlobal("SYS_CART_BOOTREADY", valueNumber(static_cast<double>(IO_SYS_CART_BOOTREADY)));
	setGlobal("SYS_CART_MAGIC_ADDR", valueNumber(static_cast<double>(CART_ROM_MAGIC_ADDR)));
	setGlobal("SYS_CART_MAGIC", valueNumber(static_cast<double>(CART_ROM_MAGIC)));
	setGlobal("SYS_VDP_DITHER", valueNumber(static_cast<double>(IO_VDP_DITHER)));

	registerNativeFunction("peek", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		uint32_t address = static_cast<uint32_t>(asNumber(args.at(0)));
		out.push_back(m_memory.readValue(address));
	});

	registerNativeFunction("poke", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		uint32_t address = static_cast<uint32_t>(asNumber(args.at(0)));
		m_memory.writeValue(address, args.at(1));
		(void)out;
	});

	registerNativeFunction("type", [str](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& v = args.empty() ? valueNil() : args.at(0);
		if (isNil(v)) { out.push_back(str("nil")); return; }
		if (valueIsBool(v)) { out.push_back(str("boolean")); return; }
		if (valueIsNumber(v)) { out.push_back(str("number")); return; }
		if (valueIsString(v)) { out.push_back(str("string")); return; }
		if (valueIsTable(v)) { out.push_back(str("table")); return; }
		if (valueIsClosure(v)) { out.push_back(str("function")); return; }
		if (valueIsNativeFunction(v)) { out.push_back(str("function")); return; }
		if (valueIsNativeObject(v)) { out.push_back(str("native")); return; }
		out.push_back(str("function"));
	});

	registerNativeFunction("tostring", [this, str](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& v = args.empty() ? valueNil() : args.at(0);
		out.push_back(str(vmToString(v)));
	});

	registerNativeFunction("tonumber", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		if (args.empty()) {
			out.push_back(valueNil());
			return;
		}
		const Value& v = args.at(0);
		if (valueIsNumber(v)) {
			out.push_back(v);
			return;
		}
		if (valueIsString(v)) {
			const std::string& text = m_cpu.stringPool().toString(asStringId(v));
			if (args.size() >= 2) {
				int base = static_cast<int>(std::floor(asNumber(args.at(1))));
				if (base >= 2 && base <= 36) {
					std::string trimmed = text;
					size_t start = trimmed.find_first_not_of(" \t\n\r");
					size_t end = trimmed.find_last_not_of(" \t\n\r");
					if (start == std::string::npos) {
						out.push_back(valueNil());
						return;
					}
					trimmed = trimmed.substr(start, end - start + 1);
					char* parseEnd = nullptr;
					long parsed = std::strtol(trimmed.c_str(), &parseEnd, base);
					if (parseEnd == trimmed.c_str()) {
						out.push_back(valueNil());
						return;
					}
					out.push_back(valueNumber(static_cast<double>(parsed)));
					return;
				}
				out.push_back(valueNil());
				return;
			}
			char* end = nullptr;
			double parsed = std::strtod(text.c_str(), &end);
			if (end == text.c_str() || !std::isfinite(parsed)) {
				out.push_back(valueNil());
				return;
			}
			out.push_back(valueNumber(parsed));
			return;
		}
		out.push_back(valueNil());
	});

	registerNativeFunction("assert", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& condition = args.empty() ? valueNil() : args.at(0);
		if (!isTruthy(condition)) {
			const std::string message = args.size() > 1 ? vmToString(args.at(1)) : std::string("assertion failed!");
			throw BMSX_RUNTIME_ERROR(message);
		}
		out.insert(out.end(), args.begin(), args.end());
	});

registerNativeFunction("error", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string message = args.empty() ? std::string("error") : vmToString(args.at(0));
	(void)out;
	throw BMSX_RUNTIME_ERROR(message);
});

	registerNativeFunction("setmetatable", [](const std::vector<Value>& args, std::vector<Value>& out) {
		auto* tbl = asTable(args.at(0));
		if (isNil(args.at(1))) {
			tbl->setMetatable(nullptr);
		} else {
			tbl->setMetatable(asTable(args.at(1)));
		}
		out.push_back(valueTable(tbl));
	});

	registerNativeFunction("getmetatable", [](const std::vector<Value>& args, std::vector<Value>& out) {
		auto* tbl = asTable(args.at(0));
		auto* mt = tbl->getMetatable();
		out.push_back(mt ? valueTable(mt) : valueNil());
	});

	registerNativeFunction("rawequal", [](const std::vector<Value>& args, std::vector<Value>& out) {
		out.push_back(valueBool(args.at(0) == args.at(1)));
	});

	registerNativeFunction("rawget", [](const std::vector<Value>& args, std::vector<Value>& out) {
		auto* tbl = asTable(args.at(0));
		Value key = args.size() > 1 ? args.at(1) : valueNil();
		out.push_back(tbl->get(key));
	});

	registerNativeFunction("rawset", [](const std::vector<Value>& args, std::vector<Value>& out) {
		auto* tbl = asTable(args.at(0));
		Value key = args.at(1);
		Value value = args.size() > 2 ? args.at(2) : valueNil();
		tbl->set(key, value);
		out.push_back(valueTable(tbl));
	});

	registerNativeFunction("select", [](const std::vector<Value>& args, std::vector<Value>& out) {
		if (valueIsString(args.at(0)) && VMRuntime::instance().cpu().stringPool().toString(asStringId(args.at(0))) == "#") {
			out.push_back(valueNumber(static_cast<double>(args.size() - 1)));
			return;
		}
		int count = static_cast<int>(args.size()) - 1;
		int start = static_cast<int>(asNumber(args.at(0)));
		if (start < 0) {
			start = count + start + 1;
		}
		for (int i = start; i <= count; ++i) {
			if (i >= 1 && static_cast<size_t>(i) < args.size()) {
				out.push_back(args[static_cast<size_t>(i)]);
			}
		}
	});

	registerNativeFunction("pcall", [callVmValue, logPcallError, str](const std::vector<Value>& args, std::vector<Value>& out) {
		Value fn = args.at(0);
		std::vector<Value> callArgs;
		for (size_t i = 1; i < args.size(); ++i) {
			callArgs.push_back(args[i]);
		}
		try {
			callVmValue(fn, callArgs, out);
			out.insert(out.begin(), valueBool(true));
		} catch (const std::exception& e) {
			logPcallError(e.what());
			out.clear();
			out.push_back(valueBool(false));
			out.push_back(str(e.what()));
		} catch (...) {
			logPcallError("error");
			out.clear();
			out.push_back(valueBool(false));
			out.push_back(str("error"));
		}
	});

	registerNativeFunction("xpcall", [callVmValue, logPcallError, str](const std::vector<Value>& args, std::vector<Value>& out) {
		Value fn = args.at(0);
		Value handler = args.at(1);
		std::vector<Value> callArgs;
		for (size_t i = 2; i < args.size(); ++i) {
			callArgs.push_back(args[i]);
		}
		try {
			callVmValue(fn, callArgs, out);
			out.insert(out.begin(), valueBool(true));
		} catch (const std::exception& e) {
			logPcallError(e.what());
			std::vector<Value> handlerArgs;
			handlerArgs.push_back(str(e.what()));
			callVmValue(handler, handlerArgs, out);
			out.insert(out.begin(), valueBool(false));
		} catch (...) {
			logPcallError("error");
			std::vector<Value> handlerArgs;
			handlerArgs.push_back(str("error"));
			callVmValue(handler, handlerArgs, out);
			out.insert(out.begin(), valueBool(false));
		}
	});

	registerNativeFunction("require", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const std::string& moduleName = m_cpu.stringPool().toString(asStringId(args.at(0)));
		size_t start = moduleName.find_first_not_of(" \t\n\r");
		if (start == std::string::npos) {
			out.push_back(requireVmModule(""));
			return;
		}
		size_t end = moduleName.find_last_not_of(" \t\n\r");
		out.push_back(requireVmModule(moduleName.substr(start, end - start + 1)));
	});

	const Value lengthKey = key("length");
	const StringId lengthId = asStringId(lengthKey);
	registerNativeFunction("array", [this, lengthId](const std::vector<Value>& args, std::vector<Value>& out) {
		struct NativeArray {
			std::vector<Value> values;
			std::unordered_map<StringId, Value> props;
			std::vector<StringId> propOrder;
		};

		auto data = std::make_shared<NativeArray>();
		if (args.size() == 1 && valueIsTable(args.at(0))) {
			const auto* tbl = asTable(args.at(0));
			const auto entries = tbl->entries();
			for (const auto& [key, value] : entries) {
				if (valueIsNumber(key)) {
					double n = valueToNumber(key);
					double intpart = 0.0;
					if (std::modf(n, &intpart) == 0.0 && n >= 1.0) {
						int index = static_cast<int>(n) - 1;
						if (index >= static_cast<int>(data->values.size())) {
							data->values.resize(static_cast<size_t>(index + 1));
						}
						data->values[static_cast<size_t>(index)] = value;
						continue;
					}
				}
				data->values.push_back(value);
			}
		} else {
			data->values.assign(args.begin(), args.end());
		}

		auto native = m_cpu.createNativeObject(
			data.get(),
			[data, lengthId](const Value& key) -> Value {
				if (valueIsNumber(key)) {
					double n = valueToNumber(key);
					double intpart = 0.0;
					if (std::modf(n, &intpart) == 0.0 && n >= 1.0) {
						int index = static_cast<int>(n) - 1;
						if (index >= static_cast<int>(data->values.size())) {
							return valueNil();
						}
						return data->values[static_cast<size_t>(index)];
					}
				}
				if (valueIsString(key)) {
					StringId id = asStringId(key);
					if (id == lengthId) {
						return valueNumber(static_cast<double>(data->values.size()));
					}
					const auto it = data->props.find(id);
					if (it != data->props.end()) {
						return it->second;
					}
					return valueNil();
				}
				throw BMSX_RUNTIME_ERROR("Attempted to index native array with unsupported key.");
			},
			[data](const Value& key, const Value& value) {
				if (valueIsNumber(key)) {
					double n = valueToNumber(key);
					double intpart = 0.0;
					if (std::modf(n, &intpart) == 0.0 && n >= 1.0) {
						int index = static_cast<int>(n) - 1;
						if (index >= static_cast<int>(data->values.size())) {
							data->values.resize(static_cast<size_t>(index + 1));
						}
						data->values[static_cast<size_t>(index)] = value;
						return;
					}
				}
				if (valueIsString(key)) {
					StringId id = asStringId(key);
					if (!data->props.count(id)) {
						data->propOrder.push_back(id);
					}
					data->props[id] = value;
					return;
				}
				throw BMSX_RUNTIME_ERROR("Attempted to index native array with unsupported key.");
			},
			[data]() -> int {
				return static_cast<int>(data->values.size());
			},
			[data](const Value& after) -> std::optional<std::pair<Value, Value>> {
				std::vector<Value> keys;
				for (size_t i = 0; i < data->values.size(); ++i) {
					if (!isNil(data->values[i])) {
						keys.emplace_back(valueNumber(static_cast<double>(i + 1)));
					}
				}
				for (const auto& id : data->propOrder) {
					const auto it = data->props.find(id);
					if (it == data->props.end()) {
						continue;
					}
					if (isNil(it->second)) {
						continue;
					}
					keys.emplace_back(valueString(id));
				}
				if (keys.empty()) {
					return std::nullopt;
				}
				size_t nextIndex = 0;
				if (!isNil(after)) {
					nextIndex = static_cast<size_t>(-1);
					for (size_t i = 0; i < keys.size(); ++i) {
						if (keys[i] == after) {
							nextIndex = i + 1;
							break;
						}
					}
					if (nextIndex == static_cast<size_t>(-1) || nextIndex >= keys.size()) {
						return std::nullopt;
					}
				}
				const Value key = keys[nextIndex];
				if (valueIsNumber(key)) {
					int index = static_cast<int>(valueToNumber(key)) - 1;
					return std::make_pair(key, data->values[static_cast<size_t>(index)]);
				}
				StringId id = asStringId(key);
				return std::make_pair(key, data->props[id]);
			},
			[data](VMHeap& heap) {
				for (const auto& value : data->values) {
					heap.markValue(value);
				}
				for (const auto& entry : data->props) {
					heap.markValue(entry.second);
				}
			}
		);

		out.push_back(native);
	});

	registerNativeFunction("print", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		std::string text;
		for (size_t i = 0; i < args.size(); ++i) {
			if (i > 0) {
				text += '\t';
			}
			text += vmToString(args[i]);
		}
		std::cout << text << '\n';
		(void)out;
	});

auto* stringTable = m_cpu.createTable();
stringTable->set(key("len"), m_cpu.createNativeFunction("string.len", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	StringId textId = asStringId(args.at(0));
	out.push_back(valueNumber(static_cast<double>(m_cpu.stringPool().codepointCount(textId))));
}));
stringTable->set(key("upper"), m_cpu.createNativeFunction("string.upper", [str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	out.push_back(str(utf8_to_upper(asText(args.at(0)))));
}));
stringTable->set(key("lower"), m_cpu.createNativeFunction("string.lower", [str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	out.push_back(str(utf8_to_lower(asText(args.at(0)))));
}));
stringTable->set(key("rep"), m_cpu.createNativeFunction("string.rep", [str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	int count = args.size() > 1 ? static_cast<int>(std::floor(asNumber(args.at(1)))) : 1;
	if (count <= 0) {
		out.push_back(str(""));
		return;
	}
	bool hasSeparator = args.size() > 2 && !isNil(args.at(2));
	std::string separator = hasSeparator ? std::string(asText(args.at(2))) : std::string();
	std::string result;
	if (hasSeparator) {
		for (int i = 0; i < count; ++i) {
			if (i > 0) {
				result += separator;
			}
			result += text;
		}
	} else {
		result.reserve(text.size() * static_cast<size_t>(count));
		for (int i = 0; i < count; ++i) {
			result += text;
		}
	}
	out.push_back(str(result));
}));
stringTable->set(key("sub"), m_cpu.createNativeFunction("string.sub", [this, str](const std::vector<Value>& args, std::vector<Value>& out) {
	StringId textId = asStringId(args.at(0));
	const std::string& text = m_cpu.stringPool().toString(textId);
	int length = m_cpu.stringPool().codepointCount(textId);
		auto normalizeIndex = [length](double value) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return 1;
		};
	int startIndex = args.size() > 1 ? normalizeIndex(asNumber(args.at(1))) : 1;
	int endIndex = args.size() > 2 ? normalizeIndex(asNumber(args.at(2))) : length;
		if (startIndex < 1) startIndex = 1;
		if (endIndex > length) endIndex = length;
		if (endIndex < startIndex) {
		out.push_back(str(""));
		return;
	}
	size_t startByte = utf8_byte_index_from_codepoint(text, startIndex);
	size_t endByte = utf8_byte_index_from_codepoint(text, endIndex + 1);
	out.push_back(str(text.substr(startByte, endByte - startByte)));
}));
stringTable->set(key("find"), m_cpu.createNativeFunction("string.find", [this, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	StringId sourceId = asStringId(args.at(0));
	const std::string& source = m_cpu.stringPool().toString(sourceId);
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	int length = m_cpu.stringPool().codepointCount(sourceId);
		auto normalizeIndex = [length](double value) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return 1;
		};
	int startIndex = args.size() > 2 ? normalizeIndex(asNumber(args.at(2))) : 1;
	if (startIndex > length) {
		out.push_back(valueNil());
		return;
	}
	size_t startByte = utf8_byte_index_from_codepoint(source, startIndex);
	bool plain = args.size() > 3 && valueIsBool(args.at(3)) && valueToBool(args.at(3)) == true;
	if (plain) {
		size_t position = source.find(pattern, startByte);
		if (position == std::string::npos) {
			out.push_back(valueNil());
			return;
		}
		int first = utf8_codepoint_index_from_byte(source, position);
		int last = utf8_codepoint_index_from_byte(source, position + pattern.length()) - 1;
		out.push_back(valueNumber(static_cast<double>(first)));
		out.push_back(valueNumber(static_cast<double>(last)));
		return;
	}
		const std::regex& regex = buildLuaPatternRegex(pattern);
		std::smatch match;
		auto begin = source.cbegin() + static_cast<std::string::difference_type>(startByte);
		if (!std::regex_search(begin, source.cend(), match, regex)) {
			out.push_back(valueNil());
			return;
		}
	size_t matchStartByte = startByte + static_cast<size_t>(match.position());
	size_t matchEndByte = matchStartByte + static_cast<size_t>(match.length());
	int first = utf8_codepoint_index_from_byte(source, matchStartByte);
	int last = utf8_codepoint_index_from_byte(source, matchEndByte) - 1;
	if (match.size() > 1) {
		out.push_back(valueNumber(static_cast<double>(first)));
		out.push_back(valueNumber(static_cast<double>(last)));
		for (size_t i = 1; i < match.size(); ++i) {
			if (!match[i].matched) {
				out.push_back(valueNil());
			} else {
				out.push_back(str(match[i].str()));
			}
		}
		return;
	}
	out.push_back(valueNumber(static_cast<double>(first)));
	out.push_back(valueNumber(static_cast<double>(last)));
}));
stringTable->set(key("match"), m_cpu.createNativeFunction("string.match", [this, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	StringId sourceId = asStringId(args.at(0));
	const std::string& source = m_cpu.stringPool().toString(sourceId);
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	int length = m_cpu.stringPool().codepointCount(sourceId);
	auto normalizeIndex = [length](double value) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return 1;
	};
	int startIndex = args.size() > 2 ? normalizeIndex(asNumber(args.at(2))) : 1;
	if (startIndex > length) {
		out.push_back(valueNil());
		return;
	}
	const std::regex& regex = buildLuaPatternRegex(pattern);
	size_t startByte = utf8_byte_index_from_codepoint(source, startIndex);
	std::smatch match;
	auto begin = source.cbegin() + static_cast<std::string::difference_type>(startByte);
	if (!std::regex_search(begin, source.cend(), match, regex)) {
		out.push_back(valueNil());
		return;
	}
	if (match.size() > 1) {
		for (size_t i = 1; i < match.size(); ++i) {
			if (!match[i].matched) {
				out.push_back(valueNil());
			} else {
				out.push_back(str(match[i].str()));
			}
		}
		return;
	}
	out.push_back(str(match[0].str()));
}));
stringTable->set(key("gsub"), m_cpu.createNativeFunction("string.gsub", [this, callVmValue, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& source = asText(args.at(0));
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	const Value replacement = args.size() > 2 ? args.at(2) : str("");
	int maxReplacements = args.size() > 3 && !isNil(args.at(3)) ? std::max(0, static_cast<int>(std::floor(asNumber(args.at(3))))) : std::numeric_limits<int>::max();

	const std::regex& regex = buildLuaPatternRegex(pattern);
	size_t count = 0;
	size_t searchIndex = 0;
	size_t lastIndex = 0;
	std::string result;
	std::vector<Value> fnArgs = acquireValueScratch();
	std::vector<Value> fnResults = acquireValueScratch();

	auto renderReplacement = [&](const std::smatch& match) -> std::string {
		if (valueIsString(replacement) || valueIsNumber(replacement)) {
			const std::string templateStr = vmToString(replacement);
			std::string output;
				for (size_t i = 0; i < templateStr.size(); ++i) {
					if (templateStr[i] == '%' && i + 1 < templateStr.size()) {
						char token = templateStr[i + 1];
						if (token == '%') {
							output.push_back('%');
							++i;
							continue;
						}
						if (token >= '0' && token <= '9') {
							int index = token - '0';
							if (index == 0) {
								output += match[0].str();
							} else if (static_cast<size_t>(index) < match.size() && match[index].matched) {
								output += match[index].str();
							}
							++i;
							continue;
						}
					}
					output.push_back(templateStr[i]);
				}
				return output;
		}
		if (valueIsTable(replacement)) {
			if (match.size() > 1 && !match[1].matched) {
				return match[0].str();
			}
			Value key = match.size() > 1 ? str(match[1].str()) : str(match[0].str());
			Value mapped = asTable(replacement)->get(key);
			if (isNil(mapped)) {
				return match[0].str();
			}
			return vmToString(mapped);
		}
			if (valueIsNativeFunction(replacement) || valueIsClosure(replacement)) {
				fnArgs.clear();
				fnResults.clear();
				if (match.size() > 1) {
					for (size_t i = 1; i < match.size(); ++i) {
						if (match[i].matched) {
							fnArgs.emplace_back(str(match[i].str()));
						} else {
							fnArgs.emplace_back(valueNil());
						}
					}
				} else {
					fnArgs.emplace_back(str(match[0].str()));
				}
				callVmValue(replacement, fnArgs, fnResults);
				Value value = fnResults.empty() ? valueNil() : fnResults[0];
				if (isNil(value) || (valueIsBool(value) && !valueToBool(value))) {
					return match[0].str();
				}
				return vmToString(value);
			}
			throw BMSX_RUNTIME_ERROR("string.gsub replacement must be a string, number, function, or table.");
		};

		while (count < static_cast<size_t>(maxReplacements)) {
			std::smatch match;
			auto begin = source.begin() + static_cast<std::string::difference_type>(searchIndex);
			if (!std::regex_search(begin, source.end(), match, regex)) {
				break;
			}
			size_t matchStart = searchIndex + static_cast<size_t>(match.position());
			size_t matchEnd = matchStart + static_cast<size_t>(match.length());
			result += source.substr(lastIndex, matchStart - lastIndex);
			result += renderReplacement(match);
			lastIndex = matchEnd;
			count += 1;
			if (match.length() == 0) {
				searchIndex = matchEnd + 1;
				if (searchIndex > source.length()) {
					break;
				}
			} else {
				searchIndex = matchEnd;
			}
	}

	result += source.substr(lastIndex);
	out.push_back(str(result));
	out.push_back(valueNumber(static_cast<double>(count)));
	releaseValueScratch(std::move(fnResults));
	releaseValueScratch(std::move(fnArgs));
}));
stringTable->set(key("gmatch"), m_cpu.createNativeFunction("string.gmatch", [this, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	struct GMatchState {
		const std::regex* regex = nullptr;
		std::string source;
		size_t index = 0;
	};
	const std::string& source = asText(args.at(0));
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	const std::regex& regex = buildLuaPatternRegex(pattern);
	auto state = std::make_shared<GMatchState>();
	state->regex = &regex;
	state->source = source;
	state->index = 0;
	auto iterator = m_cpu.createNativeFunction("string.gmatch.iterator", [state, str](const std::vector<Value>& args, std::vector<Value>& out) {
		(void)args;
		if (state->index > state->source.size()) {
			out.push_back(valueNil());
			return;
		}
		std::smatch match;
		auto begin = state->source.cbegin() + static_cast<std::string::difference_type>(state->index);
		if (!std::regex_search(begin, state->source.cend(), match, *state->regex)) {
			out.push_back(valueNil());
			return;
		}
		size_t matchStart = state->index + static_cast<size_t>(match.position());
		size_t matchEnd = matchStart + static_cast<size_t>(match.length());
			if (match.length() == 0) {
				state->index = matchEnd + 1;
			} else {
				state->index = matchEnd;
			}
			if (match.size() > 1) {
				for (size_t i = 1; i < match.size(); ++i) {
					if (match[i].matched) {
						out.emplace_back(str(match[i].str()));
					} else {
						out.emplace_back(valueNil());
					}
				}
				return;
			}
			out.push_back(str(match[0].str()));
		});
		out.push_back(iterator);
	}));
stringTable->set(key("byte"), m_cpu.createNativeFunction("string.byte", [asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& source = asText(args.at(0));
	int position = args.size() > 1 ? static_cast<int>(std::floor(asNumber(args.at(1)))) : 1;
	if (position < 1) {
		out.push_back(valueNil());
		return;
	}
	size_t byteIndex = utf8_byte_index_from_codepoint(source, position);
	if (byteIndex >= source.size()) {
		out.push_back(valueNil());
		return;
	}
	uint32_t codepoint = utf8_codepoint_at(source, byteIndex);
	out.push_back(valueNumber(static_cast<double>(codepoint)));
}));
stringTable->set(key("char"), m_cpu.createNativeFunction("string.char", [str](const std::vector<Value>& args, std::vector<Value>& out) {
	if (args.empty()) {
		out.push_back(str(""));
		return;
	}
	std::string result;
	result.reserve(args.size());
	for (const auto& arg : args) {
		uint32_t codepoint = static_cast<uint32_t>(std::floor(asNumber(arg)));
		utf8_append_codepoint(result, codepoint);
	}
	out.push_back(str(result));
}));
stringTable->set(key("format"), m_cpu.createNativeFunction("string.format", [this, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& templateStr = asText(args.at(0));
	out.push_back(str(formatVmString(templateStr, args, 1)));
}));

	setGlobal("string", valueTable(stringTable));

	auto* tableLib = m_cpu.createTable();
tableLib->set(key("insert"), m_cpu.createNativeFunction("table.insert", [](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	int position = 0;
	Value value;
	if (args.size() == 2) {
			value = args.at(1);
			position = tbl->length() + 1;
		} else {
			position = static_cast<int>(std::floor(asNumber(args.at(1))));
			value = args.at(2);
		}
		int length = tbl->length();
	for (int i = length; i >= position; --i) {
		tbl->set(valueNumber(static_cast<double>(i + 1)), tbl->get(valueNumber(static_cast<double>(i))));
	}
	tbl->set(valueNumber(static_cast<double>(position)), value);
	(void)out;
}));
tableLib->set(key("remove"), m_cpu.createNativeFunction("table.remove", [](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	int position = args.size() > 1 ? static_cast<int>(std::floor(asNumber(args.at(1)))) : tbl->length();
	int length = tbl->length();
	Value removed = tbl->get(valueNumber(static_cast<double>(position)));
		for (int i = position; i < length; ++i) {
			tbl->set(valueNumber(static_cast<double>(i)), tbl->get(valueNumber(static_cast<double>(i + 1))));
	}
	tbl->set(valueNumber(static_cast<double>(length)), valueNil());
	if (isNil(removed)) {
		return;
	}
	out.push_back(removed);
}));
tableLib->set(key("concat"), m_cpu.createNativeFunction("table.concat", [this, str](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	const std::string separator = args.size() > 1 ? vmToString(args.at(1)) : std::string("");
	int length = tbl->length();
	auto normalizeIndex = [length](double value, int fallback) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return fallback;
		};
	int startIndex = args.size() > 2 ? normalizeIndex(asNumber(args.at(2)), 1) : 1;
	int endIndex = args.size() > 3 ? normalizeIndex(asNumber(args.at(3)), length) : length;
	if (endIndex < startIndex) {
		out.push_back(str(""));
		return;
	}
	std::string output;
	for (int i = startIndex; i <= endIndex; ++i) {
		if (i > startIndex) {
				output += separator;
			}
			Value value = tbl->get(valueNumber(static_cast<double>(i)));
		if (!isNil(value)) {
			output += vmToString(value);
		}
	}
	out.push_back(str(output));
}));
const Value packCountKey = key("n");
tableLib->set(key("pack"), m_cpu.createNativeFunction("table.pack", [this, packCountKey](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = m_cpu.createTable(static_cast<int>(args.size()), 1);
	for (size_t i = 0; i < args.size(); ++i) {
		tbl->set(valueNumber(static_cast<double>(i + 1)), args[i]);
	}
	tbl->set(packCountKey, valueNumber(static_cast<double>(args.size())));
	out.push_back(valueTable(tbl));
}));
tableLib->set(key("unpack"), m_cpu.createNativeFunction("table.unpack", [](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	int length = tbl->length();
	auto normalizeIndex = [length](double value, int fallback) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return fallback;
		};
	int startIndex = args.size() > 1 ? normalizeIndex(asNumber(args.at(1)), 1) : 1;
	int endIndex = args.size() > 2 ? normalizeIndex(asNumber(args.at(2)), length) : length;
	if (endIndex < startIndex) {
		return;
	}
	for (int i = startIndex; i <= endIndex; ++i) {
		out.push_back(tbl->get(valueNumber(static_cast<double>(i))));
	}
}));
tableLib->set(key("sort"), m_cpu.createNativeFunction("table.sort", [this, callVmValue](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	Value comparator = args.size() > 1 ? args.at(1) : valueNil();
	int length = tbl->length();
	std::vector<Value> values = acquireValueScratch();
	values.resize(static_cast<size_t>(length));
	for (int i = 1; i <= length; ++i) {
		values[static_cast<size_t>(i - 1)] = tbl->get(valueNumber(static_cast<double>(i)));
	}
	std::vector<Value> comparatorArgs = acquireValueScratch();
	comparatorArgs.resize(2);
	std::vector<Value> comparatorResults = acquireValueScratch();
	std::sort(values.begin(), values.end(), [&](const Value& left, const Value& right) -> bool {
		if (!isNil(comparator)) {
			comparatorArgs[0] = left;
			comparatorArgs[1] = right;
			comparatorResults.clear();
			callVmValue(comparator, comparatorArgs, comparatorResults);
			return !comparatorResults.empty() && valueIsBool(comparatorResults[0]) && valueToBool(comparatorResults[0]) == true;
		}
		if (valueIsNumber(left) && valueIsNumber(right)) {
			return valueToNumber(left) < valueToNumber(right);
		}
		if (valueIsString(left) && valueIsString(right)) {
			return VMRuntime::instance().cpu().stringPool().toString(asStringId(left))
				< VMRuntime::instance().cpu().stringPool().toString(asStringId(right));
		}
		throw BMSX_RUNTIME_ERROR("table.sort comparison expects numbers or strings.");
	});
	for (int i = 1; i <= length; ++i) {
		tbl->set(valueNumber(static_cast<double>(i)), values[static_cast<size_t>(i - 1)]);
	}
	out.push_back(valueTable(tbl));
	releaseValueScratch(std::move(comparatorResults));
	releaseValueScratch(std::move(comparatorArgs));
	releaseValueScratch(std::move(values));
}));

	setGlobal("table", valueTable(tableLib));

auto* osTable = m_cpu.createTable();
const Value yearKey = key("year");
const Value monthKey = key("month");
const Value dayKey = key("day");
const Value hourKey = key("hour");
const Value minuteKey = key("min");
const Value secondKey = key("sec");
const Value wdayKey = key("wday");
const Value ydayKey = key("yday");
const Value isdstKey = key("isdst");
osTable->set(key("clock"), m_cpu.createNativeFunction("os.clock", [](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueNumber(EngineCore::instance().clock()->now() / 1000.0));
}));
osTable->set(key("time"), m_cpu.createNativeFunction("os.time", [yearKey, monthKey, dayKey, hourKey, minuteKey, secondKey](const std::vector<Value>& args, std::vector<Value>& out) {
	if (!args.empty() && !isNil(args.at(0))) {
		auto* table = asTable(args.at(0));
		std::tm timeInfo{};
		timeInfo.tm_year = static_cast<int>(asNumber(table->get(yearKey))) - 1900;
		timeInfo.tm_mon = static_cast<int>(asNumber(table->get(monthKey))) - 1;
		timeInfo.tm_mday = static_cast<int>(asNumber(table->get(dayKey)));
		timeInfo.tm_hour = static_cast<int>(asNumber(table->get(hourKey)));
		timeInfo.tm_min = static_cast<int>(asNumber(table->get(minuteKey)));
		timeInfo.tm_sec = static_cast<int>(asNumber(table->get(secondKey)));
		timeInfo.tm_isdst = -1;
		out.push_back(valueNumber(static_cast<double>(std::mktime(&timeInfo))));
		return;
	}
	out.push_back(valueNumber(static_cast<double>(std::time(nullptr))));
}));
osTable->set(key("difftime"), m_cpu.createNativeFunction("os.difftime", [](const std::vector<Value>& args, std::vector<Value>& out) {
	double t2 = asNumber(args.at(0));
	double t1 = asNumber(args.at(1));
	out.push_back(valueNumber(t2 - t1));
}));
osTable->set(key("date"), m_cpu.createNativeFunction("os.date", [str, yearKey, monthKey, dayKey, hourKey, minuteKey, secondKey, wdayKey, ydayKey, isdstKey](const std::vector<Value>& args, std::vector<Value>& out) {
	std::string format = args.empty() || isNil(args.at(0)) ? std::string("%c") : VMRuntime::instance().cpu().stringPool().toString(asStringId(args.at(0)));
	std::time_t timeValue = args.size() > 1 && !isNil(args.at(1))
		? static_cast<std::time_t>(asNumber(args.at(1)))
		: std::time(nullptr);
	std::tm timeInfo = *std::localtime(&timeValue);
	if (format == "*t") {
		auto* table = VMRuntime::instance().cpu().createTable(0, 9);
		table->set(yearKey, valueNumber(static_cast<double>(timeInfo.tm_year + 1900)));
		table->set(monthKey, valueNumber(static_cast<double>(timeInfo.tm_mon + 1)));
		table->set(dayKey, valueNumber(static_cast<double>(timeInfo.tm_mday)));
		table->set(hourKey, valueNumber(static_cast<double>(timeInfo.tm_hour)));
		table->set(minuteKey, valueNumber(static_cast<double>(timeInfo.tm_min)));
		table->set(secondKey, valueNumber(static_cast<double>(timeInfo.tm_sec)));
		table->set(wdayKey, valueNumber(static_cast<double>(timeInfo.tm_wday + 1)));
		table->set(ydayKey, valueNumber(static_cast<double>(timeInfo.tm_yday + 1)));
		table->set(isdstKey, valueBool(timeInfo.tm_isdst > 0));
		out.push_back(valueTable(table));
		return;
	}
	char buffer[256];
	size_t size = std::strftime(buffer, sizeof(buffer), format.c_str(), &timeInfo);
	out.push_back(str(std::string(buffer, size)));
}));
	setGlobal("os", valueTable(osTable));

auto nextFn = m_cpu.createNativeFunction("next", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const Value& target = args.at(0);
	const Value key = args.size() > 1 ? args.at(1) : valueNil();
	if (valueIsTable(target)) {
		auto entry = asTable(target)->nextEntry(key);
		if (!entry.has_value()) {
			out.push_back(valueNil());
			return;
		}
		out.push_back(entry->first);
		out.push_back(entry->second);
		return;
	}
	if (valueIsNativeObject(target)) {
		auto* obj = asNativeObject(target);
		if (!obj->nextEntry) {
			throw BMSX_RUNTIME_ERROR("next expects a native object with iteration.");
		}
		auto entry = obj->nextEntry(key);
		if (!entry.has_value()) {
			out.push_back(valueNil());
			return;
		}
		out.push_back(entry->first);
		out.push_back(entry->second);
		return;
	}
	throw BMSX_RUNTIME_ERROR("next expects a table or native object.");
});

m_ipairsIterator = m_cpu.createNativeFunction("ipairs.iterator", [](const std::vector<Value>& args, std::vector<Value>& out) {
	const Value& target = args.at(0);
	double index = 0.0;
	if (args.size() > 1 && valueIsNumber(args.at(1))) {
		index = valueToNumber(args.at(1));
	}
	double nextIndex = index + 1.0;
	if (valueIsTable(target)) {
		Value value = asTable(target)->get(valueNumber(nextIndex));
		if (isNil(value)) {
			out.push_back(valueNil());
			return;
		}
		out.push_back(valueNumber(nextIndex));
		out.push_back(value);
		return;
	}
	if (valueIsNativeObject(target)) {
		Value value = asNativeObject(target)->get(valueNumber(nextIndex));
		if (isNil(value)) {
			out.push_back(valueNil());
			return;
		}
		out.push_back(valueNumber(nextIndex));
		out.push_back(value);
		return;
	}
	throw BMSX_RUNTIME_ERROR("ipairs expects a table or native object.");
});

	setGlobal("next", nextFn);
	registerNativeFunction("pairs", [nextFn](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& target = args.at(0);
		if (!valueIsTable(target) && !valueIsNativeObject(target)) {
			throw BMSX_RUNTIME_ERROR("pairs expects a table or native object.");
		}
		out.push_back(nextFn);
		out.push_back(target);
		out.push_back(valueNil());
	});
	registerNativeFunction("ipairs", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& target = args.at(0);
		if (!valueIsTable(target) && !valueIsNativeObject(target)) {
			throw BMSX_RUNTIME_ERROR("ipairs expects a table or native object.");
		}
		out.push_back(m_ipairsIterator);
		out.push_back(target);
		out.push_back(valueNumber(0.0));
	});

	const RuntimeAssets& assets = EngineCore::instance().assets();
	auto* assetsTable = m_cpu.createTable();
	auto formatAssetKeyNumber = [](double value) -> std::string {
		if (value == 0.0) {
			return "0";
		}
		std::ostringstream oss;
		oss << std::fixed << std::setprecision(0) << value;
		return oss.str();
	};
	auto makeAssetMapNativeObject = [this, formatAssetKeyNumber](Table* mapTable) -> Value {
		return m_cpu.createNativeObject(
			mapTable,
			[this, mapTable, formatAssetKeyNumber](const Value& keyValue) -> Value {
				if (valueIsString(keyValue)) {
					Value value = mapTable->get(keyValue);
					if (isNil(value)) {
						const std::string& keyName = m_cpu.stringPool().toString(asStringId(keyValue));
						throw BMSX_RUNTIME_ERROR("Asset '" + keyName + "' does not exist.");
					}
					return value;
				}
				if (valueIsNumber(keyValue)) {
					double n = valueToNumber(keyValue);
					double intpart = 0.0;
					if (std::isfinite(n) && std::modf(n, &intpart) == 0.0) {
						std::string keyName = formatAssetKeyNumber(n);
						Value resolvedKey = valueString(m_cpu.internString(keyName));
						Value value = mapTable->get(resolvedKey);
						if (isNil(value)) {
							throw BMSX_RUNTIME_ERROR("Asset '" + keyName + "' does not exist.");
						}
						return value;
					}
				}
				throw BMSX_RUNTIME_ERROR("Attempted to retrieve an asset that did not use a string or integer key.");
			},
			[this, mapTable, formatAssetKeyNumber](const Value& keyValue, const Value& value) {
				if (valueIsString(keyValue)) {
					mapTable->set(keyValue, value);
					return;
				}
				if (valueIsNumber(keyValue)) {
					double n = valueToNumber(keyValue);
					double intpart = 0.0;
					if (std::isfinite(n) && std::modf(n, &intpart) == 0.0) {
						std::string keyName = formatAssetKeyNumber(n);
						Value resolvedKey = valueString(m_cpu.internString(keyName));
						mapTable->set(resolvedKey, value);
						return;
					}
				}
				throw BMSX_RUNTIME_ERROR("Attempted to index native object with unsupported key. Asset maps and methods require string or integer keys.");
			},
			nullptr,
			[mapTable](const Value& after) -> std::optional<std::pair<Value, Value>> {
				return mapTable->nextEntry(after);
			},
			[mapTable](VMHeap& heap) {
				heap.markValue(valueTable(mapTable));
			}
		);
	};
	std::unordered_set<AssetId> imgIds;
	if (assets.fallback) {
		for (const auto& [id, _] : assets.fallback->img) {
			imgIds.insert(id);
		}
	}
	for (const auto& [id, _] : assets.img) {
		imgIds.insert(id);
	}
	auto* imgTable = m_cpu.createTable(0, static_cast<int>(imgIds.size()));
	for (const auto& id : imgIds) {
		const ImgAsset* imgAsset = assets.getImg(id);
		if (!imgAsset) continue;
		auto* imgEntry = m_cpu.createTable(0, 2);
		imgEntry->set(key("imgmeta"), valueTable(buildImgMetaTable(m_cpu, imgAsset->meta, key)));
		imgTable->set(str(id), valueTable(imgEntry));
	}
	assetsTable->set(key("img"), makeAssetMapNativeObject(imgTable));

	std::unordered_set<AssetId> dataIds;
	if (assets.fallback) {
		for (const auto& [id, _] : assets.fallback->data) {
			dataIds.insert(id);
		}
	}
	for (const auto& [id, _] : assets.data) {
		dataIds.insert(id);
	}
	auto* dataTable = m_cpu.createTable(0, static_cast<int>(dataIds.size()));
	for (const auto& id : dataIds) {
		const BinValue* value = assets.getData(id);
		if (!value) continue;
		dataTable->set(str(id), binValueToVmValue(m_cpu, *value));
	}
	assetsTable->set(key("data"), makeAssetMapNativeObject(dataTable));
	auto* audioTable = m_cpu.createTable();
	assetsTable->set(key("audio"), makeAssetMapNativeObject(audioTable));
	std::unordered_set<AssetId> audioEventIds;
	if (assets.fallback) {
		for (const auto& [id, _] : assets.fallback->audioevents) {
			audioEventIds.insert(id);
		}
	}
	for (const auto& [id, _] : assets.audioevents) {
		audioEventIds.insert(id);
	}
	auto* audioEventsTable = m_cpu.createTable(0, static_cast<int>(audioEventIds.size()));
	for (const auto& id : audioEventIds) {
		const BinValue* value = assets.getAudioEvent(id);
		if (!value) continue;
		audioEventsTable->set(str(id), binValueToVmValue(m_cpu, *value));
	}
	assetsTable->set(key("audioevents"), makeAssetMapNativeObject(audioEventsTable));
	auto* modelTable = m_cpu.createTable();
	assetsTable->set(key("model"), makeAssetMapNativeObject(modelTable));
	assetsTable->set(key("project_root_path"), str(assets.projectRootPath));
	auto assetsNative = m_cpu.createNativeObject(
		assetsTable,
		[this, assetsTable, formatAssetKeyNumber](const Value& keyValue) -> Value {
			if (valueIsString(keyValue)) {
				Value value = assetsTable->get(keyValue);
				if (isNil(value)) {
					const std::string& keyName = m_cpu.stringPool().toString(asStringId(keyValue));
					throw BMSX_RUNTIME_ERROR("Asset '" + keyName + "' does not exist.");
				}
				return value;
			}
			if (valueIsNumber(keyValue)) {
				double n = valueToNumber(keyValue);
				double intpart = 0.0;
				if (std::isfinite(n) && std::modf(n, &intpart) == 0.0) {
					std::string keyName = formatAssetKeyNumber(n);
					Value resolvedKey = valueString(m_cpu.internString(keyName));
					Value value = assetsTable->get(resolvedKey);
					if (isNil(value)) {
						throw BMSX_RUNTIME_ERROR("Asset '" + keyName + "' does not exist.");
					}
					return value;
				}
			}
			throw BMSX_RUNTIME_ERROR("Attempted to retrieve an asset that did not use a string or integer key.");
		},
		[this, assetsTable, formatAssetKeyNumber](const Value& keyValue, const Value& value) {
			if (valueIsString(keyValue)) {
				assetsTable->set(keyValue, value);
				return;
			}
			if (valueIsNumber(keyValue)) {
				double n = valueToNumber(keyValue);
				double intpart = 0.0;
				if (std::isfinite(n) && std::modf(n, &intpart) == 0.0) {
					std::string keyName = formatAssetKeyNumber(n);
					Value resolvedKey = valueString(m_cpu.internString(keyName));
					assetsTable->set(resolvedKey, value);
					return;
				}
			}
			throw BMSX_RUNTIME_ERROR("Attempted to index native object with unsupported key. Asset maps and methods require string or integer keys.");
		},
		nullptr,
		[assetsTable](const Value& after) -> std::optional<std::pair<Value, Value>> {
			return assetsTable->nextEntry(after);
		},
		[assetsTable](VMHeap& heap) {
			heap.markValue(valueTable(assetsTable));
		}
	);
	setGlobal("assets", assetsNative);

	auto canonicalizationLabel = [](CanonicalizationType value) -> const char* {
		switch (value) {
			case CanonicalizationType::Upper:
				return "upper";
			case CanonicalizationType::Lower:
				return "lower";
			case CanonicalizationType::None:
			default:
				return "none";
		}
	};
	auto buildManifestTable = [this, key, str, canonicalizationLabel](const RuntimeAssets& source) -> Table* {
		const RomManifest& manifest = source.manifest;
		auto* manifestTable = m_cpu.createTable();
		const std::string_view title = manifest.title.empty() ? manifest.name : manifest.title;
		if (!title.empty()) {
			manifestTable->set(key("title"), str(title));
		}
		const std::string_view romName = manifest.romName.empty() ? manifest.name : manifest.romName;
		if (!romName.empty()) {
			manifestTable->set(key("rom_name"), str(romName));
		}
		const std::string_view shortName = manifest.shortName.empty() ? romName : manifest.shortName;
		if (!shortName.empty()) {
			manifestTable->set(key("short_name"), str(shortName));
		}
		auto* vmTable = m_cpu.createTable(0, 2);
		if (!manifest.namespaceName.empty()) {
			vmTable->set(key("namespace"), str(manifest.namespaceName));
		}
		vmTable->set(key("canonicalization"), str(canonicalizationLabel(manifest.canonicalization)));
		if (manifest.viewportWidth > 0 && manifest.viewportHeight > 0) {
			auto* viewportTable = m_cpu.createTable(0, 2);
			viewportTable->set(key("width"), valueNumber(static_cast<double>(manifest.viewportWidth)));
			viewportTable->set(key("height"), valueNumber(static_cast<double>(manifest.viewportHeight)));
			vmTable->set(key("viewport"), valueTable(viewportTable));
		}
		manifestTable->set(key("vm"), valueTable(vmTable));
		auto* luaTable = m_cpu.createTable(0, 1);
		luaTable->set(key("entry_path"), str(manifest.entryPoint));
		manifestTable->set(key("lua"), valueTable(luaTable));
		return manifestTable;
	};
	const RuntimeAssets* engineAssets = assets.fallback ? assets.fallback : &assets;
	setGlobal("cart_manifest", valueTable(buildManifestTable(assets)));
	setGlobal("engine_manifest", valueTable(buildManifestTable(*engineAssets)));

	auto viewSize = EngineCore::instance().view()->viewportSize;
	auto* viewportTable = m_cpu.createTable(0, 2);
	viewportTable->set(key("x"), valueNumber(static_cast<double>(viewSize.x)));
	viewportTable->set(key("y"), valueNumber(static_cast<double>(viewSize.y)));

auto clockNowFn = m_cpu.createNativeFunction("platform.clock.now", [](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueNumber(EngineCore::instance().clock()->now()));
});
auto clockPerfNowFn = m_cpu.createNativeFunction("platform.clock.perf_now", [](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueNumber(to_ms(std::chrono::steady_clock::now().time_since_epoch())));
});
	auto* clockTable = m_cpu.createTable(0, 2);
	clockTable->set(key("now"), clockNowFn);
	clockTable->set(key("perf_now"), clockPerfNowFn);
	auto* platformTable = m_cpu.createTable(0, 1);
	platformTable->set(key("clock"), valueTable(clockTable));

	auto makeActionStateTable = [this, key, str](const ActionState& state) -> Table* {
		auto* table = m_cpu.createTable(0, 18);
		table->set(key("action"), str(state.action));
		table->set(key("pressed"), valueBool(state.pressed));
		table->set(key("justpressed"), valueBool(state.justpressed));
		table->set(key("justreleased"), valueBool(state.justreleased));
		table->set(key("waspressed"), valueBool(state.waspressed));
		table->set(key("wasreleased"), valueBool(state.wasreleased));
		table->set(key("consumed"), valueBool(state.consumed));
		table->set(key("alljustpressed"), valueBool(state.alljustpressed));
		table->set(key("allwaspressed"), valueBool(state.allwaspressed));
		table->set(key("alljustreleased"), valueBool(state.alljustreleased));
		if (state.guardedjustpressed.has_value()) {
			table->set(key("guardedjustpressed"), valueBool(state.guardedjustpressed.value()));
		}
		if (state.repeatpressed.has_value()) {
			table->set(key("repeatpressed"), valueBool(state.repeatpressed.value()));
		}
		if (state.repeatcount.has_value()) {
			table->set(key("repeatcount"), valueNumber(static_cast<double>(state.repeatcount.value())));
		}
		if (state.presstime.has_value()) {
			table->set(key("presstime"), valueNumber(static_cast<double>(state.presstime.value())));
		}
		if (state.timestamp.has_value()) {
			table->set(key("timestamp"), valueNumber(static_cast<double>(state.timestamp.value())));
		}
		if (state.pressedAtMs.has_value()) {
			table->set(key("pressedAtMs"), valueNumber(static_cast<double>(state.pressedAtMs.value())));
		}
		if (state.releasedAtMs.has_value()) {
			table->set(key("releasedAtMs"), valueNumber(static_cast<double>(state.releasedAtMs.value())));
		}
		if (state.pressId.has_value()) {
			table->set(key("pressId"), valueNumber(static_cast<double>(state.pressId.value())));
		}
		table->set(key("value"), valueNumber(static_cast<double>(state.value)));
		if (state.value2d.has_value()) {
			auto* value2d = m_cpu.createTable(0, 2);
			value2d->set(key("x"), valueNumber(static_cast<double>(state.value2d->x)));
			value2d->set(key("y"), valueNumber(static_cast<double>(state.value2d->y)));
			table->set(key("value2d"), valueTable(value2d));
		}
		return table;
	};

auto getActionStateFn = m_cpu.createNativeFunction("game.get_action_state", [this, makeActionStateTable](const std::vector<Value>& args, std::vector<Value>& out) {
	int playerIndex = m_playerIndex;
	std::string action;
	std::optional<f64> windowMs;
	if (args.size() == 1) {
			action = m_cpu.stringPool().toString(asStringId(args.at(0)));
		} else {
			playerIndex = static_cast<int>(std::floor(asNumber(args.at(0))));
			action = m_cpu.stringPool().toString(asStringId(args.at(1)));
			if (args.size() > 2 && !isNil(args.at(2))) {
				windowMs = asNumber(args.at(2));
			}
	}
	PlayerInput* input = Input::instance().getPlayerInput(playerIndex);
	ActionState state = input->getActionState(action, windowMs);
	out.push_back(valueTable(makeActionStateTable(state)));
});

auto consumeActionFn = m_cpu.createNativeFunction("game.consume_action", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	int playerIndex = m_playerIndex;
	std::string action;
	if (args.size() == 1) {
		action = m_cpu.stringPool().toString(asStringId(args.at(0)));
		} else {
			playerIndex = static_cast<int>(std::floor(asNumber(args.at(0))));
		action = m_cpu.stringPool().toString(asStringId(args.at(1)));
	}
	Input::instance().getPlayerInput(playerIndex)->consumeAction(action);
	(void)out;
});

auto emitFn = m_cpu.createNativeFunction("game.emit", [](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	(void)out;
});

	auto* gameTable = m_cpu.createTable(0, 9);
	gameTable->set(key("platform"), valueTable(platformTable));
	gameTable->set(key("viewportsize"), valueTable(viewportTable));
	gameTable->set(key("deltatime"), valueNumber(0.0));
	gameTable->set(key("deltatime_seconds"), valueNumber(0.0));
	gameTable->set(key("emit"), emitFn);
	gameTable->set(key("get_action_state"), getActionStateFn);
	gameTable->set(key("consume_action"), consumeActionFn);
	setGlobal("game", valueTable(gameTable));
	setGlobal("$", valueTable(gameTable));

}

void VMRuntime::executeUpdateCallback(double deltaSeconds) {
bool shouldRunEngineUpdate = (m_updateFn == nullptr);
	if (m_pendingVmCall != PendingCall::None && m_pendingVmCall != PendingCall::Update) {
		return;
	}

	// const auto updateStart = std::chrono::steady_clock::now();
	double vmRunMs = 0.0;
	double engineMs = 0.0;
	double ioMs = 0.0;

	try {
		if (m_updateFn) {
			if (m_pendingVmCall == PendingCall::None) {
				m_cpu.call(m_updateFn, {valueNumber(deltaSeconds)}, 0);
				m_pendingVmCall = PendingCall::Update;
			}
			const auto vmStart = std::chrono::steady_clock::now();
			RunResult result = m_cpu.run(UPDATE_STATEMENT_BUDGET);
			const auto vmEnd = std::chrono::steady_clock::now();
			vmRunMs += to_ms(vmEnd - vmStart);
			const auto ioStart = std::chrono::steady_clock::now();
			processIOCommands();
			const auto ioEnd = std::chrono::steady_clock::now();
			ioMs += to_ms(ioEnd - ioStart);
			if (result == RunResult::Halted) {
				m_pendingVmCall = PendingCall::None;
				shouldRunEngineUpdate = true;
			}
		}
		if (shouldRunEngineUpdate) {
			const double deltaMs = deltaSeconds * 1000.0;
			const auto engineStart = std::chrono::steady_clock::now();
			callEngineModuleMember("update", {valueNumber(deltaMs)});
			const auto engineEnd = std::chrono::steady_clock::now();
			engineMs += to_ms(engineEnd - engineStart);
			const auto ioStart = std::chrono::steady_clock::now();
			processIOCommands();
			const auto ioEnd = std::chrono::steady_clock::now();
			ioMs += to_ms(ioEnd - ioStart);
		}
		// const double totalMs = to_ms(std::chrono::steady_clock::now() - updateStart);
		// static double accSimSec = 0.0;
		// static double accTotalMs = 0.0;
		// static double accVmMs = 0.0;
		// static double accEngineMs = 0.0;
		// static double accIoMs = 0.0;
		// static double maxTotalMs = 0.0;
		// static double maxVmMs = 0.0;
		// static double maxEngineMs = 0.0;
		// static double maxIoMs = 0.0;
		// static uint64_t accFrames = 0;

		// accSimSec += deltaSeconds;
		// accTotalMs += totalMs;
		// accVmMs += vmRunMs;
		// accEngineMs += engineMs;
		// accIoMs += ioMs;
		// if (totalMs > maxTotalMs) maxTotalMs = totalMs;
		// if (vmRunMs > maxVmMs) maxVmMs = vmRunMs;
		// if (engineMs > maxEngineMs) maxEngineMs = engineMs;
		// if (ioMs > maxIoMs) maxIoMs = ioMs;
		// accFrames += 1;

		// if (accSimSec >= 1.0) {
		// 	const double invFrames = 1.0 / static_cast<double>(accFrames);
		// 	std::fprintf(stderr,
		// 		"[VMRuntime] update perf avg total=%.2f vm=%.2f engine=%.2f io=%.2f max_total=%.2f max_vm=%.2f max_engine=%.2f max_io=%.2f frames=%llu\n",
		// 		accTotalMs * invFrames,
		// 		accVmMs * invFrames,
		// 		accEngineMs * invFrames,
		// 		accIoMs * invFrames,
		// 		maxTotalMs,
		// 		maxVmMs,
		// 		maxEngineMs,
		// 		maxIoMs,
		// 		static_cast<unsigned long long>(accFrames));
		// 	accSimSec = 0.0;
		// 	accTotalMs = 0.0;
		// 	accVmMs = 0.0;
		// 	accEngineMs = 0.0;
		// 	accIoMs = 0.0;
		// 	maxTotalMs = 0.0;
		// 	maxVmMs = 0.0;
		// 	maxEngineMs = 0.0;
		// 	maxIoMs = 0.0;
		// 	accFrames = 0;
		// }
		// if (s_updateLogRemaining > 0) {
		// 	const char* pendingLabel = m_pendingVmCall == PendingCall::None
		// 		? "none"
		// 		: (m_pendingVmCall == PendingCall::Update ? "update" : "draw");
		// std::cerr << "[VMRuntime] update: vm=" << (m_updateFn ? "yes" : "no")
		// 	          << " pending=" << pendingLabel
		// 	          << " engine=" << (shouldRunEngineUpdate ? "yes" : "no")
		// 	          << " dt=" << deltaSeconds << std::endl;
		// 	--s_updateLogRemaining;
		// }
	} catch (const std::exception& e) {
		std::cerr << "[VMRuntime] Error in update: " << e.what() << std::endl;
		logVmCallStack();
		m_runtimeFailed = true;
	}
}

void VMRuntime::executeDrawCallback() {
bool shouldRunEngineDraw = (m_drawFn == nullptr);
	if (m_pendingVmCall != PendingCall::None && m_pendingVmCall != PendingCall::Draw) {
		return;
	}

	// const auto drawStart = std::chrono::steady_clock::now();
	double vmRunMs = 0.0;
	double engineMs = 0.0;
	double ioMs = 0.0;

	try {
		if (m_drawFn) {
			if (m_pendingVmCall == PendingCall::None) {
				m_cpu.call(m_drawFn, {}, 0);
				m_pendingVmCall = PendingCall::Draw;
			}
			const auto vmStart = std::chrono::steady_clock::now();
			RunResult result = m_cpu.run(UPDATE_STATEMENT_BUDGET);
			const auto vmEnd = std::chrono::steady_clock::now();
			vmRunMs += to_ms(vmEnd - vmStart);
			const auto ioStart = std::chrono::steady_clock::now();
			processIOCommands();
			const auto ioEnd = std::chrono::steady_clock::now();
			ioMs += to_ms(ioEnd - ioStart);
			if (result == RunResult::Halted) {
				m_pendingVmCall = PendingCall::None;
				shouldRunEngineDraw = true;
			}
		}
		if (shouldRunEngineDraw) {
			const auto engineStart = std::chrono::steady_clock::now();
			callEngineModuleMember("draw", {});
			const auto engineEnd = std::chrono::steady_clock::now();
			engineMs += to_ms(engineEnd - engineStart);
			const auto ioStart = std::chrono::steady_clock::now();
			processIOCommands();
			const auto ioEnd = std::chrono::steady_clock::now();
			ioMs += to_ms(ioEnd - ioStart);
		}
		// const double totalMs = to_ms(std::chrono::steady_clock::now() - drawStart);
		// static double accSimSec = 0.0;
		// static double accTotalMs = 0.0;
		// static double accVmMs = 0.0;
		// static double accEngineMs = 0.0;
		// static double accIoMs = 0.0;
		// static double maxTotalMs = 0.0;
		// static double maxVmMs = 0.0;
		// static double maxEngineMs = 0.0;
		// static double maxIoMs = 0.0;
		// static uint64_t accFrames = 0;

		// const double deltaSeconds = static_cast<double>(m_frameState.deltaSeconds);
		// accSimSec += deltaSeconds;
		// accTotalMs += totalMs;
		// accVmMs += vmRunMs;
		// accEngineMs += engineMs;
		// accIoMs += ioMs;
		// if (totalMs > maxTotalMs) maxTotalMs = totalMs;
		// if (vmRunMs > maxVmMs) maxVmMs = vmRunMs;
		// if (engineMs > maxEngineMs) maxEngineMs = engineMs;
		// if (ioMs > maxIoMs) maxIoMs = ioMs;
		// accFrames += 1;

		// if (accSimSec >= 1.0) {
		// 	const double invFrames = 1.0 / static_cast<double>(accFrames);
		// 	std::fprintf(stderr,
		// 		"[VMRuntime] draw perf avg total=%.2f vm=%.2f engine=%.2f io=%.2f max_total=%.2f max_vm=%.2f max_engine=%.2f max_io=%.2f frames=%llu\n",
		// 		accTotalMs * invFrames,
		// 		accVmMs * invFrames,
		// 		accEngineMs * invFrames,
		// 		accIoMs * invFrames,
		// 		maxTotalMs,
		// 		maxVmMs,
		// 		maxEngineMs,
		// 		maxIoMs,
		// 		static_cast<unsigned long long>(accFrames));
		// 	accSimSec = 0.0;
		// 	accTotalMs = 0.0;
		// 	accVmMs = 0.0;
		// 	accEngineMs = 0.0;
		// 	accIoMs = 0.0;
		// 	maxTotalMs = 0.0;
		// 	maxVmMs = 0.0;
		// 	maxEngineMs = 0.0;
		// 	maxIoMs = 0.0;
		// 	accFrames = 0;
		// }
		// if (s_drawLogRemaining > 0) {
		// 	const char* pendingLabel = m_pendingVmCall == PendingCall::None
		// 		? "none"
		// 		: (m_pendingVmCall == PendingCall::Update ? "update" : "draw");
		// std::cerr << "[VMRuntime] draw: vm=" << (m_drawFn ? "yes" : "no")
		// 	          << " pending=" << pendingLabel
		// 	          << " engine=" << (shouldRunEngineDraw ? "yes" : "no") << std::endl;
		// 	--s_drawLogRemaining;
		// }
	} catch (const std::exception& e) {
		std::cerr << "[VMRuntime] Error in draw: " << e.what() << std::endl;
		logVmCallStack();
		m_runtimeFailed = true;
	}
}

} // namespace bmsx
