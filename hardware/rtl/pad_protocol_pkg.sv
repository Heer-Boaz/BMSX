`timescale 1ns/1ps
package pad_protocol_pkg;
    localparam integer PAD_FRAME_BYTES = 64;
    localparam integer PAD_FRAME_BITS = PAD_FRAME_BYTES * 8;
    localparam integer PAD_BODY_BITS = (PAD_FRAME_BYTES - 2) * 8;
    localparam integer PAD_SELECT_HOLD_CYCLES = 68;
    localparam integer PAD_SELECT_GAP_CYCLES = 8192;
    localparam integer PAD_REFERENCE_HZ = 33868800;
    localparam integer PAD_HALF_EDGE_HZ = 500000;
    // 1024 fractional half-edges, SELECT hold and minimum SELECT-high gap.
    // The final +1 is the registered GAP-to-IDLE request-accept boundary.
    localparam integer PAD_FRAME_READY_CYCLES =
        (64'd2 * PAD_FRAME_BITS * PAD_REFERENCE_HZ + PAD_HALF_EDGE_HZ - 1) /
        PAD_HALF_EDGE_HZ + PAD_SELECT_HOLD_CYCLES + PAD_SELECT_GAP_CYCLES + 1;

    // Byte zero occupies bits 7:0; each byte travels most-significant bit first.
    // Word fields occupy four consecutive little-endian bytes without decoding.
    function automatic [15:0] pad_crc_bit(input [15:0] crc, input bit_value);
        pad_crc_bit = {crc[14:0], 1'b0} ^
            ((crc[15] ^ bit_value) ? 16'h1021 : 16'h0000);
    endfunction
endpackage
