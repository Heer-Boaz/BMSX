#include "vm_runtime.h"
#include "vm_api.h"
#include "vm_io.h"
#include <cmath>
#include <cstdlib>
#include <iostream>
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
}

VMRuntime::~VMRuntime() {
	m_api.reset();
}

VMApi& VMRuntime::api() {
	return *m_api;
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
		if (std::holds_alternative<std::shared_ptr<NativeObject>>(v)) return {std::string("userdata")};
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
			try {
				return {std::stod(*s)};
			} catch (...) {
				return {std::monostate{}};
			}
		}
		return {std::monostate{}};
	});

	// pairs - iterator for table
	registerNativeFunction("pairs", [](const std::vector<Value>& args) -> std::vector<Value> {
		// Returns: next, table, nil (starting key)
		// This is a simplified version - full pairs needs proper next() implementation
		if (args.empty()) {
			return {std::monostate{}, std::monostate{}, std::monostate{}};
		}
		// For now, return the table and let next() handle iteration
		return {std::monostate{}, args[0], std::monostate{}};
	});

	// ipairs - array iterator
	registerNativeFunction("ipairs", [](const std::vector<Value>& args) -> std::vector<Value> {
		// Returns: iterator function, table, 0
		if (args.empty()) {
			return {std::monostate{}, std::monostate{}, 0.0};
		}
		return {std::monostate{}, args[0], 0.0};
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
