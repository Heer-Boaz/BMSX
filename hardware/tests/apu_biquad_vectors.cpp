// Replays TS-generated stimuli against the actual C++ filter-state owner.
#include "machine/devices/audio/biquad_filter.h"
#include <array>
#include <iostream>
using namespace bmsx;
int main() {
 std::array<BiquadFilterState,16> states{};
 unsigned count;std::cin>>count;
 for(unsigned i=0;i<count;i++) {
  u32 clear,slot,control,b01,b2a1,a2,samples,expected;
  std::cin>>std::hex>>clear>>slot>>control>>b01>>b2a1>>a2>>samples>>expected;
  auto &s=states[slot];if(clear)s.reset();s.configure(control,b01,b2a1,a2);
  u32 actual=samples;
  if(s.enabled) { s.processStereo(lowSignedHalfword(samples),highSignedHalfword(samples));
   actual=static_cast<u16>(s.outputLeft)|(static_cast<u32>(static_cast<u16>(s.outputRight))<<16); }
  if(actual!=expected) { std::cerr<<"case "<<std::dec<<i<<" got "<<std::hex<<actual<<" expected "<<expected<<'\n';return 1; }
 }
 std::cout<<"PASS "<<std::dec<<count<<" stereo biquad cases match actual TS and C++ owners\n";
}
