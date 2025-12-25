#include "vm_runtime.h"
#include "vm_api.h"
#include "vm_io.h"
#include "program_loader.h"
#include "../core/engine.h"
#include "../input/input.h"
#include <array>
#include <algorithm>
#include <cmath>
#include <cctype>
#include <ctime>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <limits>
#include <regex>
#include <sstream>
#include <stdexcept>

namespace bmsx {

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

std::shared_ptr<Table> buildArrayTable(const std::array<f32, 12>& values) {
	auto table = std::make_shared<Table>(static_cast<int>(values.size()), 0);
	for (size_t index = 0; index < values.size(); ++index) {
		table->set(static_cast<double>(index + 1), static_cast<double>(values[index]));
	}
	return table;
}

std::shared_ptr<Table> buildBoundingBoxTable(const ImgMeta& meta) {
	auto table = std::make_shared<Table>(0, 4);
	const double left = static_cast<double>(meta.boundingbox.x);
	const double top = static_cast<double>(meta.boundingbox.y);
	const double right = static_cast<double>(meta.boundingbox.x + meta.boundingbox.width);
	const double bottom = static_cast<double>(meta.boundingbox.y + meta.boundingbox.height);
	const double width = static_cast<double>(meta.width);
	const double height = static_cast<double>(meta.height);

	auto original = std::make_shared<Table>(0, 6);
	original->set(std::string("left"), left);
	original->set(std::string("right"), right);
	original->set(std::string("top"), top);
	original->set(std::string("bottom"), bottom);
	original->set(std::string("width"), static_cast<double>(meta.boundingbox.width));
	original->set(std::string("height"), static_cast<double>(meta.boundingbox.height));

	auto fliph = std::make_shared<Table>(0, 6);
	fliph->set(std::string("left"), width - right);
	fliph->set(std::string("right"), width - left);
	fliph->set(std::string("top"), top);
	fliph->set(std::string("bottom"), bottom);
	fliph->set(std::string("width"), static_cast<double>(meta.boundingbox.width));
	fliph->set(std::string("height"), static_cast<double>(meta.boundingbox.height));

	auto flipv = std::make_shared<Table>(0, 6);
	flipv->set(std::string("left"), left);
	flipv->set(std::string("right"), right);
	flipv->set(std::string("top"), height - bottom);
	flipv->set(std::string("bottom"), height - top);
	flipv->set(std::string("width"), static_cast<double>(meta.boundingbox.width));
	flipv->set(std::string("height"), static_cast<double>(meta.boundingbox.height));

	auto fliphv = std::make_shared<Table>(0, 6);
	fliphv->set(std::string("left"), width - right);
	fliphv->set(std::string("right"), width - left);
	fliphv->set(std::string("top"), height - bottom);
	fliphv->set(std::string("bottom"), height - top);
	fliphv->set(std::string("width"), static_cast<double>(meta.boundingbox.width));
	fliphv->set(std::string("height"), static_cast<double>(meta.boundingbox.height));

	table->set(std::string("original"), original);
	table->set(std::string("fliph"), fliph);
	table->set(std::string("flipv"), flipv);
	table->set(std::string("fliphv"), fliphv);
	return table;
}

std::shared_ptr<Table> buildImgMetaTable(const ImgMeta& meta) {
	auto table = std::make_shared<Table>(0, 12);
	table->set(std::string("atlassed"), meta.atlassed);
	if (meta.atlassed) {
		table->set(std::string("atlasid"), static_cast<double>(meta.atlasid));
	}
	table->set(std::string("width"), static_cast<double>(meta.width));
	table->set(std::string("height"), static_cast<double>(meta.height));
	table->set(std::string("texcoords"), buildArrayTable(meta.texcoords));
	table->set(std::string("texcoords_fliph"), buildArrayTable(meta.texcoords_fliph));
	table->set(std::string("texcoords_flipv"), buildArrayTable(meta.texcoords_flipv));
	table->set(std::string("texcoords_fliphv"), buildArrayTable(meta.texcoords_fliphv));
	table->set(std::string("boundingbox"), buildBoundingBoxTable(meta));

	auto centerpoint = std::make_shared<Table>(2, 0);
	centerpoint->set(1.0, static_cast<double>(meta.centerX));
	centerpoint->set(2.0, static_cast<double>(meta.centerY));
	table->set(std::string("centerpoint"), centerpoint);
	return table;
}

Value binValueToVmValue(const BinValue& value) {
	if (value.isNull()) {
		return Value{std::monostate{}};
	}
	if (value.isBool()) {
		return value.asBool();
	}
	if (value.isNumber()) {
		return static_cast<double>(value.toNumber());
	}
	if (value.isString()) {
		return value.asString();
	}
	if (value.isArray()) {
		const auto& arr = value.asArray();
		auto table = std::make_shared<Table>(static_cast<int>(arr.size()), 0);
		for (size_t index = 0; index < arr.size(); ++index) {
			table->set(static_cast<double>(index + 1), binValueToVmValue(arr[index]));
		}
		return table;
	}
	if (value.isObject()) {
		const auto& obj = value.asObject();
		auto table = std::make_shared<Table>(0, static_cast<int>(obj.size()));
		for (const auto& [key, entry] : obj) {
			table->set(key, binValueToVmValue(entry));
		}
		return table;
	}
	const auto& bin = value.asBinary();
	auto table = std::make_shared<Table>(static_cast<int>(bin.size()), 0);
	for (size_t index = 0; index < bin.size(); ++index) {
		table->set(static_cast<double>(index + 1), static_cast<double>(bin[index]));
	}
	return table;
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
	Table::setCaseInsensitiveKeys(m_canonicalization != CanonicalizationType::None);
	// Initialize I/O memory region
	std::fill(m_memory.begin(), m_memory.end(), std::monostate{});
	// Write pointer starts at 0
	m_memory[IO_WRITE_PTR_ADDR] = 0.0;
	// System flags
	m_memory[IO_SYS_CART_PRESENT] = 0.0;
	m_memory[IO_SYS_BOOT_CART] = 0.0;
	m_vmRandomSeedValue = static_cast<uint32_t>(EngineCore::instance().clock()->now());

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
	m_updateFn.reset();
	m_drawFn.reset();
	m_initFn.reset();
	m_newGameFn.reset();
	m_cpu.instructionBudgetRemaining = std::nullopt;
	m_cpu.globals.clear();
	std::fill(m_memory.begin(), m_memory.end(), std::monostate{});
	m_memory[IO_WRITE_PTR_ADDR] = 0.0;
	m_memory[IO_SYS_CART_PRESENT] = 0.0;
	m_memory[IO_SYS_BOOT_CART] = 0.0;
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
	Value updateVal = m_cpu.globals.get(canonicalizeIdentifier("update"));
	if (auto cls = std::get_if<std::shared_ptr<Closure>>(&updateVal)) {
		m_updateFn = *cls;
		std::cerr << "[VMRuntime] boot: found update" << std::endl;
	}

	Value drawVal = m_cpu.globals.get(canonicalizeIdentifier("draw"));
	if (auto cls = std::get_if<std::shared_ptr<Closure>>(&drawVal)) {
		m_drawFn = *cls;
		std::cerr << "[VMRuntime] boot: found draw" << std::endl;
	}

	Value initVal = m_cpu.globals.get(canonicalizeIdentifier("init"));
	if (auto cls = std::get_if<std::shared_ptr<Closure>>(&initVal)) {
		m_initFn = *cls;
		std::cerr << "[VMRuntime] boot: found init" << std::endl;
	}

	Value newGameVal = m_cpu.globals.get(canonicalizeIdentifier("new_game"));
	if (auto cls = std::get_if<std::shared_ptr<Closure>>(&newGameVal)) {
		m_newGameFn = *cls;
		std::cerr << "[VMRuntime] boot: found new_game" << std::endl;
	}

	if (!m_initFn) {
		throw std::runtime_error("[VMRuntime] VM lifecycle handler 'init' is not defined.");
	}
	if (!m_newGameFn) {
		throw std::runtime_error("[VMRuntime] VM lifecycle handler 'new_game' is not defined.");
	}
	std::cerr << "[VMRuntime] boot: calling init..." << std::endl;
	callLuaFunction(*m_initFn, {});
	std::cerr << "[VMRuntime] boot: calling new_game..." << std::endl;
	callEngineModuleMember("reset", {});
	callLuaFunction(*m_newGameFn, {});

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
	auto gameTable = std::get<std::shared_ptr<Table>>(m_cpu.globals.get(canonicalizeIdentifier("game")));
	gameTable->set(std::string("deltatime_seconds"), static_cast<double>(m_frameState.deltaSeconds));
	gameTable->set(std::string("deltatime"), static_cast<double>(m_frameState.deltaSeconds) * 1000.0);
	auto viewportTable = std::get<std::shared_ptr<Table>>(gameTable->get(std::string("viewportsize")));
	auto viewSize = EngineCore::instance().view()->viewportSize;
	viewportTable->set(std::string("x"), static_cast<double>(viewSize.x));
	viewportTable->set(std::string("y"), static_cast<double>(viewSize.y));

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
				std::cout << vmToString(arg) << std::endl;
				break;
			}
			default:
				throw std::runtime_error("Unknown VM IO command: " + std::to_string(cmd) + ".");
		}
	}

	// Reset write pointer
	m_memory[IO_WRITE_PTR_ADDR] = 0.0;
}

