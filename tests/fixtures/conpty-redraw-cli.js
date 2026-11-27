'use strict';
// A deterministic, offline stand-in for a CLI's initial screen. ConPTY owns the
// resize repaint; this process deliberately does not listen for resize events.
process.stdout.write('LEGAL-REPEATED-OUTPUT\r\n'.repeat(2));
process.stdout.write(Array.from({length:50},(_,i)=>'HISTORY-'+String(i).padStart(3,'0')+'-'+('x'.repeat(95))+'\r\n').join(''));
process.stdout.write('\x1b[2J\x1b[HCLAUDE-FIXTURE-BANNER\r\n'+'Warning context '+('x'.repeat(100))+'\r\nPROMPT> ');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data',data=>{if(data.includes('q'))process.exit(0);});
process.stdin.resume();
