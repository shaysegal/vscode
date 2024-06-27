'''
The purpose of the pre test is to see the participent has suitable capablities for the experiment.
in this pre test the user has two tasks:
1) fix an assert statement
2) using the debugger environment and without chagning the code, get the value of f() when c == 5
'''
from pre_test_aux import f
import random
def g():
    while True:
        c = random.randint(1, 8)
        assert f() < 40
if __name__ == "__main__":
    g()