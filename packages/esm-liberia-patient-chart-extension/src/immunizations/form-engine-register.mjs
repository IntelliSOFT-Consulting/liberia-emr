import { register } from 'node:module';

await register(new URL('./form-engine-stub-loader.mjs', import.meta.url).href, import.meta.url);
