import { readFileSync } from 'node:fs';

const styleUrl = 'rbs-style:module';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@openmrs/esm-framework' || specifier.startsWith('@openmrs/esm-framework/')) {
    return { url: new URL('./rbs-framework-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === '@carbon/react') {
    return { url: new URL('./rbs-carbon-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === '@carbon/react/icons') {
    return { url: new URL('./rbs-carbon-icons-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === 'react-i18next') {
    return { url: new URL('./rbs-i18n-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier.endsWith('.scss') || specifier.endsWith('.css') || specifier.endsWith('.sass')) {
    return { url: styleUrl, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && !specifier.endsWith('.js') && !specifier.endsWith('.json')) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url === styleUrl) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'const styles = new Proxy({}, { get: () => "rbs-style" }); export default styles;\n',
    };
  }
  if (url.endsWith('.json')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${readFileSync(new URL(url), 'utf8')};\n`,
    };
  }
  return nextLoad(url, context);
}
