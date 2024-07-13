"""
Scheduler program where the user needs to create a function that decides which job/action needs to be carried out next.
    => Interdependency since each choice is influenced by previous choices

The order I would like is the following, where numbers represent the indexed position of the jobs:

    Iteration 1: 4(10) -> 2(6) -> 1(3) -> 0(3) -> 3
    Iteration 2: 3(11) -> 1(3) -> 0(3) -> 3
"""

# TODO: Ordering needs to be calculated properly given some function over the jobs

from dataclasses import dataclass
from typing import List
import json

total_resources = 10


class Evaluator:
    def __init__(self) -> None:
        self.eval_license = b'am9iLm5hbWUsIGpvYi5sZW5ndGggKyBqb2IuaW1wb3J0YW5jZSAtICh0b3RhbF9yZXNvdXJjZXMgLy8gam9iLnJlc291cmNlX3JlcXVpcmVtZW50KQ=='
        print("license will expire tomorrow")

    def eval_job(self, job):
        import base64
        return eval(base64.b64decode(self.eval_license))


@dataclass
class Job:
    name: str
    length: int
    importance: int
    resource_requirement: int
    current_urgency: int = None

    def __iter__(self):
        return iter((self.length, self.importance, self.resource_requirement))


class Scheduler:
    def __init__(self, jobs: dict) -> None:
        self.jobs = self.extract_jobs(jobs)
        self.evaluator = Evaluator()

    def extract_jobs(self, jobs: dict) -> List[Job]:
        return [Job(**j) for j in jobs.values()]

    def get_next_job(self, remaining_jobs: List[Job]) -> Job:
        for j in remaining_jobs:
            _job_evaluation = self.evaluator.eval_job(j)
            j.current_urgency = self.ranking(*j)
        return max(remaining_jobs, key=lambda j: j.current_urgency)

    @staticmethod
    def ranking(length, importence, resources) -> int:
        raise NotImplementedError
        return rank

    def fetch_next_job(self):  
        global total_resources
        next_job = self.get_next_job(self.jobs)
        total_resources -= next_job.resource_requirement
        self.jobs.remove(next_job)
        yield next_job

    def schedule(self):
        while self.jobs:
            yield from self.fetch_next_job()



with open("data/jobs.json", "r") as f:
	js = json.load(f)
	s = Scheduler(js)

for j in s.schedule():
	print(f"The next job is: {j.name:<25} {'lasting:':>10} {j.length} time")
