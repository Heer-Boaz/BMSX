/*
 * format.cpp - ROM pack utilities
 */

#include "format.h"
#include <cstdio>

namespace bmsx {

std::string generateAtlasAssetId(i32 atlasId) {
	char buffer[32];
	std::snprintf(buffer, sizeof(buffer), "_atlas_%02d", atlasId);
	return std::string(buffer);
}

} // namespace bmsx
