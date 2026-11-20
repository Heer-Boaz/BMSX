import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as io from '../../machine/ts/spec/bmsx/io';
import * as map from '../../machine/ts/spec/bmsx/memory_map';
import * as gp0 from '../../machine/ts/spec/gx/gp0';
import * as gp1 from '../../machine/ts/spec/gx/gp1';
import * as pcrtc from '../../machine/ts/spec/gx/pcrtc';
import { PSX_MACHINE_SPEC as spec } from '../../machine/ts/spec/bmsx/model';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { DmaEndpoint } from '../../machine/ts/machine/devices/dma/endpoints';
import { GxGpu } from '../../machine/ts/machine/devices/gx/gpu';
import { GX_GPU_COMMAND_CAPACITY, GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DEVICE_SERVICE_DMA, DEVICE_SERVICE_GPU, DEVICE_SERVICE_SYSTEM, DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { cartridgeSlots } from '../helpers/cartridge';

function fixture() {
 const memory = new Memory({systemRom: new Uint8Array([4,3,2,1,8,7,6,5]),
  cartridgeSlots: cartridgeSlots(new Uint8Array([0x44,0x33,0x22,0x11,0x88,0x77,0x66,0x55]))}, spec.ramBytes);
 const irq = new IrqController(memory), execution = new ExecutionAddressSpace(memory);
 const cpu = new CPU(memory, irq, execution), scheduler = new DeviceScheduler(cpu);
 // Public static RAM contains the source (+0x1000) and destination (+0x4000) pages.
 assert.equal(cpu.heapAllocator.setFloor(map.DYNAMIC_RAM_BASE + 0x5000), true);
 const dma = new DmaController(memory, cpu, irq, scheduler), gpu = new GxGpu(memory, cpu, irq, scheduler, dma, spec.gxGpuVramBytes);
 memory.cartridgeController.connect(memory, irq, dma);
 dma.reset(); memory.cartridgeController.reset(); gpu.reset(); irq.reset();
 dma.setTiming(spec.dmaRamCyclesPerWord, spec.dmaRamBurstSetupCycles, spec.dmaSystemRomCyclesPerWord,
  spec.dmaCartRomCyclesPerWord, spec.dmaCartRomBurstSetupCycles, 0);
 const mode = pcrtc.gxGpuPcrtcRegisterAddress(pcrtc.GX_GPU_PCRTC_SMODE1_LOW);
 memory.writeMappedU32LE(mode, memory.readMappedU32LE(mode) | pcrtc.GX_GPU_PCRTC_SMODE1_SINT);
 gpu.onService(0);
 return {memory, irq, cpu, scheduler, dma, gpu};
}
type Fixture = ReturnType<typeof fixture>;
function program(h: Fixture, read: number, write: number, count: number, route: number, channel = 0) {
 const {memory: m} = h;
 m.writeMappedU32LE(io.IO_DMA_READ_ADDRS[channel], read); m.writeMappedU32LE(io.IO_DMA_WRITE_ADDRS[channel], write);
 m.writeMappedU32LE(io.IO_DMA_TRANSFER_COUNTS[channel], count); m.writeMappedU32LE(io.IO_DMA_CONTROLS[channel], route);
 m.writeMappedU32LE(io.IO_DMA_TRIGGERS[channel], io.DMA_TRIGGER_START);
}
function step(h: Fixture) {
 const deadline = h.scheduler.nextDeadline(); assert.notEqual(deadline, Number.MAX_SAFE_INTEGER, 'work must have a scheduled completion');
 h.scheduler.advanceTo(deadline);
 while (h.scheduler.hasDueTimer()) {
  const kind = h.scheduler.popDueTimer();
  if (kind === DEVICE_SERVICE_DMA) h.dma.onService(deadline);
  else if (kind === DEVICE_SERVICE_GPU) h.gpu.onService(deadline);
  else assert.equal(kind, DEVICE_SERVICE_SYSTEM, 'only a completed supervisor fence may notify another device');
 }
}
// A CPU status poll observes GPU progress without requiring an unobserved completion event.
function stepGpuWork(h: Fixture) {
 const pending = h.gpu.captureState().pendingCommandCycles;
 assert.ok(pending > 0, 'GPU has work to observe');
 const observation = h.scheduler.nowCycles + pending;
 while (h.scheduler.nextDeadline() <= observation) step(h);
 h.scheduler.advanceTo(observation);
 h.gpu.readStatus();
}
const source = map.DYNAMIC_RAM_BASE + 0x1000, target = map.DYNAMIC_RAM_BASE + 0x4000;

test('characterize RAM-to-RAM DMA completion in the runtime timing model', () => {
 for (const words of [1, 2, 4, 16, 256]) {
  const h=fixture();
  for(let i=0;i<words;++i) h.memory.writeU32(source+i*4,0xcafe0000+i);
  const start=h.scheduler.nowCycles;
  program(h,source,target,words,io.DMA_ROUTE_COPY);
  const deadline=h.scheduler.nextDeadline();
  assert.equal(h.dma.cpuBusHeld(),true);
  step(h);
  for(let i=0;i<words;++i) assert.equal(h.memory.readMappedU32LE(target+i*4),0xcafe0000+i);
  assert.equal(h.dma.cpuBusHeld(),false);
  assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_DONE);
  // The RTL test measures arbitration and pin activity with different block
  // topology; this is the runtime's scheduled guest deadline, not host time.
  console.log(`RAM_CHARACTERIZE candidate=runtime workload=dma_ram_copy words=${words} blocks=1 guest_cycles=${deadline-start}`);
 }
});

