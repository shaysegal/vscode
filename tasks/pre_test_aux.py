import random
import string
storage  = []
def generate_random_string(minimum_length:int,maximum_length:int) -> str:
    """
    generate random string in the range [minimum_length,maximum_length]
    including both end points
    """
    length = random.randint(minimum_length, maximum_length)
    return "".join(random.choices(string.ascii_letters, k=length))


def save_string(string_to_store:str)->bool:
    """
    store the input string so it could be available later.
    return True if store was successful demanding string of length 7 or longer or False otherwise
    """
    global storage
    stored = len(string_to_store) >= 7
    if (stored):
        storage.append(string_to_store)
        return True
    return False

def get_storage_array_representation()->list:
    return storage
