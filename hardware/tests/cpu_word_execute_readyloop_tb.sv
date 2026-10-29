`timescale 1ns/1ps
// A stateless value owner accepts a request only when its corresponding
// combinational numeric result can be consumed. Its valid and payload follow
// the stable request; request and response are transferred on the same edge.
module cpu_word_execute_readyloop_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,req_valid=0,write_ready=0;reg [5:0] op=0;reg [13:0] dst=0;reg [14:0] b=0;reg [31:0] rkb=0,rkc=0;
 wire req_ready,select,read_valid,read_constant,rsp_ready,write_valid;wire [14:0] index;wire [13:0] widx;wire [63:0] number;
 wire read_ready=rsp_ready;wire rsp_valid=read_valid;
 wire [63:0] rsp_number=read_constant ? 64'h4014000000000000 : 64'h4008000000000000; // 5 or 3
 cpu_word_execute dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.select(select),
  .req_opcode(op),.req_a(dst),.req_b(b),.req_rkb(rkb),.req_rkc(rkc),.read_valid(read_valid),.read_ready(read_ready),
  .read_constant(read_constant),.read_index(index),.read_rsp_valid(rsp_valid),.read_rsp_ready(rsp_ready),.read_rsp_number(rsp_number),
  .write_valid(write_valid),.write_ready(write_ready),.write_index(widx),.write_number(number));
 integer reads=0;reg unary=0;
 always @(posedge clk)if(reset_n && read_valid && read_ready)begin
  if(!rsp_ready||!rsp_valid)$fatal(1,"response missing at request handshake");
  if(unary)begin
   if(reads!=0 || read_constant || index!=15'd32767)$fatal(1,"BNOT must read R[32767]");
  end else if(reads==0)begin
   if(!read_constant || index!=15'd16383)$fatal(1,"left must read K[16383]");
  end else if(reads==1)begin
   if(read_constant || index!=15'd16383)$fatal(1,"right must read R[16383]");
  end else $fatal(1,"extra read");
  reads=reads+1;
 end
 task automatic run(input bit inv);
  integer i;reg [63:0] expected;
  begin
   unary=inv;reads=0;op=inv?6'd34:6'd24;dst=inv?14'd123:14'd456;b=15'd32767;rkb=32'hffffc000;rkc=32'd16383;
   expected=inv?64'hc010000000000000:64'h3ff0000000000000; // ~3=-4 or 5&3=1
   @(negedge clk);while(!req_ready)@(negedge clk);req_valid=1;@(negedge clk);req_valid=0;
   while(!write_valid)@(negedge clk);
   if(reads!=(inv?1:2) || widx!==dst || number!==expected)$fatal(1,"write mismatch");
   for(i=0;i<3;i=i+1)begin @(negedge clk);if(!write_valid||widx!==dst||number!==expected)$fatal(1,"write lost under stall");end
   write_ready=1;@(negedge clk);write_ready=0;
  end
 endtask
 initial begin repeat(2)@(negedge clk);reset_n=1;run(0);run(1);
  $display("PASS stateless ready-dependent owner, same-edge B/C and BNOT numeric reads, stable writeback during stalls");$finish;
 end
 initial begin #10000;$fatal(1,"ready loop or timeout");end
endmodule
