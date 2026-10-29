`timescale 1ns/1ps
// Proposed Q2.14 left/right levels and signed Q12 master. Vector files are
// independently checked against TS/C++ central numeric owners, and the unity
// cases are also checked against the existing production APU mixers. These are
// mixer inputs after source/filter/fade processing, not an end-to-end APU.
module apu_pan_engine_tb;
 reg clk=0,reset_n=0,start_valid=0,slot_valid=0,slot_active=0,frame_ready_out=0;
 reg signed [15:0] slot_left=0,slot_right=0;
 reg signed [31:0] slot_gain_q12=0;
 reg [31:0] slot_level_lr_q14=0;
 wire start_ready,slot_ready,frame_valid;
 wire signed [15:0] frame_left,frame_right;
 apu_mix_engine dut(.*);
 always #5 clk=~clk;
 string vector_path="build/tests/apu-pan-vectors.txt";
 integer f,scan,count,n,slot,active,legacy;
 reg [15:0] left_word,right_word;
 reg [31:0] gain_word,level_word,expected,held;
 initial begin #10000000;$fatal(1,"pan mixer watchdog");end
 initial begin
  if($value$plusargs("VECTORS=%s",vector_path)) begin end
  f=$fopen(vector_path,"r");if(f==0)$fatal(1,"cannot open vectors");
  scan=$fscanf(f,"%d",count);if(scan!=1)$fatal(1,"missing case count");
  repeat(3) @(negedge clk);reset_n=1;
  for(n=0;n<count;n=n+1) begin
   scan=$fscanf(f,"%d",legacy);if(scan!=1)$fatal(1,"missing legacy marker");
   @(negedge clk);if(!start_ready)$fatal(1,"frame start not ready");start_valid=1;
   @(negedge clk);start_valid=0;
   for(slot=0;slot<16;slot=slot+1) begin
    scan=$fscanf(f,"%d %h %h %h %h",active,left_word,right_word,gain_word,level_word);
    if(scan!=5)$fatal(1,"incomplete case %0d slot %0d",n,slot);
    while(!slot_ready) @(negedge clk);
    if((slot+n)%5==0) repeat(2) @(negedge clk);
    slot_active=active;slot_left=left_word;slot_right=right_word;
    slot_gain_q12=gain_word;slot_level_lr_q14=level_word;slot_valid=1;
    @(negedge clk);slot_valid=0;
   end
   scan=$fscanf(f,"%h",expected);if(scan!=1)$fatal(1,"missing result case %0d",n);
   while(!frame_valid) @(negedge clk);
   held={frame_right,frame_left};
   if(held!==expected)$fatal(1,"case %0d expected %h got %h",n,expected,held);
   repeat(3) begin @(negedge clk);
    if(!frame_valid || {frame_right,frame_left}!==held || start_ready)
     $fatal(1,"output changed while backpressured case %0d",n);
   end
   frame_ready_out=1;@(negedge clk);frame_ready_out=0;
   if(frame_valid || !start_ready)$fatal(1,"result not retired case %0d",n);
  end
  // An incomplete frame is discarded, including factors and partial sums.
  @(negedge clk);start_valid=1;@(negedge clk);start_valid=0;
  slot_valid=1;slot_active=1;slot_left=123;slot_right=-456;
  slot_gain_q12=4096;slot_level_lr_q14=32'h00004000;
  @(negedge clk);slot_valid=0;@(negedge clk);reset_n=0;
  repeat(2) @(negedge clk);reset_n=1;
  if(!start_ready || frame_valid)$fatal(1,"reset failed to abort mixer frame");
  @(negedge clk);start_valid=1;@(negedge clk);start_valid=0;
  for(slot=0;slot<16;slot=slot+1) begin
   while(!slot_ready) @(negedge clk);
   slot_active=0;slot_valid=1;@(negedge clk);slot_valid=0;
  end
  while(!frame_valid) @(negedge clk);
  if(frame_left!==0 || frame_right!==0)$fatal(1,"partial frame leaked after reset");
  reset_n=0;repeat(2) @(negedge clk);reset_n=1;
  if(!start_ready || frame_valid)$fatal(1,"reset retained pending output");
  $fclose(f);
  $display("PASS %0d proposed L/R-gain TS/C++ golden frames, unity parity, stalls and reset",count);
  $finish;
 end
endmodule
