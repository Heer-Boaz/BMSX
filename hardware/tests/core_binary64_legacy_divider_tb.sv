`timescale 1ns/1ps
// An explicit known counterexample in the unchanged upstream reference.
// This is a characterization, not an acceptable CPU/GEO result.
module core_binary64_legacy_divider_tb;
 reg clk=0,rst=1,a_stb=0,b_stb=0,z_ack=0;
 always #5 clk=~clk;
 wire a_ack,b_ack,z_valid;wire [63:0] z;
 double_divider dut(.clk(clk),.rst(rst),.input_a(64'h0000000002000000),
  .input_b(64'h4000000000000001),.input_a_stb(a_stb),.input_b_stb(b_stb),
  .input_a_ack(a_ack),.input_b_ack(b_ack),.output_z_stb(z_valid),
  .output_z_ack(z_ack),.output_z(z));
 initial begin
  repeat(3)@(negedge clk);rst=0;a_stb=1;
  while(!a_ack)@(negedge clk);@(negedge clk);a_stb=0;b_stb=1;
  while(!b_ack)@(negedge clk);@(negedge clk);b_stb=0;
  while(!z_valid)@(negedge clk);
  if(z!==64'h0020000001000000)$fatal(1,"unexpected upstream result %h",z);
  $display("PASS characterization: original upstream divider returns %h; Number result is 0000000001000000",z);
  $finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
