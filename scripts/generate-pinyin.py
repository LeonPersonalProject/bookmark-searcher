#!/usr/bin/env python3
"""Refresh the vendored table from a local Unicode 17.0.0 Unihan.zip."""

import collections
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
import zipfile


def without_tones(value):
    decomposed = unicodedata.normalize('NFD', value.lower())
    decomposed = decomposed.replace('u\u0308', 'v')
    return ''.join(character for character in decomposed
                   if not unicodedata.combining(character))


archive_path = Path(sys.argv[1])
archive = zipfile.ZipFile(archive_path)
readings = archive.read('Unihan_Readings.txt').decode('utf-8')
if '# Unicode Version 17.0.0' not in readings:
    raise SystemExit('Expected Unicode 17.0.0 Unihan data')

groups = collections.defaultdict(list)
for line in readings.splitlines():
    if '\tkMandarin\t' not in line:
        continue
    codepoint, _, values = line.split('\t')
    reading = without_tones(values.split()[0])
    if not re.fullmatch('[a-z]+', reading):
        raise SystemExit(f'Unexpected reading: {values}')
    groups[reading].append(chr(int(codepoint[2:], 16)))

table = '\n'.join(f'    {json.dumps(reading)}: {json.dumps("".join(characters), ensure_ascii=False)}'
                  + (',' if index < len(groups) - 1 else '')
                  for index, (reading, characters) in enumerate(sorted(groups.items())))
character_count = sum(len(characters) for characters in groups.values())
target = Path(__file__).resolve().parents[1] / 'pinyin.js'
source = target.read_text(encoding='utf-8')
replacement = ('  // BEGIN GENERATED UNIHAN DATA\n'
               f'  const characterCount = {character_count};\n'
               f'  const readingGroups = {{\n{table}\n  }};\n'
               '  // END GENERATED UNIHAN DATA')
source, count = re.subn(r'  // BEGIN GENERATED UNIHAN DATA.*?  // END GENERATED UNIHAN DATA',
                      lambda _: replacement, source, flags=re.S)
if count != 1:
    raise SystemExit('Expected exactly one data block in pinyin.js')
target.write_text(source, encoding='utf-8')
print(f'{character_count} characters, {len(groups)} readings; archive SHA-256: '
      f'{hashlib.sha256(archive_path.read_bytes()).hexdigest()}')
