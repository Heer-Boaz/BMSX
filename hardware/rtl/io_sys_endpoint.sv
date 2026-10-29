`timescale 1ns/1ps
// Native multiplexed SYS endpoint for INPUT only. HEADER and ADDRESS are
// separate AS_N clocks. DATA and RESPONSE have separate turnaround clocks;
// neither the data nor READY pin is driven after the initiating strobes end.
// System ROM/flash is a different U7 endpoint and is not decoded here.
// HEADER BE_N=F is an architectural access. E and D are pre-admission
// reservation/query and cancellation reads of OUTPUT_CTRL. These operations
// never assert architectural access_valid and never accept an APPLY command.
// Their DATA result is a clock deadline (zero means held ready), followed by
// the same full-width fault RESPONSE as an ordinary packet.
module io_sys_endpoint (
    input wire clk, reset_n,
    input wire [31:0] bus_ad_in,
    input wire bus_as_n, bus_rd_n, bus_wr_n, cs_io_n,
    input wire [3:0] bus_be_n,
    output reg [31:0] bus_ad_out,
    output reg bus_ad_oe,
    output wire bus_ready_drive_low,
    output wire access_valid, access_write,
    output wire [5:0] word_index,
    output wire [31:0] write_word,
    input wire access_ready,
    input wire [31:0] read_word, fault_code,
    output wire reserve_accept, cancel_accept,
    input wire [31:0] apply_ready_cycles
);
    localparam [2:0] HEADER = 0, ADDRESS = 1, DATA = 2, RESPONSE = 3;
    reg [2:0] phase;
    reg [31:0] address_word, response_word;
    reg [3:0] byte_enables, operation;
    reg selected, data_seen;
    wire data_phase = phase == DATA && bus_as_n && (bus_rd_n != bus_wr_n);
    wire response_phase = phase == RESPONSE && bus_as_n && !bus_rd_n && !bus_wr_n;
    wire whole_word = address_word[1:0] == 0 && byte_enables == 4'b0000;
    wire normal = operation == 4'hf;
    wire transport_access = (operation == 4'he || operation == 4'hd) &&
        address_word == 32'h0800011c && whole_word && !bus_rd_n && bus_wr_n;
    wire acknowledge = data_phase && selected && (!normal || !whole_word || access_ready);
    assign access_valid = reset_n && data_phase && selected && normal && whole_word;
    assign reserve_accept = reset_n && data_phase && selected && transport_access && operation == 4'he;
    assign cancel_accept = reset_n && data_phase && selected && transport_access && operation == 4'hd;
    assign access_write = !bus_wr_n;
    assign write_word = bus_ad_in;
    assign word_index = (address_word - 32'h08000064) >> 2;
    assign bus_ready_drive_low = reset_n && (acknowledge || response_phase && selected);

    always @* begin
        bus_ad_out = 0;
        bus_ad_oe = 0;
        if (reset_n && selected) begin
            if (data_phase && !bus_rd_n) begin
                if (normal) bus_ad_out = whole_word ? read_word : 32'd0;
                else if (transport_access && operation == 4'he) bus_ad_out = apply_ready_cycles;
                bus_ad_oe = 1;
            end
            if (response_phase) begin
                bus_ad_out = response_word;
                bus_ad_oe = 1;
            end
        end
    end

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            phase <= HEADER;
            address_word <= 0;
            response_word <= 0;
            byte_enables <= 4'hf;
            operation <= 4'hf;
            selected <= 0;
            data_seen <= 0;
        end else begin
            case (phase)
                HEADER: if (!bus_as_n) begin
                    operation <= bus_be_n;
                    phase <= ADDRESS;
                    selected <= 0;
                    data_seen <= 0;
                end
                ADDRESS: begin
                    address_word <= bus_ad_in;
                    byte_enables <= bus_be_n;
                    selected <= !cs_io_n && (!normal ||
                        bus_ad_in >= 32'h08000064 && bus_ad_in < 32'h08000120);
                    phase <= DATA;
                end
                DATA: begin
                    if (data_phase) data_seen <= 1;
                    if (acknowledge) begin
                        response_word <= normal ? (whole_word ? fault_code : 32'd2) :
                            (transport_access ? 32'd0 : 32'd1);
                        phase <= RESPONSE;
                    end else if (data_seen && bus_as_n && bus_rd_n && bus_wr_n) begin
                        // Initiator timeout or an operation selected elsewhere.
                        phase <= HEADER;
                        selected <= 0;
                    end
                end
                RESPONSE: if (response_phase) begin
                    phase <= HEADER;
                    selected <= 0;
                end
            endcase
        end
    end
endmodule
