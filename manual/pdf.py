#!/usr/bin/env python3
"""Prints the web version of the user manual to A4 PDF files (docs/manual/<lang>/QCalc-manual-<lang>.pdf)
with Chromium (headless): page numbers at the foot of every page, and links from the contents.
Only the Python standard library; Chromium is the program given by CHROME (or found on the PATH).
  python3 manual/pdf.py [langs]"""
import os, shutil, subprocess, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = (sys.argv[1] if len(sys.argv) > 1 else 'ja,en,de,es,fr,ko,zh-TW').split(',')
chrome = os.environ.get('CHROME') or shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('chrome')
if not chrome:
    sys.exit('Chromium not found: give its path with CHROME=...')
for l in LANGS:
    src = os.path.join(R, 'docs', 'manual', l, 'index.html')
    out = os.path.join(R, 'docs', 'manual', l, 'QCalc-manual-%s.pdf' % l)
    subprocess.run([chrome, '--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw',
                    '--virtual-time-budget=8000', '--print-to-pdf=' + out, 'file://' + src], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(l, os.path.getsize(out), 'bytes')
