# patches — QCalc's changes to libqalculate

**English** | [日本語](#日本語)

`fetch-sources.sh` unpacks libqalculate 5.13.2 into `src/` and then applies every
`libqalculate-5.13.2-*.patch` here (`patch -p1` in `src/libqalculate-5.13.2`).

| Patch | Files | What it changes |
| --- | --- | --- |
| `libqalculate-5.13.2-arb.patch` | `libqalculate/Number.cc`, `libqalculate/Number.h` | Special functions of real numbers at a precision of 100 digits or more are calculated with Arb (part of FLINT 3.6.0) when `QALC_USE_ARB` is defined (`build-engine.sh` defines it): zeta, gamma, digamma, erf, erfc, erfinv, airy, besselj, bessely, polylog, Ei, li, Si, Ci, Shi, Chi. |

Why: at a high precision the MPFR functions and the series of libqalculate are slow. With 200,000
digits, for example, zeta(3) and gamma(1/3) did not finish within minutes, and Si(1) gave no result
from 100,000 digits; Arb takes a fraction of a second for these. Arb returns a ball that is guaranteed
to contain the exact value. It becomes the interval of the result, so libqalculate still shows only
digits that are certain. For complex numbers, below 100 digits, and when Arb cannot reach the
precision, libqalculate calculates as before.

To make the patch again after changing the files: unpack the original files from
`third_party/libqalculate-5.13.2.tar.xz` into a folder `a/` and run
`diff -u a/libqalculate/Number.cc src/libqalculate-5.13.2/libqalculate/Number.cc` (and the same for
`Number.h`) with the paths written as `a/…` and `b/…`.

## 日本語

`fetch-sources.sh` は libqalculate 5.13.2 を `src/` に展開したあと、ここにある
`libqalculate-5.13.2-*.patch` をすべて当てます（`src/libqalculate-5.13.2` で `patch -p1`）。

| パッチ | ファイル | 変更内容 |
| --- | --- | --- |
| `libqalculate-5.13.2-arb.patch` | `libqalculate/Number.cc`、`libqalculate/Number.h` | `QALC_USE_ARB` が定義されているとき（`build-engine.sh` が定義します）、精度 100 桁以上の実数の特殊関数を Arb（FLINT 3.6.0 の一部）で計算します：zeta、gamma、digamma、erf、erfc、erfinv、airy、besselj、bessely、polylog、Ei、li、Si、Ci、Shi、Chi。 |

理由：高い精度では、MPFR の関数や libqalculate の級数が遅いためです。たとえば 200,000 桁では zeta(3) や gamma(1/3) が数分たっても終わらず、Si(1) は 100,000 桁から結果が出ませんでした。Arb ならどれも 1 秒もかかりません。Arb は真の値を必ず含む「球（区間）」を返し、それが結果の区間になるので、libqalculate は今までどおり確かな桁だけを表示します。複素数、100 桁未満、Arb で精度が足りないときは、これまでどおり libqalculate が計算します。

ファイルを変えたあとにパッチを作り直すには、`third_party/libqalculate-5.13.2.tar.xz` から元のファイルを `a/` に展開し、`diff -u` で `src/libqalculate-5.13.2/libqalculate/Number.cc`（と `Number.h`）と比べます（パスは `a/…` と `b/…` の形にします）。
