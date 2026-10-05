#include "spec/blua32/pow.h"
#include "common/float64.h"
#include <cstdint>
#include <fstream>
#include <iostream>

int main(int argc, char** argv) {
	if (argc != 2) return 2;
	std::ifstream input(argv[1]);
	uint32_t xh, xl, yh, yl;
	while (input >> xh >> xl >> yh >> yl) {
		const double x = bmsx::numberWithLowWord(bmsx::numberWithHighWord(0, xh), xl);
		const double y = bmsx::numberWithLowWord(bmsx::numberWithHighWord(0, yh), yl);
		const double z = bmsx::luaPow(x, y);
		std::cout << static_cast<uint32_t>(bmsx::numberHighWord(z)) << ' ' << bmsx::numberLowWord(z) << '\n';
	}
}
