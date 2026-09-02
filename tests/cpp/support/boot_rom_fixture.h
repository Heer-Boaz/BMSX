#pragma once

#include "common/primitives.h"
#include "rompack/format.h"
#include "rompack/manifest.h"
#include <vector>

namespace bmsx::test {

std::vector<u8> makeMinimalBootRom(RomImageDomain domain);
std::vector<u8> makeMinimalBootRom(
	RomImageDomain domain,
	const CartManifest& manifest);
std::vector<u8> makeMinimalDiagnosticBootRom(RomImageDomain domain);
std::vector<u8> makeMinimalDataRom();
std::vector<u8> makeMinimalDataRom(const CartManifest& manifest);

} // namespace bmsx::test
