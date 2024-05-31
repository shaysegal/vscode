"""
New shop owner, have 5? examples of how old owner prices apples based on quality. Task is to reverse engineer the function that produced the price via writing the get_quality function

Given the following examples, recreated the function that produces the correct price for an apple:
"""

from collections import deque
import statistics


sweetness_last_10 = deque(maxlen=10)
avg_sweetness = 0

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
        weight: int, sweetness: int, juiciness: int, acidity: int
    ) -> int:
        quality = sweetness + (acidity // weight - avg_sweetness)
        return quality

    def price(self, apple: list[int]) -> float:
        quality = self.get_quality(*apple)
        self.update_avg_quality(quality)
        return quality * 3.14

    @staticmethod
    def update_avg_quality(qual) -> None:
        global avg_sweetness 
        sweetness_last_10.append(qual)
        avg_sweetness = round(statistics.mean(sweetness_last_10))

    def total_price(self, apple: list[int]) -> float:
        base_price = self.price(apple)
        return base_price * 1.17

    def get_apples(self, apples_file: str) -> list[list[int]]:
        with open(apples_file, "rb") as of:
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


# if __name__ == "__main__":
s = Shop("data/apples.bin")
s.load_reference()
print("\n".join(str(p) for p in s.pricing()))