#!/usr/bin/env python3
"""Configuration regression only: this does not prove authentication behavior."""

from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[3]
PACKAGES = ROOT / "content-packages"
CONFIG = PACKAGES / "content-liberia-national/configuration"
THRESHOLD = "security.allowedFailedLoginsBeforeLockout"
RECOVERY = "security.unlockAccountWaitingTime"
VARIABLE = "var.security.login.allowed-failures-before-lockout"
OBSOLETE = {"security.loginAttemptsBeforeLockout", "security.validTime"}


def properties(path):
    return dict(
        line.strip().split("=", 1)
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#") and "=" in line
    )


class AccountLockoutConfigurationTest(unittest.TestCase):
    def setUp(self):
        self.gps = ET.parse(CONFIG / "backend_configuration/globalproperties/gp-security.xml")
        self.values = {
            gp.findtext("property"): gp.findtext("value")
            for gp in self.gps.findall("./globalProperties/globalProperty")
        }

    def test_fifth_failure_boundary(self):
        # Core 2.8.8 compares attempts > allowedFailedLoginCount. This guards the
        # shipped input, not a reimplementation of the authentication algorithm.
        self.assertEqual(self.values[THRESHOLD], "${" + VARIABLE + "}")
        self.assertEqual(properties(CONFIG / "variables.properties")[VARIABLE], "4")

    def test_existing_recovery_policy_is_preserved_in_minutes(self):
        self.assertEqual(self.values[RECOVERY], "5")

    def test_no_competing_global_properties_in_other_layers(self):
        definitions = {THRESHOLD: [], RECOVERY: []}
        for path in PACKAGES.glob("*/configuration/backend_configuration/globalproperties/*"):
            if path.suffix not in {".xml", ".csv"}:
                continue
            text = path.read_text()
            for obsolete in OBSOLETE:
                self.assertNotIn(obsolete, text, str(path))
            if path.suffix == ".xml":
                for gp in ET.parse(path).findall("./globalProperties/globalProperty"):
                    name = gp.findtext("property")
                    if name in definitions:
                        definitions[name].append(path)
            else:
                for name in definitions:
                    self.assertNotIn(name, text, str(path))
        for name, paths in definitions.items():
            self.assertEqual(len(paths), 1, f"Competing/missing {name}: {paths}")

    def test_no_stale_variable_or_layer_override(self):
        for path in PACKAGES.glob("*/configuration/variables.properties"):
            values = properties(path)
            self.assertNotIn("var.security.login.max-attempts", values, str(path))
            if VARIABLE in values:
                self.assertEqual(values[VARIABLE], "4", str(path))


if __name__ == "__main__":
    unittest.main()
