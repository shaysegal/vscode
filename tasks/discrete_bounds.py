from typing import List

import matplotlib.pyplot as plt
import numpy as np
import numpy.typing as npt
from matplotlib.patches import Circle

np.random.seed(4)

# TODO: Requires numpy functions for synthesis

def ensure_inbounds(positions: npt.NDArray, diameter: int, bounds: list[int]):
    inbound_positions = ??
    # inbound_positions = positions
    return inbound_positions
# Possible Solution


class Model:
    def __init__(self, num_circles: int, diameter: int, bounds: List[int]) -> None:
        self.num_circles = num_circles
        self.diameter = diameter
        self.bounds = bounds
        self.agents = np.random.randint(bounds[0], bounds[1], size=(num_circles, 2))

        self.circles = self.init_animation()

    def init_animation(self):
        self.fig, ax = plt.subplots()
        ax.set_xlim(self.bounds[0], self.bounds[1])
        ax.set_ylim(self.bounds[0], self.bounds[1])
        ax.set_yticks(np.arange(0, self.bounds[1], 3))
        ax.set_xticks(np.arange(0, self.bounds[1], 3))

        circles = []
        for a in self.agents:
            c = Circle((a[0], a[1]), radius=self.diameter / 2, facecolor="k")
            circles.append(c)
            ax.add_patch(c)
        ax.set_aspect("equal", adjustable="box")
        plt.ion()
        return circles

    def move(self) -> None:
        steps = np.random.randint(-1, 2, size=(self.num_circles, 2))
        new_agent_positions = self.agents + steps
        self.agents = ensure_inbounds(new_agent_positions, self.diameter, self.bounds)

    def draw(self) -> None:
        for a, c in zip(self.agents, self.circles):
            c.set_center(a)
        self.fig.canvas.draw_idle()
        self.fig.canvas.flush_events()
        plt.pause(0.2)

    def run(self) -> None:
        while plt.fignum_exists(1):
            self.move()
            self.draw()


if __name__ == "__main__":
    model = Model(3, 2, [0, 10])
    model.run()
