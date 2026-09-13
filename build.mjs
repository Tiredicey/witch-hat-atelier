import { cp, mkdir, rm } from 'node:fs/promises';
await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
for (const entry of ['index.html', 'tokens.css', 'styles', 'js', 'worker/src']) await cp(new URL(`./${entry}`, import.meta.url), new URL(`./dist/${entry}`, import.meta.url), { recursive: true });
process.stdout.write('Built dist/. Keep root functions/ when deploying to Pages.\n');
