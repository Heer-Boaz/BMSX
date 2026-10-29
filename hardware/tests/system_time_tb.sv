`timescale 1ns/1ps
// Compare the physical rational timebase with the independent exact time
// expression used by the TS/C++ scheduler owners, at every cycle including
// the non-integer 33,868.8-cycle millisecond boundaries.
module system_time_tb;
 reg clk=0;always #5 clk=!clk;reg reset_n=0;wire [31:0] time_ms;
 system_time dut(.*);
 integer n;reg [63:0] expected;
 initial begin
  repeat(3) @(negedge clk);reset_n=1;
  for(n=1;n<=508032;n=n+1) begin
   @(posedge clk);#1;expected=(64'(n)*1000)/33868800;
   if(time_ms!==expected[31:0]) $fatal(1,"cycle %0d got %h expected %h",n,time_ms,expected[31:0]);
  end
  if(time_ms!==15 || dut.fraction!==0) $fatal(1,"exact 15ms ratio");
  // Seed the documented 32-bit wrapping boundary directly so the regression
  // exercises rollover without simulating 49.7 days of real clock cycles.
  @(negedge clk);dut.time_ms=32'hffffffff;dut.fraction=18'd169340;
  @(posedge clk);#1;if(time_ms!==0 || dut.fraction!==1) $fatal(1,"time wrap or remainder");
  @(negedge clk);reset_n=0;#1;if(time_ms!==0 || dut.fraction!==0) $fatal(1,"time epoch reset");
  $display("PASS SYSTEM exact 33.8688MHz millisecond timebase: 508032 consecutive cycles, fractional phase, 32-bit wrap and reset");$finish;
 end
endmodule
