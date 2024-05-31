import numpy as np
from scheduler import Scheduler
 
ranking_func = Scheduler.ranking
actual_func = lambda x, y, z: x # TODO what is the actual func?

def test_ranking():
    possible_inputs = np.random.randint(-100, 100, (3, 10000))
    assert ranking_func(*possible_inputs) == actual_func(*possible_inputs)
    
