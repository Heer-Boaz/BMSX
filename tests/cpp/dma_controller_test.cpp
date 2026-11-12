#include "machine/devices/dma/controller.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/memory_map.h"
#include "spec/gx/gp0.h"
#include "spec/gx/gp1.h"
#include "spec/gx/pcrtc.h"
#include "support/cartridge_fixture.h"
#include <array>
#include <limits>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
using namespace bmsx;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
struct Harness {
 std::array<u8,8> system{{4,3,2,1,8,7,6,5}}, cart{{0x44,0x33,0x22,0x11,0x88,0x77,0x66,0x55}};
 Memory memory;
 IrqController irq;
 ExecutionAddressSpace execution;
 CPU cpu;
 DeviceScheduler scheduler;
 DmaController dma;
 GxGpu gpu;
 Harness():memory(MemoryInit{{system.data(),system.size()},test::cartridgeSlots(cart)},PSX_MACHINE_SPEC.ramBytes),
  irq(memory),execution(memory),cpu(memory,irq,execution),scheduler(cpu),dma(memory,cpu,irq,scheduler),
  gpu(memory,cpu,irq,scheduler,dma,PSX_MACHINE_SPEC.gxGpuVramBytes) {
  memory.cartridgeController().connect(memory,irq,dma);
  dma.reset();memory.cartridgeController().reset();gpu.reset();irq.reset();
  dma.setTiming(PSX_MACHINE_SPEC.dmaRamCyclesPerWord,PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
   PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,0);
  const u32 mode=gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
  memory.writeMappedU32LE(mode,memory.readMappedU32LE(mode)|GX_GPU_PCRTC_SMODE1_SINT);gpu.onService(0);
 }
 void program(u32 read,u32 write,u32 count,u32 route,u32 channel=0) {
  memory.writeMappedU32LE(IO_DMA_READ_ADDRS[channel],read);memory.writeMappedU32LE(IO_DMA_WRITE_ADDRS[channel],write);
  memory.writeMappedU32LE(IO_DMA_TRANSFER_COUNTS[channel],count);memory.writeMappedU32LE(IO_DMA_CONTROLS[channel],route);
  memory.writeMappedU32LE(IO_DMA_TRIGGERS[channel],DMA_TRIGGER_START);
 }
 void step() {
  const i64 deadline=scheduler.nextDeadline();require(deadline!=std::numeric_limits<i64>::max(),"work needs a completion deadline");
  scheduler.advanceTo(deadline);
  while(scheduler.hasDueTimer()) {
   const auto kind=scheduler.popDueTimer();
   if(kind==DEVICE_SERVICE_DMA)dma.onService(deadline);
   else if(kind==DEVICE_SERVICE_GPU)gpu.onService(deadline);
   else require(kind==DEVICE_SERVICE_SYSTEM,"only a supervisor fence may notify another device");
  }
 }
};
constexpr u32 Source=DYNAMIC_RAM_BASE+0x1000, Target=DYNAMIC_RAM_BASE+0x4000;
void characterizeRamCopy() {
 for(u32 words:{1u,2u,4u,16u,256u}) {
  Harness h;for(u32 i=0;i<words;++i)h.memory.writeU32(Source+4*i,0xcafe0000u+i);
  const i64 start=h.scheduler.nowCycles();
  h.program(Source,Target,words,DMA_ROUTE_COPY);
  const i64 deadline=h.scheduler.nextDeadline();require(h.dma.cpuBusHeld(),"RAM DMA characterization owns the CPU bus");
  h.step();
  for(u32 i=0;i<words;++i)require(h.memory.readMappedU32LE(Target+4*i)==0xcafe0000u+i,"RAM DMA characterization copies every word");
  require(!h.dma.cpuBusHeld()&&h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"RAM DMA characterization completes");
  std::cout << "RAM_CHARACTERIZE candidate=runtime backend=cpp workload=dma_ram_copy words=" << words << " blocks=1 guest_cycles=" << deadline-start << '\n';
 }
}
void testCopyTiming() {
 const u32 addresses[]={Source,SYSTEM_ROM_BASE,CART_ROM_BASE};
 const u32 words[][2]={{0x99aabbcc,0xddeeff00},{0x01020304,0x05060708},{0x11223344,0x55667788}};
 const i64 duration[]={6,5,23};
 for(u32 i=0;i<3;++i) {
  Harness h;h.memory.writeU32(Source,words[i][0]);h.memory.writeU32(Source+4,words[i][1]);
  h.program(addresses[i],Target,2,DMA_ROUTE_COPY);
  require(h.scheduler.nextDeadline()==duration[i],"copy charges both physical bus sides");
  require(h.memory.readMappedU32LE(Target)==0,"data is not visible before the completion edge");
  h.step();require(h.memory.readMappedU32LE(Target)==words[i][0]&&h.memory.readMappedU32LE(Target+4)==words[i][1],"copy transports both words");
 }
}
void testBoundedBurstsAndForwardOverlap() {
 Harness h;for(u32 i=0;i<257;++i)h.memory.writeU32(Source+i*4,i+1);
 h.program(Source,Target,257,DMA_ROUTE_COPY);
 require(h.scheduler.nextDeadline()==514&&h.dma.cpuBusHeld(),"256 RAM words hold the CPU bus for 514 cycles");
 h.scheduler.advanceTo(513);require(h.memory.readMappedU32LE(Target)==0,"no early burst write");
 h.step();require(h.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==1,"the tail remains after the first burst");
 require(h.memory.readIoU32(IO_DMA0_READ_ADDR)==Source+1024&&h.scheduler.nextDeadline()==518,"the tail pays its own bus setups");
 h.step();require(h.memory.readMappedU32LE(Target+1024)==257&&!h.dma.cpuBusHeld(),"the tail completes and releases CPU execution");
 require((h.memory.readIoU32(IO_IRQ_FLAGS)&IRQ_DMA0_DONE)!=0,"completion raises the channel IRQ");
 Harness overlap;overlap.memory.writeU32(Source,0x11223344);overlap.program(Source,Source+4,40,DMA_ROUTE_COPY);overlap.step();
 for(u32 i=0;i<=40;++i)require(overlap.memory.readMappedU32LE(Source+i*4)==0x11223344,"overlap keeps forward read/write word order");
}
void testMemoryExcludesConsoleMmio() {
 for(bool read:{true,false}) {
  Harness h;h.memory.writeU32(Source,1);h.memory.writeU32(Target,0xdeadbeef);
  h.program(read?IO_DMA1_CONTROL:Source,read?Target:IO_DMA1_TRIGGER,1,DMA_ROUTE_COPY);h.step();
  require(h.memory.readIoU32(IO_SYS_BUS_FAULT_CODE)==BUS_FAULT_UNMAPPED,"memory-side DMA has no console MMIO chip select");
  require(h.memory.readIoU32(IO_DMA1_STATUS)==0,"DMA cannot program another channel through a memory address");
  if(read)require(h.memory.readMappedU32LE(Target)==0,"a faulting memory read supplies the bus value");
  require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"bus faults do not roll back an admitted burst");
 }
 Harness h;h.program(CART_RAM_END-4,Target,2,DMA_ROUTE_COPY);
 require(h.dma.captureState().scheduledBlockWords==1,"a burst ends at the memory target boundary");h.step();
 require(h.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==1&&!h.dma.cpuBusHeld(),"cartridge MMIO waits for its own request domain");
}
void testFixedGpuAndRawRegisters() {
 Harness h;h.memory.writeU32(Source,0xe1000000);h.program(Source,0xdeadbeef,1,0x80000001);
 require(h.dma.ownsWritePort(IO_GX_GPU_GP0)&&!h.dma.cpuBusHeld(),"the route reserves GP0 while awaiting its request");
 for(u32 address:{IO_DMA0_READ_ADDR,IO_DMA0_WRITE_ADDR,IO_DMA0_TRANSFER_COUNT,IO_DMA0_CONTROL})
  {
   require(h.memory.mappedWriteReady(address),"BUSY configuration writes do not trap the CPU");
   h.memory.writeMappedU32LE(address,0xffffffff);
  }
 require(h.memory.readIoU32(IO_DMA0_READ_ADDR)==Source&&h.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==1,"BUSY disables the real registerfile before bus-latch storage");
 require(h.memory.mappedWriteReady(IO_DMA1_CONTROL),"the idle channel still accepts configuration");
 h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);h.step();
 require(h.memory.readIoU32(IO_DMA0_WRITE_ADDR)==0xdeadbeef,"unused raw addresses are retained, not repaired into a device address");
 require(h.memory.readIoU32(IO_DMA0_CONTROL)==0x80000001&&h.memory.readIoU32(IO_SYS_BUS_FAULT_CODE)==0,"reserved control bits flow unchanged");
 require(h.memory.mappedWriteReady(IO_DMA0_CONTROL),"completion releases configuration writes");
}
void testGpuPacketAcrossBursts() {
 Harness h;constexpr u32 words=515;
 h.memory.writeU32(Source,GX_GPU_GP0_CPU_TO_VRAM_FIRST<<24);h.memory.writeU32(Source+4,0);h.memory.writeU32(Source+8,(16<<16)|64);
 for(u32 i=3;i<words;++i)h.memory.writeU32(Source+i*4,0x12345678);
 h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);h.program(Source,0,words,DMA_ROUTE_TO_GPU);
 for(u32 i=0;i<30&&h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY;++i)h.step();
 require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"an image payload can straddle 256-word ingress bursts");
 require(h.gpu.readDeviceOutput().commandBuffer.commandKind[0]==GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,"the GPU receives one complete upload packet");
 require(h.memory.readIoU32(IO_DMA0_READ_ADDR)==Source+words*4,"only the memory-side address advances");
}
void testFixedInputRoutes() {
 const u32 routes[]={DMA_ROUTE_FROM_IMGDEC,DMA_ROUTE_FROM_APU,DMA_ROUTE_FROM_GPU};
 const u32 ports[]={IO_IMGDEC_DATA,IO_APU_TRANSFER_DATA,IO_GX_GPU_GP0};
 const DmaEndpoint endpoints[]={DmaEndpoint::ImgDecRead,DmaEndpoint::ApuRead,DmaEndpoint::GpuRead};
 for(u32 i=0;i<3;++i) {
  Harness h;u32 read=0;h.memory.mapIoRead(ports[i],&read,[](void* p,u32,MappedBusSignals){return ++*static_cast<u32*>(p);});
  h.program(0xdeadbeef,Target,3,routes[i]);h.dma.setEndpointCapacity(endpoints[i],2);h.dma.setEndpointCapacity(endpoints[i],0);h.step();
  require(h.memory.readMappedU32LE(Target)==1&&h.memory.readMappedU32LE(Target+4)==2,"the wired input supplies exactly the admitted words");
  require(h.memory.readMappedU32LE(Target+8)==0&&h.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==1,"a finite request leaves the unrequested tail untouched");
  require(h.memory.readIoU32(IO_DMA0_READ_ADDR)==0xdeadbeef,"the unused source register remains raw");
 }
}
void testDecoderToGpuIntersectionAndRestore() {
 Harness h;h.memory.mapIoRead(IO_IMGDEC_DATA,&h,[](void*,u32,MappedBusSignals){return 0xe1000000u;});
 h.memory.mapIoWrite(IO_GX_GPU_GP0,&h,[](void*,u32,u32,MappedBusSignals){});
 h.memory.mapIoWriteReady(IO_GX_GPU_GP0,[](void*,u32,MappedBusSignals){return true;});
 h.program(0xffffffff,0xffffffff,3,DMA_ROUTE_IMGDEC_TO_GPU);
 h.dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,3);require(!h.dma.cpuBusHeld(),"the direct route needs the GPU destination request too");
 h.dma.setEndpointCapacity(DmaEndpoint::GpuWrite,2);require(h.dma.captureState().scheduledBlockWords==2,"the smaller endpoint bounds the burst");
 h.dma.setEndpointRequests(DmaEndpoint::GpuWrite,0,DmaEndpoint::ImgDecRead,0);
 h.scheduler.advanceTo(1);const auto state=h.dma.captureState();require(state.scheduledBlockCycles==3,"capture retains the pending completion interval");
 h.dma.restoreState(state,1);h.dma.postLoad();require(h.scheduler.nextDeadline()==4,"request loss does not change a restored admitted deadline");
 h.step();require(h.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==1&&!h.dma.cpuBusHeld(),"the admitted burst finishes but no new burst polls low requests");
 require(h.memory.readIoU32(IO_DMA0_READ_ADDR)==0xffffffff,"device-only routes never advance raw memory address fields");
}
void testStopAndEmptyJob() {
 Harness h;h.program(Source,0,9,DMA_ROUTE_TO_GPU);h.memory.writeMappedU32LE(IO_DMA0_TRIGGER,DMA_TRIGGER_START|DMA_TRIGGER_STOP);
 require(h.memory.readIoU32(IO_DMA0_STATUS)==0&&h.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==9,"STOP wins and retains the remaining count");
 require(h.memory.mappedWriteReady(IO_DMA0_CONTROL)&&!h.dma.ownsWritePort(IO_GX_GPU_GP0),"STOP releases the job's reservations");
 require((h.memory.readIoU32(IO_IRQ_FLAGS)&IRQ_DMA0_DONE)==0,"cancellation is not a completed job");
 h.program(0,0,0,DMA_ROUTE_TO_GPU);require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE&&!h.dma.cpuBusHeld(),"empty jobs complete without requests");
}
void testAdmittedBurstAndSupervisorWriteInhibition() {
 Harness h; h.memory.writeU32(Source, 0x12345678);
 h.program(Source, Target, 1, DMA_ROUTE_COPY);
 const i64 deadline = h.scheduler.nextDeadline();
 h.memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_STOP | DMA_TRIGGER_START);
 h.memory.writeMappedU32LE(IO_DMA0_READ_ADDR, 0xffffffff);
 h.memory.writeMappedU32LE(IO_DMA0_CONTROL, DMA_ROUTE_TO_APU);
 require(h.scheduler.nextDeadline() == deadline && h.memory.readIoU32(IO_DMA0_READ_ADDR) == Source
  && h.memory.readIoU32(IO_DMA0_CONTROL) == DMA_ROUTE_COPY, "an admitted burst ignores writes at the real register owner");
 require(h.memory.readIoU32(IO_DMA0_TRIGGER) == 0, "trigger commands have no retained bus latch");
 h.step(); require(h.memory.readMappedU32LE(Target) == 0x12345678, "ignored writes cannot change the admitted transfer");
 Harness paused; paused.program(Source, 0, 9, DMA_ROUTE_TO_GPU); paused.dma.beginSupervisorControlQuiesce();
 paused.memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_STOP);
 paused.memory.writeMappedU32LE(IO_DMA1_TRIGGER, DMA_TRIGGER_START);
 require(paused.memory.readIoU32(IO_DMA0_STATUS) == DMA_STATUS_BUSY && paused.memory.readIoU32(IO_DMA1_STATUS) == 0,
  "the supervisor gate ignores STOP and START without altering jobs");
}
void testRoundRobinAndSupervisorBoundary() {
 Harness h;std::vector<u32> order;
 h.memory.mapIoWrite(IO_GX_GPU_GP0,&order,[](void* p,u32,u32,MappedBusSignals){static_cast<std::vector<u32>*>(p)->push_back(0);});
 h.memory.mapIoWriteReady(IO_GX_GPU_GP0,[](void*,u32,MappedBusSignals){return true;});
 h.memory.mapIoWrite(IO_IMGDEC_DATA,&order,[](void* p,u32,u32,MappedBusSignals){static_cast<std::vector<u32>*>(p)->push_back(1);});
 h.program(Source,0,257,DMA_ROUTE_TO_GPU);h.program(Source,0,1,DMA_ROUTE_TO_IMGDEC,1);
 h.dma.setEndpointRequests(DmaEndpoint::GpuWrite,256,DmaEndpoint::ImgDecWrite,256);
 h.step();require(order.size()==256&&h.dma.captureState().activeChannel==1,"the next channel receives the bus after a burst");
 h.step();require(order[256]==1&&h.memory.readIoU32(IO_DMA1_STATUS)==DMA_STATUS_DONE,"the short job completes before the first tail");
 h.step();require(order[257]==0&&h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"the first channel resumes its tail");
 Harness paused;paused.program(Source,0,257,DMA_ROUTE_TO_IMGDEC);paused.dma.beginSupervisorControlQuiesce();
 require(!paused.dma.supervisorQuiescent(),"closing START is not yet the admission fence");
 paused.dma.setEndpointCapacity(DmaEndpoint::ImgDecWrite,256);require(paused.dma.cpuBusHeld(),"existing producers may drain before the full fence");
 paused.dma.beginSupervisorQuiesce();paused.step();require(paused.dma.supervisorQuiescent(),"the admitted burst ends before context exchange");
 require(paused.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==1,"the unadmitted tail remains pending");
 paused.dma.enterSupervisorContext();require(paused.memory.readIoU32(IO_DMA0_STATUS)==0,"the monitor begins with idle DMA");
 paused.dma.setEndpointCapacity(DmaEndpoint::ImgDecWrite,0);paused.dma.leaveSupervisorContext();
 require(paused.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY&&!paused.dma.cpuBusHeld(),"return restores the original pending job");
}
void testPrimitivesAcrossTransportEdge() {
 const std::vector<std::vector<u32>> packets={{0x200000ff,0,1,2},
  {0x2c808080,0,0,1,0,2,0,3,0},{0x480000ff,0,1,0x50005000}};
 for(const auto& packet:packets) {
  Harness h;for(u32 i=0;i<254;++i)h.memory.writeU32(Source+i*4,0);
  for(u32 i=0;i<packet.size();++i)h.memory.writeU32(Source+(254+i)*4,packet[i]);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
  h.program(Source,0,254+static_cast<u32>(packet.size()),DMA_ROUTE_TO_GPU);
  for(u32 i=0;i<40&&h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY;++i)h.step();
  require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"a primitive split by the DMA transport edge must complete");
  require(h.gpu.readDeviceOutput().commandBuffer.commandCount==1,"transport emits one complete primitive, not a discarded packet prefix");
  require(h.memory.readIoU32(IO_SYS_BUS_FAULT_CODE)==0,"a packet edge is not a bus error");
 }
}
} // namespace
int main() {
 characterizeRamCopy();
 testAdmittedBurstAndSupervisorWriteInhibition();testPrimitivesAcrossTransportEdge();testCopyTiming();testBoundedBurstsAndForwardOverlap();testMemoryExcludesConsoleMmio();testFixedGpuAndRawRegisters();
 testGpuPacketAcrossBursts();testFixedInputRoutes();testDecoderToGpuIntersectionAndRestore();testStopAndEmptyJob();testRoundRobinAndSupervisorBoundary();
 return 0;
}
