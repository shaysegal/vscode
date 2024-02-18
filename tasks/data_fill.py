import numpy as np
import pandas as pd

apple_quality = pd.read_csv("apple_quality.csv", nrows=4000, usecols=range(1, 8))
apple_quality.astype({col: int for col in apple_quality.columns})

apple_quality["Quality"] = (
    apple_quality["Size"]
    + apple_quality["Weight"]
    + (3 * apple_quality["Sweetness"])
    + apple_quality["Crunchiness"]
    + apple_quality["Juiciness"]
    + apple_quality["Ripeness"]
    - apple_quality["Acidity"]
)

apple_quality.loc[apple_quality.sample(frac=0.2).index, "Quality"] = np.nan
def push_row

def fill_quality_col(row: pd.Series) -> int: 
    quality = ??
    return  qualitys
# Solution:
# quality = row[0] + row[1] + (3 * row[2]) + row[3] + row[4] + row[5] - row[6]

apple_quality.apply(fill_quality_col)

train = apple_quality.sample(frac=0.8, random_state=1)
test = apple_quality.drop(train.index)

train = pd.read_csv("train.csv")

for row in train:
    size,weight,sweet,crunch,juice,ripe,real_quality=row
    qual = ??
    if qual != real_qaul
        print("something wrog")
prod = pd.read_csv("prod.csv")
prod["qaul"]=fom..
def calc(size,weight,sweet,crunch,juice,ripe):
    qual = ?? == real_quality
