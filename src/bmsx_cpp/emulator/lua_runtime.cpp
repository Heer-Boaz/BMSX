#include "runtime.h"
#include <array>
#include <cctype>
#include <iostream>
#include <limits>

namespace bmsx {

namespace {

std::string canonicalizeModuleAlias(std::string moduleName, CanonicalizationType canonicalization) {
	if (canonicalization == CanonicalizationType::None) {
		return moduleName;
	}
	const bool toUpper = canonicalization == CanonicalizationType::Upper;
	for (char& ch : moduleName) {
		const unsigned char value = static_cast<unsigned char>(ch);
		ch = toUpper
			? static_cast<char>(std::toupper(value))
			: static_cast<char>(std::tolower(value));
	}
	return moduleName;
}

} // namespace

std::vector<Value> Runtime::callLuaFunction(Closure* fn, const std::vector<Value>& args) {
	int depthBefore = m_cpu.getFrameDepth();
	const int previousBudget = m_cpu.instructionBudgetRemaining;
	const int budgetSentinel = std::numeric_limits<int>::max();
	try {
		m_cpu.callExternal(fn, args);
		m_cpu.runUntilDepth(depthBefore, budgetSentinel);
	} catch (...) {
		m_cpu.unwindToDepth(depthBefore);
		const int remaining = m_cpu.instructionBudgetRemaining;
		m_cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
		throw;
	}
	const int remaining = m_cpu.instructionBudgetRemaining;
	m_cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
	return m_cpu.lastReturnValues;
}

Value Runtime::requireModule(const std::string& moduleName) {
	auto aliasIt = m_moduleAliases.find(moduleName);
	if (aliasIt == m_moduleAliases.end()) {
		const std::string canonicalName = canonicalizeModuleAlias(moduleName, m_canonicalization);
		aliasIt = m_moduleAliases.find(canonicalName);
	}
	if (aliasIt == m_moduleAliases.end()) {
		throw BMSX_RUNTIME_ERROR("require('" + moduleName + "') failed: module not found.");
	}
	const std::string& path = aliasIt->second;
	const auto cachedIt = m_moduleCache.find(path);
	if (cachedIt != m_moduleCache.end()) {
		return cachedIt->second;
	}
	const auto protoIt = m_moduleProtos.find(path);
	if (protoIt == m_moduleProtos.end()) {
		throw BMSX_RUNTIME_ERROR("require('" + moduleName + "') failed: module not compiled.");
	}
	m_moduleCache[path] = valueBool(true);
	auto* closure = m_cpu.createRootClosure(protoIt->second);
	std::vector<Value> results = callLuaFunction(closure, {});
	Value value = results.empty() ? valueNil() : results[0];
	Value cachedValue = isNil(value) ? valueBool(true) : value;
	m_moduleCache[path] = cachedValue;
	return cachedValue;
}

void Runtime::logLuaCallStack() const {
	const ProgramMetadata* metadata = m_programMetadata;
	if (!metadata) {
		return;
	}
	auto stack = m_cpu.getCallStack();
	for (const auto& [protoIndex, pc] : stack) {
		const std::string& protoId = metadata->protoIds[protoIndex];
		auto range = m_cpu.getDebugRange(pc);
		if (range.has_value()) {
			std::cout << "  at " << protoId << " (" << range->path << ":" << range->startLine << ":" << range->startColumn << ")"
						<< std::endl;
		} else {
			std::cout << "  at " << protoId << " (pc=" << pc << ")" << std::endl;
		}
	}
}

void Runtime::handleLuaError(const std::string& message) {
	std::cout << "[Runtime] Error: " << message << std::endl;
	logDebugState();
	logLuaCallStack();
	m_runtimeFailed = true;
}

void Runtime::runEngineBuiltinPrelude() {
	std::cout << "[Runtime] prelude: binding engine builtins" << std::endl;
	static const std::array<const char*, 44> engineBuiltins = {
		"define_fsm",
		"define_prefab",
		"define_component",
		"define_effect",
		"timeline",
		"inst",
		"object",
		"add_space",
		"set_space",
		"get_space",
		"attach_component",
		"update",
		"reset",
		"configure_ecs",
		"apply_default_pipeline",
		"enlist",
		"delist",
		"grant_effect",
		"trigger_effect",
		"vdp_map_slot",
		"vdp_load_slot",
		"vdp_load_sys_atlas",
		"irq",
		"on_irq",
		"on_vdp_load",
		"bool01",
		"clear_map",
		"deep_clone",
		"scratchbatch",
		"sorted_scratchbatch",
		"consume_axis_accum",
		"set_velocity",
		"move_with_velocity",
		"rect_overlaps",
		"clamp_int",
		"div_toward_zero",
		"round_to_nearest",
		"rol8",
		"swap_remove",
		"objects_by_type",
		"objects_by_tag",
		"find_by_type",
		"find_by_tag",
		"eventemitter",
	};
	// Keep this in sync with TS Runtime.LUA_OVERRIDEABLE_GLOBALS.
	static const std::array<const char*, 1> overrideableEngineBuiltins = {
		"update",
	};
	const auto isOverrideableBuiltin = [](const char* builtinName) {
		for (const char* overrideableName : overrideableEngineBuiltins) {
			if (std::string_view(overrideableName) == builtinName) {
				return true;
			}
		}
		return false;
	};
	auto* engineModule = asTable(requireModule("bios/engine"));
	for (const char* name : engineBuiltins) {
		Value key = canonicalizeIdentifier(name);
		if (isOverrideableBuiltin(name) && !isNil(m_cpu.globals->get(key))) {
			continue;
		}
		m_cpu.globals->set(key, engineModule->get(key));
	}
	std::cout << "[Runtime] prelude: engine builtins bound" << std::endl;
}

} // namespace bmsx
