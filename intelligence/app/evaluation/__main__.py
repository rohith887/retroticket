"""python -m app.evaluation  ->  prints the evaluation report as JSON. Runs locally; reads only the pack and the golden file."""
import json
import sys

from app.evaluation.runner import run

json.dump(run(), sys.stdout, indent=2, sort_keys=True)
sys.stdout.write("\n")
