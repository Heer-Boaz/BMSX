`timescale 1ns/1ps
// One physical CAD datapath, two independent request owners:
// port0 CORE requests and port1 the U4 SYS ROM-source endpoint. The bridge
// latches scalar address, byte width, data, strobes and socket on admission; the
// arbiter latches only the response owner. There is no speculative request FIFO.
// Rotate at whole-word boundaries. A cancelled active read releases its pins
// immediately, then two complete quiet clocks precede another admission.
// A cancelled write may already be committed by the card; no retry or rollback
// is implied. The requesting owner supplies the original scalar representation.
module cart_rom_arbiter (
    input wire clk, reset_n,
    input wire [1:0] req_valid, req_cancel,
    output reg [1:0] req_ready,
    input wire [63:0] req_address,
    input wire [1:0] req_write,
    input wire [5:0] req_size_bytes,
    input wire [63:0] req_wdata,
    input wire [15:0] req_bus_signals,
    input wire selected_socket,
    input wire [1:0] req_data_timeout_enable,
    input wire [35:0] req_data_wait_last,
    output reg [1:0] rsp_valid,
    output wire [63:0] rsp_data, rsp_fault_code,
    output wire [1:0] rsp_timeout,
    inout wire [15:0] cad,
    input wire [1:0] cart_ready_n, cart_present_n,
    output wire cal_lo, cal_hi, cart_clk, crd_n, cwr_n,
    output wire [1:0] cbe_n, cs_cart_n,
    output wire cart_dir, cart_oe_n
);
    localparam [1:0] FREE=0, ACTIVE=1, QUIET=2;
    reg [1:0] state;
    reg owner, next_owner, quiet_clock;
    wire [1:0] eligible = req_valid & ~req_cancel;
    wire choice = eligible[next_owner] ? next_owner : !next_owner;
    wire selected = |eligible;
    wire bridge_ready, bridge_rsp, bridge_timeout;
    wire [31:0] bridge_data, bridge_fault;
    wire bridge_cancel = state==ACTIVE && req_cancel[owner];
    wire bridge_valid = state==FREE && selected;
    assign rsp_data={2{bridge_data}};
    assign rsp_fault_code={2{bridge_fault}};
    assign rsp_timeout={2{bridge_timeout}};
    always @* begin
        req_ready=0;rsp_valid=0;
        if(reset_n && bridge_valid) req_ready[choice]=bridge_ready;
        if(reset_n && state==ACTIVE && !bridge_cancel) rsp_valid[owner]=bridge_rsp;
    end
    cart_rom_bridge bridge (
        .clk(clk),.reset_n(reset_n),.cancel(bridge_cancel),
        .req_valid(bridge_valid),.req_ready(bridge_ready),
        .req_address(req_address[choice*32 +:32]),.req_bus_signals(req_bus_signals[choice*8 +:8]),
        .req_write(req_write[choice]),.req_size_bytes(req_size_bytes[choice*3 +:3]),
        .req_wdata(req_wdata[choice*32 +:32]),
        .selected_socket(selected_socket),
        .req_data_timeout_enable(req_data_timeout_enable[choice]),
        .req_data_wait_last(req_data_wait_last[choice*18 +:18]),
        .rsp_valid(bridge_rsp),.rsp_data(bridge_data),.rsp_fault_code(bridge_fault),.rsp_timeout(bridge_timeout),
        .cad(cad),.cart_ready_n(cart_ready_n),.cart_present_n(cart_present_n),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.cart_clk(cart_clk),.crd_n(crd_n),.cwr_n(cwr_n),
        .cbe_n(cbe_n),.cs_cart_n(cs_cart_n),.cart_dir(cart_dir),.cart_oe_n(cart_oe_n)
    );
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin state<=FREE;owner<=0;next_owner<=0;quiet_clock<=0;end
        else case(state)
            FREE: if(bridge_valid && bridge_ready) begin
                owner<=choice;next_owner<=!choice;state<=ACTIVE;
            end
            ACTIVE: if(bridge_cancel) begin state<=QUIET;quiet_clock<=0;end
                else if(bridge_rsp) state<=FREE;
            QUIET: begin quiet_clock<=1;if(quiet_clock) state<=FREE;end
        endcase
    end
endmodule
