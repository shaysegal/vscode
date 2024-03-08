import tests
from tests import test_checksum

for item in dir(tests):
    test = getattr(tests, item)
    if callable(test) and "test" in item:
        test()
