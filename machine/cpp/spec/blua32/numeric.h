#pragma once

#include <cmath>

namespace bmsx {

inline double luaFloorDivide(double left, double right) {
	const double quotient = left / right;
	const double integer = std::trunc(quotient);
	return integer > quotient ? integer - 1.0 : integer;
}

inline double luaModulo(double left, double right) {
	return left - luaFloorDivide(left, right) * right;
}

} // namespace bmsx
