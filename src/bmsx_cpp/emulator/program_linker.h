#pragma once

#include "program_loader.h"
#include <memory>
#include <string>

namespace bmsx {

struct LinkedProgramAsset {
	std::unique_ptr<ProgramAsset> program;
	std::unique_ptr<ProgramMetadata> metadata;
};

struct ProgramLinkCompatibility {
	bool compatible = false;
	std::string message;
};

ProgramLinkCompatibility validateProgramLinkCompatibility(
	const ProgramAsset& engineAsset,
	const ProgramAsset& cartAsset
);

LinkedProgramAsset linkProgramAssets(
	const ProgramAsset& engineAsset,
	const ProgramMetadata* engineSymbols,
	const ProgramAsset& cartAsset,
	const ProgramMetadata* cartSymbols,
	int engineBasePc = 0,
	int cartBasePc = 0x80000
);

} // namespace bmsx
