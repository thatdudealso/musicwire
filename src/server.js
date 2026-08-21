import { createApp } from './app.js';
import { config } from './config.js';
import { verifyRpcNetwork } from './payment.js';

if (process.env.NODE_ENV === 'production') {
  try {
    await verifyRpcNetwork(config);
  } catch (error) {
    console.error(`Musicwire refused to start: ${error.message}`);
    process.exit(1);
  }
}

createApp().listen(config.port, () => console.log(`Musicwire listening on ${config.port}`));
