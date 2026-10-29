`timescale 1ns/1ps
// The real TS/C++ phase-resolver outputs drive the physical signed divider.
module apu_voice_rate_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,req_valid=0,rsp_ready=0;
 reg [31:0] req_rate_q16=0,req_source_hz=0;wire req_ready,rsp_valid;wire signed [63:0] rsp_whole_q16;wire signed [31:0] rsp_remainder;
 apu_voice_rate dut(.*);
 integer f,rc,c,n,cases,frames,stalls=0;reg [31:0] start,count,lo,hi,rate,hz,rem,was,active,ended,cur,nxt,frac,r,packed_audio;reg [63:0] whole,cursor;
 initial begin
  f=$fopen("build/tests/apu-voice-cursor-vectors.txt","r");if(!f)$fatal(1,"missing vectors");rc=$fscanf(f,"%d %d\n",cases,frames);
  repeat(2)@(negedge clk);reset_n=1;
  for(c=0;c<cases;c=c+1)begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h\n",start,count,lo,hi,rate,hz,whole,rem);if(rc!=8)$fatal(1,"case %d",c);
   req_rate_q16=rate;req_source_hz=hz;@(negedge clk);while(!req_ready)@(negedge clk);req_valid=1;@(negedge clk);req_valid=0;
   while(!rsp_valid)@(negedge clk);
   if(rsp_whole_q16!==whole||rsp_remainder!==rem)$fatal(1,"case %d rate %h hz %h expected %h/%h got %h/%h",c,rate,hz,whole,rem,rsp_whole_q16,rsp_remainder);
   repeat(c%3)begin @(negedge clk);if(!rsp_valid||rsp_whole_q16!==whole||rsp_remainder!==rem)$fatal(1,"unstable result");stalls=stalls+1;end
   rsp_ready=1;@(negedge clk);rsp_ready=0;
   for(n=0;n<frames;n=n+1)begin rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h\n",was,active,ended,cur,nxt,frac,cursor,r,packed_audio);if(rc!=9)$fatal(1,"frame missing");end
  end
  if(!stalls)$fatal(1,"missing output stalls");
  $display("PASS %0d signed rate/source products, quotients and remainders vs actual TS/C++; 64 divider steps and stalled outputs",cases);$finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
