import { register } from 'node:module';

await register(new URL('./rbs-form-engine-stub-loader.mjs', import.meta.url).href, import.meta.url);
