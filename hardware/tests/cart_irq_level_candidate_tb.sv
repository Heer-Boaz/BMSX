`timescale 1ns/1ps
// Proposed held-level cartridge interface through the actual CORE IRQ bank.
// Ideal digital clock-edge tests, not a qualified pad/CDC timing guarantee.
module cart_irq_level_candidate_tb;
 reg clk=0; always #14.76285 clk=!clk;
 reg reset_n=0; reg [1:0] irq_cart_n=3;
 wire [31:0] irq_raise; wire [15:0] dma_requests=0;
 reg enter_supervisor=0,leave_supervisor=0; wire irq_line;
 reg local_valid=0,local_write=0;reg [31:0] local_address=0,local_wdata=0;
 wire local_ready,local_rsp_valid;wire [31:0] local_rdata,local_fault_code;
 cart_irq_level_candidate pins(.clk(clk),.reset_n(reset_n),.irq_cart_n(irq_cart_n),.irq_raise(irq_raise));
 core_local_dma_irq unit(.clk(clk),.reset_n(reset_n),.local_valid(local_valid),.local_write(local_write),
   .local_address(local_address),.local_wdata(local_wdata),.local_access(32'd0),.local_be_n(4'd0),.local_bus_signals(8'd0),
   .local_ready(local_ready),.local_rsp_valid(local_rsp_valid),.local_rdata(local_rdata),.local_fault_code(local_fault_code),
   .other_valid(),.other_write(),.other_address(),.other_wdata(),.other_access(),.other_be_n(),.other_bus_signals(),
   .other_ready(1'b0),.other_rsp_valid(1'b0),.other_rdata(32'd0),.other_fault_code(32'd0),
   .system_valid(),.system_write(),.system_address(),.system_wdata(),.system_ready(1'b0),.system_rsp_valid(1'b0),
   .system_rdata(32'd0),.system_fault_code(32'd0),.external_irq_raise(irq_raise),.user_irq_raise(32'd0),.irq_line(irq_line),
   .trigger_inhibit(1'b0),.admission_inhibit(1'b1),.enter_supervisor(enter_supervisor),.leave_supervisor(leave_supervisor),
   .supervisor_boundary_ready(),.local_boundary_ready(),.request_lines(dma_requests),.port_address(32'd0),
   .owns_read_port(),.owns_write_port(),.block_active(),.active_channel(),.active_read_address(),.active_write_address(),
   .transport_failed(),.transport_write_in_doubt(),.req_valid(),.req_write(),.req_hold(),.req_ready(1'b0),
   .req_address(),.req_wdata(),.req_access(),.req_size_bytes(),.req_be_n(),.req_bus_signals(),
   .req_data_timeout_enable(),.req_data_wait_last(),.rsp_valid(1'b0),.rsp_timeout(1'b0),.rsp_rdata(32'd0));

 initial begin #100000; $fatal(1,"watchdog"); end
 task automatic access(input bit write,input [31:0] address,input [31:0] data,output [31:0] result);
  begin
   @(negedge clk);local_valid=1;local_write=write;local_address=address;local_wdata=data;
   do @(posedge clk);while(!local_ready);
   @(negedge clk);local_valid=0;local_write=0;
   while(!local_rsp_valid) @(negedge clk);
   if(local_fault_code!==0) $fatal(1,"unexpected IRQ access fault");
   result=local_rdata;
  end
 endtask
 reg [31:0] result;
 initial begin
  repeat(3) @(negedge clk); reset_n=1;
  // A held source sets pending irrespective of MASK. ACK while the level is
  // active is overridden by the continuing set; MASK controls delivery only.
  irq_cart_n[0]=0;repeat(5) @(negedge clk);
  access(0,32'h08000000,0,result);
  if(result!==32'h200 || irq_line!==0) $fatal(1,"masked held source");
  access(1,32'h08000008,32'h200,result);
  if(irq_line!==1) $fatal(1,"mask did not enable delivery");
  access(1,32'h08000004,32'h200,result);
  access(0,32'h08000000,0,result);
  if(result!==32'h200 || irq_line!==1) $fatal(1,"held source cleared by ACK");
  // The card's local ACK first releases its output. Wait for the synchronizer
  // to observe release, then central ACK removes the retained pending bit.
  @(negedge clk);irq_cart_n[0]=1;repeat(4) @(negedge clk);
  access(1,32'h08000004,32'h200,result);
  access(0,32'h08000000,0,result);
  if(result!==0 || irq_line!==0) $fatal(1,"local then central ACK did not clear");
  // Each socket has independent synchronizers and pending bits.
  irq_cart_n=0;repeat(5) @(negedge clk);
  access(0,32'h08000000,0,result);if(result!==32'h600) $fatal(1,"slot independence");
  irq_cart_n=3;repeat(4) @(negedge clk);
  access(1,32'h08000004,32'h600,result);
  // A level held across a context switch also sets the supervisor bank. This
  // explicitly observes the current CORE bank ownership; it is a design
  // consequence, not an approved BMSX product contract.
  irq_cart_n[0]=0;repeat(5) @(negedge clk);
  @(negedge clk);enter_supervisor=1;@(negedge clk);enter_supervisor=0;
  repeat(3) @(negedge clk);
  access(0,32'h08000000,0,result);if(result!==32'h200) $fatal(1,"supervisor level");
  irq_cart_n[0]=1;repeat(4) @(negedge clk);
  access(1,32'h08000004,32'h200,result);
  @(negedge clk);leave_supervisor=1;@(negedge clk);leave_supervisor=0;
  access(0,32'h08000000,0,result);if(result!==32'h200) $fatal(1,"saved user pending");
  access(1,32'h08000004,32'h200,result);
  // Negative digital witness: a pulse entirely between samples is not latched.
  @(negedge clk);#1;irq_cart_n[0]=0;#3;irq_cart_n[0]=1;
  repeat(6) @(negedge clk);
  access(0,32'h08000000,0,result);if(result!==0) $fatal(1,"short-pulse witness");
  // A level already asserted through reset is sampled after release.
  @(negedge clk);reset_n=0;irq_cart_n[1]=0;repeat(3) @(negedge clk);
  reset_n=1;repeat(5) @(negedge clk);
  access(0,32'h08000000,0,result);if(result!==32'h400) $fatal(1,"held source across reset");
  $display("PASS held-level IRQ candidate through CORE: mask, local/central ACK, two slots, context, short-pulse loss and reset");
  $finish;
 end
endmodule
