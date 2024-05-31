import test_vininfo.tests as tests

for item in dir(tests):
    test = getattr(tests, item)
    if callable(test) and "test" in item:
        test()
