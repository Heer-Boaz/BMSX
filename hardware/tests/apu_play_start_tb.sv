`timescale 1ns/1ps
// Exercises the PLAY admission/commit protocol against TS vectors which have
// also been compared to the C++ phase owner. The sender holds its input while
// stalled; the separate cursor and binder consumers supply independent ready.
module apu_play_start_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,play_valid=0,bind_ready=0,load_ready=0;reg [3:0] slot=0;reg [671:0] parameters=0;
 wire play_ready,bind_valid,load_valid,dec_reset,filter_clear;wire [3:0] load_slot;
 wire signed [63:0] cursor,step;wire signed [31:0] rem,step_rem;wire [31:0] frames,loop_start,loop_end;
 apu_play_start dut(.clk(clk),.reset_n(reset_n),.play_valid(play_valid),.play_ready(play_ready),.play_slot(slot),.play_parameters(parameters),
  .bind_commit_ready(bind_ready),.bind_commit_valid(bind_valid),.load_valid(load_valid),.load_ready(load_ready),.load_slot(load_slot),
  .load_cursor_q16(cursor),.load_step_q16(step),.load_remainder(rem),.load_step_remainder(step_rem),.load_frames(frames),
  .load_loop_start(loop_start),.load_loop_end(loop_end),.load_decoder_reset(dec_reset),.load_filter_clear(filter_clear));
 integer f,rc,count,n,executed;reg [31:0] r,h,e;reg [63:0] q;
 task automatic reset_all;
  begin @(negedge clk);reset_n=0;play_valid=0;bind_ready=0;load_ready=0;repeat(2)@(negedge clk);reset_n=1;end
 endtask
 task automatic stage(input [31:0] rate,input [31:0] hz,input [3:0] s);
  begin @(negedge clk);slot=s;parameters=0;parameters[2*32+:32]=hz;parameters[11*32+:32]=rate;
   parameters[5*32+:32]=32'habcdef12;parameters[8*32+:32]=32'h12345678;parameters[9*32+:32]=32'hfedcba98;
   parameters[13*32+:32]=32'hffffffff;play_valid=1;end
 endtask
 initial begin
  reset_all();stage(32'h10000,44100,3);repeat(12)@(negedge clk);reset_all();
  repeat(75)begin @(negedge clk);if(play_ready || load_valid || bind_valid || dut.rate_valid)$fatal(1,"old rate survived reset");end
  stage(32'h10000,44100,4);wait(dut.rate_valid);reset_all();repeat(3)@(negedge clk);
  if(play_ready || load_valid || bind_valid || dut.rate_valid)$fatal(1,"pending commit survived reset");
  f=$fopen("build/tests/apu-voice-rate-extremes.txt","r");if(!f)$fatal(1,"missing actual runtime vectors");
  rc=$fscanf(f,"%d\n",count);executed=0;
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h\n",r,h,q,e);if(rc!=4)$fatal(1,"bad vector");
   if(n%61==0 || n==count-1)begin
    stage(r,h,n[3:0]);wait(dut.rate_valid);repeat(2)@(negedge clk);
    if(play_ready || load_valid || bind_valid)$fatal(1,"completed while bind is stalled");
    bind_ready=1;#1;
    if(!load_valid || play_ready || bind_valid || load_slot!==n[3:0] || cursor!==64'h0000ffffffff0000 || step!==q || step_rem!==e || rem!==0 ||
       frames!==32'habcdef12 || loop_start!==32'h12345678 || loop_end!==32'hfedcba98 || !dec_reset || !filter_clear)
     $fatal(1,"stalled cursor or parameters changed for vector %0d",n);
    repeat(2)@(negedge clk);load_ready=1;#1;
    if(!play_ready || !bind_valid || !load_valid)$fatal(1,"ready/valid did not progress");
    @(negedge clk);play_valid=0;bind_ready=0;load_ready=0;executed=executed+1;
   end
  end
  $fclose(f);
  $display("PASS %0d actual TS/C++ rate vectors, full cursor fields, independent bind/load stalls and reset in divide/commit",executed);$finish;
 end
 initial begin #2000000;$fatal(1,"watchdog");end
endmodule
