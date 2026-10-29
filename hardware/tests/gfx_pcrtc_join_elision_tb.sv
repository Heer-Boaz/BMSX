`timescale 1ns/1ps
// Explicitly retain the real join, lane pipelines and compositor while a
// deterministic word-response fixture supplies the requested CT32 samples.
// X is injected only into an unused lane, to check the digital control gate;
// this is not a physical SRAM, timing, or metastability qualification.
module gfx_pcrtc_join_elision_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,req_valid=0,rsp_ready=0;
 reg [31:0] pm=0,bg=32'h00123456,tag=0;reg in1=1,in2=1;
 wire req_ready,rsp_valid;wire [31:0] rsp_tag,rsp_rgba;wire [1:0] qv,qr,rv,rr;wire [37:0] qa;wire [11:0] qt;
 reg [1:0] rv_reg=0;reg [11:0] rt_reg=0;assign qr=2'b11;assign rv=rv_reg;
 gfx_pcrtc_join dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.req_tag(tag),
 .req_pmode(pm),.req_bgcolor(bg),.req_c1_inside(in1),.req_c2_inside(in2),.req_c1_dispfb(32'd0),.req_c1_x(32'd0),.req_c1_y(32'd0),
 .req_c2_dispfb(32'd0),.req_c2_x(32'd0),.req_c2_y(32'd0),.mem_req_valid(qv),.mem_req_ready(qr),.mem_req_address(qa),.mem_req_tag(qt),
 .mem_rsp_valid(rv),.mem_rsp_ready(rr),.mem_rsp_data({2{32'h44ff00ff}}),.mem_rsp_tag(rt_reg),.rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_tag(rsp_tag),.rsp_rgba(rsp_rgba));
 integer cnt0=0,cnt1=0;
 always @(posedge clk)begin rv_reg<=qv&qr;rt_reg<=qt;if(qv[0]&&qr[0])cnt0=cnt0+1;if(qv[1]&&qr[1])cnt1=cnt1+1;end
 task automatic one(input [31:0] p,input bit w1,input bit w2,input [31:0] expected,input integer rd0,input integer rd1);
 integer a,b;begin a=cnt0;b=cnt1;@(negedge clk);while(!req_ready)@(negedge clk);pm=p;in1=w1;in2=w2;req_valid=1;tag=tag+1;
 @(negedge clk);req_valid=0;while(!rsp_valid)@(negedge clk);
 if(rsp_rgba!==expected||rsp_tag!==tag)$fatal(1,"pm %h output %h expected %h",p,rsp_rgba,expected);
 repeat(2)@(negedge clk);if(!rsp_valid||rsp_rgba!==expected)$fatal(1,"stall");
 if(cnt0-a!=rd0||cnt1-b!=rd1)$fatal(1,"pm %h reads %0d/%0d expected %0d/%0d",p,cnt0-a,cnt1-b,rd0,rd1);
 rsp_ready=1;@(negedge clk);rsp_ready=0;end endtask
 initial begin repeat(2)@(negedge clk);reset_n=1;repeat(2)@(negedge clk);
 if(!$isunknown(dut.lane1_rgba))$fatal(1,"fresh lane data unexpectedly initialized");
 one(32'h61,1,1,32'h00123456,0,0);
 force dut.lane1_rgba=32'hxxxxxxxx;
 one(32'h63,1,1,32'h44ff00ff,0,1);
 one(32'he3,1,1,32'h44123456,0,1);
 one(32'h61,1,0,32'h00123456,0,0);
 release dut.lane1_rgba;
 one(32'h21,1,0,32'h44123456,1,0);
 one(32'h161,1,0,32'h00133457,1,0);
 $display("PASS alpha=0/AMOD=1 elides source with X/stale c1, c2 RGB/alpha retained, output stalls; AMOD=0 and ALP=1 still fetch");$finish;end
 initial begin #100000;$fatal(1,"timeout");end
endmodule
