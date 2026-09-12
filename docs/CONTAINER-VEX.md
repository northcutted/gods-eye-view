# 🛡️ Do these library findings affect the app?

**A library can contain a bug without the app using the part that triggers it.**
Our image scanner found four High/Critical issues in libraries shipped with
the container. This assessment asks the next question: can this app reach the
affected operations?

That's what **VEX**—Vulnerability Exploitability eXchange—is for: recording an
evidence-backed answer for a specific product and vulnerability. A **CVE** is
the public identifier for a reported vulnerability, such as CVE-2026-5450.
Neither term means "ignore everything from this library."

This is a snapshot from **2026-09-12 UTC**, covering four Debian package
findings in the tested God's Eye View images. It is not a security audit of
everything Node can do. Just want to run the app? Start with the
[Docker guide](CONTAINERS.md).

## The short answer

The evidence supports **proposing an exception for each of the four findings
in these exact application images**. In VEX terms, that is `not_affected`, with
the reason `vulnerable_code_not_in_execute_path`: the app does not use the
operations needed to trigger the bug.

**No VEX exceptions are enabled.** The release policy now separately accepts
findings without an available fix: Grype's `wont-fix`, `not-fixed`, and unknown
states are report-only. That policy does not turn these proposals into approved
`not_affected` statements. The libraries remain present and unpatched, and the
evidence does not automatically apply to a different image, an updated app,
or a general-purpose Node container.

| Finding        | What the bug involves                                            | Why an app-specific exception is proposed                                                  | Confidence                         |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| CVE-2026-5450  | A particular native text-parsing format                          | The reviewed callers do not use that format or let requests choose one                     | High                               |
| CVE-2026-5928  | Pushing characters back into a native wide-character file stream | The indirect library caller handles a kind of file input the reviewed app paths do not use | Medium-high; closest review needed |
| CVE-2026-5435  | Older DNS debugging/printing functions                           | The app looks up addresses but does not use these debugging functions                      | High                               |
| CVE-2026-85091 | A gzip-file writing operation                                    | No reviewed consumer uses the affected Debian package's file-writing API                   | High for that package only         |

Node includes **another copy of zlib inside its executable**. An exception for
Debian's `zlib1g` must not silently cover that separate copy. The detailed
evidence below explains the distinction.

## Which images does this cover?

A **digest** is an image's content fingerprint. An exception tied to it must
not carry over to new image bytes just because the tag or application name
stays the same. The machine-readable [evidence record](security/container-vex/evidence.json)
keeps the exact image, platform, and package identities together.

<details>
<summary>Exact image fingerprints and package versions</summary>

The three glibc findings match `libc6 2.41-12+deb13u3`; the zlib finding matches
`zlib1g 1:1.3.dfsg+really1.3.1-1+b1`, on both platforms.

The local validation index is
`sha256:f79bf925ec74e09c1e4f391cb0631666ef17e12e5e5aebd388ad7f19910a4fec`.

| Platform    | Application manifest                                                      |
| ----------- | ------------------------------------------------------------------------- |
| linux/amd64 | `sha256:473bb6f98da445b7416f5d36a1d6c28337b29ff030c4a46db5a82cd8e9bddadd` |
| linux/arm64 | `sha256:35d4a9e65095dc4131eb7f666781dcaad34b842acacf7fc2339c2a09949c74cc` |

Both derive from distroless index
`sha256:f7e3539249fa844f7019255d3ed1acb5faf626006607a602f8a24d59f0a97c6c`.
Source checkout: HEAD `350896a` plus the uncommitted deployment implementation.
**The Git commit alone does not identify these built application bytes.** A
future GitHub build needs its own subject digests and reviewed evidence.

Both platform graphs contain runtime SPDX SBOMs (97 package observations),
builder SPDX SBOMs (449 observations), and BuildKit SLSA v1 provenance. These
local attestations do not establish hosted SLSA Build L3 publication.

</details>

## How we checked

We inspected the native programs and libraries in both the AMD64 and ARM64
images, reviewed the matching Node source, and ran debugger checks against the
exact ARM64 Node binary and libraries. Those checks covered local HTTP routes,
DNS, text handling, files, compression, and shutdown.

We also used **positive controls**: small, safe tests that deliberately call
the operations we are watching. That confirms the debugger can see a call when
it happens. "The test didn't crash" would not be enough on its own.

**The limits matter.** This was a bounded set of tests, not proof of every
possible execution path. AMD64 still needs a native test run before activating
release-specific exceptions. No live paid-provider testing or claim that the
libraries themselves are fixed is included.

<details>
<summary>Technical method and evidence, including the native function names</summary>

### Method and boundaries

Before testing, the assessment rubric required exact component/image matching,
upstream precondition analysis, native/application call-path inspection,
bounded dynamic tests with positive controls, and explicit scope/uncertainty.

