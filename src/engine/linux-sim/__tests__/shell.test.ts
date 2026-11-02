import { describe, expect, it } from 'vitest';
import { createMachine, promptOf, run } from '..';
import { braceExpand, globToRegex } from '../expand';
import { parseScript, ParseError } from '../parse';
import { session } from './helpers';

describe('parser', () => {
  it('splits lists, pipelines and && ||', () => {
    const l = parseScript('a | b && c || d; e &');
    expect(l.items).toHaveLength(2);
    expect(l.items[0]!.first.cmds).toHaveLength(2);
    expect(l.items[0]!.rest.map((r) => r.op)).toEqual(['&&', '||']);
    expect(l.items[1]!.bg).toBe(true);
  });

  it('reads redirections, including 2>&1 and here documents', () => {
    const l = parseScript('cat <<EOF > out.txt 2>&1\nhello $USER\nEOF\n');
    const cmd = l.items[0]!.first.cmds[0]!;
    expect(cmd.k).toBe('simple');
    if (cmd.k !== 'simple') return;
    expect(cmd.redirs.map((r) => r.op)).toEqual(['<<', '>', '>&']);
    expect(cmd.redirs[0]!.heredoc).toBe('hello $USER\n');
  });

  it('says what bash says about bad syntax', () => {
    expect(() => parseScript('fi')).toThrow(ParseError);
    expect(() => parseScript('if true; then echo x')).toThrow(/unexpected end of file/);
    expect(() => parseScript('echo "open')).toThrow(/end of file/);
  });
});

describe('expansion', () => {
  it('brace expansion', () => {
    expect(braceExpand('shop/{menu,stock}')).toEqual(['shop/menu', 'shop/stock']);
    expect(braceExpand('day{1..3}.txt')).toEqual(['day1.txt', 'day2.txt', 'day3.txt']);
    expect(braceExpand("'{a,b}'")).toEqual(["'{a,b}'"]);
  });

  it('glob patterns', () => {
    expect(globToRegex('*.txt').test('menu.txt')).toBe(true);
    expect(globToRegex('*.txt').test('menu.log')).toBe(false);
    expect(globToRegex('day[12].txt').test('day2.txt')).toBe(true);
  });

  it('variables, quotes, $?, arithmetic and command substitution', () => {
    const s = session();
    s.sh('name="Kedai Kancil"');
    expect(s.out('echo $name')).toBe('Kedai Kancil');
    expect(s.out("echo '$name'")).toBe('$name');
    expect(s.out('echo "${name:-x} ${nope:-default}"')).toBe('Kedai Kancil default');
    expect(s.out('echo $((6 * 7))')).toBe('42');
    expect(s.out('echo "today is $(date +%F)"')).toBe('today is 2026-11-01');
    s.sh('false');
    expect(s.out('echo $?')).toBe('1');
    expect(s.out('echo ~')).toBe('/home/you');
    expect(s.out('echo ${#name}')).toBe('12');
  });

  it('expansion errors use bash words and drop the rest of a typed line', () => {
    const s = session();
    expect(s.out('echo $(( 7 / 0 ))')).toBe('-bash: 7 / 0 : division by 0 (error token is "0 ")');
    expect(s.out('echo ${shop:?not set}; echo after')).toBe('-bash: shop: not set');
    s.sh('set -u');
    expect(s.out('echo $NOPE; echo after')).toBe('-bash: NOPE: unbound variable');
    s.sh('set +u');
    expect(s.out('echo "[$NOPE]"')).toBe('[]');
  });

  it('globs match files, hidden files only with a dot', () => {
    const s = session();
    s.sh('touch a.txt b.txt .c.txt notes.log');
    expect(s.out('echo *.txt')).toBe('a.txt b.txt');
    expect(s.out('echo .*.txt')).toBe('.c.txt');
    expect(s.out('echo *.nope')).toBe('*.nope');
  });

  it('word splitting keeps quoted spaces', () => {
    const s = session();
    s.sh('x="a   b"');
    expect(s.out('printf "[%s]" $x')).toBe('[a][b]');
    expect(s.out('printf "[%s]" "$x"')).toBe('[a   b]');
  });
});

