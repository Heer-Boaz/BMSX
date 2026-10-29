// Independently replay the TS Number vectors with the actual C++ value producer.
#include "machine/cpu/value.h"
#include <bit>
#include <cstdint>
#include <iostream>
int main() {
 unsigned count,op;std::cin>>count;
 for(unsigned i=0;i<count;i++) {
  uint64_t a,b,want;std::cin>>std::dec>>op>>std::hex>>a>>b>>want;
  const double x=std::bit_cast<double>(a),y=std::bit_cast<double>(b);
  double z=op==0?x+y:op==1?x-y:op==2?x*y:x/y;
  const uint64_t actual=bmsx::valueNumber(z);
  const bool wn=(want&0x7ff0000000000000ULL)==0x7ff0000000000000ULL && (want&0x000fffffffffffffULL)!=0;
  const bool an=(actual&0x7ff0000000000000ULL)==0x7ff0000000000000ULL && (actual&0x000fffffffffffffULL)!=0;
  if(wn!=an || (!wn && actual!=want)) { std::cerr<<"mismatch "<<std::dec<<i<<'\n';return 1; }
 }
 std::cout<<"PASS C++ Number producer: "<<std::dec<<count<<" binary64 arithmetic vectors\n";
}
