#pragma once

#include "machine/program/layout.h"
#include "machine/memory/map.h"
#include "machine/program/loader.h"
#include <memory>
#include <string>
#include <vector>

namespace bmsx {

struct LinkedProgramImage {
	std::unique_ptr<ProgramImage> programImage;
	std::unique_ptr<ProgramMetadata> metadata;
	ProgramVectorTable systemVectors;
	ProgramVectorTable cartVectors;
	uint32_t systemDataBaseAddress = 0;
	uint32_t cartDataBaseAddress = 0;
	uint32_t systemBssBaseAddress = 0;
	uint32_t cartBssBaseAddress = 0;
	std::vector<std::string> systemStaticModulePaths;
	std::vector<std::string> cartStaticModulePaths;
};

enum class ProgramBootTarget {
	System,
	Cart,
};

struct LinkedBootProgramImage {
	std::unique_ptr<ProgramImage> programImage;
	std::unique_ptr<ProgramMetadata> metadata;
	ProgramVectorTable vectors;
	uint32_t dataBaseAddress = 0;
	uint32_t bssBaseAddress = 0;
	std::vector<std::string> systemStaticModulePaths;
	ProgramVectorTable cartVectors;
	uint32_t cartDataBaseAddress = 0;
	uint32_t cartBssBaseAddress = 0;
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

LinkedBootProgramImage linkBootProgramImages(
	const ProgramImage& systemImage,
	const ProgramMetadata* systemSymbols,
	const ProgramImage& cartImage,
	const ProgramMetadata* cartSymbols,
	ProgramBootTarget bootTarget,
	int systemBasePc = SYSTEM_BASE_PC,
	int cartBasePc = CART_BASE_PC
);

void resolveRuntimeProgramRelocations(
	Program& program,
	const ProgramRuntimeSymbols& symbols,
	const std::vector<ProgramConstReloc>& relocs
);

void resolveRuntimeProgramValueRelocations(
	Program& program,
	const std::vector<ProgramConstValueReloc>& relocs,
	const std::vector<ProgramDataSection::Symbol>& dataSymbols,
	size_t dataByteCount,
	uint32_t dataBaseAddress,
	const std::vector<ProgramBssSection::Symbol>& bssSymbols,
	size_t bssByteCount,
	uint32_t bssBaseAddress,
	const std::vector<ProgramRodataSection::Symbol>& rodataSymbols,
	size_t rodataByteCount
);

std::unique_ptr<Program> inflateExecutableProgramImage(
	const ProgramImage& image,
	uint32_t dataBaseAddress,
	uint32_t bssBaseAddress
);

} // namespace bmsx
