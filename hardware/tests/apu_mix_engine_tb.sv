`timescale 1ns/1ps
// Actual TS/C++ ApuOutputMixer golden frames; inputs are PCM16 samples after
// interpolation/filtering and full signed gain words. This test deliberately
// excludes source service, playback, APU scheduling and physical timing.
module apu_mix_engine_tb;
 reg clk=0,reset_n=0,start_valid=0,slot_valid=0,slot_active=0,frame_ready_out=0;
 reg signed [15:0] slot_left=0,slot_right=0;
 reg signed [31:0] slot_gain_q12=0;
 wire [31:0] slot_level_lr_q14=32'h40004000;
 wire start_ready,slot_ready,frame_valid;
 wire signed [15:0] frame_left,frame_right;
 apu_mix_engine dut(.*);
 always #5 clk=~clk;
 string vector_path="build/tests/apu-mix-vectors.txt";
 integer f,scan,count,n,slot,active;
 reg [15:0] left_word,right_word;
 reg [31:0] gain_word,expected,held;
 initial begin #10000000;$fatal(1,"mixer watchdog");end
 initial begin
  if($value$plusargs("VECTORS=%s",vector_path)) begin end
  f=$fopen(vector_path,"r");if(f==0)$fatal(1,"cannot open mixer vectors");
  scan=$fscanf(f,"%d",count);if(scan!=1)$fatal(1,"missing mixer case count");
  repeat(3) @(negedge clk);reset_n=1;
  for(n=0;n<count;n=n+1) begin
   @(negedge clk);if(!start_ready)$fatal(1,"frame start not ready");start_valid=1;
   @(negedge clk);start_valid=0;
   for(slot=0;slot<16;slot=slot+1) begin
    scan=$fscanf(f,"%d %h %h %h",active,left_word,right_word,gain_word);
    if(scan!=4)$fatal(1,"incomplete slot case %0d slot %0d",n,slot);
    while(!slot_ready) @(negedge clk);
    if((slot+n)%5==0) repeat(2) @(negedge clk);
    slot_active=active;slot_left=left_word;slot_right=right_word;slot_gain_q12=gain_word;slot_valid=1;
    @(negedge clk);slot_valid=0;
   end
   scan=$fscanf(f,"%h",expected);if(scan!=1)$fatal(1,"missing output case %0d",n);
   while(!frame_valid) @(negedge clk);
   held={frame_right,frame_left};
   if(held!==expected)$fatal(1,"case %0d expected %h got %h",n,expected,held);
   repeat(3) begin
    @(negedge clk);
    if(!frame_valid || {frame_right,frame_left}!==held || start_ready)
     $fatal(1,"output changed during backpressure case %0d",n);
   end
   frame_ready_out=1;@(negedge clk);frame_ready_out=0;
   if(frame_valid || !start_ready)$fatal(1,"output did not retire case %0d",n);
  end
  // Reset aborts an in-progress frame, and must not retain partial sum or output.
  @(negedge clk);start_valid=1;@(negedge clk);start_valid=0;
  slot_valid=1;slot_active=1;slot_left=123;slot_right=-456;slot_gain_q12=4096;
  @(negedge clk);slot_valid=0;@(negedge clk);reset_n=0;
  repeat(2) @(negedge clk);reset_n=1;
  if(!start_ready || frame_valid)$fatal(1,"reset failed to abort mixer frame");
  // An all-inactive frame after the aborted partial sum must be silent.
  @(negedge clk);start_valid=1;@(negedge clk);start_valid=0;
  for(slot=0;slot<16;slot=slot+1) begin
   while(!slot_ready) @(negedge clk);
   slot_active=0;slot_valid=1;
   @(negedge clk);slot_valid=0;
  end
  while(!frame_valid) @(negedge clk);
  if(frame_left!==0 || frame_right!==0)$fatal(1,"partial frame leaked after reset");
  // Reset also discards an unconsumed output rather than replaying it.
  reset_n=0;repeat(2) @(negedge clk);reset_n=1;
  if(!start_ready || frame_valid)$fatal(1,"reset failed to discard pending output");
  $fclose(f);
  $display("PASS %0d TS/C++ golden stereo mixer frames, 16 slots/frame, output backpressure and reset abort",count);
  $finish;
 end
endmodule
