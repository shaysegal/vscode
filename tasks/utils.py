import random

actions = {
    0b0000: "Buy",
    0b0001: "Sell",
    0b0010: "Place Order",
    0b0011: "Cancel Order",
    0b0100: "Modify Order",
    0b0101: "View Account",
    0b0110: "View Market",
    0b0111: "Execute Trade",
    0b1000: "Raise Presented Price",
    0b1001: "Drop Presented Price",
}

stocks = {
    0b0000: "Apple Inc. (AAPL)",
    0b0001: "Amazon.com Inc. (AMZN)",
    0b0010: "Google LLC (GOOGL)",
    0b0011: "Microsoft Corporation (MSFT)",
    0b0100: "Tesla, Inc. (TSLA)",
    0b0101: "Facebook, Inc. (FB)",
    0b0110: "Alphabet Inc. (GOOG)",
    0b0111: "Netflix, Inc. (NFLX)",
}


class BinaryInt(int):
    max_size = 0  # to remove linting errors

    def __new__(cls, val, max_size=8):
        if val > (2**max_size - 1) or val < 0:
            raise ValueError(f"Only {max_size} bit positive integers allowed")
        inst = super().__new__(cls, val)
        inst.max_size = max_size
        return inst

    def __repr__(self):
        return f"0b{self:0{self.max_size}b}"

    def __or__(self, __value: int):
        return BinaryInt(
            super().__or__(__value), max(self.bit_length(), __value.bit_length())
        )

    def __ror__(self, __value: int):
        return BinaryInt(
            super().__ror__(__value), max(self.bit_length(), __value.bit_length())
        )

    def __lshift__(self, __value: int) -> int:
        l = max(self.bit_length(), __value.bit_length())
        ret = super().__lshift__(__value) & (2**l - 1)
        return BinaryInt(ret, l)

    def __rshift__(self, __value: int) -> int:
        l = max(self.bit_length(), __value.bit_length())
        ret = super().__rshift__(__value) & (2**l - 1)
        return BinaryInt(ret, l)

    def bit_length(self):
        return self.max_size

    # only works for binaryint with an even number of bits
    def split(self):
        tmp = self.max_size // 2
        return BinaryInt(self >> tmp, tmp), BinaryInt(self & (2**tmp - 1), tmp)


class RollingBuffer(list):
    def __init__(self, maxlen):
        super().__init__(self)
        self.maxlen = maxlen

    def is_full(self):
        return len(self) == self.maxlen

    def first(self):
        return self.pop(0)


def decode_binary_string(s):
    return "".join(chr(int(s[i * 8 : i * 8 + 8], 2)) for i in range(len(s) // 8))


def rotated_decorator(f):
    def wrapper(*args, **kwargs):

        val = f(*args, **kwargs)
        if isinstance(val, str):
            return BinaryInt(int(val, 2))
        else:
            return val

    return wrapper


def get_codes():
    while True:
        c = random.randint(0, 255)
        yield BinaryInt(c)
