// Probe the actual C++ Number and tag owner, not host pointer identity.
// The synthetic tag payload below is not a proposed ASIC object handle ABI.
#include "machine/cpu/value.h"
#include <bit>
#include <cstdint>
#include <iostream>

using namespace bmsx;

int main() {
  const uint64_t numbers[] = {
    0, 0x8000000000000000ull, 1, 0x7fefffffffffffffull,
    0x7ff0000000000000ull, 0xfff0000000000000ull,
    0x7ff0000000000001ull, 0x7ff8000000000001ull,
    0x7fffffffffffffffull, 0xfff8000000000001ull,
  };
  for (unsigned index = 0; index < 10; ++index) {
    const Value value = valueNumber(std::bit_cast<double>(numbers[index]));
    const uint64_t expected = index >= 6 ? VALUE_QNAN_MASK : numbers[index];
    if (value != expected || !valueIsNumber(value)) {
      std::cerr << "Number mismatch " << index << '\n';
      return 1;
    }
  }
  for (unsigned index = 0; index < 8; ++index) {
    const Value value = valueFromTag(static_cast<ValueTag>(index), 0x123456789abull);
    if (!valueIsTagged(value) || valueEncodedTag(value) != index + 1 ||
        valuePayload(value) != 0x123456789abull) {
      std::cerr << "tag mismatch " << index << '\n';
      return 1;
    }
  }
  std::cout << "PASS C++ Value: 10 Number cases and 8 tags with a non-pointer payload\n";
}
