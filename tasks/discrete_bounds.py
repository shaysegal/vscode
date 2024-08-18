import matplotlib.pyplot as plt
import numpy as np
import numpy.typing as npt
from matplotlib.patches import Circle
np.random.seed(4)
#globals
BALL_RADIUS = 1
BOUNDS = (0,10)

#alias
Circle_XY_Positions = list[int]

'''
return new positions list where for each x,y positions it return x,y if the position with ball radius
isn't out of bound or corrected x,y if it is.
for example for [[0,1],[7,10],[1,2]] we want to retrun [[1,1],[7,9],[1,2]]
BALL_RADIUS is the radius of *all* the balls
BOUNDS is the tuple of upper an lower bounds of *both axis*
'''
def ensure_inbounds(future_poitions: list[Circle_XY_Positions])->list[Circle_XY_Positions]:
    raise NotImplementedError
    return result


class Model:
    def __init__(self, num_circles: int, diameter: int, bounds: list[int]) -> None:
        self.num_circles = num_circles
        self.diameter = diameter
        self.bounds = bounds
        self.agents = np.random.randint(bounds[0], bounds[1], size=(num_circles, 2))

        self.circles = self.init_animation()

    def init_animation(self):
        self.fig, ax = plt.subplots()
        ax.set_xlim(self.bounds[0], self.bounds[1])
        ax.set_ylim(self.bounds[0], self.bounds[1])
        ax.set_yticks(np.arange(0, self.bounds[1]+1, 2))
        ax.set_xticks(np.arange(0, self.bounds[1]+1, 2))

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
        #self.agents = new_agent_positions
        self.agents = ensure_inbounds(new_agent_positions.tolist())

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

model = Model(3, 2*BALL_RADIUS , BOUNDS)
model.run()
