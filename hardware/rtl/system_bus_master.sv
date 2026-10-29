`timescale 1ns/1ps
// Multiplexed 32-bit system-bus transport. Each accepted request latches its
// raw address, data, byte enables and opaque metadata until completion.
// RESPONSE transfers the complete raw fault word. Timeout is a separate
// transport result, never an alias for endpoint fault code 3 (READ_ONLY).
// The caller consumes the one-cycle response; there is no response backpressure.
// This module does not implement arbitration, endpoint decoding or memory control.
module system_bus_master #(
    parameter integer RESPONSE_MAX_WAIT = 16,
    parameter integer DATA_WAIT_WIDTH = 18
) (
    input  wire        clk,
    input  wire        reset_n,
    input  wire        req_valid,
    output wire        req_ready,
    input  wire        req_write,
    input  wire [31:0] req_addr,
    input  wire [31:0] req_wdata,
    input  wire [3:0]  req_be_n,
    input  wire [3:0]  req_header_be_n,
    output wire        bus_busy,
    input  wire [31:0] req_meta,
    // Timed diagnostic requests use the raw last counter: zero allows one
    // DATA clock. Normal endpoint backpressure waits for its owning READY
    // edge with timeout disabled; the DATA counter then does not advance.
    input  wire        req_data_timeout_enable,
    input  wire [DATA_WAIT_WIDTH-1:0] req_data_wait_last,
    output wire        rsp_valid,
    output reg  [31:0] rsp_rdata,
    output reg  [31:0] rsp_fault_code,
    output reg         rsp_timeout,
    input  wire [31:0] bus_ad_in,
    output reg  [31:0] bus_ad_out,
    output reg         bus_ad_oe,
    output reg         bus_as_n,
    output reg         bus_rd_n,
    output reg         bus_wr_n,
    output reg  [3:0]  bus_be_n,
    input  wire        bus_ready_n
);
    localparam [3:0] IDLE = 0, HEADER = 1, ADDRESS = 2, TURN_DATA = 3,
        DATA = 4, TURN_RESPONSE = 5, RESPONSE = 6, RELEASE = 7, DONE = 8;
    localparam integer RESPONSE_WAIT_WIDTH = RESPONSE_MAX_WAIT > 1 ? $clog2(RESPONSE_MAX_WAIT) : 1;
    reg [1:0] reset_release;
    reg [3:0] state;
    reg [DATA_WAIT_WIDTH-1:0] data_wait_count, data_wait_last;
    reg [RESPONSE_WAIT_WIDTH-1:0] response_wait_count;
    reg write_latch;
    reg data_timeout_enable;
    reg [31:0] address_latch, data_latch, metadata_latch;
    reg [3:0] byte_enable_latch, header_enable_latch;
    reg response_turn;

    // RESET_N asserts immediately. Only two sampled, valid clock edges release
    // the bus sequencer; this is not a replacement for clock/rail qualification.
    always @(posedge clk or negedge reset_n) begin
        if (!reset_n)
            reset_release <= 2'b00;
        else
            reset_release <= {reset_release[0], 1'b1};
    end

    assign bus_busy = reset_release[1] && state != IDLE && state != DONE;
    assign req_ready = reset_release[1] && (state == IDLE || state == DONE);
    assign rsp_valid = reset_release[1] && state == DONE;

    always @* begin
        bus_ad_out = 32'b0;
        bus_ad_oe = 1'b0;
        bus_as_n = 1'b1;
        bus_rd_n = 1'b1;
        bus_wr_n = 1'b1;
        bus_be_n = 4'b1111;
        if (reset_release[1]) begin
            case (state)
                HEADER: begin
                    bus_ad_out = metadata_latch;
                    bus_ad_oe = 1'b1;
                    bus_as_n = 1'b0;
                    bus_be_n = header_enable_latch;
                end
                ADDRESS: begin
                    bus_ad_out = address_latch;
                    bus_ad_oe = 1'b1;
                    bus_as_n = 1'b0;
                    bus_be_n = byte_enable_latch;
                end
                DATA: begin
                    bus_be_n = byte_enable_latch;
                    if (write_latch) begin
                        bus_ad_out = data_latch;
                        bus_ad_oe = 1'b1;
                        bus_wr_n = 1'b0;
                    end else begin
                        bus_rd_n = 1'b0;
                    end
                end
                RESPONSE: begin
                    bus_rd_n = 1'b0;
                    bus_wr_n = 1'b0;
                end
                default: begin end
            endcase
        end
    end

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            state <= IDLE;
            data_wait_count <= 0;
            data_wait_last <= 0;
            response_wait_count <= 0;
            write_latch <= 0;
            data_timeout_enable <= 0;
            address_latch <= 0;
            data_latch <= 0;
            metadata_latch <= 0;
            byte_enable_latch <= 4'b1111;
            header_enable_latch <= 4'b1111;
            response_turn <= 0;
            rsp_rdata <= 0;
            rsp_fault_code <= 0;
            rsp_timeout <= 0;
        end else if (!reset_release[1]) begin
            state <= IDLE;
        end else begin
            case (state)
                IDLE, DONE: begin
                    if (req_valid) begin
                        write_latch <= req_write;
                        address_latch <= req_addr;
                        data_latch <= req_wdata;
                        metadata_latch <= req_meta;
                        byte_enable_latch <= req_be_n;
                        header_enable_latch <= req_header_be_n;
                        data_wait_last <= req_data_wait_last;
                        data_timeout_enable <= req_data_timeout_enable;
                        rsp_rdata <= 0;
                        rsp_fault_code <= 0;
                        rsp_timeout <= 0;
                        state <= HEADER;
                    end else begin
                        state <= IDLE;
                    end
                end
                HEADER: state <= ADDRESS;
                ADDRESS: state <= TURN_DATA;
                TURN_DATA: begin
                    data_wait_count <= 0;
                    state <= DATA;
                end
                DATA: begin
                    if (!bus_ready_n) begin
                        if (!write_latch)
                            rsp_rdata <= bus_ad_in;
                        response_turn <= 0;
                        state <= TURN_RESPONSE;
                    end else if (data_timeout_enable && data_wait_count == data_wait_last) begin
                        rsp_timeout <= 1;
                        state <= RELEASE;
                    end else if (data_timeout_enable) begin
                        data_wait_count <= data_wait_count + 1'b1;
                    end
                end
                TURN_RESPONSE: begin
                    response_wait_count <= 0;
                    response_turn <= 1;
                    if (response_turn) state <= RESPONSE;
                end
                RESPONSE: begin
                    if (!bus_ready_n) begin
                        rsp_fault_code <= bus_ad_in;
                        state <= RELEASE;
                    end else if (response_wait_count == RESPONSE_MAX_WAIT - 1) begin
                        rsp_timeout <= 1;
                        state <= RELEASE;
                    end else begin
                        response_wait_count <= response_wait_count + 1'b1;
                    end
                end
                RELEASE: state <= DONE;
                // Unused state words retain their stored state. Only reset
                // reinitializes the sequencer; no implicit recovery is added.
            endcase
        end
    end
endmodule
