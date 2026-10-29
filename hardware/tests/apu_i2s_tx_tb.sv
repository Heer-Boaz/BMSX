`timescale 1ns/1ps
module apu_i2s_tx_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0;reg [15:0] left=16'h8001,right=16'h7ffe;
 wire frame_latch,mclk,bclk,lrck,data;
 apu_i2s_tx dut(.clk(clk),.reset_n(reset_n),.frame_left(left),.frame_right(right),
  .frame_latch(frame_latch),.mclk(mclk),.bclk(bclk),.lrck(lrck),.serial_data(data));
 integer cycles=0,last_frame=0,last_bclk=0,frame_count=0,bit_count=0,mclk_count=0;
 reg testing=0;reg [15:0] want_l=16'h8001,want_r=16'h7ffe;reg expected;
 always @(posedge clk) if(reset_n) begin
  cycles=cycles+1;
  if(frame_latch) begin
   if(last_frame!=0 && cycles-last_frame!=768)$fatal(1,"frame cadence");
   last_frame=cycles;frame_count=frame_count+1;
  end
 end
 always @(posedge mclk) if(reset_n && testing)mclk_count=mclk_count+1;
 always @(posedge bclk) if(reset_n && testing) begin
  if(last_bclk!=0 && cycles-last_bclk!=12)$fatal(1,"BCK cadence");last_bclk=cycles;
  if(lrck!==(bit_count>=32))$fatal(1,"LRCK index %0d",bit_count);
  expected=0;
  if(bit_count>=1 && bit_count<=16) expected=want_l[16-bit_count];
  if(bit_count>=33 && bit_count<=48) expected=want_r[48-bit_count];
  if(data!==expected)$fatal(1,"I2S bit %0d expected %b got %b",bit_count,expected,data);
  bit_count=bit_count+1;
 end
 initial begin
  repeat(3) @(negedge clk);reset_n=1;
  wait(frame_latch);@(posedge clk);@(negedge clk);testing=1;
  wait(bit_count==64);wait(frame_latch);@(posedge clk);@(negedge clk);testing=0;
  if(mclk_count!=256)$fatal(1,"MCLK count %0d",mclk_count);
  left=16'h1234;right=16'hfedc;want_l=left;want_r=right;bit_count=0;mclk_count=0;last_bclk=0;
  wait(frame_latch);@(posedge clk);@(negedge clk);testing=1;
  wait(bit_count==64);wait(frame_latch);@(posedge clk);@(negedge clk);testing=0;
  if(mclk_count!=256)$fatal(1,"second MCLK count %0d",mclk_count);
  $display("PASS PCM1754 I2S: 256fs MCLK, 64fs BCK, 44.1kHz frame, stereo MSB delay/padding and signed bit patterns");$finish;
 end
 initial begin #100000;$fatal(1,"timeout");end
endmodule
