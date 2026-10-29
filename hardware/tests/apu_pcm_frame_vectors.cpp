// Replay TS-produced frame expectations using the actual C++ PCM owner.
#include "machine/devices/audio/pcm_decoder_hot_path.h"
#include <array>
#include <cstdint>
#include <iostream>
using namespace bmsx;
int main() {
 std::array<u8,128> bytes{};
 for(unsigned i=0;i<bytes.size();i++)bytes[i]=(i*73u+91u)&255u;
 unsigned count;std::cin>>count;
 for(unsigned i=0;i<count;i++) {
  u32 address,channels,bits,expected;std::cin>>std::hex>>address>>channels>>bits>>expected;
  const i16 left=readApuPcmSample(bytes.data(),address,bits==16u,0);
  const i16 right=channels==1u ? left:readApuPcmSample(bytes.data(),address,bits==16u,1);
  const u32 actual=static_cast<u16>(left)|(static_cast<u32>(static_cast<u16>(right))<<16);
  if(actual!=expected){std::cerr<<"case "<<std::dec<<i<<" expected "<<std::hex<<expected<<" got "<<actual<<'\n';return 1;}
 }
 std::cout<<"PASS "<<std::dec<<count<<" PCM frames match actual TypeScript and C++ sample decoders\n";
}
