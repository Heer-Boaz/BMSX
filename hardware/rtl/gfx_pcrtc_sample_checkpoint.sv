`timescale 1ns/1ps
// 54 MHz sample owner for the proposed 4:1 video clock arrangement. The
// upstream FIFO presents at most one ordered SYS snapshot on each local edge.
// pixel_tick is synchronous to local_clk, asserted on exactly one of every
// four local edges and aligned by the clock tree to the intended pixel phase.
// The retained bank and FIELD come from the same latest accepted snapshot.
// If a snapshot arrives on a pixel_tick edge, that snapshot is selected.
//
// reset_count and timing_change_count preserve the NUMBER of distinct events
// received since the preceding sampling edge. They do not encode ordering or
// timestamps, so they cannot reconstruct intermediate beam epochs. Reset is
// not a replacement pixel; no sample is emitted before an initial snapshot.
// A downstream owner must define how those events map to its beam, and must
// carry the sampled FIELD with the corresponding pixel. This module supplies
// neither the physical PLL alignment nor a DAC/display timing guarantee.
//
// Like LiteX's timed video stream, sample-associated control is kept with its
// data rather than synchronized as independent per-bit controls:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/video.py
module gfx_pcrtc_sample_checkpoint (
 input wire clk,reset_n,pixel_tick,
 input wire snapshot_valid,snapshot_reset,snapshot_field,
 input wire [703:0] snapshot_words,
 output reg sample_valid,sample_field,
 output reg [703:0] sample_words,
 output reg [2:0] sample_reset_count,sample_timing_change_count
);
 reg have_state,last_field;
 reg [703:0] last_words;
 reg [2:0] resets_since_tick,timing_since_tick;
 wire timing_change=snapshot_valid && (!have_state ||
  snapshot_words[12*32+:64]!=last_words[12*32+:64] ||
  snapshot_words[16*32+:192]!=last_words[16*32+:192]);
 wire reset_event=snapshot_valid && snapshot_reset;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   have_state<=0;last_field<=0;last_words<=0;resets_since_tick<=0;timing_since_tick<=0;
   sample_valid<=0;sample_field<=0;sample_words<=0;sample_reset_count<=0;sample_timing_change_count<=0;
  end else begin
   sample_valid<=0;
   if(snapshot_valid) begin have_state<=1;last_field<=snapshot_field;last_words<=snapshot_words;end
   if(pixel_tick) begin
    if(have_state || snapshot_valid) begin
     sample_valid<=1;
     sample_field<=snapshot_valid ? snapshot_field : last_field;
     sample_words<=snapshot_valid ? snapshot_words : last_words;
     sample_reset_count<=resets_since_tick+reset_event;
     sample_timing_change_count<=timing_since_tick+timing_change;
    end
    resets_since_tick<=0;timing_since_tick<=0;
   end else begin
    resets_since_tick<=resets_since_tick+reset_event;
    timing_since_tick<=timing_since_tick+timing_change;
   end
  end
 end
endmodule
