import '@testing-library/jest-dom';

// ConfigurableLink resolves ${openmrsSpaBase} through the app shell, which tests do not load.
(window as any).getOpenmrsSpaBase = () => '/openmrs/spa/';

// Carbon's TextArea measures itself; jsdom has no ResizeObserver.
(global as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
