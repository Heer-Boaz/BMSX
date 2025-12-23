#include "vm_runtime.h"
#include "vm_api.h"
#include "vm_io.h"
#include "program_loader.h"
#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdlib>
#include <iomanip>
#include <iostream>
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
{
	// Initialize I/O memory region
	std::fill(m_memory.begin(), m_memory.end(), std::monostate{});
	// Write pointer starts at 0
	m_memory[IO_WRITE_PTR_ADDR] = 0.0;
	// System flags
	m_memory[IO_SYS_CART_PRESENT] = false;
	m_memory[IO_SYS_BOOT_CART] = false;

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
	m_program = program;
	m_cpu.setProgram(program);

	// Start execution at entry point
	std::cerr << "[VMRuntime] boot: starting CPU at entry point..." << std::endl;
	m_cpu.start(entryProtoIndex);

	// Run until halted to execute top-level code
	std::cerr << "[VMRuntime] boot: running top-level code..." << std::endl;
	m_cpu.run();
	std::cerr << "[VMRuntime] boot: top-level code executed" << std::endl;

	// Cache callback functions (use Lua-style names: update, draw, init)
	Value updateVal = m_cpu.globals.get(std::string("update"));
	if (auto cls = std::get_if<std::shared_ptr<Closure>>(&updateVal)) {
		m_updateFn = *cls;
		std::cerr << "[VMRuntime] boot: found update" << std::endl;
	}

	Value drawVal = m_cpu.globals.get(std::string("draw"));
	if (auto cls = std::get_if<std::shared_ptr<Closure>>(&drawVal)) {
		m_drawFn = *cls;
		std::cerr << "[VMRuntime] boot: found draw" << std::endl;
	}

	Value initVal = m_cpu.globals.get(std::string("init"));
	if (auto cls = std::get_if<std::shared_ptr<Closure>>(&initVal)) {
		m_initFn = *cls;
		std::cerr << "[VMRuntime] boot: found init" << std::endl;
	}

	// Call init if present
	if (m_initFn) {
		std::cerr << "[VMRuntime] boot: calling init..." << std::endl;
		callLuaFunction(*m_initFn, {});
	}

	m_vmInitialized = true;
	std::cerr << "[VMRuntime] boot: VM initialized!" << std::endl;
}

void VMRuntime::tickUpdate() {
	if (!m_vmInitialized || !m_tickEnabled || m_runtimeFailed) {
		return;
	}

	m_frameState.updateExecuted = false;

	// Process any pending I/O commands from previous frame
	processIOCommands();

	// Call _update if present
	executeUpdateCallback();

	m_frameState.updateExecuted = true;
}

void VMRuntime::tickDraw() {
	if (!m_vmInitialized || !m_tickEnabled || m_runtimeFailed) {
		return;
	}

	// Call _draw if present
	executeDrawCallback();

	// Process any I/O commands generated during draw
	processIOCommands();
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
				std::cout << valueToString(arg) << std::endl;
				break;
			}
			default:
				// Unknown command - ignore
				break;
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
	m_cpu.runUntilDepth(depthBefore);
	return m_cpu.lastReturnValues;
}

Value VMRuntime::getGlobal(const std::string& name) const {
	return m_cpu.globals.get(name);
}

void VMRuntime::setGlobal(const std::string& name, const Value& value) {
	m_cpu.globals.set(name, value);
}

