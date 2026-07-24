#pragma once

#include "machine/cpu/blua32_image.h"
#include "machine/cpu/blua32_symbols.h"
#include "machine/cpu/opcode_info.h"

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
	u32 pc = 0;
	std::string pcText;
	OpCode op = OpCode::MOV;
	std::string opName;
	std::string instructionText;
	std::vector<InstructionOperandDebugInfo> operands;
	std::optional<SourceRange> sourceRange;
};

auto describeInstructionAtPc(
	const Blua32ImageLayout& image,
	const Blua32SymbolsImage* symbols,
	u32 pc
) -> InstructionDebugInfo;
std::string formatSourceSnippet(const SourceRange& range, const std::string& source);

} // namespace bmsx