void VMRuntime::requestProgramReload() {
	// Mark for reload - actual reload happens in the appropriate phase
	m_vmInitialized = false;
}

VMState VMRuntime::captureCurrentState() const {
	VMState state;
	state.memory = m_memory;
	state.globals = m_cpu.globals.entries();
	return state;
}

void VMRuntime::applyState(const VMState& state) {
	// Restore memory
	m_memory = state.memory;
	if (m_memory.size() < VM_IO_MEMORY_SIZE) {
		m_memory.resize(VM_IO_MEMORY_SIZE);
	}

	// Restore globals
	m_cpu.globals.clear();
	for (const auto& [key, value] : state.globals) {
		m_cpu.globals.set(key, value);
	}
}

std::vector<Value> VMRuntime::callLuaFunction(std::shared_ptr<Closure> fn, const std::vector<Value>& args) {
	int depthBefore = m_cpu.getFrameDepth();
	m_cpu.callExternal(fn, args);
	std::optional<int> previousBudget = m_cpu.instructionBudgetRemaining;
	m_cpu.instructionBudgetRemaining = std::nullopt;
	m_cpu.runUntilDepth(depthBefore);
	m_cpu.instructionBudgetRemaining = previousBudget;
	return m_cpu.lastReturnValues;
}

Value VMRuntime::getGlobal(const std::string& name) const {
	return m_cpu.globals.get(canonicalizeIdentifier(name));
}

void VMRuntime::setGlobal(const std::string& name, const Value& value) {
	m_cpu.globals.set(canonicalizeIdentifier(name), value);
}

void VMRuntime::registerNativeFunction(const std::string& name, NativeFunctionInvoke fn) {
	auto nativeFn = createNativeFunction(name, std::move(fn));
	m_cpu.globals.set(canonicalizeIdentifier(name), nativeFn);
}

void VMRuntime::setCanonicalization(CanonicalizationType canonicalization) {
	m_canonicalization = canonicalization;
	Table::setCaseInsensitiveKeys(m_canonicalization != CanonicalizationType::None);
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
	m_vmModuleCache[path] = true;
	auto closure = std::make_shared<Closure>();
	closure->protoIndex = protoIt->second;
	std::vector<Value> results = callLuaFunction(closure, {});
	Value value = results.empty() ? Value{std::monostate{}} : results[0];
	Value cachedValue = isNil(value) ? Value{true} : value;
	m_vmModuleCache[path] = cachedValue;
	return cachedValue;
}

std::vector<Value> VMRuntime::callEngineModuleMember(const std::string& name, const std::vector<Value>& args) {
	auto engineModule = std::get<std::shared_ptr<Table>>(requireVmModule("engine"));
	Value key = canonicalizeIdentifier(name);
	auto member = std::get<std::shared_ptr<Closure>>(engineModule->get(key));
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
	auto engineModule = std::get<std::shared_ptr<Table>>(requireVmModule("engine"));
	for (const char* name : engineBuiltins) {
		Value key = canonicalizeIdentifier(name);
		m_cpu.globals.set(key, engineModule->get(key));
	}
	processIOCommands();
	std::cerr << "[VMRuntime] prelude: engine builtins bound" << std::endl;
}

