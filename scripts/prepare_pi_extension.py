"""Install an extension directory's locked dependencies in the Linux Node build image."""
import argparse
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.expanduser().resolve()
    if not (directory / "package.json").is_file() or not (directory / "package-lock.json").is_file():
        parser.error("Provide an extension directory with package.json and package-lock.json")
    image = re.search(r"^FROM (\S+) AS node", (ROOT / "docker/pi.Dockerfile").read_text()).group(1)
    subprocess.run(["docker", "run", "--rm", "--user", f"{os.getuid()}:{os.getgid()}", "--env", "HOME=/tmp",
                    "--mount", f"type=bind,source={directory},target=/extension", "--workdir", "/extension",
                    image, "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], check=True)


if __name__ == "__main__":
    main()
