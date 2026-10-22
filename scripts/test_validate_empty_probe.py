"""Independent, offline acceptance tests; no authentication or tenant calls."""
import hashlib
import importlib.util
import pathlib
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('probe_validator', pathlib.Path(__file__).with_name('validate-empty-probe.py'))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ProbePackageAcceptance(unittest.TestCase):
    def test_exact_empty_package_and_reject_changed_scope(self):
        manifest = '<ImportExportXml><SolutionManifest><UniqueName>CubeFarmResumeProbe</UniqueName><Managed>0</Managed><Publisher><UniqueName>exp</UniqueName><CustomizationPrefix>exp</CustomizationPrefix></Publisher><RootComponents /></SolutionManifest></ImportExportXml>'
        custom = '<ImportExportXml><Entities /><Languages><Language>1033</Language></Languages></ImportExportXml>'
        with tempfile.TemporaryDirectory(prefix='probe-validator-independent-') as directory:
            for fault in ['valid', 'component', 'entity', 'publisher', 'extra-file', 'wrong-name', 'managed']:
                with self.subTest(fault=fault):
                    entries = {'solution.xml': manifest, 'customizations.xml': custom, '[Content_Types].xml': '<Types />'}
                    if fault == 'component':
                        entries['solution.xml'] = manifest.replace('<RootComponents />', '<RootComponents><RootComponent type="1" /></RootComponents>')
                    if fault == 'entity':
                        entries['customizations.xml'] = custom.replace('<Entities />', '<Entities><Entity Name="exp_forbidden" /></Entities>')
                    if fault == 'publisher':
                        entries['solution.xml'] = manifest.replace('<CustomizationPrefix>exp</CustomizationPrefix>', '<CustomizationPrefix>bad</CustomizationPrefix>')
                    if fault == 'wrong-name':
                        entries['solution.xml'] = manifest.replace('CubeFarmResumeProbe', 'OtherSolution')
                    if fault == 'managed':
                        entries['solution.xml'] = manifest.replace('<Managed>0</Managed>', '<Managed>1</Managed>')
                    if fault == 'extra-file':
                        entries['Workflows/forbidden.json'] = '{}'
                    file = pathlib.Path(directory) / (fault + '.zip')
                    with zipfile.ZipFile(file, 'w') as archive:
                        for name, body in entries.items():
                            archive.writestr(name, body)
                    digest = hashlib.sha256(file.read_bytes()).hexdigest()
                    if fault == 'valid':
                        self.assertEqual(validator.validate(file, digest), digest)
                    else:
                        with self.assertRaises(ValueError):
                            validator.validate(file, digest)


if __name__ == '__main__':
    unittest.main()
