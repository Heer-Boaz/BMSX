#include "machine/runtime/runtime.h"
#include <array>
#include <iostream>

namespace bmsx {

Value Runtime::requireModule(const std::string& moduleName) {
	const auto cachedIt = m_moduleCache.find(moduleName);
	if (cachedIt != m_moduleCache.end()) {
		return cachedIt->second;
	}
	const auto protoIt = m_moduleProtos.find(moduleName);
	if (protoIt == m_moduleProtos.end()) {
		throw BMSX_RUNTIME_ERROR("require('" + moduleName + "') failed: module not found.");
	}
	m_moduleCache[moduleName] = valueBool(true);
	auto* closure = machine.cpu.createRootClosure(protoIt->second);
	NativeResults results;
	callLuaFunctionInto(closure, NativeArgsView(), results);
	Value value = results.empty() ? valueNil() : results[0];
	Value cachedValue = isNil(value) ? valueBool(true) : value;
	m_moduleCache[moduleName] = cachedValue;
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
	auto* closure = machine.cpu.createRootClosure(protoIt->second);
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
	machine.cpu.syncGlobalSlotsToTable();
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
	std::cout << "[Runtime] Error: " << message << std::endl;
	m_hostFaultMessage = message;
	logDebugState();
	logLuaCallStack();
	machine.cpu.clearHaltUntilIrq();
	machine.inputController.sampleArmed = false;
	m_pendingCall = PendingCall::None;
	frameLoop.frameActive = false;
	m_runtimeFailed = true;
}

void Runtime::runSystemBuiltinPrelude() {
	std::cout << "[Runtime] prelude: binding system ROM builtins" << std::endl;
	static const std::array systemBuiltinNames = {
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
		"vdp_load_system_slot",
		"vdp_blit_img_color",
		"vdp_glyph_color",
		"vdp_img_rect",
		"vdp_img_slot",
		"vdp_img_source",
		"vdp_write_source",
		"vdp_pmu_write_bank",
		"vdp_stream_claim",
		"vdp_stream_finish",
		"vdp_clear_color",
		"vdp_fill_rect_color",
		"vdp_draw_line_color",
		"rom_data",
		"irq",
		"on_irq",
		"on_vdp_load",
		"bool01",
		"clear_map",
		"deep_clone",
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
		const Value systemValue = requireModule("bios/system");
		Table* systemModule = nullptr;
		if (valueIsTable(systemValue)) {
			systemModule = asTable(systemValue);
		}
	machine.cpu.syncGlobalSlotsToTable();
	for (const char* name : systemBuiltinNames) {
		std::string exportName = "res__bios__system__";
		exportName += name;
		Value value = machine.cpu.getGlobalByKey(internString(exportName));
		if (isNil(value) && systemModule) {
			value = systemModule->get(internString(name));
		}
		if (isNil(value)) {
			throw BMSX_RUNTIME_ERROR("System ROM builtin export '" + exportName + "' is missing.");
		}
		machine.cpu.setGlobalByKey(internString(name), value);
	}
	std::cout << "[Runtime] prelude: system ROM builtins bound" << std::endl;
}

} // namespace bmsx
