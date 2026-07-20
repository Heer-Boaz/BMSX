#pragma once

#include "common/primitives.h"
#include "machine/program/loader.h"
#include <vector>

namespace bmsx::test {

std::vector<u8> makeMinimalBootRom(ProgramBootTarget target);

} // namespace bmsx::test
