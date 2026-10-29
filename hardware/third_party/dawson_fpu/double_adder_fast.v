//IEEE Floating Point Adder (Double Precision)
//Copyright (C) Jonathan P Dawson 2013
//2013-12-12

// BMSX derivative: parallel right shift with sticky-jam replaces one-bit-per-
// cycle exponent alignment. A leading-zero tree and barrel shift replace serial
// left normalization; exact cancellation produces positive zero.
// MIT license and upstream provenance: COPYING.txt
// and ORIGIN.txt in this directory. The original remains unmodified.
module double_adder_fast(
        input_a,
        input_b,
        input_a_stb,
        input_b_stb,
        output_z_ack,
        clk,
        rst,
        output_z,
        output_z_stb,
        input_a_ack,
        input_b_ack);

  input     clk;
  input     rst;

  input     [63:0] input_a;
  input     input_a_stb;
  output    input_a_ack;

  input     [63:0] input_b;
  input     input_b_stb;
  output    input_b_ack;

  output    [63:0] output_z;
  output    output_z_stb;
  input     output_z_ack;

  reg       s_output_z_stb;
  reg       [63:0] s_output_z;
  reg       s_input_a_ack;
  reg       s_input_b_ack;

  reg       [3:0] state;
  parameter get_a         = 4'd0,
            get_b         = 4'd1,
            unpack        = 4'd2,
            special_cases = 4'd3,
            align         = 4'd4,
            add_0         = 4'd5,
            add_1         = 4'd6,
            normalise_1   = 4'd7,
            normalise_2   = 4'd8,
            round         = 4'd9,
            pack          = 4'd10,
            put_z         = 4'd11;

  reg       [63:0] a, b, z;
  reg       [55:0] a_m, b_m;
  reg       [52:0] z_m;
  reg       [12:0] a_e, b_e, z_e;
  reg       a_s, b_s, z_s;
  reg       guard, round_bit, sticky;
  reg       [56:0] sum;
  wire [12:0] a_distance = $signed(b_e) - $signed(a_e);
  wire [12:0] b_distance = $signed(a_e) - $signed(b_e);
  wire [55:0] a_shifted = a_m >> a_distance;
  wire [55:0] b_shifted = b_m >> b_distance;
  wire a_jam = a_distance >= 56 ? (|a_m) : (|(a_m << (56-a_distance)));
  wire b_jam = b_distance >= 56 ? (|b_m) : (|(b_m << (56-b_distance)));

  // Leading-zero tree over retained significand and the guard/round bits.
  // Sticky represents already-lost information and is not shifted left.
  wire [54:0] normal_bits = {z_m,guard,round_bit};
  wire [63:0] normal_64 = {normal_bits,9'd0};
  wire lz32 = !(|normal_64[63:32]);
  wire [63:0] norm32 = lz32 ? normal_64 << 32 : normal_64;
  wire lz16 = !(|norm32[63:48]);
  wire [63:0] norm16 = lz16 ? norm32 << 16 : norm32;
  wire lz8 = !(|norm16[63:56]);
  wire [63:0] norm8 = lz8 ? norm16 << 8 : norm16;
  wire lz4 = !(|norm8[63:60]);
  wire [63:0] norm4 = lz4 ? norm8 << 4 : norm8;
  wire lz2 = !(|norm4[63:62]);
  wire [63:0] norm2 = lz2 ? norm4 << 2 : norm4;
  wire lz1 = !norm2[63];
  wire [5:0] normal_lz = {lz32,lz16,lz8,lz4,lz2,lz1};
  wire [12:0] normal_exp_room = $signed(z_e) + 13'sd1022;
  wire [12:0] normal_shift = (normal_bits == 0 || normal_exp_room < {7'd0,normal_lz})
                         ? normal_exp_room : {7'd0,normal_lz};
  wire [54:0] normal_shifted = normal_bits << normal_shift;

  always @(posedge clk)
  begin

    case(state)

      get_a:
      begin
        s_input_a_ack <= 1;
        if (s_input_a_ack && input_a_stb) begin
          a <= input_a;
          s_input_a_ack <= 0;
          state <= get_b;
        end
      end

      get_b:
      begin
        s_input_b_ack <= 1;
        if (s_input_b_ack && input_b_stb) begin
          b <= input_b;
          s_input_b_ack <= 0;
          state <= unpack;
        end
      end

      unpack:
      begin
        a_m <= {a[51 : 0], 3'd0};
        b_m <= {b[51 : 0], 3'd0};
        a_e <= a[62 : 52] - 1023;
        b_e <= b[62 : 52] - 1023;
        a_s <= a[63];
        b_s <= b[63];
        state <= special_cases;
      end

      special_cases:
      begin
        //if a is NaN or b is NaN return NaN 
        if ((a_e == 1024 && a_m != 0) || (b_e == 1024 && b_m != 0)) begin
          z[63] <= 1;
          z[62:52] <= 2047;
          z[51] <= 1;
          z[50:0] <= 0;
          state <= put_z;
        //if a is inf return inf
        end else if (a_e == 1024) begin
          z[63] <= a_s;
          z[62:52] <= 2047;
          z[51:0] <= 0;
          //if a is inf and signs don't match return nan
          if ((b_e == 1024) && (a_s != b_s)) begin
              z[63] <= 1;
              z[62:52] <= 2047;
              z[51] <= 1;
              z[50:0] <= 0;
          end
          state <= put_z;
        //if b is inf return inf
        end else if (b_e == 1024) begin
          z[63] <= b_s;
          z[62:52] <= 2047;
          z[51:0] <= 0;
          state <= put_z;
        //if a is zero return b
        end else if ((($signed(a_e) == -1023) && (a_m == 0)) && (($signed(b_e) == -1023) && (b_m == 0))) begin
          z[63] <= a_s & b_s;
          z[62:52] <= b_e[10:0] + 1023;
          z[51:0] <= b_m[55:3];
          state <= put_z;
        //if a is zero return b
        end else if (($signed(a_e) == -1023) && (a_m == 0)) begin
          z[63] <= b_s;
          z[62:52] <= b_e[10:0] + 1023;
          z[51:0] <= b_m[55:3];
          state <= put_z;
        //if b is zero return a
        end else if (($signed(b_e) == -1023) && (b_m == 0)) begin
          z[63] <= a_s;
          z[62:52] <= a_e[10:0] + 1023;
          z[51:0] <= a_m[55:3];
          state <= put_z;
        end else begin
          //Denormalised Number
          if ($signed(a_e) == -1023) begin
            a_e <= -1022;
          end else begin
            a_m[55] <= 1;
          end
          //Denormalised Number
          if ($signed(b_e) == -1023) begin
            b_e <= -1022;
          end else begin
            b_m[55] <= 1;
          end
          state <= align;
        end
      end

      align:
      begin
        if ($signed(a_e) > $signed(b_e)) begin
          b_e <= a_e;
          b_m <= b_shifted | {55'd0,b_jam};
        end else if ($signed(a_e) < $signed(b_e)) begin
          a_e <= b_e;
          a_m <= a_shifted | {55'd0,a_jam};
        end
        state <= add_0;
      end

      add_0:
      begin
        z_e <= a_e;
        if (a_s == b_s) begin
          sum <= {1'd0, a_m} + b_m;
          z_s <= a_s;
        end else begin
          if (a_m > b_m) begin
            sum <= {1'd0, a_m} - b_m;
            z_s <= a_s;
          end else begin
            sum <= {1'd0, b_m} - a_m;
            z_s <= b_s;
          end
        end
        state <= add_1;
      end

      add_1:
      begin
        if (sum == 0) begin
          z <= 0;
          state <= put_z;
        end else begin
        if (sum[56]) begin
          z_m <= sum[56:4];
          guard <= sum[3];
          round_bit <= sum[2];
          sticky <= sum[1] | sum[0];
          z_e <= z_e + 1;
        end else begin
          z_m <= sum[55:3];
          guard <= sum[2];
          round_bit <= sum[1];
          sticky <= sum[0];
        end
        state <= normalise_1;
        end
      end

      normalise_1:
      begin
        if (z_m[52] == 0 && $signed(z_e) > -1022) begin
          z_e <= z_e - normal_shift;
          {z_m,guard,round_bit} <= normal_shifted;
        end
        state <= normalise_2;
      end

      normalise_2:
      begin
        if ($signed(z_e) < -1022) begin
          z_e <= z_e + 1;
          z_m <= z_m >> 1;
          guard <= z_m[0];
          round_bit <= guard;
          sticky <= sticky | round_bit;
        end else begin
          state <= round;
        end
      end

      round:
      begin
        if (guard && (round_bit | sticky | z_m[0])) begin
          z_m <= z_m + 1;
          if (z_m == 53'h1fffffffffffff) begin
            z_e <=z_e + 1;
          end
        end
        state <= pack;
      end

      pack:
      begin
        z[51 : 0] <= z_m[51:0];
        z[62 : 52] <= z_e[10:0] + 1023;
        z[63] <= z_s;
        if ($signed(z_e) == -1022 && z_m[52] == 0) begin
          z[62 : 52] <= 0;
        end
        if ($signed(z_e) == -1022 && z_m[52:0] == 0) begin
           z[63] <= 0;
        end

        //if overflow occurs, return inf
        if ($signed(z_e) > 1023) begin
          z[51 : 0] <= 0;
          z[62 : 52] <= 2047;
          z[63] <= z_s;
        end
        state <= put_z;
      end

      put_z:
      begin
        s_output_z_stb <= 1;
        s_output_z <= z;
        if (s_output_z_stb && output_z_ack) begin
          s_output_z_stb <= 0;
          state <= get_a;
        end
      end

    endcase

    if (rst == 1) begin
      state <= get_a;
      s_input_a_ack <= 0;
      s_input_b_ack <= 0;
      s_output_z_stb <= 0;
    end

  end
  assign input_a_ack = s_input_a_ack;
  assign input_b_ack = s_input_b_ack;
  assign output_z_stb = s_output_z_stb;
  assign output_z = s_output_z;

endmodule

