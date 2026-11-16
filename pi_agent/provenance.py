"""Content fingerprints for the exact runtime shipped to Docker."""
import hashlib
import subprocess
from pathlib import Path


def runtime_fingerprint():
    root = Path(__file__).parent / "runtime"
    files = [root / name for name in ("package.json", "package-lock.json", "tsconfig.json")]
    files += sorted((root / "src").rglob("*.ts"))
    digest = hashlib.sha256()
    dockerfile = root.parent.parent / "docker/pi.Dockerfile"
    digest.update(b"docker/pi.Dockerfile\0" + dockerfile.read_bytes())
    for path in files:
        digest.update(str(path.relative_to(root)).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def benchmark_provenance():
    root = Path(__file__).resolve().parent.parent
    digest = hashlib.sha256()
    files = [root / name for name in ("main.py", "runner.py", "only_test.py", "test_data_service.py", "requirements.txt")]
    for directory in ("docker_self", "openhands", "pi_agent", "scripts"):
        files += sorted((root / directory).glob("*.py"))
    for path in files:
        digest.update(path.relative_to(root).as_posix().encode() + b"\0" + path.read_bytes())
    try:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.SubprocessError):
        revision = None
    return {"revision": revision, "python_source_sha256": digest.hexdigest()}
