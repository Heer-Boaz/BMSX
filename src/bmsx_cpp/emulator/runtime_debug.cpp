#include "runtime.h"

#include "disassembler.h"
#include "../core/engine_core.h"

#include <cctype>
#include <iostream>
#include <optional>
#include <sstream>
#include <string_view>
#include <unordered_set>
#include <vector>

namespace bmsx {

namespace {

constexpr int MAX_DEBUG_EXPRESSIONS = 8;

const std::unordered_set<std::string> LUA_KEYWORDS = {
	"and",
	"break",
	"do",
	"else",
	"elseif",
	"end",
	"false",
	"for",
	"function",
	"if",
	"in",
	"local",
	"nil",
	"not",
	"or",
	"repeat",
	"return",
	"then",
	"true",
	"until",
	"while",
};

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

int comparePosition(int line, int column, int otherLine, int otherColumn) {
	if (line < otherLine) {
		return -1;
	}
	if (line > otherLine) {
		return 1;
	}
	if (column < otherColumn) {
		return -1;
	}
	if (column > otherColumn) {
		return 1;
	}
	return 0;
}

bool positionWithinRange(int line, int column, const SourceRange& range) {
	return comparePosition(line, column, range.startLine, range.startColumn) >= 0
		&& comparePosition(line, column, range.endLine, range.endColumn) <= 0;
}

bool positionAfterOrEqual(int line, int column, int otherLine, int otherColumn) {
	return comparePosition(line, column, otherLine, otherColumn) >= 0;
}

int rangeArea(const SourceRange& range) {
	return ((range.endLine - range.startLine) * 1'000'000) + (range.endColumn - range.startColumn);
}

bool isIdentifierStart(char ch) {
	const unsigned char byte = static_cast<unsigned char>(ch);
	return std::isalpha(byte) != 0 || ch == '_';
}

bool isIdentifierChar(char ch) {
	const unsigned char byte = static_cast<unsigned char>(ch);
	return std::isalnum(byte) != 0 || ch == '_';
}

std::string extractRawSourceFragment(const SourceRange& range, const std::string& source) {
	std::vector<std::string_view> lines;
	lines.reserve(128);
	size_t lineStart = 0;
	for (size_t index = 0; index <= source.size(); ++index) {
		if (index < source.size() && source[index] != '\n') {
			continue;
		}
		size_t lineEnd = index;
		if (lineEnd > lineStart && source[lineEnd - 1] == '\r') {
			lineEnd -= 1;
		}
		lines.emplace_back(source.data() + lineStart, lineEnd - lineStart);
		lineStart = index + 1;
	}
	const int startLineIndex = range.startLine - 1;
	const int endLineIndex = range.endLine - 1;
	if (startLineIndex < 0 || endLineIndex < startLineIndex || endLineIndex >= static_cast<int>(lines.size())) {
		return {};
	}
	std::string fragment;
	for (int index = startLineIndex; index <= endLineIndex; ++index) {
		if (!fragment.empty()) {
			fragment.push_back(' ');
		}
		fragment.append(lines[static_cast<size_t>(index)].data(), lines[static_cast<size_t>(index)].size());
	}
	return fragment;
}

std::vector<std::string> extractExpressionCandidates(const SourceRange& range, const std::string& source) {
	const std::string fragment = extractRawSourceFragment(range, source);
	std::unordered_set<std::string> seen;
	std::vector<std::string> result;
	result.reserve(MAX_DEBUG_EXPRESSIONS);
	for (size_t index = 0; index < fragment.size();) {
		if (!isIdentifierStart(fragment[index])) {
			index += 1;
			continue;
		}
		size_t end = index + 1;
		while (end < fragment.size() && isIdentifierChar(fragment[end])) {
			end += 1;
		}
		while (end < fragment.size() && fragment[end] == '.' && (end + 1) < fragment.size() && isIdentifierStart(fragment[end + 1])) {
			size_t segmentEnd = end + 2;
			while (segmentEnd < fragment.size() && isIdentifierChar(fragment[segmentEnd])) {
				segmentEnd += 1;
			}
			end = segmentEnd;
		}
		std::string expression = fragment.substr(index, end - index);
		if (LUA_KEYWORDS.find(expression) == LUA_KEYWORDS.end() && seen.insert(expression).second) {
			result.push_back(std::move(expression));
			if (static_cast<int>(result.size()) >= MAX_DEBUG_EXPRESSIONS) {
				break;
			}
		}
		index = end;
	}
	return result;
}

Value canonicalizeDebugIdentifier(const Runtime& runtime, std::string_view value) {
	return const_cast<Runtime&>(runtime).canonicalizeIdentifier(value);
}

std::string formatDebugValue(const Runtime& runtime, Value value) {
	if (valueIsString(value)) {
		std::ostringstream out;
		out << '"';
		for (char ch : runtime.cpu().stringPool().toString(asStringId(value))) {
			switch (ch) {
				case '\\': out << "\\\\"; break;
				case '"': out << "\\\""; break;
				case '\n': out << "\\n"; break;
				case '\r': out << "\\r"; break;
				case '\t': out << "\\t"; break;
				default: out << ch; break;
			}
		}
		out << '"';
		return out.str();
	}
	return valueToString(value, runtime.cpu().stringPool());
}

const LocalSlotDebug* selectLocalSlot(const std::vector<LocalSlotDebug>& slots, const std::string& name, const SourceRange& range) {
	const LocalSlotDebug* best = nullptr;
	for (const LocalSlotDebug& slot : slots) {
		if (slot.name != name) {
			continue;
		}
		if (!positionWithinRange(range.startLine, range.startColumn, slot.scope)) {
			continue;
		}
		if (!positionAfterOrEqual(range.startLine, range.startColumn, slot.definition.startLine, slot.definition.startColumn)) {
			continue;
		}
		if (!best || rangeArea(slot.scope) < rangeArea(best->scope)) {
			best = &slot;
		}
	}
	return best;
}

std::optional<Value> resolveRootExpressionValue(
	const Runtime& runtime,
	const ProgramMetadata* metadata,
	int frameIndex,
	int protoIndex,
	const SourceRange& range,
	const std::string& rootName
) {
	std::string canonicalName = runtime.cpu().stringPool().toString(asStringId(canonicalizeDebugIdentifier(runtime, rootName)));
	if (metadata && protoIndex >= 0 && protoIndex < static_cast<int>(metadata->localSlotsByProto.size())) {
		const std::vector<LocalSlotDebug>& slots = metadata->localSlotsByProto[static_cast<size_t>(protoIndex)];
		if (const LocalSlotDebug* slot = selectLocalSlot(slots, canonicalName, range)) {
			return runtime.cpu().readFrameRegister(frameIndex, slot->reg);
		}
	}
	const Value globalValue = runtime.cpu().globals->get(canonicalizeDebugIdentifier(runtime, rootName));
	if (!isNil(globalValue)) {
		return globalValue;
	}
	return std::nullopt;
}

std::optional<Value> resolveExpressionValue(
	const Runtime& runtime,
	const ProgramMetadata* metadata,
	int frameIndex,
	int protoIndex,
	const SourceRange& range,
	const std::string& expression
) {
	const size_t firstDot = expression.find('.');
	const std::string rootName = firstDot == std::string::npos ? expression : expression.substr(0, firstDot);
	std::optional<Value> root = resolveRootExpressionValue(runtime, metadata, frameIndex, protoIndex, range, rootName);
	if (!root.has_value()) {
		return std::nullopt;
	}
	Value current = *root;
	size_t segmentStart = firstDot;
	while (segmentStart != std::string::npos) {
		const size_t nameStart = segmentStart + 1;
		const size_t nextDot = expression.find('.', nameStart);
		const std::string_view part = nextDot == std::string::npos
			? std::string_view(expression).substr(nameStart)
			: std::string_view(expression).substr(nameStart, nextDot - nameStart);
		if (valueIsTable(current)) {
			current = asTable(current)->get(canonicalizeDebugIdentifier(runtime, part));
		} else if (valueIsNativeObject(current) && asNativeObject(current)->get) {
			current = asNativeObject(current)->get(canonicalizeDebugIdentifier(runtime, part));
		} else {
			return std::nullopt;
		}
		if (isNil(current) && nextDot != std::string::npos) {
			return std::nullopt;
		}
		segmentStart = nextDot;
	}
	return current;
}

std::vector<std::string> collectSourceExpressionDebug(const Runtime& runtime, const SourceRange& range, const std::string& source, const ProgramMetadata* metadata) {
	const std::vector<std::pair<int, int>> callStack = runtime.cpu().getCallStack();
	if (callStack.empty()) {
		return {};
	}
	const int frameIndex = static_cast<int>(callStack.size()) - 1;
	const int protoIndex = callStack.back().first;
	std::vector<std::string> result;
	for (const std::string& expression : extractExpressionCandidates(range, source)) {
		const std::optional<Value> resolved = resolveExpressionValue(runtime, metadata, frameIndex, protoIndex, range, expression);
		if (!resolved.has_value()) {
			continue;
		}
		result.push_back(expression + "=" + formatDebugValue(runtime, *resolved));
	}
	return result;
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
			std::cout << "[Runtime] debug: source=" << sourceLine << std::endl;
			const std::vector<std::string> expressions = collectSourceExpressionDebug(*this, range, sourceAsset->source, m_programMetadata);
			if (!expressions.empty()) {
				std::ostringstream out;
				out << "[Runtime] debug: exprs=";
				for (size_t index = 0; index < expressions.size(); ++index) {
					if (index > 0) {
						out << ' ';
					}
					out << expressions[index];
				}
				std::cout << out.str() << std::endl;
			}
			return;
		}
		std::cout << "[Runtime] debug: source=" << sourceLine << std::endl;
	}
}

} // namespace bmsx
