#pragma once

#include "machine/memory/map.h"
#include "machine/program/loader.h"
#include <memory>
#include <string>
#include <vector>

namespace bmsx {

constexpr int SYSTEM_BASE_PC = 0;
constexpr int CART_BASE_PC = static_cast<int>(CART_PROGRAM_START_OFFSET);
constexpr int CART_PROGRAM_VECTOR_PC = static_cast<int>(CART_PROGRAM_VECTOR_OFFSET);
constexpr uint32_t CART_PROGRAM_VECTOR_VALUE = CART_PROGRAM_START_ADDR;

struct LinkedProgramImage {
	std::unique_ptr<ProgramImage> program;
	std::unique_ptr<ProgramMetadata> metadata;
	int systemEntryProtoIndex = 0;
	int cartEntryProtoIndex = 0;
	std::vector<std::string> systemStaticModulePaths;
	std::vector<std::string> cartStaticModulePaths;
};

LinkedProgramImage linkProgramImages(
	const ProgramImage& systemImage,
	const ProgramMetadata* systemSymbols,
	const ProgramImage& cartImage,
	const ProgramMetadata* cartSymbols,
	int systemBasePc = SYSTEM_BASE_PC,
	int cartBasePc = CART_BASE_PC
);

} // namespace bmsx
