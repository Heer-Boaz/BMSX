`timescale 1ns/1ps
module cpu_word_alu_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,req_valid=0,rsp_ready=0;
 reg [5:0] ops=0;reg [13:0] dest=0;reg [63:0] left=0,right=0;
 wire req_ready,rsp_valid;wire [13:0] result_dest;wire [63:0] result;
 cpu_word_alu dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
 .req_operations(ops),.req_destination(dest),.req_left_number(left),.req_right_number(right),
 .rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_destination(result_dest),.rsp_number(result));
 integer f,count,n,rc,i;reg [31:0] opword,destword;reg [63:0] expected;reg [5:0] coverage=0;
 initial begin
  f=$fopen("build/tests/cpu-word-alu-vectors.txt","r");if(!f)$fatal(1,"missing vectors");
  rc=$fscanf(f,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h %h\n",opword,destword,left,right,expected);if(rc!=5)$fatal(1,"vector %0d",n);
   ops=opword;dest=destword;coverage=coverage|ops;
   @(negedge clk);while(!req_ready)@(negedge clk);req_valid=1;
   @(negedge clk);req_valid=0;
   if(!rsp_valid||result_dest!==dest||result!==expected)$fatal(1,"case %0d ops=%h left=%h right=%h got %h expected %h",n,ops,left,right,result,expected);
   for(i=0;i<(n&3);i=i+1)begin @(negedge clk);if(!rsp_valid||result_dest!==dest||result!==expected)$fatal(1,"stall %0d",n);end
   rsp_ready=1;@(negedge clk);rsp_ready=0;
  end
  if(coverage!==6'h3f)$fatal(1,"operation coverage");
  $display("PASS %0d binary64 word-ALU cases vs JS/C++ CPU numeric owner, all 6 operations and output stalls",count);$finish;
 end
 initial begin #100000000;$fatal(1,"timeout");end
endmodule
