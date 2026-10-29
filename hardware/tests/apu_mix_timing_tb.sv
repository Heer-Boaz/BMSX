`timescale 1ns/1ps
// Fixed workload latency of the shared multiplier, with valid data presented
// whenever ready. This excludes source, filter and DAC scheduling.
module apu_mix_timing_tb;
 reg clk=0;always #5 clk=!clk;
 reg reset_n=0,start_valid=0,slot_valid=0,slot_active=0,frame_ready_out=0;
 reg signed [15:0] slot_left=0,slot_right=0;
 reg signed [31:0] slot_gain_q12=0;
 reg [31:0] slot_level_lr_q14=32'h40004000;
 wire start_ready,slot_ready,frame_valid;wire signed [15:0] frame_left,frame_right;
 apu_mix_engine dut(.*);
 integer cycle=0;always @(posedge clk) cycle<=cycle+1;
 integer start_cycle,i,inactive_cycles,equal_cycles,unequal_cycles,pan_equal_cycles,pan_distinct_cycles;
 task automatic run_frame(input integer mode,output integer cycles);
  begin
   @(negedge clk);if(!start_ready)$fatal(1,"start busy");start_valid=1;
   @(negedge clk);start_valid=0;start_cycle=cycle;
   for(i=0;i<16;i=i+1) begin
    while(!slot_ready) @(negedge clk);
    slot_active=(mode!=0);slot_left=1000;slot_right=mode==2 ? -1000:1000;
    slot_level_lr_q14=mode==3 ? 32'h20002000 : mode==4 ? 32'he0002000 : 32'h40004000;
    slot_gain_q12=4096;slot_valid=1;@(negedge clk);slot_valid=0;
   end
   while(!frame_valid) @(negedge clk);
   cycles=cycle-start_cycle;
   if(frame_left!==(mode==0 ? 16'sd0:mode>=3 ? 16'sd8000:16'sd16000) ||
      frame_right!==(mode==0 ? 16'sd0:mode==2 ? -16'sd16000:mode==3 ? 16'sd8000:mode==4 ? -16'sd8000:16'sd16000))
    $fatal(1,"mode %0d result %0d,%0d",mode,frame_left,frame_right);
   frame_ready_out=1;@(negedge clk);frame_ready_out=0;
  end
 endtask
 initial begin
  repeat(3) @(negedge clk);reset_n=1;
  run_frame(0,inactive_cycles);run_frame(1,equal_cycles);run_frame(2,unequal_cycles);
  run_frame(3,pan_equal_cycles);run_frame(4,pan_distinct_cycles);
  if(!(inactive_cycles<equal_cycles && equal_cycles<unequal_cycles))
   $fatal(1,"unexpected latency inactive=%0d equal=%0d unequal=%0d",inactive_cycles,equal_cycles,unequal_cycles);
  if(!(equal_cycles<pan_equal_cycles && pan_equal_cycles<pan_distinct_cycles))
   $fatal(1,"unexpected level latency unity=%0d equal-level=%0d distinct=%0d",equal_cycles,pan_equal_cycles,pan_distinct_cycles);
  $display("PASS mix latency 16 inactive=%0d unity-equal=%0d unity-unequal=%0d scaled-equal=%0d scaled-distinct=%0d clocks, no source/filter/DAC",inactive_cycles,equal_cycles,unequal_cycles,pan_equal_cycles,pan_distinct_cycles);
  $finish;
 end
 initial begin #100000;$fatal(1,"watchdog");end
endmodule
