/*
 * format.cpp - ROM pack utilities
 */

#include "format.h"
#include <cstdio>

namespace bmsx {

std::string generateAtlasName(i32 textpageIndex) {
	char buffer[32];
	std::snprintf(buffer, sizeof(buffer), "_textpage_%02d", textpageIndex);
	return std::string(buffer);
}

} // namespace bmsx
