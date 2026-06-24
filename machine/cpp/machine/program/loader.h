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
using EncodedValue = std::variant<std::nullptr_t, bool, double, std::string>;

struct ProgramTextSection {
	std::vector<uint8_t> code;
	std::vector<Proto> protos;
};

struct ProgramRodataSection {
	std::vector<EncodedValue> constPool;
	std::vector<std::pair<std::string, int>> moduleProtos;
	std::vector<std::string> staticModulePaths;
	std::vector<uint8_t> bytes;
	struct Symbol {
		std::string name;
		size_t offset = 0;
		size_t byteCount = 0;
		size_t alignment = 1;
	};
	std::vector<Symbol> symbols;
};

struct ProgramDataSection {
	std::vector<uint8_t> bytes;
	struct Symbol {
		std::string name;
		size_t offset = 0;
		size_t byteCount = 0;
		size_t alignment = 1;
	};
	std::vector<Symbol> symbols;
};

struct ProgramBssSection {
	size_t byteCount = 0;
	struct Symbol {
		std::string name;
		size_t offset = 0;
		size_t byteCount = 0;
		size_t alignment = 1;
	};
	std::vector<Symbol> symbols;
};

struct ProgramObjectSections {
	ProgramTextSection text;
	ProgramRodataSection rodata;
	ProgramDataSection data;
	ProgramBssSection bss;
};

enum class ProgramIndexedConstRelocKind {
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
};

enum class ProgramSymbolicConstRelocKind {
	// Symbolic module/export relocations carry the export-slot name in the reloc
	// record. The linker resolves them into GETSYS/GETGL or CLOSURE operands.
	Module,
	ExportProto,
};

struct ProgramIndexedConstReloc {
	ProgramIndexedConstRelocKind kind = ProgramIndexedConstRelocKind::Bx;
	int constIndex = 0;
};

struct ProgramSymbolicConstReloc {
	ProgramSymbolicConstRelocKind kind = ProgramSymbolicConstRelocKind::Module;
	std::string symbol;
};

struct ProgramConstReloc {
	int wordIndex = 0;
	std::variant<ProgramIndexedConstReloc, ProgramSymbolicConstReloc> target;
};

enum class ProgramConstValueRelocKind {
	BssAddr,
	DataAddr,
	DataLmaAddr,
	RodataAddr,
};

struct ProgramConstValueReloc {
	int constIndex = 0;
	ProgramConstValueRelocKind kind = ProgramConstValueRelocKind::BssAddr;
	std::string symbol;
	int addend = 0;
};

struct ProgramLink {
	std::vector<ProgramConstReloc> constRelocs;
	std::vector<ProgramConstValueReloc> constValueRelocs;
};

struct ProgramVectorTable {
	int resetProtoIndex = 0;
	int sectionInitProtoIndex = 0;
	int irqProtoIndex = 0;
};

struct ProgramImage {
	ProgramVectorTable vectors;
	ProgramObjectSections sections;
	ProgramLink link;
};

using ProgramSymbolsImage = ProgramMetadata;

std::unique_ptr<ProgramImage> decodeProgramImage(const uint8_t* data, size_t size);
std::vector<uint8_t> encodeProgramImage(const ProgramImage& asset);
std::unique_ptr<ProgramSymbolsImage> decodeProgramSymbolsImage(const uint8_t* data, size_t size);
std::unique_ptr<Program> inflateProgram(const ProgramObjectSections& sections);
std::unordered_map<std::string, int> buildModuleProtoMap(const std::vector<std::pair<std::string, int>>& entries);
std::string stripLuaExtension(std::string_view candidate);
std::string toLuaModulePath(std::string_view sourcePath);

} // namespace bmsx
