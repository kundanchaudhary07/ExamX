import { MONGO_BINARY_CACHE_DIR } from '../src/config/database';

async function ensureBinary() {
  try {
    const { MongoBinary } = await import('mongodb-memory-server');
    const binaryPath = await MongoBinary.getPath({
      downloadDir: MONGO_BINARY_CACHE_DIR
    });
    console.log(`[build] MongoDB binary ready at: ${binaryPath}`);
  } catch (err: any) {
    console.warn(`[build] Warning: Could not pre-cache MongoDB binary: ${err?.message || err}`);
  }
}

ensureBinary();