std::string VMRuntime::formatVmString(const std::string& templateStr, const std::vector<Value>& args, size_t argStart) const {
	size_t argumentIndex = argStart;
	std::string output;

	auto takeArgument = [&]() -> Value {
		Value value = argumentIndex < args.size() ? args[argumentIndex] : Value{std::monostate{}};
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

std::string VMRuntime::canonicalizeIdentifier(const std::string& value) const {
	if (m_canonicalization == CanonicalizationType::None) {
		return value;
	}
	std::string result = value;
	if (m_canonicalization == CanonicalizationType::Upper) {
		for (char& ch : result) {
			ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
		}
		return result;
	}
	for (char& ch : result) {
		ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
	}
	return result;
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
	if (auto* b = std::get_if<bool>(&value)) {
		return *b ? "true" : "false";
	}
	if (auto* n = std::get_if<double>(&value)) {
		if (!std::isfinite(*n)) {
			return "nan";
		}
		std::ostringstream oss;
		oss << *n;
		return oss.str();
	}
	if (auto* s = std::get_if<std::string>(&value)) {
		return *s;
	}
	if (std::holds_alternative<std::shared_ptr<Table>>(value)) {
		return "table";
	}
	if (std::holds_alternative<std::shared_ptr<NativeFunction>>(value)) {
		return "function";
	}
	if (std::holds_alternative<std::shared_ptr<NativeObject>>(value)) {
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
	auto callVmValue = [this](const Value& callee, const std::vector<Value>& args) -> std::vector<Value> {
		if (auto nfn = std::get_if<std::shared_ptr<NativeFunction>>(&callee)) {
			return (*nfn)->invoke(args);
		}
		if (auto cls = std::get_if<std::shared_ptr<Closure>>(&callee)) {
			return callLuaFunction(*cls, args);
		}
		throw std::runtime_error("Attempted to call a non-function value.");
	};

	auto mathTable = std::make_shared<Table>();
	mathTable->set(std::string("abs"), createNativeFunction("math.abs", [](const std::vector<Value>& args) -> std::vector<Value> {
		double value = std::get<double>(args.at(0));
		return {std::abs(value)};
	}));
	mathTable->set(std::string("ceil"), createNativeFunction("math.ceil", [](const std::vector<Value>& args) -> std::vector<Value> {
		double value = std::get<double>(args.at(0));
		return {std::ceil(value)};
	}));
	mathTable->set(std::string("floor"), createNativeFunction("math.floor", [](const std::vector<Value>& args) -> std::vector<Value> {
		double value = std::get<double>(args.at(0));
		return {std::floor(value)};
	}));
	mathTable->set(std::string("max"), createNativeFunction("math.max", [](const std::vector<Value>& args) -> std::vector<Value> {
		double result = std::get<double>(args.at(0));
		for (size_t i = 1; i < args.size(); ++i) {
			result = std::max(result, std::get<double>(args[i]));
		}
		return {result};
	}));
	mathTable->set(std::string("min"), createNativeFunction("math.min", [](const std::vector<Value>& args) -> std::vector<Value> {
		double result = std::get<double>(args.at(0));
		for (size_t i = 1; i < args.size(); ++i) {
			result = std::min(result, std::get<double>(args[i]));
		}
		return {result};
	}));
	mathTable->set(std::string("sqrt"), createNativeFunction("math.sqrt", [](const std::vector<Value>& args) -> std::vector<Value> {
		double value = std::get<double>(args.at(0));
		return {std::sqrt(value)};
	}));
	mathTable->set(std::string("random"), createNativeFunction("math.random", [this](const std::vector<Value>& args) -> std::vector<Value> {
		double randomValue = nextVmRandom();
		if (args.empty()) {
			return {randomValue};
		}
		if (args.size() == 1) {
			int upper = static_cast<int>(std::floor(std::get<double>(args.at(0))));
			if (upper < 1) {
				throw std::runtime_error("math.random upper bound must be positive.");
			}
			return {static_cast<double>(static_cast<int>(randomValue * upper) + 1)};
		}
		int lower = static_cast<int>(std::floor(std::get<double>(args.at(0))));
		int upper = static_cast<int>(std::floor(std::get<double>(args.at(1))));
		if (upper < lower) {
			throw std::runtime_error("math.random upper bound must be greater than or equal to lower bound.");
		}
		int span = upper - lower + 1;
		return {static_cast<double>(lower + static_cast<int>(randomValue * span))};
	}));
	mathTable->set(std::string("randomseed"), createNativeFunction("math.randomseed", [this](const std::vector<Value>& args) -> std::vector<Value> {
		double seedValue = args.empty() ? EngineCore::instance().clock()->now() : std::get<double>(args.at(0));
		uint64_t seed = static_cast<uint64_t>(std::floor(seedValue));
		m_vmRandomSeedValue = static_cast<uint32_t>(seed & 0xffffffffu);
		return {};
	}));
	mathTable->set(std::string("pi"), 3.14159265358979323846);

	setGlobal("math", mathTable);
	setGlobal("SYS_CART_PRESENT", static_cast<double>(IO_SYS_CART_PRESENT));
	setGlobal("SYS_BOOT_CART", static_cast<double>(IO_SYS_BOOT_CART));

	registerNativeFunction("peek", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int address = static_cast<int>(std::get<double>(args.at(0)));
		return {m_memory[address]};
	});

	registerNativeFunction("poke", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int address = static_cast<int>(std::get<double>(args.at(0)));
		m_memory[address] = args.at(1);
		return {};
	});

	registerNativeFunction("type", [](const std::vector<Value>& args) -> std::vector<Value> {
		const Value& v = args.empty() ? Value{std::monostate{}} : args.at(0);
		if (isNil(v)) return {std::string("nil")};
		if (std::holds_alternative<bool>(v)) return {std::string("boolean")};
		if (std::holds_alternative<double>(v)) return {std::string("number")};
		if (std::holds_alternative<std::string>(v)) return {std::string("string")};
		if (std::holds_alternative<std::shared_ptr<Table>>(v)) return {std::string("table")};
		if (std::holds_alternative<std::shared_ptr<Closure>>(v)) return {std::string("function")};
		if (std::holds_alternative<std::shared_ptr<NativeFunction>>(v)) return {std::string("function")};
		if (std::holds_alternative<std::shared_ptr<NativeObject>>(v)) return {std::string("native")};
		return {std::string("function")};
	});

	registerNativeFunction("tostring", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const Value& v = args.empty() ? Value{std::monostate{}} : args.at(0);
		return {vmToString(v)};
	});

	registerNativeFunction("tonumber", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			return {std::monostate{}};
		}
		const Value& v = args.at(0);
		if (auto* n = std::get_if<double>(&v)) {
			return {*n};
		}
		if (auto* s = std::get_if<std::string>(&v)) {
			if (args.size() >= 2) {
				int base = static_cast<int>(std::floor(std::get<double>(args.at(1))));
				if (base >= 2 && base <= 36) {
					std::string trimmed = *s;
					size_t start = trimmed.find_first_not_of(" \t\n\r");
					size_t end = trimmed.find_last_not_of(" \t\n\r");
					if (start == std::string::npos) {
						return {std::monostate{}};
					}
					trimmed = trimmed.substr(start, end - start + 1);
					char* parseEnd = nullptr;
					long parsed = std::strtol(trimmed.c_str(), &parseEnd, base);
					if (parseEnd == trimmed.c_str()) {
						return {std::monostate{}};
					}
					return {static_cast<double>(parsed)};
				}
				return {std::monostate{}};
			}
			char* end = nullptr;
			double parsed = std::strtod(s->c_str(), &end);
			if (end == s->c_str() || !std::isfinite(parsed)) {
				return {std::monostate{}};
			}
			return {parsed};
		}
		return {std::monostate{}};
	});

	registerNativeFunction("assert", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const Value& condition = args.empty() ? Value{std::monostate{}} : args.at(0);
		if (!isTruthy(condition)) {
			const std::string message = args.size() > 1 ? vmToString(args.at(1)) : std::string("assertion failed!");
			throw std::runtime_error(message);
		}
		return args;
	});

	registerNativeFunction("error", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string message = args.empty() ? std::string("error") : vmToString(args.at(0));
		throw std::runtime_error(message);
	});

	registerNativeFunction("setmetatable", [](const std::vector<Value>& args) -> std::vector<Value> {
		auto tbl = std::get<std::shared_ptr<Table>>(args.at(0));
		if (isNil(args.at(1))) {
			tbl->setMetatable(nullptr);
		} else {
			tbl->setMetatable(std::get<std::shared_ptr<Table>>(args.at(1)));
		}
		return {tbl};
	});

	registerNativeFunction("getmetatable", [](const std::vector<Value>& args) -> std::vector<Value> {
		auto tbl = std::get<std::shared_ptr<Table>>(args.at(0));
		auto mt = tbl->getMetatable();
		if (mt) {
			return {mt};
		}
		return {std::monostate{}};
	});

	registerNativeFunction("rawequal", [](const std::vector<Value>& args) -> std::vector<Value> {
		return {args.at(0) == args.at(1)};
	});

	registerNativeFunction("rawget", [](const std::vector<Value>& args) -> std::vector<Value> {
		auto tbl = std::get<std::shared_ptr<Table>>(args.at(0));
		Value key = args.size() > 1 ? args.at(1) : Value{std::monostate{}};
		return {tbl->get(key)};
	});

	registerNativeFunction("rawset", [](const std::vector<Value>& args) -> std::vector<Value> {
		auto tbl = std::get<std::shared_ptr<Table>>(args.at(0));
		Value key = args.at(1);
		Value value = args.size() > 2 ? args.at(2) : Value{std::monostate{}};
		tbl->set(key, value);
		return {tbl};
	});

	registerNativeFunction("select", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (std::holds_alternative<std::string>(args.at(0)) && std::get<std::string>(args.at(0)) == "#") {
			return {static_cast<double>(args.size() - 1)};
		}
		int count = static_cast<int>(args.size()) - 1;
		int start = static_cast<int>(std::get<double>(args.at(0)));
		if (start < 0) {
			start = count + start + 1;
		}
		std::vector<Value> output;
		for (int i = start; i <= count; ++i) {
			if (i >= 1 && static_cast<size_t>(i) < args.size()) {
				output.push_back(args[static_cast<size_t>(i)]);
			}
		}
		return output;
	});

	registerNativeFunction("pcall", [callVmValue, logPcallError](const std::vector<Value>& args) -> std::vector<Value> {
		Value fn = args.at(0);
		std::vector<Value> callArgs;
		for (size_t i = 1; i < args.size(); ++i) {
			callArgs.push_back(args[i]);
		}
		try {
			std::vector<Value> results = callVmValue(fn, callArgs);
			std::vector<Value> output;
			output.push_back(true);
			output.insert(output.end(), results.begin(), results.end());
			return output;
		} catch (const std::exception& e) {
			logPcallError(e.what());
			return {false, std::string(e.what())};
		} catch (...) {
			logPcallError("error");
			return {false, std::string("error")};
		}
	});

	registerNativeFunction("xpcall", [callVmValue, logPcallError](const std::vector<Value>& args) -> std::vector<Value> {
		Value fn = args.at(0);
		Value handler = args.at(1);
		std::vector<Value> callArgs;
		for (size_t i = 2; i < args.size(); ++i) {
			callArgs.push_back(args[i]);
		}
		try {
			std::vector<Value> results = callVmValue(fn, callArgs);
			std::vector<Value> output;
			output.push_back(true);
			output.insert(output.end(), results.begin(), results.end());
			return output;
		} catch (const std::exception& e) {
			logPcallError(e.what());
			std::vector<Value> handlerResults = callVmValue(handler, {std::string(e.what())});
			std::vector<Value> output;
			output.push_back(false);
			output.insert(output.end(), handlerResults.begin(), handlerResults.end());
			return output;
		} catch (...) {
			logPcallError("error");
			std::vector<Value> handlerResults = callVmValue(handler, {std::string("error")});
			std::vector<Value> output;
			output.push_back(false);
			output.insert(output.end(), handlerResults.begin(), handlerResults.end());
			return output;
		}
	});

	registerNativeFunction("require", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& moduleName = std::get<std::string>(args.at(0));
		size_t start = moduleName.find_first_not_of(" \t\n\r");
		if (start == std::string::npos) {
			return {requireVmModule("")};
		}
		size_t end = moduleName.find_last_not_of(" \t\n\r");
		return {requireVmModule(moduleName.substr(start, end - start + 1))};
	});

	registerNativeFunction("array", [](const std::vector<Value>& args) -> std::vector<Value> {
		struct NativeArray {
			std::vector<Value> values;
			std::unordered_map<std::string, Value> props;
			std::vector<std::string> propOrder;
		};

		auto data = std::make_shared<NativeArray>();
		if (args.size() == 1 && std::holds_alternative<std::shared_ptr<Table>>(args.at(0))) {
			const auto tbl = std::get<std::shared_ptr<Table>>(args.at(0));
			const auto entries = tbl->entries();
			for (const auto& [key, value] : entries) {
				if (auto* n = std::get_if<double>(&key)) {
					double intpart = 0.0;
					if (std::modf(*n, &intpart) == 0.0 && *n >= 1.0) {
						int index = static_cast<int>(*n) - 1;
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

		auto native = createNativeObject(
			data.get(),
			[data](const Value& key) -> Value {
				if (auto* n = std::get_if<double>(&key)) {
					double intpart = 0.0;
					if (std::modf(*n, &intpart) == 0.0 && *n >= 1.0) {
						int index = static_cast<int>(*n) - 1;
						if (index >= static_cast<int>(data->values.size())) {
							return std::monostate{};
						}
						return data->values[static_cast<size_t>(index)];
					}
				}
				if (auto* s = std::get_if<std::string>(&key)) {
					if (*s == "length") {
						return static_cast<double>(data->values.size());
					}
					const auto it = data->props.find(*s);
					if (it != data->props.end()) {
						return it->second;
					}
					return std::monostate{};
				}
				throw std::runtime_error("Attempted to index native array with unsupported key.");
			},
			[data](const Value& key, const Value& value) {
				if (auto* n = std::get_if<double>(&key)) {
					double intpart = 0.0;
					if (std::modf(*n, &intpart) == 0.0 && *n >= 1.0) {
						int index = static_cast<int>(*n) - 1;
						if (index >= static_cast<int>(data->values.size())) {
							data->values.resize(static_cast<size_t>(index + 1));
						}
						data->values[static_cast<size_t>(index)] = value;
						return;
					}
				}
				if (auto* s = std::get_if<std::string>(&key)) {
					if (!data->props.count(*s)) {
						data->propOrder.push_back(*s);
					}
					data->props[*s] = value;
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
						keys.emplace_back(static_cast<double>(i + 1));
					}
				}
				for (const auto& key : data->propOrder) {
					const auto it = data->props.find(key);
					if (it == data->props.end()) {
						continue;
					}
					if (isNil(it->second)) {
						continue;
					}
					keys.emplace_back(key);
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
				if (auto* n = std::get_if<double>(&key)) {
					int index = static_cast<int>(*n) - 1;
					return std::make_pair(key, data->values[static_cast<size_t>(index)]);
				}
				const std::string& prop = std::get<std::string>(key);
				return std::make_pair(key, data->props[prop]);
			}
		);

		return {native};
	});

	registerNativeFunction("print", [this](const std::vector<Value>& args) -> std::vector<Value> {
		std::string text;
		for (size_t i = 0; i < args.size(); ++i) {
			if (i > 0) {
				text += '\t';
			}
			text += vmToString(args[i]);
		}
		std::cout << text << std::endl;
		return {};
	});

	auto stringTable = std::make_shared<Table>();
	stringTable->set(std::string("len"), createNativeFunction("string.len", [](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& text = std::get<std::string>(args.at(0));
		return {static_cast<double>(text.size())};
	}));
	stringTable->set(std::string("upper"), createNativeFunction("string.upper", [](const std::vector<Value>& args) -> std::vector<Value> {
		std::string text = std::get<std::string>(args.at(0));
		for (auto& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
		return {text};
	}));
	stringTable->set(std::string("lower"), createNativeFunction("string.lower", [](const std::vector<Value>& args) -> std::vector<Value> {
		std::string text = std::get<std::string>(args.at(0));
		for (auto& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
		return {text};
	}));
	stringTable->set(std::string("sub"), createNativeFunction("string.sub", [](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& text = std::get<std::string>(args.at(0));
		int length = static_cast<int>(text.length());
		auto normalizeIndex = [length](double value) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return 1;
		};
		int startIndex = args.size() > 1 ? normalizeIndex(std::get<double>(args.at(1))) : 1;
		int endIndex = args.size() > 2 ? normalizeIndex(std::get<double>(args.at(2))) : length;
		if (startIndex < 1) startIndex = 1;
		if (endIndex > length) endIndex = length;
		if (endIndex < startIndex) {
			return {std::string("")};
		}
		return {text.substr(static_cast<size_t>(startIndex - 1), static_cast<size_t>(endIndex - startIndex + 1))};
	}));
	stringTable->set(std::string("find"), createNativeFunction("string.find", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& source = std::get<std::string>(args.at(0));
		const std::string& pattern = args.size() > 1 ? std::get<std::string>(args.at(1)) : std::string("");
		int length = static_cast<int>(source.length());
		auto normalizeIndex = [length](double value) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return 1;
		};
		int startIndex = args.size() > 2 ? normalizeIndex(std::get<double>(args.at(2))) : 1;
		if (startIndex > length) {
			return {std::monostate{}};
		}
		bool plain = args.size() > 3 && std::holds_alternative<bool>(args.at(3)) && std::get<bool>(args.at(3)) == true;
		if (plain) {
			size_t position = source.find(pattern, static_cast<size_t>(std::max(0, startIndex - 1)));
			if (position == std::string::npos) {
				return {std::monostate{}};
			}
			int first = static_cast<int>(position) + 1;
			int last = first + static_cast<int>(pattern.length()) - 1;
			return {static_cast<double>(first), static_cast<double>(last)};
		}
		std::regex regex = buildLuaPatternRegex(pattern);
		const std::string slice = source.substr(static_cast<size_t>(std::max(0, startIndex - 1)));
		std::smatch match;
		if (!std::regex_search(slice, match, regex)) {
			return {std::monostate{}};
		}
		int first = (startIndex - 1) + static_cast<int>(match.position()) + 1;
		int last = first + static_cast<int>(match.length()) - 1;
		if (match.size() > 1) {
			std::vector<Value> output;
			output.push_back(static_cast<double>(first));
			output.push_back(static_cast<double>(last));
			for (size_t i = 1; i < match.size(); ++i) {
				if (!match[i].matched) {
					output.push_back(std::monostate{});
				} else {
					output.push_back(match[i].str());
				}
			}
			return output;
		}
		return {static_cast<double>(first), static_cast<double>(last)};
	}));
	stringTable->set(std::string("match"), createNativeFunction("string.match", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& source = std::get<std::string>(args.at(0));
		const std::string& pattern = args.size() > 1 ? std::get<std::string>(args.at(1)) : std::string("");
		int length = static_cast<int>(source.length());
		auto normalizeIndex = [length](double value) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return 1;
		};
		int startIndex = args.size() > 2 ? normalizeIndex(std::get<double>(args.at(2))) : 1;
		if (startIndex > length) {
			return {std::monostate{}};
		}
		std::regex regex = buildLuaPatternRegex(pattern);
		const std::string slice = source.substr(static_cast<size_t>(std::max(0, startIndex - 1)));
		std::smatch match;
		if (!std::regex_search(slice, match, regex)) {
			return {std::monostate{}};
		}
		if (match.size() > 1) {
			std::vector<Value> output;
			for (size_t i = 1; i < match.size(); ++i) {
				if (!match[i].matched) {
					output.push_back(std::monostate{});
				} else {
					output.push_back(match[i].str());
				}
			}
			if (!output.empty()) {
				return output;
			}
		}
		return {match[0].str()};
	}));
	stringTable->set(std::string("gsub"), createNativeFunction("string.gsub", [this, callVmValue](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& source = std::get<std::string>(args.at(0));
		const std::string& pattern = args.size() > 1 ? std::get<std::string>(args.at(1)) : std::string("");
		const Value replacement = args.size() > 2 ? args.at(2) : Value{std::string("")};
		int maxReplacements = args.size() > 3 && !isNil(args.at(3)) ? std::max(0, static_cast<int>(std::floor(std::get<double>(args.at(3))))) : std::numeric_limits<int>::max();

		std::regex regex = buildLuaPatternRegex(pattern);
		size_t count = 0;
		size_t searchIndex = 0;
		size_t lastIndex = 0;
		std::string result;

		auto renderReplacement = [&](const std::smatch& match) -> std::string {
			if (std::holds_alternative<std::string>(replacement) || std::holds_alternative<double>(replacement)) {
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
			if (auto tbl = std::get_if<std::shared_ptr<Table>>(&replacement)) {
				Value key = match.size() > 1 ? (match[1].matched ? Value{match[1].str()} : Value{std::monostate{}}) : Value{match[0].str()};
				Value mapped = (*tbl)->get(key);
				if (isNil(mapped)) {
					return match[0].str();
				}
				return vmToString(mapped);
			}
			if (std::holds_alternative<std::shared_ptr<NativeFunction>>(replacement) || std::holds_alternative<std::shared_ptr<Closure>>(replacement)) {
				std::vector<Value> fnArgs;
				if (match.size() > 1) {
					for (size_t i = 1; i < match.size(); ++i) {
						if (match[i].matched) {
							fnArgs.emplace_back(match[i].str());
						} else {
							fnArgs.emplace_back(std::monostate{});
						}
					}
				} else {
					fnArgs.emplace_back(match[0].str());
				}
				std::vector<Value> results = callVmValue(replacement, fnArgs);
				Value value = results.empty() ? Value{std::monostate{}} : results[0];
				if (isNil(value) || (std::holds_alternative<bool>(value) && !std::get<bool>(value))) {
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
		return {result, static_cast<double>(count)};
	}));
	stringTable->set(std::string("gmatch"), createNativeFunction("string.gmatch", [this](const std::vector<Value>& args) -> std::vector<Value> {
		struct GMatchState {
			std::regex regex;
			std::string source;
			size_t index = 0;
		};
		const std::string& source = std::get<std::string>(args.at(0));
		const std::string& pattern = args.size() > 1 ? std::get<std::string>(args.at(1)) : std::string("");
		auto state = std::make_shared<GMatchState>(GMatchState{buildLuaPatternRegex(pattern), source, 0});
		auto iterator = createNativeFunction("string.gmatch.iterator", [state](const std::vector<Value>&) -> std::vector<Value> {
			if (state->index > state->source.size()) {
				return {std::monostate{}};
			}
			std::smatch match;
			auto begin = state->source.cbegin() + static_cast<std::string::difference_type>(state->index);
			if (!std::regex_search(begin, state->source.cend(), match, state->regex)) {
				return {std::monostate{}};
			}
			size_t matchStart = state->index + static_cast<size_t>(match.position());
			size_t matchEnd = matchStart + static_cast<size_t>(match.length());
			if (match.length() == 0) {
				state->index = matchEnd + 1;
			} else {
				state->index = matchEnd;
			}
			if (match.size() > 1) {
				std::vector<Value> output;
				for (size_t i = 1; i < match.size(); ++i) {
					if (match[i].matched) {
						output.emplace_back(match[i].str());
					} else {
						output.emplace_back(std::monostate{});
					}
				}
				if (!output.empty()) {
					return output;
				}
			}
			return {match[0].str()};
		});
		return {iterator};
	}));
	stringTable->set(std::string("byte"), createNativeFunction("string.byte", [](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& source = std::get<std::string>(args.at(0));
		int position = args.size() > 1 ? static_cast<int>(std::floor(std::get<double>(args.at(1)))) - 1 : 0;
		if (position < 0 || position >= static_cast<int>(source.size())) {
			return {std::monostate{}};
		}
		unsigned char code = static_cast<unsigned char>(source[static_cast<size_t>(position)]);
		return {static_cast<double>(code)};
	}));
	stringTable->set(std::string("char"), createNativeFunction("string.char", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			return {std::string("")};
		}
		std::string result;
		result.reserve(args.size());
		for (const auto& arg : args) {
			int code = static_cast<int>(std::floor(std::get<double>(arg)));
			result.push_back(static_cast<char>(code));
		}
		return {result};
	}));
	stringTable->set(std::string("format"), createNativeFunction("string.format", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& templateStr = std::get<std::string>(args.at(0));
		return {formatVmString(templateStr, args, 1)};
	}));

	setGlobal("string", stringTable);

	auto tableLib = std::make_shared<Table>();
	tableLib->set(std::string("insert"), createNativeFunction("table.insert", [](const std::vector<Value>& args) -> std::vector<Value> {
		auto tbl = std::get<std::shared_ptr<Table>>(args.at(0));
		int position = 0;
		Value value;
		if (args.size() == 2) {
			value = args.at(1);
			position = tbl->length() + 1;
		} else {
			position = static_cast<int>(std::floor(std::get<double>(args.at(1))));
			value = args.at(2);
		}
		int length = tbl->length();
		for (int i = length; i >= position; --i) {
			tbl->set(static_cast<double>(i + 1), tbl->get(static_cast<double>(i)));
		}
		tbl->set(static_cast<double>(position), value);
		return {};
	}));
	tableLib->set(std::string("remove"), createNativeFunction("table.remove", [](const std::vector<Value>& args) -> std::vector<Value> {
		auto tbl = std::get<std::shared_ptr<Table>>(args.at(0));
		int position = args.size() > 1 ? static_cast<int>(std::floor(std::get<double>(args.at(1)))) : tbl->length();
		int length = tbl->length();
		Value removed = tbl->get(static_cast<double>(position));
		for (int i = position; i < length; ++i) {
			tbl->set(static_cast<double>(i), tbl->get(static_cast<double>(i + 1)));
		}
		tbl->set(static_cast<double>(length), std::monostate{});
		if (isNil(removed)) {
			return {};
		}
		return {removed};
	}));
	tableLib->set(std::string("concat"), createNativeFunction("table.concat", [this](const std::vector<Value>& args) -> std::vector<Value> {
		auto tbl = std::get<std::shared_ptr<Table>>(args.at(0));
		const std::string separator = args.size() > 1 ? vmToString(args.at(1)) : std::string("");
		int length = tbl->length();
		auto normalizeIndex = [length](double value, int fallback) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return fallback;
		};
		int startIndex = args.size() > 2 ? normalizeIndex(std::get<double>(args.at(2)), 1) : 1;
		int endIndex = args.size() > 3 ? normalizeIndex(std::get<double>(args.at(3)), length) : length;
		if (endIndex < startIndex) {
			return {std::string("")};
		}
		std::string output;
		for (int i = startIndex; i <= endIndex; ++i) {
			if (i > startIndex) {
				output += separator;
			}
			Value value = tbl->get(static_cast<double>(i));
			if (!isNil(value)) {
				output += vmToString(value);
			}
		}
		return {output};
	}));
	tableLib->set(std::string("pack"), createNativeFunction("table.pack", [](const std::vector<Value>& args) -> std::vector<Value> {
		auto tbl = std::make_shared<Table>(static_cast<int>(args.size()), 1);
		for (size_t i = 0; i < args.size(); ++i) {
			tbl->set(static_cast<double>(i + 1), args[i]);
		}
		tbl->set(std::string("n"), static_cast<double>(args.size()));
		return {tbl};
	}));
	tableLib->set(std::string("unpack"), createNativeFunction("table.unpack", [](const std::vector<Value>& args) -> std::vector<Value> {
		auto tbl = std::get<std::shared_ptr<Table>>(args.at(0));
		int length = tbl->length();
		auto normalizeIndex = [length](double value, int fallback) -> int {
			int integer = static_cast<int>(std::floor(value));
			if (integer > 0) return integer;
			if (integer < 0) return length + integer + 1;
			return fallback;
		};
		int startIndex = args.size() > 1 ? normalizeIndex(std::get<double>(args.at(1)), 1) : 1;
		int endIndex = args.size() > 2 ? normalizeIndex(std::get<double>(args.at(2)), length) : length;
		if (endIndex < startIndex) {
			return {};
		}
		std::vector<Value> output;
		for (int i = startIndex; i <= endIndex; ++i) {
			output.push_back(tbl->get(static_cast<double>(i)));
		}
		return output;
	}));
	tableLib->set(std::string("sort"), createNativeFunction("table.sort", [callVmValue](const std::vector<Value>& args) -> std::vector<Value> {
		auto tbl = std::get<std::shared_ptr<Table>>(args.at(0));
		Value comparator = args.size() > 1 ? args.at(1) : Value{std::monostate{}};
		int length = tbl->length();
		std::vector<Value> values(static_cast<size_t>(length));
		for (int i = 1; i <= length; ++i) {
			values[static_cast<size_t>(i - 1)] = tbl->get(static_cast<double>(i));
		}
		std::vector<Value> comparatorArgs(2);
		std::sort(values.begin(), values.end(), [&](const Value& left, const Value& right) -> bool {
			if (!isNil(comparator)) {
				comparatorArgs[0] = left;
				comparatorArgs[1] = right;
				std::vector<Value> results = callVmValue(comparator, comparatorArgs);
				return !results.empty() && std::holds_alternative<bool>(results[0]) && std::get<bool>(results[0]) == true;
			}
			if (std::holds_alternative<double>(left) && std::holds_alternative<double>(right)) {
				return std::get<double>(left) < std::get<double>(right);
			}
			if (std::holds_alternative<std::string>(left) && std::holds_alternative<std::string>(right)) {
				return std::get<std::string>(left) < std::get<std::string>(right);
			}
			throw std::runtime_error("table.sort comparison expects numbers or strings.");
		});
		for (int i = 1; i <= length; ++i) {
			tbl->set(static_cast<double>(i), values[static_cast<size_t>(i - 1)]);
		}
		return {tbl};
	}));

	setGlobal("table", tableLib);

	auto osTable = std::make_shared<Table>();
	osTable->set(std::string("clock"), createNativeFunction("os.clock", [](const std::vector<Value>&) -> std::vector<Value> {
		return {EngineCore::instance().clock()->now() / 1000.0};
	}));
	osTable->set(std::string("time"), createNativeFunction("os.time", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (!args.empty() && !isNil(args.at(0))) {
			auto table = std::get<std::shared_ptr<Table>>(args.at(0));
			std::tm timeInfo{};
			timeInfo.tm_year = static_cast<int>(std::get<double>(table->get(std::string("year")))) - 1900;
			timeInfo.tm_mon = static_cast<int>(std::get<double>(table->get(std::string("month")))) - 1;
			timeInfo.tm_mday = static_cast<int>(std::get<double>(table->get(std::string("day"))));
			timeInfo.tm_hour = static_cast<int>(std::get<double>(table->get(std::string("hour"))));
			timeInfo.tm_min = static_cast<int>(std::get<double>(table->get(std::string("min"))));
			timeInfo.tm_sec = static_cast<int>(std::get<double>(table->get(std::string("sec"))));
			timeInfo.tm_isdst = -1;
			return {static_cast<double>(std::mktime(&timeInfo))};
		}
		return {static_cast<double>(std::time(nullptr))};
	}));
	osTable->set(std::string("difftime"), createNativeFunction("os.difftime", [](const std::vector<Value>& args) -> std::vector<Value> {
		double t2 = std::get<double>(args.at(0));
		double t1 = std::get<double>(args.at(1));
		return {t2 - t1};
	}));
	osTable->set(std::string("date"), createNativeFunction("os.date", [](const std::vector<Value>& args) -> std::vector<Value> {
		std::string format = args.empty() || isNil(args.at(0)) ? std::string("%c") : std::get<std::string>(args.at(0));
		std::time_t timeValue = args.size() > 1 && !isNil(args.at(1))
			? static_cast<std::time_t>(std::get<double>(args.at(1)))
			: std::time(nullptr);
		std::tm timeInfo = *std::localtime(&timeValue);
		if (format == "*t") {
			auto table = std::make_shared<Table>(0, 9);
			table->set(std::string("year"), static_cast<double>(timeInfo.tm_year + 1900));
			table->set(std::string("month"), static_cast<double>(timeInfo.tm_mon + 1));
			table->set(std::string("day"), static_cast<double>(timeInfo.tm_mday));
			table->set(std::string("hour"), static_cast<double>(timeInfo.tm_hour));
			table->set(std::string("min"), static_cast<double>(timeInfo.tm_min));
			table->set(std::string("sec"), static_cast<double>(timeInfo.tm_sec));
			table->set(std::string("wday"), static_cast<double>(timeInfo.tm_wday + 1));
			table->set(std::string("yday"), static_cast<double>(timeInfo.tm_yday + 1));
			table->set(std::string("isdst"), timeInfo.tm_isdst > 0);
			return {table};
		}
		char buffer[256];
		size_t size = std::strftime(buffer, sizeof(buffer), format.c_str(), &timeInfo);
		return {std::string(buffer, size)};
	}));
	setGlobal("os", osTable);

	auto nextFn = createNativeFunction("next", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const Value& target = args.at(0);
		const Value key = args.size() > 1 ? args.at(1) : Value{std::monostate{}};
		if (auto tbl = std::get_if<std::shared_ptr<Table>>(&target)) {
			auto entry = (*tbl)->nextEntry(key);
			if (!entry.has_value()) {
				return {std::monostate{}};
			}
			return {entry->first, entry->second};
		}
		if (auto obj = std::get_if<std::shared_ptr<NativeObject>>(&target)) {
			if (!(*obj)->next) {
				throw std::runtime_error("next expects a native object with iteration.");
			}
			auto entry = (*obj)->next(key);
			if (!entry.has_value()) {
				return {std::monostate{}};
			}
			return {entry->first, entry->second};
		}
		throw std::runtime_error("next expects a table or native object.");
	});

	auto ipairsIterator = createNativeFunction("ipairs.iterator", [](const std::vector<Value>& args) -> std::vector<Value> {
		const Value& target = args.at(0);
		int index = static_cast<int>(std::get<double>(args.at(1)));
		int nextIndex = index + 1;
		if (auto tbl = std::get_if<std::shared_ptr<Table>>(&target)) {
			Value value = (*tbl)->get(static_cast<double>(nextIndex));
			if (isNil(value)) {
				return {std::monostate{}};
			}
			return {static_cast<double>(nextIndex), value};
		}
		if (auto obj = std::get_if<std::shared_ptr<NativeObject>>(&target)) {
			Value value = (*obj)->get(static_cast<double>(nextIndex));
			if (isNil(value)) {
				return {std::monostate{}};
			}
			return {static_cast<double>(nextIndex), value};
		}
		throw std::runtime_error("ipairs expects a table or native object.");
	});

	setGlobal("next", nextFn);
	registerNativeFunction("pairs", [nextFn](const std::vector<Value>& args) -> std::vector<Value> {
		const Value& target = args.at(0);
		if (!std::holds_alternative<std::shared_ptr<Table>>(target) && !std::holds_alternative<std::shared_ptr<NativeObject>>(target)) {
			throw std::runtime_error("pairs expects a table or native object.");
		}
		return {nextFn, target, std::monostate{}};
	});
	registerNativeFunction("ipairs", [ipairsIterator](const std::vector<Value>& args) -> std::vector<Value> {
		const Value& target = args.at(0);
		if (!std::holds_alternative<std::shared_ptr<Table>>(target) && !std::holds_alternative<std::shared_ptr<NativeObject>>(target)) {
			throw std::runtime_error("ipairs expects a table or native object.");
		}
		return {ipairsIterator, target, 0.0};
	});

	const RuntimeAssets& assets = EngineCore::instance().assets();
	auto assetsTable = std::make_shared<Table>();
	auto imgTable = std::make_shared<Table>(0, static_cast<int>(assets.img.size()));
	for (const auto& [id, imgAsset] : assets.img) {
		auto imgEntry = std::make_shared<Table>(0, 2);
		imgEntry->set(std::string("imgmeta"), buildImgMetaTable(imgAsset.meta));
		imgTable->set(id, imgEntry);
	}
	assetsTable->set(std::string("img"), imgTable);

	auto dataTable = std::make_shared<Table>(0, static_cast<int>(assets.data.size()));
	for (const auto& [id, value] : assets.data) {
		dataTable->set(id, binValueToVmValue(value));
	}
	assetsTable->set(std::string("data"), dataTable);
	assetsTable->set(std::string("audio"), std::make_shared<Table>());
	assetsTable->set(std::string("audioevents"), std::make_shared<Table>());
	assetsTable->set(std::string("model"), std::make_shared<Table>());
	assetsTable->set(std::string("project_root_path"), assets.projectRootPath);
	setGlobal("assets", assetsTable);

	auto viewSize = EngineCore::instance().view()->viewportSize;
	auto viewportTable = std::make_shared<Table>(0, 2);
	viewportTable->set(std::string("x"), static_cast<double>(viewSize.x));
	viewportTable->set(std::string("y"), static_cast<double>(viewSize.y));

	auto clockNowFn = createNativeFunction("platform.clock.now", [](const std::vector<Value>&) -> std::vector<Value> {
		return {EngineCore::instance().clock()->now()};
	});
	auto clockTable = std::make_shared<Table>(0, 1);
	clockTable->set(std::string("now"), clockNowFn);
	auto platformTable = std::make_shared<Table>(0, 1);
	platformTable->set(std::string("clock"), clockTable);

	auto makeActionStateTable = [](const ActionState& state) -> std::shared_ptr<Table> {
		auto table = std::make_shared<Table>(0, 18);
		table->set(std::string("action"), state.action);
		table->set(std::string("pressed"), state.pressed);
		table->set(std::string("justpressed"), state.justpressed);
		table->set(std::string("justreleased"), state.justreleased);
		table->set(std::string("waspressed"), state.waspressed);
		table->set(std::string("wasreleased"), state.wasreleased);
		table->set(std::string("consumed"), state.consumed);
		table->set(std::string("alljustpressed"), state.alljustpressed);
		table->set(std::string("allwaspressed"), state.allwaspressed);
		table->set(std::string("alljustreleased"), state.alljustreleased);
		if (state.guardedjustpressed.has_value()) {
			table->set(std::string("guardedjustpressed"), state.guardedjustpressed.value());
		}
		if (state.repeatpressed.has_value()) {
			table->set(std::string("repeatpressed"), state.repeatpressed.value());
		}
		if (state.repeatcount.has_value()) {
			table->set(std::string("repeatcount"), static_cast<double>(state.repeatcount.value()));
		}
		if (state.presstime.has_value()) {
			table->set(std::string("presstime"), static_cast<double>(state.presstime.value()));
		}
		if (state.timestamp.has_value()) {
			table->set(std::string("timestamp"), static_cast<double>(state.timestamp.value()));
		}
		if (state.pressedAtMs.has_value()) {
			table->set(std::string("pressedAtMs"), static_cast<double>(state.pressedAtMs.value()));
		}
		if (state.releasedAtMs.has_value()) {
			table->set(std::string("releasedAtMs"), static_cast<double>(state.releasedAtMs.value()));
		}
		if (state.pressId.has_value()) {
			table->set(std::string("pressId"), static_cast<double>(state.pressId.value()));
		}
		table->set(std::string("value"), static_cast<double>(state.value));
		if (state.value2d.has_value()) {
			auto value2d = std::make_shared<Table>(0, 2);
			value2d->set(std::string("x"), static_cast<double>(state.value2d->x));
			value2d->set(std::string("y"), static_cast<double>(state.value2d->y));
			table->set(std::string("value2d"), value2d);
		}
		return table;
	};

	auto getActionStateFn = createNativeFunction("game.get_action_state", [this, makeActionStateTable](const std::vector<Value>& args) -> std::vector<Value> {
		int playerIndex = m_playerIndex;
		std::string action;
		std::optional<f64> windowMs;
		if (args.size() == 1) {
			action = std::get<std::string>(args.at(0));
		} else {
			playerIndex = static_cast<int>(std::floor(std::get<double>(args.at(0))));
			action = std::get<std::string>(args.at(1));
			if (args.size() > 2 && !isNil(args.at(2))) {
				windowMs = std::get<double>(args.at(2));
			}
		}
		PlayerInput* input = Input::instance().getPlayerInput(playerIndex);
		ActionState state = input->getActionState(action, windowMs);
		return {makeActionStateTable(state)};
	});

	auto consumeActionFn = createNativeFunction("game.consume_action", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int playerIndex = m_playerIndex;
		std::string action;
		if (args.size() == 1) {
			action = std::get<std::string>(args.at(0));
		} else {
			playerIndex = static_cast<int>(std::floor(std::get<double>(args.at(0))));
			action = std::get<std::string>(args.at(1));
		}
		Input::instance().getPlayerInput(playerIndex)->consumeAction(action);
		return {};
	});

	auto emitFn = createNativeFunction("game.emit", [this](const std::vector<Value>& args) -> std::vector<Value> {
		auto emitterModule = std::get<std::shared_ptr<Table>>(requireVmModule("eventemitter"));
		Value emitterKey = canonicalizeIdentifier("EventEmitter");
		auto emitterTable = std::get<std::shared_ptr<Table>>(emitterModule->get(emitterKey));
		Value instanceKey = canonicalizeIdentifier("instance");
		auto instanceTable = std::get<std::shared_ptr<Table>>(emitterTable->get(instanceKey));
		Value emitKey = canonicalizeIdentifier("emit");
		// Methods live on the EventEmitter table; call with instance as self.
		auto emitClosure = std::get<std::shared_ptr<Closure>>(emitterTable->get(emitKey));
		// Aligns with TS EngineCore.emit and vm_tooling_runtime native method dispatch.
		const auto gameTable = std::get<std::shared_ptr<Table>>(m_cpu.globals.get(canonicalizeIdentifier("game")));
		size_t argOffset = 0;
		if (auto* selfTable = std::get_if<std::shared_ptr<Table>>(&args.at(0))) {
			if (*selfTable == gameTable) {
				argOffset = 1;
			}
		}
		std::vector<Value> callArgs;
		callArgs.reserve(args.size() - argOffset + 1);
		callArgs.push_back(instanceTable);
		callArgs.insert(callArgs.end(), args.begin() + static_cast<std::ptrdiff_t>(argOffset), args.end());
		callLuaFunction(emitClosure, callArgs);

		const size_t argCount = args.size() - argOffset;
		const Value& specValue = args.at(argOffset);
		std::string eventName;
		Value emitterValue{};
		Value payloadValue{};
		bool payloadIsEventTable = false;
		if (auto* eventNameStr = std::get_if<std::string>(&specValue)) {
			eventName = *eventNameStr;
			emitterValue = argCount > 1 ? args.at(argOffset + 1) : Value{};
			payloadValue = argCount > 2 ? args.at(argOffset + 2) : Value{};
			bool emitterValid = false;
			if (auto* s = std::get_if<std::string>(&emitterValue)) {
				(void)s;
				emitterValid = true;
			} else if (auto* tbl = std::get_if<std::shared_ptr<Table>>(&emitterValue)) {
				Value idValue = (*tbl)->get(std::string("id"));
				if (std::holds_alternative<std::string>(idValue)) {
					emitterValid = true;
				}
			}
			if (!emitterValid && argCount == 2) {
				payloadValue = emitterValue;
				emitterValue = Value{};
			}
		} else if (auto* eventTable = std::get_if<std::shared_ptr<Table>>(&specValue)) {
			Value typeValue = (*eventTable)->get(std::string("type"));
			eventName = std::get<std::string>(typeValue);
			emitterValue = (*eventTable)->get(std::string("emitter"));
			payloadValue = specValue;
			payloadIsEventTable = true;
		} else {
			eventName = std::get<std::string>(specValue);
		}

		std::string emitterId;
		if (auto* s = std::get_if<std::string>(&emitterValue)) {
			emitterId = *s;
		} else if (auto* tbl = std::get_if<std::shared_ptr<Table>>(&emitterValue)) {
			Value idValue = (*tbl)->get(std::string("id"));
			if (auto* idStr = std::get_if<std::string>(&idValue)) {
				emitterId = *idStr;
			}
		}

		Value payload = payloadValue;
		if (!payloadIsEventTable && !isNil(payloadValue)) {
			if (auto* payloadTable = std::get_if<std::shared_ptr<Table>>(&payloadValue)) {
				Value payloadType = (*payloadTable)->get(std::string("type"));
				if (isNil(payloadType)) {
					auto eventTable = std::make_shared<Table>(0, 8);
					eventTable->set(std::string("type"), eventName);
					eventTable->set(std::string("emitter"), emitterValue);
					eventTable->set(std::string("timestamp"), EngineCore::instance().clock()->now());
					for (const auto& [key, value] : (*payloadTable)->entries()) {
						eventTable->set(key, value);
					}
					payload = eventTable;
				} else {
					auto eventTable = std::make_shared<Table>(0, 4);
					eventTable->set(std::string("type"), eventName);
					eventTable->set(std::string("emitter"), emitterValue);
					eventTable->set(std::string("timestamp"), EngineCore::instance().clock()->now());
					eventTable->set(std::string("payload"), payloadValue);
					payload = eventTable;
				}
			} else {
				auto eventTable = std::make_shared<Table>(0, 4);
				eventTable->set(std::string("type"), eventName);
				eventTable->set(std::string("emitter"), emitterValue);
				eventTable->set(std::string("timestamp"), EngineCore::instance().clock()->now());
				eventTable->set(std::string("payload"), payloadValue);
				payload = eventTable;
			}
		} else if (!payloadIsEventTable) {
			auto eventTable = std::make_shared<Table>(0, 3);
			eventTable->set(std::string("type"), eventName);
			eventTable->set(std::string("emitter"), emitterValue);
			eventTable->set(std::string("timestamp"), EngineCore::instance().clock()->now());
			payload = eventTable;
		}

		EngineCore::instance().audioEventManager()->onEvent(eventName, payload, emitterId);
		return {};
	});

	auto gameTable = std::make_shared<Table>(0, 8);
	gameTable->set(std::string("platform"), platformTable);
	gameTable->set(std::string("viewportsize"), viewportTable);
	gameTable->set(std::string("deltatime"), 0.0);
	gameTable->set(std::string("deltatime_seconds"), 0.0);
	gameTable->set(std::string("get_action_state"), getActionStateFn);
	gameTable->set(std::string("consume_action"), consumeActionFn);
	gameTable->set(std::string("emit"), emitFn);
	setGlobal("game", gameTable);
	setGlobal("$", gameTable);

}

