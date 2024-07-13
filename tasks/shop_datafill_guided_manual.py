"""
New shop owner, have 10 examples of how old owner prices apples based on quality.
Task is to reverse engineer the function that produced the price via writing the get_quality function
Given the following examples, recreated the function that produces the correct price for an apple:
"""


class Apple:
    def __init__(self, apple_data: bytearray) -> None:
        self.weight = apple_data[0]
        self.sweetness = apple_data[1]
        self.juiciness = apple_data[2]
        self.acidity = apple_data[3]
class Shop:
    quality_to_price_ratio = 3.14
    tax_ratio = 1.17
    def __init__(self, apples_file: str) -> None:
        self.apples_file = apples_file
        
    @staticmethod
    def get_quality(weight: int, sweetness: int, juiciness: int, acidity: int ) -> int:
        # the quality is calculated by a combination of the apple properties.
        raise NotImplementedError
        return quality

    def price(self, apple: Apple) -> float:
        quality = self.get_quality(apple.weight, apple.sweetness, apple.juiciness, apple.acidity)
        return quality * Shop.quality_to_price_ratio

    def total_price(self, apple: list[int]) -> float:
        base_price = self.price(apple)
        return base_price * Shop.tax_ratio

    def get_apples(self, apples_file: str) -> list[list[int]]:
        with open(apples_file, "rb") as of:
            apples = []
            for l in of.readlines():
                apple = bytearray(l)[:-1]
                apples.append(Apple(apple))
            return apples

    def pricing(self) -> list[float]:
        prices = []
        for apple in self.get_apples(self.apples_file):
            price = self.total_price(apple)
            prices.append(price)
        return prices

if __name__ == "__main__":
    s = Shop("data/apples.bin")
    print("\n".join(str(p) for p in s.pricing()))
