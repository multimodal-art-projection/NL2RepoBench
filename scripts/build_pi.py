"""Build only explicit Pi source/dependency files; never copy local credentials or runs."""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pi_agent.provenance import runtime_fingerprint


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="nl2repobench-pi:1.5.2")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="nl2repo-pi-build-") as temporary:
        context = Path(temporary)
        runtime = context / "pi_agent/runtime"
        runtime.mkdir(parents=True)
        for name in ("package.json", "package-lock.json", "tsconfig.json"):
            shutil.copyfile(ROOT / "pi_agent/runtime" / name, runtime / name)
        shutil.copytree(ROOT / "pi_agent/runtime/src", runtime / "src")
        shutil.copyfile(ROOT / "docker/pi.Dockerfile", context / "Dockerfile")
        subprocess.run(["docker", "build", "--tag", args.image, "--build-arg",
                        "RUNTIME_SHA256=" + runtime_fingerprint(), str(context)], check=True)


if __name__ == "__main__":
    main()
