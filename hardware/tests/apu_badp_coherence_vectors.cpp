// Cross-check the same mutable source and request sequence with C++ BADP.
#include "machine/devices/audio/badp_decoder_hot_path.h"
#include <array>
#include <iostream>
using namespace bmsx;
int main() {
 std::array<u8,512> bytes{};writeLE16(bytes.data()+64,8);writeLE16(bytes.data()+66,12);
 writeLE16(bytes.data()+68,100);bytes[70]=20;for(int i=72;i<76;i++)bytes[i]=0x11;
 ApuBadpDecoderState state;ApuBadpSeekTable seek{bytes.data(),0,0};
 resetApuBadpDecoder(bytes.data()+64,8,1,seek,state,0);
 for(int i=0;i<6;i++) {
  if(i==3)writeLE32(bytes.data()+68,0x001403e8);
  if(i==4)writeLE32(bytes.data()+68,0x00140064);
  i16 left,right;readApuBadpFrameAt(bytes.data()+64,8,1,seek,state,i==3 || i==4?0:i==5?1:i,left,right);
  const u32 word=static_cast<u16>(left)|(static_cast<u32>(static_cast<u16>(right))<<16);
  std::cout<<std::hex<<word<<'\n';
 }
}
