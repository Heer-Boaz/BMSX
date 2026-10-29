// C++ disassembler and Value owner independently check the TS vectors.
#include "rompack/tooling/disassembler.cpp"
#include "machine/cpu/value.h"
#include <array>
#include <bit>
#include <iostream>
using namespace bmsx;
static int rk(int value,int bits){const int sign=1<<(bits-1);return (value^sign)-sign;}
int main(){unsigned count;std::cin>>count;
 for(unsigned n=0;n<count;n++){
  u32 pc,source,body,wide,op,a,b,rkb,rkc,lb,li,rb,ri,ln,rn;uint64_t lv,rv,expect;
  std::cin>>std::hex>>pc>>source>>body>>wide>>op>>a>>b>>rkb>>rkc>>lb>>li>>rb>>ri>>ln>>lv>>rn>>rv>>expect;
  std::array<u8,8> bytes{};for(int k=0;k<4;k++){bytes[k]=(source>>(24-8*k))&255u;bytes[k+4]=(body>>(24-8*k))&255u;}
  Blua32ImageLayout image;image.address=0;image.bytes=bytes;image.header.textAddress=0;image.header.textByteCount=8;
  const auto d=decodeInstructionFromStart(image,0);const int db=rk(d.b,d.rkBitsB),dc=rk(d.c,d.rkBitsC);
  if(u32(d.op)!=op||u32(d.a)!=a||u32(d.b)!=b||u32(db)!=rkb||u32(dc)!=rkc||lb!=u32(op==34?0:db<0)||li!=u32(op==34?d.b:db<0?-1-db:db)||rb!=u32(dc<0)||ri!=u32(dc<0?-1-dc:dc)){
   std::cerr<<"decode/address mismatch "<<std::dec<<n<<'\n';return 1;}
  const Value l=ln?valueNumber(std::bit_cast<double>(lv)):valueNil();
  const Value r=rn?valueNumber(std::bit_cast<double>(rv)):valueBool(false);
  const auto x=toU32(decodeNumber(l)),y=toU32(decodeNumber(r));uint32_t z=0;
  switch(op){case 24:z=x&y;break;case 25:z=x|y;break;case 26:z=x^y;break;case 27:z=x<<(y&31);break;case 28:z=uint32_t(int32_t(x)>>(y&31));break;case 34:z=~x;break;}
  if(std::bit_cast<uint64_t>(double(int32_t(z)))!=expect){std::cerr<<"value mismatch "<<std::dec<<n<<'\n';return 1;}
 }
 std::cout<<"PASS "<<std::dec<<count<<" decode/RK/word cases vs actual TS CPU/value and C++ disassembler/value owners\n";
}
