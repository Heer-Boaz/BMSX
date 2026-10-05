#pragma once
namespace bmsx {
/** Deterministic BLua binary64 exponentiation, also used by constant folding. */
double luaPow(double x, double y);
} // namespace bmsx
