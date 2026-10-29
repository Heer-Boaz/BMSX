`timescale 1ns/1ps
// Explicitly model the live register bank that accepts context load words.
// This fixture exercises the context storage and boundary contract; actual
// DMA datapath and shared IRQ-bank integration are tested at their owners.
module dma_supervisor_context_tb;
    reg clk=0; always #5 clk=!clk;
    reg reset_n=0, control_quiesce=0, block_quiesce=0;
    reg block_active=0,completion_pending=0,enter_context=0,leave_context=0;
    wire trigger_inhibit,admission_inhibit,boundary_ready,load_live;
    reg [63:0] live_read_address=0,live_write_address=0,live_count=0,live_control=0,live_status=0;
    reg live_next_channel=0;
    wire [63:0] load_read_address,load_write_address,load_count,load_control,load_status;
    wire load_next_channel;
    dma_supervisor_context dut(.*);
    always @(posedge clk) if(load_live) begin
        live_read_address<=load_read_address;live_write_address<=load_write_address;
        live_count<=load_count;live_control<=load_control;live_status<=load_status;
        live_next_channel<=load_next_channel;
    end
    initial begin
        repeat(2) @(negedge clk);reset_n=1;
        live_read_address=64'h00200020_00100010;live_write_address=64'h00400040_00300030;
        live_count=64'h00000009_00000003;live_control=64'hffff3c03_abc00841;
        live_status=64'h00000001_00000001;live_next_channel=1;
        // Producer quiescence closes new START but permits already BUSY
        // channels to continue and retains normal block admission.
        control_quiesce=1;block_active=1;#1;
        if(!trigger_inhibit || admission_inhibit || boundary_ready) $fatal(1,"producer gate");
        // Block quiescence closes new admission; existing work may finish.
        block_quiesce=1;#1;if(!admission_inhibit || boundary_ready) $fatal(1,"active block gate");
        block_active=0;completion_pending=1;#1;
        if(boundary_ready) $fatal(1,"pending IRQ published into wrong context");
        completion_pending=0;#1;if(!boundary_ready) $fatal(1,"BUSY waiting channel blocked boundary");
        // At the SYSTEM-supplied enter edge the bank captures both channels
        // and turn, and loads a clean supervisor register file atomically.
        @(negedge clk);enter_context=1;@(negedge clk);enter_context=0;#1;
        if({live_read_address,live_write_address,live_count,live_control,live_status,live_next_channel}!==321'd0)
            $fatal(1,"supervisor live state not cleared");
        control_quiesce=0;block_quiesce=0;#1;
        if(trigger_inhibit || admission_inhibit || boundary_ready) $fatal(1,"supervisor gates not released");
        // Supervisor programs completely different words and turn. None of
        // these changes may leak into the retained cartridge bank.
        live_read_address=64'h11111111_22222222;live_write_address=64'h33333333_44444444;
        live_count=64'h00000000_00000005;live_control=64'hfeedface_12345678;
        live_status=64'h00000002_00000001;live_next_channel=0;
        control_quiesce=1;block_quiesce=1;block_active=0;completion_pending=0;#1;
        if(!boundary_ready) $fatal(1,"leave boundary");
        @(negedge clk);leave_context=1;@(negedge clk);leave_context=0;#1;
        if(live_read_address!==64'h00200020_00100010 || live_write_address!==64'h00400040_00300030 ||
           live_count!==64'h00000009_00000003 || live_control!==64'hffff3c03_abc00841 ||
           live_status!==64'h00000001_00000001 || live_next_channel!==1)
            $fatal(1,"cartridge context or arbitration turn not restored");
        $display("PASS DMA supervisor retained 10 words and arbitration turn, two gates and drained IRQ boundary");$finish;
    end
endmodule