- Inspected all regular ELF files in both images: 285 AMD64 and 284 ARM64.
  Recorded file hashes, `DT_NEEDED`, undefined symbols, and relevant exports.
  No native ELF modules were present under `/app`.
- Reviewed the official Node 26.8.2 source archive, SHA-256
  `36b37bf5ee4d092b9d9dff2d1a90b1444f8b453eddf6ff96cabdebb97d32f41d`,
  matching the official distribution checksum list. Reviewed native scanf
  formats and gzip/wide-stream callers together with the application bundle.
- Used GDB 16.3 breakpoints on the exact ARM64 Node executable and image
  libraries. The analysis container's loader was byte-identical to the image
  loader. HTTP fixtures, DNS, Unicode/Intl, file I/O, OS metrics, compression,
  fetch gzip decoding, production startup/routes, and SIGTERM completed.
- Safe positive controls hit `__isoc99_sscanf` with `%3mc`, `ungetwc`,
  `__fp_nquery`, and Node's embedded `gzwrite`, `gzprintf`, `gzvprintf`, and
  `gz_vacate`. The ordinary workload hit only fixed numeric scanf formats,
  not the other sinks. Both processes exited normally.

The debugger run used extracted, hash-identified binaries in an analysis
container, not a production deployment. Separate image smoke tests exercised
the read-only/nonroot container contract. Dynamic coverage was ARM64 only;
AMD64 received image/linkage/source inspection. No ASAN exploit reproduction,
exhaustive native call-graph proof, live paid-provider testing, or proof of
absence of other vulnerabilities is claimed. Negative traces corroborate the
static reasoning; they do not independently prove non-reachability.

The threat boundary is untrusted HTTP/provider data entering the shipped
application. Arbitrary native execution, entrypoint replacement, operator
supplied preload modules, and an already-compromised process are outside this
assessment. Node 26 has FFI capability: it is **not** safe to assume JavaScript
can never invoke native APIs. This application exposes no FFI, addon-loading,
user-code evaluation, or native-symbol lookup interface.

### CVE-2026-5450: allocating scanf conversion

