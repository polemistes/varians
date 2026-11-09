#!/usr/bin/env bash
# Build docs/formats/varians.rng from docs/formats/varians.odd with the TEI
# Stylesheets, as their own teitorelaxng does it (odd2odd, then the default
# profile's rng/to.xsl), run with Saxon directly since the release carries no
# Ant build. See BUILD.md beside this script.
#
# The tools are downloaded once into tools/tei/ at the root of the repository
# (git-ignored), each into a directory of its own, and checked against the
# SHA-256 sums below before use. Nothing downloaded is executed except the
# Saxon jar by java and the stylesheets by Saxon.

set -euo pipefail

STYLESHEETS_VERSION=7.61.0
STYLESHEETS_URL="https://github.com/TEIC/Stylesheets/releases/download/v${STYLESHEETS_VERSION}/tei-xsl-${STYLESHEETS_VERSION}.zip"
STYLESHEETS_SHA256=1a6cd1043af5adb3c5a8c1b2ec0b6abb7d0f241cd8725e233d691b3ca2f312bf

P5_VERSION=4.12.0
P5_URL="https://www.tei-c.org/Vault/P5/${P5_VERSION}/xml/tei/odd/p5subset.xml"
P5_SHA256=5b89720edc6f3821ab3d0aa242aa5dc922bfbafabfb103d2de9d211001c33e26
# tei_all of the same release, not used for the build: the tests also
# validate against it when TEI_ALL_RNG names it, to show that the
# customization is a pure restriction of TEI.
TEI_ALL_URL="https://www.tei-c.org/Vault/P5/${P5_VERSION}/xml/tei/custom/schema/relaxng/tei_all.rng"
TEI_ALL_SHA256=b0f115095ead2ccc6933aa3365c6f4a82cba3b2ec7eee7f76bb616d7a63b7e48

SAXON_VERSION=12.9
SAXON_URL="https://repo1.maven.org/maven2/net/sf/saxon/Saxon-HE/${SAXON_VERSION}/Saxon-HE-${SAXON_VERSION}.jar"
SAXON_SHA256=8f3a9216a537367132293eacbba9df062eace8f8b16a184af59e2e4839d4cd41
RESOLVER_VERSION=5.3.3
RESOLVER_URL="https://repo1.maven.org/maven2/org/xmlresolver/xmlresolver/${RESOLVER_VERSION}/xmlresolver-${RESOLVER_VERSION}.jar"
RESOLVER_SHA256=1fe4d5b92f708dcdb82dbce12919e0171e6b5ca62c6dca6220483625098feb5f

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TOOLS="$ROOT/tools/tei"
ODD="$HERE/varians.odd"
RNG="$HERE/varians.rng"

# fetch DIR URL SHA256: download URL into DIR (a new, empty directory) unless
# a file with the right sum is already there.
fetch() {
  local dir=$1 url=$2 sum=$3
  local file="$dir/$(basename "$url")"
  if [ -f "$file" ] && echo "$sum  $file" | sha256sum --check --status; then
    return
  fi
  rm -rf "$dir"
  mkdir -p "$dir"
  echo "Downloading $url" >&2
  curl --fail --silent --show-error --location --output "$file" "$url"
  if ! echo "$sum  $file" | sha256sum --check --status; then
    echo "SHA-256 of $file does not match $sum; refusing to use it." >&2
    exit 1
  fi
}

command -v java >/dev/null || { echo "java is required" >&2; exit 1; }

fetch "$TOOLS/stylesheets-$STYLESHEETS_VERSION" "$STYLESHEETS_URL" "$STYLESHEETS_SHA256"
fetch "$TOOLS/p5-$P5_VERSION" "$P5_URL" "$P5_SHA256"
fetch "$TOOLS/tei-all-$P5_VERSION" "$TEI_ALL_URL" "$TEI_ALL_SHA256"
fetch "$TOOLS/saxon-$SAXON_VERSION" "$SAXON_URL" "$SAXON_SHA256"
fetch "$TOOLS/xmlresolver-$RESOLVER_VERSION" "$RESOLVER_URL" "$RESOLVER_SHA256"

XSL="$TOOLS/stylesheets-$STYLESHEETS_VERSION/xsl"
if [ ! -f "$XSL/xml/tei/stylesheet/odds/odd2odd.xsl" ]; then
  rm -rf "$XSL"
  mkdir -p "$XSL"
  unzip -q "$TOOLS/stylesheets-$STYLESHEETS_VERSION/tei-xsl-$STYLESHEETS_VERSION.zip" -d "$XSL"
fi
STYLESHEET="$XSL/xml/tei/stylesheet"
P5="$TOOLS/p5-$P5_VERSION/p5subset.xml"
CP="$TOOLS/saxon-$SAXON_VERSION/Saxon-HE-$SAXON_VERSION.jar:$TOOLS/xmlresolver-$RESOLVER_VERSION/xmlresolver-$RESOLVER_VERSION.jar"

WORK="$(mktemp -d "$TOOLS/work.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

saxon() { java -cp "$CP" net.sf.saxon.Transform -xi:on "$@"; }

# 1. Expand the ODD against the pinned P5 source (teitorelaxng's "oddexpand").
saxon -s:"$ODD" -xsl:"$STYLESHEET/odds/odd2odd.xsl" -o:"$WORK/varians.compiled.odd" \
  defaultSource="file://$P5" currentDirectory="$HERE" verbose=false useFixedDate=true
# 2. The RelaxNG schema from the expanded ODD (teitorelaxng's "buildgeneric relaxng").
saxon -s:"$WORK/varians.compiled.odd" -xsl:"$STYLESHEET/profiles/default/rng/to.xsl" -o:"$WORK/varians.rng" \
  inputDir="$HERE/" useFixedDate=true

# useFixedDate keeps the date of the build out of the schema, so that a
# rebuild from the same ODD gives the same file. Check that xmllint can
# compile it before it replaces the committed one.
cat > "$WORK/probe.xml" <<'XML'
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>t</title></titleStmt><publicationStmt><p>p</p></publicationStmt><sourceDesc><p>s</p></sourceDesc></fileDesc></teiHeader><text><body><ab>a</ab></body></text></TEI>
XML
xmllint --noout --relaxng "$WORK/varians.rng" "$WORK/probe.xml"
cp "$WORK/varians.rng" "$RNG"
echo "Wrote $RNG" >&2
