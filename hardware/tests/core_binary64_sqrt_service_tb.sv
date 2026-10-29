`timescale 1ns/1ps
module core_binary64_sqrt_service_tb;
 reg clk=0; always #5 clk=~clk; reg reset_n=0;
 reg cpu_valid=0,geo_valid=0,cpu_rsp_ready=0,geo_rsp_ready=0,cpu_sqrt=1,geo_sqrt=1;
 reg [1:0] cpu_op=0,geo_op=0;
 reg [63:0] cpu_a=0,cpu_b=0,geo_a=0,geo_b=0;
 wire cpu_ready,geo_ready,cpu_rsp_valid,geo_rsp_valid; wire [63:0] cpu_rsp,geo_rsp;
 core_binary64_service #(.FAST_ADDER(1),.FAST_MULDIV(1)) dut(.*);
 function automatic nan_bits(input [63:0] x); nan_bits=x[62:52]==11'h7ff && x[51:0]!=0;endfunction
 task automatic receive(input bit geo,input [63:0] expected);
  reg [63:0] actual;
  begin
   while(!(geo?geo_rsp_valid:cpu_rsp_valid))@(negedge clk);
   if(geo?cpu_rsp_valid:geo_rsp_valid)$fatal(1,"wrong owner");
   actual=geo?geo_rsp:cpu_rsp;
   if(nan_bits(actual)!==nan_bits(expected) || (!nan_bits(expected) && actual!==expected))
    $fatal(1,"sqrt mismatch input %h actual %h expected %h",dut.operand_a,actual,expected);
   repeat(2)begin @(negedge clk);if(!(geo?geo_rsp_valid:cpu_rsp_valid) || (geo?geo_rsp:cpu_rsp)!==actual || cpu_ready || geo_ready)$fatal(1,"held response");end
   if(geo)geo_rsp_ready=1;else cpu_rsp_ready=1;
   @(negedge clk);cpu_rsp_ready=0;geo_rsp_ready=0;
  end
 endtask
 integer f,rc,count,i;reg [63:0] a,want; reg [1023:0] path;
 initial begin
  repeat(3)@(negedge clk);reset_n=1;
  @(negedge clk);cpu_valid=1;geo_valid=1;cpu_a=64'h4010000000000000;geo_a=64'h4022000000000000;#1;
  if(!cpu_ready || geo_ready)$fatal(1,"first arbitration");
  @(negedge clk);cpu_valid=0;receive(0,64'h4000000000000000);
  while(!geo_ready)@(negedge clk);@(negedge clk);geo_valid=0;receive(1,64'h4008000000000000);
  // Exercise a binary operation followed by unary sqrt while both contend.
  @(negedge clk);cpu_valid=1;geo_valid=1;cpu_sqrt=0;cpu_op=2;
  cpu_a=64'h4000000000000000;cpu_b=64'h4008000000000000;geo_a=64'h4010000000000000;#1;
  if(!cpu_ready || geo_ready)$fatal(1,"mixed arbitration");
  @(negedge clk);cpu_valid=0;receive(0,64'h4018000000000000);
  while(!geo_ready)@(negedge clk);@(negedge clk);geo_valid=0;receive(1,64'h4000000000000000);
  @(negedge clk);cpu_sqrt=1;cpu_valid=1;cpu_a=64'h4000000000000000;#1;while(!cpu_ready)@(negedge clk);
  @(negedge clk);cpu_valid=0;repeat(10)@(negedge clk);reset_n=0;repeat(3)@(negedge clk);reset_n=1;
  if(!$value$plusargs("VECTORS=%s",path))$fatal(1,"missing VECTORS");
  f=$fopen(path,"r");if(!f)$fatal(1,"missing vector file");
  rc=$fscanf(f,"%d",count);if(rc!=1)$fatal(1,"bad vector header");
  for(i=0;i<count;i=i+1)begin
   rc=$fscanf(f,"%h %h",a,want);if(rc!=2)$fatal(1,"bad vector %0d",i);
   @(negedge clk);if(i[0])begin geo_a=a;geo_valid=1;#1;while(!geo_ready)@(negedge clk);end
   else begin cpu_a=a;cpu_valid=1;#1;while(!cpu_ready)@(negedge clk);end
   @(negedge clk);cpu_valid=0;geo_valid=0;receive(i[0],want);
  end
  $display("PASS binary64 sqrt %0d JS/C++ vectors; shared CPU/GEO, backpressure, reset",count);$finish;
 end
 initial begin #200000000;$fatal(1,"watchdog");end
endmodule
