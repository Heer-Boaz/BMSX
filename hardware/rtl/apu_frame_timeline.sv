`timescale 1ns/1ps
// Fixed 33.8688 MHz / 768 APU frame timeline and ordered frame-work admission.
// Due frames are counted even while the command owner reserves a slot. A frame
// request represents the oldest unprocessed edge and remains asserted until
// accepted; only one frame can be in flight. frame_done completes that request.
// The frame owner must apply a transfer due on an edge before that frame and
// must complete its voice/end-event effects before asserting frame_done.
//
// timeline_ready admits a selected-window access or command execution. A CMD
// capture can proceed while an older command is busy, provided that all frame
// edges due through capture have completed; capture_ready expresses that
// separate boundary. An incoming tick always wins over a new timed operation. Once a
// command is admitted, executor_busy blocks later frame work until its atomic
// action or fault is accepted. This orders these two owners, not physical real-time:
// if bind or frame work is too slow, debt grows and output deadlines can be
// missed. External DMA transfer ordering, actual playback and DAC are not
// implemented by this module. A separate sample-memory owner must retain the
// snapshot for each tick; its overflow input records loss of that ordering. The
// sticky indication is an internal physical diagnostic, not a public fault or
// a recovery policy, and does not claim that later frames remain renderable.
//
// MAME sound devices synchronize their stream before register mutations;
// this physical owner separates that logical ordering from fixed-rate edges:
// https://github.com/mamedev/mame/blob/master/src/devices/sound/nes_apu.cpp
module apu_frame_timeline (
 input wire clk, reset_n,
 input wire executor_busy,
 input wire snapshot_overflow,
 output reg snapshot_history_lost,
 output wire timeline_ready,capture_ready,
 output wire frame_valid, input wire frame_ready,
 input wire frame_done,
 output wire [31:0] sample_sequence,
 output wire [31:0] completed_sequence,
 output wire [63:0] pending_frames,
 output wire frame_tick
);
 reg [9:0] phase;
 reg [63:0] due_frames, completed_frames;
 reg frame_inflight;
 assign frame_tick=reset_n && phase==10'd767;
 assign pending_frames=due_frames-completed_frames;
 assign sample_sequence=due_frames[31:0];
 assign completed_sequence=completed_frames[31:0];
 assign capture_ready=reset_n && !frame_inflight && due_frames==completed_frames && !frame_tick;
 assign timeline_ready=capture_ready && !executor_busy;
 assign frame_valid=reset_n && !executor_busy && !frame_inflight &&
                    due_frames!=completed_frames;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   phase<=0;due_frames<=0;completed_frames<=0;frame_inflight<=0;snapshot_history_lost<=0;
  end else begin
   if(snapshot_overflow) snapshot_history_lost<=1;
   if(frame_tick) begin phase<=0;due_frames<=due_frames+64'd1;end
   else phase<=phase+10'd1;
   if(frame_valid && frame_ready) frame_inflight<=1;
   if(frame_done && (frame_inflight || (frame_valid && frame_ready))) begin
    completed_frames<=completed_frames+64'd1;frame_inflight<=0;
   end
  end
 end
endmodule
