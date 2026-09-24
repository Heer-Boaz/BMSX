#pragma once

#include "common/primitives.h"

namespace bmsx {

enum class LexicalDeclarationKind : u32 {
	Local,
	Parameter,
	Receiver,
};

enum class StaticDeclarationKind : u32 {
	Type,
	Bss,
	Data,
	Rodata,
};

} // namespace bmsx
