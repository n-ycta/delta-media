import { readFile } from 'node:fs/promises';
import { DeltaClient,servePlugin } from './delta-sdk.mjs';
import { createMedia } from './media.mjs';
const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
const client=new DeltaClient(); await servePlugin(client,manifest,await createMedia(client));
