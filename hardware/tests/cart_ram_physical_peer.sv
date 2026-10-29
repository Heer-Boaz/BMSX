`timescale 1ns/1ps
// Minimal RAM-only test card: CAD metadata and data strobes drive the actual
// cartridge SRAM commit owner, not a behavioral byte array. Other card regions,
// MMIO, ROM and mixed-card decoding are intentionally outside this test peer.
module cart_ram_physical_peer #(
    parameter integer ADDRESS_WIDTH=4,
    parameter [32:0] CAPACITY_BYTES=13
)(
    input wire clk,power_reset_n,reset_n,cs_n,cal_lo,cal_hi,rd_n,wr_n,
    input wire [1:0] be_n,
    inout wire [15:0] cad,
    output wire ready_n,init_done,busy,
    inout wire [15:0] mem_data,
    output wire [ADDRESS_WIDTH-1:0] mem_address,
    output wire mem_ce_n,mem_oe_n,mem_we_n,
    output wire [1:0] mem_be_n
);
    reg [31:0] address;
    reg [2:0] size_bytes;
    reg [15:0] low_half;
    reg first_half,seen,ack;
    wire commit_ready,commit_rsp;
    wire commit_valid = reset_n && !cs_n && !wr_n && !seen &&
        (size_bytes!=4 || first_half);
    wire [31:0] commit_data = size_bytes==4 ? {cad,low_half} :
        size_bytes==2 ? {16'b0,cad} : {24'b0,cad[7:0]};
    assign ready_n=cs_n || !ack;
    cart_ram_scalar #(.ADDRESS_WIDTH(ADDRESS_WIDTH),.CAPACITY_BYTES(CAPACITY_BYTES)) owner (
        .clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),
        .req_write(1'b1),.rsp_rdata(),
        .req_valid(commit_valid),.req_ready(commit_ready),
        .req_offset(address-32'h30000000),.req_size_bytes(size_bytes),
        .req_wdata(commit_data),.rsp_valid(commit_rsp),.init_done(init_done),.busy(busy),
        .mem_data(mem_data),.mem_address(mem_address),.mem_ce_n(mem_ce_n),
        .mem_oe_n(mem_oe_n),.mem_we_n(mem_we_n),.mem_be_n(mem_be_n)
    );
    always @(negedge cal_lo) if(reset_n && !cs_n) begin
        address[15:0]<=cad;
        case(be_n)
            0:size_bytes<=1;
            1:size_bytes<=2;
            2:size_bytes<=4;
        endcase
    end
    always @(negedge cal_hi) if(reset_n && !cs_n) address[31:16]<=cad;
    always @(posedge clk or negedge reset_n or negedge power_reset_n) begin
        if(!power_reset_n || !reset_n) begin
            low_half<=0;first_half<=0;seen<=0;ack<=0;
        end else if(cs_n) begin
            first_half<=0;seen<=0;ack<=0;
        end else if(wr_n) begin
            seen<=0;ack<=0;
        end else if(!seen) begin
            if(size_bytes==4 && !first_half) begin
                low_half<=cad;first_half<=1;seen<=1;ack<=1;
            end else if(commit_ready) begin
                seen<=1;ack<=0;
            end
        end else if(commit_rsp) ack<=1;
    end
endmodule
