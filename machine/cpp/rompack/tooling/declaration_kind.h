#pragma once

#include "common/primitives.h"

namespace bmsx {

enum class LexicalDeclarationKind : u32 {
	Local,
	Parameter,
	Receiver,
};

} // namespace bmsx
