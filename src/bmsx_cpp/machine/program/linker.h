#pragma once

#include "machine/program/layout.h"
#include "machine/program/loader.h"
#include <memory>
#include <string>
#include <vector>

namespace bmsx {

struct LinkedProgramImage {
	std::unique_ptr<ProgramImage> programImage;
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
