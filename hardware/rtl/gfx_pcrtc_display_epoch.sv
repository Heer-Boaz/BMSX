`timescale 1ns/1ps
// Proposed video-clock epoch owner. Each update is ONE atomic, ordered copy
// of all 22 display-latch words; update_reset identifies a PCRTC reset rather
// than an ordinary VBlank capture. Updates are consumed on every video edge.
// This input is NOT the asynchronous system register bank: a qualified CDC
// must deliver coherent updates, including reset ordering, without loss.
//
// The output beam is separate from the live, write-restarted system beam.
// A changed latched timing word starts a new local phase epoch on its receiving
// video edge. A non-timing-only update preserves phase. This is a proposed
// physical sample alignment, not a claim that Book I specifies its CDC delay
// or FIELD alignment. In particular this module does not prove either of them.
// Book I display row selection uses the CURRENT system CSR.FIELD, not the
// independent output beam field. That signal is not crossed by this module;
// local_field is an internal timing observation, not the display-row FIELD.
// Every register bit is retained; no restricted timing mode is substituted.
module gfx_pcrtc_display_epoch (
 input wire clk,reset_n,
 input wire update_valid,update_reset,
 input wire [703:0] update_words,
 output reg [703:0] display_words,
 output wire running,sample_valid,
 output wire [22:0] period_numerator,phase,
 output wire [14:0] field_half_line,
 output wire [63:0] elapsed_half_lines,
 output wire local_field,vblank_active,
 output wire [31:0] output_x
);
 reg initialized;
 wire timing_changed = update_words[12*32+:64]!=display_words[12*32+:64] ||
  update_words[16*32+:192]!=display_words[16*32+:192];
 wire restart=update_valid && (!initialized || timing_changed);
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin display_words<=0;initialized<=0;end
  else if(update_valid) begin display_words<=update_words;initialized<=1;end
 end
 gfx_pcrtc_beam_phase beam(
  .clk(clk),.reset_n(reset_n),.soft_reset(update_valid && update_reset),.cfg_valid(restart),
  .cfg_smode1(update_words[12*32+:32]),.cfg_smode1_high(update_words[13*32+:32]),
  .cfg_synch1_low(update_words[16*32+:32]),.cfg_synch1_high(update_words[17*32+:32]),
  .cfg_synch2_low(update_words[18*32+:32]),.cfg_syncv_low(update_words[20*32+:32]),
  .cfg_syncv_high(update_words[21*32+:32]),
  .running(running),.period_numerator(period_numerator),.phase(phase),.increment(),
  .total_half_lines(),.field_half_line(field_half_line),.active_half_lines(),.vsync_half_line(),
  .elapsed_half_lines(elapsed_half_lines),.elapsed_fields(),.crossed_half_lines(),.crossed_fields(),
  .crossed_vblank_entries(),.crossed_vsyncs(),.vblank_before_write(),.vblank_after_restart(),
  .hsync_before_write(),.vsync_before_write(),.vsync_after_restart(),.field_before_write(),
  .vblank_active(vblank_active),.field(local_field));
 gfx_pcrtc_sample_x sample(.running(running),.smode1(display_words[12*32+:32]),
  .period_numerator(period_numerator),.phase(phase),.elapsed_half_lines(elapsed_half_lines),
  .sample_valid(sample_valid),.output_x(output_x));
endmodule
