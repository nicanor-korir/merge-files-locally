import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The merge logic is DOM-free by design (compressImage is injected), so it runs in Node.
    environment: 'node',
    include: ['lib/**/*.test.js'],
  },
});
