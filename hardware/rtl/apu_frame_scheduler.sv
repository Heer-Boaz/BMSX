`timescale 1ns/1ps
// Couples the ordered audio timeline to a sixteen-slot playback/mix worker.
// Each accepted frame opens its decoder epoch before any work or snapshot
// retirement. All slots are presented in ascending order, including inactive
// slots, as required by the mixer. The slot active mask is retained at frame
// admission, and slot_valid/index/active remain stable under backpressure.
// active_mask is the render mask (a paused voice is active but silent), not
// the public register's active mask. Snapshot retirement and timeline completion occur only when the worker's
// completed output frame is actually accepted by its output consumer.
//
// This owner does not resolve lost snapshots, create a real-time guarantee,
// generate slot cursor/loop/fade state, or implement the complete APU. A
// blocked output stalls frame retirement rather than inventing output samples.
// MAME's SPU walks the voices for each output sample; this is physical control,
// not a claim about the emulator's host execution timing:
// https://github.com/mamedev/mame/blob/master/src/devices/sound/spu.cpp
module apu_frame_scheduler (
 input wire clk,reset_n,
 input wire frame_valid,output wire frame_ready,output wire frame_done,
 input wire [15:0] active_mask,
 output wire decoder_epoch_begin,
 output wire worker_start_valid,input wire worker_start_ready,
 output wire worker_slot_valid,input wire worker_slot_ready,
 output wire [3:0] worker_slot_index,output wire worker_slot_active,
 input wire worker_frame_valid,output wire worker_frame_ready,
 input wire output_ready
);
 localparam [1:0] IDLE=0,ISSUE=1,WAIT_OUTPUT=2;
 reg [1:0] state;
 reg [15:0] active;
 reg [3:0] index;
 assign worker_start_valid=reset_n && state==IDLE && frame_valid;
 assign frame_ready=reset_n && state==IDLE && worker_start_ready;
 assign decoder_epoch_begin=worker_start_valid && worker_start_ready;
 assign worker_slot_valid=state==ISSUE;
 assign worker_slot_index=index;
 assign worker_slot_active=active[index];
 assign worker_frame_ready=state==WAIT_OUTPUT && output_ready;
 assign frame_done=worker_frame_valid && worker_frame_ready;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin state<=IDLE;active<=0;index<=0;end
  else case(state)
   IDLE: if(decoder_epoch_begin) begin active<=active_mask;index<=0;state<=ISSUE;end
   ISSUE: if(worker_slot_ready) begin
    if(index==15) state<=WAIT_OUTPUT;
    else index<=index+1'b1;
   end
   WAIT_OUTPUT: if(frame_done) state<=IDLE;
  endcase
 end
endmodule
