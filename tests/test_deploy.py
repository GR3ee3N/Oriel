from .repository import RepositoryTests


class DeployTests(RepositoryTests):
    def setUp(self):
        super().setUp()
        self.npm()
        self.env["BOX"] = "test-target"
        self.executable("ssh", '''#!/usr/bin/env python3
import os,sys
from pathlib import Path
cache=Path(os.environ['TEST_ROOT'])/'.cache'; cache.mkdir(exist_ok=True)
command=' '.join(sys.argv[1:])
with (cache/'ssh').open('a') as f: f.write(command+'\\n')
if 'test -f' in command and os.environ.get('TEST_NO_BOX_TOOLS'): sys.exit(1)
if '--enable' in command and os.environ.get('TEST_FAIL_ENABLE'): sys.exit(1)
''')
        self.executable("rsync", '''#!/usr/bin/env python3
import os,subprocess,sys
from pathlib import Path
if sys.argv[-1].startswith('test-target:'):
    cache=Path(os.environ['TEST_ROOT'])/'.cache'
    (cache/'transferred').touch()
    if os.environ.get('TEST_FAIL_TRANSFER'): sys.exit(1)
else:
    sys.exit(subprocess.run(['/usr/bin/rsync',*sys.argv[1:]]).returncode)
''')

    def test_retry_after_failed_activation_enables_again(self):
        self.command("tools/deploy.sh", success=False, TEST_FAIL_ENABLE="1")
        self.assertTrue((self.root / ".cache/transferred").exists())
        self.assertIn("installed script.oriel.oriel", self.command("tools/deploy.sh"))
        calls = (self.root / ".cache/ssh").read_text().splitlines()
        self.assertEqual(sum("--enable 'script.oriel.oriel'" in line for line in calls), 2)
        self.assertNotIn("sleep", "\n".join(calls))

    def test_failed_transfer_does_not_report_success_or_activate(self):
        output = self.command("tools/deploy.sh", success=False, TEST_FAIL_TRANSFER="1")
        self.assertNotIn("installed script.oriel.oriel", output)
        calls = (self.root / ".cache/ssh").read_text()
        self.assertNotIn("--enable", calls)
        self.assertNotIn("UpdateLocalAddons", calls)

    def test_missing_framework_tools_stop_before_build(self):
        self.assertIn("no box tools", self.command("tools/deploy.sh", success=False, TEST_NO_BOX_TOOLS="1"))
        self.assertFalse((self.root / ".cache/commands").exists())

    def test_failed_build_does_not_transfer_or_activate(self):
        self.command("tools/deploy.sh", success=False, TEST_FAIL_NPM="run build")
        self.assertFalse((self.root / ".cache/transferred").exists())
        self.assertNotIn("--enable", (self.root / ".cache/ssh").read_text())
