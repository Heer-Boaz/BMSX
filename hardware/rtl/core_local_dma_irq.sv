`timescale 1ns/1ps
// CORE's local mapped-device bus owns DMA channel banks and the IRQ words.
// All remaining local addresses pass to the other local-unit bus unchanged.
// Accepted register operations return exactly one response on the next clock.
// IRQ raise inputs are synchronous to clk; DMA completion raises bits 0/8.
// Active raises target the current bank; user raises target the retained user
// bank during supervisor service (the APU event owner uses this path). At an
// entry edge new raises belong to the departing user bank; at a leave edge
// new raises belong to the restored user bank. Existing supervisor pending
// flags are not merged into the user bank. ACK acts before concurrent raises.
// SYSTEM sequences the context boundary; CPU execution remains separate.
// LiteX's event manager similarly separates pending, clear and enable owners:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/interconnect/csr_eventmanager.py
module core_local_dma_irq (
    input wire clk, reset_n,
    input wire local_valid, local_write,
    input wire [31:0] local_address, local_wdata, local_access,
    input wire [3:0] local_be_n,
    input wire [7:0] local_bus_signals,
    output wire local_ready, local_rsp_valid,
    output wire [31:0] local_rdata, local_fault_code,
    output wire other_valid, other_write,
    output wire [31:0] other_address, other_wdata, other_access,
    output wire [3:0] other_be_n,
    output wire [7:0] other_bus_signals,
    input wire other_ready, other_rsp_valid,
    input wire [31:0] other_rdata, other_fault_code,
    output wire system_valid, system_write,
    output wire [31:0] system_address, system_wdata,
    input wire system_ready, system_rsp_valid,
    input wire [31:0] system_rdata, system_fault_code,
    input wire [31:0] external_irq_raise, user_irq_raise,
    output wire irq_line,
    input wire trigger_inhibit, admission_inhibit,
    input wire enter_supervisor, leave_supervisor,
    output wire supervisor_boundary_ready, local_boundary_ready,
    input wire [15:0] request_lines,
    input wire [31:0] port_address,
    output wire owns_read_port, owns_write_port,
    output wire block_active, active_channel,
    output wire [31:0] active_read_address, active_write_address,
    output wire transport_failed, transport_write_in_doubt,
    output wire req_valid, req_write, req_hold,
    input wire req_ready,
    output wire [31:0] req_address, req_wdata, req_access,
    output wire [2:0] req_size_bytes,
    output wire [3:0] req_be_n,
    output wire [7:0] req_bus_signals,
    output wire req_data_timeout_enable,
    output wire [17:0] req_data_wait_last,
    input wire rsp_valid, rsp_timeout,
    input wire [31:0] rsp_rdata
);
    wire irq_selected=local_address>=32'h08000000 && local_address<=32'h08000008;
    wire dma0_selected=local_address>=32'h0800000c && local_address<=32'h08000020;
    wire dma1_selected=local_address>=32'h080103e4 && local_address<=32'h080103f8;
    wire dma_selected=dma0_selected || dma1_selected;
    // SYSTEM time, print, control/status and fault words have their own owner.
    // Frame timing and other unit addresses remain on other_*.
    wire system_selected=(local_address==32'h08010228 || local_address==32'h08010230 || local_address==32'h08010234 ||
        local_address==32'h0801034c || local_address==32'h08010350 ||
        (local_address>=32'h08010428 && local_address<=32'h0801043c));
    wire owned=irq_selected || dma_selected;
    wire [31:0] dma_offset = local_address - (dma1_selected ? 32'h080103e4 : 32'h0800000c);
    wire [2:0] dma_index=dma_offset[4:2];
    wire dma_access_ready;
    wire [31:0] dma_access_rdata,dma_access_fault;
    wire [1:0] dma_irq_raise;
    wire accept_irq=local_valid && local_ready && irq_selected;
    reg own_rsp_valid,local_inflight;
    wire dma_boundary_ready;
    reg [31:0] own_rdata,own_fault,pending,mask,user_pending,user_mask;
    reg supervisor_active;
    wire [31:0] raises=external_irq_raise | {23'd0,dma_irq_raise[1],7'd0,dma_irq_raise[0]};
    wire context_exchange=enter_supervisor || leave_supervisor;
    wire ack=accept_irq && local_write && local_address==32'h08000004;
    assign irq_line=|(pending & mask);
    // LOCAL requests are serialized by CORE. A request may still be waiting
    // for endpoint readiness or an accepted request may await its response.
    // SYSTEM first stops new producer admission, then waits for both drains.
    assign local_boundary_ready=!local_valid && !local_inflight && !local_rsp_valid;
    assign supervisor_boundary_ready=dma_boundary_ready && local_boundary_ready;
    assign local_ready = owned ? (dma_selected ? dma_access_ready : !context_exchange) :
                         system_selected ? system_ready : other_ready;
    assign local_rsp_valid = own_rsp_valid || system_rsp_valid || other_rsp_valid;
    assign local_rdata = own_rsp_valid ? own_rdata : system_rsp_valid ? system_rdata : other_rdata;
    assign local_fault_code = own_rsp_valid ? own_fault : system_rsp_valid ? system_fault_code : other_fault_code;
    assign system_valid=local_valid && system_selected;
    assign system_write=local_write;
    assign system_address=local_address;
    assign system_wdata=local_wdata;
    assign other_valid=local_valid && !owned && !system_selected;
    assign other_write=local_write;
    assign other_address=local_address;
    assign other_wdata=local_wdata;
    assign other_access=local_access;
    assign other_be_n=local_be_n;
    assign other_bus_signals=local_bus_signals;
    dma_channel_controller dma (
        .clk(clk), .reset_n(reset_n), .access_valid(local_valid && dma_selected),
        .access_write(local_write), .access_channel(dma1_selected), .access_index(dma_index),
        .access_wdata(local_wdata), .access_ready(dma_access_ready),
        .access_rdata(dma_access_rdata), .access_fault(dma_access_fault),
        .trigger_inhibit(trigger_inhibit), .admission_inhibit(admission_inhibit),
        .enter_supervisor(enter_supervisor), .leave_supervisor(leave_supervisor),
        .supervisor_boundary_ready(dma_boundary_ready), .request_lines(request_lines), .irq_raise(dma_irq_raise),
        .block_active(block_active), .active_channel(active_channel),
        .active_read_address(active_read_address), .active_write_address(active_write_address),
        .port_address(port_address), .owns_read_port(owns_read_port), .owns_write_port(owns_write_port),
        .transport_failed(transport_failed), .transport_write_in_doubt(transport_write_in_doubt),
        .req_valid(req_valid), .req_write(req_write), .req_hold(req_hold), .req_ready(req_ready),
        .req_address(req_address), .req_wdata(req_wdata), .req_access(req_access),
        .req_size_bytes(req_size_bytes), .req_be_n(req_be_n), .req_bus_signals(req_bus_signals),
        .req_data_timeout_enable(req_data_timeout_enable), .req_data_wait_last(req_data_wait_last),
        .rsp_valid(rsp_valid), .rsp_timeout(rsp_timeout), .rsp_rdata(rsp_rdata)
    );
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            own_rsp_valid<=0;local_inflight<=0;own_rdata<=0;own_fault<=0;pending<=0;mask<=0;
            user_pending<=0;user_mask<=0;supervisor_active<=0;
        end else begin
            own_rsp_valid<=local_valid && local_ready && owned;
            if(local_valid && local_ready) local_inflight<=1;
            if(local_rsp_valid) local_inflight<=0;
            if(local_valid && local_ready && owned) begin
                own_rdata<=0;own_fault<=0;
                if(dma_selected) begin own_rdata<=dma_access_rdata;own_fault<=dma_access_fault;end
                else case(local_address)
                    32'h08000000: begin
                        own_rdata<=pending;
                        if(local_write) own_fault<=3;
                    end
                    32'h08000004: own_rdata<=0;
                    32'h08000008: own_rdata<=mask;
                endcase
            end
            if(enter_supervisor) begin
                // Context exchange serializes register accesses; all raises on
                // this edge join the departing user word before it is banked.
                user_pending<=pending | raises | user_irq_raise;
                user_mask<=mask;pending<=0;mask<=0;supervisor_active<=1;
            end else if(leave_supervisor) begin
                // Do not merge pre-existing supervisor pending bits. New events
                // sampled on this edge belong to the just-restored user bank.
                pending<=user_pending | raises | user_irq_raise;
                mask<=user_mask;user_pending<=0;user_mask<=0;supervisor_active<=0;
            end else begin
                pending <= (pending & ~(ack ? local_wdata : 32'd0)) | raises |
                    (supervisor_active ? 32'd0 : user_irq_raise);
                if(supervisor_active) user_pending<=user_pending | user_irq_raise;
                if(accept_irq && local_write && local_address==32'h08000008) mask<=local_wdata;
            end
        end
    end
endmodule
