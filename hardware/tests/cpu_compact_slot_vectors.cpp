// Generate compact-store inputs and expected results from the real C++ value
// owner. Tagged payloads are synthetic identities, not host pointers or a
// proposed physical handle allocation contract.
#include "machine/cpu/value.h"
#include <bit>
#include <cstdint>
#include <iomanip>
#include <iostream>

using namespace bmsx;
int main() {
  const uint64_t numbers[] = {
    0, 0x8000000000000000ull, 1, 0x7fefffffffffffffull,
    0x7ff0000000000000ull, 0xfff0000000000000ull,
    0x7ff0000000000001ull, 0x7ff8000000000001ull,
    0x7fffffffffffffffull, 0xfff8000000000001ull,
  };
  std::cout << std::hex << std::setfill('0');
  for (uint64_t bits : numbers) {
    Value v = valueNumber(std::bit_cast<double>(bits));
    std::cout << "1 " << std::setw(16) << bits << ' '
              << std::setw(16) << v << ' ' << valueIsNumber(v) << '\n';
  }
  for (unsigned i = 0; i < 8; ++i) {
    Value v = valueFromTag(static_cast<ValueTag>(i), 0x123456789abcULL);
    std::cout << "0 " << std::setw(16) << v << ' '
              << std::setw(16) << v << ' ' << valueIsNumber(v) << '\n';
  }
}
