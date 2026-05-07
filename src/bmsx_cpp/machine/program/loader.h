#pragma once

#include "machine/cpu/cpu.h"
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <variant>
#include <vector>

namespace bmsx {

constexpr const char* PROGRAM_IMAGE_ID = "__program__";
constexpr const char* PROGRAM_SYMBOLS_IMAGE_ID = "__program_symbols__";
constexpr uint32_t PROGRAM_BOOT_HEADER_VERSION = 1;

using EncodedValue = std::variant<std::nullptr_t, bool, double, std::string>;

struct ProgramTextSection {
	std::vector<uint8_t> code;
	std::vector<Proto> protos;
};

struct ProgramRodataSection {
	std::vector<EncodedValue> constPool;
	std::vector<std::pair<std::string, int>> moduleProtos;
	std::vector<std::string> staticModulePaths;
};

struct ProgramDataSection {
	std::vector<uint8_t> bytes;
};

struct ProgramBssSection {
	size_t byteCount = 0;
};

struct ProgramObjectSections {
	ProgramTextSection text;
	ProgramRodataSection rodata;
	ProgramDataSection data;
	ProgramBssSection bss;
};

enum class ProgramConstRelocKind {
	Bx,
	RkB,
	RkC,
	// Specialized table ops store a direct const index in operand B/C instead of an RK encoding.
	// The C++ loader/linker must recognize these kinds so release/libretro can load ROMs emitted
	// by the current TS compiler without rejecting them or patching the wrong operand shape.
	ConstB,
	ConstC,
	Gl,
	Sys,
	// Reloc kind for module export placeholders emitted by the TypeScript
	// compiler when an external module export cannot be resolved at compile time.
	// The linker must resolve these into GETSYS/GETGL accesses.
	Module,
};

struct ProgramConstReloc {
	int wordIndex = 0;
	ProgramConstRelocKind kind = ProgramConstRelocKind::Bx;
	int constIndex = 0;
};

struct ProgramLink {
	std::vector<ProgramConstReloc> constRelocs;
};

struct ProgramImage {
	int entryProtoIndex = 0;
	ProgramObjectSections sections;
	ProgramLink link;
};

using ProgramSymbolsImage = ProgramMetadata;

struct ProgramBootHeader {
	uint32_t version = 0;
	uint32_t flags = 0;
	int entryProtoIndex = 0;
	size_t codeByteCount = 0;
	size_t constPoolCount = 0;
	size_t protoCount = 0;
	size_t constRelocCount = 0;
};

std::unique_ptr<ProgramImage> decodeProgramImage(const uint8_t* data, size_t size);
std::unique_ptr<ProgramSymbolsImage> decodeProgramSymbolsImage(const uint8_t* data, size_t size);
ProgramBootHeader buildProgramBootHeader(const ProgramImage& asset);
std::unique_ptr<Program> inflateProgram(const ProgramObjectSections& sections);
std::unordered_map<std::string, int> buildModuleProtoMap(const std::vector<std::pair<std::string, int>>& entries);
std::string stripLuaExtension(std::string_view candidate);
std::string toLuaModulePath(std::string_view sourcePath);

} // namespace bmsx
