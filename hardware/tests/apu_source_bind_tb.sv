`timescale 1ns/1ps
module apu_source_bind_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,valid=0,cart=0,rsp_ready=0,ext_ready=0,ext_rsp_valid=0,ext_ok=0,commit=0;
 reg [671:0] p=0;wire ready,rsp_valid,rsp_ok,ext_valid,ext_cart,ext_rsp_ready,commit_ready,pub_valid,pub_cart;
 wire [671:0] ext_p,pub_p;wire [1:0] ext_region,pub_region;
 apu_source_bind dut(.clk(clk),.reset_n(reset_n),.bind_valid(valid),.bind_ready(ready),.bind_parameters(p),.bind_cartridge(cart),
 .bind_rsp_valid(rsp_valid),.bind_rsp_ready(rsp_ready),.bind_rsp_ok(rsp_ok),.external_valid(ext_valid),.external_ready(ext_ready),
 .external_parameters(ext_p),.external_cartridge(ext_cart),.external_region(ext_region),.external_rsp_valid(ext_rsp_valid),
 .external_rsp_ready(ext_rsp_ready),.external_rsp_ok(ext_ok),.commit_ready(commit_ready),.commit_valid(commit),
 .published_valid(pub_valid),.published_parameters(pub_p),.published_cartridge(pub_cart),.published_region(pub_region));
 task automatic request(input [31:0] addr,input [31:0] len,input bit socket);
  begin @(negedge clk);p=0;p[0+:32]=addr;p[32+:32]=len;p[3*32+:32]=32'hdeadbeef;cart=socket;valid=1;
   do @(posedge clk);while(!ready); @(negedge clk);valid=0;end
 endtask
 task automatic result(input bit expected);
  begin wait(rsp_valid);@(negedge clk);if(rsp_ok!==expected || pub_valid || commit_ready) $fatal(1,"bad bind result");
   rsp_ready=1;@(negedge clk);rsp_ready=0;end
 endtask
 task automatic publish(input [31:0] addr,input [31:0] len,input bit socket,input [1:0] region);
  begin if(!commit_ready || pub_valid || pub_p[0+:32]!==addr || pub_p[32+:32]!==len || pub_p[3*32+:32]!==32'hdeadbeef || pub_cart!==socket || pub_region!==region)
   $fatal(1,"bad held descriptor");
   repeat(3)begin @(negedge clk);if(!commit_ready || ready || pub_valid)$fatal(1,"commit retention");end
   commit=1;#1;if(!pub_valid)$fatal(1,"commit strobe");@(negedge clk);commit=0;end
 endtask
 task automatic failed(input [31:0] addr,input [31:0] len);
  begin request(addr,len,0);result(0);if(!ready || ext_valid || pub_valid)$fatal(1,"failed bind leaked");end
 endtask
 initial begin
  repeat(3)@(negedge clk);reset_n=1;
  request(32'h4007ffff,1,1);result(1);publish(32'h4007ffff,1,1,0);
  request(32'h40000000,32'h80000,0);result(1);publish(32'h40000000,32'h80000,0,0);
  failed(32'h40000000,0);failed(32'h4007ffff,2);failed(32'h40080000,1);
  failed(32'hffffffff,2);failed(32'h0fffffff,1);failed(32'h2fffffff,2);
  // ROM policy is external; hold the full descriptor while it stalls and
  // propagate its decision without inferring capacity from returned bytes.
  request(32'h10000123,32'h8765,1);
  repeat(3)begin @(negedge clk);if(!ext_valid || ext_p[0+:32]!==32'h10000123 || ext_p[32+:32]!==32'h8765 || !ext_cart || ext_region!==2)$fatal(1,"external retention");end
  ext_ready=1;@(negedge clk);ext_ready=0;repeat(2)@(negedge clk);
  if(!ext_rsp_ready || rsp_valid)$fatal(1,"external wait");
  ext_rsp_valid=1;ext_ok=1;@(negedge clk);ext_rsp_valid=0;result(1);publish(32'h10000123,32'h8765,1,2);
  // Same-edge external decision is accepted, including a rejected ROM bind.
  request(32'h00fffffe,2,0);wait(ext_valid);@(negedge clk);ext_ready=1;ext_rsp_valid=1;ext_ok=0;
  @(negedge clk);ext_ready=0;ext_rsp_valid=0;result(0);
  // Reset drops local uncommitted data and the untagged external owner must
  // share reset/cancel/drain; this test intentionally removes its response.
  request(32'h10000000,16,0);wait(ext_valid);@(negedge clk);ext_ready=1;@(negedge clk);ext_ready=0;
  reset_n=0;@(negedge clk);reset_n=1;@(negedge clk);
  if(!ready || commit_ready || rsp_valid || pub_valid)$fatal(1,"reset cancellation");
  $display("PASS APU real sample-RAM bind, range edges, full metadata, external ROM delegation, reply/commit retention and shared reset");$finish;
 end
 initial begin #20000;$fatal(1,"timeout");end
endmodule
