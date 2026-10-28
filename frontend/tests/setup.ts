import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => cleanup());

// jsdom does not implement layout APIs that real browsers have
Element.prototype.scrollIntoView = function scrollIntoView() {};
window.scrollTo = (() => {}) as typeof window.scrollTo;
