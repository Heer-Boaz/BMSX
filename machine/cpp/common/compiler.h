#pragma once

// Compiler facilities shared by the native runtimes. Reaching an existing
// unreachable site remains undefined behavior; these emit no runtime check.
#if defined(_MSC_VER)
#define BMSX_UNREACHABLE() __assume(0)
#define BMSX_NOINLINE __declspec(noinline)
#elif defined(__GNUC__) || defined(__clang__)
#define BMSX_UNREACHABLE() __builtin_unreachable()
#define BMSX_NOINLINE [[gnu::noinline]]
#else
#error Unsupported compiler
#endif