The [upstream advisory](https://sourceware.org/git/?p=glibc.git;a=blob_plain;f=advisories/GLIBC-SA-2026-0009)
requires a GNU malloc-backed character conversion with a selected width above 1024. Attacker-controlled input bytes alone do not select that format.

Node does import `sscanf`, `__isoc99_sscanf`, and `fscanf`; absence of scanf is
**not** the rationale. Reviewed Linux callers parse fixed numeric/kernel/CPU
formats in libuv and V8, numeric ports in OpenSSL, and fixed fields in the
remaining native sources. No reviewed caller supplies the allocating `%mc`
conversion or a format selected by request data. ARM64 tracing observed the
same fixed numeric formats; the safe allocating-format control was detected.

Proposed scope: this CVE, these two application manifests, and their exact
`libc6` package identities. Reassess on a Node/native-library upgrade, any
native extension or FFI use, or any new dynamic-format parsing path. This is
not a claim that glibc's vulnerable code was removed.

### CVE-2026-5928: wide-character FILE pushback

The [upstream advisory](https://sourceware.org/git/?p=glibc.git;a=blob_plain;f=advisories/GLIBC-SA-2026-0010)
concerns wide-character FILE pushback and incorrect stream-buffer access.
Unicode excludes one under-read scenario, but does not by itself rule out the
separate null-pointer crash scenario; UTF-8 alone is not an exception rationale.

`libstdc++.so.6.0.33` imports `ungetwc` in both images. ARM64 disassembly places
its direct calls in `__gnu_cxx::stdio_sync_filebuf<wchar_t>::underflow` and
`pbackfail`. Node's wide-stream imports are string-buffer/string-stream
operations; it has no imports of the wide FILE buffer or `wcin`. Reviewed
source has no operational `ungetwc` caller or wide standard-input consumer.
Windows import-name tables are data, not Linux calls. Node's ordinary file and
network paths operate on byte buffers; Intl/JavaScript strings do not establish
a C wide-character FILE stream. The workload did not hit `ungetwc`; the
positive control did.

This is the most indirect of the four arguments and merits explicit owner
review. Reassess if native code starts reading wide FILE streams, standard
input, or using `stdio_sync_filebuf<wchar_t>`. A direct-symbol-only check would
have missed the C++ dependency and is not sufficient for future renewals.

### CVE-2026-5435: deprecated DNS printing

The [upstream advisory](https://sourceware.org/git/?p=glibc.git;a=blob_plain;f=advisories/GLIBC-SA-2026-0011)
identifies the TSIG presentation path in `ns_sprintrrf` and related deprecated
printing functions. It explicitly separates those debug interfaces from the
DNS resolver's execution path. Search both `printrr` and `sprintrr` spellings;
the prose and actual symbol names differ.

Neither image contains a consumer importing those printing entry points. Node
uses its built-in c-ares and the ordinary OS lookup path, not DNS debug-record
presentation. The production workload's loaded-object list did not include
`libresolv`; the positive control deliberately loaded it and hit
`__fp_nquery`. Malicious DNS response bytes alone do not create a call to this
unused presentation interface. Reassess if DNS packet pretty-printing,
resolver debugging, FFI, or native DNS utilities are introduced.

### CVE-2026-85091: zlib gzip-file API

The [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-85091)
marks the installed package vulnerable, while its description names an
upstream range beginning at 1.3.1.2. The
[upstream issue](https://github.com/madler/zlib/issues/1310) did not provide a
maintainer resolution when checked. The
[1.3.1 source](https://github.com/madler/zlib/blob/v1.3.1/gzwrite.c) lacks
`gz_vacate`. **Do not infer `fixed` or correct Debian's package status from the
version string alone.** The proposed exception does not depend on that dispute.

Node does not dynamically link Debian `libz`. Its only ELF consumer in either
image is Debian `libcrypto`, whose zlib imports are inflate/deflate operations,
not gzip-file APIs. That system crypto library was not loaded by the ordinary
probe; Node embeds its own OpenSSL and zlib. No shipped application/native
consumer was found invoking the Debian package's `gzwrite`/`gzprintf` path.

Separately, Node embeds `1.3.2.1-motley-5eb4d7e` and **does contain** `gz_vacate`
and the gzip-file writer. The exact source includes the relevant buffer-moving
operation. This copy is distinct from the scanner's `zlib1g` subject. Node's
reviewed compression binding uses inflate/deflate; the source's gzip-file
callers are library implementations and standalone test tools, not an
application API used here. The positive control hit Node's embedded functions,
while compression and fetch decoding did not.

Do not create a CVE-ID-wide ignore: it would also suppress a future finding
against Node's embedded copy without a matching component assessment. Keep
that copy visible in the native dependency inventory and reassess it if the
scanner adds coverage, upstream clarifies the advisory, or native/FFI gzip-file
usage is introduced. This review does not declare the embedded copy fixed.

</details>

## What has to happen before an exception is used?

These steps belong to release maintenance, not everyday Docker setup. They
keep an exception specific, reviewable, and temporary.

1. **Review the reasoning.** The repository owner needs to review all four,
   especially the indirect wide-character file-input case. This document does
   not imply their approval or signature.
2. **Name the exact image and package.** Use the release image digest and its
   package PURL—a standard package identifier—including version and platform
   from the SBOM. Do not match only a tag, library name, or CVE number. These
   local image digests cannot stand in for a future GitHub build.
3. **Test the release again.** Run the probes natively on both architectures
   and check the actual application and native-library inputs. A new image,
   dependency, or base needs a new review, not a copied conclusion.
4. **Sign and keep the evidence.** Sign the reviewed VEX separately from the
   build record and attach it to the exact image. Before applying it, verify
   who signed it, what image/package it covers, and whether its review is
   still current. Keep the original scan as well as the filtered result,
   dependency inventory, build records, and assessment.
5. **Review within 30 days.** Release policy must enforce that window; OpenVEX
   has no built-in expiry field that makes Grype do it automatically. Missing,
   stale, mismatched, or untrusted VEX must not bypass a fixable release blocker.
   Prefer updating to a fixed package over repeatedly renewing an exception.
6. **Test the exception's limits.** A wrong image, architecture, package,
   version, CVE, signer, or expired review must not match. Another High finding
   with an available fix must still block release. The separate `only-fixed`
   policy accepts unfixed risk; it does not establish VEX non-applicability.

These conditions are a proposed activation policy, **not implemented gate
behavior**. The [OpenVEX specification](https://github.com/openvex/spec/blob/main/OPENVEX-SPEC.md)
defines the statement semantics; the
[Grype filtering documentation](https://oss.anchore.com/docs/guides/vulnerability/filter-results/)
explains why VEX consumption and trust/freshness policy must be considered
separately. No VEX document is passed to the current workflow.

## Inspect the evidence

The compact [evidence record](security/container-vex/evidence.json),
[ordinary native trace](security/container-vex/runtime-trace.txt), and
[positive-control trace](security/container-vex/positive-trace.txt) are retained
in the repository. Raw inspection data, source archive, probe tooling, and
per-CVE validation receipts were local assessment artifacts and are not included
in this repository. The retained record is not a complete reproducibility bundle;
repeat the assessment and retain that bundle before activating an exception.
Logs contain only controlled test data, not provider
credentials. See also the [container validation record](CONTAINER-VALIDATION.md).
