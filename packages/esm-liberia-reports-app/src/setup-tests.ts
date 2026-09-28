import '@testing-library/jest-dom';
import { TextEncoder } from 'util';

// ConfigurableLink resolves ${openmrsSpaBase} through the app shell, which tests do not load.
(window as any).getOpenmrsSpaBase = () => '/openmrs/spa/';

// Carbon measures some components; jsdom has no ResizeObserver.
(global as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom has no TextEncoder; the mock backend encodes report files with it.
(global as any).TextEncoder ??= TextEncoder;
