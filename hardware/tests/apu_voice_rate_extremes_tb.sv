`timescale 1ns/1ps
// Full-word TS/C++ phase vectors through the physical rate divider.
module apu_voice_rate_extremes_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,req_valid=0,rsp_ready=0;
 reg[31:0] req_rate_q16=0,req_source_hz=0;wire req_ready,rsp_valid;
 wire signed[63:0] rsp_whole_q16;wire signed[31:0] rsp_remainder;
 apu_voice_rate dut(.*);integer f,rc,n,count;reg[31:0] r,h,e;reg[63:0] q;
 initial begin
  f=$fopen("build/tests/apu-voice-rate-extremes.txt","r");if(!f)$fatal(1,"vectors missing");
  rc=$fscanf(f,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h\n",r,h,q,e);if(rc!=4)$fatal(1,"bad input");
   @(negedge clk);while(!req_ready)@(negedge clk);req_rate_q16=r;req_source_hz=h;req_valid=1;
   @(negedge clk);req_valid=0;while(!rsp_valid)@(negedge clk);
   if(rsp_whole_q16!==q||rsp_remainder!==e)$fatal(1,"case %d rate=%h hz=%h got=%h/%h expected=%h/%h",n,r,h,rsp_whole_q16,rsp_remainder,q,e);
   repeat(n%3)begin @(negedge clk);if(!rsp_valid||rsp_whole_q16!==q||rsp_remainder!==e)$fatal(1,"stalled response changed");end
   rsp_ready=1;@(negedge clk);rsp_ready=0;
  end
  $display("PASS %d actual TS/C++ extreme and random rate words, signed quotient/remainder and response stalls",count);$finish;
 end
 initial begin #50000000;$fatal(1,"timeout");end
endmodule
