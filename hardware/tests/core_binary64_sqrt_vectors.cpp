// Independent native double check of the ECMAScript Math.sqrt fixture.
#include <bit>
#include <cmath>
#include <cstdint>
#include <iostream>

int main() {
 unsigned count; std::cin >> count;
 for (unsigned i=0;i<count;++i) {
  std::uint64_t input, expected;
  std::cin >> std::hex >> input >> expected;
  const auto actual=std::bit_cast<std::uint64_t>(std::sqrt(std::bit_cast<double>(input)));
  const bool a_nan=(actual & 0x7fffffffffffffffULL)>0x7ff0000000000000ULL;
  const bool e_nan=(expected & 0x7fffffffffffffffULL)>0x7ff0000000000000ULL;
  if (a_nan!=e_nan || (!a_nan && actual!=expected)) {
   std::cerr << "C++ mismatch input=" << std::hex << input << " expected=" << expected << " got=" << actual << '\n'; return 1;
  }
 }
 if (!std::cin) return 1;
 std::cout << "PASS C++ std::sqrt " << std::dec << count << " vectors\n";
}
