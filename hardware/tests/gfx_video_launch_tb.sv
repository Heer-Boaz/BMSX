`timescale 1ns/1ps
// Ideal digital DAC input with the specified one-clock DAC pipeline; analog
// delay, I/O cell, cable, buffer skew and clock jitter are outside this model.
module gfx_video_launch_tb;
 reg pixel_clk=0;always #37.037037 pixel_clk=~pixel_clk;
 reg reset_n=0;reg [31:0] rgba=0;reg blank_n=0,csync_n=1;
 wire pclk,blank,csync;wire [7:0] r,g,b;
 gfx_video_launch dut(.pixel_clk(pixel_clk),.reset_n(reset_n),.pixel_rgba(rgba),.blank_n_in(blank_n),.csync_n_in(csync_n),
  .video_pclk(pclk),.video_r(r),.video_g(g),.video_b(b),.video_blank_n(blank),.video_csync_n(csync));
 reg [23:0] dac_stage=0,dac_out=0;reg dac_blank_stage=0,dac_blank_out=0;
 always @(posedge pclk) begin dac_stage<={b,g,r};dac_out<=dac_stage;dac_blank_stage<=blank;dac_blank_out<=dac_blank_stage;end
 integer i;reg [23:0] prior_rgb=0;reg prior_blank=0;reg [31:0] want;
 initial begin
  repeat(2)@(posedge pixel_clk);#1;reset_n=1;
  for(i=0;i<256;i=i+1) begin
   want={8'hc7,8'(i^8'h5a),8'(i*7),8'(i*13)};rgba=want;blank_n=i[0];csync_n=i[1];
   @(negedge pixel_clk);#1;
   if({b,g,r}!==want[23:0] || blank!==i[0] || csync!==i[1])$fatal(1,"launch %0d",i);
   @(posedge pixel_clk);#1;
   if(dac_stage!==want[23:0] || dac_blank_stage!==i[0])$fatal(1,"DAC capture %0d",i);
   if(dac_out!==prior_rgb || dac_blank_out!==prior_blank)$fatal(1,"DAC pipeline %0d",i);
   prior_rgb=want[23:0];prior_blank=i[0];
  end
  reset_n=0;#1;if({b,g,r}!==0 || blank!==0 || csync!==1)$fatal(1,"reset outputs");
  $display("PASS ADV7125 digital launch/capture: RGB lane order, blank/sync association, falling-edge launch and one-clock DAC pipeline model");$finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