void VMRuntime::executeUpdateCallback(double deltaSeconds) {
	bool shouldRunEngineUpdate = !m_updateFn.has_value();
	if (m_pendingVmCall != PendingCall::None && m_pendingVmCall != PendingCall::Update) {
		return;
	}

	try {
		if (m_updateFn) {
			if (m_pendingVmCall == PendingCall::None) {
				m_cpu.call(*m_updateFn, {deltaSeconds}, 0);
				m_pendingVmCall = PendingCall::Update;
			}
			RunResult result = m_cpu.run(UPDATE_STATEMENT_BUDGET);
			processIOCommands();
			if (result == RunResult::Halted) {
				m_pendingVmCall = PendingCall::None;
				shouldRunEngineUpdate = true;
			}
		}
		if (shouldRunEngineUpdate) {
			const double deltaMs = deltaSeconds * 1000.0;
			callEngineModuleMember("update", {deltaMs});
			processIOCommands();
		}
		if (s_updateLogRemaining > 0) {
			const char* pendingLabel = m_pendingVmCall == PendingCall::None
				? "none"
				: (m_pendingVmCall == PendingCall::Update ? "update" : "draw");
			std::cerr << "[VMRuntime] update: vm=" << (m_updateFn.has_value() ? "yes" : "no")
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
	bool shouldRunEngineDraw = !m_drawFn.has_value();
	if (m_pendingVmCall != PendingCall::None && m_pendingVmCall != PendingCall::Draw) {
		return;
	}

	try {
		if (m_drawFn) {
			if (m_pendingVmCall == PendingCall::None) {
				m_cpu.call(*m_drawFn, {}, 0);
				m_pendingVmCall = PendingCall::Draw;
			}
			RunResult result = m_cpu.run(UPDATE_STATEMENT_BUDGET);
			processIOCommands();
			if (result == RunResult::Halted) {
				m_pendingVmCall = PendingCall::None;
				shouldRunEngineDraw = true;
			}
		}
		if (shouldRunEngineDraw) {
			callEngineModuleMember("draw", {});
			processIOCommands();
		}
		if (s_drawLogRemaining > 0) {
			const char* pendingLabel = m_pendingVmCall == PendingCall::None
				? "none"
				: (m_pendingVmCall == PendingCall::Update ? "update" : "draw");
			std::cerr << "[VMRuntime] draw: vm=" << (m_drawFn.has_value() ? "yes" : "no")
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
