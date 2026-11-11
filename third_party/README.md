# third_party — ソースコード一式

QCalc の計算エンジン（`app/jniLibs/arm64-v8a/libqalcengine.so`）に組み込んでいるライブラリの、ビルドに使ったソースそのものです。GNU GPL・LGPL が求める「対応するソースコード」として、このリポジトリに入れています。`fetch-sources.sh` はここから `src/` に展開します（ないファイルだけ元の場所からダウンロードします）。

| ファイル | 内容 | 入手元 | ライセンス |
| --- | --- | --- | --- |
| `libqalculate-5.13.2.tar.xz` | libqalculate 5.13.2（Qalculate! の計算エンジン） | https://github.com/Qalculate/libqalculate のタグ `v5.13.2`（コミット `d3672af9cf6e05a39bd4206b7b7d6b1e0d194caa`）を `git archive` で固めたもの | GNU GPL v2 以降 |
| `gmp_6.3.0+dfsg.orig.tar.xz` | GNU MP 6.3.0 | Ubuntu の配布物（https://archive.ubuntu.com/ubuntu/pool/main/g/gmp/）。文書の一部を除いた公式版 | GNU LGPL v3 以降 または GNU GPL v2 以降 |
| `mpfr4_4.2.2.orig.tar.xz` | GNU MPFR 4.2.2 | Ubuntu の配布物（https://archive.ubuntu.com/ubuntu/pool/main/m/mpfr4/）。公式版と同じ | GNU LGPL v3 以降 |
| `libxml2_2.15.4+dfsg.orig.tar.xz` | libxml2 2.15.4 | Ubuntu の配布物（https://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/） | MIT |

`SHA256SUMS` は Ubuntu から入手した 3 つのファイルのチェックサムです（`sha256sum -c SHA256SUMS` で確認できます）。

エンジンは `build-engine.sh` で、zig 0.17.1（`pip install ziglang==0.17.1`）を使って静的リンクしています。zig に同梱の musl libc（MIT）、LLVM libc++ / libc++abi / libunwind（Apache License 2.0 with LLVM Exceptions）、compiler_rt（MIT）も一緒に組み込まれます。これらのソースは zig の配布物に含まれています。

各ライセンスの全文は、アプリの「このアプリについて」→「オープンソースライセンス」でも読めます（`make-licenses.py` が `app/assets/licenses.js` を作ります）。
