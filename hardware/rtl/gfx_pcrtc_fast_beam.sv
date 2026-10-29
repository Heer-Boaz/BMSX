`timescale 1ns/1ps
// 54-MHz display-beam candidate consuming the ordered SYS snapshots. Unlike
// sampling a latest-state mailbox, every delivered RESET or changed display
// timing is applied to the beam at its local-clock arrival edge. The beam runs
// on every local edge; period and phase use twice the 13.5-MHz representation.
// The current SYS FIELD travels with the displayed bank, not the local beam's
// independently derived field. A pixel tick schedules the immediately following
// 54-MHz edge to capture the coherent state produced by that tick edge; this
// exactly one-local-clock pipeline includes snapshots arriving on the tick.
//
// The producer must deliver ordered snapshots without overflow. This consumer
// does not reconstruct source timing lost by a stopped clock, does not prove
// a fixed SYS-to-local crossing delay, and does not define vertical pixel Y,
// framebuffer deadlines, DAC/sync alignment, PLL or physical timing. Pixel
// sampling is a physical proposal and does not change Book I.
// LiteX separates timing generation, stream metadata, CDC and video output:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/video.py
module gfx_pcrtc_fast_beam (
 input wire clk,reset_n,pixel_tick,
 input wire snapshot_valid,snapshot_reset,snapshot_field,
 input wire [703:0] snapshot_words,
 output reg sample_valid,sample_field,sample_running,
 output reg [703:0] sample_words,
 output reg [22:0] sample_period,sample_phase,
 output reg [14:0] sample_half_line,
 output reg [63:0] sample_elapsed_half_lines,
 output wire sample_x_valid,output wire [31:0] sample_x
);
 reg initialized,field_latched,pending_tick;
 reg [703:0] display_words;
 wire timing_changed=snapshot_words[12*32+:64]!=display_words[12*32+:64] ||
  snapshot_words[16*32+:192]!=display_words[16*32+:192];
 wire restart=snapshot_valid && (!initialized || timing_changed);
 wire running;wire [22:0] period,phase;wire [14:0] field_half_line;wire [63:0] elapsed_half_lines;
 gfx_pcrtc_beam_phase #(.REFERENCE_CLOCK_X4(1)) beam(
  .clk(clk),.reset_n(reset_n),.soft_reset(snapshot_valid && snapshot_reset),.cfg_valid(restart),
  .cfg_smode1(snapshot_words[12*32+:32]),.cfg_smode1_high(snapshot_words[13*32+:32]),
  .cfg_synch1_low(snapshot_words[16*32+:32]),.cfg_synch1_high(snapshot_words[17*32+:32]),
  .cfg_synch2_low(snapshot_words[18*32+:32]),.cfg_syncv_low(snapshot_words[20*32+:32]),
  .cfg_syncv_high(snapshot_words[21*32+:32]),
  .running(running),.period_numerator(period),.phase(phase),.increment(),
  .total_half_lines(),.field_half_line(field_half_line),.active_half_lines(),.vsync_half_line(),
  .elapsed_half_lines(elapsed_half_lines),.elapsed_fields(),.crossed_half_lines(),.crossed_fields(),
  .crossed_vblank_entries(),.crossed_vsyncs(),.vblank_before_write(),.vblank_after_restart(),
  .hsync_before_write(),.vsync_before_write(),.vsync_after_restart(),.field_before_write(),
  .vblank_active(),.field());
 wire [31:0] smode1=sample_words[12*32+:32];
 wire [4:0] divider={2'd0,smode1[2:0]}*({3'd0,smode1[11:10]}+5'd1);
 wire [10:0] divisor=({6'd0,divider}*{7'd0,smode1[24:21]})<<2;
 wire [23:0] line_phase={1'b0,sample_phase}+
  (sample_elapsed_half_lines[0] ? {1'b0,sample_period} : 24'd0);
 assign sample_x_valid=sample_valid && sample_running && smode1[24:21]!=0;
 assign sample_x={8'd0,line_phase/divisor};
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   initialized<=0;field_latched<=0;display_words<=0;pending_tick<=0;
   sample_valid<=0;sample_field<=0;sample_running<=0;sample_words<=0;
   sample_period<=0;sample_phase<=0;sample_half_line<=0;sample_elapsed_half_lines<=0;
  end else begin
   pending_tick<=pixel_tick;
   if(snapshot_valid) begin initialized<=1;field_latched<=snapshot_field;display_words<=snapshot_words;end
   sample_valid<=pending_tick && initialized;
   if(pending_tick && initialized) begin
    sample_field<=field_latched;sample_words<=display_words;sample_running<=running;
    sample_period<=period;sample_phase<=phase;sample_half_line<=field_half_line;
    sample_elapsed_half_lines<=elapsed_half_lines;
   end
  end
 end
endmodule
