`timescale 1ns/1ps
module core_binary64_service_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0;
 reg cpu_valid=0,geo_valid=0,cpu_rsp_ready=0,geo_rsp_ready=0;
 reg cpu_sqrt=0,geo_sqrt=0;
 reg [1:0] cpu_op=0,geo_op=0;reg [63:0] cpu_a=0,cpu_b=0,geo_a=0,geo_b=0;
 wire cpu_ready,geo_ready,cpu_rsp_valid,geo_rsp_valid;wire [63:0] cpu_rsp,geo_rsp;
`ifdef CORE_BINARY64_FAST_MULDIV
 core_binary64_service #(.FAST_ADDER(1),.FAST_MULDIV(1)) dut(.*);
`elsif CORE_BINARY64_FAST_ADD
 core_binary64_service #(.FAST_ADDER(1)) dut(.*);
`else
 core_binary64_service dut(.*);
`endif
 integer cycle=0;always @(posedge clk)cycle=cycle+1;
 function automatic nan_bits(input [63:0] x);
  nan_bits=(x[62:52]==11'h7ff && x[51:0]!=0);
 endfunction
 task automatic receive(input bit from_geo,input [63:0] expected,input integer start,input integer op);
  reg [63:0] actual;integer elapsed;
  begin
   while(!(from_geo?geo_rsp_valid:cpu_rsp_valid))@(negedge clk);
   if(from_geo?cpu_rsp_valid:geo_rsp_valid)$fatal(1,"wrong response owner");
   actual=from_geo?geo_rsp:cpu_rsp;
   if(nan_bits(expected)!==nan_bits(actual) || (!nan_bits(expected) && actual!==expected))
    $fatal(1,"op %0d got %h expected %h",op,actual,expected);
   elapsed=cycle-start;if(elapsed>maximum[op])begin maximum[op]=elapsed;max_a[op]=dut.operand_a;max_b[op]=dut.operand_b;end
   repeat(2)begin @(negedge clk);if(!(from_geo?geo_rsp_valid:cpu_rsp_valid) || (from_geo?geo_rsp:cpu_rsp)!==actual)
    $fatal(1,"result changed under backpressure");
    if(cpu_ready || geo_ready)$fatal(1,"new request admitted while result is held");end
   if(from_geo)geo_rsp_ready=1;else cpu_rsp_ready=1;
   @(negedge clk);geo_rsp_ready=0;cpu_rsp_ready=0;
  end
 endtask
 integer maximum[0:3];reg [63:0] max_a[0:3],max_b[0:3];integer f,rc,count,i,op,start;reg [63:0] a,b,want;
 reg [1023:0] vector_path;
 initial begin
  for(i=0;i<4;i=i+1)maximum[i]=0;
  repeat(3)@(negedge clk);reset_n=1;
  // Both contenders are held until accepted; the previous winner may not
  // bypass the other requester. Distinct results identify the retained owner.
  @(negedge clk);cpu_valid=1;geo_valid=1;cpu_op=0;geo_op=2;
  cpu_a=64'h3ff0000000000000;cpu_b=64'h4000000000000000;
  geo_a=64'h4000000000000000;geo_b=64'h4008000000000000;#1;
  if(!cpu_ready || geo_ready)$fatal(1,"initial arbitration");
  start=cycle;@(negedge clk);cpu_valid=0;
  receive(0,64'h4008000000000000,start,0);
  while(!geo_ready)@(negedge clk);start=cycle;@(negedge clk);geo_valid=0;
  receive(1,64'h4018000000000000,start,2);
  // Both producers remain eligible during repeated stalled completions. The
  // service must alternate admission by owner, not just the first pair.
  @(negedge clk);cpu_valid=1;geo_valid=1;
  for(i=0;i<16;i=i+1) begin
   #1;
   if(i[0] ? (!geo_ready || cpu_ready) : (!cpu_ready || geo_ready))
    $fatal(1,"round-robin winner at %0d",i);
   start=cycle;@(negedge clk);
   receive(i[0],i[0]?64'h4018000000000000:64'h4008000000000000,start,i[0]?2:0);
  end
  cpu_valid=0;geo_valid=0;
  // Reset an accepted division, then prove a new result cannot be confused
  // with the cancelled operation. Every arithmetic engine shares reset.
  @(negedge clk);cpu_valid=1;cpu_op=3;cpu_a=64'h3ff0000000000000;cpu_b=64'h4000000000000000;
  #1;while(!cpu_ready)@(negedge clk);@(negedge clk);cpu_valid=0;
  repeat(8)@(negedge clk);reset_n=0;repeat(3)@(negedge clk);
  if(cpu_rsp_valid || geo_rsp_valid)$fatal(1,"reset left a visible result");
  reset_n=1;repeat(2)@(negedge clk);
  cpu_valid=1;cpu_op=1;cpu_a=64'h4008000000000000;cpu_b=64'h3ff0000000000000;
  #1;while(!cpu_ready)@(negedge clk);start=cycle;@(negedge clk);cpu_valid=0;
  receive(0,64'h4000000000000000,start,1);
  if(!$value$plusargs("VECTORS=%s",vector_path)) vector_path="build/tests/core-binary64-vectors.txt";
  f=$fopen(vector_path,"r");if(!f)$fatal(1,"missing vectors: %0s",vector_path);
  rc=$fscanf(f,"%d",count);if(rc!=1)$fatal(1,"bad vector header");
  for(i=0;i<count;i=i+1) begin
   rc=$fscanf(f,"%d %h %h %h",op,a,b,want);if(rc!=4)$fatal(1,"bad vector %0d",i);
   @(negedge clk);
   if(i[0])begin geo_valid=1;geo_op=op;geo_a=a;geo_b=b;#1;while(!geo_ready)@(negedge clk);end
   else begin cpu_valid=1;cpu_op=op;cpu_a=a;cpu_b=b;#1;while(!cpu_ready)@(negedge clk);end
   start=cycle;@(negedge clk);cpu_valid=0;geo_valid=0;
   receive(i[0],want,start,op);
  end
  $display("PASS actual TS/C++ binary64 add/sub/mul/div: %0d vectors, alternating CPU/GEO, arbitration and held results",count);
  $display("MEASURE fixture admission-to-result max clocks: add=%0d sub=%0d mul=%0d div=%0d",maximum[0],maximum[1],maximum[2],maximum[3]);
  for(i=0;i<4;i=i+1)$display("MEASURE op=%0d max_a=%h max_b=%h",i,max_a[i],max_b[i]);
  $finish;
 end
 initial begin #200000000;$fatal(1,"simulation watchdog");end
endmodule
