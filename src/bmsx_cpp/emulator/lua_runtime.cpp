#include "runtime.h"
#include <array>
#include <iostream>
#include <limits>

namespace bmsx {

std::vector<Value> Runtime::callLuaFunction(Closure* fn, const std::vector<Value>& args) {
	int depthBefore = m_cpu.getFrameDepth();
	const int previousBudget = m_cpu.instructionBudgetRemaining;
	const int budgetSentinel = std::numeric_limits<int>::max();
	try {
		m_cpu.callExternal(fn, args);
		m_cpu.runUntilDepth(depthBefore, budgetSentinel);
	} catch (...) {
		const int remaining = m_cpu.instructionBudgetRemaining;
		m_cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
		throw;
	}
	const int remaining = m_cpu.instructionBudgetRemaining;
	m_cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
	return m_cpu.lastReturnValues;
}

Value Runtime::requireModule(const std::string& moduleName) {
	const auto aliasIt = m_moduleAliases.find(moduleName);
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

std::vector<Value> Runtime::callEngineModuleMember(const std::string& name, const std::vector<Value>& args) {
	auto* engineModule = asTable(requireModule("engine"));
	Value key = canonicalizeIdentifier(name);
	auto* member = asClosure(engineModule->get(key));
	return callLuaFunction(member, args);
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
			std::cerr << "  at " << protoId << " (" << range->path << ":" << range->startLine << ":" << range->startColumn << ")"
						<< std::endl;
		} else {
			std::cerr << "  at " << protoId << " (pc=" << pc << ")" << std::endl;
		}
	}
}

void Runtime::handleLuaError(const std::string& message) {
	std::cerr << "[Runtime] Error: " << message << std::endl;
	logLuaCallStack();
	m_runtimeFailed = true;
}

void Runtime::runEngineBuiltinPrelude() {
	std::cerr << "[Runtime] prelude: binding engine builtins" << std::endl;
	static const std::array<const char*, 27> engineBuiltins = {
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
		"vdp_map_slot",
		"vdp_load_slot",
		"vdp_load_sys_atlas",
		"irq",
		"on_irq",
		"on_vdp_load",
	};
	auto* engineModule = asTable(requireModule("engine"));
	for (const char* name : engineBuiltins) {
		Value key = canonicalizeIdentifier(name);
		m_cpu.globals->set(key, engineModule->get(key));
	}
	processIOCommands();
	std::cerr << "[Runtime] prelude: engine builtins bound" << std::endl;
}

} // namespace bmsx
