# third_party — source archives

**English** | [日本語](#日本語)

These are the exact sources used to build the libraries inside the QCalc calculation engine (`app/jniLibs/arm64-v8a/libqalcengine.so`). They are kept in this repository as the "corresponding source" that the GNU GPL and LGPL require. `fetch-sources.sh` extracts them into `src/` (it downloads a file from its original location only when the file is missing here).

| File | Contents | Origin | License |
| --- | --- | --- | --- |
| `libqalculate-5.13.2.tar.xz` | libqalculate 5.13.2 (the calculation engine of Qalculate!) | Made with `git archive` from the tag `v5.13.2` (commit `d3672af9cf6e05a39bd4206b7b7d6b1e0d194caa`) of https://github.com/Qalculate/libqalculate | GNU GPL v2 or later |
| `gmp_6.3.0+dfsg.orig.tar.xz` | GNU MP 6.3.0 | Ubuntu archive (https://archive.ubuntu.com/ubuntu/pool/main/g/gmp/): the official release without part of the documentation | GNU LGPL v3 or later, or GNU GPL v2 or later |
| `mpfr4_4.2.2.orig.tar.xz` | GNU MPFR 4.2.2 | Ubuntu archive (https://archive.ubuntu.com/ubuntu/pool/main/m/mpfr4/): the same as the official release | GNU LGPL v3 or later |
| `libxml2_2.15.4+dfsg.orig.tar.xz` | libxml2 2.15.4 | Ubuntu archive (https://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/) | MIT |
| `flint-3.6.0.tar.gz` | FLINT 3.6.0 (with Arb, used for special functions at a high precision) | The release tarball of https://github.com/flintlib/flint (https://github.com/flintlib/flint/releases/tag/v3.6.0) | GNU LGPL v3 or later |

`SHA256SUMS` holds the checksums of the three files from Ubuntu and of the FLINT release (check them with `sha256sum -c SHA256SUMS`).

QCalc changes two files of libqalculate (`Number.cc` and `Number.h`: special functions at a high precision are calculated with FLINT's Arb). The change is `patches/libqalculate-5.13.2-arb.patch`, which `fetch-sources.sh` applies after unpacking; see `patches/README.md`.

`build-engine.sh` links the engine statically with zig 0.17.1 (`pip install ziglang==0.17.1`). The musl libc (MIT), LLVM libc++ / libc++abi / libunwind (Apache License 2.0 with LLVM Exceptions) and compiler_rt (MIT) bundled with zig are linked in as well; their sources are part of the zig distribution.

The full text of every license can also be read in the app under "このアプリについて" (About this app) → "オープンソースライセンス" (Open source licenses). `make-licenses.py` generates `app/assets/licenses.js` for that screen.

## 日本語

QCalc の計算エンジン（`app/jniLibs/arm64-v8a/libqalcengine.so`）に組み込んでいるライブラリの、ビルドに使ったソースそのものです。GNU GPL・LGPL が求める「対応するソースコード」として、このリポジトリに入れています。`fetch-sources.sh` はここから `src/` に展開します（ないファイルだけ元の場所からダウンロードします）。

| ファイル | 内容 | 入手元 | ライセンス |
| --- | --- | --- | --- |
| `libqalculate-5.13.2.tar.xz` | libqalculate 5.13.2（Qalculate! の計算エンジン） | https://github.com/Qalculate/libqalculate のタグ `v5.13.2`（コミット `d3672af9cf6e05a39bd4206b7b7d6b1e0d194caa`）を `git archive` で固めたもの | GNU GPL v2 以降 |
| `gmp_6.3.0+dfsg.orig.tar.xz` | GNU MP 6.3.0 | Ubuntu の配布物（https://archive.ubuntu.com/ubuntu/pool/main/g/gmp/）。文書の一部を除いた公式版 | GNU LGPL v3 以降 または GNU GPL v2 以降 |
| `mpfr4_4.2.2.orig.tar.xz` | GNU MPFR 4.2.2 | Ubuntu の配布物（https://archive.ubuntu.com/ubuntu/pool/main/m/mpfr4/）。公式版と同じ | GNU LGPL v3 以降 |
| `libxml2_2.15.4+dfsg.orig.tar.xz` | libxml2 2.15.4 | Ubuntu の配布物（https://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/） | MIT |
| `flint-3.6.0.tar.gz` | FLINT 3.6.0（Arb を含む。高い精度の特殊関数に使用） | https://github.com/flintlib/flint のリリース版（https://github.com/flintlib/flint/releases/tag/v3.6.0） | GNU LGPL v3 以降 |

`SHA256SUMS` は Ubuntu から入手した 3 つのファイルと FLINT のリリース版のチェックサムです（`sha256sum -c SHA256SUMS` で確認できます）。

QCalc は libqalculate の 2 つのファイル（`Number.cc` と `Number.h`）を変更しています（高い精度の特殊関数を FLINT の Arb で計算する）。変更内容は `patches/libqalculate-5.13.2-arb.patch` で、`fetch-sources.sh` が展開のあとに当てます。詳しくは `patches/README.md` を見てください。

エンジンは `build-engine.sh` で、zig 0.17.1（`pip install ziglang==0.17.1`）を使って静的リンクしています。zig に同梱の musl libc（MIT）、LLVM libc++ / libc++abi / libunwind（Apache License 2.0 with LLVM Exceptions）、compiler_rt（MIT）も一緒に組み込まれます。これらのソースは zig の配布物に含まれています。

各ライセンスの全文は、アプリの「このアプリについて」→「オープンソースライセンス」でも読めます（`make-licenses.py` が `app/assets/licenses.js` を作ります）。
