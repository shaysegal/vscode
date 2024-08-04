from pre_test_aux import generate_random_string,save_string,get_storage_array_representation

def populate_storage(number_of_strings:int)->list:
	"""
	populate storage with random {number_of_strings} strings
	"""
	for i in range(number_of_strings):
		s = generate_random_string(minimum_length=5,maximum_length=10)
		stored_result = save_string(s)
		print(f"finished processed iteration {i}")
	storage_array = get_storage_array_representation()
	return storage_array
if __name__ == "__main__":
    result = populate_storage(10)
