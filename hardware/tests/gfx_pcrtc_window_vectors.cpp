// Cross-check TS-generated cases with the actual C++ timing/scanout owners.
#include "machine/devices/gx/gpu_pcrtc.h"
#include <array>
#include <iostream>
using namespace bmsx;
int main(){unsigned count;std::cin>>count;for(unsigned n=0;n<count;n++){
 u32 pm,sm1,sm2,field,running,sx,sy,d1l,d1h,f1h,d2l,d2h,f2h,expected_mask,expected_x1,expected_y1,expected_x2,expected_y2;
 std::cin>>std::hex>>pm>>sm1>>sm2>>field>>running>>sx>>sy>>d1l>>d1h>>f1h>>d2l>>d2h>>f2h>>expected_mask>>expected_x1>>expected_y1>>expected_x2>>expected_y2;
 auto words=GX_GPU_PCRTC_RESET_CONFIG_WORDS;words[0]=pm;words[12]=sm1;words[14]=sm2;
 words[4]=d1l;words[5]=d1h;words[3]=f1h;words[8]=d2l;words[9]=d2h;words[7]=f2h;
 GxGpuPcrtcTiming timing;timing.update(words);if(timing.running!=static_cast<bool>(running))return 1;GxGpuPcrtcScanout scan;scan.setField(field);scan.update(words,timing);
 u32 mask=0,out[4]={};if(scan.outputActive){
  u32 s=timing.signalStepX,crop=(scan.cropSignalX+s-1)/s;
  i64 x=static_cast<i64>(sx)-crop,y=static_cast<i64>(sy)-scan.cropSignalY;
  for(u32 lane=0;lane<2;lane++){
   const auto &c=scan.circuits[lane];i64 row=y-c.fieldDisplayY;
   if(!c.enabled||x<c.displayX||x>=c.displayRight||row<0||row%scan.outputRowStep||row/scan.outputRowStep>=c.fieldDisplayLineCount)continue;
   u32 k=x-c.displayX,first=c.sourcePhaseX/c.magnificationX,rem=c.sourcePhaseX%c.magnificationX;
   u32 extra=rem+k*c.sourceRemainderStepX;
   out[lane*2]=c.framebufferX+first+k*c.sourceAdvanceX+extra/c.magnificationX;
   u32 line=row/scan.outputRowStep,numerator=c.fieldSourceNumeratorY+line*c.fieldSourceNumeratorStepY;
   out[lane*2+1]=c.framebufferY+((numerator*c.fieldSourceDivisionMultiplierY)>>18)*c.fieldSourceStride+c.fieldSourcePhase;
   mask|=1u<<lane;
  }
 }
 if(mask!=expected_mask||((mask&1u)&&(out[0]!=expected_x1||out[1]!=expected_y1))||((mask&2u)&&(out[2]!=expected_x2||out[3]!=expected_y2))){std::cerr<<"case "<<std::dec<<n<<" mismatch\n";return 1;}
 }std::cout<<"PASS "<<std::dec<<count<<" logical PCRTC window coordinates against actual TS/C++ scanout owners\n";}
