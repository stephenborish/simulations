#!/usr/bin/env python3
"""Build the read-only student edition of the DNA & Atoms Jeopardy game.

Reads dna-atoms-jeopardy.html (teacher edition) and dna-atoms-jeopardy-questions.json,
bakes the questions into the page, and strips every editing / cloud-sync feature.
Output: dna-atoms-jeopardy-student.html

Re-run after you publish new questions:  python3 build-student-jeopardy.py
"""
import json, pathlib, re, sys

root = pathlib.Path(__file__).parent
src = (root / 'dna-atoms-jeopardy.html').read_text(encoding='utf-8')
edits = json.loads((root / 'dna-atoms-jeopardy-questions.json').read_text(encoding='utf-8'))

m = re.search(r'const EDITS_V=(\d+);', src)
if not m or edits.get('v') != int(m.group(1)):
    sys.exit(f"Build failed: questions JSON version {edits.get('v')!r} does not match "
             f"the game's EDITS_V {m and m.group(1)}; republish the questions first.")

def sub(old, new, count=1):
    global src
    if src.count(old) != count:
        sys.exit(f'Build failed: expected {count} match(es) of {old[:70]!r}, found {src.count(old)}')
    src = src.replace(old, new)

# 1. Bake in the questions; ignore share links, local drafts and the cloud file.
payload = json.dumps(edits, ensure_ascii=False).replace('</', '<\\/')
sub('const EMBEDDED_EDITS = null;', 'const STUDENT_MODE = true;\nconst EMBEDDED_EDITS = ' + payload + ';')
sub("if (location.hash && location.hash.startsWith('#edits=')) {",
    "if (!STUDENT_MODE && location.hash && location.hash.startsWith('#edits=')) {")
sub("} else {\n  try {\n    const raw = localStorage.getItem(CKEY);",
    "} else if (!STUDENT_MODE) {\n  try {\n    const raw = localStorage.getItem(CKEY);")
sub('renderSetup();loadCloud();', 'renderSetup();')

# 2. Remove every edit entry point.
sub('        <button class="tool" id="edq">✏️ Edit questions &amp; answers</button>\n', '')
src, n = re.subn(r'      <button class="tool \$\{editMode\?\'on\':\'\'\}" id="edt".*?</button>\n', '', src, count=1)
if n != 1: sys.exit('Build failed: edit-toolbar button not found')
sub("  $('#edq').onclick=()=>{S={temp:true,teams:[],used:{},round:0,dd:{'0':[],'1':[]},log:[],final:{stage:0,w:{},judged:{}}};editMode=true;renderGame()};\n", '')
sub("  $('#edt').onclick=()=>{if(T){exitTemp();return}editMode=!editMode;renderGame()};\n", '')
sub('<button class="ghost" id="edit">Edit</button>', '')
sub("    m.querySelector('#edit').onclick=()=>{clearInterval(timerH);stopMusic();editClue()};\n", '')
sub('<button class="ghost" id="edF">Edit</button>', '')
sub("    m.querySelector('#edF').onclick=()=>{clearInterval(timerH);stopMusic();editFinal(question)};\n", '')
sub('function openEditor(cfg){', 'function openEditor(cfg){\n  return; // student edition: editing disabled')

# 3. Keep student game state separate from the teacher edition's saved games.
sub("const KEY='dna-atoms-jeopardy-v2';", "const KEY='dna-atoms-jeopardy-student-v1';")
sub('<title>DNA &amp; Atoms Jeopardy!</title>', '<title>DNA &amp; Atoms Jeopardy! (Student Edition)</title>')

out = root / 'dna-atoms-jeopardy-student.html'
out.write_text(src, encoding='utf-8')
print(f'Wrote {out.name} ({len(src):,} bytes)')
