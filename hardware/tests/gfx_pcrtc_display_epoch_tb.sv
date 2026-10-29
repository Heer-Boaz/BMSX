`timescale 1ns/1ps
module gfx_pcrtc_display_epoch_tb;
 reg clk=0,reset_n=0,update_valid=0,update_reset=0;
 always #5 clk=~clk;
 reg [703:0] words=0;
 wire [703:0] display;
 wire running,valid,field,vblank;
 wire [22:0] period,phase;
 wire [14:0] line;
 wire [63:0] half;
 wire [31:0] x;
 gfx_pcrtc_display_epoch dut(.clk(clk),.reset_n(reset_n),.update_valid(update_valid),
  .update_reset(update_reset),.update_words(words),.display_words(display),.running(running),
  .sample_valid(valid),.period_numerator(period),.phase(phase),.field_half_line(line),
  .elapsed_half_lines(half),.local_field(field),.vblank_active(vblank),.output_x(x));
 task push;
  begin @(negedge clk);update_valid=1;@(negedge clk);update_valid=0;#1;end
 endtask
 initial begin
  repeat(2) @(negedge clk);reset_n=1;
  words[12*32+:32]=(1<<21)|(2<<3)|1; // step=1, LC=2, D=1
  words[16*32+:32]=20;
  words[21*32+:32]=32'h00000c00;
  words[2*32+:32]=32'hfedcba98;
  push();
  if(display!==words || !running || !valid || phase!==0 || period!==20 || x!==0)
   $fatal(1,"initial atomic epoch");
  repeat(2) @(negedge clk);#1;
  if(phase!==8 || x!==4) $fatal(1,"display beam does not advance");
  // A new non-timing word does not restart the display phase.
  words[2*32+:32]=32'h87654321;
  push();
  if(display!==words || phase!==16 || x!==8) $fatal(1,"non-timing update restarted phase");
  // Bit 31 is not decoded by the timing math, but it is still stored and
  // the complete timing word changed, just like a programmed timing write.
  words[19*32+:32]=32'h80000000;
  push();
  if(display!==words || phase!==0 || x!==0) $fatal(1,"timing word update not atomic");
  repeat(3) @(negedge clk);#1;
  if(!running || phase!==12) $fatal(1,"display should run without new updates");
  // Stop is an explicit latched timing, not a substituted black pixel.
  words[12*32+16]=1;
  push();
  if(display!==words || running || valid) $fatal(1,"latched stop not applied");
  // Explicit reset packet restarts even when timing words are unchanged.
  words[12*32+16]=0;
  push();
  repeat(2) @(negedge clk);#1;
  @(negedge clk);update_valid=1;update_reset=1;
  @(negedge clk);update_valid=0;update_reset=0;#1;
  if(phase!==0 || half!==0 || field!==0) $fatal(1,"reset epoch");
  $display("PASS display epoch: atomic raw words, phase preservation/restart, stop and reset");
  $finish;
 end
endmodule
