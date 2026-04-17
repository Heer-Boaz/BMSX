/*
 * format.cpp - ROM pack utilities
 */

#include "format.h"
#include <cstdio>

namespace bmsx {

std::string generateAtlasName(i32 atlasIndex) {
	char buffer[32];
	std::snprintf(buffer, sizeof(buffer), "_atlas_%02d", atlasIndex);
	return std::string(buffer);
}

} // namespace bmsx
