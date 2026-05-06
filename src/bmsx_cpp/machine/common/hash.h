#pragma once

#include "common/types.h"

namespace bmsx {

u32 fmix32(u32 h);
u32 xorshift32(u32 x);
u32 scramble32(u32 x);
i32 signed8FromHash(u32 h);

} // namespace bmsx
