`timescale 1ns/1ps
// Single system-clock owner for programmed PCRTC words, beam, presentation
// latches and event/mask state. The SYS endpoint supplies an accepted decoded
// word transaction; this is not the GPU drawing/readback/FIFO controller.
// A RESET action resets the PCRTC owner here and requests the separate GPU
// queue action. The latter must preserve already accepted GPU work as Book I
// specifies; a queue-action pulse alone does not implement that policy.
// VBlank events are produced by the beam before the register edge: the count
// belongs before the accepted write and the restart event belongs after it.
// These outputs preserve event ordering and multiplicity for the future INPUT
// owner; exposing them does not implement INPUT publication or IRQ delivery.
// On a simultaneous CSR RESET the old beam count may still be nonzero while
// the display bank installs reset words. The downstream INPUT/IRQ ordering
// for that coincidence is not established by this raw producer interface.
// LiteX separates timing generator/stream state from downstream consumers:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/video.py
module gfx_pcrtc_control (
 input wire clk,reset_n,
 input wire access_valid,access_write,input wire [4:0] access_index,
 input wire [31:0] access_wdata,output wire [31:0] access_rdata,
 input wire [4:0] other_events,
 output wire irq_raise,gpu_queue_action,gpu_reset_action,
 output wire [703:0] programmed_words,displayed_words,
 output wire display_update_valid,display_update_reset,
 output wire [703:0] display_update_words,
 output wire display_context_valid,
 output wire [15:0] display_width,display_height,
 output wire [31:0] display_epoch,
 output wire timing_restart,running,vblank_active,field,
 output wire [7:0] vblank_before_write,
 output wire vblank_after_restart,
 output wire [14:0] field_half_line,
 output wire [31:0] csr_word,imr_word
);
 wire config_word=access_index<22;
 wire [1:0] status_index=access_index[1:0]-2'd2;
 wire [31:0] config_rdata,status_rdata;
 wire hsync_before,vsync_before,vsync_after,field_before;
 wire soft_reset;
 assign access_rdata=config_word ? config_rdata : status_rdata;
 assign gpu_reset_action=soft_reset;
 gfx_pcrtc_system_beam beam(.clk(clk),.reset_n(reset_n),.soft_reset(soft_reset),
  .write_valid(access_valid && access_write && config_word),.write_index(access_index),.write_word(access_wdata),
  .read_index(access_index),.read_word(config_rdata),.programmed_words(programmed_words),.displayed_words(displayed_words),
  .display_update_valid(display_update_valid),.display_update_reset(display_update_reset),.display_update_words(display_update_words),
  .vblank_before_write(vblank_before_write),.vblank_after_restart(vblank_after_restart),.hsync_before_write(hsync_before),.vsync_before_write(vsync_before),
  .vsync_after_restart(vsync_after),.field_before_write(field_before),.timing_restart(timing_restart),
  .running(running),.period_numerator(),.phase(),.increment(),.total_half_lines(),.field_half_line(field_half_line),
  .active_half_lines(),.vsync_half_line(),.elapsed_half_lines(),.elapsed_fields(),.crossed_half_lines(),
  .crossed_fields(),.crossed_vblank_entries(),.crossed_vsyncs(),.vblank_active(vblank_active),.field(field));
 display_context_gfx context_owner(.clk(clk),.reset_n(reset_n),.displayed_words(displayed_words),
  .context_valid(display_context_valid),.display_width(display_width),.display_height(display_height),.display_epoch(display_epoch));
 gfx_pcrtc_status status(.clk(clk),.reset_n(reset_n),
  .write_valid(access_valid && access_write && !config_word),.write_index(status_index),.write_word(access_wdata),
  .read_index(status_index),.read_word(status_rdata),.hsync_before(hsync_before),.vsync_before(vsync_before),
  .vsync_after(vsync_after),.field_current(field),.field_before(field_before),.event_before(other_events),
  .irq_raise(irq_raise),.soft_reset(soft_reset),.queue_action(gpu_queue_action),.csr_word(csr_word),.imr_word(imr_word));
endmodule
