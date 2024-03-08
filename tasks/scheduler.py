"""
Scheduler program where the user needs to create a function that decides which job/action needs to be carried out next.
    => Interdependency since each choice is influenced by previous choices

The order I would like is the following, where numbers represent the indexed position of the jobs:


    Iteration 1: 4(10) -> 2(6) -> 1(3) -> 0(3) -> 3
    Iteration 2: 3(11) -> 1(3) -> 0(3) -> 3

    source = "[[j.name,j.length + j.importance - (total_resources // j.resource_requirement)] for j in remaining_jobs]"
    code = base64.b64encode(bytearray(source,"utf-8"))
"""
# TODO: Ordering needs to be calculated properly given some function over the jobs

from collections.abc import Generator
from dataclasses import dataclass
from typing import List
import json
total_resources = 10
class Evaluator:
    def __init__(self) -> None:
        self.eval_license = b'W1tqLm5hbWUsai5sZW5ndGggKyBqLmltcG9ydGFuY2UgLSAodG90YWxfcmVzb3VyY2VzIC8vIGoucmVzb3VyY2VfcmVxdWlyZW1lbnQpXSBmb3IgaiBpbiByZW1haW5pbmdfam9ic10='
        print("license will expire tomorrow")

    def eval_jobs(self,remaining_jobs):
        import base64
        return eval(base64.b64decode(self.eval_license))

@dataclass
class Job:
    name: str
    length: int
    importance: int
    resource_requirement: int
    current_urgency: int = -1

    def __iter__(self):
        return iter((self.length, self.importance, self.resource_requirement))


class Scheduler:
    def __init__(self, jobs: dict) -> None:
        self.jobs = self.extract_jobs(jobs)
        self.evaluator = Evaluator()

    def extract_jobs(self, jobs: dict) -> List[Job]:
        return [Job(**j) for j in jobs.values()]

    # TODO: do we give this with code or empty
    #   -> Empty allows for more realistic exploratory debugging
    #       =: But maybe too much freedom/synthesiser cannot handle this
    def next_job(self, remaining_jobs: List[Job]) -> Job:
        for j in remaining_jobs:
            j.current_urgency = self.ranking(*j)
        return max(remaining_jobs, key= lambda j: j.current_urgency)

        # raise NotImplemented

    @staticmethod
    def ranking(len, imp, res) -> int:
        # uregency = len + imp - (total_resources // res)
        urgency = ??
        return urgency
        # raise NotImplemented

    def fetch_next_job(self) -> Generator[Job, None, None]:
        global total_resources
        current_evaluations = self.evaluator.eval_jobs(self.jobs)
        new_job = self.next_job(self.jobs)
        total_resources -= new_job.resource_requirement
        self.jobs.remove(new_job)
        yield new_job

    def schedule(self):
        while self.jobs:
            yield from self.fetch_next_job()


with open('data/jobs.json', 'r') as f:
    js = json.load(f)
    s = Scheduler(js)

for j in s.schedule():
    print(f"The next job is: {j.name:<25} {'lasting:':>10} {j.length} time")
