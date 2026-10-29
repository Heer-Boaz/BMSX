`timescale 1ns/1ps
// Characterizes actual shared SRAM service ordering; not an assertion that
// scanout pixels must use either side of an unspecified write/sample race.
// The first scan result is held while a renderer write to its word completes;
// the second queued scan and renderer write enter on the same edge, in a
// renderer window that services the write before that scan request is issued.
module gfx_pcrtc_visibility_tb;
 reg clk=0;always #9.259259 clk=~clk;
 reg power_reset_n=0,reset_n=0,quiesce=0;
 reg [1:0] scan_req_valid=0,scan_rsp_ready=0;
 wire [1:0] scan_req_ready,scan_rsp_valid;
 reg [37:0] scan_req_address=0;reg [15:0] scan_req_tag=0;
 wire [63:0] scan_rsp_data;wire [15:0] scan_rsp_tag;
 reg render_req_valid=0,render_req_write=1,render_rsp_ready=1;
 reg [18:0] render_req_address=0;reg [31:0] render_req_wdata=0;reg [3:0] render_req_be_n=0;reg [7:0] render_req_tag=0;
 wire render_req_ready,render_rsp_valid,render_rsp_write;wire [31:0] render_rsp_data;wire [7:0] render_rsp_tag;
 tri [31:0] mem_data;wire [18:0] mem_address;wire mem_ce_n,mem_oe_n,mem_we_n;wire [3:0] mem_be_n;
 gfx_memory_scheduler #(.TAG_WIDTH(8)) dut(.clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),.quiesce(quiesce),.quiescent(),
 .scan_req_valid(scan_req_valid),.scan_req_ready(scan_req_ready),.scan_req_address(scan_req_address),.scan_req_tag(scan_req_tag),
 .scan_rsp_valid(scan_rsp_valid),.scan_rsp_ready(scan_rsp_ready),.scan_rsp_data(scan_rsp_data),.scan_rsp_tag(scan_rsp_tag),
 .render_req_valid(render_req_valid),.render_req_ready(render_req_ready),.render_req_write(render_req_write),.render_req_address(render_req_address),.render_req_wdata(render_req_wdata),.render_req_be_n(render_req_be_n),.render_req_tag(render_req_tag),
 .render_rsp_valid(render_rsp_valid),.render_rsp_ready(render_rsp_ready),.render_rsp_write(render_rsp_write),.render_rsp_data(render_rsp_data),.render_rsp_tag(render_rsp_tag),
 .mem_data(mem_data),.mem_address(mem_address),.mem_ce_n(mem_ce_n),.mem_oe_n(mem_oe_n),.mem_we_n(mem_we_n),.mem_be_n(mem_be_n));
 genvar c;generate for(c=0;c<2;c=c+1) begin:part
 issi_bll_pin_model #(.ADDRESS_WIDTH(19),.PATTERN(c==0?16'h5a5a:16'ha5a5)) ram(.address(mem_address),.data(mem_data[c*16+:16]),.ce_n(mem_ce_n),.oe_n(mem_oe_n),.we_n(mem_we_n),.be_n(mem_be_n[c*2+:2]),.drive_active());end endgenerate
 reg [31:0] old;
 initial begin
  repeat(3)@(negedge clk);power_reset_n=1;reset_n=1;repeat(5)@(negedge clk);
  scan_req_address[18:0]=42;scan_req_tag[7:0]=8'h21;scan_req_valid[0]=1;
  do @(posedge clk); while(!scan_req_ready[0]);@(negedge clk);scan_req_valid[0]=0;
  wait(scan_rsp_valid[0]);@(negedge clk);old=scan_rsp_data[31:0];
  if(old!==32'ha58f5a70)$fatal(1,"unexpected initial %h",old);
  render_req_address=42;render_req_wdata=32'h12345678;render_req_valid=1;
  do @(posedge clk); while(!render_req_ready);@(negedge clk);render_req_valid=0;
  wait(render_rsp_valid);@(negedge clk);
  if(!scan_rsp_valid[0]||scan_rsp_data[31:0]!==old)$fatal(1,"buffer changed with writer");
  scan_req_tag[7:0]=8'h22;scan_req_valid[0]=1;
  do @(posedge clk); while(!scan_req_ready[0]);@(negedge clk);scan_req_valid[0]=0;
  scan_rsp_ready[0]=1;@(posedge clk);@(negedge clk);scan_rsp_ready[0]=0;
  wait(scan_rsp_valid[0]);@(negedge clk);
  if(scan_rsp_data[31:0]!==32'h12345678 || scan_rsp_tag[7:0]!==8'h22)$fatal(1,"later read %h tag %h",scan_rsp_data[31:0],scan_rsp_tag[7:0]);
  $display("PASS same address: held earlier scan result %h, completed renderer write and later scan result %h",old,scan_rsp_data[31:0]);
  scan_rsp_ready[0]=1;@(posedge clk);@(negedge clk);scan_rsp_ready[0]=0;
  while(dut.slot!=49 || !render_req_ready || !scan_req_ready[0]) @(negedge clk);
  scan_req_address[18:0]=43;scan_req_tag[7:0]=8'h23;scan_req_valid[0]=1;
  render_req_address=43;render_req_wdata=32'h89abcdef;render_req_tag=8'h33;render_req_valid=1;
  @(posedge clk);if(!scan_req_ready[0] || !render_req_ready)$fatal(1,"concurrent acceptance failed");
  @(negedge clk);scan_req_valid[0]=0;render_req_valid=0;
  wait(scan_rsp_valid[0]);@(negedge clk);
  if(scan_rsp_data[31:0]!==32'h89abcdef || scan_rsp_tag[7:0]!==8'h23)$fatal(1,"queued read returned %h",scan_rsp_data[31:0]);
  $display("PASS same-edge queue acceptance, renderer issue before queued SRAM read -> %h",scan_rsp_data[31:0]);$finish;
 end
 initial begin #100000;$fatal(1,"timeout");end
endmodule
