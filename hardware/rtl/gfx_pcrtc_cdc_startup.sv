`timescale 1ns/1ps
// PCRTC control and display-domain CDC with explicit reset sequencing.
// The 705-bit FIFO's own write-domain reset release produces w_ready. After
// that ready is seen, the PCRTC source is released; its bootstrap snapshot is
// accepted on the next SYS edge before any configuration access is admitted.
// Early SYS requests must remain asserted until access_ready, as required by
// the endpoint handshake. The video epoch's reset is asserted asynchronously
// and released synchronously to its own clock. Both FIFO domains and both
// owners use the same board reset; one-sided reset is not a flush protocol.
//
// This owns startup sequencing only, not lossless CDC for arbitrary traffic:
// PCRTC display updates cannot stall. If the FIFO is full, overflow pulses and
// the update is lost exactly as on the unbackpressured interface. It does not
// invent a replacement update, suppress reset events, qualify FIELD or prove
// video-clock/ASIC timing. fifo_history_lost retains any missed transfer
// until board reset so a physical system integrator can detect the loss; it is
// not yet connected to a software-visible status or fault owner. The sticky
// bit reports the loss, it does not reconstruct or hide the missing snapshots.
// Reset and CDC architecture reference: PULP common_cells reset synchronizer
// and Gray FIFO: https://github.com/pulp-platform/common_cells
module gfx_pcrtc_cdc_startup (
 input wire sysclk, video_clk, reset_n,
 input wire access_valid,access_write,input wire [4:0] access_index,
 input wire [31:0] access_wdata,output wire access_ready,output wire [31:0] access_rdata,
 input wire [4:0] other_events,
 output wire irq_raise,gpu_queue_action,gpu_reset_action,
 output wire [703:0] programmed_words,displayed_words,
 output wire display_update_valid,display_update_reset,
 output wire [703:0] display_update_words,
 output wire fifo_ready, fifo_overflow,output reg fifo_history_lost,
 output wire source_reset_n,video_reset_n,
 output wire video_update_valid,video_update_reset,output wire [703:0] video_update_words,
 output wire [703:0] video_words,
 output wire timing_restart,running,vblank_active,field,
 output wire [14:0] field_half_line,
 output wire [31:0] csr_word,imr_word,
 output wire video_running,video_sample_valid,
 output wire [22:0] video_period,video_phase,
 output wire [14:0] video_half_line,output wire [63:0] video_elapsed_half_lines,
 output wire video_local_field,video_vblank_active,output wire [31:0] video_output_x
);
 reg source_run,source_admit;
 (* async_reg = "true" *) reg [1:0] video_release;
 wire [704:0] fifo_data;
 wire video_valid;
 // Sticky release, not w_ready itself: normal later FIFO-full conditions must
 // not reset the source or cause an undocumented re-bootstrap.
 always @(posedge sysclk or negedge reset_n)
  if(!reset_n) begin source_run<=0;source_admit<=0;fifo_history_lost<=0;end
  else begin
   if(fifo_ready) source_run<=1;
   source_admit<=source_run;
   if(fifo_overflow) fifo_history_lost<=1;
  end
 always @(posedge video_clk or negedge reset_n)
  if(!reset_n) video_release<=0;
  else video_release<={video_release[0],1'b1};
 assign source_reset_n=reset_n && source_run;
 assign video_reset_n=reset_n && video_release[1];
 assign access_ready=reset_n && source_admit;
 assign fifo_overflow=display_update_valid && !fifo_ready;
 assign video_update_valid=video_valid && video_reset_n;
 assign video_update_reset=fifo_data[704];
 assign video_update_words=fifo_data[703:0];
 gfx_pcrtc_control source(.clk(sysclk),.reset_n(source_reset_n),
  .access_valid(access_valid && access_ready),.access_write(access_write),.access_index(access_index),
  .access_wdata(access_wdata),.access_rdata(access_rdata),.other_events(other_events),
  .irq_raise(irq_raise),.gpu_queue_action(gpu_queue_action),.gpu_reset_action(gpu_reset_action),
  .programmed_words(programmed_words),.displayed_words(displayed_words),
  .display_update_valid(display_update_valid),.display_update_reset(display_update_reset),
  .display_update_words(display_update_words),.timing_restart(timing_restart),.running(running),
  .vblank_active(vblank_active),.field(field),.field_half_line(field_half_line),.csr_word(csr_word),.imr_word(imr_word));
 async_fifo #(.WIDTH(705),.ADDR_BITS(2)) fifo(.reset_n(reset_n),.w_clk(sysclk),
  .w_valid(display_update_valid),.w_ready(fifo_ready),.w_data({display_update_reset,display_update_words}),
  .r_clk(video_clk),.r_valid(video_valid),.r_ready(video_reset_n),.r_data(fifo_data));
 gfx_pcrtc_display_epoch sink(.clk(video_clk),.reset_n(video_reset_n),.update_valid(video_update_valid),
  .update_reset(video_update_reset),.update_words(video_update_words),.display_words(video_words),
  .running(video_running),.sample_valid(video_sample_valid),.period_numerator(video_period),.phase(video_phase),
  .field_half_line(video_half_line),.elapsed_half_lines(video_elapsed_half_lines),.local_field(video_local_field),
  .vblank_active(video_vblank_active),.output_x(video_output_x));
endmodule
