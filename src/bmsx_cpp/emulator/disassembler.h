#pragma once

#include "cpu.h"
#include <optional>
#include <string>
#include <vector>

namespace bmsx {

struct InstructionOperandDebugInfo {
	std::string label;
	std::string text;
	std::optional<int> registerIndex;
};

struct InstructionDebugInfo {
	int pc = 0;
	std::string pcText;
	OpCode op = OpCode::MOV;
	std::string opName;
	std::string instructionText;
	std::vector<InstructionOperandDebugInfo> operands;
	std::optional<SourceRange> sourceRange;
};

InstructionDebugInfo describeInstructionAtPc(const Program& program, const ProgramMetadata* metadata, int pc);
std::string formatSourceSnippet(const SourceRange& range, const std::string& source);

} // namespace bmsx
