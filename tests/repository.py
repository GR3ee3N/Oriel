import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def versions(root=ROOT):
    return dict(line.split("=", 1) for line in (root / "build/versions.env").read_text().splitlines()
                if line and not line.startswith("#"))


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="oriel-tools-test-")))
        self.root = self.temporary / "repo"
        shutil.copytree(ROOT, self.root, ignore=shutil.ignore_patterns(".git", ".cache", "node_modules", "dist", "__pycache__"))
        self.bin = self.temporary / "bin"
        self.bin.mkdir()
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", TEST_ROOT=str(self.root))
        self.v = versions(self.root)["VERSION"]
        self.f = versions(self.root)["FRAMEWORK_VERSION"]

    def executable(self, name, text):
        path = self.bin / name
        path.write_text(text)
        path.chmod(0o755)

    def command(self, *args, success=True, cwd=None, **env):
        result = subprocess.run(args, cwd=cwd or self.root, env=dict(self.env, **env), capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result.stdout.strip() + result.stderr.strip()

    def init_git(self):
        self.command("git", "init", "-q", "-b", "main")
        self.command("git", "config", "user.name", "Release test")
        self.command("git", "config", "user.email", "test@example.invalid")
        self.commit("Release inputs")
        origin = self.temporary / "origin.git"
        self.command("git", "init", "--bare", "-q", str(origin))
        self.command("git", "remote", "add", "origin", str(origin))

    def commit(self, message):
        self.command("git", "add", ".")
        self.command("git", "commit", "-qm", message)

    def npm(self):
        self.executable("npm", '#!' + sys.executable + '\n' + '''
import json,os,subprocess,sys
from pathlib import Path
root=Path(os.environ['TEST_ROOT'])
cache=root/'.cache'; cache.mkdir(exist_ok=True)
command=' '.join(sys.argv[1:])
with (cache/'commands').open('a') as f: f.write(command+'\\n')
if command==os.environ.get('TEST_FAIL_NPM'): sys.exit(1)
web=Path.cwd()
if command=='ci':
    for name in json.loads((web/'package.json').read_text())['dependencies']:
        package=web/'node_modules'/name; package.mkdir(parents=True,exist_ok=True)
        (package/'package.json').write_text(json.dumps({'name':name,'version':'1.0.0','license':'MIT'}))
        (package/'LICENSE').write_text('Test dependency license')
elif command=='run build':
    (web/'dist/assets').mkdir(parents=True,exist_ok=True)
    (web/'dist/index.html').write_text('<script type="module" src="./assets/app.js"></script>')
    (web/'dist/assets/app.js').write_text('export const page = "built";')
    if os.environ.get('TEST_PUBLISH'):
        state=Path(os.environ['TEST_GITHUB'])/'state.json'
        data=json.loads(state.read_text()); data['releases'][os.environ['TEST_PUBLISH']]=False
        state.write_text(json.dumps(data))
    if os.environ.get('TEST_CHANGE'):
        (root/'CHANGES').write_text('Changed during build')
        if os.environ['TEST_CHANGE']=='commit':
            subprocess.run(['git','add','.'],cwd=root,check=True)
            subprocess.run(['git','commit','-qm','During build'],cwd=root,check=True)
''')
