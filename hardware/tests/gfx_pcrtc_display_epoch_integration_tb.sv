`timescale 1ns/1ps
// Real system display-latch transaction -> asynchronous snapshot FIFO ->
// output-domain epoch. This is a bounded-rate CDC integration experiment, not
// a DAC deadline or metastability qualification. The source cannot stall its
// VBlank bank. Directly wired transactions are lost if the FIFO is full or
// its write side is in reset; this test only demonstrates that its stated
// traffic and startup assumptions avoid that failure in the tested phases.
module gfx_pcrtc_display_epoch_integration_tb;
 reg sysclk=0,vidclk=0,reset_n=0,source_reset_n=0;
 always #14.763 sysclk=~sysclk;
 integer video_phase=0;
 initial begin
  if($value$plusargs("phase=%d",video_phase)) begin end
  #(video_phase * 1.0);
  forever #37.037 vidclk=~vidclk;
 end
 reg wvalid=0;reg [4:0] windex=0;reg [31:0] wword=0;
 wire [703:0] programmed,displayed,update_words,video_words;
 wire update_valid,update_reset,fifo_ready,out_valid;
 wire [704:0] out_data;
 wire video_running,video_sample,video_field,video_blank;
 wire [22:0] video_period,video_phase_count;
 wire [14:0] video_half_line;
 wire [63:0] video_elapsed;
 wire [31:0] video_x;
 gfx_pcrtc_control source(.clk(sysclk),.reset_n(source_reset_n),
  .access_valid(wvalid),.access_write(1'b1),.access_index(windex),.access_wdata(wword),.access_rdata(),
  .other_events(5'd0),.irq_raise(),.gpu_queue_action(),.gpu_reset_action(),
  .programmed_words(programmed),.displayed_words(displayed),.display_update_valid(update_valid),
  .display_update_reset(update_reset),.display_update_words(update_words),
  .timing_restart(),.running(),.vblank_active(),.field(),.field_half_line(),.csr_word(),.imr_word());
 async_fifo #(.WIDTH(705),.ADDR_BITS(2)) fifo(.reset_n(reset_n),.w_clk(sysclk),
  .w_valid(update_valid),.w_ready(fifo_ready),.w_data({update_reset,update_words}),
  .r_clk(vidclk),.r_valid(out_valid),.r_ready(1'b1),.r_data(out_data));
 gfx_pcrtc_display_epoch sink(.clk(vidclk),.reset_n(reset_n),.update_valid(out_valid),
  .update_reset(out_data[704]),.update_words(out_data[703:0]),.display_words(video_words),
  .running(video_running),.sample_valid(video_sample),.period_numerator(video_period),
  .phase(video_phase_count),.field_half_line(video_half_line),.elapsed_half_lines(video_elapsed),
  .local_field(video_field),.vblank_active(video_blank),.output_x(video_x));
 reg [704:0] expected[0:511];
 integer sent=0,received=0,reset_count=0,unchanged_reset_count=0,both_events=0,i;
 reg [704:0] accepted;
 reg accepted_valid=0;
 reg bank_commit_valid=0;reg [703:0] bank_commit_words;
 reg [21:0] expected_dirty;integer k;
 always @(posedge sysclk) if(reset_n && update_valid) begin
  if(!fifo_ready)$fatal(1,"snapshot FIFO full; system display cannot stall");
  expected[sent]={update_reset,update_words};sent=sent+1;
  bank_commit_valid=1;bank_commit_words=update_words;
  if(source.beam.vblank_before_write!=0 && source.beam.vblank_after_restart)both_events=both_events+1;
  if(update_reset)begin
   reset_count=reset_count+1;
   if(update_words===displayed)unchanged_reset_count=unchanged_reset_count+1;
  end
 end
 always @(negedge sysclk) if(source_reset_n)begin
  if(bank_commit_valid)begin
   if(displayed!==bank_commit_words)$fatal(1,"exported snapshot differs from actual latch commit");
   bank_commit_valid=0;
  end
  for(k=0;k<22;k=k+1) expected_dirty[k]=programmed[k*32+:32]!=displayed[k*32+:32];
  if(source.beam.display_dirty!==expected_dirty)$fatal(1,"display dirty tracking differs from banks");
 end
 always @(posedge vidclk) if(reset_n) begin
  accepted_valid=out_valid;
  if(out_valid)begin
   if(received>=sent || out_data!==expected[received])
    $fatal(1,"display epoch ordering/coherence mismatch %0d/%0d",received,sent);
   accepted=out_data;received=received+1;
  end
 end
 always @(negedge vidclk) if(reset_n && accepted_valid)begin
  if(video_words!==accepted[703:0])$fatal(1,"epoch failed to capture received snapshot");
  if(accepted[704] && (video_phase_count!==0 || video_half_line!==0))
   $fatal(1,"reset failed to restart phase");
 end
 task automatic writeword(input [4:0] idx,input [31:0] value);
  begin @(negedge sysclk);wvalid=1;windex=idx;wword=value;
   @(negedge sysclk);wvalid=0;repeat(2)@(negedge sysclk);
  end
 endtask
 task automatic resetword;
  begin writeword(22,32'h200);end
 endtask
 initial begin
  repeat(4)@(negedge sysclk);reset_n=1;
  // Producer bootstrap cannot precede FIFO's synchronised write reset release.
  repeat(4)@(negedge sysclk);source_reset_n=1;repeat(8)@(negedge sysclk);
  // Reset must travel even though power-on words and reset words match.
  resetword();resetword();
  // Before VBlank, a write followed by a reversal clears the exact dirty bit
  // and must not manufacture a later display-bank transition.
  writeword(0,1);if(!source.beam.display_dirty[0])$fatal(1,"missing dirty write");
  writeword(0,0);if(source.beam.display_dirty[0])$fatal(1,"write reversal stayed dirty");
  // Small H and high LC generate frequent VBlank, so every changed PMODE is
  // latched despite each write being separated by only four SYS clocks.
  writeword(12,32'h000003f9);writeword(13,0);writeword(16,1);
  writeword(17,0);writeword(18,0);writeword(20,0);writeword(21,32'h00200400);
  for(i=1;i<=256;i=i+1)writeword(0,i);
  // With zero VBlank landmark, a timing write can carry an old VBlank and a
  // restarted VBlank on the same edge. The post-write capture must win.
  writeword(21,32'h00200000);writeword(12,32'h000003fa);
  // RESET also follows an active stream, and the following identical RESET
  // is not elided merely because its payload equals the displayed words.
  resetword();resetword();
  repeat(30)@(negedge sysclk);
  if(sent!=received || reset_count!=4 || unchanged_reset_count<2 || sent<256 || both_events==0)
   $fatal(1,"incomplete snapshots sent=%0d received=%0d resets=%0d unchanged=%0d both=%0d",sent,received,reset_count,unchanged_reset_count,both_events);
  $display("PASS live display bank -> 4-entry CDC -> display epoch: %0d snapshots, %0d resets including %0d equal-word resets, %0d dual-VBlank edges; phase=%0d; four-SYS-clock admission, running video only",sent,reset_count,unchanged_reset_count,both_events,video_phase);
  $finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
