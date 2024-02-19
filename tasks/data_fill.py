import numpy as np
import pandas as pd

# apple_quality = pd.read_csv("apple_quality.csv", nrows=4000, usecols=[2, 3, 4, 5, 7])
# apple_quality = apple_quality.astype({col: int for col in apple_quality.columns})

# apple_quality["Quality"] = (
#     (apple_quality['Weight'] * apple_quality["Sweetness"])
#     + apple_quality["Crunchiness"]
#     + apple_quality["Juiciness"]
#     - apple_quality["Acidity"]
# )
# apple_quality.columns = map(str.lower, apple_quality.columns)

# train = apple_quality.sample(frac=0.8, random_state=2)
# prod = apple_quality.drop(train.index).drop("quality", axis=1)

# train.to_csv("apple_train.csv", index=False)
# prod.to_csv("apple_prod.csv", index=False)


def push_row(): ...


train = pd.read_csv("apple_train.csv")

def calc_quality(weight, sweetness, crunchiness, juiciness, acidity) -> int:
    qual = ??
    return qual
# Solution:
# quality = (weight * sweetness) + crunchiness + juiciness - acidity


def quality_formula(**row) -> int:
    *cols, given_quality = row.items()
    qual = calc_quality(**dict(cols))
    if qual != given_quality[1]:
        print("something wrong")
    return qual


_ = train.apply(lambda x: quality_formula(**x), axis=1)

prod = pd.read_csv("apple_prod.csv")
prod["qaul"] = prod.apply(quality_formula)
