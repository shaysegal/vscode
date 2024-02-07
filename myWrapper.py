import copy
import inspect
import pprint
import runpy
from io import open_code
from sys import argv
import re
import ast

"""
run code given in codeFile arg and drop statements in ignoreStatementsFile
based on img-summary.py
"""


class Sketch:
    def __init__(self):
        self.sketchValue = None 
        # self.suggestedValue = None # To have suggeted value in the sketch hover widget

    # Not used
    # def update_synt_dict(self, localState, frameinfo, global_state):
    #     print("local state", localState)
    #     print("frame info", frameinfo)
    #     alter__a__(frameinfo.lineno, localState, global_state)


# bdb explained https://docs.google.com/presentation/d/1rBhLdD4VIUkfZ9UlSADjqPPuBeWdMXjjgDgkW2nnDMs/edit#slide=id.g4b85415bca_0_5
# https://docs.python.org/3/reference/datamodel.html
pp = pprint.PrettyPrinter(indent=4)
synt_dict = {}
sketchValueContainer = Sketch()
import json

import numpy as np


class MyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        else:
            return super(MyEncoder, self).default(obj)


def ad_hoc_eval_solution(line_number, localState):
    if line_number in synt_dict:
        if (
            "overrideValue" in synt_dict[line_number]
            and synt_dict[line_number]["overrideValue"] != None
        ):
            return synt_dict[line_number]["overrideValue"]
        if "solution" in synt_dict[line_number]:
            output = eval(synt_dict[line_number]["solution"], localState)
            synt_dict[line_number]["generated_solution"] = output
            sketchValueContainer.sketchValue = output
            return output

    return sketchValueContainer.sketchValue


# What does this do?
def ad_hoc_alter__a__(func_name):
    stackframe = list(
        filter(lambda frame: frame.function == func_name, inspect.stack())
    )
    if len(stackframe) == 1:
        current_frame = stackframe[0]
        return alter__a__(current_frame.lineno, current_frame.frame.f_locals, current_frame.frame.f_globals)


    return None

""" TODO: do this in one part
    -> Then in the 'HoverVariablesRenderer, once the user inputs a sketch value, locals and this value are added as the input and output for the synt_dict via func update_synt_dict
    -> this should be great
"""

def convert_json_localstate(ls):
    d = {}
    for l in ls:
        k, v = re.split(":", l)
        d[k] = ast.literal_eval(v)
    return d

def get_preserved_local_state(locals_state):
    preserved_local_state = {}
    for key, value in locals_state.items():
        if key.startswith("__") or type(value).__name__ == "module": continue
        preserved_local_state[key] = copy.deepcopy(value)

    return preserved_local_state

def remove_sol_if_override(current_line):
    if (synt_dict[current_line].get("solution") and synt_dict[current_line].get("overrideValue")):
        del synt_dict[current_line]["solution"]
        synt_dict[current_line]["overrideValue"] = None

def update_synt_dict(locals_state_json, value, current_line):
    if value is None:
        raise RuntimeError("Cannot set sketchValue to None")

    locals_state = convert_json_localstate(locals_state_json) # don't need preserved as we are already given only the preserved local state
    
    if current_line in synt_dict:
        # Grim but works
        if locals_state in synt_dict[current_line]["input"]:
            idx = synt_dict[current_line]["input"].index(locals_state)
            synt_dict[current_line]["output"][idx] = value
            return

        if (synt_dict[current_line].get("solution") and value != synt_dict[current_line].get("generated_solution")):
            synt_dict[current_line]["overrideValue"] = value
            sketchValueContainer.sketchValue = value

        synt_dict[current_line]["input"].append(locals_state)
        synt_dict[current_line]["output"].append(value)
    else:
        synt_dict[current_line] = {
            "input": [locals_state],
            "output": [value],
        }
    
# What does this do??
def try_get_solution(locals_state, globals_state, current_line):
    preserved_local_state = get_preserved_local_state(locals_state)
    try:
        print("debug solution ", synt_dict[current_line]["solution"])
        print("debug preserved_local_state ", preserved_local_state)
        output = eval(
            synt_dict[current_line]["solution"],
            copy.deepcopy(preserved_local_state),
            globals_state,
        )
        # would like to save it for future need of synthesizing
        # synt_dict[current_line]["input"].append(preserved_local_state)
        # synt_dict[current_line]["output"].append(output)

        return output
    except Exception as e:
        print(
            "Error while eval solution for line",
            current_line,
            "with error",
            e,
        )

def alter__a__(current_line, locals_state, globals_state):
    # Should never be reached given code in continuation
    # if not synt_dict:
    #     raise AssertionError("Must supply a valid sketch value")
    if "solution" in synt_dict[current_line]:
        return try_get_solution(locals_state, globals_state, current_line)
    else:
        return_value = sketchValueContainer.sketchValue
    return return_value


# def simple_tracer(frame, event, arg):
# 	co = frame.f_code ; func_name = co.co_name
# 	if event == "call" and func_name == "alter__a__": pp.pprint("stack") ; pp.pprint(inspect.stack()[2:]);pp.pprint("locals");pp.pprint(frame.f_back.f_locals);pp.pprint("globlas");exclude_keys = ["__builtins__"];d = frame.f_back.f_globals;new_globals = {k: d[k] for k in set(list(d.keys())) - set(exclude_keys)};pp.pprint(new_globals)
# 	return simple_tracer
# sys.settrace(simple_tracer)
def validated_codefile(code_file_path):
    with open_code(code_file_path) as f:
        textfile = f.read().decode("utf-8")
        start = 0
        count = 0
        pattern_index = textfile.find("??", start)
        while pattern_index != -1:
            old_pattern_index = pattern_index
            last_newline_index = textfile.rfind("\n", 0, pattern_index)
            pattern_index = textfile.find("??", pattern_index + 2)
            if "#" in textfile[last_newline_index:old_pattern_index]:
                # in comment
                continue
            if (
                textfile[0:old_pattern_index].count("'''") % 2 == 1
                or textfile[0:old_pattern_index].count('"""') % 2 == 1
            ):
                # in multiline comment
                continue
            count += 1
        if count > 1:
            raise RuntimeError("Multiple Sketches are not allowed")


def _get_code_from_file(run_name, path_name):
    with open_code(path_name) as f:
        altered_code = str.encode(
            f.read()
            .decode("utf-8")
            .replace("??", "alter__a__(inspect.currentframe().f_lineno, inspect.currentframe().f_locals, inspect.currentframe().f_globals)")
        )
        code = compile(altered_code, path_name, "exec")
    return code, path_name


def like_runpy(code_file_path, init_globals=None, run_name=None):
    run_name = "<run_path>"
    pkg_name = run_name.rpartition(".")[0]
    code, fname = _get_code_from_file(run_name, code_file_path)
    return runpy._run_module_code(
        code, init_globals, run_name, pkg_name=pkg_name, script_name=fname
    )


if len(argv) > 1:
    validated_codefile(argv[1])
    like_runpy(argv[1], globals())
    # runpy.run_path(argv[1],globals())
else:
    print("problem....")
