#pragma once

#include <cmath>

namespace bmsx {

inline double luaFloorDivide(double left, double right) {
	return std::floor(left / right);
}

inline double luaModulo(double left, double right) {
	return left - luaFloorDivide(left, right) * right;
}

} // namespace bmsx
