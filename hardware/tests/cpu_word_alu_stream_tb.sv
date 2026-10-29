`timescale 1ns/1ps
// Continuous independent-vector feed with output stalls and simultaneous
// retirement/admission; no CPU register or physical timing claim.
module cpu_word_alu_stream_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,req_valid=0,rsp_ready=0;
 reg [5:0] ops=0;reg [13:0] dest=0;reg [63:0] left=0,right=0;
 wire req_ready,rsp_valid;wire [13:0] out_dest;wire [63:0] out;
 cpu_word_alu dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.req_operations(ops),.req_destination(dest),
  .req_left_number(left),.req_right_number(right),.rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_destination(out_dest),.rsp_number(out));
 reg [5:0] vops[0:32767];reg [13:0] vdest[0:32767];reg [63:0] vl[0:32767],vr[0:32767],expected_number[0:32767];
 integer f,count,n,rc,opword,destword,sent=0,seen=0,cycles=0,stalls=0,simultaneous=0;
 reg holding=0;reg [13:0] held_dest;reg [63:0] held_out;
 initial begin
  f=$fopen("build/tests/cpu-word-alu-vectors.txt","r");if(!f)$fatal(1,"vectors");rc=$fscanf(f,"%d\n",count);
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h %h\n",opword,destword,vl[n],vr[n],expected_number[n]);if(rc!=5)$fatal(1,"bad vector %0d",n);
   vops[n]=opword;vdest[n]=destword;
  end
  repeat(2)@(negedge clk);reset_n=1;
  while(seen<count)begin
   @(negedge clk);rsp_ready=(cycles%7)!=0;
   req_valid=sent<count && (cycles%5)!=0;
   if(req_valid)begin ops=vops[sent];dest=vdest[sent];left=vl[sent];right=vr[sent];end
  end
  if(!stalls||!simultaneous)$fatal(1,"missing stream coverage");
  $display("PASS %0d continuous word-ALU cases, %0d stalls, %0d simultaneous retire/admit",count,stalls,simultaneous);$finish;
 end
 always @(posedge clk)if(reset_n)begin
  cycles=cycles+1;
  if(holding && (!rsp_valid||out_dest!==held_dest||out!==held_out))$fatal(1,"response changed during stall");
  holding=rsp_valid&&!rsp_ready;held_dest=out_dest;held_out=out;
  if(rsp_valid&&!rsp_ready)stalls=stalls+1;
  if(req_valid&&req_ready&&rsp_valid&&rsp_ready)simultaneous=simultaneous+1;
  if(rsp_valid&&rsp_ready)begin if(seen>=count||out_dest!==vdest[seen]||out!==expected_number[seen])$fatal(1,"out of order or wrong sample %0d",seen);seen=seen+1;end
  if(req_valid&&req_ready)sent=sent+1;
 end
 initial begin #100000000;$fatal(1,"timeout");end
endmodule
