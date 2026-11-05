#!/usr/bin/env python3
"""Reassemble byte-identical WebP assets from small Git source parts. No network."""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'asset-parts.json').read_text())
for name,entry in manifest.items():
    target=root/'assets'/name
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==entry['sha256']:
        continue
    blocks=[]
    for part in entry['chunks']:
        block=(root/part['file']).read_bytes()
        if len(block)!=part['bytes'] or hashlib.sha256(block).hexdigest()!=part['sha256']:
            raise ValueError('Invalid source part: '+part['file'])
        blocks.append(block)
    data=b''.join(blocks)
    if len(data)!=entry['bytes'] or hashlib.sha256(data).hexdigest()!=entry['sha256']:
        raise ValueError('Invalid restored image: '+name)
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(data)
for entry in json.loads((root/'素材来源.json').read_text()).values():
    target=root/'assets'/entry['runtime_file']
    if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest()!=entry['runtime_sha256']:
        raise ValueError('Missing or damaged runtime image: '+entry['runtime_file'])
print('Ready: all 19 original-quality runtime images are available in assets/.')
