"""Run Python contracts and isolated SDK mock tests. Makes no real-model requests."""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    os.chdir(ROOT)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests/unit", "-p", "test_*.py"], check=True, env=env)
    node_image = re.search(r"^FROM (\S+) AS node", (ROOT / "docker/pi.Dockerfile").read_text()).group(1)
    runtime = ROOT / "pi_agent/runtime"
    arguments = ["docker", "run", "--rm", "--user", f"{os.getuid()}:{os.getgid()}",
                 "--env", "HOME=/tmp", "--env", "PI_OFFLINE=1", "--mount",
                 f"type=bind,source={runtime},target=/runtime", "--workdir", "/runtime"]
    if not (runtime / "node_modules").is_dir():
        subprocess.run([*arguments, node_image, "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], check=True)
    for script in ("typecheck", "test"):
        subprocess.run([*arguments, "--network", "none", node_image, "npm", "run", script], check=True)


if __name__ == "__main__":
    main()
