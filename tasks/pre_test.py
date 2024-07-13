import random
import string

def generate_string():
    length = random.randint(5, 10)
    return ''.join(random.choices(string.ascii_letters, k=length))

def process_string(s):
    vowels = 'AEIOUaeiou'
    return ''.join([char for char in s if char not in vowels])

def test_function():
    for _ in range(10):
        s = generate_string()
        result = process_string(s)
        assert len(result) < len(s)

if __name__ == "__main__":
    test_function()


def initials(name)->str:
	raise NotImplementedError
	return result