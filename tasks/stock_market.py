from utils import RollingBuffer, actions, get_codes, rotated_decorator, stocks, decode_binary_string


class StockMarketTradingSystem:
    security_buffer = RollingBuffer(maxlen=4)

    @staticmethod
    @rotated_decorator
    def mirrored(c):
        mirrored = 0
        while c:
            mirrored = ??
            c >>= 1
        # rotated_code = ??
        return mirrored
    # Solution
    # rotated_code = (mirrored << 1) + (c & 1)

    # @staticmethod
    # @rotated_decorator
    # def rotated(c, n):
    #     rotated_code = ??
    #     return rotated_code
    # # rotated_code = (c >> n) | c << (c.bit_length() - n)


    def check_secure(self):
        val = ""
        for n, code in enumerate(self.security_buffer, start=1):
            rotated_code = self.rotated(code, n)
            val  += str(rotated_code)
        if decode_binary_string(val) == 'hack':
            return True
        return False

    def remove_errornous_code(self):
        max_code = max(self.security_buffer, key=lambda x: bin(x).count('1'))
        self.security_buffer.remove(max_code)

    def process_code(self, code):
        if not self.security_buffer.is_full():
            self.security_buffer.append(code)
            return

        if not self.check_secure():
            self.remove_errornous_code()
            return 

        first_code = self.security_buffer.first()
        self.execute_command(first_code)


    def execute_command(self, command):
        action, stock = command.split()
        if (a := actions.get(action)) and (s := stocks.get(stock)):
            print(f"{a} {s}")
        else:
            print("Unkown command")


trading_system = StockMarketTradingSystem()
for code in get_codes():
    trading_system.process_code(code)
