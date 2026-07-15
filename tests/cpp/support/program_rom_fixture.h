#pragma once

#include "common/primitives.h"
#include "machine/program/linker.h"
#include <vector>

namespace bmsx::test {

std::vector<u8> makeMinimalProgramRom(ProgramBootTarget target);

} // namespace bmsx::test
