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
// A CPU status poll observes GPU progress without requiring an unobserved completion event.
void stepGpuWork(Harness& h) {
 const i64 pending=h.gpu.captureState().pendingCommandCycles;
 require(pending>0,"GPU has work to observe");
 const i64 observation=h.scheduler.nowCycles()+pending;
 while(h.scheduler.nextDeadline()<=observation)h.step();
 h.scheduler.advanceTo(observation);
 h.gpu.readStatus();
}
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
void testGpuDmaReadinessDeadlines() {
 // A draw completes at 29 while an admitted DMA block runs until 58. With no
 // observer the DMA block catches up the draw when it reaches GP0.
 {
  Harness h;h.dma.setTiming(1,40,1,1,0,0);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
  h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00010001);
  require(h.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"unobserved draw starts lazily");
  for(u32 i=0;i<4;++i)h.memory.writeU32(Source+4*i,0xe1000000);
  h.scheduler.advanceTo(10);h.program(Source,0,4,DMA_ROUTE_TO_GPU);
  const i64 deadline=h.scheduler.nowCycles()+h.dma.captureState().scheduledBlockCycles;
  require(h.dma.cpuBusHeld()&&deadline>29,"GPU DMA burst admitted beyond the draw completion");
  require(h.scheduler.nextDeadline()==deadline,"admitted DMA does not force an unobservable GPU completion event");
  h.step();
  require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"GP0 block completes");
  require(h.gpu.captureState().commandBuffer.executedCommandCount==1,"GP0 transfer catches the earlier draw up");
 }
 // A queued IRQ is separately visible and retains its own deadline.
 {
  Harness h;h.dma.setTiming(1,40,1,1,0,0);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
  h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00010001);h.gpu.writeGp0(0x1f000000);
  for(u32 i=0;i<4;++i)h.memory.writeU32(Source+4*i,0xe1000000);
  h.scheduler.advanceTo(10);h.program(Source,0,4,DMA_ROUTE_TO_GPU);
  require(h.scheduler.nextDeadline()==29,"IRQ retains GPU deadline during an admitted DMA block");
  h.step();require((h.memory.readIoU32(IO_IRQ_FLAGS)&IRQ_GPU)!=0&&h.dma.cpuBusHeld(),"IRQ is published before DMA completes");
  h.step();require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"DMA completes after IRQ");
 }
}
void testGpuDmaWaitAndLateDecoderSource() {
 // First fill the GP0 ingress, leaving the last DMA word blocked; GPU progress
 // must itself wake the channel without a CPU status poll.
 {
  Harness h;h.dma.setTiming(1,40,1,1,0,0);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
  h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00640001);
  constexpr u32 count=GX_GPU_DMA_INGRESS_WORD_CAPACITY+1;
  for(u32 i=0;i<count;++i)h.memory.writeU32(Source+4*i,0xe1000000);
  h.program(Source,0,count,DMA_ROUTE_TO_GPU);h.step();
  require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY&&!h.dma.cpuBusHeld(),"GP0 DMA tail waits for ingress capacity");
  for(u32 i=0;i<300&&h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY;++i)h.step();
  require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE&&h.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==0,"GPU drain wakes DMA tail");
 }
 // IMGDEC source becomes ready only after the destination has drained; the
 // source edge must observe the destination's current state without polling it.
 {
  Harness h;h.dma.setTiming(1,40,1,1,0,0);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
  h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00640001);
  struct Reader { Harness* h;u32 reads; } reader{&h,0};
  h.memory.mapIoRead(IO_IMGDEC_DATA,&reader,[](void* p,u32,MappedBusSignals) {
   auto& r=*static_cast<Reader*>(p);
   if(++r.reads==1)r.h->dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,0);
   return 0xe1000000u;
  });
  h.dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,GX_GPU_DMA_INGRESS_WORD_CAPACITY);
  h.program(Source,0,GX_GPU_DMA_INGRESS_WORD_CAPACITY+1,DMA_ROUTE_IMGDEC_TO_GPU);h.step();
  require(reader.reads==GX_GPU_DMA_INGRESS_WORD_CAPACITY&&!h.dma.cpuBusHeld(),"initial decoder block leaves a source-waiting tail");
  const i64 observation=h.scheduler.nowCycles()+1000;
  require(!h.gpu.captureState().gp0DmaIngressWords.empty(),"GPU ingress remains queued while source is not ready");
  require(h.scheduler.nextDeadline()>observation,"GPU work is lazy while IMGDEC source is not ready");
  h.scheduler.advanceTo(observation);
  h.dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,1);
  require(h.dma.cpuBusHeld(),"late decoder DREQ admits tail using current GPU capacity");
  h.step();require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE&&reader.reads==GX_GPU_DMA_INGRESS_WORD_CAPACITY+1,"decoder tail is transferred once");
 }
}
void testGpuSourceReadyDuringOtherDmaBlock() {
 Harness h;h.dma.setTiming(1,40,1,1,0,0);
 h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
 h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00640001);
 struct Reader { Harness* h;u32 reads; } reader{&h,0};
 h.memory.mapIoRead(IO_IMGDEC_DATA,&reader,[](void* p,u32,MappedBusSignals) {
  auto& r=*static_cast<Reader*>(p);
  if(++r.reads==1)r.h->dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,0);
  return 0xe1000000u;
 });
 h.dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,GX_GPU_DMA_INGRESS_WORD_CAPACITY);
 h.program(Source,0,GX_GPU_DMA_INGRESS_WORD_CAPACITY+1,DMA_ROUTE_IMGDEC_TO_GPU);h.step();
 require(reader.reads==GX_GPU_DMA_INGRESS_WORD_CAPACITY&&!h.dma.cpuBusHeld(),"decoder tail waits for source");
 require(!h.gpu.captureState().gp0DmaIngressWords.empty(),"GPU ingress is still queued");
 h.program(Source,Target,256,DMA_ROUTE_COPY,1);
 require(h.dma.cpuBusHeld(),"channel 1 owns the engine");
 const i64 completion=h.scheduler.nowCycles()+h.dma.captureState().scheduledBlockCycles;
 const i64 edge=h.scheduler.nowCycles()+500;
 require(edge<completion,"source edge occurs during the other channel's block");
 require(h.scheduler.nextDeadline()==completion,"no GPU event while other admitted DMA block owns the engine");
 h.scheduler.advanceTo(edge);
 h.dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,1);
 require(h.scheduler.nextDeadline()==completion,"source edge does not force GPU work before DMA release");
 require(h.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==1&&h.memory.readIoU32(IO_DMA1_STATUS)==DMA_STATUS_BUSY,"GPU route stays queued during the other block");
 for(u32 i=0;i<300&&h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY;++i)h.step();
 require(h.memory.readIoU32(IO_DMA1_STATUS)==DMA_STATUS_DONE&&h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"GPU tail resumes when the other block releases the engine");
 require(reader.reads==GX_GPU_DMA_INGRESS_WORD_CAPACITY+1,"decoder tail is transferred once");
}
void testStopGpuDemandAndRestoreSourceWait() {
 {
  Harness h;h.dma.setTiming(1,40,1,1,0,0);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
  h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00640001);
  constexpr u32 count=GX_GPU_DMA_INGRESS_WORD_CAPACITY+1;
  for(u32 i=0;i<count;++i)h.memory.writeU32(Source+4*i,0xe1000000);
  h.program(Source,0,count,DMA_ROUTE_TO_GPU);h.step();
  require(!h.dma.cpuBusHeld()&&h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY,"DMA tail waits for ingress");
  require(h.scheduler.nextDeadline()!=std::numeric_limits<i64>::max(),"GPU completion can wake the tail");
  h.memory.writeMappedU32LE(IO_DMA0_TRIGGER,DMA_TRIGGER_STOP);
  require(h.memory.readIoU32(IO_DMA0_STATUS)==0&&h.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"STOP cancels ingress wakeup");
 }
 {
  Harness h;h.dma.setTiming(1,40,1,1,0,0);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
  h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00010001);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_OFF);
  h.memory.writeU32(Source,0xe1000000);h.program(Source,0,1,DMA_ROUTE_TO_GPU);
  require(!h.dma.cpuBusHeld()&&h.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"an OFF GP0 route cannot be released by draw completion");
  require(!h.memory.mappedWriteReady(IO_GX_GPU_GP0),"OFF DMA still owns the CPU write port");
  require(h.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"a port-ownership wait adds no draw deadline");
  h.memory.writeMappedU32LE(IO_DMA0_TRIGGER,DMA_TRIGGER_STOP);
  require(h.memory.readIoU32(IO_DMA0_STATUS)==0&&h.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"STOP cancels unnecessary GPU demand");
 }
 {
  Harness h;h.dma.setTiming(1,40,1,1,0,0);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
  h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00640001);
  struct Reader { Harness* h;u32 reads; } reader{&h,0};
  h.memory.mapIoRead(IO_IMGDEC_DATA,&reader,[](void* p,u32,MappedBusSignals) {
   auto& r=*static_cast<Reader*>(p);if(++r.reads==1)r.h->dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,0);
   return 0xe1000000u;
  });
  h.dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,GX_GPU_DMA_INGRESS_WORD_CAPACITY);
  h.program(Source,0,GX_GPU_DMA_INGRESS_WORD_CAPACITY+1,DMA_ROUTE_IMGDEC_TO_GPU);h.step();
  h.program(Source,Target,256,DMA_ROUTE_COPY,1);
  const i64 now=h.scheduler.nowCycles();
  const auto gpuState=h.gpu.captureState();const auto dmaState=h.dma.captureState();
  Harness restored;restored.dma.setTiming(1,40,1,1,0,0);restored.scheduler.advanceTo(now);
  u32 restoredReads=0;
  restored.memory.mapIoRead(IO_IMGDEC_DATA,&restoredReads,[](void* p,u32,MappedBusSignals) {
   ++*static_cast<u32*>(p);return 0xe1000000u;
  });
  restored.dma.restoreState(dmaState,now);restored.gpu.restoreState(gpuState);
  restored.dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,0);restored.dma.postLoad();
  restored.gpu.dependencyStateChanged();
  const i64 completion=now+dmaState.scheduledBlockCycles,edge=now+500;
  require(edge<completion&&restored.scheduler.nextDeadline()==completion,"restored active block owns its original deadline");
  restored.scheduler.advanceTo(edge);restored.dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,1);
  require(restored.scheduler.nextDeadline()==completion,"restored source edge leaves DMA completion first");
  require(restored.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==1,"restored GPU tail stays queued during other block");
  for(u32 i=0;i<300&&restored.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY;++i)restored.step();
  require(restored.memory.readIoU32(IO_DMA1_STATUS)==DMA_STATUS_DONE&&restored.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"restored source-waiting route completes");
  require(restoredReads==1,"restored decoder tail transfers exactly once");
 }
}
void testGpuDmaDirectionObservability() {
 {
  Harness h;h.dma.setTiming(1,40,1,1,0,0);
  h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00010001);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
  h.program(Source,0,1,DMA_ROUTE_TO_GPU);
  require(h.dma.ownsWritePort(IO_GX_GPU_GP0),"wrong-direction GP0 job retains its write port");
  require(h.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"GPUREAD mode cannot release a GP0 write request");
 }
 for(u32 direction:{GX_GPU_DMA_DIRECTION_OFF,GX_GPU_DMA_DIRECTION_CPU_TO_GP0,GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU}) {
  Harness h;h.dma.setTiming(1,40,1,1,0,0);
  h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00010001);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|direction);
  h.program(0,Target,1,DMA_ROUTE_FROM_GPU);
  require(h.dma.ownsReadPort(IO_GX_GPU_GP0),"GPUREAD job retains its read port");
  require(h.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"ordinary draw completion cannot produce unrequested readback pixels");
 }
}
void testGpuDmaDirectionEdgeWithoutCapacityChange() {
 Harness h;h.dma.setTiming(1,40,1,1,0,0);
 h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
 h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00640001);
 constexpr u32 count=GX_GPU_DMA_INGRESS_WORD_CAPACITY+1;
 for(u32 i=0;i<count;++i)h.memory.writeU32(Source+4*i,0xe1000000);
 h.program(Source,0,count,DMA_ROUTE_TO_GPU);h.step();
 const i64 completion=h.scheduler.nextDeadline();
 require(!h.dma.cpuBusHeld()&&completion!=std::numeric_limits<i64>::max(),"full ingress waits for GPU completion");
 for(u32 direction:{GX_GPU_DMA_DIRECTION_OFF,GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU}) {
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|direction);
  require(h.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"wrong mode removes demand despite unchanged zero capacity");
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
  require(h.scheduler.nextDeadline()==completion,"GP1 mode edge rearms demand without requiring a capacity edge");
 }
 for(u32 i=0;i<300&&h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY;++i)h.step();
 require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"rearmed ingress request completes without a status poll");
}
void testGpuIndependentReadbackAndSupervisorDemand() {
 for(bool readback:{true,false}) {
  Harness h;h.dma.setTiming(1,40,1,1,0,0);
  h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00010001);
  h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_OFF);
  if(readback) {h.gpu.writeGp0(0xc0000000);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00010001);}
  h.program(Source,0,1,DMA_ROUTE_TO_GPU);
  if(!readback) {
   h.dma.beginSupervisorQuiesce();h.gpu.beginSupervisorQuiesce();
   while(h.scheduler.hasDueTimer())require(h.scheduler.popDueTimer()==DEVICE_SERVICE_SYSTEM,"quiescent DMA notifies the supervisor before GPU completion");
  }
  require(h.scheduler.nextDeadline()==29,"queued readback or supervisor quiesce observes completion independently of DMA mode");
 }
}
void testRestoredOffGpuDemand() {
 Harness h;h.dma.setTiming(1,40,1,1,0,0);
 h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00640001);
 h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_OFF);
 h.memory.writeU32(Source,0xe1000000);h.program(Source,0,1,DMA_ROUTE_TO_GPU);
 const auto gpuState=h.gpu.captureState();const auto dmaState=h.dma.captureState();
 Harness restored;restored.dma.setTiming(1,40,1,1,0,0);
 restored.memory.writeU32(Source,0xe1000000);
 restored.dma.restoreState(dmaState,0);restored.gpu.restoreState(gpuState);
 restored.dma.postLoad();restored.gpu.dependencyStateChanged();
 require(restored.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"restored OFF demand remains unobservable");
 require(!restored.memory.mappedWriteReady(IO_GX_GPU_GP0),"restored DMA port ownership blocks the CPU");
 require(restored.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"restored port ownership adds no draw deadline");
 restored.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
 require(restored.dma.cpuBusHeld(),"restored request resumes on a real mode edge");
 restored.step();
 require(restored.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"restored request completes once enabled");
}
void testGpuWriteDemandAppearsBesideReadDemand() {
 for(bool grouped:{false,true}) {
 Harness h;h.dma.setTiming(1,40,1,1,0,0);
 h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
 h.gpu.writeGp0(0x020000ff);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00640001);
 struct Reader { Harness* h;u32 reads; } reader{&h,0};
 h.memory.mapIoRead(IO_IMGDEC_DATA,&reader,[](void* context,u32,MappedBusSignals) {
  auto& r=*static_cast<Reader*>(context);
  if(++r.reads==1)r.h->dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,0);
  return 0xe1000000u;
 });
 h.dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,GX_GPU_DMA_INGRESS_WORD_CAPACITY);
 h.program(Source,0,GX_GPU_DMA_INGRESS_WORD_CAPACITY+1,DMA_ROUTE_IMGDEC_TO_GPU);h.step();
 h.program(0,Target,1,DMA_ROUTE_FROM_GPU,1);
 require(!h.dma.cpuBusHeld()&&h.scheduler.nextDeadline()==std::numeric_limits<i64>::max(),"readback-free read demand cannot observe ordinary draws");
 require(!h.gpu.captureState().gp0DmaIngressWords.empty(),"the read request has not already freed ingress");
 require(h.dma.gpuCommandServiceDemand()==(1u<<static_cast<u32>(DmaEndpoint::GpuRead)),"only the independent read endpoint has demand before the source edge");
 h.scheduler.advanceTo(h.scheduler.nowCycles()+10000);
 if(grouped)h.dma.setEndpointRequests(DmaEndpoint::ImgDecRead,1,DmaEndpoint::ImgDecWrite,0);
 else h.dma.setEndpointCapacity(DmaEndpoint::ImgDecRead,1);
 require(h.dma.cpuBusHeld(),"new write demand catches GPU up before arbitration even with existing read demand");
 h.step();
 require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE&&reader.reads==GX_GPU_DMA_INGRESS_WORD_CAPACITY+1,
  "the new write request transfers its tail exactly once");
 require(h.memory.readIoU32(IO_DMA1_STATUS)==DMA_STATUS_BUSY,"the independent read request still waits for real readback pixels");
 }
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
void testGpuDmaTailResumesAfterSaturatedCommandBufferRetirement() {
 Harness h; constexpr u32 packets=100, words=packets*3;
 for(u32 i=0;i<GX_GPU_COMMAND_CAPACITY;++i) {
  h.gpu.writeGp0(GX_GPU_GP0_FILL_RECTANGLE<<24);h.gpu.writeGp0(0);h.gpu.writeGp0(0x00010001);stepGpuWork(h);
 }
 require(h.gpu.captureState().commandBuffer.executedCommandCount==GX_GPU_COMMAND_CAPACITY,"command buffer is saturated and executed");
 for(u32 i=0;i<packets;++i) {
  h.memory.writeU32(Source+i*12,(GX_GPU_GP0_FILL_RECTANGLE<<24)|i);
  h.memory.writeU32(Source+i*12+4,(i<<16)|i);
  h.memory.writeU32(Source+i*12+8,0x00010001);
 }
 h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
 h.program(Source,0,words,DMA_ROUTE_TO_GPU);
 require(h.dma.captureState().scheduledBlockWords==GX_GPU_DMA_INGRESS_WORD_CAPACITY,"first burst fills the GPU ingress");
 const i64 firstDeadline=h.scheduler.nextDeadline();require(firstDeadline>h.scheduler.nowCycles(),"first DMA burst has a future deadline");
 h.step();auto state=h.gpu.captureState();
 require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY,"DMA remains busy until its tail is transferred");
 require(h.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==words-GX_GPU_DMA_INGRESS_WORD_CAPACITY,"first burst publishes its remaining word count");
 require(h.memory.readIoU32(IO_DMA0_READ_ADDR)==Source+GX_GPU_DMA_INGRESS_WORD_CAPACITY*4,"source advances only by admitted words");
 require((h.memory.readIoU32(IO_IRQ_FLAGS)&IRQ_DMA0_DONE)==0&&!h.dma.cpuBusHeld(),"no completion IRQ or bus hold while ingress is full");
 require(state.gp0FifoWords.size()==GX_GPU_COMMAND_FIFO_WORD_CAPACITY,"GP0 FIFO is full at the drain boundary");
 require(state.gp0DmaIngressWords.size()==GX_GPU_DMA_INGRESS_WORD_CAPACITY-GX_GPU_COMMAND_FIFO_WORD_CAPACITY,"remaining burst words occupy ingress");
 require(state.pendingCommandCycles==0,"saturated command buffer has no command deadline");
 h.gpu.retireExecutedCommands();state=h.gpu.captureState();
 require(state.pendingCommandCycles>0,"retirement schedules the queued GP0 command");
 require(h.scheduler.nextDeadline()>firstDeadline,"resumed GPU work has a future deadline");
 for(u32 i=0;i<500&&h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_BUSY;++i)h.step();
 require(h.memory.readIoU32(IO_DMA0_STATUS)==DMA_STATUS_DONE,"DMA completes after ingress becomes available");
 require(h.memory.readIoU32(IO_DMA0_TRANSFER_COUNT)==0&&h.memory.readIoU32(IO_DMA0_READ_ADDR)==Source+words*4,"DMA publishes its final count and address");
 require((h.memory.readIoU32(IO_IRQ_FLAGS)&IRQ_DMA0_DONE)!=0,"DMA completion raises its IRQ");
 for(u32 i=0;i<500&&h.gpu.readDeviceOutput().commandBuffer.executedCommandCount<packets;++i)stepGpuWork(h);
 const auto& commands=h.gpu.readDeviceOutput().commandBuffer;
 require(commands.executedCommandCount==packets&&commands.wordCount==words,"all queued GP0 packets execute");
 for(u32 i=0;i<words;++i)require(commands.words[i]==h.memory.readMappedU32LE(Source+i*4),"DMA preserves every GP0 word in order");
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
 h.gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION<<24)|GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
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
 testGpuDmaReadinessDeadlines();testGpuDmaWaitAndLateDecoderSource();testGpuSourceReadyDuringOtherDmaBlock();testStopGpuDemandAndRestoreSourceWait();
 testGpuDmaDirectionObservability();testGpuDmaDirectionEdgeWithoutCapacityChange();testGpuIndependentReadbackAndSupervisorDemand();testRestoredOffGpuDemand();
 testGpuWriteDemandAppearsBesideReadDemand();
 testGpuPacketAcrossBursts();testGpuDmaTailResumesAfterSaturatedCommandBufferRetirement();testFixedInputRoutes();testDecoderToGpuIntersectionAndRestore();testStopAndEmptyJob();testRoundRobinAndSupervisorBoundary();
 return 0;
}
