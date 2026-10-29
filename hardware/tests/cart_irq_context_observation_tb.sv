`timescale 1ns/1ps
// Physical cartridge pins -> candidate capture -> real central IRQ bank. The
// contract cases exercise local/central latches, banking, independent sockets,
// held-low ACK and reset. The transition trace only records the chosen arrival
// ordering; Book I/III do not assign a pin-to-bank synchronization deadline.
module cart_irq_context_observation_tb;
 reg clk=0;always #14.76285 clk=!clk;
 reg reset_n=0;reg [1:0] irq_cart_n=3,dreq_read=0,dreq_write=0;
 wire [31:0] irq_raise;wire [15:0] dma_requests;
 reg local_valid=0,local_write=0,enter_supervisor=0,leave_supervisor=0;
 reg [31:0] local_address=0,local_wdata=0;
 wire local_ready,local_rsp_valid,irq_line;wire [31:0] local_rdata,local_fault_code;
 cart_pin_events pins(.clk(clk),.reset_n(reset_n),.irq_cart_n(irq_cart_n),.dreq_read(dreq_read),.dreq_write(dreq_write),.irq_raise(irq_raise),.dma_requests(dma_requests));
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
 integer which=0; reg [31:0] user_flags, supervisor_flags;
 initial begin #100000;$fatal(1,"watchdog");end
 task automatic bus_access(input bit write_access,input [31:0] address,data, output [31:0] result);
  begin
   @(negedge clk);local_valid=1;local_write=write_access;local_address=address;local_wdata=data;
   do @(posedge clk);while(!local_ready);
   @(negedge clk);local_valid=0;local_write=0;
   while(!local_rsp_valid) @(negedge clk);
   if(local_fault_code!==0) $fatal(1,"unexpected IRQ register fault");
   result=local_rdata;
  end
 endtask
 task automatic flags(input [31:0] expected);
  reg [31:0] actual;
  begin bus_access(0,32'h08000000,0,actual);if(actual!==expected) $fatal(1,"FLAGS got %h expected %h",actual,expected);end
 endtask
 task automatic ack(input [31:0] bits);
  reg [31:0] ignored;
  begin bus_access(1,32'h08000004,bits,ignored);end
 endtask
 task automatic enter_bank;
  begin @(negedge clk);enter_supervisor=1;@(negedge clk);enter_supervisor=0;end
 endtask
 task automatic leave_bank;
  begin @(negedge clk);leave_supervisor=1;@(negedge clk);leave_supervisor=0;end
 endtask
 initial begin
  if(!$value$plusargs("CASE=%d",which)) which=0;
  if(which==0) begin
   // A source already held low across reset is observed once. Clearing central
   // FLAGS must not reassert it while the same pin remains low.
   irq_cart_n=2'b10;repeat(3) @(negedge clk);reset_n=1;repeat(9) @(negedge clk);
   flags(32'h200);ack(32'h200);repeat(12) @(negedge clk);flags(0);
   $display("PASS IRQ pin low across reset, central ACK while still low, no spurious replay");
  end else if(which==1) begin
   repeat(3) @(negedge clk);reset_n=1;@(negedge clk);irq_cart_n[0]=0;repeat(9) @(negedge clk);
   flags(32'h200);enter_bank();flags(0);
   @(negedge clk);irq_cart_n[1]=0;repeat(9) @(negedge clk);flags(32'h400);
   ack(32'h400);repeat(10) @(negedge clk);flags(0);
   leave_bank();flags(32'h200);
   repeat(10) @(negedge clk);flags(32'h200);
   $display("PASS IRQ independent socket banking, supervisor ACK while held low, user pending restoration");
  end else begin
   repeat(3) @(negedge clk);reset_n=1;
   // The physical input becomes low in the half-cycle before the BANK entry
   // edge. The candidate's capture is asynchronous but its output is delayed
   // through synchronizers. Observe both banks; this is not a claim that Book I
   // requires the physical pin edge rather than the synchronized delivery edge.
   @(negedge clk);irq_cart_n[0]=0;enter_supervisor=1;
   @(negedge clk);enter_supervisor=0;repeat(9) @(negedge clk);
   bus_access(0,32'h08000000,0,supervisor_flags);
   leave_bank();bus_access(0,32'h08000000,0,user_flags);
   $display("OBSERVE input-before-ENTER synchronized-after-ENTER: supervisor=%h retained-user=%h",supervisor_flags,user_flags);
  end
  $finish;
 end
endmodule
