#include "machine/runtime/runtime.h"
#include <array>
#include <iostream>

namespace bmsx {

Value Runtime::requireModule(const std::string& moduleName) {
	auto aliasIt = m_moduleAliases.find(moduleName);
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
	auto* closure = m_machine.cpu().createRootClosure(protoIt->second);
	NativeResults results;
	callLuaFunctionInto(closure, NativeArgsView(), results);
	Value value = results.empty() ? valueNil() : results[0];
	Value cachedValue = isNil(value) ? valueBool(true) : value;
	m_moduleCache[path] = cachedValue;
	return cachedValue;
}

void Runtime::runStaticModuleInitializer(const std::string& path) {
	if (m_moduleCache.find(path) != m_moduleCache.end()) {
		return;
	}
	const auto protoIt = m_moduleProtos.find(path);
	if (protoIt == m_moduleProtos.end()) {
		throw BMSX_RUNTIME_ERROR("static module init failed: module '" + path + "' is not compiled.");
	}
	m_moduleCache[path] = valueBool(true);
	auto* closure = m_machine.cpu().createRootClosure(protoIt->second);
	NativeResults results;
	try {
		callLuaFunctionInto(closure, NativeArgsView(), results);
	} catch (...) {
		m_moduleCache.erase(path);
		throw;
	}
	m_moduleCache.erase(path);
}

void Runtime::runStaticModuleInitializers(const std::vector<std::string>& paths) {
	for (const std::string& path : paths) {
		runStaticModuleInitializer(path);
	}
	m_machine.cpu().syncGlobalSlotsToTable();
}

void Runtime::logLuaCallStack() const {
	const ProgramMetadata* metadata = m_programMetadata;
	if (!metadata) {
		return;
	}
	auto stack = m_machine.cpu().getCallStack();
	if (stack.empty()) {
		auto range = m_machine.cpu().getDebugRange(m_machine.cpu().lastPc);
		if (range.has_value()) {
			std::cout << "  at <current> (" << range->path << ":" << range->startLine << ":" << range->startColumn << ")"
						<< std::endl;
		} else {
			std::cout << "  at <current> (pc=" << m_machine.cpu().lastPc << ")" << std::endl;
		}
		return;
	}
	for (const auto& [protoIndex, pc] : stack) {
		const std::string& protoId = metadata->protoIds[protoIndex];
		auto range = m_machine.cpu().getDebugRange(pc);
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
	m_hostFaultMessage = message;
	logDebugState();
	logLuaCallStack();
	vblank.clearHaltUntilIrq(*this);
	m_machine.inputController().restoreSampleArmed(false);
	m_pendingCall = PendingCall::None;
	frameLoop.frameActive = false;
	m_runtimeFailed = true;
}

void Runtime::runEngineBuiltinPrelude() {
	std::cout << "[Runtime] prelude: binding engine builtins" << std::endl;
	static const std::array engineBuiltinNames = {
		"define_fsm",
		"define_prefab",
		"define_subsystem",
		"define_component",
		"define_effect",
		"inst",
		"inst_subsystem",
		"oget",
		"rget",
		"subsystem",
		"add_space",
		"set_space",
		"get_space",
		"attach_component",
		"update_world",
		"draw_world",
		"reset",
		"configure_ecs",
		"apply_default_pipeline",
		"enlist",
		"delist",
		"grant_effect",
		"trigger_effect",
		"vdp_load_slot",
		"vdp_load_sys_textpage",
		"vdp_blit_img_rgba",
		"vdp_img_rect",
		"vdp_img_slot",
		"vdp_img_source",
		"vdp_write_source_words",
		"vdp_stream_claim_words",
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
		"all_objects_by_type",
		"objects_by_tag",
		"all_objects_by_tag",
		"find_by_type",
		"find_any_by_type",
		"find_by_tag",
		"find_any_by_tag",
		"timeline",
		"eventemitter",
		"scratchbatch",
		"sorted_scratchbatch",
	};
	const Value engineValue = requireModule("bios/engine");
	Table* engineModule = valueIsTable(engineValue) ? asTable(engineValue) : nullptr;
	m_machine.cpu().syncGlobalSlotsToTable();
	for (const char* name : engineBuiltinNames) {
		std::string exportName = "res__bios__engine__";
		exportName += name;
		Value value = m_machine.cpu().getGlobalByKey(luaKey(exportName));
		if (isNil(value) && engineModule) {
			value = engineModule->get(luaKey(name));
		}
		if (isNil(value)) {
			throw BMSX_RUNTIME_ERROR("Engine builtin export '" + exportName + "' is missing.");
		}
		m_machine.cpu().setGlobalByKey(luaKey(name), value);
	}
	std::cout << "[Runtime] prelude: engine builtins bound" << std::endl;
}

} // namespace bmsx
