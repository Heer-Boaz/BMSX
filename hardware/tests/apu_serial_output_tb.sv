`timescale 1ns/1ps
// Exercise the actual one-entry stereo register and the serial boundary,
// including simultaneous release/replacement and continuous valid data.
module apu_serial_output_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0,valid=0;
 reg signed [15:0] left=0,right=0;
 wire ready,latch,missed,mclk,bclk,lrck,data;
 apu_serial_output dut(.clk(clk),.reset_n(reset_n),.frame_valid(valid),.frame_ready(ready),
  .frame_left(left),.frame_right(right),.frame_latch(latch),.deadline_missed(missed),
  .mclk(mclk),.bclk(bclk),.lrck(lrck),.serial_data(data));
 integer emitted=0,bit_index=0,checks=0,simultaneous=0;
 reg checking=0,bit_expected;
 reg [31:0] expected;
 always @(posedge clk) if(reset_n) begin
  if(latch && valid && ready)simultaneous=simultaneous+1;
  if(latch && emitted<5) begin
   if(checking)$fatal(1,"previous serial frame incomplete");
   case(emitted)
    0:expected=32'h23451234;
    1:expected=32'h45673456;
    2:expected=32'h67895678;
    3:expected=32'h89ab789a;
    4:expected=32'hcdefabcd;
   endcase
   bit_index=0;checking=1;emitted=emitted+1;
  end
 end
 always @(posedge bclk) if(reset_n && checking) begin
  if(lrck!==(bit_index>=32))$fatal(1,"channel mismatch bit %0d",bit_index);
  bit_expected=0;
  if(bit_index>=1 && bit_index<=16)bit_expected=expected[16-bit_index];
  if(bit_index>=33 && bit_index<=48)bit_expected=expected[64-bit_index];
  if(data!==bit_expected)$fatal(1,"serial bit %0d of frame %0d",bit_index,emitted);
  checks=checks+1;bit_index=bit_index+1;if(bit_index==64)checking=0;
 end
 initial begin
  repeat(3)@(negedge clk);reset_n=1;
  @(negedge clk);valid=1;left=16'h1234;right=16'h2345;
  if(!ready)$fatal(1,"empty buffer not ready");
  @(posedge clk);@(negedge clk);left=16'h3456;right=16'h4567;
  if(ready)$fatal(1,"full buffer accepted an extra frame");
  // Keep B valid while A is held. A must be emitted and B accepted on
  // the very same system edge, without duplicating either stereo frame.
  wait(latch);@(posedge clk);@(negedge clk);valid=0;
  wait(emitted==2);@(negedge clk);
  valid=1;left=16'h5678;right=16'h6789;
  if(!ready)$fatal(1,"buffer not released after emission");
  @(posedge clk);@(negedge clk);left=16'h789a;right=16'h89ab;
  if(ready)$fatal(1,"full buffer did not backpressure D");
  wait(latch);@(posedge clk);@(negedge clk);valid=0;
  wait(emitted==4);wait(!checking);@(negedge clk);
  if(checks!=256 || simultaneous!=2 || missed)$fatal(1,"serial/handshake count or deadline");
  // Assert reset with an occupied entry. The first frame after release must
  // be the new F value, not the entry that existed before reset.
  valid=1;left=16'h9876;right=16'hfedc;
  @(posedge clk);@(negedge clk);valid=0;
  if(ready)$fatal(1,"reset setup did not fill buffer");
  reset_n=0;@(negedge clk);
  if(missed || ready)$fatal(1,"reset did not clear state/disable producer");
  reset_n=1;@(negedge clk);valid=1;left=16'habcd;right=16'hcdef;
  if(!ready)$fatal(1,"reset retained the old entry");
  @(posedge clk);@(negedge clk);valid=0;
  wait(emitted==5);wait(!checking);@(negedge clk);
  if(checks!=320)$fatal(1,"post-reset serial frame incomplete");
  $display("PASS APU serial buffer: full backpressure, two atomic edge replacements, reset of occupied entry and five stereo frames");
  $finish;
 end
 initial begin #200000;$fatal(1,"serial buffer watchdog");end
endmodule