void VMRuntime::registerNativeFunction(const std::string& name, NativeFunctionInvoke fn) {
	auto nativeFn = createNativeFunction(name, std::move(fn));
	m_cpu.globals.set(name, nativeFn);
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
				std::string text = valueToString(value);
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
				std::string raw = valueToString(value);
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

void VMRuntime::setupBuiltins() {
	// Register standard library functions

	// print - handled via I/O commands, but also available as native
	registerNativeFunction("print", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (!args.empty()) {
			std::cout << valueToString(args[0]) << std::endl;
		}
		return {};
	});

	// type
	registerNativeFunction("type", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			return {std::string("nil")};
		}
		const Value& v = args[0];
		if (isNil(v)) return {std::string("nil")};
		if (std::holds_alternative<bool>(v)) return {std::string("boolean")};
		if (std::holds_alternative<double>(v)) return {std::string("number")};
		if (std::holds_alternative<std::string>(v)) return {std::string("string")};
		if (std::holds_alternative<std::shared_ptr<Table>>(v)) return {std::string("table")};
		if (std::holds_alternative<std::shared_ptr<Closure>>(v)) return {std::string("function")};
		if (std::holds_alternative<std::shared_ptr<NativeFunction>>(v)) return {std::string("function")};
		if (std::holds_alternative<std::shared_ptr<NativeObject>>(v)) return {std::string("native")};
		return {std::string("unknown")};
	});

	// tostring
	registerNativeFunction("tostring", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			return {std::string("nil")};
		}
		return {valueToString(args[0])};
	});

	// tonumber
	registerNativeFunction("tonumber", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			return {std::monostate{}};
		}
		const Value& v = args[0];
		if (auto* n = std::get_if<double>(&v)) {
			return {*n};
		}
		if (auto* s = std::get_if<std::string>(&v)) {
			if (args.size() >= 2) {
				int base = static_cast<int>(std::floor(asNumber(args[1])));
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
			try {
				return {std::stod(*s)};
			} catch (...) {
				return {std::monostate{}};
			}
		}
		return {std::monostate{}};
	});

	// require - VM module loader
	registerNativeFunction("require", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& moduleName = asString(args.at(0));
		return {requireVmModule(moduleName)};
	});

	// array - native array wrapper
	registerNativeFunction("array", [](const std::vector<Value>& args) -> std::vector<Value> {
		struct NativeArray {
			std::vector<Value> values;
			std::unordered_map<std::string, Value> props;
		};

		auto data = std::make_shared<NativeArray>();
		if (args.size() == 1) {
			if (auto tbl = std::get_if<std::shared_ptr<Table>>(&args[0])) {
				const auto entries = (*tbl)->entries();
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
				data->values.push_back(args[0]);
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
						if (index < 0 || index >= static_cast<int>(data->values.size())) {
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
					data->props[*s] = value;
					return;
				}
				throw std::runtime_error("Attempted to index native array with unsupported key.");
			},
			[data]() -> int {
				return static_cast<int>(data->values.size());
			}
		);

		return {native};
	});

	// next - table iterator
	registerNativeFunction("next", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			throw std::runtime_error("next expects a table as the first argument.");
		}
		auto* tbl = std::get_if<std::shared_ptr<Table>>(&args[0]);
		if (!tbl) {
			throw std::runtime_error("next expects a table as the first argument.");
		}
		Value lastKey = args.size() > 1 ? args[1] : std::monostate{};
		const auto entries = (*tbl)->entries();
		if (entries.empty()) {
			return {std::monostate{}};
		}
		if (isNil(lastKey)) {
			const auto& [key, value] = entries[0];
			return {key, value};
		}
		bool returnNext = false;
		for (const auto& [key, value] : entries) {
			if (returnNext) {
				return {key, value};
			}
			if (key == lastKey) {
				returnNext = true;
			}
		}
		return {std::monostate{}};
	});

	// pairs - iterator for table
	registerNativeFunction("pairs", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			throw std::runtime_error("pairs expects a table as the first argument.");
		}
		auto* tbl = std::get_if<std::shared_ptr<Table>>(&args[0]);
		if (!tbl) {
			throw std::runtime_error("pairs expects a table as the first argument.");
		}
		Value nextFn = m_cpu.globals.get(std::string("next"));
		return {nextFn, args[0], std::monostate{}};
	});

	// ipairs - array iterator
	auto ipairsIter = createNativeFunction("ipairs_iter", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			return {std::monostate{}};
		}
		auto* tbl = std::get_if<std::shared_ptr<Table>>(&args[0]);
		if (!tbl) {
			return {std::monostate{}};
		}
		int index = 1;
		if (args.size() > 1) {
			if (auto* n = std::get_if<double>(&args[1])) {
				index = static_cast<int>(*n) + 1;
			}
		}
		Value value = (*tbl)->get(static_cast<double>(index));
		if (isNil(value)) {
			return {std::monostate{}};
		}
		return {static_cast<double>(index), value};
	});

	registerNativeFunction("ipairs", [ipairsIter](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			throw std::runtime_error("ipairs expects a table as the first argument.");
		}
		auto* tbl = std::get_if<std::shared_ptr<Table>>(&args[0]);
		if (!tbl) {
			throw std::runtime_error("ipairs expects a table as the first argument.");
		}
		return {ipairsIter, args[0], 0.0};
	});

	// setmetatable
	registerNativeFunction("setmetatable", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.size() < 2) {
			return {std::monostate{}};
		}
		auto* tbl = std::get_if<std::shared_ptr<Table>>(&args[0]);
		if (!tbl) {
			return {args[0]};
		}
		if (isNil(args[1])) {
			(*tbl)->setMetatable(nullptr);
		} else if (auto* mt = std::get_if<std::shared_ptr<Table>>(&args[1])) {
			(*tbl)->setMetatable(*mt);
		}
		return {args[0]};
	});

	// getmetatable
	registerNativeFunction("getmetatable", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			return {std::monostate{}};
		}
		auto* tbl = std::get_if<std::shared_ptr<Table>>(&args[0]);
		if (!tbl) {
			return {std::monostate{}};
		}
		auto mt = (*tbl)->getMetatable();
		if (mt) {
			return {mt};
		}
		return {std::monostate{}};
	});

	// peek - read from VM memory
	registerNativeFunction("peek", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			return {std::monostate{}};
		}
		int addr = static_cast<int>(asNumber(args[0]));
		if (addr >= 0 && addr < static_cast<int>(m_memory.size())) {
			return {m_memory[addr]};
		}
		return {std::monostate{}};
	});

	// poke - write to VM memory
	registerNativeFunction("poke", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.size() < 2) {
			return {};
		}
		int addr = static_cast<int>(asNumber(args[0]));
		if (addr >= 0 && addr < static_cast<int>(m_memory.size())) {
			m_memory[addr] = args[1];
		}
		return {};
	});

	// System constants
	setGlobal("SYS_CART_PRESENT", static_cast<double>(IO_SYS_CART_PRESENT));
	setGlobal("SYS_BOOT_CART", static_cast<double>(IO_SYS_BOOT_CART));

	// Math library (basic functions)
	auto mathTable = std::make_shared<Table>();

	mathTable->set(std::string("abs"), createNativeFunction("math.abs", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {std::abs(asNumber(args[0]))};
	}));

	mathTable->set(std::string("floor"), createNativeFunction("math.floor", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {std::floor(asNumber(args[0]))};
	}));

	mathTable->set(std::string("ceil"), createNativeFunction("math.ceil", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {std::ceil(asNumber(args[0]))};
	}));

	mathTable->set(std::string("sqrt"), createNativeFunction("math.sqrt", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {std::sqrt(asNumber(args[0]))};
	}));

	mathTable->set(std::string("sin"), createNativeFunction("math.sin", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {std::sin(asNumber(args[0]))};
	}));

	mathTable->set(std::string("cos"), createNativeFunction("math.cos", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {std::cos(asNumber(args[0]))};
	}));

	mathTable->set(std::string("tan"), createNativeFunction("math.tan", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {std::tan(asNumber(args[0]))};
	}));

	mathTable->set(std::string("atan2"), createNativeFunction("math.atan2", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.size() < 2) return {0.0};
		return {std::atan2(asNumber(args[0]), asNumber(args[1]))};
	}));

	mathTable->set(std::string("min"), createNativeFunction("math.min", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		double minVal = asNumber(args[0]);
		for (size_t i = 1; i < args.size(); ++i) {
			minVal = std::min(minVal, asNumber(args[i]));
		}
		return {minVal};
	}));

	mathTable->set(std::string("max"), createNativeFunction("math.max", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		double maxVal = asNumber(args[0]);
		for (size_t i = 1; i < args.size(); ++i) {
			maxVal = std::max(maxVal, asNumber(args[i]));
		}
		return {maxVal};
	}));

	mathTable->set(std::string("random"), createNativeFunction("math.random", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) {
			return {static_cast<double>(rand()) / RAND_MAX};
		}
		if (args.size() == 1) {
			int n = static_cast<int>(asNumber(args[0]));
			return {static_cast<double>(rand() % n + 1)};
		}
		int m = static_cast<int>(asNumber(args[0]));
		int n = static_cast<int>(asNumber(args[1]));
		return {static_cast<double>(rand() % (n - m + 1) + m)};
	}));

	mathTable->set(std::string("pi"), 3.14159265358979323846);

	setGlobal("math", mathTable);

	// String library (basic functions)
	auto stringTable = std::make_shared<Table>();

	stringTable->set(std::string("len"), createNativeFunction("string.len", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {static_cast<double>(asString(args[0]).length())};
	}));

	stringTable->set(std::string("sub"), createNativeFunction("string.sub", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {std::string("")};
		const std::string& s = asString(args[0]);
		int start = args.size() > 1 ? static_cast<int>(asNumber(args[1])) : 1;
		int end = args.size() > 2 ? static_cast<int>(asNumber(args[2])) : static_cast<int>(s.length());

		// Lua 1-based indexing
		if (start < 0) start = static_cast<int>(s.length()) + start + 1;
		if (end < 0) end = static_cast<int>(s.length()) + end + 1;
		start = std::max(1, start);
		end = std::min(static_cast<int>(s.length()), end);

		if (start > end) return {std::string("")};
		return {s.substr(start - 1, end - start + 1)};
	}));

	stringTable->set(std::string("upper"), createNativeFunction("string.upper", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {std::string("")};
		std::string s = asString(args[0]);
		for (auto& c : s) c = static_cast<char>(std::toupper(c));
		return {s};
	}));

	stringTable->set(std::string("lower"), createNativeFunction("string.lower", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {std::string("")};
		std::string s = asString(args[0]);
		for (auto& c : s) c = static_cast<char>(std::tolower(c));
		return {s};
	}));

	stringTable->set(std::string("find"), createNativeFunction("string.find", [](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& source = asString(args.at(0));
		const std::string& pattern = args.size() > 1 ? asString(args[1]) : std::string("");
		int startIndex = args.size() > 2 ? std::max(1, static_cast<int>(std::floor(asNumber(args[2])))) - 1 : 0;
		size_t position = source.find(pattern, static_cast<size_t>(startIndex));
		if (position == std::string::npos) {
			return {std::monostate{}};
		}
		int first = static_cast<int>(position) + 1;
		int last = first + static_cast<int>(pattern.size()) - 1;
		return {static_cast<double>(first), static_cast<double>(last)};
	}));

	stringTable->set(std::string("byte"), createNativeFunction("string.byte", [](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& source = asString(args.at(0));
		int position = args.size() > 1 ? static_cast<int>(std::floor(asNumber(args[1]))) - 1 : 0;
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
			int code = static_cast<int>(std::floor(asNumber(arg)));
			result.push_back(static_cast<char>(code));
		}
		return {result};
	}));

	stringTable->set(std::string("format"), createNativeFunction("string.format", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& templateStr = asString(args.at(0));
		return {formatVmString(templateStr, args, 1)};
	}));

	setGlobal("string", stringTable);

	// Table library (basic functions)
	auto tableLib = std::make_shared<Table>();

	tableLib->set(std::string("insert"), createNativeFunction("table.insert", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {};
		auto* tbl = std::get_if<std::shared_ptr<Table>>(&args[0]);
		if (!tbl) return {};

		if (args.size() == 2) {
			// table.insert(t, value) - append
			int len = (*tbl)->length();
			(*tbl)->set(static_cast<double>(len + 1), args[1]);
		} else if (args.size() >= 3) {
			// table.insert(t, pos, value) - insert at position
			int pos = static_cast<int>(asNumber(args[1]));
			int len = (*tbl)->length();
			// Shift elements
			for (int i = len; i >= pos; --i) {
				(*tbl)->set(static_cast<double>(i + 1), (*tbl)->get(static_cast<double>(i)));
			}
			(*tbl)->set(static_cast<double>(pos), args[2]);
		}
		return {};
	}));

	tableLib->set(std::string("remove"), createNativeFunction("table.remove", [](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {std::monostate{}};
		auto* tbl = std::get_if<std::shared_ptr<Table>>(&args[0]);
		if (!tbl) return {std::monostate{}};

		int len = (*tbl)->length();
		int pos = args.size() > 1 ? static_cast<int>(asNumber(args[1])) : len;
		if (pos < 1 || pos > len) return {std::monostate{}};

		Value removed = (*tbl)->get(static_cast<double>(pos));
		// Shift elements down
		for (int i = pos; i < len; ++i) {
			(*tbl)->set(static_cast<double>(i), (*tbl)->get(static_cast<double>(i + 1)));
		}
		(*tbl)->set(static_cast<double>(len), std::monostate{});
		return {removed};
	}));

	setGlobal("table", tableLib);
}

void VMRuntime::executeUpdateCallback() {
	if (!m_updateFn) {
		return;
	}

	try {
		callLuaFunction(*m_updateFn, {});
	} catch (const std::exception& e) {
		std::cerr << "[VMRuntime] Error in _update: " << e.what() << std::endl;
		m_runtimeFailed = true;
	}
}

void VMRuntime::executeDrawCallback() {
	if (!m_drawFn) {
		return;
	}

	try {
		callLuaFunction(*m_drawFn, {});
	} catch (const std::exception& e) {
		std::cerr << "[VMRuntime] Error in _draw: " << e.what() << std::endl;
		m_runtimeFailed = true;
	}
}

} // namespace bmsx
