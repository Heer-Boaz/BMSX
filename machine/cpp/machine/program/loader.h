#pragma once

#include "machine/cpu/cpu.h"
#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace bmsx {

constexpr const char* PROGRAM_IMAGE_ID = "__program__";
constexpr const char* PROGRAM_SYMBOLS_IMAGE_ID = "__program_symbols__";

using EncodedValue = std::variant<std::nullptr_t, bool, double, std::string>;

struct ProgramPlacement {
	int textBasePc = 0;
	int constBaseIndex = 0;
	int protoBaseIndex = 0;
	uint32_t dataBaseAddress = 0;
	uint32_t bssBaseAddress = 0;
};

struct ProgramStaticLayoutToken {
	uint32_t lo = 0;
	uint32_t hi = 0;
};

struct ProgramTextSection {
	std::span<const uint8_t> code;
	std::vector<Proto> protos;
};

struct ProgramRodataSection {
	std::vector<EncodedValue> constPool;
	std::vector<std::pair<std::string, int>> moduleProtos;
	std::vector<ProgramModuleExport> moduleExports;
	std::vector<std::string> staticModulePaths;
	std::span<const uint8_t> bytes;
};

struct ProgramDataSection {
	std::span<const uint8_t> bytes;
};

struct ProgramBssSection {
	size_t byteCount = 0;
};

struct ProgramSections {
	ProgramTextSection text;
	ProgramRodataSection rodata;
	ProgramDataSection data;
	ProgramBssSection bss;
};

struct ProgramVectorTable {
	int resetProtoIndex = 0;
	int sectionInitProtoIndex = 0;
	int irqProtoIndex = 0;
	int exceptionProtoIndex = 0;
};

enum class ProgramBootTarget {
	System,
	Cart,
};

struct ProgramImage {
	ProgramPlacement placement;
	ProgramStaticLayoutToken staticLayoutToken;
	ProgramVectorTable vectors;
	ProgramSections sections;
	ProgramRuntimeSymbols symbols;
};

struct EncodedProgramImage {
	std::vector<uint8_t> sections;
	std::vector<uint8_t> descriptor;
};

using ProgramSymbolsImage = ProgramMetadata;

std::unique_ptr<ProgramImage> decodeProgramImage(
	std::span<const uint8_t> sectionBytes,
	std::span<const uint8_t> descriptorBytes
);
EncodedProgramImage encodeProgramImage(const ProgramImage& image);
std::unique_ptr<ProgramSymbolsImage> decodeProgramSymbolsImage(std::span<const uint8_t> bytes);
std::unique_ptr<Program> assembleProgramImages(const ProgramImage& systemImage, const ProgramImage* cartImage);
std::string stripLuaExtension(std::string_view candidate);
std::string toLuaModulePath(std::string_view sourcePath);

} // namespace bmsx
