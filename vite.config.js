import react from '@vitejs/plugin-react';

export default {
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist'
  },
  server: {
    proxy: {
      // Dev: forward /api/* to local serverless when running locally
      '/api': 'http://localhost:3001'
    }
  }
};