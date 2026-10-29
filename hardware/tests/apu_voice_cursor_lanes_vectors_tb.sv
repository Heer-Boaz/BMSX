`timescale 1ns/1ps
// Actual TS/C++ mixer-generated phase/loop states, exercised through the
// cursor owner under output stalls. No divider throughput or silicon timing
// is inferred from the correct integer results.
module apu_voice_cursor_lanes_vectors_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,load_valid=0,req_valid=0,rsp_ready=0;
 reg [3:0] load_slot=0,req_slot=0;reg signed [63:0] load_cursor_q16=0,load_step_q16=0;
 reg signed [31:0] load_remainder=0,load_step_remainder=0;reg [31:0] load_frames=0,load_loop_start=0,load_loop_end=0;
 reg req_active=0;wire load_ready,req_ready,rsp_valid,rsp_active,rsp_ended;wire [3:0] rsp_slot;
 wire [31:0] rsp_frame,rsp_neighbor;wire [15:0] rsp_fraction;
 wire signed [63:0] rsp_next_cursor_q16;wire signed [31:0] rsp_next_remainder;
 apu_voice_cursor_lanes dut(.*);
 integer f,rc,c,n,cases,frames,stalls=0,longcases=0,maxclocks=0;
 string vector_path="build/tests/apu-voice-cursor-vectors.txt";
 reg [31:0] start,count,lo,hi,rate,hz,step_rem,was,active,ended,cur,next,frac,remainder,packed_audio;
 reg [63:0] step,cursor;integer cycles;
 initial begin
  rc=$value$plusargs("VECTORS=%s",vector_path);
  f=$fopen(vector_path,"r");if(!f)$fatal(1,"vectors missing");
  rc=$fscanf(f,"%d %d\n",cases,frames);repeat(2)@(negedge clk);reset_n=1;
  for(c=0;c<cases;c=c+1)begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h\n",start,count,lo,hi,rate,hz,step,step_rem);
   if(rc!=8)$fatal(1,"bad case %0d",c);
   load_slot=c%16;load_cursor_q16=$signed({16'd0,start,16'd0});load_step_q16=step;load_remainder=0;load_step_remainder=step_rem;
   load_frames=count;load_loop_start=lo;load_loop_end=hi;
   @(negedge clk);while(!load_ready)@(negedge clk);load_valid=1;@(negedge clk);load_valid=0;
   for(n=0;n<frames;n=n+1)begin
    rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h\n",was,active,ended,cur,next,frac,cursor,remainder,packed_audio);
    if(rc!=9)$fatal(1,"bad frame %0d:%0d",c,n);
    req_slot=c%16;req_active=was[0];@(negedge clk);while(!req_ready)@(negedge clk);req_valid=1;@(negedge clk);req_valid=0;
    cycles=0;while(!rsp_valid)begin @(negedge clk);cycles=cycles+1;if(cycles>150)$fatal(1,"cursor timeout");end
    if(cycles>maxclocks)maxclocks=cycles;if(cycles>10)longcases=longcases+1;
    if(rsp_slot!==req_slot||rsp_active!==active[0]||rsp_ended!==ended[0]||rsp_frame!==cur||rsp_neighbor!==next||rsp_fraction!==frac[15:0]||rsp_next_cursor_q16!==cursor||rsp_next_remainder!==remainder)
      $fatal(1,"case %0d frame %0d got a/e=%d/%d frame/next/frac=%h/%h/%h cursor/rem=%h/%h expected=%d/%d %h/%h/%h %h/%h",c,n,rsp_active,rsp_ended,rsp_frame,rsp_neighbor,rsp_fraction,rsp_next_cursor_q16,rsp_next_remainder,active,ended,cur,next,frac,cursor,remainder);
    repeat((c+n)%3)begin
     load_valid=1;req_valid=1;@(negedge clk);
     if(load_ready||req_ready||!rsp_valid||rsp_next_cursor_q16!==cursor||rsp_frame!==cur)$fatal(1,"unstable stalled descriptor or premature load/request");
     stalls=stalls+1;
    end
    load_valid=0;req_valid=0;rsp_ready=1;@(negedge clk);rsp_ready=0;
   end
  end
  if(!stalls||!longcases)$fatal(1,"coverage missing");
  $display("PASS four-lane %0d x %0d actual TS/C++ mixer cursor phases, loops, carries, end and stalls; modulo paths=%0d peak clocks=%0d",cases,frames,longcases,maxclocks);$finish;
 end
 initial begin #20000000;$fatal(1,"timeout");end
endmodule
