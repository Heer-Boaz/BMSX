`timescale 1ns/1ps
// Adversarial ready/valid start: request is already pending during reset, and
// VIDEO is initially stopped. Bootstrap must enter the FIFO first, before the
// accepted write can change the source. Asynchronous reset during VIDEO stop
// must reset both domains; restarted VIDEO must receive the new bootstrap.
module gfx_pcrtc_cdc_early_tb;
 reg sysclk=0,video_clk=0,reset_n=1,video_run=0;
 always #5 sysclk=~sysclk;
 always #13 if(video_run) video_clk=~video_clk;
 reg valid=1;wire ready,source_reset_n,video_reset_n,fifo_ready,overflow;
 wire [31:0] rdata;wire [703:0] programmed,displayed,update_words,video_words,video_update_words;
 wire update_valid,update_reset,video_update_valid,video_update_reset;
 integer boots=0,accepted=0,received=0;
 gfx_pcrtc_cdc_startup dut(.sysclk(sysclk),.video_clk(video_clk),.reset_n(reset_n),
  .access_valid(valid),.access_write(1'b1),.access_index(5'd0),.access_wdata(32'h12345678),
  .access_ready(ready),.access_rdata(rdata),.other_events(5'd0),.irq_raise(),.gpu_queue_action(),.gpu_reset_action(),
  .programmed_words(programmed),.displayed_words(displayed),.display_update_valid(update_valid),
  .display_update_reset(update_reset),.display_update_words(update_words),.fifo_ready(fifo_ready),.fifo_overflow(overflow),
  .source_reset_n(source_reset_n),.video_reset_n(video_reset_n),.video_update_valid(video_update_valid),
  .video_update_reset(video_update_reset),.video_update_words(video_update_words),.video_words(video_words),
  .timing_restart(),.running(),.vblank_active(),.field(),.field_half_line(),.csr_word(),.imr_word(),
  .video_running(),.video_sample_valid(),.video_period(),.video_phase(),.video_half_line(),.video_elapsed_half_lines(),
  .video_local_field(),.video_vblank_active(),.video_output_x());
 always @(posedge sysclk) if(reset_n) begin
  if(overflow)$fatal(1,"unexpected bootstrap overflow");
  if(update_valid) begin
   if(!fifo_ready || ready || update_words[0+:32]!==0 || update_reset) $fatal(1,"bootstrap not first");
   boots=boots+1;
  end
  if(valid && ready) begin
   if(boots!=1)$fatal(1,"request overtook bootstrap");
   accepted=accepted+1;
  end
 end
 always @(posedge video_clk) if(reset_n && video_update_valid) begin
  if(!video_reset_n || video_update_words[0+:32]!==0 || video_update_reset)$fatal(1,"bad delivered bootstrap");
  received=received+1;
 end
 initial begin
  #1;reset_n=0;
  repeat(2)@(negedge sysclk);reset_n=1;
  while(!ready) begin @(negedge sysclk); if(video_reset_n)$fatal(1,"stopped video escaped reset");end
  @(negedge sysclk);valid=0;
  if(accepted!=1 || boots!=1 || programmed[0+:32]!==32'h12345678)$fatal(1,"early access missed or repeated");
  video_run=1;repeat(12)@(negedge video_clk);
  if(received!=1 || video_words[0+:32]!==0)$fatal(1,"first bootstrap not delivered");
  while(video_clk!==0) @(negedge sysclk);video_run=0;
  #2;reset_n=0;#1;
  if(source_reset_n || video_reset_n || ready)$fatal(1,"reset assertion not asynchronous");
  boots=0;accepted=0;received=0;
  repeat(2)@(negedge sysclk);reset_n=1;repeat(8)@(negedge sysclk);
  if(boots!=1 || video_reset_n)$fatal(1,"second bootstrap while video stopped");
  video_run=1;repeat(12)@(negedge video_clk);
  if(received!=1 || video_words[0+:32]!==0)$fatal(1,"post-reset bootstrap not delivered");
  $display("PASS PCRTC startup: pending pre-reset write waits for bootstrap, stopped-video reset and restart");$finish;
 end
 initial begin #10000;$fatal(1,"watchdog reset=%b ready=%b sysrun=%b videorun=%b videoreset=%b boot=%0d accepted=%0d received=%0d",reset_n,ready,source_reset_n,video_run,video_reset_n,boots,accepted,received);end
endmodule