describe('control flow', () => {
  it('if / elif / else, for, while, case', () => {
    const s = session();
    expect(s.out('for i in 1 2 3; do echo "n$i"; done')).toBe('n1\nn2\nn3');
    expect(s.out('n=0; while [ $n -lt 3 ]; do n=$((n+1)); done; echo $n')).toBe('3');
    expect(s.out('x=7; if [ $x -lt 5 ]; then echo small; elif [ $x -lt 10 ]; then echo mid; else echo big; fi')).toBe('mid');
    expect(s.out('case kopi in teh) echo T;; kop*) echo K;; esac')).toBe('K');
    expect(s.out('true && echo yes || echo no')).toBe('yes');
    expect(s.out('false && echo yes || echo no')).toBe('no');
  });

  it('functions and return codes', () => {
    const s = session();
    s.sh('greet() { echo "hi $1"; return 4; }');
    expect(s.out('greet Aina')).toBe('hi Aina');
    expect(s.out('echo $?')).toBe('4');
  });

  it('test and [ ] with files and numbers', () => {
    const s = session();
    s.sh('mkdir d; touch f');
    expect(s.sh('[ -d d ]').exitCode).toBe(0);
    expect(s.sh('[ -f d ]').exitCode).toBe(1);
    expect(s.sh('test -e f').exitCode).toBe(0);
    expect(s.out('[ abc -gt 1 ]')).toBe('-bash: [: abc: integer expression expected');
  });

  it('an endless loop typed at the prompt becomes a busy program', () => {
    const s = session();
    s.sh('while true; do :; done');
    expect(s.st.fg?.cmd).toBe('while true; do :; done');
    expect(s.out('ls')).toBe('');
    expect(s.sh('^C').text).toBe('^C');
    expect(s.st.fg).toBeNull();
  });
});

describe('the prompt and the shell', () => {
  it('shows user@host:path$ and # for root', () => {
    const st = createMachine();
    expect(promptOf(st).text).toBe('you@kedai:~$ ');
    const r = run(st, 'sudo -i');
    expect(promptOf(r.state).text).toBe('root@kedai:~# ');
    const back = run(r.state, 'exit');
    expect(back.output.map((l) => l.map((x) => x.t).join('')).join('\n')).toBe('logout');
    expect(promptOf(back.state).text).toBe('you@kedai:~$ ');
  });

  it('command not found and permission errors use bash words', () => {
    const s = session();
    expect(s.out('gti status')).toBe('-bash: gti: command not found');
    expect(s.sh('gti').exitCode).toBe(127);
    expect(s.out('cd nope')).toBe('-bash: cd: nope: No such file or directory');
    expect(s.out('cd /root')).toBe('-bash: cd: /root: Permission denied');
    expect(s.out('cd .bashrc')).toBe('-bash: cd: .bashrc: Not a directory');
    expect(s.out('nano notes.txt')).toBe('-bash: nano: command not found');
  });

  it('export reaches child shells; plain variables do not', () => {
    const s = session();
    s.sh('SHOP=kedai');
    expect(s.out('bash -c \'echo "[$SHOP]"\'')).toBe('[]');
    s.sh('export SHOP');
    expect(s.out('bash -c \'echo "[$SHOP]"\'')).toBe('[kedai]');
    expect(s.out('printenv SHOP')).toBe('kedai');
  });

  it('cd - goes back and prints the folder', () => {
    const s = session();
    s.sh('cd /tmp');
    expect(s.out('cd -')).toBe('/home/you');
    expect(s.out('pwd')).toBe('/home/you');
  });

  it('PATH decides what runs; which and type explain it', () => {
    const s = session();
    s.sh('mkdir tools');
    s.sh('printf \'#!/bin/bash\\necho hello\\n\' > tools/hello');
    s.sh('chmod +x tools/hello');
    expect(s.out('hello')).toBe('-bash: hello: command not found');
    s.sh('export PATH="$HOME/tools:$PATH"');
    expect(s.out('hello')).toBe('hello');
    expect(s.out('which hello')).toBe('/home/you/tools/hello');
    expect(s.out('type cd')).toBe('cd is a shell builtin');
    expect(s.out('type ls')).toBe("ls is aliased to `ls --color=auto'");
  });

  it('redirections: >, >>, 2>, < and &>', () => {
    const s = session();
    s.sh('echo one > f.txt');
    s.sh('echo two >> f.txt');
    expect(s.out('cat f.txt')).toBe('one\ntwo');
    s.sh('ls nope 2> err.txt');
    expect(s.out('cat err.txt')).toBe("ls: cannot access 'nope': No such file or directory");
    expect(s.out('wc -l < f.txt')).toBe('2');
    s.sh('ls nope &> all.txt');
    expect(s.out('cat all.txt')).toContain('cannot access');
    expect(s.out('echo hi > /etc/hosts')).toBe('-bash: /etc/hosts: Permission denied');
  });
});
