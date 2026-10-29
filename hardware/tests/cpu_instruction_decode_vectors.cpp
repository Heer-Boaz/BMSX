// C++ disassembler's real decode owner checks operand widths independently;
// actual TS CPU generated vectors and owns the reserved dispatch flag.
#include "rompack/tooling/disassembler.cpp"
#include <array>
#include <iostream>
using namespace bmsx;
int main(){unsigned count;std::cin>>count;
 for(unsigned i=0;i<count;i++){
  u32 pc,source,body,wide,op,a,b,c,bx,sbx,rkb,rkc,target,disp,reserved,nested;
  std::cin>>std::hex>>pc>>source>>body>>wide>>op>>a>>b>>c>>bx>>sbx>>rkb>>rkc>>target>>disp>>reserved>>nested;
  std::array<u8,8> bytes{};for(int k=0;k<4;k++){bytes[k]=(source>>(24-8*k))&255u;bytes[k+4]=(body>>(24-8*k))&255u;}
  Blua32ImageLayout image;image.address=0;image.bytes=bytes;image.header.textAddress=0;image.header.textByteCount=8;
  const auto d=decodeInstructionFromStart(image,0);
  if(static_cast<u32>(d.op)!=op||static_cast<u32>(d.a)!=a||static_cast<u32>(d.b)!=b||static_cast<u32>(d.c)!=c||static_cast<u32>(d.bx)!=bx||static_cast<u32>(d.sbx)!=sbx||static_cast<u32>(d.disp)!=disp){std::cerr<<"mismatch "<<std::dec<<i<<'\n';return 1;}
 }
 std::cout<<"PASS "<<std::dec<<count<<" instruction decodes vs actual TS CPU and C++ disassembler owners\n";
}
