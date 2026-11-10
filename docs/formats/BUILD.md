# Building the RelaxNG schema

`varians.rng` is generated from `varians.odd` and committed; nobody needs the tools below to use or validate against it. Rebuild it whenever the ODD changes, and commit both.

```sh
docs/formats/build-rng.sh
```

The script needs Java (11 or later, as Saxon 12 does), `curl`, `unzip`, `sha256sum` and `xmllint`. It downloads the tools into `tools/tei/` at the root of the repository, which is git-ignored, each into a directory of its own, and refuses any file whose SHA-256 differs from the one recorded in the script. A second run uses what is already there. The output carries no date and no path of the machine (`useFixedDate=true`), so the same ODD gives the same file.

## Versions

| Tool                              | Version               | Source                                                                                                               | SHA-256                                                            |
| --------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| TEI Stylesheets                   | 7.61.0 (28 July 2026) | https://github.com/TEIC/Stylesheets/releases/download/v7.61.0/tei-xsl-7.61.0.zip                                     | `1a6cd1043af5adb3c5a8c1b2ec0b6abb7d0f241cd8725e233d691b3ca2f312bf` |
| TEI P5 source, `p5subset.xml`     | 4.12.0 (28 July 2026) | https://www.tei-c.org/Vault/P5/4.12.0/xml/tei/odd/p5subset.xml (the same file as in `tei-4.12.0.zip` of the release) | `5b89720edc6f3821ab3d0aa242aa5dc922bfbafabfb103d2de9d211001c33e26` |
| Saxon-HE                          | 12.9                  | https://repo1.maven.org/maven2/net/sf/saxon/Saxon-HE/12.9/Saxon-HE-12.9.jar                                          | `8f3a9216a537367132293eacbba9df062eace8f8b16a184af59e2e4839d4cd41` |
| XML Resolver (needed by Saxon 12) | 5.3.3                 | https://repo1.maven.org/maven2/org/xmlresolver/xmlresolver/5.3.3/xmlresolver-5.3.3.jar                               | `1fe4d5b92f708dcdb82dbce12919e0171e6b5ca62c6dca6220483625098feb5f` |
| `tei_all.rng`, for the tests only | 4.12.0                | https://www.tei-c.org/Vault/P5/4.12.0/xml/tei/custom/schema/relaxng/tei_all.rng                                      | `b0f115095ead2ccc6933aa3365c6f4a82cba3b2ec7eee7f76bb616d7a63b7e48` |

The Stylesheets and the P5 source are of the same TEI release. To move to a later release, change the versions and sums in `build-rng.sh`, rebuild, run the tests, and record the change in the changelog of the format.

## What the script runs

The Stylesheets' own `teitorelaxng` runs two transformations through Ant: `odds/odd2odd.xsl` expands the ODD against the P5 source, and `profiles/default/rng/to.xsl` (which imports `odds/odd2relax.xsl`) writes the schema. The release archive carries no Ant build, so the script runs the same two transformations with Saxon directly, with the parameters `teitorelaxng` passes:

```sh
CP=tools/tei/saxon-12.9/Saxon-HE-12.9.jar:tools/tei/xmlresolver-5.3.3/xmlresolver-5.3.3.jar
XSL=tools/tei/stylesheets-7.61.0/xsl/xml/tei/stylesheet

java -cp "$CP" net.sf.saxon.Transform -xi:on \
  -s:docs/formats/varians.odd -xsl:$XSL/odds/odd2odd.xsl -o:varians.compiled.odd \
  defaultSource=file://$PWD/tools/tei/p5-4.12.0/p5subset.xml \
  currentDirectory=$PWD/docs/formats verbose=false useFixedDate=true

java -cp "$CP" net.sf.saxon.Transform -xi:on \
  -s:varians.compiled.odd -xsl:$XSL/profiles/default/rng/to.xsl -o:docs/formats/varians.rng \
  inputDir=$PWD/docs/formats/ useFixedDate=true
```

It then checks that `xmllint` compiles the schema and accepts a minimal document before it replaces `varians.rng`.

## Validating

```sh
xmllint --noout --relaxng docs/formats/varians.rng some.tei.xml
```

The tests of the core (`packages/core/src/tei/validate.test.ts`) validate every kind of TEI the writers produce this way, and are skipped with a warning where `xmllint` is not installed. With the environment variable `TEI_ALL_RNG` set to `tools/tei/tei-all-4.12.0/tei_all.rng` they also validate every document against tei_all, which shows that the customization is a pure restriction of TEI; this is slow (xmllint compiles tei_all for every document, some seconds each).

```sh
TEI_ALL_RNG=$PWD/tools/tei/tei-all-4.12.0/tei_all.rng pnpm --filter @varians/core test
```

The schema also carries TEI's Schematron rules, which `xmllint --relaxng` does not check. Of those that apply to the elements of this customization, two could be broken by the writers, and the tests check them directly: an `<msIdentifier>` must not be empty or begin with `<altIdentifier>` (`msId_minimal`), and an element with `@subtype` must have `@type` (`subtypeTyped`). A full Schematron run needs an ISO Schematron processor, which is not among the tools above.

## Licence

The ODD and the generated RelaxNG are under the BSD 2-Clause licence. The TEI Stylesheets are dual-licensed by the TEI Consortium under CC BY-SA 3.0 and BSD-2-Clause, the TEI P5 source under CC BY 3.0 and BSD-2-Clause; Saxon-HE is under the Mozilla Public License 2.0 and the XML Resolver under the Apache License 2.0. None of them is part of Varians or of its releases.