for (const [address, words, duration] of [[source,[0x99aabbcc,0xddeeff00],6],
 [map.SYSTEM_ROM_BASE,[0x01020304,0x05060708],5], [map.CART_ROM_BASE,[0x11223344,0x55667788],23]] as const) {
 test(`copy route charges both bus sides at source ${address.toString(16)}`, () => {
  const h = fixture(); for (let i=0;i<words.length;++i) h.memory.writeU32(source+i*4,words[i]);
  program(h,address,target,2,io.DMA_ROUTE_COPY);
  assert.equal(h.scheduler.nextDeadline(),duration); assert.equal(h.memory.readMappedU32LE(target),0);
  step(h); for (let i=0;i<words.length;++i) assert.equal(h.memory.readMappedU32LE(target+i*4),words[i]);
  assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_DONE);
 });
}
test('fixed 256-word bursts publish count and addresses only at completion', () => {
 const h=fixture(); for(let i=0;i<257;++i) h.memory.writeU32(source+i*4,i+1);
 program(h,source,target,257,io.DMA_ROUTE_COPY);
 assert.equal(h.scheduler.nextDeadline(),514); assert.equal(h.dma.cpuBusHeld(),true);
 h.scheduler.advanceTo(513); assert.equal(h.memory.readMappedU32LE(target),0);
 step(h); assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT),1);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_READ_ADDR),source+1024); assert.equal(h.scheduler.nextDeadline(),518);
 step(h); assert.equal(h.memory.readMappedU32LE(target+1024),257); assert.equal(h.dma.cpuBusHeld(),false);
 assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS)&io.IRQ_DMA0_DONE,io.IRQ_DMA0_DONE);
});
test('copy retains forward word order when source and destination overlap',()=>{
 const h=fixture(); h.memory.writeU32(source,0x11223344);
 program(h,source,source+4,40,io.DMA_ROUTE_COPY); step(h);
 for(let i=0;i<=40;++i) assert.equal(h.memory.readMappedU32LE(source+i*4),0x11223344);
});
for(const side of ['read','write'] as const) test(`memory-side ${side} cannot address console MMIO or program another DMA channel`,()=>{
 const h=fixture(); h.memory.writeU32(source,1); h.memory.writeU32(target,0xdeadbeef);
 program(h,side==='read'?io.IO_DMA1_CONTROL:source,side==='write'?io.IO_DMA1_TRIGGER:target,1,io.DMA_ROUTE_COPY);
 step(h); assert.equal(h.memory.readIoU32(io.IO_SYS_BUS_FAULT_CODE),io.BUS_FAULT_UNMAPPED);
 assert.equal(h.memory.readIoU32(io.IO_DMA1_STATUS),0);
 if(side==='read') assert.equal(h.memory.readMappedU32LE(target),0);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_DONE);
});
test('memory regions end a burst before a different target or request domain',()=>{
 const h=fixture(); program(h,map.CART_RAM_END-4,target,2,io.DMA_ROUTE_COPY);
 assert.equal(h.dma.captureState().scheduledBlockWords,1); step(h);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT),1);
 assert.equal(h.dma.cpuBusHeld(),false,'entering cartridge MMIO waits for that socket request');
});
test('a fixed GPU route ignores the unused raw address and retains reserved control bits',()=>{
 const h=fixture(); h.memory.writeU32(source,0xe1000000);
 program(h,source,0xdeadbeef,1,0x80000001);
 assert.equal(h.dma.ownsWritePort(io.IO_GX_GPU_GP0),true); assert.equal(h.memory.mappedWriteReady(io.IO_DMA0_CONTROL),true);
 assert.equal(h.dma.cpuBusHeld(),false);
 h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION<<24)|gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
 step(h); assert.equal(h.memory.readIoU32(io.IO_DMA0_WRITE_ADDR),0xdeadbeef);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_CONTROL),0x80000001); assert.equal(h.memory.readIoU32(io.IO_SYS_BUS_FAULT_CODE),0);
});
test('GPU upload crosses multiple ingress bursts without a packet-boundary deadlock',()=>{
 const h=fixture(), words=515;
 h.memory.writeU32(source,gp0.GX_GPU_GP0_CPU_TO_VRAM_FIRST<<24); h.memory.writeU32(source+4,0); h.memory.writeU32(source+8,(16<<16)|64);
 for(let i=3;i<words;++i) h.memory.writeU32(source+i*4,0x12345678);
 h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION<<24)|gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
 program(h,source,0,words,io.DMA_ROUTE_TO_GPU);
 for(let i=0;i<30 && h.memory.readIoU32(io.IO_DMA0_STATUS)===io.DMA_STATUS_BUSY;++i) step(h);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_DONE);
 const commands=h.gpu.readDeviceOutput().commandBuffer;
 assert.equal(commands.commandKind[0],GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_READ_ADDR),source+words*4);
});
test('DMA0 resumes its queued GP0 tail after the saturated command buffer is retired',()=>{
 const h=fixture(), packets=100, words=packets*3;
 for(let i=0;i<GX_GPU_COMMAND_CAPACITY;++i) {
  h.gpu.writeGp0(gp0.GX_GPU_GP0_FILL_RECTANGLE<<24); h.gpu.writeGp0(0); h.gpu.writeGp0(0x00010001);
  stepGpuWork(h);
 }
 assert.equal(h.gpu.captureState().commandBuffer.executedCommandCount,GX_GPU_COMMAND_CAPACITY);
 for(let i=0;i<packets;++i) {
  h.memory.writeU32(source+i*12,(gp0.GX_GPU_GP0_FILL_RECTANGLE<<24)|i);
  h.memory.writeU32(source+i*12+4,(i<<16)|i);
  h.memory.writeU32(source+i*12+8,0x00010001);
 }
 h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION<<24)|gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
 program(h,source,0,words,io.DMA_ROUTE_TO_GPU);
 assert.equal(h.dma.captureState().scheduledBlockWords,gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY);
 const firstDeadline=h.scheduler.nextDeadline(); assert.ok(firstDeadline>h.scheduler.nowCycles);
 step(h);
 let gpu=h.gpu.captureState();
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_BUSY);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT),words-gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_READ_ADDR),source+gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY*4);
 assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS)&io.IRQ_DMA0_DONE,0);
 assert.equal(h.dma.cpuBusHeld(),false);
 assert.equal(gpu.gp0FifoWords.length,gp0.GX_GPU_COMMAND_FIFO_WORD_CAPACITY);
 assert.equal(gpu.gp0DmaIngressWords.length,gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY-gp0.GX_GPU_COMMAND_FIFO_WORD_CAPACITY);
 assert.equal(gpu.pendingCommandCycles,0);
 h.gpu.retireExecutedCommands();
 gpu=h.gpu.captureState();
 assert.ok(gpu.pendingCommandCycles>0,'retirement schedules the queued GP0 command');
 assert.ok(h.scheduler.nextDeadline()>firstDeadline,'resumed GPU work has a future service deadline');
 for(let i=0;i<500 && h.memory.readIoU32(io.IO_DMA0_STATUS)===io.DMA_STATUS_BUSY;++i) step(h);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_DONE);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT),0);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_READ_ADDR),source+words*4);
 assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS)&io.IRQ_DMA0_DONE,io.IRQ_DMA0_DONE);
 for(let i=0;i<500 && h.gpu.readDeviceOutput().commandBuffer.executedCommandCount<packets;++i) stepGpuWork(h);
 const commands=h.gpu.readDeviceOutput().commandBuffer;
 assert.equal(commands.executedCommandCount,packets);
 assert.equal(commands.wordCount,words);
 for(let i=0;i<words;++i) assert.equal(commands.words[i],h.memory.readMappedU32LE(source+i*4),`word ${i}`);
});
for(const [route,endpoint,port] of [[io.DMA_ROUTE_TO_IMGDEC,DmaEndpoint.ImgDecWrite,io.IO_IMGDEC_DATA],
 [io.DMA_ROUTE_TO_APU,DmaEndpoint.ApuWrite,io.IO_APU_TRANSFER_DATA]] as const) {
 test(`fixed output route ${route} waits for its endpoint and wakes only at an availability edge`,()=>{
  const h=fixture(); h.memory.mapIoWrite(port,h,()=>h.dma.setEndpointCapacity(endpoint,0)); h.memory.writeU32(source,0x12345678);
  program(h,source,0,3,route); assert.equal(h.dma.cpuBusHeld(),false);
  h.dma.setEndpointCapacity(endpoint,2); assert.equal(h.dma.captureState().scheduledBlockWords,2); step(h);
  assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT),1); assert.equal(h.dma.cpuBusHeld(),false);
 });
}
test('direct decoder-to-GPU route requires both wired endpoints',()=>{
 const h=fixture(); h.memory.mapIoRead(io.IO_IMGDEC_DATA,h,()=>0xe1000000);
 h.memory.mapIoWrite(io.IO_GX_GPU_GP0,h,()=>{}); h.memory.mapIoWriteReady(io.IO_GX_GPU_GP0,()=>true);
 program(h,0xffffffff,0xffffffff,3,io.DMA_ROUTE_IMGDEC_TO_GPU);
 h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead,3); assert.equal(h.dma.cpuBusHeld(),false);
 h.dma.setEndpointCapacity(DmaEndpoint.GpuWrite,2); assert.equal(h.dma.captureState().scheduledBlockWords,2);
 h.dma.setEndpointRequests(DmaEndpoint.GpuWrite,0,DmaEndpoint.ImgDecRead,0);
 step(h); assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT),1);
 assert.equal(h.dma.cpuBusHeld(),false,'request loss does not retract an admitted burst or poll the next');
 assert.equal(h.memory.readIoU32(io.IO_DMA0_READ_ADDR),0xffffffff);
});
for(const [route,endpoint,port] of [[io.DMA_ROUTE_FROM_IMGDEC,DmaEndpoint.ImgDecRead,io.IO_IMGDEC_DATA],
 [io.DMA_ROUTE_FROM_APU,DmaEndpoint.ApuRead,io.IO_APU_TRANSFER_DATA],
 [io.DMA_ROUTE_FROM_GPU,DmaEndpoint.GpuRead,io.IO_GX_GPU_GP0]] as const) {
 test(`fixed input route ${route} drains only available words`,()=>{
  const h=fixture(); let read=0; h.memory.mapIoRead(port,h,()=>++read);
  program(h,0xdeadbeef,target,3,route); h.dma.setEndpointCapacity(endpoint,2);
  h.dma.setEndpointCapacity(endpoint,0); step(h);
  assert.equal(h.memory.readMappedU32LE(target),1); assert.equal(h.memory.readMappedU32LE(target+4),2);
  assert.equal(h.memory.readMappedU32LE(target+8),0); assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT),1);
  assert.equal(h.memory.readIoU32(io.IO_DMA0_READ_ADDR),0xdeadbeef);
 });
}
test('STOP releases a waiting channel without pretending completion or changing its remaining count',()=>{
 const h=fixture(); program(h,source,0,9,io.DMA_ROUTE_TO_GPU);
 for(const address of [io.IO_DMA0_READ_ADDR,io.IO_DMA0_WRITE_ADDR,io.IO_DMA0_TRANSFER_COUNT,io.IO_DMA0_CONTROL]) assert.equal(h.memory.mappedWriteReady(address),true);
 h.memory.writeMappedU32LE(io.IO_DMA0_TRIGGER,io.DMA_TRIGGER_STOP|io.DMA_TRIGGER_START);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),0); assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT),9);
 assert.equal(h.memory.mappedWriteReady(io.IO_DMA0_CONTROL),true); assert.equal(h.dma.ownsWritePort(io.IO_GX_GPU_GP0),false);
 assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS)&io.IRQ_DMA0_DONE,0);
});
test('zero count completes synchronously without requiring a device request',()=>{
 const h=fixture(); program(h,0,0,0,io.DMA_ROUTE_TO_GPU);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_DONE); assert.equal(h.dma.cpuBusHeld(),false);
});
test('BUSY write-disable applies before the bus latch for every configuration word',()=>{
 const h=fixture(); program(h,source,0xdeadbeef,9,io.DMA_ROUTE_TO_GPU);
 const before=h.dma.captureState().channels[0];
 for(const address of [io.IO_DMA0_READ_ADDR,io.IO_DMA0_WRITE_ADDR,io.IO_DMA0_TRANSFER_COUNT,io.IO_DMA0_CONTROL]) {
  assert.equal(h.memory.mappedWriteReady(address),true);
  h.memory.writeMappedU32LE(address,0xffffffff);
 }
 assert.deepEqual(h.dma.captureState().channels[0],before);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_READ_ADDR),source);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_WRITE_ADDR),0xdeadbeef);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT),9);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_CONTROL),io.DMA_ROUTE_TO_GPU);
 h.memory.writeMappedU32LE(io.IO_DMA0_TRIGGER,io.DMA_TRIGGER_STOP);
 h.memory.writeMappedU32LE(io.IO_DMA0_CONTROL,0x80000001);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_CONTROL),0x80000001);
});
test('an admitted burst ignores trigger and configuration writes without a second register bank', () => {
 const h = fixture();
 h.memory.writeU32(source, 0x12345678);
 program(h, source, target, 1, io.DMA_ROUTE_COPY);
 const before = h.dma.captureState();
 h.memory.writeMappedU32LE(io.IO_DMA0_TRIGGER, io.DMA_TRIGGER_STOP | io.DMA_TRIGGER_START);
 h.memory.writeMappedU32LE(io.IO_DMA0_READ_ADDR, 0xffffffff);
 h.memory.writeMappedU32LE(io.IO_DMA0_CONTROL, io.DMA_ROUTE_TO_APU);
 assert.deepEqual(h.dma.captureState(), before);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_TRIGGER), 0);
 step(h);
 assert.equal(h.memory.readMappedU32LE(target), 0x12345678);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
});
test('supervisor trigger inhibition ignores STOP and START without changing pending jobs or latches', () => {
 const h = fixture();
 program(h, source, 0, 9, io.DMA_ROUTE_TO_GPU);
 h.dma.beginSupervisorControlQuiesce();
 h.memory.writeMappedU32LE(io.IO_DMA0_TRIGGER, io.DMA_TRIGGER_STOP);
 h.memory.writeMappedU32LE(io.IO_DMA1_TRIGGER, io.DMA_TRIGGER_START);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_BUSY);
 assert.equal(h.memory.readIoU32(io.IO_DMA1_STATUS), 0);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_TRIGGER), 0);
 assert.equal(h.memory.readIoU32(io.IO_DMA1_TRIGGER), 0);
});
test('restore retains the admitted deadline and raw registers even if requests fall',()=>{
 const h=fixture(); program(h,source,target,2,io.DMA_ROUTE_COPY);
 h.scheduler.advanceTo(2); const state=h.dma.captureState();
 assert.equal(state.scheduledBlockCycles,4); assert.equal(state.channels[0].readAddressWord,source);
 h.dma.restoreState(state,2); h.dma.postLoad(); assert.equal(h.scheduler.nextDeadline(),6); step(h);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_DONE);
});
test('round-robin arbitration uses burst boundaries, not one complete job',()=>{
 const h=fixture(), order:number[]=[];
 h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
 h.memory.mapIoWrite(io.IO_GX_GPU_GP0,h,()=>order.push(0)); h.memory.mapIoWriteReady(io.IO_GX_GPU_GP0,()=>true); h.memory.mapIoWrite(io.IO_IMGDEC_DATA,h,()=>order.push(1));
 program(h,source,0,257,io.DMA_ROUTE_TO_GPU); program(h,source,0,1,io.DMA_ROUTE_TO_IMGDEC,1);
 h.dma.setEndpointRequests(DmaEndpoint.GpuWrite,256,DmaEndpoint.ImgDecWrite,256);
 step(h); assert.equal(order.length,256); assert.equal(h.dma.captureState().activeChannel,1);
 step(h); assert.equal(order[256],1); assert.equal(h.memory.readIoU32(io.IO_DMA1_STATUS),io.DMA_STATUS_DONE);
 step(h); assert.equal(order[257],0); assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_DONE);
});
test('supervisor control closes START before the admitted burst reaches the full fence',()=>{
 const h=fixture(); program(h,source,0,257,io.DMA_ROUTE_TO_IMGDEC);
 h.dma.beginSupervisorControlQuiesce(); assert.equal(h.dma.supervisorQuiescent(),false);
 h.dma.setEndpointCapacity(DmaEndpoint.ImgDecWrite,256); assert.equal(h.dma.cpuBusHeld(),true);
 h.dma.beginSupervisorQuiesce(); step(h); assert.equal(h.dma.supervisorQuiescent(),true);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT),1);
 h.dma.enterSupervisorContext(); assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),0);
 h.dma.setEndpointCapacity(DmaEndpoint.ImgDecWrite,0); h.dma.leaveSupervisorContext();
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_BUSY); assert.equal(h.dma.cpuBusHeld(),false);
});

for (const packet of [
 [0x200000ff,0,1,2],
 [0x2c808080,0,0,1,0,2,0,3,0],
 [0x480000ff,0,1,0x50005000],
]) test(`GP0 packet ${packet[0].toString(16)} continues across the 256-word transport edge without padding`,()=>{
 const h=fixture(); for(let i=0;i<254;++i)h.memory.writeU32(source+i*4,0);
 packet.forEach((word,i)=>h.memory.writeU32(source+(254+i)*4,word));
 h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION<<24)|gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
 program(h,source,0,254+packet.length,io.DMA_ROUTE_TO_GPU);
 for(let i=0;i<40&&h.memory.readIoU32(io.IO_DMA0_STATUS)===io.DMA_STATUS_BUSY;++i)step(h);
 assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS),io.DMA_STATUS_DONE);
 assert.equal(h.gpu.readDeviceOutput().commandBuffer.commandCount,1,'one complete primitive, not a discarded partial packet');
 assert.equal(h.memory.readIoU32(io.IO_SYS_BUS_FAULT_CODE),0);
});
