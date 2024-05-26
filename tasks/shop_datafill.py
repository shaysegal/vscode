"""
New shop owner, have 5? examples of how old owner prices apples based on quality. Task is to reverse engineer the function that produced the price via writing the get_quality function

Given the following examples, recreated the function that produces the correct price for an apple:


"""

from collections import deque
import statistics

quality_last_10 = deque(maxlen=10)
avg_quality = 0


class Shop:
    def __init__(self, apples_file: str) -> None:
        self.apples_file = apples_file
        self.references = []

    def load_reference(self):
        ref_path = self.apples_file.split(".")
        ref_path.insert(-1,"ref")
        ref_path=".".join(ref_path)
        with open(ref_path, 'rb') as of:
            for byte_array in of.readlines():
                # Extract bytes representing string and integer
                string_length = byte_array[0]  # Assuming the first byte represents the length of the string
                string_bytes = byte_array[1:string_length+1]
                integer_bytes = byte_array[string_length+1:-1]

                # Decode bytes back to string
                csv_string = string_bytes.decode('utf-8')

                # Decode bytes back to integer
                csv_integer = int.from_bytes(integer_bytes, byteorder='big',signed=True)

                self.references.append([csv_string, str(csv_integer)])

    @staticmethod
    def get_quality(
        weight: int, sweetness: int, crunchiness: int, juiciness: int, acidity: int
    ) -> int:
        quality = ??  # Interdependency here
        r_quality = quality + 0.1 * (avg_quality - quality)
        return r_quality

    def price(self, apple: list[int]) -> float:
        global avg_quality
        quality = self.get_quality(*apple)
        quality_last_10.append(quality)
        avg_quality = round(statistics.mean(quality_last_10))
        return quality * 3.14

    def total_price(self, apple: list[int]) -> float:
        base_price = self.price(apple)
        return base_price * 1.17

    def get_apples(self, apples_file: str) -> list[list[int]]:
        with open(apples_file, 'rb') as of:
            apples = []
            for l in of.readlines():
                apple = bytearray(l)[:-1]
                apples.append(apple)
            return apples


    def pricing(self) -> list[float]:
        prices = []
        for apple in self.get_apples(self.apples_file):
            price = self.total_price(apple)
            prices.append(price)
        return prices

s = Shop('data/apples.bin')
s.load_reference()
print('\n'.join(p for p in s.pricing()))
