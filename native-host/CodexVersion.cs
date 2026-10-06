using System;
using System.Text.RegularExpressions;

namespace PdfCopilot {
    internal static class CodexVersion {
        internal const string Required = "0.159.2";
        private static readonly Version Minimum = new Version(0, 159, 2);
        // Codex's official builds can include semver prerelease/build suffixes. Parenthesized
        // fixture/build labels are harmless metadata, not a different numeric API baseline.
        private static readonly Regex Pattern = new Regex(@"^codex-cli[ \t]+(?<version>[0-9]+\.[0-9]+\.[0-9]+)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:[ \t]+\([0-9A-Za-z ._/-]{1,80}\))?$", RegexOptions.CultureInvariant);
        internal static bool TryParse(string raw, out Version version) {
            version = null;
            if (raw == null || raw.Length > 256) return false;
            var match = Pattern.Match(raw.Trim());
            return match.Success && Version.TryParse(match.Groups["version"].Value, out version);
        }
        internal static bool IsCompatible(string raw) {
            Version version;
            return TryParse(raw, out version) && version >= Minimum;
        }
        internal static string Error(string raw, string path) {
            Version parsed;
            if (!TryParse(raw, out parsed)) return "Could not recognize the version reported by the configured Codex executable at " + path + ". PDF Copilot requires Codex CLI " + Required + " or newer. Update Codex or reinstall the helper with the correct -CodexPath.";
            return "The configured Codex executable at " + path + " reports " + raw + ". PDF Copilot requires Codex CLI " + Required + " or newer for its verified restricted protocol. Update that executable or reinstall the helper with -CodexPath pointing to a supported version. This version check does not determine login status.";
        }
    }
}
