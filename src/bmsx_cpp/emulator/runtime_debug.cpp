#include "runtime.h"

#include "disassembler.h"
#include "../core/engine_core.h"

#include <iostream>
#include <sstream>
#include <string_view>

namespace bmsx {

namespace {

bool matchesLuaPathAlias(std::string_view assetPath, std::string_view requestedPath) {
	if (assetPath == requestedPath) {
		return true;
	}
	if (assetPath.size() <= requestedPath.size()) {
		return false;
	}
	const size_t offset = assetPath.size() - requestedPath.size();
	return assetPath.compare(offset, requestedPath.size(), requestedPath) == 0 && assetPath[offset - 1] == '/';
}

const LuaSourceAsset* findLuaSourceByPath(const RuntimeAssets& assets, const std::string& path) {
	if (const LuaSourceAsset* direct = assets.getLua(path)) {
		return direct;
	}
	for (const auto& entry : assets.lua) {
		if (matchesLuaPathAlias(entry.second.path, path)) {
			return &entry.second;
		}
	}
	return assets.fallback ? findLuaSourceByPath(*assets.fallback, path) : nullptr;
}

} // namespace

void Runtime::logDebugState() const {
	if (!m_program || m_program->code.empty()) {
		return;
	}
	if (m_cpu.lastPc < 0 || m_cpu.lastPc >= static_cast<int>(m_program->code.size())) {
		return;
	}
	const InstructionDebugInfo instruction = describeInstructionAtPc(*m_program, m_programMetadata, m_cpu.lastPc);
	const int topFrameIndex = m_cpu.getFrameDepth() - 1;
	const int registerCount = topFrameIndex >= 0 ? m_cpu.getFrameRegisterCount(topFrameIndex) : 0;
	std::ostringstream summary;
	summary << "[Runtime] debug: pc=" << instruction.pcText << " op=" << instruction.opName;
	for (const InstructionOperandDebugInfo& operand : instruction.operands) {
		summary << ' ' << operand.label << '=' << operand.text;
		if (operand.registerIndex.has_value() && *operand.registerIndex < registerCount) {
			summary << '(' << valueToString(m_cpu.readFrameRegister(topFrameIndex, *operand.registerIndex)) << ')';
		}
	}
	std::cout << summary.str() << std::endl;
	std::cout << "[Runtime] debug: instr=" << instruction.pcText << ": " << instruction.instructionText << std::endl;
	if (instruction.sourceRange.has_value()) {
		const SourceRange& range = *instruction.sourceRange;
		std::string sourceLine = range.path + ":" + std::to_string(range.startLine) + ":" + std::to_string(range.startColumn);
		const RuntimeAssets& assets = EngineCore::instance().assets();
		if (const LuaSourceAsset* sourceAsset = findLuaSourceByPath(assets, range.path)) {
			const std::string snippet = formatSourceSnippet(range, sourceAsset->source);
			if (!snippet.empty()) {
				sourceLine += " " + snippet;
			}
		}
		std::cout << "[Runtime] debug: source=" << sourceLine << std::endl;
	}
}

} // namespace bmsx
