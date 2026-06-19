#include "machine/runtime/runtime.h"
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
	machine.inputController.cancelSampleArm();
	m_pendingCall = PendingCall::None;
	frameLoop.frameActive = false;
	m_runtimeFailed = true;
}


} // namespace bmsx
