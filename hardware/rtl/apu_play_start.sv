`timescale 1ns/1ps
// PLAY cursor setup for an already-bound command. The command owner keeps its
// request and reservation until ready; this owner starts the real rate divider
// once and holds its result until the cursor and decoder-binding owners can
// commit on the same edge as the slot-bank INSTALL. Decoder bind metadata is
// retained by the external binder; bind_commit_valid is the accepted commit
// strobe, not an independent ready/valid offer. The binder must offer
// bind_commit_ready independently of this strobe; the playback owner must
// likewise offer load_ready independently of load_valid. The physical binder
// has not yet been shown to satisfy this condition. The binder must share
// reset with these owners or cancel/drain old untagged bind results before
// accepting a new one.
// The caller selects already-bound, memory-backed PLAY. Other commands, live
// updates, source validation, generator bypass/execution and fade remain
// separate owners; no arbitrary PLAY dispatch is provided by this block. A
// PLAY crossing a frame edge keeps its reservation.
// MAME's SPU maintains per-voice cursor/rate state outside command staging:
// https://github.com/mamedev/mame/blob/master/src/devices/sound/spu.cpp
module apu_play_start (
 input wire clk,reset_n,
 input wire play_valid,output wire play_ready,input wire [3:0] play_slot,
 input wire [671:0] play_parameters,
 input wire bind_commit_ready,output wire bind_commit_valid,
 output wire load_valid,input wire load_ready,output wire [3:0] load_slot,
 output wire signed [63:0] load_cursor_q16,load_step_q16,
 output wire signed [31:0] load_remainder,load_step_remainder,
 output wire [31:0] load_frames,load_loop_start,load_loop_end,
 output wire load_decoder_reset,load_filter_clear
);
 reg waiting;
 reg [3:0] slot;
 reg [671:0] parameters;
 wire rate_ready,rate_valid;
 wire signed [63:0] step;
 wire signed [31:0] step_remainder;
 wire start=reset_n && play_valid && !waiting && rate_ready;
 wire commit=reset_n && waiting && play_valid && rate_valid && bind_commit_ready && load_ready;
 assign play_ready=commit;
 assign bind_commit_valid=commit;
 assign load_valid=reset_n && waiting && play_valid && rate_valid && bind_commit_ready;
 assign load_slot=slot;
 assign load_cursor_q16=$signed({16'd0,parameters[13*32+:32],16'd0});
 assign load_step_q16=step;
 assign load_remainder=0;
 assign load_step_remainder=step_remainder;
 assign load_frames=parameters[5*32+:32];
 assign load_loop_start=parameters[8*32+:32];
 assign load_loop_end=parameters[9*32+:32];
 assign load_decoder_reset=1;
 assign load_filter_clear=1;
 apu_voice_rate rate(.clk(clk),.reset_n(reset_n),.req_valid(start),.req_ready(rate_ready),
  .req_rate_q16(play_parameters[11*32+:32]),.req_source_hz(play_parameters[2*32+:32]),
  .rsp_valid(rate_valid),.rsp_ready(commit),.rsp_whole_q16(step),.rsp_remainder(step_remainder));
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin waiting<=0;slot<=0;parameters<=0;end
  else if(start) begin waiting<=1;slot<=play_slot;parameters<=play_parameters;end
  else if(commit) waiting<=0;
 end
endmodule
