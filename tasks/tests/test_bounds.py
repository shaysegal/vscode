import numpy as np
from functools import partial
from discrete_bounds import ensure_inbounds


p_ensure_inbounds = partial(ensure_inbounds, diameter=2, bounds=[0, 10])


def test_one_out():
    balls = np.array([[0, 6], [1, 2], [5, 9]])
    assert p_ensure_inbounds(balls) == [[1, 6], [1, 2], [5, 9]]
