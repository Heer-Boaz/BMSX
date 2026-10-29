// Uses the C++ CPU value owner's actual Number-to-word conversion; JS vector
// expectations are the existing language/runtime bitwise results.
#include "machine/cpu/value.h"
#include <bit>
#include <cstdint>
#include <iostream>
using namespace bmsx;
int main(){unsigned count;std::cin>>count;for(unsigned i=0;i<count;i++){
 uint32_t ops,dest;uint64_t lb,rb,expected;std::cin>>std::hex>>ops>>dest>>lb>>rb>>expected;
 const auto l=toU32(std::bit_cast<double>(lb)),r=toU32(std::bit_cast<double>(rb));uint32_t w=0;
 if(ops&1)w|=l&r;if(ops&2)w|=l|r;if(ops&4)w|=l^r;if(ops&8)w|=l<<(r&31);
 if(ops&16)w|=static_cast<uint32_t>(static_cast<int32_t>(l)>>(r&31));if(ops&32)w|=~l;
 const auto actual=std::bit_cast<uint64_t>(static_cast<double>(static_cast<int32_t>(w)));
 if(actual!=expected){std::cerr<<"case "<<std::dec<<i<<" got "<<std::hex<<actual<<" expected "<<expected<<'\n';return 1;}
 }std::cout<<"PASS "<<std::dec<<count<<" binary64 word-ALU cases vs JS and C++ CPU numeric owner\n";}
