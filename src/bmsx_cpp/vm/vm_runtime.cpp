#include "vm_runtime.h"
#include "vm_api.h"
#include "vm_io.h"
#include "program_loader.h"
#include "../core/engine.h"
#include "../input/input.h"
#include <array>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cctype>
#include <ctime>
#include <cstdlib>
#include <cstdio>
#include <iomanip>
#include <iostream>
#include <limits>
#include <regex>
#include <sstream>
#include <stdexcept>

namespace bmsx {
namespace {
inline double to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
}
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
		throw std::runtime_error("[VMRuntime] Instance already exists.");
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
	: m_memory(VM_IO_MEMORY_SIZE)
	, m_cpu(m_memory)
	, m_playerIndex(options.playerIndex)
	, m_viewport(options.viewport)
	, m_canonicalization(options.canonicalization)
{
	// Initialize I/O memory region
	std::fill(m_memory.begin(), m_memory.end(), valueNil());
	// Write pointer starts at 0
	m_memory[IO_WRITE_PTR_ADDR] = valueNumber(0.0);
	// System flags
	m_memory[IO_SYS_CART_PRESENT] = valueNumber(0.0);
	m_memory[IO_SYS_BOOT_CART] = valueNumber(0.0);
	m_vmRandomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
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

void VMRuntime::boot(const VmProgramAsset& asset) {
	m_vmModuleProtos.clear();
	for (const auto& [path, protoIndex] : asset.moduleProtos) {
		m_vmModuleProtos[path] = protoIndex;
	}
	m_vmModuleAliases.clear();
	for (const auto& [alias, path] : asset.moduleAliases) {
		m_vmModuleAliases[alias] = path;
	}
	m_vmModuleCache.clear();
	boot(asset.program.get(), asset.entryProtoIndex);
}

void VMRuntime::boot(Program* program, int entryProtoIndex) {
	std::cerr << "[VMRuntime] boot: program=" << program << " entryProtoIndex=" << entryProtoIndex << std::endl;
	std::cerr << "[VMRuntime] boot: module protos=" << m_vmModuleProtos.size()
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
	std::fill(m_memory.begin(), m_memory.end(), valueNil());
	m_memory[IO_WRITE_PTR_ADDR] = valueNumber(0.0);
	m_memory[IO_SYS_CART_PRESENT] = valueNumber(0.0);
	m_memory[IO_SYS_BOOT_CART] = valueNumber(0.0);
	m_vmRandomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());
	setupBuiltins();
	m_api->registerAllFunctions();
	m_program = program;
	m_cpu.setProgram(program);
	runEngineBuiltinPrelude();
	s_updateLogRemaining = kBootLogFrames;
	s_drawLogRemaining = kBootLogFrames;

	// Start execution at entry point
	std::cerr << "[VMRuntime] boot: starting CPU at entry point..." << std::endl;
	m_cpu.start(entryProtoIndex);

	// Run until halted to execute top-level code
	std::cerr << "[VMRuntime] boot: running top-level code..." << std::endl;
	m_cpu.run();
	processIOCommands();
	std::cerr << "[VMRuntime] boot: top-level code executed" << std::endl;

	// Cache callback functions (use Lua-style names: update, draw, init, new_game)
	Value updateVal = m_cpu.globals->get(canonicalizeIdentifier("update"));
	if (valueIsClosure(updateVal)) {
		m_updateFn = asClosure(updateVal);
		std::cerr << "[VMRuntime] boot: found update" << std::endl;
	}

	Value drawVal = m_cpu.globals->get(canonicalizeIdentifier("draw"));
	if (valueIsClosure(drawVal)) {
		m_drawFn = asClosure(drawVal);
		std::cerr << "[VMRuntime] boot: found draw" << std::endl;
	}

	Value initVal = m_cpu.globals->get(canonicalizeIdentifier("init"));
	if (valueIsClosure(initVal)) {
		m_initFn = asClosure(initVal);
		std::cerr << "[VMRuntime] boot: found init" << std::endl;
	}

	Value newGameVal = m_cpu.globals->get(canonicalizeIdentifier("new_game"));
	if (valueIsClosure(newGameVal)) {
		m_newGameFn = asClosure(newGameVal);
		std::cerr << "[VMRuntime] boot: found new_game" << std::endl;
	}

	if (!m_initFn) {
		throw std::runtime_error("[VMRuntime] VM lifecycle handler 'init' is not defined.");
	}
	if (!m_newGameFn) {
		throw std::runtime_error("[VMRuntime] VM lifecycle handler 'new_game' is not defined.");
	}
	std::cerr << "[VMRuntime] boot: calling init..." << std::endl;
	callLuaFunction(m_initFn, {});
	std::cerr << "[VMRuntime] boot: calling new_game..." << std::endl;
	callEngineModuleMember("reset", {});
	callLuaFunction(m_newGameFn, {});

	m_vmInitialized = true;
	std::cerr << "[VMRuntime] boot: VM initialized!" << std::endl;
}

void VMRuntime::tickUpdate() {
	if (!m_vmInitialized || !m_tickEnabled || m_runtimeFailed) {
		if (s_updateLogRemaining > 0) {
			std::cerr << "[VMRuntime] update: skipped (initialized=" << (m_vmInitialized ? "true" : "false")
			          << " tick=" << (m_tickEnabled ? "true" : "false")
			          << " failed=" << (m_runtimeFailed ? "true" : "false") << ")" << std::endl;
			--s_updateLogRemaining;
		}
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
}

void VMRuntime::tickDraw() {
	if (!m_vmInitialized || !m_tickEnabled || m_runtimeFailed) {
		if (s_drawLogRemaining > 0) {
			std::cerr << "[VMRuntime] draw: skipped (initialized=" << (m_vmInitialized ? "true" : "false")
			          << " tick=" << (m_tickEnabled ? "true" : "false")
			          << " failed=" << (m_runtimeFailed ? "true" : "false") << ")" << std::endl;
			--s_drawLogRemaining;
		}
		return;
	}

	// Call _draw if present
	executeDrawCallback();
}

void VMRuntime::tickIdeInput() {
	// IDE input handling - stub for now
}

void VMRuntime::tickIDE() {
	// IDE update - stub for now
}

void VMRuntime::tickIDEDraw() {
	// IDE draw - stub for now
}

void VMRuntime::tickTerminalInput() {
	// Terminal input handling - stub for now
}

void VMRuntime::tickTerminalMode() {
	// Terminal mode update - stub for now
}

void VMRuntime::tickTerminalModeDraw() {
	// Terminal mode draw - stub for now
}

void VMRuntime::processIOCommands() {
	// Get write pointer
	int writePtr = static_cast<int>(asNumber(m_memory[IO_WRITE_PTR_ADDR]));
	if (writePtr <= 0) {
		return;
	}

	// Process each command
	for (int i = 0; i < writePtr && i < VM_IO_COMMAND_CAPACITY; ++i) {
		int cmdBase = IO_BUFFER_BASE + i * IO_COMMAND_STRIDE;
		int cmd = static_cast<int>(asNumber(m_memory[cmdBase]));

		switch (cmd) {
			case IO_CMD_PRINT: {
				Value arg = m_memory[cmdBase + IO_ARG0_OFFSET];
				std::cout << vmToString(arg) << '\n';
				break;
			}
			default:
				throw std::runtime_error("Unknown VM IO command: " + std::to_string(cmd) + ".");
		}
	}

	// Reset write pointer
	m_memory[IO_WRITE_PTR_ADDR] = valueNumber(0.0);
}

void VMRuntime::requestProgramReload() {
	// Mark for reload - actual reload happens in the appropriate phase
	m_vmInitialized = false;
}

VMState VMRuntime::captureCurrentState() const {
	VMState state;
	state.memory = m_memory;
	state.globals = m_cpu.globals->entries();
	return state;
}

void VMRuntime::applyState(const VMState& state) {
	// Restore memory
	m_memory = state.memory;
	if (m_memory.size() < VM_IO_MEMORY_SIZE) {
		m_memory.resize(VM_IO_MEMORY_SIZE);
	}

	// Restore globals
	m_cpu.globals->clear();
	for (const auto& [key, value] : state.globals) {
		m_cpu.globals->set(key, value);
	}
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

Value VMRuntime::requireVmModule(const std::string& moduleName) {
	const auto aliasIt = m_vmModuleAliases.find(moduleName);
	if (aliasIt == m_vmModuleAliases.end()) {
		throw std::runtime_error("require('" + moduleName + "') failed: module not found.");
	}
	const std::string& path = aliasIt->second;
	const auto cachedIt = m_vmModuleCache.find(path);
	if (cachedIt != m_vmModuleCache.end()) {
		return cachedIt->second;
	}
	const auto protoIt = m_vmModuleProtos.find(path);
	if (protoIt == m_vmModuleProtos.end()) {
		throw std::runtime_error("require('" + moduleName + "') failed: module not compiled.");
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

void VMRuntime::runEngineBuiltinPrelude() {
	std::cerr << "[VMRuntime] prelude: binding engine builtins" << std::endl;
	static const std::array<const char*, 19> engineBuiltins = {
		"define_fsm",
		"define_world_object",
		"define_service",
		"define_component",
		"define_effect",
		"new_timeline",
		"spawn_object",
		"spawn_sprite",
		"spawn_textobject",
		"create_service",
		"service",
		"object",
		"attach_component",
		"configure_ecs",
		"apply_default_pipeline",
		"register",
		"deregister",
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
			throw std::runtime_error("string.format incomplete format specifier.");
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
		if (templateStr[cursor] == '.') {
			cursor += 1;
			if (templateStr[cursor] == '*') {
				int precisionArg = static_cast<int>(asNumber(takeArgument()));
				precision = precisionArg >= 0 ? precisionArg : std::optional<int>{};
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
			throw std::runtime_error("string.format incomplete format specifier.");
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
				throw std::runtime_error(std::string("string.format unsupported format specifier '%") + specifier + "'.");
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

std::regex VMRuntime::buildLuaPatternRegex(const std::string& pattern) const {
	std::string output;
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
					throw std::runtime_error("string.gmatch invalid pattern.");
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
				throw std::runtime_error("string.gmatch invalid pattern.");
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
		throw std::runtime_error("string.gmatch invalid pattern.");
	}
	return std::regex(output);
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
		std::ostringstream oss;
		oss << n;
		return oss.str();
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

double VMRuntime::nextVmRandom() {
	m_vmRandomSeedValue = static_cast<uint32_t>((static_cast<uint64_t>(m_vmRandomSeedValue) * 1664525u + 1013904223u) & 0xffffffffu);
	return static_cast<double>(m_vmRandomSeedValue) / 4294967296.0;
}

void VMRuntime::setupBuiltins() {
	auto logPcallError = [this](const std::string& message) {
		std::cerr << "[VMRuntime] pcall error: " << message << std::endl;
		const Program* program = m_cpu.getProgram();
		if (!program) {
			return;
		}
		auto stack = m_cpu.getCallStack();
		for (const auto& [protoIndex, pc] : stack) {
			const std::string& protoId = program->protoIds[protoIndex];
			auto range = m_cpu.getDebugRange(pc);
			if (range.has_value()) {
				std::cerr << "  at " << protoId << " (" << range->path << ":" << range->startLine << ")"
				          << std::endl;
			} else {
				std::cerr << "  at " << protoId << " (pc=" << pc << ")" << std::endl;
			}
		}
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
		throw std::runtime_error("Attempted to call a non-function value.");
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

	auto* mathTable = m_cpu.createTable();
	mathTable->set(key("abs"), m_cpu.createNativeFunction("math.abs", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::abs(value)));
	}));
	mathTable->set(key("ceil"), m_cpu.createNativeFunction("math.ceil", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::ceil(value)));
	}));
	mathTable->set(key("floor"), m_cpu.createNativeFunction("math.floor", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::floor(value)));
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
	mathTable->set(key("sqrt"), m_cpu.createNativeFunction("math.sqrt", [](const std::vector<Value>& args, std::vector<Value>& out) {
		double value = asNumber(args.at(0));
		out.push_back(valueNumber(std::sqrt(value)));
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
				throw std::runtime_error("math.random upper bound must be positive.");
			}
			out.push_back(valueNumber(static_cast<double>(static_cast<int>(randomValue * upper) + 1)));
			return;
		}
		int lower = static_cast<int>(std::floor(asNumber(args.at(0))));
		int upper = static_cast<int>(std::floor(asNumber(args.at(1))));
		if (upper < lower) {
			throw std::runtime_error("math.random upper bound must be greater than or equal to lower bound.");
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
	mathTable->set(key("pi"), valueNumber(3.14159265358979323846));

	setGlobal("math", valueTable(mathTable));
	setGlobal("SYS_CART_PRESENT", valueNumber(static_cast<double>(IO_SYS_CART_PRESENT)));
	setGlobal("SYS_BOOT_CART", valueNumber(static_cast<double>(IO_SYS_BOOT_CART)));

registerNativeFunction("peek", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		int address = static_cast<int>(asNumber(args.at(0)));
		out.push_back(m_memory[address]);
	});

	registerNativeFunction("poke", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		int address = static_cast<int>(asNumber(args.at(0)));
		m_memory[address] = args.at(1);
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
			throw std::runtime_error(message);
		}
		out.insert(out.end(), args.begin(), args.end());
	});

registerNativeFunction("error", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string message = args.empty() ? std::string("error") : vmToString(args.at(0));
	(void)out;
	throw std::runtime_error(message);
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
				throw std::runtime_error("Attempted to index native array with unsupported key.");
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
				throw std::runtime_error("Attempted to index native array with unsupported key.");
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
stringTable->set(key("len"), m_cpu.createNativeFunction("string.len", [asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	out.push_back(valueNumber(static_cast<double>(text.size())));
}));
stringTable->set(key("upper"), m_cpu.createNativeFunction("string.upper", [str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	std::string text = asText(args.at(0));
	for (auto& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
	out.push_back(str(text));
}));
stringTable->set(key("lower"), m_cpu.createNativeFunction("string.lower", [str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	std::string text = asText(args.at(0));
	for (auto& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
	out.push_back(str(text));
}));
stringTable->set(key("sub"), m_cpu.createNativeFunction("string.sub", [str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	int length = static_cast<int>(text.length());
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
	out.push_back(str(text.substr(static_cast<size_t>(startIndex - 1), static_cast<size_t>(endIndex - startIndex + 1))));
}));
stringTable->set(key("find"), m_cpu.createNativeFunction("string.find", [this, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& source = asText(args.at(0));
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	int length = static_cast<int>(source.length());
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
	bool plain = args.size() > 3 && valueIsBool(args.at(3)) && valueToBool(args.at(3)) == true;
	if (plain) {
		size_t position = source.find(pattern, static_cast<size_t>(std::max(0, startIndex - 1)));
		if (position == std::string::npos) {
			out.push_back(valueNil());
			return;
		}
		int first = static_cast<int>(position) + 1;
		int last = first + static_cast<int>(pattern.length()) - 1;
		out.push_back(valueNumber(static_cast<double>(first)));
		out.push_back(valueNumber(static_cast<double>(last)));
		return;
	}
		std::regex regex = buildLuaPatternRegex(pattern);
		const std::string slice = source.substr(static_cast<size_t>(std::max(0, startIndex - 1)));
		std::smatch match;
		if (!std::regex_search(slice, match, regex)) {
			out.push_back(valueNil());
			return;
		}
	int first = (startIndex - 1) + static_cast<int>(match.position()) + 1;
	int last = first + static_cast<int>(match.length()) - 1;
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
	const std::string& source = asText(args.at(0));
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	int length = static_cast<int>(source.length());
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
	std::regex regex = buildLuaPatternRegex(pattern);
	const std::string slice = source.substr(static_cast<size_t>(std::max(0, startIndex - 1)));
	std::smatch match;
	if (!std::regex_search(slice, match, regex)) {
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

	std::regex regex = buildLuaPatternRegex(pattern);
	size_t count = 0;
	size_t searchIndex = 0;
	size_t lastIndex = 0;
	std::string result;
	std::vector<Value> fnArgs;
	std::vector<Value> fnResults;

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
				Value key = match.size() > 1 ? (match[1].matched ? str(match[1].str()) : valueNil()) : str(match[0].str());
				Value mapped = asTable(replacement)->get(key);
				if (isNil(mapped)) {
					return match[0].str();
				}
				return vmToString(mapped);
			}
			if (valueIsNativeFunction(replacement) || valueIsClosure(replacement)) {
				fnArgs.clear();
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
			throw std::runtime_error("string.gsub replacement must be a string, number, function, or table.");
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
}));
stringTable->set(key("gmatch"), m_cpu.createNativeFunction("string.gmatch", [this, str, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	struct GMatchState {
		std::regex regex;
		std::string source;
		size_t index = 0;
	};
	const std::string& source = asText(args.at(0));
	const std::string& pattern = args.size() > 1 ? asText(args.at(1)) : std::string("");
	auto state = std::make_shared<GMatchState>(GMatchState{buildLuaPatternRegex(pattern), source, 0});
	auto iterator = m_cpu.createNativeFunction("string.gmatch.iterator", [state, str](const std::vector<Value>& args, std::vector<Value>& out) {
		(void)args;
		if (state->index > state->source.size()) {
			out.push_back(valueNil());
			return;
		}
		std::smatch match;
		auto begin = state->source.cbegin() + static_cast<std::string::difference_type>(state->index);
		if (!std::regex_search(begin, state->source.cend(), match, state->regex)) {
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
	int position = args.size() > 1 ? static_cast<int>(std::floor(asNumber(args.at(1)))) - 1 : 0;
	if (position < 0 || position >= static_cast<int>(source.size())) {
		out.push_back(valueNil());
		return;
	}
	unsigned char code = static_cast<unsigned char>(source[static_cast<size_t>(position)]);
	out.push_back(valueNumber(static_cast<double>(code)));
}));
stringTable->set(key("char"), m_cpu.createNativeFunction("string.char", [str](const std::vector<Value>& args, std::vector<Value>& out) {
	if (args.empty()) {
		out.push_back(str(""));
		return;
	}
	std::string result;
	result.reserve(args.size());
	for (const auto& arg : args) {
		int code = static_cast<int>(std::floor(asNumber(arg)));
		result.push_back(static_cast<char>(code));
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
tableLib->set(key("sort"), m_cpu.createNativeFunction("table.sort", [callVmValue](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* tbl = asTable(args.at(0));
	Value comparator = args.size() > 1 ? args.at(1) : valueNil();
	int length = tbl->length();
	std::vector<Value> values(static_cast<size_t>(length));
	for (int i = 1; i <= length; ++i) {
		values[static_cast<size_t>(i - 1)] = tbl->get(valueNumber(static_cast<double>(i)));
	}
	std::vector<Value> comparatorArgs(2);
	std::vector<Value> comparatorResults;
	std::sort(values.begin(), values.end(), [&](const Value& left, const Value& right) -> bool {
		if (!isNil(comparator)) {
			comparatorArgs[0] = left;
			comparatorArgs[1] = right;
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
		throw std::runtime_error("table.sort comparison expects numbers or strings.");
	});
	for (int i = 1; i <= length; ++i) {
		tbl->set(valueNumber(static_cast<double>(i)), values[static_cast<size_t>(i - 1)]);
	}
	out.push_back(valueTable(tbl));
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
			throw std::runtime_error("next expects a native object with iteration.");
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
	throw std::runtime_error("next expects a table or native object.");
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
	throw std::runtime_error("ipairs expects a table or native object.");
});

	setGlobal("next", nextFn);
	registerNativeFunction("pairs", [nextFn](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& target = args.at(0);
		if (!valueIsTable(target) && !valueIsNativeObject(target)) {
			throw std::runtime_error("pairs expects a table or native object.");
		}
		out.push_back(nextFn);
		out.push_back(target);
		out.push_back(valueNil());
	});
	registerNativeFunction("ipairs", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		const Value& target = args.at(0);
		if (!valueIsTable(target) && !valueIsNativeObject(target)) {
			throw std::runtime_error("ipairs expects a table or native object.");
		}
		out.push_back(m_ipairsIterator);
		out.push_back(target);
		out.push_back(valueNumber(0.0));
	});

	const RuntimeAssets& assets = EngineCore::instance().assets();
	auto* assetsTable = m_cpu.createTable();
	auto* imgTable = m_cpu.createTable(0, static_cast<int>(assets.img.size()));
	for (const auto& [id, imgAsset] : assets.img) {
		auto* imgEntry = m_cpu.createTable(0, 2);
		imgEntry->set(key("imgmeta"), valueTable(buildImgMetaTable(m_cpu, imgAsset.meta, key)));
		imgTable->set(str(id), valueTable(imgEntry));
	}
	assetsTable->set(key("img"), valueTable(imgTable));

	auto* dataTable = m_cpu.createTable(0, static_cast<int>(assets.data.size()));
	for (const auto& [id, value] : assets.data) {
		dataTable->set(str(id), binValueToVmValue(m_cpu, value));
	}
	assetsTable->set(key("data"), valueTable(dataTable));
	assetsTable->set(key("audio"), valueTable(m_cpu.createTable()));
	assetsTable->set(key("audioevents"), valueTable(m_cpu.createTable()));
	assetsTable->set(key("model"), valueTable(m_cpu.createTable()));
	assetsTable->set(key("project_root_path"), str(assets.projectRootPath));
	setGlobal("assets", valueTable(assetsTable));

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

const Value emitterClassKey = key("EventEmitter");
const Value emitterInstanceKey = key("instance");
const Value emitterEmitKey = key("emit");
const Value eventIdKey = key("id");
const Value eventTypeKey = key("type");
const Value eventEmitterKey = key("emitter");
const Value eventTimestampKey = key("timestamp");
const Value eventPayloadKey = key("payload");
const Value gameKey = key("game");
auto emitFn = m_cpu.createNativeFunction("game.emit", [this, emitterClassKey, emitterInstanceKey, emitterEmitKey, eventIdKey, eventTypeKey, eventEmitterKey, eventTimestampKey, eventPayloadKey, gameKey](const std::vector<Value>& args, std::vector<Value>& out) {
	auto* emitterModule = asTable(requireVmModule("eventemitter"));
	auto* emitterTable = asTable(emitterModule->get(emitterClassKey));
	auto* instanceTable = asTable(emitterTable->get(emitterInstanceKey));
	// Methods live on the EventEmitter table; call with instance as self.
	auto* emitClosure = asClosure(emitterTable->get(emitterEmitKey));
	// Aligns with TS EngineCore.emit and vm_tooling_runtime native method dispatch.
	const auto gameTable = asTable(m_cpu.globals->get(gameKey));
	size_t argOffset = 0;
	if (valueIsTable(args.at(0)) && asTable(args.at(0)) == gameTable) {
		argOffset = 1;
	}
	std::vector<Value> callArgs;
	callArgs.reserve(args.size() - argOffset + 1);
	callArgs.push_back(valueTable(instanceTable));
	callArgs.insert(callArgs.end(), args.begin() + static_cast<std::ptrdiff_t>(argOffset), args.end());
	callLuaFunction(emitClosure, callArgs);

	const size_t argCount = args.size() - argOffset;
	const Value& specValue = args.at(argOffset);
	Value eventNameValue = valueNil();
	std::string eventName;
	Value emitterValue = valueNil();
	Value payloadValue = valueNil();
	bool payloadIsEventTable = false;
	if (valueIsString(specValue)) {
		eventNameValue = specValue;
		eventName = m_cpu.stringPool().toString(asStringId(specValue));
		emitterValue = argCount > 1 ? args.at(argOffset + 1) : valueNil();
		payloadValue = argCount > 2 ? args.at(argOffset + 2) : valueNil();
		bool emitterValid = false;
		if (valueIsString(emitterValue)) {
			emitterValid = true;
		} else if (valueIsTable(emitterValue)) {
			Value idValue = asTable(emitterValue)->get(eventIdKey);
			if (valueIsString(idValue)) {
				emitterValid = true;
			}
		}
		if (!emitterValid && argCount == 2) {
			payloadValue = emitterValue;
			emitterValue = valueNil();
		}
	} else if (valueIsTable(specValue)) {
		auto* eventTable = asTable(specValue);
		Value typeValue = eventTable->get(eventTypeKey);
		eventNameValue = typeValue;
		eventName = m_cpu.stringPool().toString(asStringId(typeValue));
		emitterValue = eventTable->get(eventEmitterKey);
		payloadValue = specValue;
		payloadIsEventTable = true;
	} else {
		eventNameValue = specValue;
		eventName = m_cpu.stringPool().toString(asStringId(specValue));
	}

	std::string emitterId;
	if (valueIsString(emitterValue)) {
		emitterId = m_cpu.stringPool().toString(asStringId(emitterValue));
	} else if (valueIsTable(emitterValue)) {
		Value idValue = asTable(emitterValue)->get(eventIdKey);
		if (valueIsString(idValue)) {
			emitterId = m_cpu.stringPool().toString(asStringId(idValue));
		}
	}

	Value payload = payloadValue;
	if (!payloadIsEventTable && !isNil(payloadValue)) {
		if (valueIsTable(payloadValue)) {
			auto* payloadTable = asTable(payloadValue);
			Value payloadType = payloadTable->get(eventTypeKey);
			if (isNil(payloadType)) {
				auto* eventTable = m_cpu.createTable(0, 8);
				eventTable->set(eventTypeKey, eventNameValue);
				eventTable->set(eventEmitterKey, emitterValue);
				eventTable->set(eventTimestampKey, valueNumber(EngineCore::instance().clock()->now()));
				for (const auto& [key, value] : payloadTable->entries()) {
					eventTable->set(key, value);
				}
				payload = valueTable(eventTable);
			} else {
				auto* eventTable = m_cpu.createTable(0, 4);
				eventTable->set(eventTypeKey, eventNameValue);
				eventTable->set(eventEmitterKey, emitterValue);
				eventTable->set(eventTimestampKey, valueNumber(EngineCore::instance().clock()->now()));
				eventTable->set(eventPayloadKey, payloadValue);
				payload = valueTable(eventTable);
			}
		} else {
			auto* eventTable = m_cpu.createTable(0, 4);
			eventTable->set(eventTypeKey, eventNameValue);
			eventTable->set(eventEmitterKey, emitterValue);
			eventTable->set(eventTimestampKey, valueNumber(EngineCore::instance().clock()->now()));
			eventTable->set(eventPayloadKey, payloadValue);
			payload = valueTable(eventTable);
		}
	} else if (!payloadIsEventTable) {
		auto* eventTable = m_cpu.createTable(0, 3);
		eventTable->set(eventTypeKey, eventNameValue);
		eventTable->set(eventEmitterKey, emitterValue);
		eventTable->set(eventTimestampKey, valueNumber(EngineCore::instance().clock()->now()));
		payload = valueTable(eventTable);
	}

	EngineCore::instance().audioEventManager()->onEvent(eventName, payload, emitterId);
	(void)out;
});

	auto* gameTable = m_cpu.createTable(0, 8);
	gameTable->set(key("platform"), valueTable(platformTable));
	gameTable->set(key("viewportsize"), valueTable(viewportTable));
	gameTable->set(key("deltatime"), valueNumber(0.0));
	gameTable->set(key("deltatime_seconds"), valueNumber(0.0));
	gameTable->set(key("get_action_state"), getActionStateFn);
	gameTable->set(key("consume_action"), consumeActionFn);
	gameTable->set(key("emit"), emitFn);
	setGlobal("game", valueTable(gameTable));
	setGlobal("$", valueTable(gameTable));

}

void VMRuntime::executeUpdateCallback(double deltaSeconds) {
bool shouldRunEngineUpdate = (m_updateFn == nullptr);
	if (m_pendingVmCall != PendingCall::None && m_pendingVmCall != PendingCall::Update) {
		return;
	}

	const auto updateStart = std::chrono::steady_clock::now();
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
		const double totalMs = to_ms(std::chrono::steady_clock::now() - updateStart);
		static double accSimSec = 0.0;
		static double accTotalMs = 0.0;
		static double accVmMs = 0.0;
		static double accEngineMs = 0.0;
		static double accIoMs = 0.0;
		static double maxTotalMs = 0.0;
		static double maxVmMs = 0.0;
		static double maxEngineMs = 0.0;
		static double maxIoMs = 0.0;
		static uint64_t accFrames = 0;

		accSimSec += deltaSeconds;
		accTotalMs += totalMs;
		accVmMs += vmRunMs;
		accEngineMs += engineMs;
		accIoMs += ioMs;
		if (totalMs > maxTotalMs) maxTotalMs = totalMs;
		if (vmRunMs > maxVmMs) maxVmMs = vmRunMs;
		if (engineMs > maxEngineMs) maxEngineMs = engineMs;
		if (ioMs > maxIoMs) maxIoMs = ioMs;
		accFrames += 1;

		if (accSimSec >= 1.0) {
			const double invFrames = 1.0 / static_cast<double>(accFrames);
			std::fprintf(stderr,
				"[VMRuntime] update perf avg total=%.2f vm=%.2f engine=%.2f io=%.2f max_total=%.2f max_vm=%.2f max_engine=%.2f max_io=%.2f frames=%llu\n",
				accTotalMs * invFrames,
				accVmMs * invFrames,
				accEngineMs * invFrames,
				accIoMs * invFrames,
				maxTotalMs,
				maxVmMs,
				maxEngineMs,
				maxIoMs,
				static_cast<unsigned long long>(accFrames));
			accSimSec = 0.0;
			accTotalMs = 0.0;
			accVmMs = 0.0;
			accEngineMs = 0.0;
			accIoMs = 0.0;
			maxTotalMs = 0.0;
			maxVmMs = 0.0;
			maxEngineMs = 0.0;
			maxIoMs = 0.0;
			accFrames = 0;
		}
		if (s_updateLogRemaining > 0) {
			const char* pendingLabel = m_pendingVmCall == PendingCall::None
				? "none"
				: (m_pendingVmCall == PendingCall::Update ? "update" : "draw");
		std::cerr << "[VMRuntime] update: vm=" << (m_updateFn ? "yes" : "no")
			          << " pending=" << pendingLabel
			          << " engine=" << (shouldRunEngineUpdate ? "yes" : "no")
			          << " dt=" << deltaSeconds << std::endl;
			--s_updateLogRemaining;
		}
	} catch (const std::exception& e) {
		std::cerr << "[VMRuntime] Error in update: " << e.what() << std::endl;
		m_runtimeFailed = true;
	}
}

void VMRuntime::executeDrawCallback() {
bool shouldRunEngineDraw = (m_drawFn == nullptr);
	if (m_pendingVmCall != PendingCall::None && m_pendingVmCall != PendingCall::Draw) {
		return;
	}

	const auto drawStart = std::chrono::steady_clock::now();
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
		const double totalMs = to_ms(std::chrono::steady_clock::now() - drawStart);
		static double accSimSec = 0.0;
		static double accTotalMs = 0.0;
		static double accVmMs = 0.0;
		static double accEngineMs = 0.0;
		static double accIoMs = 0.0;
		static double maxTotalMs = 0.0;
		static double maxVmMs = 0.0;
		static double maxEngineMs = 0.0;
		static double maxIoMs = 0.0;
		static uint64_t accFrames = 0;

		const double deltaSeconds = static_cast<double>(m_frameState.deltaSeconds);
		accSimSec += deltaSeconds;
		accTotalMs += totalMs;
		accVmMs += vmRunMs;
		accEngineMs += engineMs;
		accIoMs += ioMs;
		if (totalMs > maxTotalMs) maxTotalMs = totalMs;
		if (vmRunMs > maxVmMs) maxVmMs = vmRunMs;
		if (engineMs > maxEngineMs) maxEngineMs = engineMs;
		if (ioMs > maxIoMs) maxIoMs = ioMs;
		accFrames += 1;

		if (accSimSec >= 1.0) {
			const double invFrames = 1.0 / static_cast<double>(accFrames);
			std::fprintf(stderr,
				"[VMRuntime] draw perf avg total=%.2f vm=%.2f engine=%.2f io=%.2f max_total=%.2f max_vm=%.2f max_engine=%.2f max_io=%.2f frames=%llu\n",
				accTotalMs * invFrames,
				accVmMs * invFrames,
				accEngineMs * invFrames,
				accIoMs * invFrames,
				maxTotalMs,
				maxVmMs,
				maxEngineMs,
				maxIoMs,
				static_cast<unsigned long long>(accFrames));
			accSimSec = 0.0;
			accTotalMs = 0.0;
			accVmMs = 0.0;
			accEngineMs = 0.0;
			accIoMs = 0.0;
			maxTotalMs = 0.0;
			maxVmMs = 0.0;
			maxEngineMs = 0.0;
			maxIoMs = 0.0;
			accFrames = 0;
		}
		if (s_drawLogRemaining > 0) {
			const char* pendingLabel = m_pendingVmCall == PendingCall::None
				? "none"
				: (m_pendingVmCall == PendingCall::Update ? "update" : "draw");
		std::cerr << "[VMRuntime] draw: vm=" << (m_drawFn ? "yes" : "no")
			          << " pending=" << pendingLabel
			          << " engine=" << (shouldRunEngineDraw ? "yes" : "no") << std::endl;
			--s_drawLogRemaining;
		}
	} catch (const std::exception& e) {
		std::cerr << "[VMRuntime] Error in draw: " << e.what() << std::endl;
		m_runtimeFailed = true;
	}
}

} // namespace bmsx
