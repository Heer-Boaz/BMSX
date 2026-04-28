#pragma once

#include "machine/program/loader.h"
#include <memory>
#include <string>

namespace bmsx {

struct LinkedProgramImage {
	std::unique_ptr<ProgramImage> program;
	std::unique_ptr<ProgramMetadata> metadata;
};

LinkedProgramImage linkProgramImages(
	const ProgramImage& systemImage,
	const ProgramMetadata* systemSymbols,
	const ProgramImage& cartImage,
	const ProgramMetadata* cartSymbols,
	int systemBasePc = 0,
	int cartBasePc = 0x80000
);

} // namespace bmsx
